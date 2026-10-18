import { beforeEach, describe, expect, it } from 'vitest'
import * as db from '../src/main/db'
import { CARRIERS, carrierFromName, cleanShipment, parseServientrega, parseTemuOrders, parseTemuTrack, statusFromCarrier, STORES, trackingLink, universalLink, temuStateFromTrack } from '../src/shared/shipping'
import { isAllowedExternal } from '../src/shared/urls'

const base = { asin: null, title: ' Audífonos  Sony ', store: 'Temu', forwarder: null, carrier: null, tracking: null, status: 'ordered' }

describe('cleanShipment', () => {
  it('tidies the texts and the tracking number', () => {
    expect(cleanShipment({ ...base, carrier: 'servientrega', tracking: ' 2145-887 301 ' })).toEqual({
      ...base,
      title: 'Audífonos Sony',
      carrier: 'servientrega',
      tracking: '2145887301'
    })
  })

  it('needs a name and a known status; the store is optional', () => {
    expect(cleanShipment({ ...base, title: ' ' })).toBeNull()
    expect(cleanShipment({ ...base, store: '' })?.store).toBe('')
    expect(cleanShipment({ ...base, status: 'lost' })).toBeNull()
    expect(cleanShipment(null)).toBeNull()
  })

  it('needs the carrier when it comes through a forwarder', () => {
    expect(cleanShipment({ ...base, forwarder: 'Encargomio' })).toBeNull()
    expect(cleanShipment({ ...base, forwarder: 'Encargomio', carrier: 'servientrega' })?.forwarder).toBe('Encargomio')
  })

  it('drops a product id that is not an ASIN', () => {
    expect(cleanShipment({ ...base, asin: 'nope' })?.asin).toBeNull()
    expect(cleanShipment({ ...base, asin: 'B0CTR557NJ' })?.asin).toBe('B0CTR557NJ')
  })
})

describe('tracking links', () => {
  it('opens the number directly where the carrier has such a link', () => {
    expect(trackingLink('ups', '1Z999')).toEqual({ url: 'https://www.ups.com/track?tracknum=1Z999', direct: true })
  })

  it('falls back to the tracking page, and to nothing for unknown carriers', () => {
    expect(trackingLink('coordinadora', '2145887301')).toEqual({ url: 'https://coordinadora.com/', direct: false })
    expect(trackingLink('ups', null)?.direct).toBe(false)
    expect(trackingLink('Mensajeros del barrio', '123')).toBeNull()
    expect(trackingLink(null, '123')).toBeNull()
  })

  it('only uses pages the app is allowed to open', () => {
    const urls = [...STORES.map((s) => s.orders), ...CARRIERS.flatMap((c) => [c.page, c.link?.('X1') ?? c.page]), universalLink('X1', 'es')]
    for (const url of urls) expect(isAllowedExternal(url), url).toBe(true)
  })
})

describe('reading Servientrega', () => {
  const move = (fecha: string, movimiento: string) => ({ fecha, movimiento, ubicacion: 'Bogota (Cundinamarca)' })
  const answer = {
    Results: [
      {
        estadoActual: 'EN ALISTAMIENTO DEL CLIENTE',
        fechaEstimadaEntrega: '',
        remitente: { ciudad: 'Bogota', nombreRemitente: 'Someone', direccion: 'Somewhere 1' },
        destinatario: { ciudad: 'Cartagena', nombreDestinatario: 'Someone Else', direccion: 'Somewhere 2' },
        movimientos: [move('09/10/2026 22:19 ', 'Guia generada'), move('09/10/2026 22:19 ', 'Guia generada'), move('09/10/2026 23:16 ', 'Alistamiento cliente')]
      }
    ]
  }

  it('keeps the state, the cities and each movement once, newest first', () => {
    const live = parseServientrega(answer, '2026-10-10T00:00:00.000Z')!
    expect(live.state).toBe('EN ALISTAMIENTO DEL CLIENTE')
    expect([live.from, live.to, live.eta]).toEqual(['Bogota', 'Cartagena', null])
    expect(live.events.map((e) => e.text)).toEqual(['Alistamiento cliente', 'Guia generada'])
    expect(live.events[0]).toEqual({ at: '09/10/2026 23:16', text: 'Alistamiento cliente', place: 'Bogota (Cundinamarca)' })
  })

  it('leaves names and addresses out', () => {
    expect(JSON.stringify(parseServientrega(answer, ''))).not.toMatch(/Someone|Somewhere/)
  })

  it('is null when the answer is not a shipment', () => {
    expect(parseServientrega({ Results: [1] }, '')).toBeNull()
    expect(parseServientrega({}, '')).toBeNull()
    expect(parseServientrega(null, '')).toBeNull()
  })

  it('turns the carrier wording into a status', () => {
    expect(statusFromCarrier('EN ALISTAMIENTO DEL CLIENTE')).toBe('ordered')
    expect(statusFromCarrier('EN PROCESAMIENTO')).toBe('transit')
    expect(statusFromCarrier('EN ZONA DE DISTRIBUCION')).toBe('delivering')
    expect(statusFromCarrier('ENTREGADO')).toBe('delivered')
    expect(statusFromCarrier('DEVOLUCION AL REMITENTE')).toBe('transit')
  })
})

