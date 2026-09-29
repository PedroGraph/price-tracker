import { useEffect, useMemo, useState } from 'react'
import { Check, ChevronRight, ExternalLink, Loader2, Plus, LayoutGrid, Search, ShoppingBag, ShoppingCart, Star, Table2, X } from 'lucide-react'
import type { Notify } from '../App'
import type { DashboardStats, Product, ProductSource, SaleOutlook, SearchPage, SearchParams, Status } from '@shared/types'
import { useT } from '../i18n'
import { useMoney } from '../money'
import { landedTotal } from '@shared/pricing'
import { BuySignal, ChangePill, DeliveredTotal, Sparkline, Thumb, timeAgo } from '../ui'

type Filter = 'all' | 'down' | 'up' | 'out'

type Tab = 'all' | ProductSource | 'amazon' | `#${string}`

// Where each product comes from, in display order. Labels are English keys.
const TABS: ('all' | ProductSource)[] = ['all', 'cart', 'saved', 'wishlist', 'manual']
const TAB_LABELS: Record<'all' | ProductSource, string> = {
  all: 'All',
  cart: 'In your cart',
  saved: 'Saved for later',
  wishlist: 'Wishlists',
  manual: 'Outside the cart'
}

interface AmazonSearch {
  params: SearchParams
  page: SearchPage | null
  loading: boolean
  error?: string
}

