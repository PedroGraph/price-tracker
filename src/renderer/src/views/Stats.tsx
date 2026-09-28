import { useEffect, useMemo, useState } from 'react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { planBudget } from '@shared/budget'
import type { Product, ProductStats } from '@shared/types'
import { useT } from '../i18n'
import { useMoney } from '../money'
import { Segmented, Thumb } from '../ui'

const COLORS = ['var(--teal)', 'var(--amber)', '#7c6ff0']

/** Savings, the best moments to buy, what moves the most, a budget planner and a price comparison. */
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

  return (
    <div className="stats-page">
      <section className="stats">
        <div className="card stat">
          <label>{t('Drops detected')}</label>
          <div className="value teal">{fmt(droppedTotal)}</div>
          <small className="muted">{t('Sum of every price drop alert')}</small>
        </div>
        <div className="card stat">
          <label>{t('Below the first price')}</label>
          <div className="value teal">{fmt(belowFirst)}</div>
          <small className="muted">{t('What your products cost less today than when tracking started')}</small>
        </div>
        <div className="card stat">
          <label>{t('At their lowest')}</label>
          <div className="value plain">{atLowest}</div>
          <small className="muted">{t('Products at their lowest tracked price right now')}</small>
        </div>
        <div className="card stat">
          <label>{t('Tracked products')}</label>
          <div className="value plain">{stats.length}</div>
          <small className="muted">{t('{n} price drops in total', { n: stats.reduce((s, p) => s + p.drops, 0) })}</small>
        </div>
      </section>

      <div className="stats-grid">
        <Budget products={products} onOpen={onOpen} />
        <Compare products={products} />

        <div className="card">
          <h3>{t('Best moment to buy')}</h3>
          <p className="sub">{t('The lowest price each product has had, and when.')}</p>
          <div className="stat-list">
            {stats
              .filter((p) => p.lowest !== null)
              .map((p) => (
                <button key={p.asin} className="stat-row" onClick={() => onOpen(p.asin)}>
                  <Thumb src={p.image} />
                  <span className="name" title={p.title}>
                    {p.title}
                  </span>
                  <span className="when muted">{p.lowestAt ? new Date(p.lowestAt).toLocaleDateString(locale, { day: 'numeric', month: 'short' }) : ''}</span>
                  <strong className="mono">{fmt(p.lowest)}</strong>
                  {p.current !== null && p.lowest !== null && p.current > p.lowest ? (
                    <span className="bad-text mono small">+{fmt(p.current - p.lowest)}</span>
                  ) : (
                    <span className="ok-text small">{t('now')}</span>
                  )}
                </button>
              ))}
          </div>
        </div>

        <div className="card">
          <h3>{t('Most and least volatile')}</h3>
          <p className="sub">{t('How much each price moves (standard deviation over the average).')}</p>
          <div className="stat-list">
            {byVolatility.map((p, i) => (
              <button key={p.asin} className="stat-row" onClick={() => onOpen(p.asin)}>
                <Thumb src={p.image} />
                <span className="name" title={p.title}>
                  {p.title}
                </span>
                <span className="muted small">{fmt(p.lowest)} – {fmt(p.highest)}</span>
                <strong className={i < 3 && p.volatility >= 1 ? 'warn-text mono' : 'mono'}>{p.volatility.toFixed(1)}%</strong>
                <span className="muted small">{p.volatility < 0.5 ? t('stable') : p.volatility < 3 ? t('moves a little') : t('moves a lot')}</span>
              </button>
            ))}
          </div>
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
    <div className="card">
      <h3>{t('Budget')}</h3>
      <p className="sub">{t('Set how much you want to spend; the app picks the combination that uses it best.')}</p>
      <div className="row" style={{ marginTop: 12, flexWrap: 'wrap' }}>
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
            <div className="stat-list" style={{ marginTop: 12 }}>
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
            <div className="budget-sum">
              <span>
                {t('Total')} <strong className="mono">{fmt(plan.total)}</strong>
              </span>
              <span className="muted">
                {t('Left')} <strong className="mono">{fmt(plan.left)}</strong>
              </span>
              {plan.savingsIfWaiting > 0 && (
                <span className="ok-text">{t('Waiting for their 30-day lows would save {amount}', { amount: fmt(plan.savingsIfWaiting) })}</span>
              )}
            </div>
          </>
        ))}
    </div>
  )
}

/** Up to three products on one chart, as price or as % change from their first price. */
function Compare({ products }: { products: Product[] }) {
  const { t, locale } = useT()
  const { fmt, toDisplay } = useMoney()
  const active = products.filter((p) => p.active && p.lastPrice !== null)
  const [picked, setPicked] = useState<string[]>(() => active.slice(0, 2).map((p) => p.asin))
  const [mode, setMode] = useState<'pct' | 'price'>('pct')
  const [series, setSeries] = useState<{ asin: string; points: { at: string; price: number }[] }[]>([])

  useEffect(() => {
    if (picked.length === 0) return setSeries([])
    void window.api.priceSeries(picked).then(setSeries)
  }, [picked.join()])

  const toggle = (asin: string): void =>
    setPicked((cur) => (cur.includes(asin) ? cur.filter((a) => a !== asin) : cur.length >= 3 ? cur : [...cur, asin]))
  const lines = series.map((s) => {
    const first = s.points[0]?.price ?? 1
    return {
      asin: s.asin,
      data: s.points.map((p) => ({ t: Date.parse(p.at), v: mode === 'pct' ? ((p.price - first) / first) * 100 : toDisplay(p.price), usd: p.price }))
    }
  })
  const name = (asin: string): string => (products.find((p) => p.asin === asin)?.title ?? asin).split(/[,(|]/)[0].slice(0, 40)

  return (
    <div className="card">
      <div className="card-head">
        <h3>{t('Compare prices')}</h3>
        <Segmented
          options={[
            { value: 'pct', label: t('% change') },
            { value: 'price', label: t('Price') }
          ]}
          value={mode}
          onChange={setMode}
        />
      </div>
      <div className="compare-picks">
        {active.map((p) => {
          const i = picked.indexOf(p.asin)
          return (
            <button key={p.asin} className={i >= 0 ? 'chip on' : 'chip'} onClick={() => toggle(p.asin)} title={p.title}>
              {i >= 0 && <i className="swatch" style={{ background: COLORS[i] }} />}
              {name(p.asin)}
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
              fontSize={12}
              allowDuplicatedCategory={false}
            />
            <YAxis
              tickFormatter={(v) => (mode === 'pct' ? `${v > 0 ? '+' : ''}${Number(v).toFixed(0)}%` : fmt(v / (toDisplay(1) || 1)))}
              stroke="var(--faint)"
              tickLine={false}
              axisLine={false}
              width={mode === 'pct' ? 52 : 96}
              fontSize={12}
            />
            <Tooltip
              labelFormatter={(v) => new Date(v as number).toLocaleString(locale)}
              formatter={(v, _n, item) => [
                mode === 'pct' ? `${Number(v) > 0 ? '+' : ''}${Number(v).toFixed(1)}% · ${fmt((item.payload as { usd: number }).usd)}` : fmt((item.payload as { usd: number }).usd),
                name(String(item.name))
              ]}
              contentStyle={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 10 }}
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
