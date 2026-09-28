import { describe, expect, it } from 'vitest'
import { open, seal } from '../src/main/backupCrypto'

describe('backup encryption', () => {
  const secret = JSON.stringify({ resendKey: 're_123', telegramToken: '123:abc' })

  it('round-trips with the right password and hides the content', () => {
    const sealed = seal(secret, 'correct horse')
    expect(sealed.data).not.toContain('re_123')
    expect(open(sealed, 'correct horse')).toBe(secret)
  })

  it('rejects a wrong password', () => {
    expect(() => open(seal(secret, 'correct horse'), 'wrong horse!')).toThrow(/Wrong password/)
  })

  it('detects a modified file', () => {
    const sealed = seal(secret, 'correct horse')
    const data = Buffer.from(sealed.data, 'base64')
    data[0] ^= 1
    expect(() => open({ ...sealed, data: data.toString('base64') }, 'correct horse')).toThrow(/modified/)
  })

  it('requires a real password', () => {
    expect(() => seal(secret, 'short')).toThrow(/at least 8/)
  })

  it('uses a new salt and IV every time', () => {
    const a = seal(secret, 'correct horse')
    const b = seal(secret, 'correct horse')
    expect(a.salt).not.toBe(b.salt)
    expect(a.iv).not.toBe(b.iv)
  })
})