const errorText =(e: unknown): string =>
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
  const [amazon, setAmazon] = useState<AmazonSearch | null>(null)
  // With an Amazon search open, the page switches between it and your own list.
  const [tab, setTab] = useState<Tab>('all')
  const showAmazon = amazon !== null && tab === 'amazon'
  const [layout, setLayoutState] = useState<'grid' | 'table'>(() => {
    try {
      return localStorage.getItem('layout') === 'table' ? 'table' : 'grid'
    } catch {
      return 'grid'
    }
  })
  const setLayout = (l: 'grid' | 'table'): void => {
    setLayoutState(l)
    try {
      localStorage.setItem('layout', l)
    } catch {
      // Only a convenience.
    }
  }

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

  const searchAmazon = async (params: SearchParams): Promise<void> => {
    if (!params.query.trim()) return
    setTab('amazon')
    // Keep the previous page (and its filters) on screen while the new one loads.
    setAmazon((cur) => ({ params, page: cur?.params.query === params.query ? cur.page : null, loading: true }))
    try {
      const page = await window.api.searchAmazon(params)
      setAmazon((cur) => (cur?.params === params ? { params, page, loading: false } : cur))
    } catch (e) {
      setAmazon((cur) => (cur?.params === params ? { ...cur, loading: false, error: errorText(e) } : cur))
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

  const tags = useMemo(() => [...new Set(active.flatMap((p) => p.tags))].sort((a, b) => a.localeCompare(b)), [active])
  const visible = active.filter(
    (p) =>
      FILTERS.find((f) => f.id === filter)!.test(p) &&
      // The search text filters your list while typing, not once it went to Amazon.
      (!query || amazon?.params.query === query.trim() || `${p.title} ${p.asin}`.toLowerCase().includes(query.toLowerCase()))
  )
  const inTab = visible.filter((p) =>
    tab === 'all' || tab === 'amazon' ? true : tab.startsWith('#') ? p.tags.includes(tab.slice(1)) : p.source === tab
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

      <SaleBanner status={status} onOpen={onOpen} />

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
            {!showAmazon && FILTERS.map((f) => (
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
                  if (tab === 'amazon') setTab('all')
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void searchAmazon({ query: query.trim() })
                }}
              />
              {query && (
                <button
                  className="clear"
                  title={t('Clear')}
                  onClick={() => {
                    setQuery('')
                    setAmazon(null)
                    if (tab === 'amazon') setTab('all')
                  }}
                >
                  <X size={15} />
                </button>
              )}
            </label>
          </div>

          <div className="tabs">
            {TABS.map((id) => {
              const count = visible.filter((p) => id === 'all' || p.source === id).length
              if (id !== 'all' && active.every((p) => p.source !== id)) return null
              return (
                <button key={id} className={tab === id ? 'tab on' : 'tab'} onClick={() => setTab(id)}>
                  {t(TAB_LABELS[id])} <span className="count">{count}</span>
                </button>
              )
            })}
            {tags.map((tag) => (
              <button key={tag} className={tab === `#${tag}` ? 'tab on tag-tab' : 'tab tag-tab'} onClick={() => setTab(`#${tag}`)}>
                #{tag} <span className="count">{visible.filter((p) => p.tags.includes(tag)).length}</span>
              </button>
            ))}
            {amazon && (
              <button className={tab === 'amazon' ? 'tab on' : 'tab'} onClick={() => setTab('amazon')}>
                <Search size={14} /> {t('On Amazon: “{q}”', { q: amazon.params.query })}{' '}
                <span className="count">{amazon.page ? amazon.page.results.length : '…'}</span>
              </button>
            )}
            <div className="spacer" />
            {!showAmazon && (
              <div className="view-toggle">
                <button className={layout === 'grid' ? 'on' : ''} onClick={() => setLayout('grid')} title={t('Cards')}>
                  <LayoutGrid size={16} />
                </button>
                <button className={layout === 'table' ? 'on' : ''} onClick={() => setLayout('table')} title={t('Table')}>
                  <Table2 size={16} />
                </button>
              </div>
            )}
          </div>

          {addForm}
          {!showAmazon && layout === 'table' && inTab.length > 0 && <ProductTable products={inTab} onOpen={onOpen} />}
          {!showAmazon &&
            layout === 'grid' &&
            (tab === 'all'
              ? TABS.filter((id) => id !== 'all').map((id) => ({ id, title: t(TAB_LABELS[id]), items: visible.filter((p) => p.source === id) }))
              : [{ id: tab, title: '', items: inTab }]
            ).map(
              (g) =>
                g.items.length > 0 && (
                  <div key={g.id} className="group">
                    {tab === 'all' && (
                      <h3 className="group-title">
                        {g.title} <span className="count">· {g.items.length}</span>
                      </h3>
                    )}
                    <section className="grid">
                      {g.items.map((p) => (
                        <ProductCard key={p.asin} product={p} onOpen={() => onOpen(p.asin)} />
                      ))}
                    </section>
                  </div>
                )
            )}
          {!showAmazon && inTab.length === 0 && <p className="muted empty">{t('Nothing matches this filter.')}</p>}
          {query.trim() && amazon?.params.query !== query.trim() && (
            <p className="amazon-hint muted">
              <Search size={14} /> {t('Press Enter to also search “{q}” on Amazon', { q: query.trim() })}
            </p>
          )}
          {showAmazon && (
            <AmazonResults
              search={amazon}
              tracked={new Set(products.map((p) => p.asin))}
              onTrack={(asin) => void add(asin)}
              onSearch={(params) => void searchAmazon(params)}
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
          <ProductFacts product={p} />
          {p.tags.length > 0 && (
            <div className="card-tags">
              {p.tags.map((tag) => (
                <span key={tag} className="tag">
                  #{tag}
                </span>
              ))}
            </div>
          )}
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
      <DeliveredTotal product={p} />
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

/** Amazon search results as a list, with Amazon's own filters and sort order. */
function AmazonResults({
  search,
  tracked,
  onTrack,
  onSearch
}: {
  search: AmazonSearch
  tracked: Set<string>
  onTrack: (asin: string) => void
  onSearch: (params: SearchParams) => void
}) {
  const { fmt } = useMoney()
  const { t } = useT()
  const { params, page, loading, error } = search
  const [min, setMin] = useState(params.minPrice?.toString() ?? '')
  const [max, setMax] = useState(params.maxPrice?.toString() ?? '')
  const [open, setOpen] = useState<string | null>(null)
  const price = (v: string): number | null => (v.trim() && Number(v) >= 0 ? Number(v) : null)
  const results = page?.results ?? []

  return (
    <section className="group">
      {loading && page && (
        <p className="muted searching">
          <Loader2 size={16} className="spin" /> {t('Updating results…')}
        </p>
      )}

      {page && (
        <div className="card search-filters">
          <div className="filter-row">
            {page.sorts.length > 0 && (
              <label className="field">
                <span>{t('Sort by')}</span>
                <select value={page.sort ?? ''} onChange={(e) => onSearch({ ...params, sort: e.target.value })}>
                  {page.sorts.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <form
              className="field price-range"
              onSubmit={(e) => {
                e.preventDefault()
                onSearch({ ...params, minPrice: price(min), maxPrice: price(max) })
              }}
            >
              <span>{t('Price (USD)')}</span>
              <input type="number" min="0" placeholder={t('Min')} value={min} onChange={(e) => setMin(e.target.value)} />
              <span className="faint">–</span>
              <input type="number" min="0" placeholder={t('Max')} value={max} onChange={(e) => setMax(e.target.value)} />
              <button className="btn" type="submit">
                {t('Apply')}
              </button>
            </form>
          </div>
          {page.filters.map((f) => {
            const expanded = open === f.title
            const shown = expanded ? f.options : f.options.slice(0, 8)
            return (
              <div key={f.title} className="filter-row">
                <span className="filter-title">{f.title}</span>
                <div className="chips">
                  {shown.map((o) => (
                    <button
                      key={o.label}
                      className={o.selected ? 'chip on' : 'chip'}
                      disabled={loading}
                      onClick={() => onSearch({ ...params, rh: o.rh })}
                    >
                      {o.selected && <Check size={13} />} {o.label}
                    </button>
                  ))}
                  {f.options.length > 8 && (
                    <button className="btn link" onClick={() => setOpen(expanded ? null : f.title)}>
                      {expanded ? t('Less') : t('+{n} more', { n: f.options.length - 8 })}
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {!page && loading ? (
        <p className="muted searching">
          <Loader2 size={16} className="spin" /> {t('Searching Amazon…')}
        </p>
      ) : error ? (
        <p className="muted">{error}</p>
      ) : page && results.length === 0 ? (
        <p className="muted">{t('Amazon found nothing for this search.')}</p>
      ) : (
        page && (
          <div className={loading ? 'card result-list loading' : 'card result-list'}>
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
        )
      )}
    </section>
  )
}

/** "Black Friday starts in 12 days": the next big sale and the products most likely to drop in it. */
function SaleBanner({ status, onOpen }: { status: Status | null; onOpen: (asin: string) => void }) {
  const { t, locale } = useT()
  const { fmt } = useMoney()
  const [outlook, setOutlook] = useState<SaleOutlook | null>(null)
  useEffect(() => {
    void window.api.saleOutlook().then(setOutlook)
  }, [status?.lastRunAt])
  if (!outlook) return null
  const { sale, likely } = outlook
  const [y, m, d] = sale.start.split('-').map(Number)
  const date = new Date(y, m - 1, d).toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' })
  const when =
    sale.daysLeft === 0 ? t('starts today') : t(sale.daysLeft === 1 ? 'starts tomorrow' : 'starts in {n} days', { n: sale.daysLeft })
  return (
    <section className="card sale-banner">
      <div className="sale-head">
        <ShoppingBag size={22} />
        <div>
          <h3>
            {sale.name} {when}
          </h3>
          <p className="muted">
            {date}
            {sale.approximate && ` · ${t('approximate date')}`}
          </p>
        </div>
      </div>
      {likely.length > 0 && (
        <div className="sale-likely">
          <span className="muted">{t('Most likely to drop')}</span>
          <div className="chips">
            {likely.map((p) => (
              <button key={p.asin} className="chip" onClick={() => onOpen(p.asin)} title={p.title}>
                {p.title.split(/[,(|]/)[0].slice(0, 40)} · {fmt(p.price)}{' '}
                <span className="faint">{p.drops > 0 ? t(p.drops === 1 ? 'dropped once' : 'dropped {n} times', { n: p.drops }) : t('moves {pct}%', { pct: p.volatility })}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}

type SortKey = 'title' | 'source' | 'price' | 'change' | 'lowest' | 'total' | 'stock' | 'checked'

/** Every product in one sortable table, for comparing many at once. */
function ProductTable({ products, onOpen }: { products: Product[]; onOpen: (asin: string) => void }) {
  const { t } = useT()
  const { fmt } = useMoney()
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'change', desc: false })
  const change = (p: Product): number | null =>
    p.firstPrice && p.lastPrice !== null ? ((p.lastPrice - p.firstPrice) / p.firstPrice) * 100 : null
  const value = (p: Product): string | number | null => {
    switch (sort.key) {
      case 'title':
        return p.title.toLowerCase()
      case 'source':
        return t(TAB_LABELS[p.source])
      case 'price':
        return p.lastPrice
      case 'change':
        return change(p)
      case 'lowest':
        return p.lowestPrice
      case 'total':
        return landedTotal(p.lastPrice, p.lastShipping, p.lastImportFees)
      case 'stock':
        return p.available === null ? null : p.available ? 1 : 0
      case 'checked':
        return p.lastCheckedAt
    }
  }
  // Empty values always go last, whichever the direction.
  const rows = [...products].sort((a, b) => {
    const va = value(a)
    const vb = value(b)
    if (va === null) return vb === null ? 0 : 1
    if (vb === null) return -1
    const cmp = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb))
    return sort.desc ? -cmp : cmp
  })
  const header = (key: SortKey, label: string, num = false) => (
    <th className={num ? 'num' : ''}>
      <button className={sort.key === key ? 'sort on' : 'sort'} onClick={() => setSort({ key, desc: sort.key === key ? !sort.desc : false })}>
        {t(label)} {sort.key === key && (sort.desc ? '▼' : '▲')}
      </button>
    </th>
  )
  return (
    <div className="card table-card">
      <div className="table-scroll">
        <table className="products-table">
          <thead>
            <tr>
              {header('title', 'Product')}
              {header('source', 'Where')}
              {header('price', 'Price', true)}
              {header('change', 'Change', true)}
              {header('lowest', 'Lowest', true)}
              {header('total', 'Delivered', true)}
              {header('stock', 'Stock')}
              {header('checked', 'Checked')}
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const c = change(p)
              return (
                <tr key={p.asin} onClick={() => onOpen(p.asin)}>
                  <td className="product-cell">
                    <Thumb src={p.image} />
                    <span title={p.title}>{p.title}</span>
                  </td>
                  <td className="muted">{t(TAB_LABELS[p.source])}</td>
                  <td className="num mono">{fmt(p.lastPrice)}</td>
                  <td className={`num mono ${c === null || Math.abs(c) < 0.05 ? 'muted' : c < 0 ? 'ok-text' : 'bad-text'}`}>
                    {c === null ? '—' : `${c > 0 ? '+' : ''}${c.toFixed(1)}%`}
                  </td>
                  <td className="num mono">{fmt(p.lowestPrice)}</td>
                  <td className="num mono">{fmt(landedTotal(p.lastPrice, p.lastShipping, p.lastImportFees))}</td>
                  <td className={p.available === false ? 'bad-text' : p.available ? 'ok-text' : 'muted'}>
                    {p.available === null ? '—' : p.available ? t('In stock') : t('Out of stock')}
                  </td>
                  <td className="muted">{timeAgo(p.lastCheckedAt, t)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/** One quiet line: rating, sales rank (with its weekly trend), "only N left" and the purchase. */
function ProductFacts({ product: p }: { product: Product }) {
  const { t, locale } = useT()
  const facts: { text: string; className?: string; title?: string }[] = []
  if (p.stockLeft !== null && p.available) facts.push({ text: t('Only {n} left', { n: p.stockLeft }), className: 'bad-text' })
  if (p.rating !== null) facts.push({ text: `★ ${p.rating.toLocaleString(locale)}${p.reviewCount ? ` (${p.reviewCount.toLocaleString(locale)})` : ''}` })
  if (p.salesRank !== null) {
    // A lower rank number means it sells more.
    const trend = p.rankWeekAgo === null || p.rankWeekAgo === p.salesRank ? '' : p.salesRank < p.rankWeekAgo ? ' ↑' : ' ↓'
    facts.push({
      text: `#${p.salesRank.toLocaleString(locale)}${trend}`,
      title: t('#{rank} in {category}', { rank: p.salesRank.toLocaleString(locale), category: p.rankCategory ?? '' })
    })
  }
  if (p.purchase) facts.push({ text: t('Bought · return until {date}', { date: p.purchase.returnUntil }), className: 'ok-text' })
  if (facts.length === 0) return null
  return (
    <div className="facts">
      {facts.map((f) => (
        <span key={f.text} className={f.className} title={f.title}>
          {f.text}
        </span>
      ))}
    </div>
  )
}
