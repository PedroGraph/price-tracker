import { useState } from 'react'
import { X } from 'lucide-react'
import { wishlistId } from '@shared/urls'
import type { Settings } from '@shared/types'
import { useT } from '../i18n'
import { Toggle } from '../ui'

/** What gets tracked besides the cart: "Saved for later" and wishlists. */
export function Sources({ draft, save }: { draft: Settings; save: (patch: Partial<Settings>) => void }) {
  const { t } = useT()
  const [link, setLink] = useState('')
  const valid = wishlistId(link) !== null
  const duplicate = draft.wishlists.some((w) => wishlistId(w) === wishlistId(link))

  const add = (): void => {
    if (!valid || duplicate) return
    save({ wishlists: [...draft.wishlists, link.trim()] })
    setLink('')
  }

  return (
    <section className="card">
      <h3>{t('What to track')}</h3>
      <p className="sub">{t('Your Amazon cart is always tracked. Add more places:')}</p>
      <div className="toggle-row" style={{ marginTop: 8 }}>
        <div>
          <strong>{t('Saved for later')}</strong>
          <small>{t('The items under your cart. Moving something back to the cart keeps its history.')}</small>
        </div>
        <Toggle on={draft.trackSavedForLater} onChange={(v) => save({ trackSavedForLater: v })} label={t('Saved for later')} />
      </div>
      <div className="toggle-row" style={{ display: 'block' }}>
        <strong>{t('Wishlists')}</strong>
        <small style={{ display: 'block' }}>
          {t('Paste the link of a list (Amazon → Lists → your list → Share → Copy link). Everything on it is tracked, and items you remove from it stop being tracked.')}
        </small>
        {draft.wishlists.length > 0 && (
          <ul className="wishlists">
            {draft.wishlists.map((w) => (
              <li key={w}>
                <span className="mono">{wishlistId(w)}</span>
                <a className="inline" href={w} target="_blank" rel="noreferrer">
                  {t('Open')} ↗
                </a>
                <button
                  className="icon-btn small"
                  aria-label={t('Remove')}
                  onClick={() => save({ wishlists: draft.wishlists.filter((x) => x !== w) })}
                >
                  <X size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="row" style={{ marginTop: 10 }}>
          <input
            type="text"
            placeholder="https://www.amazon.com/hz/wishlist/ls/…"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
          />
          <button className="btn" disabled={!valid || duplicate} onClick={add}>
            {t('Add')}
          </button>
        </div>
        {link && !valid && <p className="hint bad-text">{t("That isn't an Amazon wishlist link.")}</p>}
        {link && duplicate && <p className="hint">{t('That list is already added.')}</p>}
        <p className="hint">{t('Private lists work too: the app reads them with your Amazon session.')}</p>
      </div>
    </section>
  )
}
