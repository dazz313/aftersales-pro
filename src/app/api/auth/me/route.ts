import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { SESSION_COOKIE, getSession } from '@/lib/auth'

/**
 * GET /api/auth/me — info user dari sesi aktif (data fresh dari DB).
 * 401 jika tidak login / sesi invalid / akun dinonaktifkan.
 */
export async function GET(request: Request) {
  const session = await getSession(request)
  if (!session) {
    return NextResponse.json({ error: 'Belum login' }, { status: 401 })
  }

  const user = await db.pengguna.findUnique({ where: { id: Number(session.sub) } })
  if (!user || !user.aktif) {
    const res = NextResponse.json({ error: 'Sesi tidak valid atau akun dinonaktifkan' }, { status: 401 })
    res.cookies.set(SESSION_COOKIE, '', { httpOnly: true, sameSite: 'lax', secure: false, maxAge: 0, path: '/' })
    return res
  }

  return NextResponse.json({
    id: user.id,
    nama: user.nama,
    email: user.email,
    username: user.username,
    role: user.role,
  })
}
