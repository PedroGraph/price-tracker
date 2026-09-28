/**
 * Functions that run *inside* Amazon pages (via executeJavaScript), so they must be
 * self-contained: no imports, no closures. All Amazon selectors live here — this is
 * the file to fix when Amazon changes its markup.
 */

export interface PageFlags {
  loggedOut: boolean
  captcha: boolean
}

export interface RawCartItem {
  /** 'cart' for the active cart, 'saved' for "Saved for later". */
  section: 'cart' | 'saved'
  asin: string
  title: string
  url: string
  image: string | null
  priceText: string | null
}

export interface RawProduct extends PageFlags {
  title: string | null
  importFeesText: string | null
  coupon: string | null
  deal: string | null
  image: string | null
  priceText: string | null
  availabilityText: string | null
  shippingText: string | null
  seller: string | null
}

export interface RawOffer {
  sellerId: string | null
  condition: string | null
  priceText: string | null
  shippingText: string | null
  seller: string | null
}

export function extractCart(): PageFlags & { items: RawCartItem[]; cartFound: boolean } {
  const text = (el: Element | null | undefined): string | null => el?.textContent?.replace(/\s+/g, ' ').trim() || null
  // Cart images are lazy-loaded: `src` starts as a "loading" GIF and the real URL sits in another attribute.
  const realImage = (img: Element | null): string | null => {
    if (!img) return null
    const candidates = [
      img.getAttribute('data-a-hires'),
      img.getAttribute('data-src'),
      img.getAttribute('data-old-hires'),
      img.getAttribute('srcset')?.split(',')[0]?.trim().split(' ')[0],
      img.getAttribute('src')
    ]
    return candidates.find((u) => u && /^https:/.test(u) && !/loadIndicators|transparent-pixel|grey-pixel/.test(u)) ?? null
  }
  const captcha = !!document.querySelector('form[action*="validateCaptcha"]')
  // Language independent: signed-out pages link the account menu to the sign-in page.
  // Signed in, the account menu isn't always a link, so read the attribute instead of `.href`.
  const account = document.querySelector('#nav-link-accountList')
  const accountHref = account?.getAttribute('href') ?? ''
  const accountText = text(document.querySelector('#nav-link-accountList-nav-line-1'))
  const loggedOut = !account || /\/ap\/signin/.test(accountHref) || /sign in|identif/i.test(accountText ?? '')
  const seen = new Set<string>()
  const items: RawCartItem[] = []
  const collect = (selector: string, section: 'cart' | 'saved'): void => {
    document.querySelectorAll(selector).forEach((row) => {
      const asin = row.getAttribute('data-asin')
      if (!asin || !/^[A-Z0-9]{10}$/.test(asin) || seen.has(asin)) return
      seen.add(asin)
      const dataPrice = row.getAttribute('data-price')
      items.push({
        section,
        asin,
        title:
          text(row.querySelector('.sc-product-title .a-truncate-full')) ??
          text(row.querySelector('.sc-product-title')) ??
          asin,
        url: `https://www.amazon.com/dp/${asin}`,
        image: realImage(row.querySelector('img.sc-product-image, img')),
        priceText: dataPrice ? `$${dataPrice}` : text(row.querySelector('.sc-product-price, .apex-price-to-pay-value'))
      })
    })
  }
  // The cart first, so an item in both counts as a cart item.
  collect('#sc-active-cart div[data-asin][data-itemtype="active"], #sc-active-cart div.sc-list-item[data-asin]', 'cart')
  collect('#sc-saved-cart div[data-asin]', 'saved')
  // Without the cart container we can't tell "empty cart" from "page changed".
  const cartFound = !!document.querySelector('#sc-active-cart, #sc-empty-cart, .sc-your-amazon-cart-is-empty')
  return { loggedOut, captcha, items, cartFound }
}

