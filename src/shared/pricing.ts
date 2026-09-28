import type { EventType, Threshold } from './types'

/** Converts a threshold into an absolute USD amount relative to the base price. */
export function thresholdInUsd(threshold: Threshold, basePrice: number, copPerUsd: number | null): number | null {
  switch (threshold.unit) {
    case 'percent':
      return (basePrice * threshold.value) / 100
    case 'USD':
      return threshold.value
    case 'COP':
      return copPerUsd ? threshold.value / copPerUsd : null
  }
}

export interface Evaluation {
  /** Events to record and notify, in order. */
  events: EventType[]
  /** The base price after this reading. */
  newBase: number | null
}

/**
 * Decides what a new reading means for a product.
 * Every reading is stored elsewhere; this only answers "should we alert, and does the base move".
 * The base only moves when the change from the base reaches the threshold, so many small
 * moves in one direction still add up to an alert.
 */
export function evaluateReading(input: {
  basePrice: number | null
  wasAvailable: boolean | null
  price: number | null
  available: boolean
  threshold: Threshold
  copPerUsd: number | null
}): Evaluation {
  const { basePrice, wasAvailable, price, available, threshold, copPerUsd } = input
  const events: EventType[] = []

  if (wasAvailable === true && !available) events.push('out_of_stock')
  if (wasAvailable === false && available) events.push('back_in_stock')

  if (!available || price === null) return { events, newBase: basePrice }

  if (basePrice === null) {
    events.push('tracking_started')
    return { events, newBase: price }
  }

  const limit = thresholdInUsd(threshold, basePrice, copPerUsd)
  const diff = price - basePrice
  if (limit !== null && diff !== 0 && Math.abs(diff) >= limit) {
    events.push(diff > 0 ? 'price_up' : 'price_down')
    return { events, newBase: price }
  }
  return { events, newBase: basePrice }
}

/** Readings needed before "new all-time low" alerts start, so the first days aren't noisy. */
export const MIN_READINGS_FOR_LOW = 3

/**
 * Alerts that don't move the base price: reaching the target price (once per crossing)
 * and a new all-time low (skipped when a price_down alert already covers it).
 */
export function extraEvents(input: {
  price: number | null
  previousPrice: number | null
  targetPrice: number | null
  lowestBefore: number | null
  readingsBefore: number
  baseEvents: EventType[]
}): EventType[] {
  const { price, previousPrice, targetPrice, lowestBefore, readingsBefore, baseEvents } = input
  if (price === null) return []
  const events: EventType[] = []
  if (targetPrice !== null && price <= targetPrice && (previousPrice === null || previousPrice > targetPrice)) {
    events.push('target_reached')
  }
  if (
    lowestBefore !== null &&
    price < lowestBefore &&
    readingsBefore >= MIN_READINGS_FOR_LOW &&
    !baseEvents.includes('price_down')
  ) {
    events.push('all_time_low')
  }
  return events
}

/**
 * Price after clipping a coupon such as "Apply $20 coupon", "Save 15% with coupon"
 * or "Aplicar cupón de US$5". Null when the coupon text has no amount we understand.
 */
export function priceWithCoupon(price: number | null, coupon: string | null): number | null {
  if (price === null || !coupon) return null
  const pct = coupon.match(/(\d+(?:\.\d+)?)\s*%/)
  if (pct) return round2(price * (1 - Number(pct[1]) / 100))
  const amount = coupon.match(/\$\s*(\d+(?:\.\d+)?)/)
  if (amount) return round2(Math.max(0, price - Number(amount[1])))
  return null
}

/** Alerts for promotions that appear on the product page. */
export function promoEvents(
  before: { coupon: string | null; deal: string | null },
  now: { coupon: string | null; deal: string | null }
): EventType[] {
  const events: EventType[] = []
  if (now.coupon && !before.coupon) events.push('coupon_added')
  if (now.deal && !before.deal) events.push('deal_started')
  return events
}

/** Amazon's own merchant id: offers "sold by Amazon.com" have no seller link. */
export const AMAZON_SELLER_ID = 'ATVPDKIKX0DER'

/** The product page with this seller's offer selected (the one you'd buy from). */
export function offerUrl(asin: string, sellerId: string | null): string {
  return `https://www.amazon.com/dp/${asin}${sellerId ? `?smid=${sellerId}` : ''}`
}

/** The seller's profile and ratings. */
export function sellerUrl(sellerId: string): string {
  return `https://www.amazon.com/sp?seller=${sellerId}`
}

export type BuyVerdict = 'low' | 'normal' | 'high' | 'unknown'

/** Minimum history before judging a price, so a couple of checks don't produce a verdict. */
export const SIGNAL_MIN_RUNS = 5
export const SIGNAL_MIN_DAYS = 2

/**
 * Is now a good time to buy? Compares the current price with the last 30 days:
 * low = at the 30-day low (within 2%) or 5%+ under the average; high = 5%+ over the average.
 */
export function buySignal(input: {
  current: number | null
  avg: number | null
  min: number | null
  runs: number
  spanDays: number
}): BuyVerdict {
  const { current, avg, min, runs, spanDays } = input
  if (current === null || avg === null || min === null) return 'unknown'
  if (runs < SIGNAL_MIN_RUNS || spanDays < SIGNAL_MIN_DAYS) return 'unknown'
  if (current <= min * 1.02 || current <= avg * 0.95) return 'low'
  if (current >= avg * 1.05) return 'high'
  return 'normal'
}

/** Pulls the ASIN out of an Amazon product URL (or accepts a bare ASIN). */
export function parseAsin(input: string): string | null {
  const text = input.trim()
  if (/^[A-Z0-9]{10}$/i.test(text)) return text.toUpperCase()
  const m = text.match(/\/(?:dp|gp\/product|gp\/aw\/d|product-reviews|exec\/obidos\/asin)\/([A-Z0-9]{10})(?:[/?#]|$)/i)
  return m ? m[1].toUpperCase() : null
}

/** Parses Amazon price text such as "$1,299.99", "COP 450,000.00" or "US$19.99". */
export function parsePrice(text: string | null | undefined, copPerUsd: number | null): number | null {
  if (!text) return null
  const isCop = /COP/i.test(text)
  const match = text.replace(/\s/g, '').match(/(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?/)
  if (!match) return null
  const value = Number(match[1].replace(/,/g, '') + (match[2] ?? ''))
  if (!Number.isFinite(value)) return null
  if (isCop) return copPerUsd ? round2(value / copPerUsd) : null
  return value
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export function formatUsd(n: number | null): string {
  return n === null ? '—' : n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

export function formatCop(n: number | null): string {
  return n === null ? '—' : n.toLocaleString('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 })
}

/**
 * What the product really costs delivered: price + shipping + import fees deposit (USD).
 * Null without a price; missing shipping or fees count as zero.
 */
export function landedTotal(price: number | null, shipping: number | null, importFees: number | null): number | null {
  if (price === null) return null
  return Math.round((price + (shipping ?? 0) + (importFees ?? 0)) * 100) / 100
}

/** Groups Amazon's offer conditions ("Used - Like New", "Renovado"…) into new, renewed and used. */
export function conditionGroup(condition: string | null): 'new' | 'renewed' | 'used' {
  const c = (condition ?? '').toLowerCase()
  if (/renew|renov|reacond|refurb/.test(c)) return 'renewed'
  if (/used|usad|collectible|coleccion/.test(c)) return 'used'
  return 'new'
}
