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

export function initUpdater(notify: () => void): void {
  onChange = notify
  if (!app.isPackaged) return
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('checking-for-update', () => set({ status: 'checking', error: null }))
  autoUpdater.on('update-available', (i) => set({ status: 'downloading', version: i.version }))
  autoUpdater.on('update-not-available', () => set({ status: 'up-to-date' }))
  autoUpdater.on('update-downloaded', (i) => set({ status: 'ready', version: i.version }))
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

/** Restarts into the downloaded version. */
export function installUpdate(): void {
  if (update.status === 'ready') autoUpdater.quitAndInstall()
}

function set(patch: Partial<UpdateState>): void {
  Object.assign(update, patch)
  onChange()
}
