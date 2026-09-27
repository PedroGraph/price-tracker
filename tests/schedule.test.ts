import { describe, expect, it } from 'vitest'
import { digestDue, isQuiet, lastDigestSlot, quietEndsAt } from '../src/shared/schedule'

// Local-time dates: new Date(y, monthIndex, d, h, m).
const at = (d: number, h: number, m = 0): Date => new Date(2026, 8, d, h, m) // September 2026; the 28th is a Monday

describe('quiet hours', () => {
  it('handles windows that wrap midnight', () => {
    expect(isQuiet(at(27, 23), 22, 7)).toBe(true)
    expect(isQuiet(at(27, 3), 22, 7)).toBe(true)
    expect(isQuiet(at(27, 7), 22, 7)).toBe(false)
    expect(isQuiet(at(27, 12), 22, 7)).toBe(false)
  })

  it('handles same-day windows and the disabled case', () => {
    expect(isQuiet(at(27, 14), 13, 15)).toBe(true)
    expect(isQuiet(at(27, 15), 13, 15)).toBe(false)
    expect(isQuiet(at(27, 3), 0, 0)).toBe(false)
  })

  it('finds when the window ends', () => {
    expect(quietEndsAt(at(27, 23), 7)).toEqual(at(28, 7))
    expect(quietEndsAt(at(28, 3), 7)).toEqual(at(28, 7))
  })
})

describe('summaries', () => {
  it('daily: due once per day after the hour', () => {
    expect(lastDigestSlot(at(27, 9), 'daily', 8)).toEqual(at(27, 8))
    expect(lastDigestSlot(at(27, 7), 'daily', 8)).toEqual(at(26, 8))
    expect(digestDue(at(27, 9), null, 'daily', 8)).toBe(true)
    expect(digestDue(at(27, 9), at(27, 8, 5).toISOString(), 'daily', 8)).toBe(false)
    expect(digestDue(at(28, 8, 1), at(27, 8, 5).toISOString(), 'daily', 8)).toBe(true)
  })

  it('weekly: goes out on Mondays', () => {
    expect(lastDigestSlot(at(30, 12), 'weekly', 8)).toEqual(at(28, 8)) // Wednesday → Monday
    expect(lastDigestSlot(at(28, 7), 'weekly', 8)).toEqual(at(21, 8)) // Monday before the hour → last Monday
    expect(digestDue(at(30, 12), at(28, 9).toISOString(), 'weekly', 8)).toBe(false)
    expect(digestDue(at(30, 12), at(27, 9).toISOString(), 'weekly', 8)).toBe(true)
  })

  it('never when off', () => {
    expect(digestDue(at(27, 9), null, 'off', 8)).toBe(false)
  })
})
