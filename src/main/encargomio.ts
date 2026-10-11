import { parseEncargomioList, parseEncargomioTrack } from '@shared/shipping'
import type { ReadResult, StoreReader } from './accounts'
import { capture, hiddenStoreWindow, openStoreLogin, storeSession, type StoreSite } from './storeWindow'

/**
 * The Encargomio account (a forwarder: it buys or receives in the US and brings it to
 * Colombia). Its shipments say which carrier has the package and its tracking number, so a
 * connected account fills those in by itself.
 */
const SHIPMENTS_PAGE = 'https://www.encargomio.com/shipments'
const SITE: StoreSite = { partition: 'persist:encargomio', title: 'Encargomio', startUrl: SHIPMENTS_PAGE, hosts: ['encargomio.com'] }
/** The requests its pages make for the list of shipments and for one shipment's history. */
const LIST_REQUEST = '/shipping-order/list'
const TRACK_REQUEST = '/shipping-order/tracking/'
const SIGN_IN = /\/auth\/login/

const MAX_TRACK_PAGES = 6
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

async function read(wantsHistory: Parameters<StoreReader['read']>[0]): Promise<ReadResult> {
  const win = hiddenStoreWindow(SITE)
  try {
    const list = await capture(win, SHIPMENTS_PAGE, LIST_REQUEST, SIGN_IN)
    if (list.kind !== 'ok') return list
    let packages: ReturnType<typeof parseEncargomioList> = null
    try {
      packages = parseEncargomioList(JSON.parse(list.body))
    } catch {
      // Not JSON: an unreadable list.
    }
    if (!packages) return { kind: 'error' }
    // Each shipment's movements come with its own page.
    let pagesRead = 0
    for (const p of packages) {
      if (!p.trackPage || pagesRead >= MAX_TRACK_PAGES || !wantsHistory(p)) continue
      pagesRead++
      await sleep(3000 + Math.random() * 3000)
      const track = await capture(win, p.trackPage, TRACK_REQUEST, SIGN_IN)
      try {
        p.events = track.kind === 'ok' ? parseEncargomioTrack(JSON.parse(track.body)) : null
      } catch {
        p.events = null
      }
    }
    return { kind: 'ok', packages }
  } finally {
    if (!win.isDestroyed()) win.destroy()
  }
}

export const encargomio: StoreReader = {
  id: 'encargomio',
  name: 'Encargomio',
  key: 'encargomio',
  every: 60 * 60_000,
  connect: (parent) => openStoreLogin(SITE, parent),
  disconnect: () => storeSession(SITE).clearStorageData(),
  read
}
