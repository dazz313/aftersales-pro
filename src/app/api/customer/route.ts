import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { autoGitBackup } from '@/lib/git-backup'

// GET /api/customer - list customer
export async function GET() {
  try {
    const customers = await db.masterCustomer.findMany({
      include: { unitAssets: { select: { id: true, modelUnit: true } } },
      orderBy: { nama: 'asc' },
    })
    return NextResponse.json(customers)
  } catch (error) {
    console.error('Customer GET error:', error)
    return NextResponse.json({ error: 'Gagal memuat data customer' }, { status: 500 })
  }
}

// POST /api/customer
export async function POST(request: Request) {
  try {
    const body = await request.json()
    if (!body.nama) {
      return NextResponse.json({ error: 'Nama customer wajib diisi' }, { status: 400 })
    }
    const customer = await db.masterCustomer.create({
      data: {
        nama: body.nama,
        noWa: body.noWa ?? null,
        alamat: body.alamat ?? null,
      },
    })
    await logAudit({
      aksi: 'CREATE_MASTER_CUSTOMER',
      entitas: 'master_customer',
      entitasId: String(customer.id),
      deskripsi: `Customer baru: ${customer.nama}`,
      aktor: body.aktor,
    })
    await autoGitBackup('CREATE', 'master_customer', customer.nama, body.aktor)
    return NextResponse.json(customer, { status: 201 })
  } catch (error) {
    console.error('Customer POST error:', error)
    return NextResponse.json({ error: 'Gagal menambah customer' }, { status: 500 })
  }
}
