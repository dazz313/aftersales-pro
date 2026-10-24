import { describe, it, expect, beforeAll } from 'vitest'

// AUTH_SECRET dibaca saat dipanggil (bukan saat impor) — set sebelum tes berjalan.
const SECRET = 'unit-test-secret-0123456789abcdef0123456789abcdef'
process.env.AUTH_SECRET = SECRET

import { signSession, verifySessionToken, type SessionPayload } from '@/lib/auth'

const payload: SessionPayload = {
  sub: '42',
  nama: 'Budi Santoso',
  email: 'budi@teknikjaya.co.id',
  username: 'budi',
  role: 'ADMIN_WORKSHOP',
}

describe('auth sesi (JWT)', () => {
  let token: string

  beforeAll(async () => {
    token = await signSession(payload)
  })

  it('menghasilkan token JWT bertanda tangan', () => {
    expect(token.split('.')).toHaveLength(3)
  })

  it('verifikasi mengembalikan payload lengkap', async () => {
    const hasil = await verifySessionToken(token)
    expect(hasil).toMatchObject(payload)
  })

  it('format token pola base64url (HS256 header)', async () => {
    const header = JSON.parse(
      Buffer.from(token.split('.')[0], 'base64url').toString('utf8')
    )
    expect(header.alg).toBe('HS256')
  })

  it('menolak token yang diubah (tampered) → null', async () => {
    const rusak = token.slice(0, -3) + 'abc'
    expect(await verifySessionToken(rusak)).toBeNull()
  })

  it('menolak token sampah → null', async () => {
    expect(await verifySessionToken('bukan.token.valid')).toBeNull()
    expect(await verifySessionToken('')).toBeNull()
  })

  it('menolak token yang ditandatangani secret lain → null', async () => {
    process.env.AUTH_SECRET = 'secret-yang-berbeda-panjang-sekali-123456'
    const tokenLain = await signSession(payload)
    process.env.AUTH_SECRET = SECRET
    expect(await verifySessionToken(tokenLain)).toBeNull()
  })
})
