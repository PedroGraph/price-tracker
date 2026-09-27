import { createContext, useContext } from 'react'
import { formatCop, formatUsd } from '@shared/pricing'

export type DisplayCurrency = 'USD' | 'COP'

export const MoneyContext = createContext<{
  currency: DisplayCurrency
  rate: number | null
  setCurrency: (c: DisplayCurrency) => void
}>({ currency: 'USD', rate: null, setCurrency: () => undefined })

export function useMoney() {
  const ctx = useContext(MoneyContext)
  const cop = ctx.currency === 'COP' && ctx.rate !== null
  return {
    ...ctx,
    /** Converts USD into the display currency. */
    toDisplay: (usd: number): number => (cop ? usd * ctx.rate! : usd),
    fromDisplay: (value: number): number => (cop ? value / ctx.rate! : value),
    fmt: (usd: number | null): string => (usd === null ? '—' : cop ? formatCop(usd * ctx.rate!) : formatUsd(usd)),
    /** Signed amount, e.g. "-$21.00". */
    fmtDelta: (usd: number): string => {
      const s = cop ? formatCop(Math.abs(usd) * ctx.rate!) : formatUsd(Math.abs(usd))
      return `${usd < 0 ? '-' : '+'}${s}`
    }
  }
}
