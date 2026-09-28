import { useEffect, useRef, useState } from 'react'
import { Bell, ExternalLink, Loader2, Plus, RefreshCw, TicketPercent, X } from 'lucide-react'
import type { Status, Suggestion } from '@shared/types'
import { useT } from './i18n'
import { useMoney } from './money'
import { Thumb } from './ui'

/**
 * The bell in the top bar: products related to the ones in the cart that have a coupon.
 * Found by the main process after a check, at most every 12 hours.
 */
export function Suggestions({ status, onTrack }: { status: Status | null; onTrack: (asin: string) => Promise<void> }) {
  const { t } = useT()
  const { fmt } = useMoney()
  const [items, setItems] = useState<Suggestion[]>([])
  const [open, setOpen] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  // Reload whenever a check finishes (the status changes), which is when new ones appear.
  useEffect(() => {
    void window.api.listSuggestions().then(setItems)
  }, [status?.lastRunAt, status?.running])

  // Close when clicking outside the panel.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const dismiss = (asin: string): void => {
    setItems((list) => list.filter((s) => s.asin !== asin))
    void window.api.dismissSuggestion(asin)
  }

  const refresh = async (): Promise<void> => {
    setRefreshing(true)
    try {
      setItems(await window.api.refreshSuggestions())
    } finally {
      setRefreshing(false)
    }
  }

  // Grouped by the cart product they relate to.
  const groups = items.reduce<{ forAsin: string; forTitle: string; items: Suggestion[] }[]>((acc, s) => {
    const g = acc.find((x) => x.forAsin === s.forAsin)
    if (g) g.items.push(s)
    else acc.push({ forAsin: s.forAsin, forTitle: s.forTitle, items: [s] })
    return acc
  }, [])

  return (
    <div className="notif" ref={box}>
      <button className="icon-btn" onClick={() => setOpen(!open)} aria-label={t('Coupons for you')} title={t('Coupons for you')}>
        <Bell size={18} />
        {items.length > 0 && <span className="notif-count">{items.length > 9 ? '9+' : items.length}</span>}
      </button>
      {open && (
        <div className="notif-panel card">
          <div className="notif-head">
            <div>
              <h3>{t('Coupons for you')}</h3>
              <p className="muted">{t('Related to what’s in your cart, with a coupon right now.')}</p>
            </div>
            <button className="icon-btn" onClick={() => void refresh()} disabled={refreshing} title={t('Look again')}>
              <RefreshCw size={16} className={refreshing ? 'spin' : ''} />
            </button>
          </div>
          <div className="notif-body">
            {refreshing && items.length === 0 ? (
              <p className="muted searching">
                <Loader2 size={16} className="spin" /> {t('Looking for coupons…')}
              </p>
            ) : items.length === 0 ? (
              <p className="muted notif-empty">{t('No coupons on related products right now. The app looks again twice a day.')}</p>
            ) : (
              groups.map((g) => (
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
                        <button
                          className="btn"
                          title={t('Track')}
                          onClick={() => void onTrack(s.asin).then(() => dismiss(s.asin))}
                        >
                          <Plus size={14} />
                        </button>
                        <button className="btn link" title={t('Dismiss')} onClick={() => dismiss(s.asin)}>
                          <X size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