export function extractProduct(): RawProduct {
  const text = (el: Element | null | undefined): string | null => el?.textContent?.replace(/\s+/g, ' ').trim() || null
  const first = (selectors: string[]): string | null => {
    for (const s of selectors) {
      const t = text(document.querySelector(s))
      if (t) return t
    }
    return null
  }
  // Signed in, the account menu isn't always a link, so read the attribute instead of `.href`.
  const account = document.querySelector('#nav-link-accountList')
  const accountHref = account?.getAttribute('href') ?? ''
  const accountText = text(document.querySelector('#nav-link-accountList-nav-line-1'))
  const delivery = document.querySelector('#mir-layout-DELIVERY_BLOCK [data-csa-c-delivery-price]')
  const landing = document.querySelector('#landingImage, #imgBlkFront') as HTMLImageElement | null
  return {
    title: text(document.querySelector('#productTitle')),
    // "$123.45 Shipping & Import Fees Deposit to Colombia" / "Depósito de tarifas de importación".
    importFeesText:
      [...document.querySelectorAll('#amazonGlobal_feature_div span, #exports_desktop_qualifiedBuybox_tlc_feature_div span, #mir-layout-DELIVERY_BLOCK span')]
        .map((el) => text(el))
        .find((t) => !!t && /import fees|tarifas de importaci/i.test(t) && /\d/.test(t)) ?? null,
    // Only keep text that actually talks about a coupon / deal; these blocks also hold other promos.
    coupon:
      [
        '#couponText',
        '#promoPriceBlockMessage_feature_div label[id^="couponText"]',
        '#vpcButton .a-color-success',
        '#couponBadgeRegularVpc',
        '#promoPriceBlockMessage_feature_div'
      ]
        .map((s) => text(document.querySelector(s)))
        .find((t) => !!t && /coupon|cup[oó]n/i.test(t))
        ?.slice(0, 120) ?? null,
    deal:
      ['#dealBadge_feature_div', '#dealBadgeSupportingText', '.dealBadge']
        .map((s) => text(document.querySelector(s)))
        .find((t) => !!t && /deal|oferta/i.test(t))
        ?.slice(0, 80) ?? null,
    image: landing?.getAttribute('data-old-hires') || landing?.src || null,
    captcha: !!document.querySelector('form[action*="validateCaptcha"]'),
    loggedOut: !account || /\/ap\/signin/.test(accountHref) || /sign in|identif/i.test(accountText ?? ''),
    priceText: first([
      '#corePrice_feature_div .a-price .a-offscreen',
      '#corePriceDisplay_desktop_feature_div .priceToPay .a-offscreen',
      '#corePriceDisplay_desktop_feature_div .a-price .a-offscreen',
      '#apex_desktop .a-price .a-offscreen',
      '#price_inside_buybox',
      '#priceblock_ourprice',
      '#priceblock_dealprice'
    ]),
    availabilityText: first(['#availability', '#outOfStock', '#availability_feature_div']),
    shippingText: delivery?.getAttribute('data-csa-c-delivery-price') ?? null,
    seller: first([
      '#merchantInfoFeature_feature_div .offer-display-feature-text-message',
      '#sellerProfileTriggerId',
      '#merchant-info a'
    ])
  }
}

