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
  asin: string
  title: string
  url: string
  image: string | null
  priceText: string | null
}

export interface RawProduct extends PageFlags {
  title: string | null
  coupon: string | null
  deal: string | null
  image: string | null
  priceText: string | null
  availabilityText: string | null
  shippingText: string | null
  seller: string | null
}

export interface RawOffer {
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
  const rows = document.querySelectorAll(
    '#sc-active-cart div[data-asin][data-itemtype="active"], #sc-active-cart div.sc-list-item[data-asin]'
  )
  rows.forEach((row) => {
    const asin = row.getAttribute('data-asin')
    if (!asin || seen.has(asin)) return
    seen.add(asin)
    const dataPrice = row.getAttribute('data-price')
    items.push({
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
  document.querySelectorAll('#aod-pinned-offer, #aod-offer').forEach((el) => {
    // The pinned block is present even when it says "no featured offers".
    if (!el.querySelector('.a-price .a-offscreen')) return
    offers.push({
      condition: text(el.querySelector('#aod-offer-heading h5, #aod-offer-heading')),
      priceText: text(el.querySelector('.a-price .a-offscreen')),
      shippingText: el.querySelector('[data-csa-c-delivery-price]')?.getAttribute('data-csa-c-delivery-price') ?? null,
      seller: text(el.querySelector('#aod-offer-soldBy a, #aod-offer-soldBy .a-size-small.a-color-base'))
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
