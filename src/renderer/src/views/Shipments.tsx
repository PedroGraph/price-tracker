import { useEffect, useState } from 'react'
import {
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  ExternalLink,
  FileCheck,
  Home,
  Mailbox,
  Package,
  PackageCheck,
  Pencil,
  Plane,
  Plus,
  RefreshCw,
  ShoppingBag,
  ShoppingCart,
  Store,
  Trash2,
  Truck,
  Unplug
} from 'lucide-react'
import { AUTO_TRACKED, CARRIERS, carrierName, FORWARDERS, SHIPMENT_STATUSES, STORES, trackingLink, universalLink } from '@shared/shipping'
import type { LinkedStore, Product, Shipment, ShipmentInput, ShipmentStatus } from '@shared/types'
import type { Notify } from '../App'
import { useT } from '../i18n'
import { Segmented, timeAgo } from '../ui'

// English keys, translated where shown.
const STATUS_LABEL: Record<ShipmentStatus, string> = {
  ordered: 'Ordered',
  transit: 'On the way',
  customs: 'In customs',
  delivering: 'Out for delivery',
  // Not 'Delivered': that key is the delivered total (price + shipping + fees).
  delivered: 'Received'
}

const STATUS_ICON: Record<ShipmentStatus, typeof Plane> = {
  ordered: ShoppingBag,
  transit: Plane,
  customs: FileCheck,
  delivering: Truck,
  delivered: Home
}

const STORE_STATE: Record<LinkedStore['state'], string> = {
  off: 'Not connected',
  ok: 'Connected',
  login: 'Signed out: sign in again',
  check: 'It asks for a check: open it and solve it',
  error: "Its orders couldn't be read"
}

/** Amazon is a cart, a forwarder is a mailbox, any other shop a storefront. */
const storeIcon = (name: string): typeof Plane => (name === 'Amazon' ? ShoppingCart : FORWARDERS.includes(name) ? Mailbox : Store)

const cleanError = (e: unknown): string =>
  e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e)

const DAY = 86_400_000

