import { NextResponse } from 'next/server'
import { logAudit } from '@/lib/audit'
import { SESSION_COOKIE, getSession, sessionCookieOptions } from '@/lib/auth'

/**
 * POST /api/auth/logout — hapus cookie sesi + catat audit
 */
export async function POST(request: Request) {
  try {
    const session = await getSession(request)
    if (session) {
      await logAudit({
        aksi: 'LOGOUT',
        entitas: 'auth',
        entitasId: session.email,
        deskripsi: `Logout: ${session.nama} (${session.role})`,
        aktor: session.email,
      })
    }
  } catch (e) {
    console.error('Logout audit gagal:', e)
  }

  const res = NextResponse.json({ ok: true })
  res.cookies.set(SESSION_COOKIE, '', sessionCookieOptions(request, 0))
  return res
}