export function extractOffers(): PageFlags & { offers: RawOffer[] } {
  const text = (el: Element | null | undefined): string | null => el?.textContent?.replace(/\s+/g, ' ').trim() || null
  const offers: RawOffer[] = []
  // In this panel `.a-offscreen` is often empty; the visible price is split into symbol / whole / fraction.
  const priceOf = (el: Element): string | null => {
    const offscreen = text(el.querySelector('.a-price .a-offscreen')) ?? text(el.querySelector('.aok-offscreen'))
    if (offscreen && /\d/.test(offscreen)) return offscreen
    const whole = text(el.querySelector('.a-price-whole'))?.replace(/[^\d,]/g, '')
    if (!whole) return null
    const fraction = text(el.querySelector('.a-price-fraction'))?.replace(/\D/g, '') ?? '00'
    return `${text(el.querySelector('.a-price-symbol')) ?? '$'}${whole}.${fraction}`
  }
  document.querySelectorAll('#aod-pinned-offer, #aod-offer').forEach((el) => {
    const priceText = priceOf(el)
    // The pinned block is present even when it says "no featured offers".
    if (!priceText) return
    const seller = text(el.querySelector('#aod-offer-soldBy a, #aod-offer-soldBy .a-size-small.a-color-base'))
    // Third-party sellers link to /gp/aag/main?seller=ID; Amazon.com itself has no link.
    const href = el.querySelector('#aod-offer-soldBy a')?.getAttribute('href') ?? ''
    const sellerId = href.match(/[?&]seller=([A-Z0-9]+)/)?.[1] ?? (/^amazon(\.com)?$/i.test(seller ?? '') ? 'ATVPDKIKX0DER' : null)
    offers.push({
      sellerId,
      condition: text(el.querySelector('#aod-offer-heading h5, #aod-offer-heading')),
      priceText,
      shippingText: el.querySelector('[data-csa-c-delivery-price]')?.getAttribute('data-csa-c-delivery-price') ?? null,
      seller
    })
  })
  return { captcha: !!document.querySelector('form[action*="validateCaptcha"]'), loggedOut: false, offers }
}

/** "Unavailable" includes items Amazon won't ship to your delivery address. Runs in Node, not in the page. */
export function isUnavailable(availabilityText: string | null): boolean {
  return /currently unavailable|out of stock|cannot be shipped|can't be shipped|no disponible|agotado|sin existencias|no puede enviarse/i.test(
    availabilityText ?? ''
  )
}

export interface RawWishlist extends PageFlags {
  found: boolean
  /** True once Amazon shows the end-of-list marker (every item is loaded). */
  complete: boolean
  items: { asin: string; title: string; image: string | null }[]
}

/** Items of a wishlist page. Runs in the page; call again after scrolling to get more. */
export function extractWishlist(): RawWishlist {
  const text = (el: Element | null | undefined): string | null => el?.textContent?.replace(/\s+/g, ' ').trim() || null
  const seen = new Set<string>()
  const items: RawWishlist['items'] = []
  document.querySelectorAll('#g-items li[data-itemid], #g-items li').forEach((li) => {
    // The ASIN is in the item's JSON params ("ASIN:B0...|...") or in its product link.
    const params = li.getAttribute('data-reposition-action-params') ?? ''
    const link = li.querySelector('a[href*="/dp/"]')?.getAttribute('href') ?? ''
    const asin = params.match(/ASIN:([A-Z0-9]{10})/)?.[1] ?? link.match(/\/dp\/([A-Z0-9]{10})/)?.[1]
    if (!asin || seen.has(asin)) return
    seen.add(asin)
    const name = li.querySelector('a[id^="itemName_"]')
    items.push({
      asin,
      title: name?.getAttribute('title') || text(name) || asin,
      image: (li.querySelector('img') as HTMLImageElement | null)?.getAttribute('src') ?? null
    })
  })
  return {
    captcha: !!document.querySelector('form[action*="validateCaptcha"]'),
    loggedOut: false,
    found: !!document.querySelector('#g-items, #wishlist-page'),
    complete: !!document.querySelector('#endOfListMarker'),
    items
  }
}

export interface RawSearchResult {
  asin: string
  title: string
  image: string | null
  priceText: string | null
  rating: string | null
  reviews: string | null
  sponsored: boolean
  /** "Save 15%" when the product has a coupon to clip. */
  coupon: string | null
}

/** Results of an Amazon search page (/s?k=…). */
export interface RawSearchFilter {
  title: string
  /** `rh` is the whole filter state after clicking the option (Amazon toggles it). */
  options: { label: string; rh: string; selected: boolean }[]
}

