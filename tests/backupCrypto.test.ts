import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { open, seal } from '../src/main/backupCrypto'

// Made-up values generated per run (nothing real is stored in the repo).
const RIGHT = randomUUID()
const WRONG = randomUUID()
const FAKE_KEY = `fake-${randomUUID()}`

describe('backup encryption', () => {
  const secret = JSON.stringify({ resendKey: FAKE_KEY, telegramToken: 'fake-token' })

  it('round-trips with the right password and hides the content', () => {
    const sealed = seal(secret, RIGHT)
    expect(Buffer.from(sealed.data, 'base64').toString('latin1')).not.toContain(FAKE_KEY)
    expect(open(sealed, RIGHT)).toBe(secret)
  })

  it('rejects a wrong password', () => {
    expect(() => open(seal(secret, RIGHT), WRONG)).toThrow(/Wrong password/)
  })

  it('detects a modified file', () => {
    const sealed = seal(secret, RIGHT)
    const data = Buffer.from(sealed.data, 'base64')
    data[0] ^= 1
    expect(() => open({ ...sealed, data: data.toString('base64') }, RIGHT)).toThrow(/modified/)
  })

  it('requires a real password', () => {
    expect(() => seal(secret, 'short')).toThrow(/at least 8/)
  })

  it('uses a new salt and IV every time', () => {
    const a = seal(secret, RIGHT)
    const b = seal(secret, RIGHT)
    expect(a.salt).not.toBe(b.salt)
    expect(a.iv).not.toBe(b.iv)
  })
})
