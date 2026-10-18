/**
 * Shipments of things you bought, on Amazon or anywhere else: where it was bought, whether
 * it comes through a forwarder (a US mailbox such as Encargomio), who carries it and its
 * tracking number. The app doesn't read the carriers' pages: it keeps the status you set
 * and opens the right tracking page.
 */
import type { ShipmentInput, ShipmentStatus, ShipmentTracking } from './types'

export const SHIPMENT_STATUSES: ShipmentStatus[] = ['ordered', 'transit', 'customs', 'delivering', 'delivered']

/** Well-known stores, with the page where each one shows your orders. */
export const STORES: { name: string; orders: string }[] = [
  { name: 'Amazon', orders: 'https://www.amazon.com/gp/css/order-history' },
  { name: 'Temu', orders: 'https://www.temu.com/' },
  { name: 'AliExpress', orders: 'https://www.aliexpress.com/p/order/index.html' },
  { name: 'Shein', orders: 'https://www.shein.com/' },
  { name: 'eBay', orders: 'https://www.ebay.com/mye/myebay/purchase' },
  { name: 'Walmart', orders: 'https://www.walmart.com/orders' },
  { name: 'MercadoLibre', orders: 'https://www.mercadolibre.com.co/' }
]

/** Forwarders: you buy with their US address and they bring it to Colombia. */
export const FORWARDERS = ['Encargomio', 'Aeropost', 'eShopex', 'Tiendamia', 'Casillero 4-72']

export interface Carrier {
  id: string
  name: string
  /** The carrier's tracking page, where the number is typed in. */
  page: string
  /** A link that opens the tracking of one number directly, for carriers that have one. */
  link?: (tracking: string) => string
}

export const CARRIERS: Carrier[] = [
  {
    id: 'servientrega',
    name: 'Servientrega',
    page: 'https://www.servientrega.com/wps/portal/rastreo-envio',
    link: (n) => `https://mobile.servientrega.com/WebSitePortal/RastreoEnvioDetalle.html?Guia=${encodeURIComponent(n)}`
  },
  { id: 'coordinadora', name: 'Coordinadora', page: 'https://coordinadora.com/' },
  { id: 'interrapidisimo', name: 'Interrapidísimo', page: 'https://www.interrapidisimo.com/' },
  { id: 'envia', name: 'Envía', page: 'https://envia.co/' },
  { id: 'tcc', name: 'TCC', page: 'https://tcc.com.co/' },
  { id: 'deprisa', name: 'Deprisa', page: 'https://www.deprisa.com/' },
  { id: '472', name: '4-72', page: 'https://www.4-72.com.co/' },
  { id: 'dhl', name: 'DHL', page: 'https://www.dhl.com/co-es/home/tracking.html', link: (n) => `https://www.dhl.com/co-es/home/tracking.html?tracking-id=${encodeURIComponent(n)}` },
  { id: 'fedex', name: 'FedEx', page: 'https://www.fedex.com/fedextrack/', link: (n) => `https://www.fedex.com/fedextrack/?trknbr=${encodeURIComponent(n)}` },
  { id: 'ups', name: 'UPS', page: 'https://www.ups.com/track', link: (n) => `https://www.ups.com/track?tracknum=${encodeURIComponent(n)}` },
  { id: 'usps', name: 'USPS', page: 'https://tools.usps.com/go/TrackConfirmAction', link: (n) => `https://tools.usps.com/go/TrackConfirmAction?tLabels=${encodeURIComponent(n)}` }
]

/** The name to show: a known carrier's, or the text typed for another one. */
export function carrierName(carrier: string | null): string | null {
  return CARRIERS.find((c) => c.id === carrier)?.name ?? carrier
}

/**
 * Where to follow a shipment at its carrier. `direct` is false when the page only has the
 * form, so the number still has to be pasted there. Null for carriers the app doesn't know.
 */
export function trackingLink(carrier: string | null, tracking: string | null): { url: string; direct: boolean } | null {
  const known = CARRIERS.find((c) => c.id === carrier)
  if (!known) return null
  return tracking && known.link ? { url: known.link(tracking), direct: true } : { url: known.page, direct: false }
}

/** 17TRACK finds the carrier from the number, so it works for any of them. */
export function universalLink(tracking: string, lang: 'en' | 'es'): string {
  return `https://t.17track.net/${lang}#nums=${encodeURIComponent(tracking)}`
}

