// @vitest-environment happy-dom
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { extractCart, extractOffers, extractProduct, isUnavailable } from '../src/main/scraper/extractors'

/**
 * Real Amazon pages, trimmed and anonymized by scripts/capture-fixtures.cjs.
 * When Amazon changes its markup, capture new fixtures and these tests show what broke.
 */
const FIXTURES = join(__dirname, 'fixtures')
const load = (file: string): void => {
  document.documentElement.innerHTML = readFileSync(join(FIXTURES, file), 'utf8')
}
const has = (file: string): boolean => {
  try {
    return readdirSync(join(FIXTURES, file.split('/')[0])).includes(file.split('/')[1])
  } catch {
    return false
  }
}

beforeEach(() => {
  document.documentElement.innerHTML = '<body></body>'
})

describe('signed-out pages', () => {
  it('recognises an empty cart instead of a changed page', () => {
    load('signed-out/cart.html')
    const cart = extractCart()
    expect(cart.cartFound).toBe(true)
    expect(cart.items).toEqual([])
  })

  it('treats "cannot ship to this address" as unavailable, not unreadable', () => {
    load('signed-out/product.html')
    const p = extractProduct()
    expect(p.priceText).toBeNull()
    expect(isUnavailable(p.availabilityText)).toBe(true)
    expect(p.image).toMatch(/^https:\/\/m\.media-amazon\.com\/images\/I\/.+_SL1200_\.jpg$/)
  })

  it('returns no offers when there are none', () => {
    load('signed-out/offers.html')
    expect(extractOffers().offers).toEqual([])
  })
})

describe.runIf(has('signed-in/cart.html'))('signed-in pages', () => {
  it('reads cart items with ASIN, title, image and price', () => {
    load('signed-in/cart.html')
    const cart = extractCart()
    expect(cart.loggedOut).toBe(false)
    expect(cart.cartFound).toBe(true)
    expect(cart.items.length).toBeGreaterThan(0)
    for (const item of cart.items) {
      expect(item.asin).toMatch(/^[A-Z0-9]{10}$/)
      expect(item.title).not.toBe(item.asin)
      expect(item.priceText).toMatch(/\d/)
      expect(item.image ?? '').not.toMatch(/loadIndicators/)
    }
  })

  it('reads every seller from the offers panel', () => {
    load('signed-in/offers.html')
    const { offers } = extractOffers()
    expect(offers.length).toBeGreaterThanOrEqual(2)
    for (const o of offers) {
      expect(o.priceText).toMatch(/\d/)
      expect(o.seller).toBeTruthy()
    }
  })

  it('reads the product price, availability and seller', () => {
    load('signed-in/product.html')
    const p = extractProduct()
    expect(p.loggedOut).toBe(false)
    expect(p.priceText).toMatch(/\d/)
    expect(isUnavailable(p.availabilityText)).toBe(false)
  })
})

describe('promotions (synthetic markup)', () => {
  const account = '<a id="nav-link-accountList" href="/gp/css/homepage.html"><span id="nav-link-accountList-nav-line-1">Hello, Test</span></a>'

  it('reads a clippable coupon and a deal badge', () => {
    document.body.innerHTML = `${account}
      <div id="promoPriceBlockMessage_feature_div"><label id="couponTextpctch123">Apply $20 coupon</label> Terms</div>
      <div id="dealBadge_feature_div"><span>Limited time deal</span></div>`
    const p = extractProduct()
    expect(p.coupon).toBe('Apply $20 coupon')
    expect(p.deal).toBe('Limited time deal')
  })

  it('reads the import fees deposit when shipping abroad', () => {
    document.body.innerHTML = `${account}
      <div id="amazonGlobal_feature_div"><span>US$98.40 Import Fees Deposit to Colombia</span><span>Details</span></div>`
    expect(extractProduct().importFeesText).toBe('US$98.40 Import Fees Deposit to Colombia')
  })

  it('ignores promo blocks that are not coupons or deals', () => {
    document.body.innerHTML = `${account}<div id="promoPriceBlockMessage_feature_div">Get 5% back with Prime Visa</div>`
    const p = extractProduct()
    expect(p.coupon).toBeNull()
    expect(p.deal).toBeNull()
  })
})

describe('page structure checks', () => {
  it('flags a page without the cart container', () => {
    document.body.innerHTML = '<a id="nav-link-accountList" href="/gp/css/homepage.html"><span id="nav-link-accountList-nav-line-1">Hello, Test</span></a><div id="new-cart-layout"></div>'
    expect(extractCart().cartFound).toBe(false)
  })

  it('detects the signed-out state in English and Spanish', () => {
    for (const text of ['Hello, sign in', 'Hola, Identifícate']) {
      document.body.innerHTML = `<a id="nav-link-accountList" href="https://www.amazon.com/ap/signin"><span id="nav-link-accountList-nav-line-1">${text}</span></a>`
      expect(extractCart().loggedOut).toBe(true)
    }
  })

  it('detects a CAPTCHA page', () => {
    document.body.innerHTML = '<form action="/errors/validateCaptcha"></form>'
    expect(extractProduct().captcha).toBe(true)
  })
})
