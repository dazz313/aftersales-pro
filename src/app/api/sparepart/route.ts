import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'

// GET /api/sparepart - list sparepart + status ROP
export async function GET() {
  try {
    const parts = await db.masterSparepart.findMany({
      include: {
        serviceParts: {
          where: { statusPart: 'READY' },
          include: { serviceRequest: { select: { noTiket: true, status: true } } },
        },
      },
      orderBy: { kodePart: 'asc' },
    })
    const result = parts.map((p) => ({
      ...p,
      ropAlert: p.stokInventory <= p.reorderLimit,
      kosong: p.stokInventory === 0,
    }))
    return NextResponse.json(result)
  } catch (error) {
    console.error('Sparepart GET error:', error)
    return NextResponse.json({ error: 'Gagal memuat data sparepart' }, { status: 500 })
  }
}

// POST /api/sparepart
export async function POST(request: Request) {
  try {
    const body = await request.json()
    if (!body.kodePart || !body.namaPart) {
      return NextResponse.json({ error: 'Kode part dan nama part wajib diisi' }, { status: 400 })
    }
    const exists = await db.masterSparepart.findUnique({ where: { kodePart: body.kodePart } })
    if (exists) {
      return NextResponse.json({ error: `Kode part ${body.kodePart} sudah terdaftar` }, { status: 409 })
    }
    const part = await db.masterSparepart.create({
      data: {
        kodePart: body.kodePart,
        namaPart: body.namaPart,
        stokInventory: Number(body.stokInventory) || 0,
        reorderLimit: Number(body.reorderLimit) || 5,
        hargaKlaim: Number(body.hargaKlaim) || 0,
      },
    })
    await logAudit({
      aksi: 'CREATE_MASTER_SPAREPART',
      entitas: 'master_sparepart',
      entitasId: part.kodePart,
      deskripsi: `Sparepart baru: ${part.namaPart} (stok awal ${part.stokInventory})`,
      aktor: body.aktor,
    })
    return NextResponse.json(part, { status: 201 })
  } catch (error) {
    console.error('Sparepart POST error:', error)
    return NextResponse.json({ error: 'Gagal menambah sparepart' }, { status: 500 })
  }
}