describe('reading Temu orders', () => {
  const pack = (over: Record<string, unknown>) => ({
    package_sn: 'PK-1',
    display_total_items_number: 2,
    goods_volist: [{ goods_name: ' Soporte para laptop ' }, { goods_name: 'Cable' }],
    order_package_status_desc: 'Despacho de aduana',
    expect_delivery_time_range: '23-45 días hábiles (24 sept-26 oct)',
    is_delivered: false,
    way_bill_sn: 'JTC000111',
    logistics_providers_name: 'J&T express',
    package_detail_jump_url: 'bgst_express.html?parent_order_sn=PO-1&package_sn=PK-1&transport_method=1',
    ...over
  })
  const list = {
    view_orders: [
      { address_info: { name: 'Someone', address: 'Somewhere 1' }, shipping_module: { package_list: [pack({}), pack({ package_sn: 'PK-2', is_delivered: true, order_package_status_desc: 'Entregado', display_total_items_number: 1, logistics_providers_name: 'Coordinadora', package_detail_jump_url: 'https://evil.example/x' })] } },
      { shipping_module: null }
    ]
  }

  it('reads each package with its state, carrier and tracking number', () => {
    const [a, b] = parseTemuOrders(list)!
    expect(a).toEqual({
      id: 'PK-1',
      title: 'Soporte para laptop (+1)',
      carrier: 'J&T express',
      tracking: 'JTC000111',
      state: 'Despacho de aduana',
      eta: '23-45 días hábiles (24 sept-26 oct)',
      delivered: false,
      trackPage: 'https://www.temu.com/bgst_express.html?parent_order_sn=PO-1&package_sn=PK-1&transport_method=1'
    })
    expect(b.trackPage).toBeNull()
    expect(parseTemuTrack([{ operatorTimeStr: '9 octubre 2026, 4:03 pm', trackDesc: ' Despacho de aduana completo ', status: 'En tránsito' }, { status: 'Enviado' }, {}])).toEqual([
      { at: '9 octubre 2026, 4:03 pm', text: 'Despacho de aduana completo', place: null },
      { at: '', text: 'Enviado', place: null }
    ])
    expect(parseTemuTrack(undefined)).toBeNull()
    expect([b.title, b.delivered, carrierFromName(b.carrier)]).toEqual(['Soporte para laptop', true, 'coordinadora'])
    expect(statusFromCarrier(a.state)).toBe('customs')
  })

  it('leaves the address out and rejects other answers', () => {
    expect(JSON.stringify(parseTemuOrders(list))).not.toMatch(/Someone|Somewhere/)
    expect(parseTemuOrders({ error_code: 40001 })).toBeNull()
    expect(parseTemuOrders({ view_orders: [] })).toEqual([])
  })

  it('accepts wrapped order responses and alternate Temu field names', () => {
    const result = parseTemuOrders({ data: { orders: [{ package_list: [{ packageSn: 'PK-W', product_name: 'Wrapped item', tracking_number: 'T-1', package_status_desc: 'En aduana', isDelivered: false }] }] } })!
    expect(result[0]).toMatchObject({ id: 'PK-W', title: 'Wrapped item', tracking: 'T-1', state: 'En aduana' })
    expect(statusFromCarrier(result[0].state)).toBe('customs')
  })

  it('accepts wrapped Temu tracking responses', () => {
    expect(parseTemuTrack({ data: { logisticsTrackInfo: { trackNodeVOList: [{ operator_time_str: 'today', track_desc: 'En aduana', location: 'Bogotá' }] } } })).toEqual([
      { at: 'today', text: 'En aduana', place: 'Bogotá' }
    ])
  })

  it('lets the newest tracking event override a stale order-list state', () => {
    const events = parseTemuTrack([{ operatorTimeStr: '15 octubre 2026, 12:52 pm', trackDesc: '¡Envío entregado!' }])!
    expect(temuStateFromTrack(events)).toEqual({ state: '¡Envío entregado!', delivered: true })
    expect(temuStateFromTrack(parseTemuTrack([{ trackDesc: 'Despacho de aduana' }])!)).toEqual({ state: 'Despacho de aduana', delivered: false })
  })
})

