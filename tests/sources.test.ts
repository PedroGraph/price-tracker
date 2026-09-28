// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import * as db from '../src/main/db'
import { extractCart, extractWishlist } from '../src/main/scraper/extractors'
import { wishlistId } from '../src/shared/urls'

const item = (asin: string, source: 'cart' | 'saved' | 'wishlist') => ({
  asin,
  title: `Product ${asin}`,
  url: `https://www.amazon.com/dp/${asin}`,
  image: null,
  source
})
const active = () => Object.fromEntries(db.listProducts(true).map((p) => [p.asin, p.source]))

describe('syncSources', () => {
  beforeEach(() => db.openDb(':memory:'))

  it('adds items with the strongest source and drops what left Amazon', () => {
    db.syncSources([item('A000000001', 'wishlist'), item('A000000001', 'cart'), item('A000000002', 'saved')])
    expect(active()).toEqual({ A000000001: 'cart', A000000002: 'saved' })

    db.syncSources([item('A000000001', 'cart')])
    expect(active()).toEqual({ A000000001: 'cart' })
  })

  it('leaves sources that were not read this time alone', () => {
    db.syncSources([item('A000000001', 'cart'), item('A000000003', 'wishlist')])
    db.syncSources([item('A000000001', 'cart')], ['wishlist'])
    expect(active()).toEqual({ A000000001: 'cart', A000000003: 'wishlist' })
  })

  it('never touches products added by link', () => {
    db.addManualProduct('A000000009')
    db.syncSources([])
    expect(active()).toEqual({ A000000009: 'manual' })
    db.syncSources([item('A000000009', 'cart')])
    expect(active()).toEqual({ A000000009: 'manual' })
  })
})

const account = '<a id="nav-link-accountList" href="/gp/css/homepage.html"><span id="nav-link-accountList-nav-line-1">Hello, Test</span></a>'

describe('cart sections (synthetic markup)', () => {
  it('separates the cart from "Saved for later"', () => {
    document.body.innerHTML = `${account}
      <div id="sc-active-cart"><div data-asin="B000000001" data-itemtype="active" data-price="10.00"><span class="sc-product-title">In cart</span></div></div>
      <div id="sc-saved-cart"><div data-asin="B000000002"><span class="sc-product-title">Saved</span></div>
        <div data-asin="B000000001"><span class="sc-product-title">Also saved</span></div></div>`
    const { items } = extractCart()
    expect(items.map((i) => [i.asin, i.section])).toEqual([
      ['B000000001', 'cart'],
      ['B000000002', 'saved']
    ])
  })
})

describe('wishlists', () => {
  it('recognises wishlist links', () => {
    expect(wishlistId('https://www.amazon.com/hz/wishlist/ls/2ABCDEF3GHIJK?ref_=wl_share')).toBe('2ABCDEF3GHIJK')
    expect(wishlistId('https://www.amazon.com/-/es/hz/wishlist/ls/2abcdef3ghijk')).toBe('2ABCDEF3GHIJK')
    expect(wishlistId('https://www.amazon.com/dp/B0FRB8FXK5')).toBeNull()
    expect(wishlistId('https://evil.example/hz/wishlist/ls/2ABCDEF3GHIJK')).toBeNull()
  })

  it('reads items and knows when the list is complete (synthetic markup)', () => {
    document.body.innerHTML = `<ul id="g-items">
      <li data-itemid="I1" data-reposition-action-params='{"itemExternalId":"ASIN:B000000011|ATVPDKIKX0DER"}'>
        <a id="itemName_I1" title="First item" href="/dp/B000000011/">First item</a><img src="https://m.media-amazon.com/x.jpg"></li>
      <li data-itemid="I2"><a id="itemName_I2" href="/-/es/dp/B000000012?coliid=I2">Second</a></li>
    </ul><div id="endOfListMarker"></div>`
    const w = extractWishlist()
    expect(w.found).toBe(true)
    expect(w.complete).toBe(true)
    expect(w.items).toEqual([
      { asin: 'B000000011', title: 'First item', image: 'https://m.media-amazon.com/x.jpg' },
      { asin: 'B000000012', title: 'Second', image: null }
    ])
  })
})