/** Carriers whose tracking the app reads by itself. */
export const AUTO_TRACKED = ['servientrega']

/**
 * The app's status for a carrier's or store's own wording, in Spanish or English.
 * Anything it doesn't recognise counts as on the way.
 */
export function statusFromCarrier(state: string): ShipmentStatus {
  const s = state.toUpperCase()
  if (/DEVOLUCI|DEVUELT|RETURN/.test(s)) return 'transit'
  if (/ENTREGAD|DELIVERED/.test(s)) return 'delivered'
  if (/DISTRIBUCI|REPARTO|OUT FOR DELIVERY/.test(s)) return 'delivering'
  if (/ADUAN|CUSTOMS/.test(s)) return 'customs'
  // The label exists but the carrier doesn't have the package yet.
  if (/ALISTAMIENTO|GU[IÍ]A GENERADA|PROCESANDO|PREPARANDO|PROCESSING|PREPARING|NO ENVIADO|NOT YET SHIPPED/.test(s)) return 'ordered'
  return 'transit'
}

/** One package of a store order, as the store's order list describes it. */
export interface StorePackage {
  /** The store's id for the package. */
  id: string
  title: string
  carrier: string | null
  tracking: string | null
  /** The store's own words, e.g. "Despacho de aduana". */
  state: string
  eta: string | null
  delivered: boolean
  /** The store's page with this package's tracking history; null when it isn't one we know. */
  trackPage: string | null
  /** Its movements, when the reader got them; unset keeps the ones already known. */
  events?: ShipmentTracking['events'] | null
  /** Cancelled or returned: nothing is coming any more. */
  closed?: boolean
  /** The Amazon product it is, to link it with a tracked one. */
  asin?: string | null
  /** Where it was bought and who forwards it, when the account isn't the shop itself. */
  store?: string
  forwarder?: string
  /** The app's status when the account says it outright; otherwise it's read from `state`. */
  status?: ShipmentStatus
}

/**
 * The shipments on Amazon's "Your orders" page as packages. Amazon shows a status line per
 * shipment and no carrier or tracking number there.
 */
export function amazonPackages(
  boxes: { orderId: string | null; status: string | null; detail: string | null; items: { asin: string | null; title: string | null }[] }[]
): StorePackage[] {
  const perOrder = new Map<string, number>()
  const out: StorePackage[] = []
  for (const b of boxes) {
    const state = clean(b.status)
    if (!b.orderId || !state) continue
    const n = (perOrder.get(b.orderId) ?? 0) + 1
    perOrder.set(b.orderId, n)
    const first = (clean(b.items[0]?.title) ?? 'Amazon').slice(0, 150)
    const detail = clean(b.detail)
    out.push({
      id: `${b.orderId}#${n}`,
      title: b.items.length > 1 ? `${first} (+${b.items.length - 1})` : first,
      carrier: null,
      tracking: null,
      state,
      eta: null,
      delivered: /entregad|delivered/i.test(state),
      trackPage: null,
      events: detail ? [{ at: '', text: detail.slice(0, 200), place: null }] : [],
      closed: /cancel|devoluci|devuelt|return|refund|reembols/i.test(state),
      asin: b.items[0]?.asin ?? null
    })
  }
  return out
}

/** The movements on Temu's package tracking page (newest first, as it lists them). Null when they aren't there. */
export function parseTemuTrack(nodes: unknown): ShipmentTracking['events'] | null {
  const raw = nodes as { trackNodeVOList?: unknown; data?: { trackNodeVOList?: unknown; logisticsTrackInfo?: { trackNodeVOList?: unknown } } } | null
  const list = Array.isArray(nodes) ? nodes : Array.isArray(raw?.trackNodeVOList) ? raw.trackNodeVOList : Array.isArray(raw?.data?.trackNodeVOList) ? raw.data.trackNodeVOList : raw?.data?.logisticsTrackInfo?.trackNodeVOList
  if (!Array.isArray(list)) return null
  const events: ShipmentTracking['events'] = []
  for (const n of list as Record<string, unknown>[]) {
    const text = clean(n?.trackDesc) ?? clean(n?.track_desc) ?? clean(n?.status) ?? clean(n?.statusDesc)
    const at = clean(n.operatorTimeStr) ?? clean(n.operator_time_str) ?? clean(n.time)
    if (text) events.push({ at: at ?? '', text: text.slice(0, 200), place: clean(n.location) })
  }
  return events.slice(0, 60)
}

