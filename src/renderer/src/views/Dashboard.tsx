import { useMemo, useState } from 'react'
import { Check, ChevronRight, ExternalLink, Loader2, Plus, Search, ShoppingCart, Star } from 'lucide-react'
import type { Notify } from '../App'
import type { DashboardStats, Product, SearchResult, Status } from '@shared/types'
import { useT } from '../i18n'
import { useMoney } from '../money'
import { BuySignal, ChangePill, Sparkline, Thumb, timeAgo } from '../ui'

type Filter = 'all' | 'down' | 'up' | 'out'

const errorText = (e: unknown): string =>
  e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e)

const movement =(p: Product): number | null =>
  p.firstPrice !== null && p.lastPrice !== null ? Math.round((p.lastPrice - p.firstPrice) * 100) / 100 : null

// Labels are English keys, translated where they're shown.
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
  const { t } = useT()
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [adding, setAdding] = useState(false)
  const [link, setLink] = useState('')
  const [amazon, setAmazon] = useState<{ query: string; results: SearchResult[] | null; error?: string } | null>(null)

  const add = async (input = link): Promise<void> => {
    try {
      const asin = await window.api.addProduct(input)
      if (input === link) {
        setLink('')
        setAdding(false)
      }
      notify(t('Tracking {asin}. Its price appears after this check.', { asin }))
    } catch (e) {
      notify(errorText(e), true)
    }
  }

  const searchAmazon = async (): Promise<void> => {
    const q = query.trim()
    if (!q) return
    setAmazon({ query: q, results: null })
    try {
      const results = await window.api.searchAmazon(q)
      setAmazon((cur) => (cur?.query === q ? { query: q, results } : cur))
    } catch (e) {
      setAmazon((cur) => (cur?.query === q ? { query: q, results: [], error: errorText(e) } : cur))
    }
  }

  const addForm = adding && (
    <div className="card add-form">
      <input
        type="text"
        autoFocus
        placeholder={t('Paste an Amazon product link or ASIN')}
        value={link}
        onChange={(e) => setLink(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void add()
          if (e.key === 'Escape') setAdding(false)
        }}
      />
      <button className="btn primary" onClick={() => void add()} disabled={!link.trim()}>
        {t('Track')}
      </button>
      <button className="btn link" onClick={() => setAdding(false)}>
        {t('Cancel')}
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
          <label>{t('Tracked products')}</label>
          <div className="value plain">{stats?.tracked ?? '—'}</div>
        </div>
        <div className="card stat">
          <label>{t('Dropped in price')}</label>
          <div className="value plain teal">{stats?.droppedCount ?? '—'}</div>
        </div>
        <div className="card stat">
          <label>{t('Saved this week')}</label>
          <div className="value teal">{stats ? fmt(stats.savedThisWeek) : '—'}</div>
        </div>
        <div className="card stat">
          <label>{t('Alerts sent (30 days)')}</label>
          <div className="value plain">{stats?.alertsLast30Days ?? '—'}</div>
        </div>
      </section>

      {active.length === 0 ? (
        <div className="empty">
          {addForm}
          <ShoppingCart size={34} className="faint" />
          <h2>{t('No products yet')}</h2>
          <p className="muted">
            {status?.session === 'logged_in'
              ? t('Your Amazon cart is empty. Add something to your cart and check again.')
              : t('Sign in to Amazon and the app will start tracking everything in your cart.')}
          </p>
          <div className="row" style={{ justifyContent: 'center' }}>
            {status?.session !== 'logged_in' && (
              <button className="btn primary" onClick={() => void window.api.openAmazon()}>
                {t('Open Amazon')}
              </button>
            )}
            <button className="btn" onClick={() => setAdding(true)}>
              <Plus size={15} /> {t('Add by link')}
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="filters">
            {FILTERS.map((f) => (
              <button key={f.id} className={filter === f.id ? 'chip on' : 'chip'} onClick={() => setFilter(f.id)}>
                {t(f.label)} · {active.filter(f.test).length}
              </button>
            ))}
            <div className="spacer" />
            <button className="btn" onClick={() => setAdding(!adding)}>
              <Plus size={15} /> {t('Add product')}
            </button>
            <label className="search">
              <Search size={16} />
              <input
                type="text"
                placeholder={t('Search products…')}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value)
                  if (!e.target.value.trim()) setAmazon(null)
                }}
                title={t('Press Enter to search on Amazon')}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void searchAmazon()
                }}
              />
            </label>
          </div>

          {addForm}
          {[
            { title: t('In your cart'), items: visible.filter((p) => p.source === 'cart') },
            { title: t('Outside the cart'), items: visible.filter((p) => p.source !== 'cart') }
          ].map(
            (g) =>
              g.items.length > 0 && (
                <div key={g.title} className="group">
                  <h3 className="group-title">
                    {g.title} <span className="count">· {g.items.length}</span>
                  </h3>
                  <section className="grid">
                    {g.items.map((p) => (
                      <ProductCard key={p.asin} product={p} onOpen={() => onOpen(p.asin)} />
                    ))}
                  </section>
                </div>
              )
          )}
          {visible.length === 0 && <p className="muted empty">{t('Nothing matches this filter.')}</p>}
          {query.trim() && amazon?.query !== query.trim() && (
            <div className="amazon-search">
              <span className="muted">{t('Looking for something new?')}</span>
              <button className="btn" onClick={() => void searchAmazon()}>
                <Search size={15} /> {t('Search “{q}” on Amazon', { q: query.trim() })}
              </button>
            </div>
          )}
          {amazon && (
            <AmazonResults
              {...amazon}
              tracked={new Set(products.map((p) => p.asin))}
              onTrack={(asin) => void add(asin)}
            />
          )}
        </>
      )}
    </>
  )
}

