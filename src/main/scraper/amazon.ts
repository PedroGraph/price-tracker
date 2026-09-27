import { BrowserWindow, session } from 'electron'
import { parsePrice } from '@shared/pricing'
import type { SessionState } from '@shared/types'
import { extractCart, extractOffers, extractProduct, isUnavailable, type PageFlags } from './extractors'

const PARTITION = 'persist:amazon'
const BASE = 'https://www.amazon.com'

export class SessionError extends Error {
  constructor(public state: Extract<SessionState, 'logged_out' | 'captcha'>) {
    super(state === 'captcha' ? 'Amazon is asking for a CAPTCHA. Open Amazon from the app and solve it.' : 'Signed out of Amazon.')
  }
}

function amazonSession(): Electron.Session {
  const s = session.fromPartition(PARTITION)
  // Present as regular Chrome instead of "Electron/x.y".
  s.setUserAgent(s.getUserAgent().replace(/\s(Electron|amazon-price-tracker)\/\S+/g, ''))
  return s
}

const webPreferences = (): Electron.WebPreferences => ({
  session: amazonSession(),
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false
})

/** Opens a visible Amazon window. The user signs in there; cookies persist on disk. */
export function openAmazonWindow(parent?: BrowserWindow): Promise<void> {
  return new Promise((resolve) => {
    const win = new BrowserWindow({ width: 1100, height: 850, parent, title: 'Amazon — sign in', webPreferences: webPreferences() })
    win.setMenuBarVisibility(false)
    win.loadURL(`${BASE}/gp/cart/view.html`)
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

/** Amazon's markup no longer matches our selectors. */
export class PageChangedError extends Error {}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** A hidden window reused for one tracking run. */
export class Scraper {
  private win = new BrowserWindow({ show: false, webPreferences: webPreferences() })

  private async run<T extends PageFlags>(url: string, fn: () => T, checkLogin = true): Promise<T> {
    await this.win.loadURL(url)
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

  async product(asin: string, copPerUsd: number | null) {
    const raw = await this.run(`${BASE}/dp/${asin}?th=1&psc=1`, extractProduct)
    const price = parsePrice(raw.priceText, copPerUsd)
    const unavailable = isUnavailable(raw.availabilityText)
    return {
      price,
      available: !unavailable && price !== null,
      /** False when there is no price and no "unavailable" text: the page couldn't be read. */
      readable: price !== null || unavailable,
      shipping: /free|gratis/i.test(raw.shippingText ?? '') ? 0 : parsePrice(raw.shippingText, copPerUsd),
      seller: raw.seller,
      image: raw.image && /^https:/.test(raw.image) ? raw.image : null
    }
  }

  async offers(asin: string, copPerUsd: number | null) {
    const { offers } = await this.run(`${BASE}/gp/product/ajax/aodAjaxMain/?asin=${asin}&pc=dp`, extractOffers, false)
    return offers
      .map((o) => ({
        price: parsePrice(o.priceText, copPerUsd),
        shipping: /free|gratis/i.test(o.shippingText ?? '') ? 0 : parsePrice(o.shippingText, copPerUsd),
        seller: o.seller ?? 'Unknown seller',
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
