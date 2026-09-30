import { app, BrowserWindow, session } from 'electron'
import { keepOnAmazon } from '../security'
import { parsePrice } from '@shared/pricing'
import type { SearchPage, SessionState } from '@shared/types'
import { wishlistId } from '@shared/urls'
import { extractCart, extractOffers, extractProduct, extractProductExtras, extractSearch, extractWishlist, isUnavailable, type PageFlags, type RawExtras } from './extractors'
import { parseCount, parseHistogram, parseRating, parseSalesRank, parseStockLeft } from '@shared/extras'

const PARTITION = 'persist:amazon'
const BASE = 'https://www.amazon.com'

export class SessionError extends Error {
  constructor(public state: Extract<SessionState, 'logged_out' | 'captcha'>) {
    super(state === 'captcha' ? 'Amazon is asking for a CAPTCHA. Open Amazon from the app and solve it.' : 'Signed out of Amazon.')
  }
}

export function amazonSession(): Electron.Session {
  const s = session.fromPartition(PARTITION)
  // Present as regular Chrome instead of "Electron/x.y".
  s.setUserAgent(s.getUserAgent().replace(/\s(Electron|amazon-price-tracker)\/\S+/g, ''))
  return s
}

const webPreferences = (): Electron.WebPreferences => ({
  session: amazonSession(),
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false,
  devTools: !app.isPackaged
})

/**
 * Opens a visible Amazon window with the app's session (cookies persist on disk):
 * the cart to sign in, or a product page.
 */
export function openAmazonWindow(parent?: BrowserWindow, asin?: string): Promise<void> {
  return new Promise((resolve) => {
    const win = new BrowserWindow({ width: 1100, height: 850, parent, title: asin ? 'Amazon' : 'Amazon — sign in', webPreferences: webPreferences() })
    win.setMenuBarVisibility(false)
    keepOnAmazon(win.webContents)
    win.loadURL(asin ? `${BASE}/dp/${asin}` : `${BASE}/gp/cart/view.html`)
    // Write the new sign-in cookies to disk right away so they survive a crash or forced exit.
    win.on('closed', () => {
      amazonSession().flushStorageData()
      resolve()
    })
  })
}

export function flushAmazonSession(): void {
  amazonSession().flushStorageData()
}

export async function clearAmazonSession(): Promise<void> {
  await amazonSession().clearStorageData()
}

/**
 * Amazon shows either "Import Fees Deposit $X" or a combined "$X Shipping & Import Fees Deposit".
 * The combined figure includes shipping, which we already show separately, so we only keep
 * amounts that are labelled as import fees alone.
 */
function importFees(text: string | null, copPerUsd: number | null): number | null {
  if (!text || /shipping|env[ií]o/i.test(text)) return null
  return parsePrice(text, copPerUsd)
}

/** Amazon's markup no longer matches our selectors. */
export class PageChangedError extends Error {}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** A hidden window reused for one tracking run. */
export class Scraper {
  private win = new BrowserWindow({ show: false, webPreferences: webPreferences() })

  constructor() {
    keepOnAmazon(this.win.webContents)
  }