function ProductCard({ product: p, onOpen }: { product: Product; onOpen: () => void }) {
  const { fmt } = useMoney()
  const { t } = useT()
  const moved = movement(p)
  const stock =
    p.available === null ? (
      <span className="stock">
        <span className="dot" /> {t('Pending first check')}
      </span>
    ) : p.available === false ? (
      <span className="stock out">
        <span className="dot" /> {t('Out of stock')}
      </span>
    ) : p.backInStock ? (
      <span className="stock back">
        <span className="dot" /> {t('Back in stock')}
      </span>
    ) : (
      <span className="stock in">
        <span className="dot" /> {t('In stock')}
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
            <span className="badge good">{t('Target reached')}</span>
          )}
          {/* Only after an actual drop; an unchanged price is trivially the lowest. */}
          {p.lowestPrice !== null && p.lastPrice !== null && p.firstPrice !== null &&
            p.lastPrice <= p.lowestPrice && p.lastPrice < p.firstPrice && (
            <span className="badge good">{t('Lowest ever')}</span>
          )}
          {p.deal && <span className="badge deal">{p.deal}</span>}
          {p.coupon && <span className="badge good">{t('Coupon')}</span>}
          {p.sellerCount > 1 && <span className="badge">{t('{n} sellers', { n: p.sellerCount })}</span>}
          {p.source === 'manual' && <span className="badge">{t('Not in cart')}</span>}
          {p.source === 'saved' && <span className="badge">{t('Saved for later')}</span>}
          {p.source === 'wishlist' && <span className="badge">{t('Wishlist')}</span>}
        </div>
      </div>
      <div className="priceline">
        <span className="big">{fmt(p.lastPrice)}</span>
        {moved !== null && moved !== 0 && <span className="was">{fmt(p.firstPrice)}</span>}
        <ChangePill from={p.firstPrice} to={p.lastPrice} />
        <BuySignal product={p} />
        {p.lastShipping ? <span className="ship">{t('+ {amount} shipping', { amount: fmt(p.lastShipping) })}</span> : null}
        {p.lastImportFees ? <span className="ship">{t('+ {amount} import fees', { amount: fmt(p.lastImportFees) })}</span> : null}
      </div>
      <div className="foot">
        <Sparkline values={p.spark} />
        <span className="when">{timeAgo(p.lastCheckedAt, t)}</span>
        <button className="btn" onClick={onOpen}>
          {t('View details')} <ChevronRight size={15} />
        </button>
      </div>
    </article>
  )
}

/** Amazon search results, as a list: track one here or open it on Amazon. */
function AmazonResults({
  query,
  results,
  error,
  tracked,
  onTrack
}: {
  query: string
  results: SearchResult[] | null
  error?: string
  tracked: Set<string>
  onTrack: (asin: string) => void
}) {
  const { fmt } = useMoney()
  const { t } = useT()
  return (
    <section className="group">
      <h3 className="group-title">
        {t('On Amazon: “{q}”', { q: query })}
        {results && results.length > 0 && <span className="count">· {results.length}</span>}
      </h3>
      {results === null ? (
        <p className="muted searching">
          <Loader2 size={16} className="spin" /> {t('Searching Amazon…')}
        </p>
      ) : error ? (
        <p className="muted">{error}</p>
      ) : results.length === 0 ? (
        <p className="muted">{t('Amazon found nothing for this search.')}</p>
      ) : (
        <div className="card result-list">
          {results.map((r) => (
            <div key={r.asin} className="result">
              <Thumb src={r.image} />
              <div className="info">
                <h4 title={r.title}>{r.title}</h4>
                <div className="meta">
                  {r.rating && (
                    <span>
                      <Star size={13} className="star" /> {r.rating.split(' ')[0]}
                      {r.reviews && <span className="faint"> ({r.reviews})</span>}
                    </span>
                  )}
                  {r.sponsored && <span className="badge">{t('Sponsored')}</span>}
                </div>
              </div>
              <span className="price">{r.price !== null ? fmt(r.price) : '—'}</span>
              <div className="actions">
                <button className="btn" title={t('Open on Amazon')} onClick={() => void window.api.openOnAmazon(r.asin)}>
                  <ExternalLink size={15} />
                </button>
                {tracked.has(r.asin) ? (
                  <span className="tracked">
                    <Check size={15} /> {t('Tracking')}
                  </span>
                ) : (
                  <button className="btn primary" onClick={() => onTrack(r.asin)}>
                    <Plus size={15} /> {t('Track')}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