/** Uses the newest Temu movement to repair a stale state from the order list. */
export function temuStateFromTrack(events: ShipmentTracking['events']): { state: string; delivered: boolean } | null {
  const latest = events[0]?.text?.trim()
  if (!latest) return null
  return { state: latest, delivered: /ENTREGAD|DELIVERED/.test(latest.toUpperCase()) && !/NO ENTREGAD|NOT DELIVERED/.test(latest.toUpperCase()) }
}

/**
 * The packages in Temu's order list (what its "Your orders" page loads), without the
 * address it also carries. Null when the answer doesn't look like an order list.
 */
export function parseTemuOrders(body: unknown): StorePackage[] | null {
  const root = body as { view_orders?: unknown; data?: { view_orders?: unknown; orders?: unknown; order_list?: unknown }; result?: { view_orders?: unknown; orders?: unknown; order_list?: unknown } } | null
  const orders = root?.view_orders ?? root?.data?.view_orders ?? root?.data?.orders ?? root?.data?.order_list ?? root?.result?.view_orders ?? root?.result?.orders ?? root?.result?.order_list
  if (!Array.isArray(orders)) return null
  const out: StorePackage[] = []
  for (const order of orders as { shipping_module?: { package_list?: unknown } }[]) {
    const packages = order?.shipping_module?.package_list ?? (order as Record<string, unknown>)?.package_list
    for (const p of Array.isArray(packages) ? (packages as Record<string, unknown>[]) : []) {
      const id = clean(p?.package_sn) ?? clean(p?.packageSn) ?? clean(p?.package_id)
      if (!id) continue
      const goods = Array.isArray(p.goods_volist) ? (p.goods_volist as Record<string, unknown>[]) : []
      const first = (clean(goods[0]?.goods_name) ?? clean(p.product_name) ?? 'Temu').slice(0, 150)
      const count = typeof p.display_total_items_number === 'number' ? p.display_total_items_number : goods.length
      const page = clean(p.package_detail_jump_url ?? p.package_detail_url)?.replace(/^\//, '')
      out.push({
        id,
        title: count > 1 ? `${first} (+${count - 1})` : first,
        carrier: clean(p.logistics_providers_name) ?? clean(p.logistics_provider_name),
        tracking: clean(p.way_bill_sn) ?? clean(p.tracking_number),
        state: clean(p.order_package_status_desc) ?? clean(p.package_status_desc) ?? clean(p.status_desc) ?? '',
        eta: clean(p.expect_delivery_time_range),
        delivered: p.is_delivered === true || p.isDelivered === true,
        trackPage: page && /^bgst_express\.html\?[\w=&.%-]+$/.test(page) ? `https://www.temu.com/${page}` : null
      })
    }
  }
  return out
}

/** The id of a carrier the app knows, from the name a store gives it ("Servientrega nuevo"); otherwise the name itself. */
export function carrierFromName(name: string | null): string | null {
  const n = name?.toLowerCase() ?? ''
  return CARRIERS.find((c) => n === c.name.toLowerCase() || n.startsWith(`${c.name.toLowerCase()} `))?.id ?? name
}

/** Encargomio's statuses that mean the shipment hasn't left yet (packing, label, payment). */
const ENCARGOMIO_NOT_SENT = new Set([0, 1, 2, 3, 7, 10, 11, 12])
const ENCARGOMIO_DELIVERED = 9
/** Cancelled, or split into other shipments that are listed on their own. */
const ENCARGOMIO_CLOSED = new Set([6, 8])

const storeFromLink = (link: unknown): string | null => {
  try {
    const host = new URL(String(link)).hostname.replace(/^www\./, '')
    return STORES.find((s) => host === new URL(s.orders).hostname.replace(/^www\.|^myaccount\./, ''))?.name ?? null
  } catch {
    return null
  }
}

/**
 * The shipments in Encargomio's list, without the address it also carries. The carrier and
 * tracking number are the national ones once it's in Colombia, the international ones before.
 * Null when the answer doesn't look like the list.
 */
export function parseEncargomioList(body: unknown): StorePackage[] | null {
  const rows = (body as { data?: { data?: unknown } } | null)?.data?.data
  if (!Array.isArray(rows)) return null
  const out: StorePackage[] = []
  for (const r of rows as Record<string, unknown>[]) {
    const id = typeof r?.shipping_order === 'number' ? r.shipping_order : null
    const state = clean(r?.status_name)
    if (id === null || !state) continue
    const products = Array.isArray(r.products) ? (r.products as Record<string, unknown>[]) : []
    const first = (clean(products[0]?.name) ?? 'Encargomio').slice(0, 150)
    const link = products[0]?.store_link
    const status = typeof r.status_id === 'number' ? r.status_id : -1
    out.push({
      id: String(id),
      title: products.length > 1 ? `${first} (+${products.length - 1})` : first,
      carrier: clean(r.national_conveyor) ?? clean(r.international_conveyor),
      tracking: clean(r.national_guide_number) ?? clean(r.international_guide_number),
      // Before it leaves, Encargomio's own word says more than "sent" would.
      state,
      eta: null,
      delivered: status === ENCARGOMIO_DELIVERED,
      trackPage: `https://www.encargomio.com/shipments/${id}/tracking`,
      closed: ENCARGOMIO_CLOSED.has(status),
      asin: /\/dp\/([A-Z0-9]{10})/.exec(String(link ?? ''))?.[1] ?? null,
      store: storeFromLink(link) ?? 'Encargomio',
      forwarder: 'Encargomio',
      status: ENCARGOMIO_NOT_SENT.has(status) ? 'ordered' : undefined
    })
  }
  return out
}

/** A shipment's movements from Encargomio's tracking answer (days, newest first, each with its events). */
export function parseEncargomioTrack(body: unknown): ShipmentTracking['events'] | null {
  const days = (body as { data?: { tracking_days?: unknown } } | null)?.data?.tracking_days
  if (!Array.isArray(days)) return null
  const events: ShipmentTracking['events'] = []
  for (const day of days as { date_label?: unknown; events?: unknown }[]) {
    for (const e of Array.isArray(day?.events) ? (day.events as Record<string, unknown>[]) : []) {
      const text = clean(e?.description)
      if (text) events.push({ at: [clean(day.date_label), clean(e.time)].filter(Boolean).join(', '), text: text.slice(0, 200), place: clean(e.location) })
    }
  }
  return events.slice(0, 60)
}

const clean = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim().replace(/\s+/g, ' ') : null)

