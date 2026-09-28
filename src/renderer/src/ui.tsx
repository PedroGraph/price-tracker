import { ChevronDown, ChevronUp, Minus, Package } from 'lucide-react'
import { buySignal, formatCop, formatUsd, landedTotal } from '@shared/pricing'
import type { Product, ThresholdUnit } from '@shared/types'
import { useT, type T } from './i18n'
import { useMoney } from './money'

export function timeAgo(iso: string | null, t: T): string {
  if (!iso) return t('never')
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000)
  if (s < 60) return t('just now')
  if (s < 3600) return t('{n} min ago', { n: Math.round(s / 60) })
  if (s < 86400) return t('{n} h ago', { n: Math.round(s / 3600) })
  const d = Math.round(s / 86400)
  return t(d === 1 ? '{n} day ago' : '{n} days ago', { n: d })
}

export function timeUntil(iso: string | null): string {
  if (!iso) return '—'
  const m = Math.max(0, Math.round((Date.parse(iso) - Date.now()) / 60000))
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`
}

export function Thumb({ src, large }: { src: string | null; large?: boolean }) {
  return <div className={large ? 'thumb lg' : 'thumb'}>{src ? <img src={src} alt="" /> : <Package size={22} strokeWidth={1.6} />}</div>
}

/** "-$21.00 (-6.0%)" pill; grey "No change" when equal. */
export function ChangePill({ from, to, suffix }: { from: number | null; to: number | null; suffix?: string }) {
  const { fmtDelta } = useMoney()
  const { t } = useT()
  if (from === null || to === null) return null
  const diff = Math.round((to - from) * 100) / 100
  if (diff === 0) {
    return (
      <span className="pill flat">
        <Minus size={12} /> {t('No change')}
      </span>
    )
  }
  const pct = (diff / from) * 100
  return (
    <span className={`pill ${diff < 0 ? 'down' : 'up'}`}>
      {diff < 0 ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
      {fmtDelta(diff)} ({pct > 0 ? '+' : ''}
      {pct.toFixed(1)}%){suffix && t(suffix)}
    </span>
  )
}

export function Sparkline({ values, width = 124, height = 40 }: { values: number[]; width?: number; height?: number }) {
  const w = width
  const h = height
  if (values.length < 2) return <svg width={w} height={h} />
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const pts = values.map((v, i) => [(i / (values.length - 1)) * (w - 6) + 3, max === min ? h / 2 : h - 4 - ((v - min) / span) * (h - 8)])
  const trend = values.at(-1)! - values[0]
  const color = trend < 0 ? 'var(--teal)' : trend > 0 ? 'var(--amber)' : 'var(--faint)'
  const [lx, ly] = pts.at(-1)!
  return (
    <svg width={w} height={h} aria-hidden>
      <polyline points={pts.map((p) => p.join(',')).join(' ')} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />
      <circle cx={lx} cy={ly} r={3} fill={color} />
    </svg>
  )
}

export function Segmented<T extends string>({
  options,
  value,
  onChange
}: {
  options: { value: T; label: string }[]
  value: T
  onChange: (v: T) => void
}) {
  return (
    <div className="segmented" role="radiogroup">
      {options.map((o) => (
        <button key={o.value} role="radio" aria-checked={o.value === value} className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button className={on ? 'toggle on' : 'toggle'} role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)}>
      <span />
    </button>
  )
}

const SIGNAL_LABEL = { low: 'Low price', normal: 'Normal price', high: 'High price', unknown: 'Not enough data' } as const

/** "Low / normal / high price" compared with the last 30 days. */
export function BuySignal({ product, detailed }: { product: Product; detailed?: boolean }) {
  const { t } = useT()
  const { fmt } = useMoney()
  const verdict = buySignal({
    current: product.lastPrice,
    avg: product.avg30,
    min: product.lowest30,
    runs: product.runs30,
    spanDays: product.spanDays30
  })
  if (verdict === 'unknown' && !detailed) return null
  return (
    <span className={`signal ${verdict}`} title={t('Compared with the last 30 days')}>
      <span className="dot" /> {t(SIGNAL_LABEL[verdict])}
      {detailed && verdict !== 'unknown' && (
        <small> · {t('30-day average {avg}', { avg: fmt(product.avg30) })}</small>
      )}
      {detailed && verdict === 'unknown' && <small> · {t('needs a few days of checks')}</small>}
    </span>
  )
}

/** "Delivered: $1,120.40 · COP 4.4M": price + shipping + import fees, shown when there is something to add. */
export function DeliveredTotal({ product: p }: { product: Product }) {
  const { t } = useT()
  const { rate } = useMoney()
  const total = landedTotal(p.lastPrice, p.lastShipping, p.lastImportFees)
  if (total === null || total === p.lastPrice) return null
  return (
    <div className="delivered" title={t('Price + shipping + import fees')}>
      <span>{t('Delivered')}</span>
      <strong>{formatUsd(total)}</strong>
      {rate !== null && <span className="muted">≈ {formatCop(total * rate)}</span>}
    </div>
  )
}

export const UNITS: { value: ThresholdUnit; label: string }[] = [
  { value: 'percent', label: '%' },
  { value: 'USD', label: 'USD' },
  { value: 'COP', label: 'COP' }
]
