import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { verifyPassword } from '@/lib/auth-node'
import { SESSION_COOKIE, SESSION_MAX_AGE, signSession, type SessionRole } from '@/lib/auth'

/**
 * POST /api/auth/login
 * Body: { email: string (email atau username), password: string }
 * Sukses: set cookie httpOnly aspro_session (JWT HS256, 7 hari)
 */
export async function POST(request: Request) {
  try {
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

    const res = NextResponse.json({
      ok: true,
      user: { id: user.id, nama: user.nama, email: user.email, username: user.username, role: user.role },
    })
    res.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: false, // http (dev & desktop); set true bila di-deploy di https
      maxAge: SESSION_MAX_AGE,
      path: '/',
    })

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
