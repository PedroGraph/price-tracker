import { BrowserWindow, session, type WebContents } from 'electron'
import { AMAZON_STORES, parseLocalPrice } from '@shared/extras'
import { parsePrice } from '@shared/pricing'
import type { Comparison, StoreResult } from '@shared/types'
import { isStoreUrl, relatedQuery } from '@shared/urls'
import * as db from './db'
import { currentRate, usdRates } from './exchange'
import { denyPermissions, openExternal } from './security'
import { extractAmazonIntl, extractEbay, extractMercadoLibre, extractWalmart, type RawStorePage } from './scraper/storeExtractors'

/**
 * Looks for the same product in other stores (MercadoLibre Colombia, eBay, Walmart) and in
 * other Amazon countries. Runs only when asked from the product page, in its own hidden
 * browser with its own cookies (separate from the Amazon session). Results are kept until
 * the next search.
 */
const PARTITION = 'persist:stores'
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

function storesSession(): Electron.Session {
  const s = session.fromPartition(PARTITION)
  s.setUserAgent(s.getUserAgent().replace(/\s(Electron|amazon-price-tracker)\/\S+/g, ''))
  denyPermissions(s)
  return s
}

/** Windows of this browser stay on the stores; anything else opens in the user's browser (if allowed). */
function keepOnStores(contents: WebContents): void {
  const guard = (e: Electron.Event, url: string): void => {
    if (isStoreUrl(url)) return
    e.preventDefault()
    openExternal(url)
  }
  contents.on('will-navigate', guard)
  contents.on('will-redirect', guard)
  contents.setWindowOpenHandler(({ url }) => {
    if (isStoreUrl(url)) void contents.loadURL(url)
    else openExternal(url)
    return { action: 'deny' }
  })
}

const webPreferences = (): Electron.WebPreferences => ({
  session: storesSession(),
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false
})

/** A visible window to sign in to MercadoLibre once; its cookies stay in this browser. */
export function openMercadoLibreLogin(parent?: BrowserWindow): Promise<void> {
  return new Promise((resolve) => {
    const win = new BrowserWindow({ width: 1000, height: 800, parent, title: 'MercadoLibre', webPreferences: webPreferences() })
    win.setMenuBarVisibility(false)
    keepOnStores(win.webContents)
    void win.loadURL('https://www.mercadolibre.com.co/')
    win.on('closed', () => {
      storesSession().flushStorageData()
      resolve()
    })
  })
}

const key = (asin: string): string => `compare:${asin}`
export const getComparison = (asin: string): Comparison | null => db.getSetting<Comparison | null>(key(asin), null)

let running = false

export async function compareProduct(asin: string): Promise<Comparison> {
  if (running) throw new Error('A comparison is already running.')
  const product = db.getProduct(asin)
  if (!product) throw new Error('Unknown product.')
  running = true
  const win = new BrowserWindow({ show: false, webPreferences: webPreferences() })
  keepOnStores(win.webContents)
  const rate = currentRate()
  const rates = await usdRates()
  const query = relatedQuery(product.title)

  const load = async <T,>(url: string, fn: () => T, wait = 2000): Promise<T | null> => {
    try {
      await win.loadURL(url)
      await sleep(wait)
      return (await win.webContents.executeJavaScript(`(${fn.toString()})()`)) as T
    } catch {
      return null
    }
  }

  const store = async (name: string, searchUrl: string, fn: () => RawStorePage, usd: (text: string | null) => number | null): Promise<StoreResult> => {
    let page = await load(searchUrl, fn, 2500)
    // Some stores draw their results a moment after the page loads: look once more.
    if (page && !page.blocked && page.items.length === 0) {
      await sleep(3000)
      page = await win.webContents
        .executeJavaScript(`(${fn.toString()})()`)
        .then((p: RawStorePage) => p)
        .catch(() => page)
    }
    if (!page) return { store: name, url: searchUrl, status: 'error', items: [] }
    if (page.blocked) return { store: name, url: searchUrl, status: page.blocked, items: [] }
    return {
      store: name,
      url: searchUrl,
      status: 'ok',
      items: page.items.map((i) => ({ ...i, price: usd(i.priceText) })).filter((i) => i.price !== null)
    }
  }

  try {
    const q = encodeURIComponent(query)
    const results: StoreResult[] = []
    results.push(
      await store(
        'MercadoLibre',
        `https://listado.mercadolibre.com.co/${encodeURIComponent(query.replace(/\s+/g, '-'))}`,
        extractMercadoLibre,
        (t) => parsePrice(t, rate)
      )
    )
    results.push(await store('eBay', `https://www.ebay.com/sch/i.html?_nkw=${q}&LH_BIN=1`, extractEbay, (t) => parsePrice(t, rate)))
    results.push(await store('Walmart', `https://www.walmart.com/search?q=${q}`, extractWalmart, (t) => parsePrice(t, rate)))

    // The same ASIN on other Amazon stores, converted to USD.
    const amazon: StoreResult[] = []
    for (const s of AMAZON_STORES) {
      const url = `https://www.${s.domain}/dp/${asin}`
      const page = await load(url, extractAmazonIntl, 1500)
      const local = parseLocalPrice(page?.priceText ?? null)
      const perUsd = rates?.[s.currency] ?? null
      amazon.push({
        store: s.name,
        url,
        status: !page ? 'error' : page.blocked ? 'check' : page.missing || local === null ? 'missing' : 'ok',
        items:
          page && local !== null && perUsd
            ? [{ title: page.title ?? product.title, priceText: page.priceText, price: Math.round((local / perUsd) * 100) / 100, url, image: null, condition: null }]
            : []
      })
    }
    const comparison: Comparison = { query, updatedAt: new Date().toISOString(), stores: results, amazon }
    db.setSetting(key(asin), comparison)
    return comparison
  } finally {
    win.destroy()
    running = false
  }
}
