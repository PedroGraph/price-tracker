/**
 * Functions that run inside other stores' pages (via executeJavaScript), so like
 * extractors.ts they must be self-contained. The selectors for each store live here.
 */

export interface RawStoreItem {
  title: string
  priceText: string | null
  url: string
  image: string | null
  condition: string | null
}

export interface RawStorePage {
  items: RawStoreItem[]
  /** The store wants a sign-in or a human check before showing results. */
  blocked: 'login' | 'check' | null
}

/** eBay search results ("Buy It Now" listings). */
export function extractEbay(): RawStorePage {
  const text = (el: Element | null | undefined): string | null => el?.textContent?.replace(/\s+/g, ' ').trim() || null
  const items: RawStoreItem[] = []
  document.querySelectorAll('li.s-card, li.s-item').forEach((li) => {
    const link = li.querySelector('a[href*="/itm/"]')
    const href = link?.getAttribute('href') ?? ''
    // eBay puts a fake "Shop on eBay" card (item 123456) first.
    if (!href || /\/itm\/123456\b/.test(href)) return
    const title = (text(li.querySelector('.s-card__title, .s-item__title')) ?? '')
      .replace(/(Se abre en una ventana nueva|Opens in a new window or tab|Opens in a new window)$/i, '')
      .trim()
    if (!title || /^shop on ebay$/i.test(title)) return
    items.push({
      title,
      priceText: text(li.querySelector('.s-card__price, .s-item__price')),
      url: href.split('?')[0],
      image: li.querySelector('img')?.getAttribute('src') ?? null,
      condition: text(li.querySelector('.s-card__subtitle, .SECONDARY_INFO'))
    })
  })
  const blocked = /captcha|verify you are a human|security measure/i.test(document.title) ? 'check' : null
  return { items: items.slice(0, 6), blocked }
}

/** Walmart search results. The price is split over several spans, so it's read from the card's text. */
export function extractWalmart(): RawStorePage {
  const text = (el: Element | null | undefined): string | null => el?.textContent?.replace(/\s+/g, ' ').trim() || null
  const items: RawStoreItem[] = []
  document.querySelectorAll('[data-item-id]').forEach((card) => {
    const title = text(card.querySelector('[data-automation-id="product-title"]'))
    const href = card.querySelector('a[href*="/ip/"]')?.getAttribute('href')
    if (!title || !href) return
    const m = /\$\s*(\d[\d,]*)\s+(\d{2})\b/.exec((card as HTMLElement).innerText.replace(/\n/g, ' '))
    items.push({
      title,
      priceText: m ? `$${m[1]}.${m[2]}` : null,
      url: new URL(href, location.origin).toString().split('?')[0],
      image: card.querySelector('img')?.getAttribute('src') ?? null,
      condition: /restored|reacondicionad|restaurad/i.test(title) ? 'Restored' : null
    })
  })
  const blocked = /robot|press & hold|verify/i.test(document.body.innerText.slice(0, 1500)) && items.length === 0 ? 'check' : null
  return { items: items.slice(0, 6), blocked }
}

/** MercadoLibre Colombia search results. Asks for a sign-in on a fresh session. */
export function extractMercadoLibre(): RawStorePage {
  const text = (el: Element | null | undefined): string | null => el?.textContent?.replace(/\s+/g, ' ').trim() || null
  if (/account-verification|\/login|\/jms\//.test(location.href)) return { items: [], blocked: 'login' }
  const items: RawStoreItem[] = []
  document.querySelectorAll('.poly-card, li.ui-search-layout__item').forEach((card) => {
    const link = card.querySelector('a.poly-component__title, a.ui-search-link, h2 a, a')
    const title = text(card.querySelector('.poly-component__title, .ui-search-item__title'))
    const href = link?.getAttribute('href')
    if (!title || !href || items.some((i) => i.title === title)) return
    const price = card.querySelector('.poly-price__current, .ui-search-price__second-line, .andes-money-amount')
    const fraction = text(price?.querySelector('.andes-money-amount__fraction'))
    const img = card.querySelector('img')
    items.push({
      title,
      priceText: fraction ? `COP ${fraction.replace(/\./g, ',')}` : null,
      url: href.split('#')[0],
      image: img?.getAttribute('data-src') ?? img?.getAttribute('src') ?? null,
      condition: text(card.querySelector('.poly-component__item-condition, .ui-search-item__group__element--condition'))
    })
  })
  return { items: items.slice(0, 6), blocked: null }
}

/** Another Amazon store's product page: its price in the local currency. */
export function extractAmazonIntl(): { title: string | null; priceText: string | null; blocked: boolean; missing: boolean } {
  const text = (el: Element | null | undefined): string | null => el?.textContent?.replace(/\s+/g, ' ').trim() || null
  const blocked =
    !!document.querySelector('form[action*="validateCaptcha"]') ||
    (!document.querySelector('#productTitle') && /continue shopping|seguir comprando|weiter einkaufen/i.test(document.body.innerText.slice(0, 600)))
  return {
    title: text(document.querySelector('#productTitle')),
    priceText:
      text(document.querySelector('#corePrice_feature_div .a-price .a-offscreen')) ??
      text(document.querySelector('#corePriceDisplay_desktop_feature_div .a-price .a-offscreen')) ??
      text(document.querySelector('#apex_desktop .a-price .a-offscreen')),
    blocked,
    missing: !blocked && !document.querySelector('#productTitle')
  }
}