export function extractSearch(): PageFlags & {
  results: RawSearchResult[]
  found: boolean
  filters: RawSearchFilter[]
  sorts: { value: string; label: string }[]
  sort: string | null
} {
  const text = (el: Element | null | undefined): string | null => el?.textContent?.replace(/\s+/g, ' ').trim() || null
  const captcha = !!document.querySelector('form[action*="validateCaptcha"]')
  const results: RawSearchResult[] = []
  const seen = new Set<string>()
  document.querySelectorAll('div[data-component-type="s-search-result"][data-asin]').forEach((row) => {
    const asin = row.getAttribute('data-asin')
    if (!asin || !/^[A-Z0-9]{10}$/.test(asin) || seen.has(asin)) return
    seen.add(asin)
    const img = row.querySelector('img.s-image')
    const src = img?.getAttribute('src') ?? null
    results.push({
      asin,
      title: text(row.querySelector('h2 span')) ?? text(row.querySelector('h2')) ?? asin,
      image: src && /^https:/.test(src) ? src : null,
      priceText: text(row.querySelector('.a-price:not([data-a-strike]) .a-offscreen')),
      rating: text(row.querySelector('.a-icon-star-small .a-icon-alt, .a-icon-star-mini .a-icon-alt, i[class*="a-star"] .a-icon-alt')),
      reviews:
        row.querySelector('a[href*="customerReviews"] span')?.textContent?.replace(/[^\d.,KkMm]/g, '') || null,
      coupon:
        text(row.querySelector('.s-coupon-unclipped .s-coupon-highlight-color')) ??
        text(row.querySelector('.s-coupon-unclipped')),
      sponsored: !!row.querySelector('.puis-sponsored-label-text, .s-sponsored-label-text, [aria-label*="Sponsored"], [aria-label*="Patrocinado"]')
    })
  })
  // Sidebar refinements: each group is an element with a heading and links carrying `rh`.
  const filters: RawSearchFilter[] = []
  document.querySelectorAll('#s-refinements [id]').forEach((group) => {
    if (group.id.includes('/') || group.id.endsWith('-title')) return
    const title = text(group.querySelector('.a-text-bold, [role="heading"], h2'))
    if (!title) return
    const options: RawSearchFilter['options'] = []
    group.querySelectorAll('a[href*="rh="], a[href*="/s?"]').forEach((a) => {
      const href = a.getAttribute('href') ?? ''
      if (/ref=sr_ex_/.test(href)) return // "Clear" links: unselecting an option does the same
      const rh = new URL(href, location.origin).searchParams.get('rh') ?? ''
      // Rating options are a star icon plus "& up": "4★ & up".
      const stars = /a-star-(?:medium|small|mini)-(\d)/.exec(a.querySelector('i[class*="a-star"]')?.className ?? '')?.[1]
      const label =
        (stars ? `${stars}★ ${text(a.querySelector('.a-size-small, .a-color-base')) ?? ''}` : null) ??
        text(a.querySelector('.a-size-base, .a-color-base')) ??
        a.getAttribute('title') ??
        a.querySelector('img')?.getAttribute('alt') ??
        text(a)
      if (!label || options.some((o) => o.label === label)) return
      const selected = a.getAttribute('aria-current') === 'true' || !!a.querySelector('input[type="checkbox"]:checked')
      options.push({ label: label.replace(/\s+/g, ' ').trim(), rh, selected })
    })
    if (options.length > 0 && !filters.some((f) => f.title === title)) filters.push({ title, options })
  })
  const sortSelect = document.querySelector<HTMLSelectElement>('#s-result-sort-select')
  const sorts = sortSelect ? [...sortSelect.options].map((o) => ({ value: o.value, label: text(o) ?? o.value })) : []
  // The search page renders its result grid even with zero matches.
  const found = !!document.querySelector('.s-main-slot, .s-result-list')
  return { loggedOut: false, captcha, results, found, filters, sorts, sort: sortSelect?.value ?? null }
}
