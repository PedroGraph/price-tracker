import { useEffect, useMemo, useState } from 'react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { planBudget } from '@shared/budget'
import type { HeatCell } from '@shared/insights'
import type { Product, ProductStats } from '@shared/types'
import { useT } from '../i18n'
import { useMoney } from '../money'
import { Segmented, Sparkline, Thumb } from '../ui'

/** One color per product on the chart: at most four at a time. */
const COLORS = ['var(--teal)', 'var(--purple)', 'var(--amber)', 'var(--blue)']

const shortName = (title: string): string => title.split(/[,(|]/)[0].slice(0, 40)

/** Savings, the price chart, a budget planner, when prices tend to be lowest, and each product's numbers. */
export function StatsView({ products, onOpen }: { products: Product[]; onOpen: (asin: string) => void }) {
  const { t, locale } = useT()
  const { fmt } = useMoney()
  const [stats, setStats] = useState<ProductStats[]>([])

  useEffect(() => {
    void window.api.productStats().then(setStats)
  }, [products])

  const droppedTotal = stats.reduce((s, p) => s + p.droppedTotal, 0)
  const belowFirst = stats.reduce((s, p) => s + (p.first !== null && p.current !== null && p.current < p.first ? p.first - p.current : 0), 0)
  const atLowest = stats.filter((p) => p.current !== null && p.lowest !== null && p.current <= p.lowest).length
  const byVolatility = [...stats].filter((p) => p.lowest !== null).sort((a, b) => b.volatility - a.volatility)
  const sparks = new Map(products.map((p) => [p.asin, p.spark]))

  return (
    <div className="stats-page">
      <section className="stats">
        <div className="card stat">
          <label>{t('Drops detected')}</label>
          <div className="value teal">{fmt(droppedTotal)}</div>
          <small>{t('Sum of every price drop alert')}</small>
        </div>
        <div className="card stat">
          <label>{t('Below the first price')}</label>
          <div className="value teal">{fmt(belowFirst)}</div>
          <small>{t('What your products cost less today than when tracking started')}</small>
        </div>
        <div className="card stat">
          <label>{t('At their lowest')}</label>
          <div className="value purple">{atLowest}</div>
          <small>{t('Products at their lowest tracked price right now')}</small>
        </div>
        <div className="card stat">
          <label>{t('Tracked products')}</label>
          <div className="value">{stats.length}</div>
          <small>{t('{n} price drops in total', { n: stats.reduce((s, p) => s + p.drops, 0) })}</small>
        </div>
      </section>

      <PriceChart products={products} />

      <div className="stats-grid">
        <Budget products={products} onOpen={onOpen} />
        <BestMoment products={products} />
      </div>

      <div className="card section-card">
        <h3>{t('Product by product')}</h3>
        <p className="sub">{t('How much each price moves, its change since the first check and its lowest price.')}</p>
        <div>
          {byVolatility.map((p) => {
            // The bar fills up at a 12% swing, which is already a lot for a price.
            const width = Math.min(100, (p.volatility / 12) * 100)
            const tone = p.volatility >= 3 ? 'var(--amber)' : p.volatility >= 0.5 ? 'var(--teal)' : 'var(--muted)'
            const change = p.first && p.current !== null ? ((p.current - p.first) / p.first) * 100 : null
            return (
              <button key={p.asin} className="vol-row" onClick={() => onOpen(p.asin)} title={p.title}>
                <span className="vol-name">{p.title}</span>
                <Sparkline values={sparks.get(p.asin) ?? []} width={60} height={18} />
                <div className="vol-bar" title={p.volatility < 0.5 ? t('stable') : p.volatility < 3 ? t('moves a little') : t('moves a lot')}>
                  <i style={{ width: `${width}%`, background: tone }} />
                </div>
                <span className="vol-score" style={{ color: tone }}>
                  {p.volatility.toFixed(1)}%
                </span>
                <span className={`vol-delta ${change === null || Math.abs(change) < 0.05 ? '' : change < 0 ? 'down' : 'up'}`}>
                  {change === null ? '—' : `${change < 0 ? '▼' : change > 0 ? '▲' : ''} ${Math.abs(change).toFixed(0)}%`}
                </span>
                <span className="vol-low">
                  {t('lowest {price}', { price: fmt(p.lowest) })}
                  {p.lowestAt && ` · ${new Date(p.lowestAt).toLocaleDateString(locale, { day: 'numeric', month: 'short' })}`}
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/** Pick a budget; the app finds the combination of cart items that fits it best. */
function Budget({ products, onOpen }: { products: Product[]; onOpen: (asin: string) => void }) {
  const { t } = useT()
  const { fmt, toDisplay, fromDisplay } = useMoney()
  const [budget, setBudget] = useState<number>(() => {
    try {
      return Number(localStorage.getItem('budget')) || 0
    } catch {
      return 0
    }
  })
  const [text, setText] = useState(budget ? String(Math.round(toDisplay(budget))) : '')
  const [scope, setScope] = useState<'cart' | 'all'>('cart')
  const pool = products.filter((p) => p.active && p.available && p.lastPrice !== null && (scope === 'all' || p.source === 'cart'))
  const plan = useMemo(
    () => planBudget(pool.map((p) => ({ asin: p.asin, price: p.lastPrice!, low30: p.lowest30 })), budget),
    [pool.map((p) => `${p.asin}:${p.lastPrice}`).join(), budget]
  )
  const apply = (value: string): void => {
    setText(value)
    const usd = value.trim() ? fromDisplay(Number(value)) : 0
    const next = usd > 0 ? Math.round(usd * 100) / 100 : 0
    setBudget(next)
    try {
      localStorage.setItem('budget', String(next))
    } catch {
      // Only a convenience.
    }
  }
  const byAsin = new Map(products.map((p) => [p.asin, p]))

  return (
    <div className="card section-card">
      <h3>{t('Budget')}</h3>
      <p className="sub">{t('Set how much you want to spend; the app picks the combination that uses it best.')}</p>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <input className="short mono" type="number" min={0} placeholder="1500" value={text} onChange={(e) => apply(e.target.value)} />
        <Segmented
          options={[
            { value: 'cart', label: t('Cart') },
            { value: 'all', label: t('All') }
          ]}
          value={scope}
          onChange={setScope}
        />
      </div>
      {budget > 0 &&
        (plan.chosen.length === 0 ? (
          <p className="muted" style={{ marginTop: 12 }}>
            {t('Nothing fits in this budget.')}
          </p>
        ) : (
          <>
            <div className="budget-numbers">
              <strong>{fmt(plan.total)}</strong>
              <span>/ {fmt(budget)}</span>
            </div>
            <div className="track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((plan.total / budget) * 100)}>
              <i style={{ width: `${Math.min(100, (plan.total / budget) * 100)}%` }} />
            </div>
            <div className="budget-sum">
              <span>
                {t('Total')} <strong className="mono">{fmt(plan.total)}</strong>
              </span>
              <span>
                {t('Left')} <strong className="mono">{fmt(plan.left)}</strong>
              </span>
            </div>
            <div className="stat-list" style={{ marginTop: 8 }}>
              {plan.chosen.map((i) => {
                const p = byAsin.get(i.asin)!
                return (
                  <button key={i.asin} className="stat-row" onClick={() => onOpen(i.asin)}>
                    <Thumb src={p.image} />
                    <span className="name" title={p.title}>
                      {p.title}
                    </span>
                    <strong className="mono">{fmt(i.price)}</strong>
                  </button>
                )
              })}
            </div>
            {plan.savingsIfWaiting > 0 && (
              <div className="budget-note">{t('Waiting for their 30-day lows would save {amount}', { amount: fmt(plan.savingsIfWaiting) })}</div>
            )}
          </>
        ))}
    </div>
  )
}

// English keys, translated where shown.
const SLOTS = ['Morning', 'Afternoon', 'Night']

/** When prices tend to be lowest, by weekday and part of the day, across every product. */
function BestMoment({ products }: { products: Product[] }) {
  const { t, locale } = useT()
  const [map, setMap] = useState<HeatCell[][] | null>(null)
  useEffect(() => {
    void window.api.priceHeatmap().then(setMap)
  }, [products])

  // 5 January 2026 is a Monday.
  const day = (i: number, weekday: 'narrow' | 'long'): string => new Date(2026, 0, 5 + i).toLocaleDateString(locale, { weekday })
  const values = (map ?? []).flat().flatMap((c) => (c.pct === null ? [] : [c.pct]))
  const [worst, best] = [Math.min(...values), Math.max(...values)]
  // Under a quarter of a percent between the best and worst moment, there's no pattern to show.
  const flat = values.length === 0 || best - worst < 0.25

  return (
    <div className="card section-card">
      <h3>{t('Best moment to buy')}</h3>
      <p className="sub">{t('When your products tend to be cheapest, compared with their own average.')}</p>
      <div className="heatmap">
        <div />
        {Array.from({ length: 7 }, (_, i) => (
          <div key={i} className="day" title={day(i, 'long')}>
            {day(i, 'narrow')}
          </div>
        ))}
        {(map ?? []).map((row, r) => [
          <div key={`slot${r}`} className="slot">
            {t(SLOTS[r])}
          </div>,
          ...row.map((cell, c) => {
            const where = `${day(c, 'long')} · ${t(SLOTS[r])}`
            if (cell.pct === null || flat) return <div key={`${r}-${c}`} className={cell.pct === null ? 'cell empty' : 'cell'} title={where} />
            const score = Math.round(((cell.pct - worst) / (best - worst)) * 100)
            const text = cell.pct >= 0 ? t('{pct}% under their average', { pct: cell.pct.toFixed(1) }) : t('{pct}% over their average', { pct: (-cell.pct).toFixed(1) })
            return <div key={`${r}-${c}`} className="cell" style={{ background: `color-mix(in srgb, var(--teal) ${score}%, var(--panel-3))` }} title={`${where}: ${text}`} />
          })
        ])}
      </div>
      {flat ? (
        <p className="hint">{t('No clear pattern yet: it shows up as the prices move over a few weeks of checks.')}</p>
      ) : (
        <div className="heat-scale">
          <span>{t('Worst')}</span>
          <i />
          <span>{t('Best')}</span>
        </div>
      )}
    </div>
  )
}

/** Up to four products on one chart, as price or as % change from their first price. */
function PriceChart({ products }: { products: Product[] }) {
  const { t, locale } = useT()
  const { fmt, toDisplay } = useMoney()
  const active = products.filter((p) => p.active && p.lastPrice !== null)
  const [picked, setPicked] = useState<string[]>(() => active.slice(0, 3).map((p) => p.asin))
  const [mode, setMode] = useState<'pct' | 'price'>('pct')
  const [series, setSeries] = useState<{ asin: string; points: { at: string; price: number }[] }[]>([])

  useEffect(() => {
    if (picked.length === 0) return setSeries([])
    void window.api.priceSeries(picked).then(setSeries)
  }, [picked.join()])

  const toggle = (asin: string): void =>
    setPicked((cur) => (cur.includes(asin) ? cur.filter((a) => a !== asin) : cur.length >= COLORS.length ? cur : [...cur, asin]))
  const lines = series.map((s) => {
    const first = s.points[0]?.price ?? 1
    return {
      asin: s.asin,
      data: s.points.map((p) => ({ t: Date.parse(p.at), v: mode === 'pct' ? ((p.price - first) / first) * 100 : toDisplay(p.price), usd: p.price }))
    }
  })
  const name = (asin: string): string => shortName(products.find((p) => p.asin === asin)?.title ?? asin)

  return (
    <div className="card chart-card">
      <div className="chart-head">
        <div>
          <h3>{t('Price history')}</h3>
          <p>{t('Pick up to four products. Hover the chart for the exact values.')}</p>
        </div>
        <Segmented
          options={[
            { value: 'pct', label: t('% change') },
            { value: 'price', label: t('Price') }
          ]}
          value={mode}
          onChange={setMode}
        />
      </div>
      <div className="legend-picks">
        {active.map((p) => {
          const i = picked.indexOf(p.asin)
          return (
            <button key={p.asin} className={i >= 0 ? 'legend-pick on' : 'legend-pick'} aria-pressed={i >= 0} onClick={() => toggle(p.asin)} title={p.title}>
              <i style={i >= 0 ? { background: COLORS[i] } : undefined} />
              {shortName(p.title)}
            </button>
          )
        })}
      </div>
      {lines.some((l) => l.data.length > 1) ? (
        <ResponsiveContainer width="100%" height={260}>
          <LineChart margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--line)" />
            <XAxis
              dataKey="t"
              type="number"
              scale="time"
              domain={['dataMin', 'dataMax']}
              tickFormatter={(v) => new Date(v).toLocaleDateString(locale, { month: 'short', day: 'numeric' })}
              stroke="var(--faint)"
              tickLine={false}
              axisLine={false}
              fontSize={11}
              allowDuplicatedCategory={false}
            />
            <YAxis
              tickFormatter={(v) => (mode === 'pct' ? `${v > 0 ? '+' : ''}${Number(v).toFixed(0)}%` : fmt(v / (toDisplay(1) || 1)))}
              stroke="var(--faint)"
              tickLine={false}
              axisLine={false}
              width={mode === 'pct' ? 52 : 96}
              fontSize={11}
            />
            <Tooltip
              labelFormatter={(v) => new Date(v as number).toLocaleString(locale)}
              formatter={(v, _n, item) => [
                mode === 'pct' ? `${Number(v) > 0 ? '+' : ''}${Number(v).toFixed(1)}% · ${fmt((item.payload as { usd: number }).usd)}` : fmt((item.payload as { usd: number }).usd),
                name(String(item.name))
              ]}
              contentStyle={{ background: 'var(--panel)', border: '1px solid var(--line-strong)', borderRadius: 9, boxShadow: 'var(--shadow-lift)', fontSize: 12 }}
            />
            {lines.map((l) => (
              <Line
                key={l.asin}
                name={l.asin}
                data={l.data}
                dataKey="v"
                type="stepAfter"
                stroke={COLORS[picked.indexOf(l.asin)] ?? 'var(--muted)'}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      ) : (
        <p className="muted">{t('Pick products with at least two checks to compare them.')}</p>
      )}
    </div>
  )
}
