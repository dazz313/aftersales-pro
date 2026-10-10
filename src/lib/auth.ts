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

/** Ambil sesi dari header Cookie pada Request apa pun */
export async function getSession(request: Request): Promise<SessionPayload | null> {
  const cookie = request.headers.get('cookie') ?? ''
  const m = cookie.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`))
  if (!m) return null
  try {
    return await verifySessionToken(decodeURIComponent(m[1]))
  } catch {
    return null
  }
}