describe('shipments read from a store', () => {
  beforeEach(() => db.openDb(':memory:'))

  it('are found by the store id and stay hidden once removed', () => {
    const id = db.addImported('temu', 'PK-1', { asin: null, title: 'Soporte', store: 'Temu', forwarder: null, carrier: null, tracking: null, status: 'transit' })
    db.setImportedRoute(id, 'coordinadora', 'C123')
    expect(db.findImported('temu', 'PK-1')).toMatchObject({ id, source: 'temu', carrier: 'coordinadora', tracking: 'C123', hidden: false })
    expect(db.findImported('temu', 'PK-9')).toBeNull()

    db.removeShipment(id)
    expect(db.listShipments()).toEqual([])
    expect(db.findImported('temu', 'PK-1')?.hidden).toBe(true)
  })

  it('refreshes a stale status even when the tracking state text is unchanged', () => {
    const id = db.addImported('temu', 'PK-2', { asin: null, title: 'Aduana', store: 'Temu', forwarder: null, carrier: null, tracking: null, status: 'transit' })
    const live = { state: 'Despacho de aduana', from: null, to: null, eta: null, events: [], checkedAt: '' }
    db.setShipmentLive(id, live, 'customs')
    expect(db.listShipments().find((s) => s.id === id)?.status).toBe('customs')
  })
})

describe('shipments in the database', () => {
  beforeEach(() => db.openDb(':memory:'))
  const input = cleanShipment({ ...base, forwarder: 'Encargomio', carrier: 'servientrega' })!

  it('lists the one that changed last first, and keeps its news for the bell', async () => {
    db.saveShipment(null, input)
    db.saveShipment(null, { ...input, title: 'Second' })
    const older = db.listShipments().find((s) => s.title !== 'Second')!
    const live = (state: string, text: string) => ({ state, from: null, to: null, eta: null, events: [{ at: 'today', text, place: 'Bogota' }], checkedAt: '' })

    // The first read of a shipment added by hand fills it in without being news.
    db.setShipmentLive(older.id, live('GUIA GENERADA', 'Guia generada'), null)
    expect(db.listShipmentNotices()).toEqual([])

    await new Promise((r) => setTimeout(r, 5))
    db.setShipmentLive(older.id, live('GUIA GENERADA', 'Recogido'), null)
    db.setShipmentLive(older.id, live('GUIA GENERADA', 'Recogido'), null)
    expect(db.listShipments()[0].id).toBe(older.id)
    expect(db.listShipmentNotices()).toMatchObject([{ shipmentId: older.id, title: older.title, state: 'GUIA GENERADA', detail: 'Recogido · Bogota' }])

    // One that a store account brought is news from the start; removing a shipment takes its news along.
    const id = db.addImported('temu', 'PK-7', { ...input, title: 'From Temu' })
    db.setShipmentLive(id, live('Enviado', 'Salida'), null, true)
    expect(db.listShipmentNotices().map((n) => n.title)).toContain('From Temu')
    db.removeShipment(id)
    db.removeShipment(older.id)
    expect(db.listShipmentNotices()).toEqual([])
  })

  it('adds, updates and removes', () => {
    db.saveShipment(null, input)
    db.saveShipment(null, { ...input, title: 'Second' })
    const [second, first] = db.listShipments()
    expect([second.title, first.title]).toEqual(['Second', 'Audífonos Sony'])

    db.saveShipment(second.id, { ...input, title: 'Second', status: 'delivered' })
    expect(db.listShipments().find((s) => s.id === second.id)!.deliveredAt).not.toBeNull()

    db.saveShipment(second.id, { ...input, title: 'Second', status: 'transit' })
    expect(db.listShipments().find((s) => s.id === second.id)!.deliveredAt).toBeNull()

    // What the carrier said stays through edits, until the number changes.
    const live = { state: 'ENTREGADO', from: null, to: null, eta: null, events: [], checkedAt: '2026-10-10T00:00:00.000Z' }
    db.setShipmentLive(second.id, live, 'delivered')
    db.saveShipment(second.id, { ...input, title: 'Renamed', status: 'delivered' })
    const kept = db.listShipments().find((s) => s.id === second.id)!
    expect([kept.status, kept.live?.state]).toEqual(['delivered', 'ENTREGADO'])
    db.saveShipment(second.id, { ...input, title: 'Second', tracking: '999' })
    expect(db.listShipments().find((s) => s.id === second.id)!.live).toBeNull()

    db.removeShipment(first.id)
    expect(db.listShipments().map((s) => s.title)).toEqual(['Second'])
  })
})
