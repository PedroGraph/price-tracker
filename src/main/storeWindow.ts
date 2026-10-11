import { BrowserWindow, session, type WebContents } from 'electron'
import { denyPermissions, openExternal } from './security'

/**
 * The browser side of a connected store account: its own cookie profile, the window to sign
 * in, and reading the data a page of the store loads for itself.
 */
export interface StoreSite {
  /** The profile that keeps this store's cookies, e.g. 'persist:temu'. */
  partition: string
  title: string
  /** Where signing in starts (a page that needs the account). */
  startUrl: string
  /** The store's own domains: hidden windows never leave them. */
  hosts: string[]
  /** Other sites the sign-in window may visit, such as "continue with Google". */
  signInHosts?: string[]
}

const onHost = (url: string, domains: string[]): boolean => {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && domains.some((d) => u.hostname === d || u.hostname.endsWith(`.${d}`))
  } catch {
    return false
  }
}

export function storeSession(site: StoreSite): Electron.Session {
  const s = session.fromPartition(site.partition)
  s.setUserAgent(s.getUserAgent().replace(/\s(Electron|amazon-price-tracker)\/\S+/g, ''))
  denyPermissions(s)
  return s
}

const webPreferences = (site: StoreSite): Electron.WebPreferences => ({
  session: storeSession(site),
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false
})

/** A visible window to sign in to the store; resolves when it's closed. The app never sees the password. */
export function openStoreLogin(site: StoreSite, parent?: BrowserWindow): Promise<void> {
  const allowed = [...site.hosts, ...(site.signInHosts ?? [])]
  return new Promise((resolve) => {
    const win = new BrowserWindow({ width: 1100, height: 850, parent, title: site.title, webPreferences: webPreferences(site) })
    win.setMenuBarVisibility(false)
    const guard = (e: Electron.Event, url: string): void => {
      if (onHost(url, allowed)) return
      e.preventDefault()
      openExternal(url)
    }
    win.webContents.on('will-navigate', guard)
    win.webContents.on('will-redirect', guard)
    // "Continue with Google" and the like open a pop-up that talks back to the page.
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (onHost(url, allowed)) return { action: 'allow', overrideBrowserWindowOptions: { parent: win, webPreferences: webPreferences(site) } }
      openExternal(url)
      return { action: 'deny' }
    })
    void win.loadURL(site.startUrl)
    win.on('closed', () => {
      storeSession(site).flushStorageData()
      resolve()
    })
  })
}

/** A hidden window with the store's session that never leaves the store. Destroy it when done. */
export function hiddenStoreWindow(site: StoreSite): BrowserWindow {
  const win = new BrowserWindow({ show: false, width: 1280, height: 900, webPreferences: webPreferences(site) })
  const stay = (e: Electron.Event, url: string): void => {
    if (!onHost(url, site.hosts)) e.preventDefault()
  }
  win.webContents.on('will-navigate', stay)
  win.webContents.on('will-redirect', stay)
  return win
}

export type Captured = { kind: 'ok'; body: string } | { kind: 'login' | 'check' }

/** Windows whose network log is already on. */
const logging = new WeakSet<WebContents>()

/**
 * Opens a page and takes the answer to one request the page itself makes (`request` is part
 * of its address), read through the window's own network log. Nothing is requested on the
 * page's behalf: when the store sends the page to sign in (`signIn`), refuses the request,
 * or shows a check instead, there's no answer and it's reported as that.
 */
export function capture(win: BrowserWindow, pageUrl: string, request: string, signIn: RegExp): Promise<Captured> {
  const wc = win.webContents
  return new Promise((resolve) => {
    const wanted = new Set<string>()
    let finished = false
    const done = (r: Captured): void => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      wc.debugger.removeListener('message', onMessage)
      wc.removeListener('did-navigate', onNavigate)
      wc.removeListener('did-navigate-in-page', onNavigate)
      resolve(r)
    }
    const timer = setTimeout(() => done({ kind: signIn.test(wc.getURL()) ? 'login' : 'check' }), 40_000)
    const onMessage = (_e: unknown, method: string, params: { requestId: string; response?: { url: string; status: number } }): void => {
      if (method === 'Network.responseReceived' && params.response?.url.includes(request)) {
        if (params.response.status === 401 || params.response.status === 403) return done({ kind: 'login' })
        wanted.add(params.requestId)
      }
      if (method === 'Network.loadingFinished' && wanted.has(params.requestId)) {
        wc.debugger
          .sendCommand('Network.getResponseBody', { requestId: params.requestId })
          .then((r: { body: string; base64Encoded: boolean }) => done({ kind: 'ok', body: r.base64Encoded ? Buffer.from(r.body, 'base64').toString('utf8') : r.body }))
          .catch(() => undefined)
      }
    }
    const onNavigate = (_e: unknown, url: string): void => {
      if (signIn.test(url)) done({ kind: 'login' })
    }
    wc.debugger.on('message', onMessage)
    wc.on('did-navigate', onNavigate)
    // Single-page sites move to their sign-in screen without loading a new page.
    wc.on('did-navigate-in-page', onNavigate)
    // The network log can only be switched on once the window has a page, so start from a blank one.
    const ready = logging.has(wc)
      ? Promise.resolve()
      : wc.loadURL('about:blank').then(() => {
          wc.debugger.attach('1.3')
          logging.add(wc)
          return wc.debugger.sendCommand('Network.enable')
        })
    void ready.then(() => wc.loadURL(pageUrl)).catch(() => done({ kind: 'check' }))
  })
}
