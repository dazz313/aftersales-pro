import { describe, it, expect } from 'vitest'
import { isMutasi, hostPermintaan, permintaanSamaAsal } from '@/lib/csrf'

/**
 * Request tiruan ringan (hanya `method` + `headers.get`) agar tes tidak
 * bergantung pada aturan "forbidden header" milik undici (Origin/Host/Referer).
 */
function req(method: string, headers: Record<string, string> = {}): Request {
  const lower: Record<string, string> = {}
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v
  return {
    method,
    headers: { get: (k: string) => lower[k.toLowerCase()] ?? null },
  } as unknown as Request
}

describe('isMutasi', () => {
  it('true untuk metode pengubah data (case-insensitive)', () => {
    for (const m of ['POST', 'PUT', 'PATCH', 'DELETE', 'post', 'patch']) {
      expect(isMutasi(m)).toBe(true)
    }
  })
  it('false untuk metode baca/lainnya', () => {
    for (const m of ['GET', 'HEAD', 'OPTIONS', 'TRACE']) {
      expect(isMutasi(m)).toBe(false)
    }
  })
})

describe('hostPermintaan', () => {
  it('memakai header Host tanpa port', () => {
    expect(hostPermintaan(req('POST', { host: 'localhost:3001' }))).toBe('localhost')
  })
  it('memprioritaskan X-Forwarded-Host (di belakang proxy/Cloudflare)', () => {
    expect(
      hostPermintaan(req('POST', { host: 'origin.internal', 'x-forwarded-host': 'app.contoh.co.id' }))
    ).toBe('app.contoh.co.id')
  })
  it('menangani IPv6 [::1]:3000', () => {
    expect(hostPermintaan(req('POST', { host: '[::1]:3000' }))).toBe('::1')
  })
  it('null bila tidak ada host', () => {
    expect(hostPermintaan(req('POST'))).toBeNull()
  })
})

describe('permintaanSamaAsal', () => {
  const host = { host: 'app.contoh.co.id' }

  it('Origin cocok dengan host → true (abaikan skema/port)', () => {
    expect(permintaanSamaAsal(req('POST', { ...host, origin: 'https://app.contoh.co.id' }))).toBe(true)
  })

  it('Origin berbeda host → false (CSRF)', () => {
    expect(permintaanSamaAsal(req('POST', { ...host, origin: 'https://penyerang.example' }))).toBe(false)
  })

  it('Origin "null" → false', () => {
    expect(permintaanSamaAsal(req('POST', { ...host, origin: 'null' }))).toBe(false)
  })

  it('Sec-Fetch-Site: cross-site → false meski tanpa Origin', () => {
    expect(permintaanSamaAsal(req('POST', { ...host, 'sec-fetch-site': 'cross-site' }))).toBe(false)
  })

  it('tanpa Origin, Referer cocok → true', () => {
    expect(
      permintaanSamaAsal(req('POST', { ...host, referer: 'https://app.contoh.co.id/service' }))
    ).toBe(true)
  })

  it('tanpa Origin, Referer berbeda → false', () => {
    expect(
      permintaanSamaAsal(req('POST', { ...host, referer: 'https://penyerang.example/x' }))
    ).toBe(false)
  })

  it('tanpa indikator browser sama sekali → true (webhook/curl)', () => {
    expect(permintaanSamaAsal(req('POST', host))).toBe(true)
  })

  it('menghormati X-Forwarded-Host saat mencocokkan Origin', () => {
    const r = req('POST', {
      host: 'origin.internal',
      'x-forwarded-host': 'app.contoh.co.id',
      origin: 'https://app.contoh.co.id',
    })
    expect(permintaanSamaAsal(r)).toBe(true)
  })

  it('tanpa host sama sekali → false (aman)', () => {
    expect(permintaanSamaAsal(req('POST', { origin: 'https://app.contoh.co.id' }))).toBe(false)
  })
})
