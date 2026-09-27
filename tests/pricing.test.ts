import { describe, expect, it } from 'vitest'
import { evaluateReading, extraEvents, parsePrice, thresholdInUsd } from '../src/shared/pricing'

const pct5 = { unit: 'percent' as const, value: 5 }
const base = { basePrice: 100, wasAvailable: true, available: true, threshold: pct5, copPerUsd: 4000 }

describe('evaluateReading', () => {
  it('sets the base on the first reading', () => {
    expect(evaluateReading({ ...base, basePrice: null, wasAvailable: null, price: 50 })).toEqual({
      events: ['tracking_started'],
      newBase: 50
    })
  })

  it('keeps the base for changes under the threshold', () => {
    expect(evaluateReading({ ...base, price: 97 })).toEqual({ events: [], newBase: 100 })
  })

  it('alerts and moves the base when the threshold is reached', () => {
    expect(evaluateReading({ ...base, price: 95 })).toEqual({ events: ['price_down'], newBase: 95 })
    expect(evaluateReading({ ...base, price: 110 })).toEqual({ events: ['price_up'], newBase: 110 })
  })

  it('accumulates small drops against the unchanged base', () => {
    // 98 and 96 stay under 5%, but 94 is 6% below the base of 100.
    let b = 100
    for (const price of [98, 96]) b = evaluateReading({ ...base, basePrice: b, price }).newBase!
    expect(b).toBe(100)
    expect(evaluateReading({ ...base, basePrice: b, price: 94 }).events).toEqual(['price_down'])
  })

  it('reports availability changes and keeps the base while unavailable', () => {
    expect(evaluateReading({ ...base, price: null, available: false })).toEqual({ events: ['out_of_stock'], newBase: 100 })
    expect(evaluateReading({ ...base, wasAvailable: false, price: 90 }).events).toEqual(['back_in_stock', 'price_down'])
  })

  it('supports USD and COP thresholds', () => {
    expect(evaluateReading({ ...base, threshold: { unit: 'USD', value: 3 }, price: 97 }).events).toEqual(['price_down'])
    // 20,000 COP at 4,000 COP/USD = 5 USD
    expect(evaluateReading({ ...base, threshold: { unit: 'COP', value: 20000 }, price: 96 }).events).toEqual([])
    expect(evaluateReading({ ...base, threshold: { unit: 'COP', value: 20000 }, price: 95 }).events).toEqual(['price_down'])
  })

  it('never alerts on a COP threshold without a rate', () => {
    expect(thresholdInUsd({ unit: 'COP', value: 1 }, 100, null)).toBeNull()
    expect(evaluateReading({ ...base, copPerUsd: null, threshold: { unit: 'COP', value: 1 }, price: 1 }).events).toEqual([])
  })
})

describe('parsePrice', () => {
  it('parses common formats', () => {
    expect(parsePrice('$1,299.99', null)).toBe(1299.99)
    expect(parsePrice('US$19.99', null)).toBe(19.99)
    expect(parsePrice('$25', null)).toBe(25)
    expect(parsePrice('COP 400,000.00', 4000)).toBe(100)
    expect(parsePrice('COP 400,000.00', null)).toBeNull()
    expect(parsePrice('FREE', null)).toBeNull()
    expect(parsePrice('', null)).toBeNull()
  })
})

describe('extraEvents', () => {
  const none = { previousPrice: 100, targetPrice: null, lowestBefore: 90, readingsBefore: 10, baseEvents: [] }

  it('fires target_reached once when crossing the target', () => {
    expect(extraEvents({ ...none, price: 80, targetPrice: 85 })).toContain('target_reached')
    expect(extraEvents({ ...none, price: 79, previousPrice: 80, targetPrice: 85 })).not.toContain('target_reached')
    expect(extraEvents({ ...none, price: 84, previousPrice: 90, targetPrice: 85 })).toContain('target_reached')
    expect(extraEvents({ ...none, price: 86, targetPrice: 85 })).not.toContain('target_reached')
  })

  it('fires all_time_low only after enough readings and without a price_down alert', () => {
    expect(extraEvents({ ...none, price: 89 })).toEqual(['all_time_low'])
    expect(extraEvents({ ...none, price: 89, readingsBefore: 2 })).toEqual([])
    expect(extraEvents({ ...none, price: 89, baseEvents: ['price_down'] })).toEqual([])
    expect(extraEvents({ ...none, price: 90 })).toEqual([])
  })

  it('ignores unavailable readings', () => {
    expect(extraEvents({ ...none, price: null, targetPrice: 200 })).toEqual([])
  })
})
