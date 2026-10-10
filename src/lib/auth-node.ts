/**
 * Password hashing (server-side, node:crypto scrypt — tanpa dependency baru).
 * Format tersimpan: "scrypt$<salt-hex>$<hash-hex>"
 */
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

const KEYLEN = 64

export function hashPassword(plain: string): string {
  const salt = randomBytes(16)
  const hash = scryptSync(plain, salt, KEYLEN)
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`
}

export function verifyPassword(plain: string, stored: string | null | undefined): boolean {
  if (!stored) return false
  const parts = stored.split('$')
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false
  try {
    const salt = Buffer.from(parts[1], 'hex')
    const hash = Buffer.from(parts[2], 'hex')
    const candidate = scryptSync(plain, salt, hash.length)
    return candidate.length === hash.length && timingSafeEqual(candidate, hash)
  } catch {
    return false
  }
}
