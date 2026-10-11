import { describe, expect, it } from 'vitest'
import { compareVersions, newsSince, WHATS_NEW } from '../src/shared/whatsNew'

const entry = (version: string) => ({ version, notes: { en: [version], es: [version] } })
const entries = [entry('1.3.0'), entry('1.2.11'), entry('1.2.9')]

describe('compareVersions', () => {
  it('compares numbers, not text', () => {
    expect(compareVersions('1.2.10', '1.2.9')).toBeGreaterThan(0)
    expect(compareVersions('1.3.0', '1.2.10')).toBeGreaterThan(0)
    expect(compareVersions('1.2.10', '1.2.10')).toBe(0)
    expect(compareVersions('0', '1.0.0')).toBeLessThan(0)
  })
})

describe('newsSince', () => {
  it('shows every version skipped by the update, newest first', () => {
    expect(newsSince('1.2.10', '1.3.0', entries).map((e) => e.version)).toEqual(['1.3.0', '1.2.11'])
  })

  it('shows nothing when already seen, and nothing from versions ahead of the running one', () => {
    expect(newsSince('1.3.0', '1.3.0', entries)).toEqual([])
    expect(newsSince('1.2.10', '1.2.11', entries).map((e) => e.version)).toEqual(['1.2.11'])
  })

  it('has every note in both languages', () => {
    for (const e of WHATS_NEW) {
      expect(e.notes.es.length).toBe(e.notes.en.length)
      expect(e.notes.en.length).toBeGreaterThan(0)
    }
  })
})
