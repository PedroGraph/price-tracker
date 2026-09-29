import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUpRight } from 'lucide-react'
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { conditionGroup, offerUrl, priceWithCoupon, sellerUrl, thresholdInUsd } from '@shared/pricing'
import { priceInsights } from '@shared/insights'
import type { PriceReading, Product, ReviewsInfo, Threshold, TrackerEvent } from '@shared/types'
import type { Notify } from '../App'
import { useT } from '../i18n'
import { useMoney } from '../money'
import { BuySignal, ChangePill, EVENT_LABEL, Segmented, Sparkline, Thumb, timeAgo, Toggle, UNITS } from '../ui'



const run = (iso: string): string => iso.slice(0, 16)

const CONDITION_LABELS = { new: 'New', renewed: 'Renewed', used: 'Used' } as const

export function ProductDetail({
  product,
  globalThreshold,
  onChanged,
  notify,
  onRemoved,
  allTags
}: {
  allTags: string[]
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

  const insights = useMemo(
    () => priceInsights(points.map((p) => ({ price: p.usd, at: new Date(p.t).toISOString() }))),
    [points]
  )

  if (!product) return <p className="muted">{t('This product is no longer tracked.')}</p>

  const base = product.basePrice
  const limit = base !== null ? thresholdInUsd(threshold, base, rate) : null
  const lower = base !== null && limit !== null ? base - limit : null
  const upper = base !== null && limit !== null ? base + limit : null
  // Under two days of data, label the axis with times instead of repeated dates.
  const shortSpan = points.length > 1 && points.at(-1)!.t - points[0].t < 2 * 86_400_000
  const days = points.length ? Math.max(1, Math.ceil((Date.now() - points[0].t) / 86_400_000)) : 0

  // Every seller's price history, from the offer readings saved on each check.
  const offerReadings = history.filter((r) => r.source === 'offer' && r.price !== null)
  const lastOfferRun = offerReadings.at(-1)?.checkedAt
  const sellerKey = (r: PriceReading): string => r.sellerId ?? r.seller ?? '?'
  const bySeller = new Map<string, PriceReading[]>()
  for (const r of offerReadings) bySeller.set(sellerKey(r), [...(bySeller.get(sellerKey(r)) ?? []), r])
  const offers = lastOfferRun
    ? offerReadings
        .filter((r) => run(r.checkedAt) === run(lastOfferRun))
        .sort((a, b) => a.price! - b.price!)
        .map((r) => {
          const past = bySeller.get(sellerKey(r)) ?? []
          const previous = past.length > 1 ? past[past.length - 2].price : null
          return {
            ...r,
            previous,
            lowest: Math.min(...past.map((p) => p.price!)),
            spark: past.slice(-24).map((p) => p.price!)
          }
        })
    : []
  // Cheapest offer per condition (new, renewed, used) in the last sellers check.
  const byCondition = new Map<string, (typeof offers)[number]>()
  for (const o of offers) {
    const group = conditionGroup(o.condition)
    if (!byCondition.has(group)) byCondition.set(group, o)
  }
  const conditions = (['new', 'renewed', 'used'] as const).filter((c) => byCondition.has(c))

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
          <div style={{ marginTop: 10 }}>
            <BuySignal product={product} detailed />
          </div>
          <div className="base-row">
            <span className="muted">{t('Base price')} </span>
            <strong>{fmt(base)}</strong> · {t('set {when}', { when: timeAgo(product.baseSince, t) })}
            {product.lastShipping ? <> · {t('+ {amount} shipping (not counted)', { amount: fmt(product.lastShipping) })}</> : null}
            {product.lastImportFees ? <> · {t('+ {amount} import fees (not counted)', { amount: fmt(product.lastImportFees) })}</> : null}
            {product.lastSeller && (
              <>
                {' · '}
                <a className="inline" href={offerUrl(product.asin, product.lastSellerId)} target="_blank" rel="noreferrer">
                  {product.lastSeller} ↗
                </a>
              </>
            )}
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
          <h3>{t('What the history says')}</h3>
          {insights.spanDays < 7 ? (
            <p className="sub">{t('Patterns show up after a week of checks ({n} days so far).', { n: insights.spanDays })}</p>
          ) : (
            <ul className="insights">
              {insights.advice === 'wait' && (
                <li className="warn-text">{t('It drops often and is above its recent low: waiting may pay off.')}</li>
              )}
              {insights.advice === 'buy' && <li className="ok-text">{t('It is at its lowest price of the last 60 days.')}</li>}
              <li>
                {insights.drops60 === 0
                  ? t('No drops in the last 60 days.')
                  : t(insights.drops60 === 1 ? 'Dropped once in 60 days ({pct}% on average).' : 'Dropped {n} times in 60 days ({pct}% on average).', {
                      n: insights.drops60,
                      pct: insights.avgDropPct ?? 0
                    })}
              </li>
              {insights.cheapestWeekday !== null && (
                <li>
                  {t('Usually cheapest on {day} (about {pct}% under average).', {
                    day: new Date(2026, 0, 4 + insights.cheapestWeekday).toLocaleDateString(locale, { weekday: 'long' }),
                    pct: insights.cheapestWeekdayPct ?? 0
                  })}
                </li>
              )}
              {insights.trend && (
                <li>
                  {insights.trend === 'down'
                    ? t('Trending down over the last 2 weeks.')
                    : insights.trend === 'up'
                      ? t('Trending up over the last 2 weeks.')
                      : t('Steady over the last 2 weeks.')}
                </li>
              )}
            </ul>
          )}
        </div>

        <ReviewsCard product={product} />

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
                  {/* A price holds until the next check, so draw steps; a smooth curve invents prices in between. */}
                  <Area
                    type="stepAfter"
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

        <PurchaseCard product={product} onChanged={onChanged} notify={notify} />
        <TagsCard product={product} allTags={allTags} onChanged={onChanged} />

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
              <p className="sub">{t('Follows the cheapest offer for this product among all Amazon sellers, and compares new, renewed and used.')}</p>
            </div>
            <Toggle on={product.trackOffers} onChange={(on) => void toggleOffers(on)} label={t('Track other sellers')} />
          </div>
          {product.trackOffers && offers.length === 0 && <p className="explain">{t('Sellers appear after the next check.')}</p>}
          {product.trackOffers && product.resalePrice !== null && (
            <p className="explain">
              {t('Amazon Resale (returns inspected by Amazon): {price}', { price: fmt(product.resalePrice) })}
              {product.lastPrice !== null && product.resalePrice < product.lastPrice && (
                <strong className="ok-text"> · {t('{amount} less', { amount: fmt(product.lastPrice - product.resalePrice) })}</strong>
              )}
            </p>
          )}
          {conditions.length > 1 && (
            <div className="conditions">
              {conditions.map((c) => {
                const o = byCondition.get(c)!
                const cheapestNew = byCondition.get('new')?.price ?? null
                const diff = c !== 'new' && cheapestNew !== null ? o.price! - cheapestNew : null
                return (
                  <div key={c} className="condition">
                    <span className="muted">{t(CONDITION_LABELS[c])}</span>
                    <strong>{fmt(o.price)}</strong>
                    {diff !== null && diff < 0 && <small className="ok-text">{t('{amount} less than new', { amount: fmt(-diff) })}</small>}
                  </div>
                )
              })}
            </div>
          )}
          {product.trackOffers && offers.length > 0 && (
            <div className="offers">
              {offers.map((o, i) => (
                <div key={o.id} className={i === 0 ? 'offer best' : 'offer'}>
                  <div>
                    {o.sellerId ? (
                      <a className="seller" href={sellerUrl(o.sellerId)} target="_blank" rel="noreferrer" title={t('Seller profile')}>
                        {o.seller}
                      </a>
                    ) : (
                      <strong>{o.seller}</strong>
                    )}
                    <small>
                      {[o.condition, o.shipping ? t('+ {amount} shipping', { amount: fmt(o.shipping) }) : o.shipping === 0 ? t('Free shipping') : null]
                        .filter(Boolean)
                        .join(' · ') || '—'}
                    </small>
                    <small className="seller-history">
                      {o.previous !== null && o.previous !== o.price ? (
                        <span className={o.price! < o.previous ? 'down' : 'up'}>
                          {o.price! < o.previous ? '▼' : '▲'} {fmt(Math.abs(o.price! - o.previous))} {t('since last check')}
                        </span>
                      ) : (
                        <span>{t('no change')}</span>
                      )}
                      {' · '}
                      {t('lowest {price}', { price: fmt(o.lowest) })}
                    </small>
                  </div>
                  <Sparkline values={o.spark} width={64} height={26} />
                  <div className="offer-side">
                    {i === 0 && <span className="best-tag">{t('BEST PRICE')}</span>}
                    <span className="price">{fmt(o.price)}</span>
                    <a className="btn small" href={offerUrl(product.asin, o.sellerId)} target="_blank" rel="noreferrer">
                      {t('View offer')} ↗
                    </a>
                  </div>
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

/** Your own labels for this product; they become tabs on the dashboard. */
function TagsCard({ product, allTags, onChanged }: { product: Product; allTags: string[]; onChanged: () => void }) {
  const { t } = useT()
  const [text, setText] = useState('')
  const save = async (tags: string[]): Promise<void> => {
    await window.api.setProductOptions(product.asin, { tags })
    onChanged()
  }
  const add = (tag: string): void => {
    const clean = tag.trim()
    if (!clean || product.tags.some((x) => x.toLowerCase() === clean.toLowerCase())) return setText('')
    setText('')
    void save([...product.tags, clean])
  }
  const others = allTags.filter((tag) => !product.tags.some((x) => x.toLowerCase() === tag.toLowerCase()))
  return (
    <div className="card">
      <h3>{t('Tags')}</h3>
      <p className="sub">{t('Group products your way, e.g. Gifts or Office. Each tag becomes a tab on the dashboard.')}</p>
      <div className="tag-list">
        {product.tags.map((tag) => (
          <span key={tag} className="tag">
            #{tag}
            <button onClick={() => void save(product.tags.filter((x) => x !== tag))} aria-label={t('Remove')}>
              ×
            </button>
          </span>
        ))}
        <input
          type="text"
          className="tag-input"
          maxLength={30}
          placeholder={t('Add a tag…')}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault()
              add(text)
            }
          }}
          onBlur={() => text.trim() && add(text)}
        />
      </div>
      {others.length > 0 && (
        <div className="tag-list suggestions">
          {others.map((tag) => (
            <button key={tag} className="chip" onClick={() => add(tag)}>
              + #{tag}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** What the product page shows about reviews: stars, how they split, and the top reviews. */
function ReviewsCard({ product }: { product: Product }) {
  const { t, locale } = useT()
  const [info, setInfo] = useState<ReviewsInfo | null>(null)
  const [open, setOpen] = useState<number | null>(null)
  useEffect(() => {
    void window.api.getReviews(product.asin).then(setInfo)
  }, [product.asin, product.lastCheckedAt])
  if (product.rating === null && !info) return null
  return (
    <div className="card">
      <div className="card-head">
        <h3>{t('Reviews on Amazon')}</h3>
        {product.salesRank !== null && (
          <span className="muted small" title={t('Best Sellers Rank')}>
            {t('#{rank} in {category}', { rank: product.salesRank.toLocaleString(locale), category: product.rankCategory ?? '' })}
            {product.rankWeekAgo !== null && product.rankWeekAgo !== product.salesRank && (
              <span className={product.salesRank < product.rankWeekAgo ? 'ok-text' : 'bad-text'}>
                {' '}
                {product.salesRank < product.rankWeekAgo ? '↑' : '↓'} {t('vs. a week ago (#{rank})', { rank: product.rankWeekAgo.toLocaleString(locale) })}
              </span>
            )}
          </span>
        )}
      </div>
      <div className="reviews-top">
        <div className="rating-big">
          <strong>{product.rating?.toLocaleString(locale) ?? '—'}</strong>
          <span className="stars">{'★'.repeat(Math.round(product.rating ?? 0))}{'☆'.repeat(5 - Math.round(product.rating ?? 0))}</span>
          <small className="muted">{t('{n} ratings', { n: (product.reviewCount ?? 0).toLocaleString(locale) })}</small>
        </div>
        {info && (
          <div className="histogram">
            {info.histogram.map((pct, i) => (
              <div key={i} className="bar-row">
                <span>{5 - i} ★</span>
                <div className="bar">
                  <i style={{ width: `${pct}%` }} />
                </div>
                <span className="muted">{pct}%</span>
              </div>
            ))}
          </div>
        )}
      </div>
      {info && info.items.length > 0 && (
        <ul className="review-list">
          {info.items.map((r, i) => (
            <li key={i}>
              <div className="review-head">
                {r.stars !== null && <span className="stars">{'★'.repeat(Math.round(r.stars))}{'☆'.repeat(5 - Math.round(r.stars))}</span>}
                <strong>{r.title}</strong>
              </div>
              <small className="muted">
                {[r.date, r.variant, r.verified ? t('Verified purchase') : null].filter(Boolean).join(' · ')}
              </small>
              {r.body && (
                <p className={open === i ? 'review-body open' : 'review-body'} onClick={() => setOpen(open === i ? null : i)}>
                  {r.body}
                </p>
              )}
              {r.helpful && <small className="faint">{r.helpful}</small>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

const addDays = (iso: string, days: number): string => {
  const [y, m, d] = iso.split('-').map(Number)
  const date = new Date(y, m - 1, d + days)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/** "I bought it": keeps watching the price until the return window closes. */
function PurchaseCard({ product, onChanged, notify }: { product: Product; onChanged: () => void; notify: Notify }) {
  const { t } = useT()
  const { fmt, toDisplay, fromDisplay } = useMoney()
  const today = addDays(new Date().toISOString().slice(0, 10), 0)
  const [editing, setEditing] = useState(false)
  const [at, setAt] = useState(today)
  const [price, setPrice] = useState(product.lastPrice !== null ? String(Math.round(toDisplay(product.lastPrice) * 100) / 100) : '')
  const [days, setDays] = useState('30')
  const p = product.purchase

  const save = async (): Promise<void> => {
    const usd = fromDisplay(Number(price))
    if (!(usd > 0) || !(Number(days) >= 1)) return notify(t('Enter the price you paid and the return days.'), true)
    await window.api.setPurchase(product.asin, { at, price: Math.round(usd * 100) / 100, returnUntil: addDays(at, Number(days)) })
    setEditing(false)
    onChanged()
    notify(t("Got it. You'll get an alert if it gets cheaper before {date}.", { date: addDays(at, Number(days)) }))
  }

  return (
    <div className="card">
      <h3>{t('Already bought it?')}</h3>
      {p && !editing ? (
        <>
          <p className="sub">
            {t('Bought on {date} for {price}. Watching the price until {until}, the last day to return it.', {
              date: p.at,
              price: fmt(p.price),
              until: p.returnUntil
            })}
          </p>
          {product.lastPrice !== null && product.lastPrice < p.price && today <= p.returnUntil && (
            <p className="ok-text">{t('It costs {amount} less now: you could return it and buy it again.', { amount: fmt(p.price - product.lastPrice) })}</p>
          )}
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn" onClick={() => setEditing(true)}>
              {t('Edit')}
            </button>
            <button className="btn link" onClick={() => void window.api.setPurchase(product.asin, null).then(onChanged)}>
              {t('Remove')}
            </button>
          </div>
        </>
      ) : editing ? (
        <div className="purchase-form">
          <label>
            <span>{t('Date')}</span>
            <input type="date" value={at} max={today} onChange={(e) => setAt(e.target.value)} />
          </label>
          <label>
            <span>{t('Price paid')}</span>
            <input type="number" min={0} step="any" className="mono" value={price} onChange={(e) => setPrice(e.target.value)} />
          </label>
          <label>
            <span>{t('Return days')}</span>
            <input type="number" min={1} max={365} className="mono" value={days} onChange={(e) => setDays(e.target.value)} />
          </label>
          <div className="row">
            <button className="btn primary" onClick={() => void save()}>
              {t('Save')}
            </button>
            <button className="btn link" onClick={() => setEditing(false)}>
              {t('Cancel')}
            </button>
          </div>
        </div>
      ) : (
        <>
          <p className="sub">
            {t("Mark it as bought and the app keeps watching it during Amazon's return window. If it gets cheaper, you'll know you can return it and buy it again.")}
          </p>
          <button className="btn" style={{ marginTop: 10 }} onClick={() => setEditing(true)}>
            {t('I bought it')}
          </button>
        </>
      )}
    </div>
  )
}
