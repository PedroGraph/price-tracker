import type { ExchangeRate } from '@shared/types'
import { getSetting, setSetting } from './db'
import { getSettings } from './settings'

const SOURCE = 'https://open.er-api.com/v6/latest/USD'
const MAX_AGE_MS = 6 * 60 * 60 * 1000

/**
 * Market COP/USD rate. Amazon does not publish the rate it uses for its own
 * currency converter, so this is a close reference, not Amazon's exact number.
 */
export async function refreshRate(force = false): Promise<ExchangeRate | null> {
  const cached = getSetting<ExchangeRate | null>('exchangeRate', null)
  if (!force && cached && Date.now() - Date.parse(cached.fetchedAt) < MAX_AGE_MS) return cached
  try {
    const res = await fetch(SOURCE)
    const body = (await res.json()) as { result: string; rates?: Record<string, number> }
    const rate = body.rates?.COP
    if (body.result !== 'success' || !rate) throw new Error('No COP rate in response')
    const fresh = { rate, fetchedAt: new Date().toISOString(), source: 'open.er-api.com' }
    setSetting('exchangeRate', fresh)
    return fresh
  } catch {
    return cached
  }
}

/** COP per USD, preferring the manual override from settings. */
export function currentRate(): number | null {
  return getSettings().manualRate ?? getSetting<ExchangeRate | null>('exchangeRate', null)?.rate ?? null
}

export function cachedRate(): ExchangeRate | null {
  const manual = getSettings().manualRate
  if (manual) return { rate: manual, fetchedAt: new Date().toISOString(), source: 'manual' }
  return getSetting<ExchangeRate | null>('exchangeRate', null)
}

/** Units of each currency per 1 USD (EUR, GBP, MXN…), from the same source, cached 12 hours. */
export async function usdRates(): Promise<Record<string, number> | null> {
  const cached = getSetting<{ rates: Record<string, number>; fetchedAt: string } | null>('usdRates', null)
  if (cached && Date.now() - Date.parse(cached.fetchedAt) < 12 * 60 * 60 * 1000) return cached.rates
  try {
    const body = (await (await fetch(SOURCE, { signal: AbortSignal.timeout(10_000) })).json()) as { result: string; rates?: Record<string, number> }
    if (body.result !== 'success' || !body.rates) throw new Error('No rates')
    setSetting('usdRates', { rates: body.rates, fetchedAt: new Date().toISOString() })
    return body.rates
  } catch {
    return cached?.rates ?? null
  }
}
