import { describe, expect, it } from 'vitest'
import { priceInsights, volatility } from '../src/shared/insights'

const DAY = 86_400_000
const now = Date.parse('2026-09-28T12:00:00Z')
const at = (daysAgo: number): string => new Date(now - daysAgo * DAY).toISOString()

describe('priceInsights', () => {
  it('needs at least two readings', () => {
    expect(priceInsights([{ price: 10, at: at(0) }], now).advice).toBeNull()
  })

  it('counts drops and advises waiting when it often drops and sits above its low', () => {
    const points = [100, 90, 100, 88, 100, 100].map((price, i) => ({ price, at: at(30 - i * 5) }))
    const r = priceInsights(points, now)
    expect(r.drops60).toBe(2)
    expect(r.avgDropPct).toBe(11)
    expect(r.advice).toBe('wait')
  })

  it('says buy at the recent low', () => {
    const points = [100, 95, 90].map((price, i) => ({ price, at: at(20 - i * 10) }))
    expect(priceInsights(points, now).advice).toBe('buy')
  })

  it('finds a clearly cheaper weekday with two weeks of data', () => {
    // Every day at 100, except the same weekday each week at 90.
    const points = Array.from({ length: 28 }, (_, i) => ({ at: at(27 - i), price: 0 }))
    const cheapDay = new Date(points[0].at).getDay()
    points.forEach((p) => (p.price = new Date(p.at).getDay() === cheapDay ? 90 : 100))
    const r = priceInsights(points, now)
    expect(r.cheapestWeekday).toBe(cheapDay)
    expect(r.cheapestWeekdayPct).toBeGreaterThan(1.5)
  })

  it('reads the two-week trend', () => {
    const down = [100, 97].map((price, i) => ({ price, at: at(10 - i * 10) }))
    const flat = [100, 101].map((price, i) => ({ price, at: at(10 - i * 10) }))
    expect(priceInsights(down, now).trend).toBe('down')
    expect(priceInsights(flat, now).trend).toBe('flat')
  })
})

describe('volatility', () => {
  it('is zero for a flat price and grows with swings', () => {
    expect(volatility([10, 10, 10])).toBe(0)
    expect(volatility([90, 110])).toBe(10)
  })
})
