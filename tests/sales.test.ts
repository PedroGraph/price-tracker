import { describe, expect, it } from 'vitest'
import { nextSale, saleEvents } from '../src/shared/sales'

describe('saleEvents', () => {
  it('puts Black Friday the day after the fourth Thursday of November', () => {
    const e = saleEvents(2026)
    expect(e.find((x) => x.name === 'Black Friday')!.start).toBe('2026-11-27')
    expect(e.find((x) => x.name === 'Cyber Monday')!.start).toBe('2026-11-30')
    expect(saleEvents(2025).find((x) => x.name === 'Black Friday')!.start).toBe('2025-11-28')
  })

  it('marks Prime Day dates as approximate', () => {
    expect(saleEvents(2026).find((x) => x.name === 'Prime Day')!.approximate).toBe(true)
  })
})

describe('nextSale', () => {
  it('returns the next one with the days left', () => {
    const n = nextSale(new Date(2026, 10, 20))
    expect(n!.name).toBe('Black Friday')
    expect(n!.daysLeft).toBe(7)
  })

  it('counts a running sale as zero days left and rolls into next year', () => {
    expect(nextSale(new Date(2026, 10, 27))!.daysLeft).toBe(0)
    expect(nextSale(new Date(2026, 11, 15))!.start.startsWith('2027-07')).toBe(true)
  })
})