/** What you bought and are waiting for, from any store: who brings it, its tracking number and where it is. */
export function ShipmentsView({ products, onOpen, notify }: { products: Product[]; onOpen: (asin: string) => void; notify: Notify }) {
  const { t } = useT()
  const [shipments, setShipments] = useState<Shipment[] | null>(null)
  // 'new', the id of the shipment being edited, or null when the form is closed.
  const [editing, setEditing] = useState<'new' | number | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  // Which cards are unfolded; until one is touched, the latest one still on its way.
  const [open, setOpen] = useState<Set<number> | null>(null)
  const [stores, setStores] = useState<LinkedStore[]>([])
  const [connecting, setConnecting] = useState(false)
  const [menu, setMenu] = useState(false)

  // Also after each background check, which hands the page a new product list.
  useEffect(() => {
    void window.api.listShipments().then(setShipments)
    void window.api.listStores().then(setStores)
  }, [products])

  const refresh = async (): Promise<void> => {
    setRefreshing(true)
    try {
      setShipments(await window.api.refreshShipments())
      setStores(await window.api.listStores())
    } catch (e) {
      notify(cleanError(e), true)
    } finally {
      setRefreshing(false)
    }
  }

  // Resolves when the sign-in window is closed and the store's orders were read.
  const connect = async (id: LinkedStore['id']): Promise<void> => {
    setConnecting(true)
    try {
      setStores(await window.api.connectStore(id))
      setShipments(await window.api.listShipments())
    } catch (e) {
      notify(cleanError(e), true)
    } finally {
      setConnecting(false)
    }
  }

  const save = async (id: number | null, input: ShipmentInput): Promise<void> => {
    try {
      setShipments(await window.api.saveShipment(id, input))
      setEditing(null)
    } catch (e) {
      notify(cleanError(e), true)
    }
  }

  const list = shipments ?? []
  const onTheWay = list.filter((s) => s.status !== 'delivered')
  const delivered = list.filter((s) => s.status === 'delivered')
  const days = delivered.flatMap((s) => (s.deliveredAt ? [(Date.parse(s.deliveredAt) - Date.parse(s.createdAt)) / DAY] : []))
  const connected = stores.filter((s) => s.state !== 'off')
  const automatic = connected.length > 0 || onTheWay.some((s) => s.tracking && s.carrier && AUTO_TRACKED.includes(s.carrier))
  const isOpen = (s: Shipment): boolean => (open ? open.has(s.id) : s.id === onTheWay[0]?.id)
  const toggle = (s: Shipment): void => {
    const next = new Set(open ?? (onTheWay[0] ? [onTheWay[0].id] : []))
    if (!next.delete(s.id)) next.add(s.id)
    setOpen(next)
  }
  const editingShipment = typeof editing === 'number' ? list.find((s) => s.id === editing) : undefined

  return (
    <div className="shipments">
      <section className="stats">
        <div className="card stat">
          <label>{t('On the way')}</label>
          <div className="value teal">{onTheWay.length}</div>
          <small>
            {onTheWay.length > 0 && <span className="pulse" />}
            {t('Active now')}
          </small>
        </div>
        <div className="card stat">
          <label>{t('Delivered shipments')}</label>
          <div className="value">{delivered.length}</div>
          <small>{t('since you started')}</small>
        </div>
        <div className="card stat">
          <label>{t('Average days')}</label>
          <div className="value amber">{days.length ? Math.max(1, Math.round(days.reduce((a, b) => a + b, 0) / days.length)) : '—'}</div>
          <small>{t('from the day it was added to delivery')}</small>
        </div>
        <div className="card stat">
          <label>{t('Store accounts')}</label>
          <div className="value purple">{connected.length}</div>
          <small>{t('of {n} you can connect', { n: stores.length })}</small>
        </div>
      </section>

      <div className="section-hd">
        <div>
          <h2>{t('Store accounts')}</h2>
          <p>{t('Connect a store and its orders show up here by themselves, with their tracking.')}</p>
        </div>
      </div>
      <div className="stores-grid">
        {connected.map((s) => {
          const Icon = storeIcon(s.name)
          return (
            <div key={s.id} className="card store-card">
              <div className="store-icon">
                <Icon size={20} />
              </div>
              <div className="who">
                <strong>{s.name}</strong>
                <small className={s.state === 'ok' ? '' : 'warn-text'} title={t(STORE_STATE[s.state])}>
                  {s.state === 'ok' ? t('read {when}', { when: timeAgo(s.syncedAt, t) }) : t(STORE_STATE[s.state])}
                </small>
              </div>
              {s.state !== 'ok' && (
                <button className="btn small" disabled={connecting} onClick={() => void connect(s.id)}>
                  {t('Open')}
                </button>
              )}
              <button className="trash" title={t('Disconnect')} aria-label={t('Disconnect')} onClick={() => void window.api.disconnectStore(s.id).then(setStores)}>
                <Unplug size={13} />
              </button>
              <span className={s.state === 'ok' ? 'store-dot' : 'store-dot warn'} />
            </div>
          )
        })}
        {stores.some((s) => s.state === 'off') && (
          <div className="card store-card store-add">
            {/* Closes when the focus leaves it: a click elsewhere, or Tab. */}
            <div className="menu" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setMenu(false)}>
              <button disabled={connecting} aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)}>
                <Plus size={15} /> {t('Connect a store')} <ChevronDown size={15} />
              </button>
              {menu && (
                <div className="menu-list card" role="menu">
                  {stores
                    .filter((s) => s.state === 'off')
                    .map((s) => (
                      <button
                        key={s.id}
                        role="menuitem"
                        onClick={() => {
                          setMenu(false)
                          void connect(s.id)
                        }}
                      >
                        {s.name}
                      </button>
                    ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      {connecting && <p className="hint">{t('Sign in in the window that opened and close it when you see your orders.')}</p>}

      <div className="section-hd">
        <div>
          <h2>{t('My shipments')}</h2>
          <p>{t(onTheWay.length === 1 ? '{n} package on its way' : '{n} packages on their way', { n: onTheWay.length })}</p>
        </div>
        <div className="row">
          {automatic && (
            <button className="btn" onClick={() => void refresh()} disabled={refreshing}>
              <RefreshCw size={14} className={refreshing ? 'spin' : ''} /> {t('Update now')}
            </button>
          )}
          <button className={connected.length > 0 ? 'btn' : 'btn primary'} onClick={() => setEditing('new')}>
            <Plus size={14} /> {t(connected.length > 0 ? 'Add one by hand' : 'Add shipment')}
          </button>
        </div>
      </div>

      {shipments !== null && list.length === 0 && (
        <div className="empty">
          <PackageCheck size={34} className="faint" />
          <h2>{t('Bought something?')}</h2>
          <p className="muted">{t('Add it here with its tracking number and keep every shipment in one place.')}</p>
        </div>
      )}

      {list.map((s) => (
        <ShipmentCard
          key={s.id}
          shipment={s}
          product={s.asin ? products.find((p) => p.asin === s.asin) : undefined}
          open={isOpen(s)}
          onToggle={() => toggle(s)}
          onStatus={(status) => void save(s.id, { asin: s.asin, title: s.title, store: s.store, forwarder: s.forwarder, carrier: s.carrier, tracking: s.tracking, status })}
          onEdit={() => setEditing(s.id)}
          onRemove={() => void window.api.removeShipment(s.id).then(setShipments)}
          onOpenProduct={onOpen}
          notify={notify}
        />
      ))}

      {editing !== null && (editing === 'new' || editingShipment) && (
        <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && setEditing(null)} onKeyDown={(e) => e.key === 'Escape' && setEditing(null)}>
          <div className="card modal form" role="dialog" aria-modal="true" aria-label={t(editing === 'new' ? 'New shipment' : 'Edit')}>
            <h2>{t(editing === 'new' ? 'New shipment' : 'Edit')}</h2>
            <ShipmentForm
              key={editing}
              initial={editingShipment}
              products={products}
              onSave={(next) => save(editing === 'new' ? null : editing, next)}
              onCancel={() => setEditing(null)}
            />
          </div>
        </div>
      )}
    </div>
  )
}

/** One shipment: a line that unfolds into its five steps, what the carrier says and its movements. */
function ShipmentCard({
  shipment: s,
  product,
  open,
  onToggle,
  onStatus,
  onEdit,
  onRemove,
  onOpenProduct,
  notify
}: {
  shipment: Shipment
  product: Product | undefined
  open: boolean
  onToggle: () => void
  onStatus: (status: ShipmentStatus) => void
  onEdit: () => void
  onRemove: () => void
  onOpenProduct: (asin: string) => void
  notify: Notify
}) {
  const { t, lang } = useT()
  const [history, setHistory] = useState(false)
  const [removing, setRemoving] = useState(false)
  const step = SHIPMENT_STATUSES.indexOf(s.status)
  // The parcel starts at the left and travels to its step once the card is on screen.
  const [travelled, setTravelled] = useState(0)
  useEffect(() => {
    if (!open) return setTravelled(0)
    const timer = window.setTimeout(() => setTravelled((step / (SHIPMENT_STATUSES.length - 1)) * 100), 80)
    return () => clearTimeout(timer)
  }, [open, step])

  const Icon = storeIcon(s.forwarder ?? s.store)
  const link = trackingLink(s.carrier, s.tracking)
  const store = STORES.find((x) => x.name === s.store)
  const route = [s.store, s.forwarder, carrierName(s.carrier)].filter(Boolean).join(' → ')
  const events = s.live?.events ?? []

  const track = (url: string, direct: boolean): void => {
    window.open(url, '_blank')
    // The carrier's page only has the form: leave the number ready to paste.
    if (!direct && s.tracking) {
      void window.api.copyText(s.tracking).then(() => notify(t('Tracking number copied: paste it on the {carrier} page.', { carrier: carrierName(s.carrier) ?? '' })))
    }
  }

  return (
    <article className={s.status === 'delivered' ? 'card ship-card done' : 'card ship-card'}>
      <button className="sc-head" aria-expanded={open} onClick={onToggle}>
        <div className="sc-icon">
          <Icon size={18} />
        </div>
        <div className="sc-meta">
          <div className="sc-name" title={s.title}>
            {s.title}
          </div>
          <div className="sc-sub">
            {s.tracking && <span className="mono">{s.tracking} · </span>}
            {route}
            {route && ' · '}
            {timeAgo(s.updatedAt, t)}
          </div>
        </div>
        <span className={`status-badge ${s.status}`}>{t(STATUS_LABEL[s.status])}</span>
        <span className={open ? 'sc-toggle open' : 'sc-toggle'}>
          <ChevronDown size={15} />
        </span>
      </button>

      {open && (
        <div className="sc-body">
          {/* The five steps; clicking one sets it by hand. */}
          <div className="rail">
            {SHIPMENT_STATUSES.map((status, i) => {
              const StepIcon = i < step ? Check : STATUS_ICON[status]
              return (
                <button
                  key={status}
                  className={i < step ? 'step done' : i === step ? 'step active' : 'step'}
                  title={t('Mark as: {status}', { status: t(STATUS_LABEL[status]) })}
                  onClick={() => status !== s.status && onStatus(status)}
                >
                  <div className="bubble">
                    <StepIcon size={15} />
                  </div>
                  <span>{t(STATUS_LABEL[status])}</span>
                </button>
              )
            })}
          </div>
          <div className="travel" aria-hidden>
            <i style={{ width: `${travelled}%` }} />
            <b className={s.status === 'delivered' && travelled === 100 ? 'arrived' : ''} style={{ left: `${travelled}%` }}>
              {s.status === 'delivered' ? '🎁' : '📦'}
            </b>
          </div>

          {s.live && (
            <>
              <div className="eta-chips">
                {s.live.state && <span className="eta-chip state">{s.live.state}</span>}
                {s.live.eta && <span className="eta-chip">{t('Estimated delivery: {date}', { date: s.live.eta })}</span>}
                {s.live.from && s.live.to && (
                  <span className="eta-chip">
                    {s.live.from} → {s.live.to}
                  </span>
                )}
                {s.live.blocked && (
                  <span className="eta-chip warn">{t('{carrier} asks for a check on its page: open it there to see the latest.', { carrier: carrierName(s.carrier) ?? '' })}</span>
                )}
              </div>
              {events.length > 0 && (
                <button className="expand" aria-expanded={history} onClick={() => setHistory(!history)}>
                  {history ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  {history ? t('Hide the history') : t('See the history of movements ({n})', { n: events.length })}
                </button>
              )}
              {/* Folded, the latest movement stays in sight. */}
              {events.length > 0 && (
                <ul className="timeline">
                  {(history ? events : events.slice(0, 1)).map((e) => (
                    <li key={`${e.at}${e.text}`}>
                      <i />
                      <div>
                        <strong>{e.text}</strong>
                        {e.at && <time>{e.at}</time>}
                        {e.place && <small>{e.place}</small>}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              <p className="hint">{t('Read from {source} {when}.', { source: s.live.by ?? carrierName(s.carrier) ?? '', when: timeAgo(s.live.checkedAt, t) })}</p>
            </>
          )}

          <div className="sc-actions">
            {s.tracking ? (
              <span className="guide">
                {t('Tracking number')} <strong className="mono">{s.tracking}</strong>
                <button
                  className="icon-btn small"
                  title={t('Copy')}
                  aria-label={t('Copy')}
                  onClick={() => void window.api.copyText(s.tracking!).then(() => notify(t('Tracking number copied.')))}
                >
                  <Copy size={13} />
                </button>
              </span>
            ) : (
              <button className="btn link" onClick={onEdit}>
                {t('Add the tracking number')}
              </button>
            )}
            <div className="spacer" />
            {link && (
              <button className="btn small" onClick={() => track(link.url, link.direct)}>
                {t('Track on {carrier}', { carrier: carrierName(s.carrier) ?? '' })} <ExternalLink size={12} />
              </button>
            )}
            {s.tracking && (
              <a className="btn small" href={universalLink(s.tracking, lang)} target="_blank" rel="noreferrer">
                17TRACK <ExternalLink size={12} />
              </a>
            )}
            {store && (
              <a className="btn small" href={store.orders} target="_blank" rel="noreferrer">
                {t('Open {store}', { store: store.name })} <ExternalLink size={12} />
              </a>
            )}
            {product && (
              <button className="btn small" onClick={() => onOpenProduct(product.asin)}>
                <Package size={12} /> {t('View details')}
              </button>
            )}
            <button className="icon-btn small" title={t('Edit')} aria-label={t('Edit')} onClick={onEdit}>
              <Pencil size={13} />
            </button>
            {removing ? (
              <button className="btn small bad-text" autoFocus onBlur={() => setRemoving(false)} onClick={onRemove}>
                {t('Delete it?')}
              </button>
            ) : (
              <button className="trash" title={t('Remove')} aria-label={t('Remove')} onClick={() => setRemoving(true)}>
                <Trash2 size={13} />
              </button>
            )}
          </div>
        </div>
      )}
    </article>
  )
}

/** Chips for the well-known choices, plus "Other" with a field to type any name. */
function Choice({ options, value, onChange }: { options: { value: string; label: string }[]; value: string; onChange: (v: string) => void }) {
  const { t } = useT()
  const [other, setOther] = useState(value !== '' && !options.some((o) => o.value === value))
  return (
    <div className="chips">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={!other && value === o.value ? 'chip on' : 'chip'}
          onClick={() => {
            setOther(false)
            onChange(o.value)
          }}
        >
          {o.label}
        </button>
      ))}
      <button
        type="button"
        className={other ? 'chip on' : 'chip'}
        onClick={() => {
          setOther(true)
          onChange('')
        }}
      >
        {t('Other')}
      </button>
      {other && <input type="text" className="short" autoFocus maxLength={40} value={value} onChange={(e) => onChange(e.target.value)} />}
    </div>
  )
}

const named = (names: string[]): { value: string; label: string }[] => names.map((n) => ({ value: n, label: n }))

function ShipmentForm({
  initial,
  products,
  onSave,
  onCancel
}: {
  initial?: Shipment
  products: Product[]
  onSave: (s: ShipmentInput) => Promise<void>
  onCancel: () => void
}) {
  const { t } = useT()
  const [title, setTitle] = useState(initial?.title ?? '')
  const [asin, setAsin] = useState(initial?.asin ?? '')
  const [store, setStore] = useState(initial?.store ?? '')
  const [via, setVia] = useState<'direct' | 'forwarder'>(initial?.forwarder ? 'forwarder' : 'direct')
  const [forwarder, setForwarder] = useState(initial?.forwarder ?? '')
  const [carrier, setCarrier] = useState(initial?.carrier ?? '')
  const [tracking, setTracking] = useState(initial?.tracking ?? '')
  const [busy, setBusy] = useState(false)

  const tracked = products.filter((p) => p.active || p.asin === asin).sort((a, b) => a.title.localeCompare(b.title))
  // Open when editing a shipment that has any of it filled in.
  const [more, setMore] = useState(!!initial && (!!initial.store || !!initial.forwarder || !!initial.asin))
  const valid = title.trim() !== '' && (via === 'direct' || (forwarder.trim() !== '' && carrier.trim() !== ''))

  const pickProduct = (next: string): void => {
    setAsin(next)
    const product = products.find((p) => p.asin === next)
    if (!product) return
    if (!title.trim()) setTitle(product.title)
    if (!store) setStore('Amazon')
  }

  const submit = async (): Promise<void> => {
    if (!valid || busy) return
    setBusy(true)
    await onSave({
      asin: asin || null,
      title,
      store,
      forwarder: via === 'forwarder' ? forwarder : null,
      carrier: carrier || null,
      tracking: tracking || null,
      status: initial?.status ?? 'ordered'
    })
    setBusy(false)
  }

  return (
    <div className="ship-form">
      <label className="field-label">{t('What did you buy?')}</label>
      <input type="text" autoFocus={!initial} maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
      <label className="field-label">{via === 'forwarder' ? t('Which carrier brings it?') : t('Which carrier brings it? (optional)')}</label>
      <Choice options={CARRIERS.map((c) => ({ value: c.id, label: c.name }))} value={carrier} onChange={setCarrier} />

      <label className="field-label">{t('Tracking number (you can add it later)')}</label>
      <input
        type="text"
        className="mono"
        style={{ maxWidth: 380 }}
        maxLength={80}
        value={tracking}
        onChange={(e) => setTracking(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && void submit()}
      />

      {/* The rest only describes the shipment: folded away until asked for. */}
      <button className="btn link more" aria-expanded={more} onClick={() => setMore(!more)}>
        {more ? <ChevronUp size={15} /> : <ChevronDown size={15} />} {t('Store and forwarder')}
      </button>
      {more && tracked.length > 0 && (
        <label className="field">
          <span className="muted">{t('One of your tracked products (optional)')}</span>
          <select value={asin} onChange={(e) => pickProduct(e.target.value)}>
            <option value="">—</option>
            {tracked.map((p) => (
              <option key={p.asin} value={p.asin}>
                {p.title.slice(0, 70)}
              </option>
            ))}
          </select>
        </label>
      )}

      {more && (
        <>
          <label className="field-label">{t('Where did you buy it?')}</label>
          <Choice options={named(STORES.map((s) => s.name))} value={store} onChange={setStore} />

          <label className="field-label">{t('How does it get to you?')}</label>
          <Segmented
        options={[
          { value: 'direct', label: t('The store ships it to me') },
          { value: 'forwarder', label: t('Through a forwarder (US mailbox)') }
        ]}
        value={via}
        onChange={setVia}
      />
          {via === 'forwarder' && (
            <div style={{ marginTop: 10 }}>
              <Choice options={named(FORWARDERS)} value={forwarder} onChange={setForwarder} />
            </div>
          )}
        </>
      )}

      <div className="row" style={{ marginTop: 20, justifyContent: 'flex-end' }}>
        <button className="btn" onClick={onCancel}>
          {t('Cancel')}
        </button>
        <button className="btn primary" disabled={!valid || busy} onClick={() => void submit()}>
          {t('Save')}
        </button>
      </div>
    </div>
  )
}
