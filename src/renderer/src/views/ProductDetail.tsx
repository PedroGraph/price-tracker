import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUpRight } from 'lucide-react'
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { priceWithCoupon, thresholdInUsd } from '@shared/pricing'
import type { PriceReading, Product, Threshold, ThresholdUnit, TrackerEvent } from '@shared/types'
import type { Notify } from '../App'
import { useT } from '../i18n'
import { useMoney } from '../money'
import { ChangePill, Segmented, Thumb, timeAgo, Toggle } from '../ui'

// English keys, translated where shown.
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
  const { t, tn, locale } = useT()
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

  if (!product) return <p className="muted">{t('This product is no longer tracked.')}</p>

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

  const saveThreshold = (next: Threshold): void => {
    setThreshold(next)
    clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(async () => {
      if (!(next.value > 0)) return
      await window.api.setProductOptions(product.asin, { threshold: next })
      onChanged()
      notify(t('Threshold saved for this product.'))
    }, 700)
  }

  const resetThreshold = async (): Promise<void> => {
    clearTimeout(saveTimer.current)
    setThreshold(globalThreshold)
    await window.api.setProductOptions(product.asin, { threshold: null })
    onChanged()
    notify(t('Using the global threshold again.'))
  }

  const saveTarget = async (): Promise<void> => {
    const value = target.trim() === '' ? null : fromDisplay(Number(target))
    if (value !== null && !(value > 0)) return notify(t('Enter a price above zero.'), true)
    await window.api.setProductOptions(product.asin, { targetPrice: value === null ? null : Math.round(value * 100) / 100 })
    onChanged()
    notify(value === null ? t('Target price removed.') : t("You'll get an alert at {price} or less.", { price: fmt(value) }))
  }

  const toggleOffers = async (on: boolean): Promise<void> => {
    await window.api.setProductOptions(product.asin, { trackOffers: on })
    onChanged()
    notify(on ? t('Other sellers will be checked on the next run.') : t('Tracking the Amazon price only.'))
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
                {t('Open on Amazon')} <ArrowUpRight size={14} />
              </a>
              {product.source === 'manual' && (
                <button
                  className="btn link"
                  onClick={() =>
                    void window.api.removeProduct(product.asin).then(() => {
                      notify(t('Stopped tracking. The price history is kept.'))
                      onRemoved()
                    })
                  }
                >
                  {t('Stop tracking')}
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="card current">
          <label>{t('Current price')}</label>
          <div className="priceline">
            <span className="big">{fmt(product.lastPrice)}</span>
            <ChangePill from={base} to={product.lastPrice} suffix=" from base price" />
          </div>
          <div className="base-row">
            <span className="muted">{t('Base price')} </span>
            <strong>{fmt(base)}</strong> · {t('set {when}', { when: timeAgo(product.baseSince, t) })}
            {product.lastShipping ? <> · {t('+ {amount} shipping (not counted)', { amount: fmt(product.lastShipping) })}</> : null}
            {product.lastImportFees ? <> · {t('+ {amount} import fees (not counted)', { amount: fmt(product.lastImportFees) })}</> : null}
            {product.lastSeller && <> · {product.lastSeller}</>}
          </div>
          {(product.coupon || product.deal) && (
            <div className="promos">
              {product.deal && <span className="badge deal">{product.deal}</span>}
              {product.coupon && (
                <span className="badge good">
                  {product.coupon}
                  {priceWithCoupon(product.lastPrice, product.coupon) !== null && (
                    <> · {t('≈ {price} with coupon', { price: fmt(priceWithCoupon(product.lastPrice, product.coupon)) })}</>
                  )}
                </span>
              )}
            </div>
          )}
          {product.lastPrice !== null && (product.lastShipping || product.lastImportFees) ? (
            <div className="base-row">
              <span className="muted">{t('Delivered total')} </span>
              <strong>{fmt(product.lastPrice + (product.lastShipping ?? 0) + (product.lastImportFees ?? 0))}</strong>{' '}
              {t(product.lastImportFees ? 'with shipping and import fees' : 'with shipping')}
            </div>
          ) : null}
          <div className="base-row">
            <span className="muted">{t('Lowest')} </span>
            {tn('{ever} ever · {last30} in 30 days', { ever: <strong>{fmt(product.lowestPrice)}</strong>, last30: fmt(product.lowest30) })}
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <h3>
              {days ? t(days === 1 ? 'Price history · last {n} day' : 'Price history · last {n} days', { n: days }) : t('Price history')}
            </h3>
            <button
              className="btn"
              onClick={() =>
                void window.api.exportCsv(product.asin).then((path) => path && notify(t('Saved {path}', { path })))
              }
            >
              {t('Export CSV')}
            </button>
            <button className="btn" onClick={() => setAsTable(!asTable)}>
              {asTable ? t('View as chart') : t('View as table')}
            </button>
          </div>
          {asTable ? (
            <div className="table-scroll">
              <table className="readings">
                <thead>
                  <tr>
                    <th>{t('Checked')}</th>
                    <th>{t('Seller')}</th>
                    <th className="num">{t('Price')}</th>
                    <th className="num">{t('Shipping')}</th>
                  </tr>
                </thead>
                <tbody>
                  {[...history].reverse().map((r) => (
                    <tr key={r.id}>
                      <td>{new Date(r.checkedAt).toLocaleString(locale)}</td>
                      <td>{r.source === 'buybox' ? r.seller ?? t('Amazon price') : r.seller}</td>
                      <td className="num">{r.available ? fmt(r.price) : t('Unavailable')}</td>
                      <td className="num">{r.shipping ? fmt(r.shipping) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : points.length < 2 ? (
            <p className="muted">{t("The chart appears after two checks. Every check is saved, even when the price doesn't change.")}</p>
          ) : (
            <>
              <div className="legend">
                <span>
                  <i style={{ borderColor: 'var(--teal)' }} />
                  {t('Price')}
                </span>
                <span>
                  <i className="dash" style={{ borderColor: 'var(--faint)' }} />
                  {t('Base price')}
                </span>
                <span>
                  <i className="dash" style={{ borderColor: 'var(--amber)' }} />
                  {t('Alert threshold')}
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
                        ? new Date(t).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
                        : new Date(t).toLocaleDateString(locale, { month: 'short', day: 'numeric' })
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
                    labelFormatter={(v) => new Date(v as number).toLocaleString(locale)}
                    formatter={(_v, _n, item) => [fmt((item.payload as { usd: number }).usd), t('Price')]}
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
          <h3>{t('Activity')}</h3>
          {events.length === 0 && <p className="sub">{t('Nothing yet.')}</p>}
          <ul className="events">
            {events.slice(0, 12).map((e) => (
              <li key={e.id}>
                <time>{new Date(e.createdAt).toLocaleString(locale)}</time>
                <span>
                  {t(EVENT_LABEL[e.type])}
                  {(e.type === 'tracking_started' || e.type === 'target_reached' || e.type === 'all_time_low') && (
                    <> {t('at {price}', { price: fmt(e.newPrice) })}</>
                  )}
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
          <h3>{t('Alert threshold for this product')}</h3>
          <div style={{ marginTop: 14 }}>
            <Segmented options={UNITS} value={threshold.unit} onChange={(unit) => saveThreshold({ ...threshold, unit })} />
          </div>
          <label className="field-label">{t('Threshold value')}</label>
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
              tn('An alert is sent if the price drops below {lower} or rises above {upper} (±{limit} from the base price).', {
                lower: <b>{fmt(lower)}</b>,
                upper: <b>{fmt(upper)}</b>,
                limit: fmt(limit)
              })
            ) : threshold.unit === 'COP' && !rate ? (
              t('A COP threshold needs an exchange rate. Check Settings.')
            ) : (
              t('The range appears after the first check.')
            )}
          </p>
          <p className="explain">
            {product.threshold ? (
              <button className="btn link" onClick={() => void resetThreshold()}>
                {t('Reset to the global threshold')}
              </button>
            ) : (
              <span className="faint">{t('Using the global threshold.')}</span>
            )}
          </p>
        </div>

        <div className="card">
          <h3>{t('Target price')}</h3>
          <p className="sub">{t('Get one alert when the price drops to this amount or below.')}</p>
          <div className="row" style={{ marginTop: 14 }}>
            <input
              className="short mono"
              type="number"
              min={0}
              step="any"
              placeholder={t('e.g. {example}', { example: currency === 'COP' ? '3500000' : '950' })}
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void saveTarget()}
            />
            <span className="muted">{currency}</span>
            <button className="btn" onClick={() => void saveTarget()}>
              {t('Save')}
            </button>
            {product.targetPrice !== null && (
              <button
                className="btn link"
                onClick={() => {
                  setTarget('')
                  void window.api.setProductOptions(product.asin, { targetPrice: null }).then(() => {
                    onChanged()
                    notify(t('Target price removed.'))
                  })
                }}
              >
                {t('Remove')}
              </button>
            )}
          </div>
          {product.targetPrice !== null && product.lastPrice !== null && (
            <p className="explain">
              {product.lastPrice <= product.targetPrice ? (
                <b>{t('The current price is at or below your target.')}</b>
              ) : (
                tn('{gap} to go until {target}.', {
                  gap: <b>{fmt(product.lastPrice - product.targetPrice)}</b>,
                  target: fmt(product.targetPrice)
                })
              )}
            </p>
          )}
        </div>

        <div className="card">
          <div className="row">
            <div style={{ flex: 1 }}>
              <h3>{t('Track other sellers')}</h3>
              <p className="sub">{t('Follows the cheapest offer for this product among all Amazon sellers.')}</p>
            </div>
            <Toggle on={product.trackOffers} onChange={(on) => void toggleOffers(on)} label={t('Track other sellers')} />
          </div>
          {product.trackOffers && offers.length === 0 && <p className="explain">{t('Sellers appear after the next check.')}</p>}
          {product.trackOffers && offers.length > 0 && (
            <div className="offers">
              {offers.map((o, i) => (
                <div key={o.id} className={i === 0 ? 'offer best' : 'offer'}>
                  <div>
                    <strong>{o.seller}</strong>
                    <small>
                      {[o.condition, o.shipping ? t('+ {amount} shipping', { amount: fmt(o.shipping) }) : o.shipping === 0 ? t('Free shipping') : null]
                        .filter(Boolean)
                        .join(' · ') || '—'}
                    </small>
                  </div>
                  {i === 0 && <span className="best-tag">{t('BEST PRICE')}</span>}
                  <span className="price">{fmt(o.price)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="note">
          {t(
            "Every check saves the price, even when it doesn't change. When the price moves further from the base price than this threshold, an alert is sent and that price becomes the new base price. Shipping is never part of the price."
          )}
        </div>
      </div>
    </div>
  )
}
