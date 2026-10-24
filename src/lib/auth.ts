/**
 * Auth core — edge-safe (dipakai middleware + route handlers).
 * JWT HS256 via jose, cookie httpOnly "aspro_session".
 * Format payload: { sub (id user), nama, email, username, role }
 */
import { SignJWT, jwtVerify } from 'jose'

export const SESSION_COOKIE = 'aspro_session'
export const SESSION_MAX_AGE = 60 * 60 * 24 * 7 // 7 hari (detik)

export type SessionRole = 'ADMIN_WORKSHOP' | 'TEKNISI' | 'MANAGER' | 'PRODUSEN'

export interface SessionPayload {
  sub: string // id Pengguna (string number)
  nama: string
  email: string
  username: string | null
  role: SessionRole
}

function getSecret(): Uint8Array {
  const secret = process.env.AUTH_SECRET || 'aftersales-pro-secret-2026-ubah-lewat-env-AUTH_SECRET'
  return new TextEncoder().encode(secret)
}

/** Buat token JWT sesi (7 hari) */
export async function signSession(payload: SessionPayload): Promise<string> {
  return await new SignJWT({
    nama: payload.nama,
    email: payload.email,
    username: payload.username ?? null,
    role: payload.role,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE}s`)
    .sign(getSecret())
}

/** Verifikasi token; null jika invalid/kedaluwarsa */
export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret())
    if (!payload.sub || typeof payload.role !== 'string') return null
    return {
      sub: payload.sub,
      nama: typeof payload.nama === 'string' ? payload.nama : '',
      email: typeof payload.email === 'string' ? payload.email : '',
      username: typeof payload.username === 'string' ? payload.username : null,
      role: payload.role as SessionRole,
    }
  } catch {
    return null
  }
}

/** Ambil sesi dari header Cookie ATAU header Authorization: Bearer (fallback iframe) */
export async function getSession(request: Request): Promise<SessionPayload | null> {
  const authz = request.headers.get('authorization')
  if (authz?.toLowerCase().startsWith('bearer ')) {
    const fromBearer = await verifySessionToken(authz.slice(7).trim())
    if (fromBearer) return fromBearer
  }
  const cookie = request.headers.get('cookie') ?? ''
  const m = cookie.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`))
  if (!m) return null
  try {
    return await verifySessionToken(decodeURIComponent(m[1]))
  } catch {
    return null
  }
}

/**
 * Deteksi protokol asli yang dilihat browser (di belakang reverse proxy Caddy,
 * protokol asli ada di header x-forwarded-proto).
 */
function isHttps(request: Request): boolean {
  const proto = request.headers.get('x-forwarded-proto')
  if (proto) return proto.split(',')[0].trim() === 'https'
  try {
    return new URL(request.url).protocol === 'https:'
  } catch {
    return false
  }
}

export type SamesiteMode = 'auto' | 'lax' | 'strict' | 'none'

/**
 * Mode SameSite cookie sesi, dikonfigurasi lewat env SESSION_COOKIE_SAMESITE.
 *
 *  - 'auto' (default): perilaku lama — HTTPS → None+Secure+Partitioned
 *    (agar cookie tetap terkirim saat app di-embed dalam iframe lintas situs),
 *    HTTP → Lax.
 *  - 'lax' (DISARANKAN untuk deployment top-level, mis. server sendiri di
 *    belakang Cloudflare): proteksi CSRF tetap aktif. Cookie Bearer di
 *    localStorage tetap menjadi fallback bila app dibuka dalam iframe
 *    lintas situs yang memblokir cookie.
 *  - 'strict': paling ketat (cookie tidak terkirim saat navigasi antar situs).
 *  - 'none': eksplisit None+Secure+Partitioned (butuh HTTPS).
 *
 * Deployment self-host + Cloudflare umumnya diakses top-level, jadi menyalakan
 * 'lax' menutup celah CSRF yang muncul saat cookie otomatis menjadi None di HTTPS.
 */
function sameSiteMode(): SamesiteMode {
  const v = (process.env.SESSION_COOKIE_SAMESITE ?? '').trim().toLowerCase()
  if (v === 'auto' || v === 'lax' || v === 'strict' || v === 'none') return v
  return 'auto'
}

/**
 * Opsi cookie sesi adaptif (lihat sameSiteMode).
 * SameSite=None WAJIB disertai Secure (dipaksa true).
 */
export function sessionCookieOptions(request: Request, maxAge: number) {
  const https = isHttps(request)
  const mode = sameSiteMode()
  const sameSite: 'lax' | 'strict' | 'none' = mode === 'auto' ? (https ? 'none' : 'lax') : mode
  const secure = https || sameSite === 'none'
  return {
    httpOnly: true,
    sameSite,
    secure,
    ...(sameSite === 'none' ? { partitioned: true } : {}),
    maxAge,
    path: '/',
  }
}
