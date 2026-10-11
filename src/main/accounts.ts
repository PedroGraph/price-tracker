import type { BrowserWindow } from 'electron'
import { carrierFromName, statusFromCarrier, type StorePackage } from '@shared/shipping'
import type { LinkedStore, ShipmentTracking } from '@shared/types'
import { amazonOrders } from './amazonOrders'
import * as db from './db'
import { announce } from './shipments'
import { encargomio } from './encargomio'
import { temu } from './temu'

/**
 * Store accounts connected to read their orders. Each store has a reader that knows how to
 * sign in and how to read its order list; everything else is the same for all of them: when
 * to read, keeping the packages on their way as shipments, and telling you when one changes.
 */
export type ReadResult = { kind: 'ok'; packages: StorePackage[] } | { kind: 'login' | 'check' | 'error' }

export interface StoreReader {
  id: LinkedStore['id']
  name: string
  /** Where its link state is kept in the settings table. */
  key: string
  /** Time between reads. */
  every: number
  /** Whatever signing in takes (usually a window); resolves when it's done. `state` is what the last read said. */
  connect: (parent: BrowserWindow | undefined, state: LinkedStore['state']) => Promise<void>
  /** Forgets the store's session, if the reader has one of its own. */
  disconnect: () => Promise<void>
  /**
   * Reads the order list. Readers that need another page per package for its history only
   * open it for the packages `wantsHistory` accepts, and leave `events` unset for the rest.
   */
  read: (wantsHistory: (p: StorePackage) => boolean) => Promise<ReadResult>
}

const READERS: StoreReader[] = [amazonOrders, encargomio, temu]

interface Link {
  linked: boolean
  state: LinkedStore['state']
  syncedAt: string | null
}

const link = (r: StoreReader): Link => db.getSetting<Link>(r.key, { linked: false, state: 'off', syncedAt: null })
const running = new Set<string>()

export function linkedStores(): LinkedStore[] {
  return READERS.map((r) => {
    const l = link(r)
    return { id: r.id, name: r.name, state: l.linked ? l.state : 'off', syncedAt: l.syncedAt }
  })
}

/** Signs in (when the store needs it), connects the account and reads its orders. */
export async function connectStore(id: unknown, parent?: BrowserWindow): Promise<void> {
  const reader = READERS.find((r) => r.id === id)
  if (!reader) return
  const l = link(reader)
  await reader.connect(parent, l.linked ? l.state : 'off')
  db.setSetting(reader.key, { ...link(reader), linked: true })
  await sync(reader, true)
}

export async function disconnectStore(id: unknown): Promise<void> {
  const reader = READERS.find((r) => r.id === id)
  if (!reader) return
  await reader.disconnect()
  db.setSetting(reader.key, { linked: false, state: 'off', syncedAt: null })
}

/** Reads every connected store whose last read is old enough (all of them when forced). Resolves to true when one was read. */
export async function syncStores(force = false): Promise<boolean> {
  let ran = false
  for (const reader of READERS) ran = (await sync(reader, force).catch(() => false)) || ran
  return ran
}

async function sync(reader: StoreReader, force: boolean): Promise<boolean> {
  const l = link(reader)
  if (!l.linked || running.has(reader.id)) return false
  if (!force && l.syncedAt && Date.now() - Date.parse(l.syncedAt) < reader.every) return false
  running.add(reader.id)
  const syncedAt = new Date().toISOString()
  try {
    const open = (p: StorePackage): boolean => !p.delivered && !p.closed && !db.findImported(reader.id, p.id)?.hidden
    const result = await reader.read(open).catch((): ReadResult => ({ kind: 'error' }))
    if (result.kind === 'ok') for (const p of result.packages) await keep(reader, p, syncedAt)
    db.setSetting(reader.key, { linked: true, state: result.kind, syncedAt })
    return true
  } finally {
    running.delete(reader.id)
  }
}

/** Adds or updates the shipment of one package, and announces a new state. */
async function keep(reader: StoreReader, p: StorePackage, checkedAt: string): Promise<void> {
  const existing = db.findImported(reader.id, p.id)
  // Cancelled or returned: nothing is coming any more.
  if (p.closed) {
    if (existing && !existing.hidden) db.removeShipment(existing.id)
    return
  }
  // Old orders that already arrived aren't news, and removed ones stay removed.
  if (existing ? existing.hidden : p.delivered) return
  const status = p.delivered ? 'delivered' : (p.status ?? statusFromCarrier(p.state))
  const live: ShipmentTracking = {
    state: p.state,
    from: null,
    to: null,
    eta: p.eta,
    events: p.events ?? existing?.live?.events ?? [],
    checkedAt,
    by: reader.name
  }
  const carrier = carrierFromName(p.carrier)
  // Already added by hand with this tracking number: that shipment becomes the account's.
  const byHand = !existing && p.tracking ? db.findManualByTracking(p.tracking) : null
  if (byHand) {
    db.adoptShipment(byHand.id, reader.id, p.id)
    db.setShipmentLive(byHand.id, live, status)
    return
  }
  if (!existing) {
    const asin = p.asin && db.getProduct(p.asin) ? p.asin : null
    const id = db.addImported(reader.id, p.id, { asin, title: p.title, store: p.store ?? reader.name, forwarder: p.forwarder ?? null, carrier, tracking: p.tracking, status })
    db.setShipmentLive(id, live, null, true)
    return
  }
  db.setImportedRoute(existing.id, carrier, p.tracking)
  const moved = !!p.state && p.state !== existing.live?.state
  db.setShipmentLive(existing.id, live, moved ? status : null)
  if (moved && existing.live?.state) await announce(existing, live).catch(() => undefined)
}
