import { app, shell, type IpcMainInvokeEvent, type Session, type WebContents } from 'electron'
import { isAllowedExternal, isAmazonUrl } from '@shared/urls'

/** No page (ours or Amazon's) gets camera, microphone, location, notifications, clipboard… */
export function denyPermissions(ses: Session): void {
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  ses.setPermissionCheckHandler(() => false)
}

export function openExternal(url: string): void {
  if (isAllowedExternal(url)) void shell.openExternal(url)
}

/**
 * Defaults for every web contents: no <webview>, no pop-up windows. Windows that need
 * more (the app window, the Amazon sign-in window) set their own handlers afterwards.
 */
export function installGlobalGuards(): void {
  app.on('web-contents-created', (_e, contents) => {
    contents.on('will-attach-webview', (e) => e.preventDefault())
    contents.setWindowOpenHandler(({ url }) => {
      openExternal(url)
      return { action: 'deny' }
    })
  })
}

/** Amazon windows stay on amazon.com; other links open in the browser (if allowed) instead. */
export function keepOnAmazon(contents: WebContents): void {
  const guard = (e: Electron.Event, url: string): void => {
    if (isAmazonUrl(url)) return
    e.preventDefault()
    openExternal(url)
  }
  contents.on('will-navigate', guard)
  contents.on('will-redirect', guard)
  contents.setWindowOpenHandler(({ url }) => {
    // Amazon sometimes opens sign-in steps in a pop-up: show them in the same window.
    if (isAmazonUrl(url)) void contents.loadURL(url)
    else openExternal(url)
    return { action: 'deny' }
  })
}

/** Only the app's own page may call the IPC API (Amazon pages have no preload, but be strict). */
export function isTrustedSender(event: IpcMainInvokeEvent): boolean {
  const url = event.senderFrame?.url ?? ''
  const dev = process.env.ELECTRON_RENDERER_URL
  return app.isPackaged || !dev ? url.startsWith('file://') && url.includes('/renderer/index.html') : url.startsWith(dev)
}

/**
 * Re-saves every Amazon cookie once so Chromium writes it encrypted. Cookies stored before
 * cookie encryption was switched on stay readable but in plain text until rewritten.
 */
export async function reencryptCookies(ses: Session, done: () => boolean, markDone: () => void): Promise<void> {
  if (!app.isPackaged || done()) return
  for (const c of await ses.cookies.get({})) {
    try {
      await ses.cookies.set({
        url: `https://${(c.domain ?? '').replace(/^\./, '')}${c.path ?? '/'}`,
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path,
        secure: c.secure,
        httpOnly: c.httpOnly,
        sameSite: c.sameSite,
        expirationDate: c.session ? undefined : c.expirationDate
      })
    } catch {
      // A cookie that can't be re-set just stays as it was.
    }
  }
  await ses.cookies.flushStore()
  markDone()
}
