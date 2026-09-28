import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { UpdateState } from '@shared/types'

/**
 * Updates come from GitHub Releases (see `publish` in electron-builder.yml). They only
 * work in the installed app, and only while the repository is public: a private repo
 * would need a token shipped inside the app, which we don't do.
 */
export const update: UpdateState = { status: 'idle', version: null, error: null }

let onChange: () => void = () => undefined
let hooks: UpdaterHooks = { isIdle: () => false, beforeInstall: () => undefined }

export interface UpdaterHooks {
  /** True when nobody would notice a restart: window hidden in the tray and no check running. */
  isIdle: () => boolean
  /** Called right before quitting to install (remember to come back hidden, flush data…). */
  beforeInstall: (hidden: boolean) => void
}

export function initUpdater(notify: () => void, h: UpdaterHooks): void {
  onChange = notify
  hooks = h
  if (!app.isPackaged) return
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('checking-for-update', () => set({ status: 'checking', error: null }))
  autoUpdater.on('update-available', (i) => set({ status: 'downloading', version: i.version }))
  autoUpdater.on('update-not-available', () => set({ status: 'up-to-date' }))
  autoUpdater.on('update-downloaded', (i) => {
    set({ status: 'ready', version: i.version })
    installWhenIdle()
  })
  autoUpdater.on('error', (e) => set({ status: 'error', error: e.message.split('\n')[0] }))
  void checkForUpdates()
  // Then once every 6 hours.
  setInterval(() => void checkForUpdates(), 6 * 60 * 60_000)
}

export async function checkForUpdates(): Promise<void> {
  if (!app.isPackaged) return set({ status: 'error', error: 'Updates only work in the installed app.' })
  try {
    await autoUpdater.checkForUpdates()
  } catch {
    // Reported through the 'error' event.
  }
}

/** Restarts into the downloaded version: silent install (no wizard), then the app opens again. */
export function installUpdate(hidden = false): void {
  if (update.status !== 'ready') return
  hooks.beforeInstall(hidden)
  autoUpdater.quitAndInstall(true, true)
}

/**
 * While the app sits in the tray, apply a downloaded update by itself: checked every
 * minute, it installs as soon as no check is running, and the app comes back to the tray.
 */
function installWhenIdle(): void {
  const timer = setInterval(() => {
    if (update.status !== 'ready') return clearInterval(timer)
    if (hooks.isIdle()) {
      clearInterval(timer)
      installUpdate(true)
    }
  }, 60_000)
}

function set(patch: Partial<UpdateState>): void {
  Object.assign(update, patch)
  onChange()
}
