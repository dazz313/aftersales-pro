import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { autoGitBackup } from '@/lib/git-backup'
import { hashPassword } from '@/lib/auth-node'
import { getSession } from '@/lib/auth'

const USER_PUBLIC = { id: true, nama: true, email: true, username: true, kodeTeknisi: true, role: true, noWa: true, wilayahKerja: true, aktif: true, createdAt: true }

/** Hanya Admin Workshop & Manager boleh kelola akun karyawan */
async function requireManager(request: Request): Promise<NextResponse | null> {
  const session = await getSession(request)
  if (!session || !['ADMIN_WORKSHOP', 'MANAGER'].includes(session.role)) {
    return NextResponse.json({ error: 'Akses ditolak: hanya Admin Workshop/Manager' }, { status: 403 })
  }
  return null
}

// GET /api/pengguna - list karyawan (tanpa passwordHash)
export async function GET() {
  try {
    const users = await db.pengguna.findMany({
      include: { kunjungan: { select: { id: true } } },
      orderBy: { role: 'asc' },
    })
    return NextResponse.json(users.map((u) => ({ ...u, jumlahKunjungan: u.kunjungan.length, kunjungan: undefined, passwordHash: undefined })))
  } catch (error) {
    console.error('Pengguna GET error:', error)
    return NextResponse.json({ error: 'Gagal memuat data pengguna' }, { status: 500 })
  }
}

// POST /api/pengguna — karyawan baru (username & password opsional)
export async function POST(request: Request) {
  try {
    const denied = await requireManager(request)
    if (denied) return denied
    const body = await request.json()
    if (!body.nama || !body.email) {
      return NextResponse.json({ error: 'Nama dan email wajib diisi' }, { status: 400 })
    }
    const email = String(body.email).trim()
    const exists = await db.pengguna.findUnique({ where: { email } })
    if (exists) {
      return NextResponse.json({ error: 'Email sudah terdaftar' }, { status: 409 })
    }

    // Username: dari body atau email lokal-part; harus unik
    let username: string | null = body.username ? String(body.username).trim() : email.split('@')[0] || null
    if (username) {
      const unameLower = username.toLowerCase()
      const all = await db.pengguna.findMany({ select: { username: true } })
      const clash = all.some((u) => (u.username ?? '').toLowerCase() === unameLower)
      if (clash) {
        return NextResponse.json({ error: `Username "${username}" sudah dipakai` }, { status: 409 })
      }
    }

    // Kode teknisi: opsional, harus unik bila diisi
    const kodeTeknisi: string | null = body.kodeTeknisi ? String(body.kodeTeknisi).trim().toUpperCase() || null : null
    if (kodeTeknisi) {
      const kodeDipakai = await db.pengguna.findUnique({ where: { kodeTeknisi } })
      if (kodeDipakai) {
        return NextResponse.json({ error: `Kode teknisi "${kodeTeknisi}" sudah dipakai` }, { status: 409 })
      }
    }

    // Password: default "aftersales123" bila kosong
    const password = body.password ? String(body.password) : 'aftersales123'
    if (password.length < 6) {
      return NextResponse.json({ error: 'Password minimal 6 karakter' }, { status: 400 })
    }

    const validRoles = ['ADMIN_WORKSHOP', 'TEKNISI', 'MANAGER', 'PRODUSEN']
    const role = validRoles.includes(body.role) ? body.role : 'TEKNISI'
    const user = await db.pengguna.create({
      data: {
        nama: body.nama,
        email,
        username,
        kodeTeknisi,
        passwordHash: hashPassword(password),
        role,
        noWa: body.noWa ?? null,
        wilayahKerja: body.wilayahKerja ?? null,
      },
      select: USER_PUBLIC,
    })
    await logAudit({
      aksi: 'CREATE_PENGGUNA',
      entitas: 'pengguna',
      entitasId: user.email,
      deskripsi: `Karyawan baru: ${user.nama} (${role}) — login ${body.password ? 'password kustom' : 'password default'}`,
      aktor: body.aktor,
    })
    await autoGitBackup('CREATE', 'pengguna', user.email, body.aktor)
    return NextResponse.json(user, { status: 201 })
  } catch (error) {
    console.error('Pengguna POST error:', error)
    return NextResponse.json({ error: 'Gagal menambah pengguna' }, { status: 500 })
  }
}
