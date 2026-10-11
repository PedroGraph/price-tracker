import { parseTemuOrders, parseTemuTrack } from '@shared/shipping'
import type { ShipmentTracking } from '@shared/types'
import type { ReadResult, StoreReader } from './accounts'
import { capture, hiddenStoreWindow, openStoreLogin, storeSession, type StoreSite } from './storeWindow'

/**
 * The Temu account: you sign in once in a window of the app, and a hidden window later
 * opens "Your orders" with that session.
 */
const ORDERS_PAGE = 'https://www.temu.com/bgt_orders.html'
const SITE: StoreSite = {
  partition: 'persist:temu',
  title: 'Temu',
  startUrl: ORDERS_PAGE,
  hosts: ['temu.com'],
  signInHosts: ['accounts.google.com', 'appleid.apple.com', 'facebook.com']
}
/** The request the orders page makes for its list. */
const ORDERS_REQUEST = '/api/bg/aristotle/user_order_list'

/** Tracking pages opened per read, so a long list of packages doesn't turn into a burst of pages. */
const MAX_TRACK_PAGES = 6
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Runs in Temu's tracking page: the movements it was served with. Self-contained, like the Amazon extractors. */
const TRACK_NODES = `(() => {
  const list = window.rawData?.store?.logisticsTrackInfo?.trackNodeVOList
  return Array.isArray(list) ? list.map((n) => ({ operatorTimeStr: n.operatorTimeStr, trackDesc: n.trackDesc, status: n.status })) : null
})()`

/** A package's movements from its tracking page, after a pause like a person's. Null when they can't be read. */
async function readTrack(win: Electron.BrowserWindow, url: string): Promise<ShipmentTracking['events'] | null> {
  try {
    await sleep(3000 + Math.random() * 3000)
    await win.webContents.loadURL(url)
    await sleep(1500)
    return parseTemuTrack(await win.webContents.executeJavaScript(TRACK_NODES))
  } catch {
    return null
  }
}

async function read(wantsHistory: Parameters<StoreReader['read']>[0]): Promise<ReadResult> {
  const win = hiddenStoreWindow(SITE)
  try {
    const result = await capture(win, ORDERS_PAGE, ORDERS_REQUEST, /\/login/)
    if (result.kind !== 'ok') return result
    let body: unknown
    try {
      body = JSON.parse(result.body)
    } catch {
      return { kind: 'error' }
    }
    const packages = parseTemuOrders(body)
    // Signed out, Temu keeps the page and answers the list with an error instead.
    if (!packages) return { kind: typeof (body as { error_code?: unknown } | null)?.error_code === 'number' ? 'login' : 'error' }
    // The movements are on each package's own page: read it for the ones still on their way.
    let pagesRead = 0
    for (const p of packages) {
      if (!p.trackPage || pagesRead >= MAX_TRACK_PAGES || !wantsHistory(p)) continue
      pagesRead++
      p.events = await readTrack(win, p.trackPage)
    }
    return { kind: 'ok', packages }
  } finally {
    if (!win.isDestroyed()) win.destroy()
  }
}

export const temu: StoreReader = {
  id: 'temu',
  name: 'Temu',
  key: 'temu',
  every: 3 * 60 * 60_000,
  connect: (parent) => openStoreLogin(SITE, parent),
  disconnect: () => storeSession(SITE).clearStorageData(),
  read
}
