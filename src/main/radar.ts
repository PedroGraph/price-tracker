import type { RadarDeal } from '@shared/types'
import { DISCOUNT_FILTER, searchUrl } from '@shared/urls'
import * as db from './db'
import { currentRate } from './exchange'
import { Scraper, SessionError } from './scraper/amazon'

/**
 * The deals radar: Amazon's discounted products in the categories of the products you
 * track (up to five categories, the most common first), biggest discount first. Refreshed
 * every 6 hours in its own hidden window, or when asked.
 */
interface Stored {
  updatedAt: string | null
  deals: RadarDeal[]
}

const KEY = 'radar'
const EVERY = 6 * 60 * 60_000
const MAX_CATEGORIES = 5
let running = false

export function getRadar(): Stored {
  const stored = db.getSetting<Stored>(KEY, { updatedAt: null, deals: [] })
  const tracked = new Set(db.listProducts().map((p) => p.asin))
  return { ...stored, deals: stored.deals.filter((d) => !tracked.has(d.asin)) }
}

export async function refreshRadar(force = false): Promise<boolean> {
  const stored = db.getSetting<Stored>(KEY, { updatedAt: null, deals: [] })
  if (running) return false
  if (!force && stored.updatedAt && Date.now() - Date.parse(stored.updatedAt) < EVERY) return false
  // Categories of the tracked products, most common first.
  const counts = new Map<string, { name: string; n: number }>()
  for (const p of db.listProducts(true)) {
    if (!p.categoryNode) continue
    const c = counts.get(p.categoryNode) ?? { name: p.categoryName ?? '', n: 0 }
    counts.set(p.categoryNode, { ...c, n: c.n + 1 })
  }
  const categories = [...counts.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, MAX_CATEGORIES)
  if (categories.length === 0) return false
  running = true
  const scraper = new Scraper()
  try {
    const deals: RadarDeal[] = []
    for (const [node, { name }] of categories) {
      const url = searchUrl({ query: '', rh: `n:${node},${DISCOUNT_FILTER}`, sort: 'exact-aware-popularity-rank' })
      if (!url) continue
      await scraper.pause()
      const page = await scraper.search(url, currentRate())
      for (const r of page.results) {
        if (r.sponsored || r.price === null || r.listPrice === null || r.listPrice <= r.price) continue
        if (deals.some((d) => d.asin === r.asin)) continue
        deals.push({ ...r, category: name, discount: Math.round((1 - r.price / r.listPrice) * 100) })
      }
    }
    deals.sort((a, b) => b.discount - a.discount)
    db.setSetting(KEY, { updatedAt: new Date().toISOString(), deals: deals.slice(0, 60) })
    return true
  } catch (err) {
    if (!(err instanceof SessionError)) console.error('Radar:', err)
    return false
  } finally {
    scraper.close()
    running = false
  }
}