  /**
   * Loads a page. Amazon sometimes swaps the URL while loading (a category search turns
   * into /s?keywords=…), which aborts the first navigation: then wait for the new one.
   */
  private async load(url: string): Promise<void> {
    try {
      await this.win.loadURL(url)
    } catch (err) {
      if ((err as { code?: string }).code !== 'ERR_ABORTED') throw err
      const wc = this.win.webContents
      if (!wc.isLoading()) return
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 20_000)
        wc.once('did-stop-loading', () => {
          clearTimeout(timer)
          resolve()
        })
      })
    }
  }

  private async run<T extends PageFlags>(url: string, fn: () => T, checkLogin = true): Promise<T> {
    await this.load(url)
    await sleep(1500) // let late price widgets render
    const result = (await this.win.webContents.executeJavaScript(`(${fn.toString()})()`)) as T
    if (result.captcha) throw new SessionError('captcha')
    if (checkLogin && result.loggedOut) throw new SessionError('logged_out')
    return result
  }

  async cart(copPerUsd: number | null) {
    const { items, cartFound } = await this.run(`${BASE}/gp/cart/view.html`, extractCart)
    if (!cartFound) throw new PageChangedError('Cart page: the cart container was not found')
    return items.map((i) => ({ ...i, price: parsePrice(i.priceText, copPerUsd) }))
  }

  /** Every item of a wishlist; scrolls to make Amazon load long lists. */
  async wishlist(url: string) {
    const id = wishlistId(url)
    if (!id) throw new PageChangedError(`Not a wishlist link: ${url}`)
    let page = await this.run(`${BASE}/hz/wishlist/ls/${id}`, extractWishlist, false)
    if (!page.found) throw new PageChangedError(`Wishlist ${id}: the list wasn't found (private or removed?)`)
    for (let i = 0; i < 15 && !page.complete; i++) {
      const before = page.items.length
      await this.win.webContents.executeJavaScript('window.scrollTo(0, document.body.scrollHeight)')
      await sleep(1500)
      page = (await this.win.webContents.executeJavaScript(`(${extractWishlist.toString()})()`)) as typeof page
      if (page.items.length === before) break
    }
    return page.items.map((i) => ({ ...i, url: `${BASE}/dp/${i.asin}` }))
  }

  async search(url: string, copPerUsd: number | null): Promise<SearchPage> {
    const { results, found, filters, sorts, sort } = await this.run(url, extractSearch, false)
    if (!found) throw new PageChangedError('Search page: the results list was not found')
    return { results: results.map(({ priceText, listPriceText, ...r }) => ({ ...r, price: parsePrice(priceText, copPerUsd), listPrice: parsePrice(listPriceText, copPerUsd) })), filters, sorts, sort }
  }

  async product(asin: string, copPerUsd: number | null) {
    const raw = await this.run(`${BASE}/dp/${asin}?th=1&psc=1`, extractProduct)
    const price = parsePrice(raw.priceText, copPerUsd)
    const unavailable = isUnavailable(raw.availabilityText)
    // Same page, no extra load: stock, rank, category and reviews. Never fails the check.
    const extras = await this.win.webContents
      .executeJavaScript(`(${extractProductExtras.toString()})()`)
      .then((x: RawExtras) => {
        const rank = parseSalesRank(x.rankText)
        return {
          stockLeft: parseStockLeft(x.stockText),
          salesRank: rank?.rank ?? null,
          rankCategory: rank?.category ?? null,
          categoryName: x.categoryName,
          categoryNode: x.categoryNode,
          rating: parseRating(x.ratingText),
          reviewCount: parseCount(x.reviewCountText),
          reviews: {
            histogram: parseHistogram(x.histogram),
            items: x.reviews.map((r) => ({ ...r, stars: parseRating(r.stars) })),
            updatedAt: new Date().toISOString()
          }
        }
      })
      .catch(() => null)
    return {
      price,
      available: !unavailable && price !== null,
      /** False when there is no price and no "unavailable" text: the page couldn't be read. */
      readable: price !== null || unavailable,
      shipping: /free|gratis/i.test(raw.shippingText ?? '') ? 0 : parsePrice(raw.shippingText, copPerUsd),
      seller: raw.seller,
      title: raw.title,
      importFees: importFees(raw.importFeesText, copPerUsd),
      coupon: raw.coupon,
      deal: raw.deal,
      image: raw.image && /^https:/.test(raw.image) ? raw.image : null,
      extras
    }
  }

  async offers(asin: string, copPerUsd: number | null) {
    const { offers } = await this.run(`${BASE}/gp/product/ajax/aodAjaxMain/?asin=${asin}&pc=dp`, extractOffers, false)
    return offers
      .map((o) => ({
        price: parsePrice(o.priceText, copPerUsd),
        shipping: /free|gratis/i.test(o.shippingText ?? '') ? 0 : parsePrice(o.shippingText, copPerUsd),
        seller: o.seller ?? 'Unknown seller',
        sellerId: o.sellerId,
        condition: o.condition
      }))
      .filter((o): o is typeof o & { price: number } => o.price !== null)
  }

  /** Random pause between pages so the run looks like a person browsing. */
  pause(): Promise<void> {
    return sleep(3000 + Math.random() * 4000)
  }

  close(): void {
    if (!this.win.isDestroyed()) this.win.destroy()
  }
}
