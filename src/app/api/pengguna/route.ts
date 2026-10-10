import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'

// GET /api/pengguna - list karyawan
export async function GET() {
  try {
    const users = await db.pengguna.findMany({
      include: { kunjungan: { select: { id: true } } },
      orderBy: { role: 'asc' },
    })
    return NextResponse.json(users.map((u) => ({ ...u, jumlahKunjungan: u.kunjungan.length, kunjungan: undefined })))
  } catch (error) {
    console.error('Pengguna GET error:', error)
    return NextResponse.json({ error: 'Gagal memuat data pengguna' }, { status: 500 })
  }
}

// POST /api/pengguna
export async function POST(request: Request) {
  try {
    const body = await request.json()
    if (!body.nama || !body.email) {
      return NextResponse.json({ error: 'Nama dan email wajib diisi' }, { status: 400 })
    }
    const exists = await db.pengguna.findUnique({ where: { email: body.email } })
    if (exists) {
      return NextResponse.json({ error: 'Email sudah terdaftar' }, { status: 409 })
    }
    const validRoles = ['ADMIN_WORKSHOP', 'TEKNISI', 'MANAGER', 'PRODUSEN']
    const role = validRoles.includes(body.role) ? body.role : 'TEKNISI'
    const user = await db.pengguna.create({
      data: {
        nama: body.nama,
        email: body.email,
        role,
        noWa: body.noWa ?? null,
        wilayahKerja: body.wilayahKerja ?? null,
      },
    })
    await logAudit({
      aksi: 'CREATE_PENGGUNA',
      entitas: 'pengguna',
      entitasId: user.email,
      deskripsi: `Karyawan baru: ${user.nama} (${role})`,
      aktor: body.aktor,
    })
    return NextResponse.json(user, { status: 201 })
  } catch (error) {
    console.error('Pengguna POST error:', error)
    return NextResponse.json({ error: 'Gagal menambah pengguna' }, { status: 500 })
  }
}
