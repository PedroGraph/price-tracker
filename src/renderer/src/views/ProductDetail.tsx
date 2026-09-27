import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUpRight } from 'lucide-react'
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { priceWithCoupon, thresholdInUsd } from '@shared/pricing'
import type { PriceReading, Product, Threshold, ThresholdUnit, TrackerEvent } from '@shared/types'
import type { Notify } from '../App'
import { useMoney } from '../money'
import { ChangePill, Segmented, Thumb, timeAgo, Toggle } from '../ui'

const EVENT_LABEL: Record<TrackerEvent['type'], string> = {
  price_down: 'Price dropped',
  price_up: 'Price went up',
  out_of_stock: 'Out of stock',
  back_in_stock: 'Back in stock',
  tracking_started: 'Tracking started',
  target_reached: 'Target price reached',
  all_time_low: 'New all-time low',
  coupon_added: 'Coupon available',
  deal_started: 'Deal started'
}

export const UNITS: { value: ThresholdUnit; label: string }[] = [
  { value: 'percent', label: '%' },
  { value: 'USD', label: 'USD' },
  { value: 'COP', label: 'COP' }
]

const run = (iso: string): string => iso.slice(0, 16)

export function ProductDetail({
  product,
  globalThreshold,
  onChanged,
  notify,
  onRemoved
}: {
  product: Product | undefined
  globalThreshold: Threshold
  onChanged: () => void
  notify: Notify
  onRemoved: () => void
}) {
  const { rate, fmt, toDisplay, fromDisplay, currency } = useMoney()
  const [history, setHistory] = useState<PriceReading[]>([])
  const [events, setEvents] = useState<TrackerEvent[]>([])
  const [asTable, setAsTable] = useState(false)
  const [threshold, setThreshold] = useState<Threshold>(product?.threshold ?? globalThreshold)
  // Typed in the display currency, stored in USD.
  const [target, setTarget] = useState<string>(
    product?.targetPrice != null ? String(Math.round(toDisplay(product.targetPrice) * 100) / 100) : ''
  )
  const saveTimer = useRef<number | undefined>(undefined)

  useEffect(() => {
    if (!product) return
    void window.api.getHistory(product.asin).then(setHistory)
    void window.api.getEvents(product.asin).then(setEvents)
  }, [product?.asin, product?.lastCheckedAt])

  // One point per check: the tracked (cheapest) price of that run.
  const points = useMemo(() => {
    const byRun = new Map<string, { t: number; usd: number }>()
    for (const r of history) {
      if (r.price === null) continue
      const cur = byRun.get(run(r.checkedAt))
      if (!cur || r.price < cur.usd) byRun.set(run(r.checkedAt), { t: Date.parse(r.checkedAt), usd: r.price })
    }
    return [...byRun.values()].sort((a, b) => a.t - b.t).map((p) => ({ ...p, v: toDisplay(p.usd) }))
  }, [history, toDisplay])

  if (!product) return <p className="muted">This product is no longer tracked.</p>

  const base = product.basePrice
  const limit = base !== null ? thresholdInUsd(threshold, base, rate) : null
  const lower = base !== null && limit !== null ? base - limit : null
  const upper = base !== null && limit !== null ? base + limit : null
  // Under two days of data, label the axis with times instead of repeated dates.
  const shortSpan = points.length > 1 && points.at(-1)!.t - points[0].t < 2 * 86_400_000
  const days = points.length ? Math.max(1, Math.ceil((Date.now() - points[0].t) / 86_400_000)) : 0

  const lastOfferRun = history.filter((r) => r.source === 'offer').at(-1)?.checkedAt
  const offers = lastOfferRun
    ? history.filter((r) => r.source === 'offer' && run(r.checkedAt) === run(lastOfferRun)).sort((a, b) => (a.price ?? 0) - (b.price ?? 0))
    : []

  const saveThreshold = (t: Threshold): void => {
    setThreshold(t)
    clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(async () => {
      if (!(t.value > 0)) return
      await window.api.setProductOptions(product.asin, { threshold: t })
      onChanged()
      notify('Threshold saved for this product.')
    }, 700)
  }

  const resetThreshold = async (): Promise<void> => {
    clearTimeout(saveTimer.current)
    setThreshold(globalThreshold)
    await window.api.setProductOptions(product.asin, { threshold: null })
    onChanged()
    notify('Using the global threshold again.')
  }

  const saveTarget = async (): Promise<void> => {
    const value = target.trim() === '' ? null : fromDisplay(Number(target))
    if (value !== null && !(value > 0)) return notify('Enter a price above zero.', true)
    await window.api.setProductOptions(product.asin, { targetPrice: value === null ? null : Math.round(value * 100) / 100 })
    onChanged()
    notify(value === null ? 'Target price removed.' : `You'll get an alert at ${fmt(value)} or less.`)
  }

  const toggleOffers = async (on: boolean): Promise<void> => {
    await window.api.setProductOptions(product.asin, { trackOffers: on })
    onChanged()
    notify(on ? 'Other sellers will be checked on the next run.' : 'Tracking the Amazon price only.')
  }

  const values = points.map((p) => p.v)
  const refs = [base, lower, upper].filter((v): v is number => v !== null).map(toDisplay)
  const lo = Math.min(...values, ...refs)
  const hi = Math.max(...values, ...refs)
  const pad = (hi - lo) * 0.08 || hi * 0.02 || 1

  return (
    <div className="detail">
      <div className="col">
        <div className="title-row">
          <Thumb src={product.image} large />
          <div>
            <h2>{product.title}</h2>
            <div className="row">
              <a href={product.url} target="_blank" rel="noreferrer">
                Open on Amazon <ArrowUpRight size={14} />
              </a>
              {product.source === 'manual' && (
                <button
                  className="btn link"
                  onClick={() =>
                    void window.api.removeProduct(product.asin).then(() => {
                      notify('Stopped tracking. The price history is kept.')
                      onRemoved()
                    })
                  }
                >
                  Stop tracking
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="card current">
          <label>Current price</label>
          <div className="priceline">
            <span className="big">{fmt(product.lastPrice)}</span>
            <ChangePill from={base} to={product.lastPrice} suffix=" from base price" />
          </div>
          <div className="base-row">
            <span className="muted">Base price </span>
            <strong>{fmt(base)}</strong> · set {timeAgo(product.baseSince)}
            {product.lastShipping ? <> · + {fmt(product.lastShipping)} shipping (not counted)</> : null}
            {product.lastSeller && <> · {product.lastSeller}</>}
          </div>
          {(product.coupon || product.deal) && (
            <div className="promos">
              {product.deal && <span className="badge deal">{product.deal}</span>}
              {product.coupon && (
                <span className="badge good">
                  {product.coupon}
                  {priceWithCoupon(product.lastPrice, product.coupon) !== null && (
                    <> · ≈ {fmt(priceWithCoupon(product.lastPrice, product.coupon))} with coupon</>
                  )}
                </span>
              )}
            </div>
          )}
          <div className="base-row">
            <span className="muted">Lowest </span>
            <strong>{fmt(product.lowestPrice)}</strong> ever · {fmt(product.lowest30)} in 30 days
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <h3>
              Price history{days ? ` · last ${days} day${days === 1 ? '' : 's'}` : ''}
            </h3>
            <button className="btn" onClick={() => setAsTable(!asTable)}>
              {asTable ? 'View as chart' : 'View as table'}
            </button>
          </div>
          {asTable ? (
            <div className="table-scroll">
              <table className="readings">
                <thead>
                  <tr>
                    <th>Checked</th>
                    <th>Seller</th>
                    <th className="num">Price</th>
                    <th className="num">Shipping</th>
                  </tr>
                </thead>
                <tbody>
                  {[...history].reverse().map((r) => (
                    <tr key={r.id}>
                      <td>{new Date(r.checkedAt).toLocaleString()}</td>
                      <td>{r.source === 'buybox' ? r.seller ?? 'Amazon price' : r.seller}</td>
                      <td className="num">{r.available ? fmt(r.price) : 'Unavailable'}</td>
                      <td className="num">{r.shipping ? fmt(r.shipping) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : points.length < 2 ? (
            <p className="muted">The chart appears after two checks. Every check is saved, even when the price doesn't change.</p>
          ) : (
            <>
              <div className="legend">
                <span>
                  <i style={{ borderColor: 'var(--teal)' }} />
                  Price
                </span>
                <span>
                  <i className="dash" style={{ borderColor: 'var(--faint)' }} />
                  Base price
                </span>
                <span>
                  <i className="dash" style={{ borderColor: 'var(--amber)' }} />
                  Alert threshold
                </span>
              </div>
              <ResponsiveContainer width="100%" height={280}>
                <AreaChart data={points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="fill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--teal)" stopOpacity={0.22} />
                      <stop offset="100%" stopColor="var(--teal)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} stroke="var(--line)" />
                  <XAxis
                    dataKey="t"
                    type="number"
                    scale="time"
                    domain={['dataMin', 'dataMax']}
                    tickFormatter={(t) =>
                      shortSpan
                        ? new Date(t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
                        : new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
                    }
                    stroke="var(--faint)"
                    tickLine={false}
                    axisLine={false}
                    fontSize={12}
                  />
                  <YAxis
                    domain={[lo - pad, hi + pad]}
                    tickFormatter={(v) => fmt(v / (toDisplay(1) || 1))}
                    stroke="var(--faint)"
                    tickLine={false}
                    axisLine={false}
                    width={96}
                    fontSize={12}
                  />
                  <Tooltip
                    labelFormatter={(t) => new Date(t as number).toLocaleString()}
                    formatter={(_v, _n, item) => [fmt((item.payload as { usd: number }).usd), 'Price']}
                    contentStyle={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 10 }}
                  />
                  {base !== null && <ReferenceLine y={toDisplay(base)} stroke="var(--faint)" strokeDasharray="5 5" />}
                  {lower !== null && <ReferenceLine y={toDisplay(lower)} stroke="var(--amber)" strokeDasharray="5 5" />}
                  {upper !== null && <ReferenceLine y={toDisplay(upper)} stroke="var(--amber)" strokeDasharray="5 5" />}
                  <Area
                    type="monotone"
                    dataKey="v"
                    stroke="var(--teal)"
                    strokeWidth={2}
                    fill="url(#fill)"
                    dot={false}
                    activeDot={{ r: 4 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </>
          )}
        </div>

        <div className="card">
          <h3>Activity</h3>
          {events.length === 0 && <p className="sub">Nothing yet.</p>}
          <ul className="events">
            {events.slice(0, 12).map((e) => (
              <li key={e.id}>
                <time>{new Date(e.createdAt).toLocaleString()}</time>
                <span>
                  {EVENT_LABEL[e.type]}
                  {e.type === 'tracking_started' && <> at {fmt(e.newPrice)}</>}
                  {(e.type === 'target_reached' || e.type === 'all_time_low') && <> at {fmt(e.newPrice)}</>}
                  {(e.type === 'price_up' || e.type === 'price_down') && (
                    <>
                      {' '}
                      {fmt(e.oldPrice)} → {fmt(e.newPrice)}
                    </>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="col">
        <div className="card">
          <h3>Alert threshold for this product</h3>
          <div style={{ marginTop: 14 }}>
            <Segmented options={UNITS} value={threshold.unit} onChange={(unit) => saveThreshold({ ...threshold, unit })} />
          </div>
          <label className="field-label">Threshold value</label>
          <input
            className="short mono"
            type="number"
            min={0}
            step="any"
            value={threshold.value}
            onChange={(e) => saveThreshold({ ...threshold, value: Number(e.target.value) })}
          />
          <p className="explain">
            {lower !== null && upper !== null && limit !== null ? (
              <>
                An alert is sent if the price drops below <b>{fmt(lower)}</b> or rises above <b>{fmt(upper)}</b> (±{fmt(limit)} from
                the base price).
              </>
            ) : threshold.unit === 'COP' && !rate ? (
              'A COP threshold needs an exchange rate. Check Settings.'
            ) : (
              'The range appears after the first check.'
            )}
          </p>
          <p className="explain">
            {product.threshold ? (
              <button className="btn link" onClick={() => void resetThreshold()}>
                Reset to the global threshold
              </button>
            ) : (
              <span className="faint">Using the global threshold.</span>
            )}
          </p>
        </div>

        <div className="card">
          <h3>Target price</h3>
          <p className="sub">Get one alert when the price drops to this amount or below.</p>
          <div className="row" style={{ marginTop: 14 }}>
            <input
              className="short mono"
              type="number"
              min={0}
              step="any"
              placeholder={currency === 'COP' ? 'e.g. 3500000' : 'e.g. 950'}
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void saveTarget()}
            />
            <span className="muted">{currency}</span>
            <button className="btn" onClick={() => void saveTarget()}>
              Save
            </button>
            {product.targetPrice !== null && (
              <button
                className="btn link"
                onClick={() => {
                  setTarget('')
                  void window.api.setProductOptions(product.asin, { targetPrice: null }).then(() => {
                    onChanged()
                    notify('Target price removed.')
                  })
                }}
              >
                Remove
              </button>
            )}
          </div>
          {product.targetPrice !== null && product.lastPrice !== null && (
            <p className="explain">
              {product.lastPrice <= product.targetPrice ? (
                <b>The current price is at or below your target.</b>
              ) : (
                <>
                  <b>{fmt(product.lastPrice - product.targetPrice)}</b> to go until {fmt(product.targetPrice)}.
                </>
              )}
            </p>
          )}
        </div>

        <div className="card">
          <div className="row">
            <div style={{ flex: 1 }}>
              <h3>Track other sellers</h3>
              <p className="sub">Follows the cheapest offer for this product among all Amazon sellers.</p>
            </div>
            <Toggle on={product.trackOffers} onChange={(on) => void toggleOffers(on)} label="Track other sellers" />
          </div>
          {product.trackOffers && offers.length === 0 && <p className="explain">Sellers appear after the next check.</p>}
          {product.trackOffers && offers.length > 0 && (
            <div className="offers">
              {offers.map((o, i) => (
                <div key={o.id} className={i === 0 ? 'offer best' : 'offer'}>
                  <div>
                    <strong>{o.seller}</strong>
                    <small>
                      {[o.condition, o.shipping ? `+ ${fmt(o.shipping)} shipping` : o.shipping === 0 ? 'Free shipping' : null]
                        .filter(Boolean)
                        .join(' · ') || '—'}
                    </small>
                  </div>
                  {i === 0 && <span className="best-tag">BEST PRICE</span>}
                  <span className="price">{fmt(o.price)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="note">
          Every check saves the price, even when it doesn't change. When the price moves further from the base price than this
          threshold, an email alert is sent and that price becomes the new base price. Shipping is never part of the price.
        </div>
      </div>
    </div>
  )
}
