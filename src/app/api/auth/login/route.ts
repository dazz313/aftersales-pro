import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { verifyPassword } from '@/lib/auth-node'
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE,
  sessionCookieOptions,
  signSession,
  type SessionRole,
} from '@/lib/auth'

/**
 * POST /api/auth/login
 * Body: { email: string (email atau username), password: string }
 * Sukses: set cookie httpOnly aspro_session (JWT HS256, 7 hari) + token di body
 * (token dipakai client sebagai fallback Bearer saat cookie diblokir iframe).
 * Proteksi brute-force: jeda 400ms + throttle 10x gagal / 5 menit per IP.
 */
const gagalPerIp = new Map<string, { count: number; resetAt: number }>()
const BATAS_GAGAL = 10
const JANJI_THROTTLE_MS = 5 * 60_000

function ipClient(request: Request): string {
  const fwd = request.headers.get('x-forwarded-for')
  if (fwd) return fwd.split(',')[0].trim()
  return request.headers.get('x-real-ip')?.trim() || 'unknown'
}

export async function POST(request: Request) {
  try {
    const ip = ipClient(request)
    const now = Date.now()
    const catat = gagalPerIp.get(ip)
    if (catat && catat.resetAt > now && catat.count >= BATAS_GAGAL) {
      return NextResponse.json(
        { error: 'Terlalu banyak percobaan gagal. Coba lagi beberapa menit.' },
        { status: 429 }
      )
    }
    if (!catat || catat.resetAt <= now) gagalPerIp.set(ip, { count: 0, resetAt: now + JANJI_THROTTLE_MS })
    const body = await request.json().catch(() => null)
    const identifier = String(body?.email ?? '').trim()
    const password = String(body?.password ?? '')

    if (!identifier || !password) {
      return NextResponse.json({ error: 'Email/username dan password wajib diisi' }, { status: 400 })
    }

    const users = await db.pengguna.findMany({ where: { aktif: true } })
    const idLower = identifier.toLowerCase()
    const user = users.find(
      (u) => u.email.toLowerCase() === idLower || (u.username ?? '').toLowerCase() === idLower
    )

    if (!user || !verifyPassword(password, user.passwordHash)) {
      const cur = gagalPerIp.get(ipClient(request)) ?? { count: 0, resetAt: Date.now() + JANJI_THROTTLE_MS }
      cur.count += 1
      gagalPerIp.set(ipClient(request), cur)
      await logAudit({
        aksi: 'LOGIN_GAGAL',
        entitas: 'auth',
        entitasId: identifier.slice(0, 120),
        deskripsi: `Percobaan login gagal untuk "${identifier.slice(0, 60)}"`,
        aktor: identifier.slice(0, 60) || 'UNKNOWN',
      })
      await new Promise((r) => setTimeout(r, 400)) // perlambat brute-force
      return NextResponse.json({ error: 'Email/username atau password salah' }, { status: 401 })
    }

    const token = await signSession({
      sub: String(user.id),
      nama: user.nama,
      email: user.email,
      username: user.username,
      role: user.role as SessionRole,
    })
    gagalPerIp.delete(ipClient(request))

    const res = NextResponse.json({
      ok: true,
      token,
      user: { id: user.id, nama: user.nama, email: user.email, username: user.username, role: user.role },
    })
    res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(request, SESSION_MAX_AGE))

    await logAudit({
      aksi: 'LOGIN',
      entitas: 'auth',
      entitasId: user.email,
      deskripsi: `Login berhasil: ${user.nama} (${user.role})`,
      aktor: user.email,
    })
    return res
  } catch (error) {
    console.error('Login error:', error)
    return NextResponse.json({ error: 'Login gagal, coba lagi' }, { status: 500 })
  }
}
