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
