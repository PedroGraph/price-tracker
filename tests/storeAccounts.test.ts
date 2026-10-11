// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import * as db from '../src/main/db'
import { extractOrders } from '../src/main/scraper/extractors'
import { amazonPackages, carrierFromName, cleanShipment, parseEncargomioList, parseEncargomioTrack, statusFromCarrier } from '../src/shared/shipping'

describe('Amazon orders page (synthetic markup)', () => {
  it('reads each shipment of an order with its items', () => {
    document.body.innerHTML = `<label id="time-filter"></label>
      <div class="order-card js-order-card"><div class="yohtmlc-order-id">Pedido n.º 111-1111111-1111111</div>
        <div class="delivery-box"><span class="delivery-box__primary-text"> Llega  mañana </span><span class="delivery-box__secondary-text">Enviado</span>
          <div class="item-box"><div class="yohtmlc-product-title"><a href="/dp/B0G1V4HFP4?ref=x">Tapo camera</a></div></div>
          <div class="item-box"><a href="/dp/B000000002"><img></a><div class="yohtmlc-product-title">Cable</div></div></div>
        <div class="delivery-box"><span class="delivery-box__primary-text">Entregado el 3 de octubre</span></div></div>`
    const page = extractOrders()
    expect([page.found, page.loggedOut]).toEqual([true, false])
    expect(page.boxes).toEqual([
      { orderId: '111-1111111-1111111', status: 'Llega mañana', detail: 'Enviado', items: [{ asin: 'B0G1V4HFP4', title: 'Tapo camera' }, { asin: 'B000000002', title: 'Cable' }] },
      { orderId: '111-1111111-1111111', status: 'Entregado el 3 de octubre', detail: null, items: [] }
    ])
  })

  it('tells an empty list from a page that is not the orders page, and from the sign-in form', () => {
    document.body.innerHTML = '<label id="time-filter"></label>'
    expect(extractOrders()).toMatchObject({ found: true, boxes: [] })
    document.body.innerHTML = '<form name="signIn"></form>'
    expect(extractOrders()).toMatchObject({ found: false, loggedOut: true })
  })
})

describe('Amazon orders as packages', () => {
  const box = (orderId: string, status: string, detail: string | null = null, titles = ['Tapo camera']) => ({
    orderId,
    status,
    detail,
    items: titles.map((title, i) => ({ asin: i === 0 ? 'B0G1V4HFP4' : null, title }))
  })

  it('turns each shipment of an order into a package', () => {
    const [a, b, c] = amazonPackages([
      box('111-1111111-1111111', 'Llega mañana', 'Enviado', ['Tapo camera', 'Cable']),
      box('111-1111111-1111111', 'Entregado el 3 de octubre'),
      box('222-2222222-2222222', 'Canceladas')
    ])
    expect(a).toMatchObject({ id: '111-1111111-1111111#1', title: 'Tapo camera (+1)', state: 'Llega mañana', delivered: false, closed: false, asin: 'B0G1V4HFP4' })
    expect(a.events).toEqual([{ at: '', text: 'Enviado', place: null }])
    expect([b.id, b.delivered]).toEqual(['111-1111111-1111111#2', true])
    expect(c.closed).toBe(true)
    expect(statusFromCarrier('Not yet shipped')).toBe('ordered')
  })

  it('skips boxes without an order or a status', () => {
    expect(amazonPackages([{ orderId: null, status: 'x', detail: null, items: [] }, box('333-3333333-3333333', ' ')])).toEqual([])
  })
})

describe('Encargomio', () => {
  const row = (over: Record<string, unknown>) => ({
    shipping_order: 108241,
    status_id: 5,
    status_name: 'Enviado',
    international_conveyor: 'Servientrega nuevo',
    international_guide_number: '2299075309',
    national_conveyor: null,
    national_guide_number: null,
    shipping_address: { user_name: 'Someone', address: 'Somewhere 1' },
    products: [{ name: 'Tapo 2K Outdoor Camera', store_link: 'https://www.amazon.com/dp/B0G1V4HFP4' }],
    ...over
  })
  const list = (rows: unknown[]) => ({ statusCode: 200, data: { data: rows, meta: { total: rows.length } } })

  it('reads the carrier and tracking number, and where it was bought', () => {
    const [p] = parseEncargomioList(list([row({})]))!
    expect(p).toMatchObject({
      id: '108241',
      title: 'Tapo 2K Outdoor Camera',
      tracking: '2299075309',
      state: 'Enviado',
      delivered: false,
      closed: false,
      asin: 'B0G1V4HFP4',
      store: 'Amazon',
      forwarder: 'Encargomio',
      trackPage: 'https://www.encargomio.com/shipments/108241/tracking'
    })
    expect(carrierFromName(p.carrier)).toBe('servientrega')
    expect(p.status).toBeUndefined()
  })

  it('prefers the national leg, and knows what is not sent, delivered or cancelled', () => {
    const [national, packing, done, cancelled] = parseEncargomioList(
      list([
        row({ national_conveyor: 'Coordinadora', national_guide_number: 'C1' }),
        row({ shipping_order: 2, status_id: 1, status_name: 'Por empacar' }),
        row({ shipping_order: 3, status_id: 9, status_name: 'Entregado' }),
        row({ shipping_order: 4, status_id: 6, status_name: 'Cancelado' })
      ])
    )!
    expect([national.carrier, national.tracking]).toEqual(['Coordinadora', 'C1'])
    expect(packing.status).toBe('ordered')
    expect(done.delivered).toBe(true)
    expect(cancelled.closed).toBe(true)
  })

  it('leaves the address out and rejects other answers', () => {
    expect(JSON.stringify(parseEncargomioList(list([row({})])))).not.toMatch(/Someone|Somewhere/)
    expect(parseEncargomioList({ statusCode: 401, message: 'Unauthorized' })).toBeNull()
  })

  it('reads the movements day by day', () => {
    const track = {
      data: {
        tracking_days: [
          { date_label: 'Sábado, 10 de octubre', events: [{ time: '4:16 AM', description: 'Data in last mile operator', location: 'BOGOTA' }] },
          { date_label: 'Viernes, 9 de octubre', events: [{ time: '10:19 PM', description: 'Guia generada', location: null }] }
        ]
      }
    }
    expect(parseEncargomioTrack(track)).toEqual([
      { at: 'Sábado, 10 de octubre, 4:16 AM', text: 'Data in last mile operator', place: 'BOGOTA' },
      { at: 'Viernes, 9 de octubre, 10:19 PM', text: 'Guia generada', place: null }
    ])
    expect(parseEncargomioTrack({ data: {} })).toBeNull()
  })
})

describe('a shipment added by hand that a store account also lists', () => {
  beforeEach(() => db.openDb(':memory:'))

  it('is found by its tracking number and handed over', () => {
    const input = cleanShipment({ asin: null, title: 'Tapo', store: 'Amazon', forwarder: 'Encargomio', carrier: 'servientrega', tracking: '2299075309', status: 'ordered' })!
    db.saveShipment(null, input)
    const mine = db.findManualByTracking('2299075309')!
    db.adoptShipment(mine.id, 'encargomio', '108241')
    expect(db.findManualByTracking('2299075309')).toBeNull()
    expect(db.findImported('encargomio', '108241')?.id).toBe(mine.id)
    expect(db.listShipments()).toHaveLength(1)
  })
})
