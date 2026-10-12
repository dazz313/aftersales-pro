import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { autoGitBackup } from '@/lib/git-backup'
import { hashPassword } from '@/lib/auth-node'
import { getSession } from '@/lib/auth'

const USER_PUBLIC = { id: true, nama: true, email: true, username: true, role: true, noWa: true, wilayahKerja: true, aktif: true, createdAt: true }

const VALID_ROLES = ['ADMIN_WORKSHOP', 'TEKNISI', 'MANAGER', 'PRODUSEN']

/** Hanya Admin Workshop & Manager boleh kelola akun karyawan */
async function requireManager(request: Request): Promise<NextResponse | null> {
  const session = await getSession(request)
  if (!session || !['ADMIN_WORKSHOP', 'MANAGER'].includes(session.role)) {
    return NextResponse.json({ error: 'Akses ditolak: hanya Admin Workshop/Manager' }, { status: 403 })
  }
  return null
}

/**
 * PATCH /api/pengguna/[id]
 * Body: { aktif?, role?, nama?, email?, username?, noWa?, wilayahKerja?, password?, aktor? }
 * - password → reset password login
 * - aktif → nonaktifkan/aktifkan akun (nonaktif tidak bisa login)
 * - email/username → harus unik (di luar akun ini)
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const denied = await requireManager(request)
    if (denied) return denied
    const { id } = await params
    const userId = Number(id)
    if (!Number.isFinite(userId)) {
      return NextResponse.json({ error: 'ID tidak valid' }, { status: 400 })
    }
    const existing = await db.pengguna.findUnique({ where: { id: userId } })
    if (!existing) {
      return NextResponse.json({ error: 'Pengguna tidak ditemukan' }, { status: 404 })
    }

    const body = await request.json().catch(() => ({}))
    const data: Record<string, unknown> = {}
    const changes: string[] = []

    if (typeof body.nama === 'string' && body.nama.trim() && body.nama !== existing.nama) {
      data.nama = body.nama.trim()
      changes.push('nama')
    }
    if (typeof body.email === 'string' && body.email.trim() && body.email.trim() !== existing.email) {
      const emailBaru = body.email.trim()
      const emailDipakai = await db.pengguna.findUnique({ where: { email: emailBaru } })
      if (emailDipakai && emailDipakai.id !== userId) {
        return NextResponse.json({ error: 'Email sudah dipakai akun lain' }, { status: 409 })
      }
      data.email = emailBaru
      changes.push('email')
    }
    if ((typeof body.username === 'string' || body.username === null) && (body.username ?? null) !== existing.username) {
      const uname = body.username ? String(body.username).trim() || null : null
      if (uname) {
        const all = await db.pengguna.findMany({ select: { id: true, username: true } })
        const clash = all.some((u) => u.id !== userId && (u.username ?? '').toLowerCase() === uname.toLowerCase())
        if (clash) {
          return NextResponse.json({ error: `Username "${uname}" sudah dipakai akun lain` }, { status: 409 })
        }
      }
      data.username = uname
      changes.push('username')
    }
    if (typeof body.noWa === 'string' || body.noWa === null) {
      data.noWa = body.noWa ?? null
      if (body.noWa !== existing.noWa) changes.push('no. WA')
    }
    if (typeof body.wilayahKerja === 'string' || body.wilayahKerja === null) {
      data.wilayahKerja = body.wilayahKerja ?? null
      if (body.wilayahKerja !== existing.wilayahKerja) changes.push('wilayah kerja')
    }
    if (typeof body.role === 'string' && VALID_ROLES.includes(body.role) && body.role !== existing.role) {
      data.role = body.role
      changes.push(`role ${existing.role} → ${body.role}`)
    }
    if (typeof body.aktif === 'boolean' && body.aktif !== existing.aktif) {
      // cegah admin terakhir dinonaktifkan
      if (!body.aktif && existing.role === 'ADMIN_WORKSHOP') {
        const adminAktif = await db.pengguna.count({ where: { role: 'ADMIN_WORKSHOP', aktif: true } })
        if (adminAktif <= 1) {
          return NextResponse.json({ error: 'Minimal satu Admin Workshop harus aktif' }, { status: 400 })
        }
      }
      data.aktif = body.aktif
      changes.push(body.aktif ? 'akun diaktifkan' : 'akun dinonaktifkan')
    }
    if (typeof body.password === 'string' && body.password) {
      if (body.password.length < 6) {
        return NextResponse.json({ error: 'Password minimal 6 karakter' }, { status: 400 })
      }
      data.passwordHash = hashPassword(body.password)
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: 'Tidak ada perubahan' }, { status: 400 })
    }

    const user = await db.pengguna.update({ where: { id: userId }, data, select: USER_PUBLIC })
    await logAudit({
      aksi: data.passwordHash ? 'RESET_PASSWORD_PENGGUNA' : 'UPDATE_PENGGUNA',
      entitas: 'pengguna',
      entitasId: user.email,
      deskripsi: data.passwordHash
        ? `Reset password akun ${user.nama} (${user.email})`
        : `Update karyawan ${user.nama}: ${changes.join(', ')}`,
      aktor: body.aktor,
    })
    await autoGitBackup(data.passwordHash ? 'RESET_PASSWORD' : 'UPDATE', 'pengguna', user.email, body.aktor)
    return NextResponse.json(user)
  } catch (error) {
    console.error('Pengguna PATCH error:', error)
    return NextResponse.json({ error: 'Gagal memperbarui pengguna' }, { status: 500 })
  }
}
