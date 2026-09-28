/**
 * Plain-language hints from a product's own price history: how often it drops, on which
 * weekday it tends to be cheapest, where it's heading, and whether waiting has paid off.
 * Only patterns with enough data behind them are reported.
 */

export interface PricePoint {
  price: number
  /** ISO time of the check. */
  at: string
}

export interface PriceInsights {
  /** Drops of 1% or more in the last 60 days. */
  drops60: number
  /** Average size of those drops, in percent (positive). */
  avgDropPct: number | null
  /** 0 = Sunday … 6 = Saturday; only when that day is clearly cheaper (≥1.5% under average). */
  cheapestWeekday: number | null
  cheapestWeekdayPct: number | null
  /** Direction over the last 14 days. */
  trend: 'down' | 'up' | 'flat' | null
  /** 'wait' when it drops often and is above its recent low; 'buy' when it's at its recent low. */
  advice: 'wait' | 'buy' | null
  /** Days of history behind these numbers. */
  spanDays: number
}

const DAY = 86_400_000
/** Below this, weekday patterns are noise. */
const MIN_DAYS_FOR_WEEKDAY = 14

export function priceInsights(points: PricePoint[], now = Date.now()): PriceInsights {
  const sorted = [...points].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
  const empty: PriceInsights = {
    drops60: 0,
    avgDropPct: null,
    cheapestWeekday: null,
    cheapestWeekdayPct: null,
    trend: null,
    advice: null,
    spanDays: 0
  }
  if (sorted.length < 2) return empty
  const spanDays = (Date.parse(sorted.at(-1)!.at) - Date.parse(sorted[0].at)) / DAY

  // Drops: each change to a price at least 1% lower than the previous one.
  const recent = sorted.filter((p) => now - Date.parse(p.at) <= 60 * DAY)
  const drops: number[] = []
  for (let i = 1; i < recent.length; i++) {
    const change = (recent[i].price - recent[i - 1].price) / recent[i - 1].price
    if (change <= -0.01) drops.push(-change * 100)
  }

  // Weekday: average price per day of the week, against the overall average.
  let cheapestWeekday: number | null = null
  let cheapestWeekdayPct: number | null = null
  if (spanDays >= MIN_DAYS_FOR_WEEKDAY) {
    const sums = Array.from({ length: 7 }, () => ({ total: 0, n: 0 }))
    for (const p of sorted) {
      const d = new Date(p.at).getDay()
      sums[d].total += p.price
      sums[d].n++
    }
    const overall = sorted.reduce((s, p) => s + p.price, 0) / sorted.length
    const averages = sums.map((s, day) => ({ day, avg: s.n ? s.total / s.n : Infinity }))
    const best = averages.reduce((a, b) => (b.avg < a.avg ? b : a))
    const pct = ((overall - best.avg) / overall) * 100
    if (Number.isFinite(best.avg) && pct >= 1.5) {
      cheapestWeekday = best.day
      cheapestWeekdayPct = Math.round(pct * 10) / 10
    }
  }

  // Trend: first vs. last price of the last 14 days, ignoring moves under 2%.
  const last14 = sorted.filter((p) => now - Date.parse(p.at) <= 14 * DAY)
  let trend: PriceInsights['trend'] = null
  if (last14.length >= 2) {
    const change = (last14.at(-1)!.price - last14[0].price) / last14[0].price
    trend = change <= -0.02 ? 'down' : change >= 0.02 ? 'up' : 'flat'
  }

  const current = sorted.at(-1)!.price
  const low60 = Math.min(...recent.map((p) => p.price))
  let advice: PriceInsights['advice'] = null
  if (spanDays >= 7) {
    if (current <= low60 * 1.01) advice = 'buy'
    else if (drops.length >= 2 && current > low60 * 1.03) advice = 'wait'
  }

  return {
    drops60: drops.length,
    avgDropPct: drops.length ? Math.round((drops.reduce((a, b) => a + b, 0) / drops.length) * 10) / 10 : null,
    cheapestWeekday,
    cheapestWeekdayPct,
    trend,
    advice,
    spanDays: Math.floor(spanDays)
  }
}

/** How much the price moves: standard deviation over the mean, in percent. */
export function volatility(prices: number[]): number {
  if (prices.length < 2) return 0
  const mean = prices.reduce((a, b) => a + b, 0) / prices.length
  const variance = prices.reduce((s, p) => s + (p - mean) ** 2, 0) / prices.length
  return mean ? Math.round((Math.sqrt(variance) / mean) * 1000) / 10 : 0
}
