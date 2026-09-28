import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'

/**
 * Password protection for backup files: scrypt turns the password into a 256-bit key
 * (slow on purpose, to make guessing expensive) and AES-256-GCM encrypts and
 * authenticates the content, so a wrong password or a modified file is detected.
 */
export interface Sealed {
  kdf: 'scrypt'
  n: number
  r: number
  p: number
  salt: string
  iv: string
  tag: string
  data: string
}

const PARAMS = { n: 2 ** 17, r: 8, p: 1 }
/** Unicode normalization form, so "ñ" typed two different ways gives the same key. */
const UNICODE_FORM = 'NFKC'
export const MIN_PASSWORD = 8

function key(passphrase: string, salt: Buffer, s: { n: number; r: number; p: number }): Buffer {
  return scryptSync(passphrase.normalize(UNICODE_FORM), salt, 32, { N: s.n, r: s.r, p: s.p, maxmem: 256 * s.n * s.r })
}

export function seal(plaintext: string, password: string): Sealed {
  if (password.length < MIN_PASSWORD) throw new Error(`The password needs at least ${MIN_PASSWORD} characters.`)
  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key(password, salt, PARAMS), iv)
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return {
    kdf: 'scrypt',
    ...PARAMS,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64')
  }
}

export function open(sealed: Sealed, password: string): string {
  if (sealed.kdf !== 'scrypt') throw new Error('Unknown backup encryption.')
  const decipher = createDecipheriv('aes-256-gcm', key(password, Buffer.from(sealed.salt, 'base64'), sealed), Buffer.from(sealed.iv, 'base64'))
  decipher.setAuthTag(Buffer.from(sealed.tag, 'base64'))
  try {
    return Buffer.concat([decipher.update(Buffer.from(sealed.data, 'base64')), decipher.final()]).toString('utf8')
  } catch {
    throw new Error('Wrong password, or the file was modified.')
  }
}
