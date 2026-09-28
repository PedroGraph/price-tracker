import { useEffect, useRef, useState } from 'react'
import { Bell, ExternalLink, Loader2, Plus, RefreshCw, TicketPercent, X } from 'lucide-react'
import type { AlertItem, Status, Suggestion } from '@shared/types'
import { useT } from './i18n'
import { useMoney } from './money'
import { EVENT_LABEL, Thumb, timeAgo } from './ui'

type Tab = 'alerts' | 'coupons'

/**
 * The bell in the top bar, the app's notification center: every alert of the last 30 days
 * (price moves, stock, targets, coupons on tracked products) and coupons on products
 * related to the cart, which the main process looks for every 30 minutes.
 */
export function Notifications({
  status,
  onTrack,
  onOpen
}: {
  status: Status | null
  onTrack: (asin: string) => Promise<void>
  onOpen: (asin: string) => void
}) {
  const { t } = useT()
  const { fmt } = useMoney()
  const [alerts, setAlerts] = useState<AlertItem[]>([])
  const [seenAt, setSeenAt] = useState<string | null>(null)
  const [coupons, setCoupons] = useState<Suggestion[]>([])
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<Tab>('alerts')
  const [refreshing, setRefreshing] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  // Reload whenever a check finishes (the status changes), which is when new ones appear.
  useEffect(() => {
    void window.api.listSuggestions().then(setCoupons)
    void window.api.listAlerts().then((r) => {
      setAlerts(r.alerts)
      setSeenAt(r.seenAt)
    })
  }, [status?.lastRunAt, status?.running])

  // Close when clicking outside the panel.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (box.current && !box.current.contains(e.target as Node)) close()
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  })

  const isUnread = (a: AlertItem): boolean => !seenAt || a.createdAt > seenAt
  const unread = alerts.filter(isUnread).length
  const badge = unread + coupons.length

  // Opening the panel marks the alerts as seen; they stay highlighted until it closes.
  const close = (): void => {
    setOpen(false)
    void window.api.listAlerts().then((r) => setSeenAt(r.seenAt))
  }
  const toggle = (): void => {
    if (open) return close()
    setOpen(true)
    setTab(unread > 0 || coupons.length === 0 ? 'alerts' : 'coupons')
    if (unread > 0) void window.api.markAlertsSeen()
  }

  const dismiss = (asin: string): void => {
    setCoupons((list) => list.filter((s) => s.asin !== asin))
    void window.api.dismissSuggestion(asin)
  }

  const refresh = async (): Promise<void> => {
    setRefreshing(true)
    try {
      setCoupons(await window.api.refreshSuggestions())
    } finally {
      setRefreshing(false)
    }
  }

  const detail = (a: AlertItem): string | null => {
    if ((a.type === 'price_down' || a.type === 'price_up') && a.oldPrice !== null && a.newPrice !== null) {
      const pct = ((a.newPrice - a.oldPrice) / a.oldPrice) * 100
      return `${fmt(a.oldPrice)} → ${fmt(a.newPrice)} (${pct > 0 ? '+' : ''}${pct.toFixed(1)}%)`
    }
    return a.newPrice !== null && a.type !== 'out_of_stock' ? fmt(a.newPrice) : null
  }

  // Coupons grouped by the cart product they relate to.
  const groups = coupons.reduce<{ forAsin: string; forTitle: string; items: Suggestion[] }[]>((acc, s) => {
    const g = acc.find((x) => x.forAsin === s.forAsin)
    if (g) g.items.push(s)
    else acc.push({ forAsin: s.forAsin, forTitle: s.forTitle, items: [s] })
    return acc
  }, [])

  return (
    <div className="notif" ref={box}>
      <button className="icon-btn" onClick={toggle} aria-label={t('Notifications')} title={t('Notifications')}>
        <Bell size={18} />
        {badge > 0 && <span className="notif-count">{badge > 9 ? '9+' : badge}</span>}
      </button>
      {open && (
        <div className="notif-panel card">
          <div className="notif-tabs">
            <button className={tab === 'alerts' ? 'tab on' : 'tab'} onClick={() => setTab('alerts')}>
              {t('Alerts')} {unread > 0 && <span className="count">{unread}</span>}
            </button>
            <button className={tab === 'coupons' ? 'tab on' : 'tab'} onClick={() => setTab('coupons')}>
              {t('Coupons for you')} {coupons.length > 0 && <span className="count">{coupons.length}</span>}
            </button>
            <div className="spacer" />
            {tab === 'coupons' && (
              <button className="icon-btn" onClick={() => void refresh()} disabled={refreshing} title={t('Look again')}>
                <RefreshCw size={16} className={refreshing ? 'spin' : ''} />
              </button>
            )}
          </div>

          <div className="notif-body">
            {tab === 'alerts' ? (
              alerts.length === 0 ? (
                <p className="muted notif-empty">{t('No alerts in the last 30 days.')}</p>
              ) : (
                alerts.map((a) => (
                  <button
                    key={a.id}
                    className={isUnread(a) ? 'notif-item alert unread' : 'notif-item alert'}
                    onClick={() => {
                      close()
                      onOpen(a.asin)
                    }}
                  >
                    <Thumb src={a.image} />
                    <div className="info">
                      <span className={`notif-type ${a.type}`}>{t(EVENT_LABEL[a.type])}</span>
                      <h4 title={a.title}>{a.title}</h4>
                      <div className="meta">
                        {detail(a) && <span className="price">{detail(a)}</span>}
                        <span className="faint">{timeAgo(a.createdAt, t)}</span>
                      </div>
                    </div>
                  </button>
                ))
              )
            ) : refreshing && coupons.length === 0 ? (
              <p className="muted searching notif-empty">
                <Loader2 size={16} className="spin" /> {t('Looking for coupons…')}
              </p>
            ) : coupons.length === 0 ? (
              <p className="muted notif-empty">{t('No coupons on related products right now. The app looks again every 30 minutes.')}</p>
            ) : (
              <>
                <p className="muted notif-note">{t('Related to what’s in your cart, with a coupon right now.')}</p>
                {groups.map((g) => (
                  <div key={g.forAsin} className="notif-group">
                    <p className="notif-for" title={g.forTitle}>
                      {t('Like {title}', { title: g.forTitle })}
                    </p>
                    {g.items.map((s) => (
                      <div key={s.asin} className="notif-item">
                        <Thumb src={s.image} />
                        <div className="info">
                          <h4 title={s.title}>{s.title}</h4>
                          <div className="meta">
                            <span className="coupon">
                              <TicketPercent size={13} /> {s.coupon}
                            </span>
                            {s.price !== null && <span className="price">{fmt(s.price)}</span>}
                          </div>
                        </div>
                        <div className="actions">
                          <button className="btn" title={t('Open on Amazon')} onClick={() => void window.api.openOnAmazon(s.asin)}>
                            <ExternalLink size={14} />
                          </button>
                          <button className="btn" title={t('Track')} onClick={() => void onTrack(s.asin).then(() => dismiss(s.asin))}>
                            <Plus size={14} />
                          </button>
                          <button className="btn link" title={t('Dismiss')} onClick={() => dismiss(s.asin)}>
                            <X size={14} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
