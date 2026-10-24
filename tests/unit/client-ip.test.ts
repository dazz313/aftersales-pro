import { describe, it, expect } from 'vitest'
import { ipClient, lewatCloudflare } from '@/lib/client-ip'

function req(headers: Record<string, string>) {
  return new Request('http://localhost/api/x', { headers })
}

describe('ipClient — IP klien asli di belakang proxy/Cloudflare', () => {
  it('memprioritaskan CF-Connecting-IP', () => {
    expect(
      ipClient(
        req({
          'cf-connecting-ip': '203.0.113.7',
          'x-forwarded-for': '198.51.100.9, 10.0.0.1',
        })
      )
    ).toBe('203.0.113.7')
  })

  it('memakai entri paling kiri X-Forwarded-For bila tanpa Cloudflare', () => {
    expect(ipClient(req({ 'x-forwarded-for': '198.51.100.9, 10.0.0.1, 10.0.0.2' }))).toBe(
      '198.51.100.9'
    )
  })

  it('jatuh ke X-Real-IP bila hanya itu yang ada', () => {
    expect(ipClient(req({ 'x-real-ip': '192.0.2.55' }))).toBe('192.0.2.55')
  })

  it("mengembalikan 'unknown' bila tidak ada header IP", () => {
    expect(ipClient(req({}))).toBe('unknown')
  })

  it('mengabaikan header kosong/spasi', () => {
    expect(ipClient(req({ 'cf-connecting-ip': '   ' }))).toBe('unknown')
  })
})

describe('lewatCloudflare', () => {
  it('true bila ada cf-ray / cf-connecting-ip', () => {
    expect(lewatCloudflare(req({ 'cf-ray': 'abc123-FRA' }))).toBe(true)
    expect(lewatCloudflare(req({ 'cf-connecting-ip': '203.0.113.7' }))).toBe(true)
  })

  it('false bila tidak ada indikator Cloudflare', () => {
    expect(lewatCloudflare(req({ 'x-forwarded-for': '1.2.3.4' }))).toBe(false)
  })
})
