import * as db from './db'
import { currentRate } from './exchange'
import { Scraper, SessionError } from './scraper/amazon'
import { COUPON_FILTER, relatedQuery, searchUrl } from '@shared/urls'
import type { Suggestion } from '@shared/types'

/**
 * Products related to what's in the cart that have a coupon right now. Found by searching
 * Amazon for each cart product (with Amazon's "Coupons" filter), at most every 12 hours,
 * so it adds a few page loads twice a day, not to every hourly check.
 */
interface Stored {
  updatedAt: string | null
  items: Suggestion[]
  dismissed: string[]
}

const KEY = 'suggestions'
const EVERY = 12 * 60 * 60_000
const PER_PRODUCT = 3
let running = false

const load = (): Stored => db.getSetting<Stored>(KEY, { updatedAt: null, items: [], dismissed: [] })

export function listSuggestions(): Suggestion[] {
  const { items, dismissed } = load()
  const tracked = new Set(db.listProducts().map((p) => p.asin))
  return items.filter((s) => !dismissed.includes(s.asin) && !tracked.has(s.asin))
}

export function dismissSuggestion(asin: string): void {
  const s = load()
  // Keep the list bounded: only the most recent dismissals matter.
  db.setSetting(KEY, { ...s, dismissed: [...s.dismissed.filter((a) => a !== asin), asin].slice(-300) })
}

/** Looks for new suggestions when the last search is old enough (or when forced). Returns true if it ran. */
export async function refreshSuggestions(force = false): Promise<boolean> {
  const stored = load()
  if (running) return false
  if (!force && stored.updatedAt && Date.now() - Date.parse(stored.updatedAt) < EVERY) return false
  const cart = db.listProducts(true).filter((p) => p.source === 'cart')
  running = true
  const scraper = new Scraper()
  try {
    const tracked = new Set(db.listProducts().map((p) => p.asin))
    const found: Suggestion[] = []
    for (const product of cart) {
      const url = searchUrl({ query: relatedQuery(product.title), rh: COUPON_FILTER })
      if (!url) continue
      await scraper.pause()
      const page = await scraper.search(url, currentRate())
      page.results
        .filter((r) => r.coupon && !r.sponsored && !tracked.has(r.asin) && !found.some((f) => f.asin === r.asin))
        .slice(0, PER_PRODUCT)
        .forEach((r) => found.push({ ...r, forAsin: product.asin, forTitle: product.title }))
    }
    db.setSetting(KEY, { ...load(), updatedAt: new Date().toISOString(), items: found })
    return true
  } catch (err) {
    // Signed out or a CAPTCHA: the regular check reports that; try again next time.
    if (!(err instanceof SessionError)) console.error('Suggestions:', err)
    return false
  } finally {
    scraper.close()
    running = false
  }
}
