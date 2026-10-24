import { describe, it, expect, afterEach } from 'vitest'
import { sessionCookieOptions } from '@/lib/auth'

const ENV_KEY = 'SESSION_COOKIE_SAMESITE'
const asal = process.env[ENV_KEY]

afterEach(() => {
  if (asal === undefined) delete process.env[ENV_KEY]
  else process.env[ENV_KEY] = asal
})

/** Request di belakang reverse proxy/Cloudflare (protokol asli https). */
function httpsReq() {
  return new Request('http://origin.local/api/x', { headers: { 'x-forwarded-proto': 'https' } })
}
/** Request langsung HTTP (localhost / Electron). */
function httpReq() {
  return new Request('http://localhost:3000/api/x')
}

describe('sessionCookieOptions — mode auto (default, perilaku lama)', () => {
  it('HTTPS → SameSite=None + Secure + Partitioned', () => {
    delete process.env[ENV_KEY]
    const o = sessionCookieOptions(httpsReq(), 600)
    expect(o.sameSite).toBe('none')
    expect(o.secure).toBe(true)
    expect(o.partitioned).toBe(true)
    expect(o.httpOnly).toBe(true)
    expect(o.path).toBe('/')
  })

  it('HTTP → SameSite=Lax tanpa Secure', () => {
    delete process.env[ENV_KEY]
    const o = sessionCookieOptions(httpReq(), 600)
    expect(o.sameSite).toBe('lax')
    expect(o.secure).toBe(false)
    expect(o.partitioned).toBeUndefined()
  })
})

describe('sessionCookieOptions — mode eksplisit via SESSION_COOKIE_SAMESITE', () => {
  it('lax pada HTTPS → SameSite=Lax + Secure (proteksi CSRF aktif)', () => {
    process.env[ENV_KEY] = 'lax'
    const o = sessionCookieOptions(httpsReq(), 600)
    expect(o.sameSite).toBe('lax')
    expect(o.secure).toBe(true)
    expect(o.partitioned).toBeUndefined()
  })

  it('lax pada HTTP → Lax tanpa Secure', () => {
    process.env[ENV_KEY] = 'lax'
    const o = sessionCookieOptions(httpReq(), 600)
    expect(o.sameSite).toBe('lax')
    expect(o.secure).toBe(false)
  })

  it('strict dihormati', () => {
    process.env[ENV_KEY] = 'strict'
    expect(sessionCookieOptions(httpsReq(), 600).sameSite).toBe('strict')
  })

  it('none memaksa Secure + Partitioned meski protokol terlihat HTTP', () => {
    process.env[ENV_KEY] = 'none'
    const o = sessionCookieOptions(httpReq(), 600)
    expect(o.sameSite).toBe('none')
    expect(o.secure).toBe(true)
    expect(o.partitioned).toBe(true)
  })

  it('nilai tidak dikenal jatuh ke perilaku auto', () => {
    process.env[ENV_KEY] = 'ngawur'
    expect(sessionCookieOptions(httpsReq(), 600).sameSite).toBe('none')
    expect(sessionCookieOptions(httpReq(), 600).sameSite).toBe('lax')
  })
})
