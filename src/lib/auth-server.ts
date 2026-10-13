import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSession, type SessionPayload } from '@/lib/auth'

/**
 * Validasi sesi sisi server (khusus route handler, BUKAN middleware/edge).
 * Selain tanda tangan JWT, pastikan akun masih ada & aktif, dan role
 * diambil fresh dari database (demosi/nonaktif langsung berlaku —
 * token lama tidak bisa dipakai lagi untuk mengubah data).
 */
export async function getActiveSession(request: Request): Promise<SessionPayload | null> {
  const s = await getSession(request)
  if (!s) return null
  const id = Number(s.sub)
  if (!Number.isFinite(id)) return null
  const user = await db.pengguna
    .findUnique({ where: { id }, select: { aktif: true, role: true, nama: true, email: true, username: true } })
    .catch(() => null)
  if (!user || !user.aktif) return null
  return {
    sub: s.sub,
    nama: user.nama,
    email: user.email,
    username: user.username,
    role: user.role as SessionPayload['role'],
  }
}

/**
 * Guard standar untuk route yang mengubah data: kembalikan
 * `{ session, denied }` — `if (denied) return denied`.
 */
export async function requireActiveSession(request: Request) {
  const session = await getActiveSession(request)
  if (!session) {
    return {
      session: null as SessionPayload | null,
      denied: NextResponse.json(
        { error: 'Sesi berakhir atau akun nonaktif. Silakan login ulang.' },
        { status: 401 }
      ),
    }
  }
  return { session, denied: null as NextResponse | null }
}

/** Guard khusus Admin Workshop / Manager (pakai sesi fresh dari DB). */
export function requireManagerSession(session: SessionPayload | null) {
  if (!session || !['ADMIN_WORKSHOP', 'MANAGER'].includes(session.role)) {
    return NextResponse.json({ error: 'Akses ditolak: hanya Admin Workshop/Manager' }, { status: 403 })
  }
  return null
}
