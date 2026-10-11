import { Notification } from 'electron'
import { AUTO_TRACKED, parseServientrega, statusFromCarrier } from '@shared/shipping'
import type { Shipment, ShipmentTracking } from '@shared/types'
import * as db from './db'
import { sendReport } from './notify'
import { tr } from './settings'

/**
 * Reads the carrier's tracking for shipments that aren't delivered yet, keeps what it says
 * and tells you when it changes. Only carriers in AUTO_TRACKED; the rest stay manual.
 */
const EVERY = 30 * 60_000
const TIMEOUT = 20_000
let running = false

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

const SERVIENTREGA = 'https://mobile.servientrega.com/Services/ShipmentTracking/api'

/**
 * The same two requests Servientrega's own tracking page makes: first whether this number
 * needs its human check, and only when it doesn't, the tracking itself.
 */
async function servientrega(tracking: string, checkedAt: string): Promise<ShipmentTracking> {
  const blocked: ShipmentTracking = { state: '', from: null, to: null, eta: null, events: [], checkedAt, blocked: true }
  const gate = await fetch(`${SERVIENTREGA}/captchanumeroguia/${encodeURIComponent(tracking)}`, { signal: AbortSignal.timeout(TIMEOUT) })
  if ((await gate.text()).replace(/[^a-z]/gi, '').toLowerCase() !== 'false') return blocked
  const res = await fetch(`${SERVIENTREGA}/ControlRastreovalidaciones`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ numeroGuia: tracking, idValidacionUsuario: '0', tipoDatoValidar: '0', datoRespuestaUsuario: '0', idpais: 1, lenguaje: 'es' }),
    signal: AbortSignal.timeout(TIMEOUT)
  })
  if (!res.ok) throw new Error(`Servientrega: HTTP ${res.status}`)
  // No shipment in the answer: it wants another number (invoice, ID) typed on its page.
  return parseServientrega(await res.json(), checkedAt) ?? blocked
}

const READERS: Record<string, (tracking: string, checkedAt: string) => Promise<ShipmentTracking>> = { servientrega }

const due = (s: Shipment, force: boolean): boolean =>
  // Shipments read from a store account get their state from the store.
  s.source === 'manual' && !!s.tracking && !!s.carrier && AUTO_TRACKED.includes(s.carrier) && s.status !== 'delivered' &&
  (force || !s.live || Date.now() - Date.parse(s.live.checkedAt) >= EVERY)

/** Checks the shipments that are due (all the open ones when forced). Resolves to true when something changed. */
export async function refreshShipments(force = false): Promise<boolean> {
  if (running) return false
  running = true
  let changed = false
  try {
    for (const s of db.listShipments().filter((x) => due(x, force))) {
      let live: ShipmentTracking
      try {
        live = await READERS[s.carrier!](s.tracking!, new Date().toISOString())
      } catch {
        // No connection or the carrier is down: keep what we had and try again next time.
        continue
      }
      // A read that didn't get through keeps the last known state on screen.
      if (live.blocked && s.live?.state) live = { ...s.live, checkedAt: live.checkedAt, blocked: true }
      const moved = !!live.state && live.state !== s.live?.state
      db.setShipmentLive(s.id, live, moved ? statusFromCarrier(live.state) : null)
      changed = true
      // The first read only fills it in; after that, each new state is news.
      if (moved && s.live?.state) await announce(s, live).catch(() => undefined)
    }
  } finally {
    running = false
  }
  return changed
}

/** Tells every channel that a shipment has a new state. */
export async function announce(s: Shipment, live: ShipmentTracking): Promise<void> {
  const title = tr('Your shipment: {state}', { state: live.state })
  const last = live.events[0]
  const detail = last ? `${last.text}${last.place ? ` · ${last.place}` : ''} (${last.at})` : ''
  if (Notification.isSupported()) new Notification({ title, body: s.title.slice(0, 80) }).show()
  await sendReport(
    title,
    `<p><b>${esc(s.title)}</b></p>${detail ? `<p>${esc(detail)}</p>` : ''}`,
    `📦 <b>${esc(title)}</b>\n${esc(s.title.slice(0, 90))}${detail ? `\n<i>${esc(detail)}</i>` : ''}`
  )
}