/**
 * Servientrega's answer for one tracking number, without the names and addresses it also
 * carries. Null when it isn't a shipment (it asks for another number, or the shape changed).
 */
export function parseServientrega(body: unknown, checkedAt: string): ShipmentTracking | null {
  const result = (body as { Results?: unknown[] } | null)?.Results?.[0]
  if (!result || typeof result !== 'object') return null
  const r = result as Record<string, unknown>
  const state = clean(r.estadoActual)
  if (!state) return null
  const seen = new Set<string>()
  const events: ShipmentTracking['events'] = []
  for (const m of Array.isArray(r.movimientos) ? (r.movimientos as Record<string, unknown>[]) : []) {
    const at = clean(m?.fecha)
    const text = clean(m?.movimiento)
    if (!at || !text || seen.has(`${at}|${text}`)) continue
    seen.add(`${at}|${text}`)
    events.push({ at, text, place: clean(m.ubicacion) })
  }
  return {
    state,
    from: clean((r.remitente as Record<string, unknown> | undefined)?.ciudad),
    to: clean((r.destinatario as Record<string, unknown> | undefined)?.ciudad),
    eta: clean(r.fechaEstimadaEntrega),
    // Servientrega lists them oldest first.
    events: events.reverse(),
    checkedAt
  }
}

const text = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '')

/**
 * Checks and tidies what the form sends. Null when something required is missing: the
 * name, or the carrier of a shipment that comes through a forwarder.
 */
export function cleanShipment(input: unknown): ShipmentInput | null {
  if (!input || typeof input !== 'object') return null
  const x = input as Record<string, unknown>
  const title = text(x.title, 200)
  const store = text(x.store, 40)
  const forwarder = text(x.forwarder, 40) || null
  const carrier = text(x.carrier, 40) || null
  // Numbers are often copied with spaces or dashes between groups.
  const tracking = text(x.tracking, 80).replace(/[^A-Za-z0-9]/g, '').toUpperCase() || null
  const status = SHIPMENT_STATUSES.find((s) => s === x.status)
  const asin = typeof x.asin === 'string' && /^[A-Z0-9]{10}$/.test(x.asin) ? x.asin : null
  if (!title || !status || (forwarder && !carrier)) return null
  return { asin, title, store, forwarder, carrier, tracking, status }
}
