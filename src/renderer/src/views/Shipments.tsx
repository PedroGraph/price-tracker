import { useEffect, useState } from 'react'
import { ChevronDown, Copy, ExternalLink, PackageCheck, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react'
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

const STORE_STATE: Record<LinkedStore['state'], string> = {
  off: 'Not connected',
  ok: 'Connected',
  login: 'Signed out: sign in again',
  check: 'It asks for a check: open it and solve it',
  error: "Its orders couldn't be read"
}

const cleanError =(e: unknown): string =>
  e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e)

/** What you bought and are waiting for, from any store: who brings it, its tracking number and where it is. */
export function ShipmentsView({ products, onOpen, notify }: { products: Product[]; onOpen: (asin: string) => void; notify: Notify }) {
  const { t, lang } = useT()
  const [shipments, setShipments] = useState<Shipment[] | null>(null)
  // 'new', the id of the shipment being edited, or null when the form is closed.
  const [editing, setEditing] = useState<'new' | number | null>(null)
  const [removing, setRemoving] = useState<number | null>(null)

  const [refreshing, setRefreshing] = useState(false)
  // Whose full history is open.
  const [history, setHistory] = useState<number | null>(null)

  // Also after each background check, which hands the page a new product list.
  useEffect(() => {
    void window.api.listShipments().then(setShipments)
  }, [products])

  const refresh = async (): Promise<void> => {
    setRefreshing(true)
    try {
      setShipments(await window.api.refreshShipments())
    } catch (e) {
      notify(cleanError(e), true)
    } finally {
      setRefreshing(false)
    }
  }
  const [stores, setStores] = useState<LinkedStore[]>([])
  const [connecting, setConnecting] = useState(false)
  const [menu, setMenu] = useState(false)
  useEffect(() => {
    void window.api.listStores().then(setStores)
  }, [products])

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

  const automatic =
    stores.some((s) => s.state !== 'off') ||
    (shipments ?? []).some((s) => s.tracking && s.carrier && AUTO_TRACKED.includes(s.carrier) && s.status !== 'delivered')

  const save = async (id: number | null, input: ShipmentInput): Promise<void> => {
    try {
      setShipments(await window.api.saveShipment(id, input))
      setEditing(null)
    } catch (e) {
      notify(cleanError(e), true)
    }
  }

  const track = (s: Shipment, url: string, direct: boolean): void => {
    window.open(url, '_blank')
    // The carrier's page only has the form: leave the number ready to paste.
    if (!direct && s.tracking) {
      void window.api.copyText(s.tracking).then(() => notify(t('Tracking number copied: paste it on the {carrier} page.', { carrier: carrierName(s.carrier) ?? '' })))
    }
  }

  const input = (s: Shipment): ShipmentInput => ({
    asin: s.asin,
    title: s.title,
    store: s.store,
    forwarder: s.forwarder,
    carrier: s.carrier,
    tracking: s.tracking,
    status: s.status
  })

  return (
    <div className="shipments">
      <div className="ship-head">
        <div>
          <h2>{t('Shipments')}</h2>
          <p className="muted">{t('What you bought and are waiting for, from any store.')}</p>
        </div>
        <div className="row">
          {automatic && (
            <button className="btn" onClick={() => void refresh()} disabled={refreshing}>
              <RefreshCw size={15} className={refreshing ? 'spin' : ''} /> {t('Update now')}
            </button>
          )}
          {editing === null && (
            <button className="btn primary" onClick={() => setEditing('new')}>
              <Plus size={15} /> {t('Add shipment')}
            </button>
          )}
        </div>
      </div>

      <section className="card stores">
        <div className="row between">
          <div>
            <h3>{t('Store accounts')}</h3>
            <p className="sub">{t('Connect a store and its orders show up here by themselves, with their tracking.')}</p>
          </div>
          {stores.some((s) => s.state === 'off') && (
            // Closes when the focus leaves it: a click elsewhere, or Tab.
            <div className="menu" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setMenu(false)}>
              <button className="btn" disabled={connecting} aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)}>
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
          )}
        </div>
        {stores
          .filter((s) => s.state !== 'off')
          .map((s) => (
          <div key={s.id} className="store-row">
            <strong>{s.name}</strong>
            <span className={s.state === 'ok' ? 'ok-text' : s.state === 'off' ? 'muted' : 'warn-text'}>
              {t(STORE_STATE[s.state])}
              {s.state === 'ok' && s.syncedAt && <span className="muted"> · {t('read {when}', { when: timeAgo(s.syncedAt, t) })}</span>}
            </span>
            <div className="spacer" />
            <button className="btn link" onClick={() => void window.api.disconnectStore(s.id).then(setStores)}>
              {t('Disconnect')}
            </button>
            {s.state !== 'ok' && (
              <button className="btn" disabled={connecting} onClick={() => void connect(s.id)}>
                {t('Open {store}', { store: s.name })}
              </button>
            )}
          </div>
        ))}
        {connecting && <p className="hint">{t('Sign in in the window that opened and close it when you see your orders.')}</p>}
      </section>

      {editing === 'new' && <ShipmentForm products={products} onSave={(s) => save(null, s)} onCancel={() => setEditing(null)} />}

      {shipments !== null && shipments.length === 0 && editing === null && (
        <div className="empty">
          <PackageCheck size={34} className="faint" />
          <h2>{t('Bought something?')}</h2>
          <p className="muted">{t('Add it here with its tracking number and keep every shipment in one place.')}</p>
          <button className="btn primary" onClick={() => setEditing('new')}>
            <Plus size={15} /> {t('Add shipment')}
          </button>
        </div>
      )}

      {(shipments ?? []).map((s) => {
        if (editing === s.id) {
          return <ShipmentForm key={s.id} initial={s} products={products} onSave={(next) => save(s.id, next)} onCancel={() => setEditing(null)} />
        }
        const link = trackingLink(s.carrier, s.tracking)
        const store = STORES.find((x) => x.name === s.store)
        const product = s.asin ? products.find((p) => p.asin === s.asin) : undefined
        return (
          <article key={s.id} className={s.status === 'delivered' ? 'card shipment done' : 'card shipment'}>
            <div className="row between">
              <div style={{ minWidth: 0 }}>
                <h3 title={s.title}>{s.title}</h3>
                <p className="route">
                  {[s.store, s.forwarder, carrierName(s.carrier)].filter(Boolean).join(' → ')}
                  <span className="faint"> · {timeAgo(s.updatedAt, t)}</span>
                </p>
              </div>
              <div className="row">
                <button className="icon-btn small" title={t('Edit')} aria-label={t('Edit')} onClick={() => setEditing(s.id)}>
                  <Pencil size={14} />
                </button>
                {removing === s.id ? (
                  <button
                    className="btn small bad-text"
                    onBlur={() => setRemoving(null)}
                    onClick={() => void window.api.removeShipment(s.id).then(setShipments)}
                  >
                    {t('Delete it?')}
                  </button>
                ) : (
                  <button className="icon-btn small" title={t('Remove')} aria-label={t('Remove')} onClick={() => setRemoving(s.id)}>
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            </div>

            {s.live && (
              <div className="live">
                {s.live.state && (
                  <div className="live-state">
                    <strong>{s.live.state}</strong>
                    <span className="muted">
                      {[s.live.from && s.live.to ? `${s.live.from} → ${s.live.to}` : null, s.live.eta ? t('Estimated delivery: {date}', { date: s.live.eta }) : null]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </div>
                )}
                {s.live.blocked && (
                  <p className="hint warn-text">{t('{carrier} asks for a check on its page: open it there to see the latest.', { carrier: carrierName(s.carrier) ?? '' })}</p>
                )}
                {s.live.events.length > 0 && (
                  <ul className="events">
                    {(history === s.id ? s.live.events : s.live.events.slice(0, 2)).map((e) => (
                      <li key={`${e.at}${e.text}`}>
                        <time>{e.at}</time>
                        <span>
                          {e.text}
                          {e.place && <span className="muted"> · {e.place}</span>}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="hint">
                  {t('Read from {source} {when}.', { source: s.live.by ?? carrierName(s.carrier) ?? '', when: timeAgo(s.live.checkedAt, t) })}
                  {s.live.events.length > 2 && (
                    <>
                      {' '}
                      <button className="btn link" onClick={() => setHistory(history === s.id ? null : s.id)}>
                        {history === s.id ? t('Less') : t('Full history')}
                      </button>
                    </>
                  )}
                </p>
              </div>
            )}

            <Segmented
              options={SHIPMENT_STATUSES.map((value) => ({ value, label: t(STATUS_LABEL[value]) }))}
              value={s.status}
              onChange={(status) => void save(s.id, { ...input(s), status })}
            />

            <div className="actions">
              {s.tracking ? (
                <span className="guide">
                  <span className="muted">{t('Tracking number')}</span> <strong className="mono">{s.tracking}</strong>
                  <button
                    className="icon-btn small"
                    title={t('Copy')}
                    aria-label={t('Copy')}
                    onClick={() => void window.api.copyText(s.tracking!).then(() => notify(t('Tracking number copied.')))}
                  >
                    <Copy size={14} />
                  </button>
                </span>
              ) : (
                <button className="btn link" onClick={() => setEditing(s.id)}>
                  {t('Add the tracking number')}
                </button>
              )}
              <div className="spacer" />
              {link && (
                <button className="btn small" onClick={() => track(s, link.url, link.direct)}>
                  {t('Track on {carrier}', { carrier: carrierName(s.carrier) ?? '' })} <ExternalLink size={13} />
                </button>
              )}
              {s.tracking && (
                <a className="btn small" href={universalLink(s.tracking, lang)} target="_blank" rel="noreferrer">
                  17TRACK <ExternalLink size={13} />
                </a>
              )}
              {store && (
                <a className="btn small" href={store.orders} target="_blank" rel="noreferrer">
                  {t('Open {store}', { store: store.name })} <ExternalLink size={13} />
                </a>
              )}
              {product && (
                <button className="btn small" onClick={() => onOpen(product.asin)}>
                  {t('View details')}
                </button>
              )}
            </div>
          </article>
        )
      })}
    </div>
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
  const valid = title.trim() !== '' && store.trim() !== '' && (via === 'direct' || (forwarder.trim() !== '' && carrier.trim() !== ''))

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
    <div className="card ship-form">
      <label className="field-label">{t('What did you buy?')}</label>
      <input type="text" autoFocus={!initial} maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
      {tracked.length > 0 && (
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

      <label className="field-label">{via === 'forwarder' ? t('Which carrier brings it?') : t('Which carrier brings it? (optional)')}</label>
      <Choice options={CARRIERS.map((c) => ({ value: c.id, label: c.name }))} value={carrier} onChange={setCarrier} />
      {via === 'direct' && <p className="hint">{t('Leave it empty if the store tracks it in your account.')}</p>}

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

      <div className="row" style={{ marginTop: 16 }}>
        <button className="btn primary" disabled={!valid || busy} onClick={() => void submit()}>
          {t('Save')}
        </button>
        <button className="btn link" onClick={onCancel}>
          {t('Cancel')}
        </button>
      </div>
    </div>
  )
}
