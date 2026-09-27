import { useMemo, useState } from 'react'
import { ChevronRight, Plus, Search, ShoppingCart } from 'lucide-react'
import type { Notify } from '../App'
import type { DashboardStats, Product, Status } from '@shared/types'
import { useMoney } from '../money'
import { ChangePill, Sparkline, Thumb, timeAgo } from '../ui'

type Filter = 'all' | 'down' | 'up' | 'out'

const movement = (p: Product): number | null =>
  p.firstPrice !== null && p.lastPrice !== null ? Math.round((p.lastPrice - p.firstPrice) * 100) / 100 : null

const FILTERS: { id: Filter; label: string; test: (p: Product) => boolean }[] = [
  { id: 'all', label: 'All', test: () => true },
  { id: 'down', label: 'Dropped', test: (p) => (movement(p) ?? 0) < 0 },
  { id: 'up', label: 'Went up', test: (p) => (movement(p) ?? 0) > 0 },
  { id: 'out', label: 'Out of stock', test: (p) => p.available === false }
]

export function Dashboard({
  products,
  stats,
  status,
  onOpen,
  notify
}: {
  products: Product[]
  stats: DashboardStats | null
  status: Status | null
  onOpen: (asin: string) => void
  notify: Notify
}) {
  const { fmt } = useMoney()
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [adding, setAdding] = useState(false)
  const [link, setLink] = useState('')

  const add = async (): Promise<void> => {
    try {
      const asin = await window.api.addProduct(link)
      setLink('')
      setAdding(false)
      notify(`Tracking ${asin}. Its price appears after this check.`)
    } catch (e) {
      notify(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e), true)
    }
  }

  const addForm = adding && (
    <div className="card add-form">
      <input
        type="text"
        autoFocus
        placeholder="Paste an Amazon product link or ASIN"
        value={link}
        onChange={(e) => setLink(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void add()
          if (e.key === 'Escape') setAdding(false)
        }}
      />
      <button className="btn primary" onClick={() => void add()} disabled={!link.trim()}>
        Track
      </button>
      <button className="btn link" onClick={() => setAdding(false)}>
        Cancel
      </button>
    </div>
  )
  const active = useMemo(() => products.filter((p) => p.active), [products])

  const visible = active.filter(
    (p) =>
      FILTERS.find((f) => f.id === filter)!.test(p) &&
      (!query || `${p.title} ${p.asin}`.toLowerCase().includes(query.toLowerCase()))
  )

  return (
    <>
      <section className="stats">
        <div className="card stat">
          <label>Tracked products</label>
          <div className="value plain">{stats?.tracked ?? '—'}</div>
        </div>
        <div className="card stat">
          <label>Dropped in price</label>
          <div className="value plain teal">{stats?.droppedCount ?? '—'}</div>
        </div>
        <div className="card stat">
          <label>Saved this week</label>
          <div className="value teal">{stats ? fmt(stats.savedThisWeek) : '—'}</div>
        </div>
        <div className="card stat">
          <label>Alerts sent (30 days)</label>
          <div className="value plain">{stats?.alertsLast30Days ?? '—'}</div>
        </div>
      </section>

      {active.length === 0 ? (
        <div className="empty">
          {addForm}
          <ShoppingCart size={34} className="faint" />
          <h2>No products yet</h2>
          <p className="muted">
            {status?.session === 'logged_in'
              ? 'Your Amazon cart is empty. Add something to your cart and check again.'
              : 'Sign in to Amazon and the app will start tracking everything in your cart.'}
          </p>
          <div className="row" style={{ justifyContent: 'center' }}>
            {status?.session !== 'logged_in' && (
              <button className="btn primary" onClick={() => void window.api.openAmazon()}>
                Open Amazon
              </button>
            )}
            <button className="btn" onClick={() => setAdding(true)}>
              <Plus size={15} /> Add by link
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="filters">
            {FILTERS.map((f) => (
              <button key={f.id} className={filter === f.id ? 'chip on' : 'chip'} onClick={() => setFilter(f.id)}>
                {f.label} · {active.filter(f.test).length}
              </button>
            ))}
            <div className="spacer" />
            <button className="btn" onClick={() => setAdding(!adding)}>
              <Plus size={15} /> Add product
            </button>
            <label className="search">
              <Search size={16} />
              <input type="text" placeholder="Search products…" value={query} onChange={(e) => setQuery(e.target.value)} />
            </label>
          </div>

          {addForm}
          <section className="grid">
            {visible.map((p) => (
              <ProductCard key={p.asin} product={p} onOpen={() => onOpen(p.asin)} />
            ))}
          </section>
          {visible.length === 0 && <p className="muted empty">Nothing matches this filter.</p>}
        </>
      )}
    </>
  )
}

function ProductCard({ product: p, onOpen }: { product: Product; onOpen: () => void }) {
  const { fmt } = useMoney()
  const moved = movement(p)
  const stock =
    p.available === null ? (
      <span className="stock">
        <span className="dot" /> Pending first check
      </span>
    ) : p.available === false ? (
      <span className="stock out">
        <span className="dot" /> Out of stock
      </span>
    ) : p.backInStock ? (
      <span className="stock back">
        <span className="dot" /> Back in stock
      </span>
    ) : (
      <span className="stock">
        <span className="dot" /> In stock
      </span>
    )

  return (
    <article className="card pcard">
      <div className="head">
        <Thumb src={p.image} />
        <div>
          <h4 title={p.title}>{p.title}</h4>
          {stock}
        </div>
        <div className="badges">
          {p.targetPrice !== null && p.lastPrice !== null && p.lastPrice <= p.targetPrice && (
            <span className="badge good">Target reached</span>
          )}
          {/* Only after an actual drop; an unchanged price is trivially the lowest. */}
          {p.lowestPrice !== null && p.lastPrice !== null && p.firstPrice !== null &&
            p.lastPrice <= p.lowestPrice && p.lastPrice < p.firstPrice && (
            <span className="badge good">Lowest ever</span>
          )}
          {p.sellerCount > 1 && <span className="badge">{p.sellerCount} sellers</span>}
          {p.source === 'manual' && <span className="badge">Not in cart</span>}
        </div>
      </div>
      <div className="priceline">
        <span className="big">{fmt(p.lastPrice)}</span>
        {moved !== null && moved !== 0 && <span className="was">{fmt(p.firstPrice)}</span>}
        <ChangePill from={p.firstPrice} to={p.lastPrice} />
        {p.lastShipping ? <span className="ship">+ {fmt(p.lastShipping)} shipping</span> : null}
      </div>
      <div className="foot">
        <Sparkline values={p.spark} />
        <span className="when">{timeAgo(p.lastCheckedAt)}</span>
        <button className="btn" onClick={onOpen}>
          View details <ChevronRight size={15} />
        </button>
      </div>
    </article>
  )
}
