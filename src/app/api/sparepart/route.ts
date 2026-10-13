import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { backupSparepartToGit } from '@/lib/git-backup'
import { requireActiveSession } from '@/lib/auth-server'

// GET /api/sparepart - list sparepart + status ROP + hitungan pemakaian di tiket
export async function GET() {
  try {
    const parts = await db.masterSparepart.findMany({
      include: {
        serviceParts: {
          where: { statusPart: 'READY' },
          include: { serviceRequest: { select: { noTiket: true, status: true } } },
        },
        _count: { select: { serviceParts: true } },
      },
      orderBy: { kodePart: 'asc' },
    })
    const result = parts.map((p) => ({
      ...p,
      _count: undefined,
      dipakai: p._count.serviceParts,
      ropAlert: p.stokInventory <= p.reorderLimit,
      kosong: p.stokInventory === 0,
    }))
    return NextResponse.json(result)
  } catch (error) {
    console.error('Sparepart GET error:', error)
    return NextResponse.json({ error: 'Gagal memuat data sparepart' }, { status: 500 })
  }
}

// Stok total selalu = stokJual + stokGaransi agar konsisten di semua pembaca lama.
function resolveStokCreate(body: {
  stokJual?: unknown
  stokGaransi?: unknown
  stokInventory?: unknown
}) {
  const jualDefined = body.stokJual !== undefined && body.stokJual !== null && body.stokJual !== ''
  const garansiDefined = body.stokGaransi !== undefined && body.stokGaransi !== null && body.stokGaransi !== ''
  if (jualDefined || garansiDefined) {
    const stokJual = Math.max(0, Math.trunc(Number(body.stokJual) || 0))
    const stokGaransi = Math.max(0, Math.trunc(Number(body.stokGaransi) || 0))
    return { stokJual, stokGaransi, stokInventory: stokJual + stokGaransi }
  }
  const total = Math.max(0, Math.trunc(Number(body.stokInventory) || 0))
  return { stokJual: total, stokGaransi: 0, stokInventory: total }
}

// POST /api/sparepart
export async function POST(request: Request) {
  try {
    const { session, denied } = await requireActiveSession(request)
    if (denied) return denied
    void session
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
        brandKompatibel: String(body.brandKompatibel ?? '').trim(),
        supplier: String(body.supplier ?? '').trim(),
        // 5 komponen utama: stok dipecah bisa-jual + garansi; total = jumlah keduanya.
        // Kompatibel legacy: bila hanya stokInventory dikirim, anggap semuanya stok jual.
        ...resolveStokCreate(body),
        reorderLimit: Number(body.reorderLimit) || 5,
        hargaKlaim: Number(body.hargaKlaim) || 0,
      },
    })
    await logAudit({
      aksi: 'CREATE_MASTER_SPAREPART',
      entitas: 'master_sparepart',
      entitasId: part.kodePart,
      deskripsi: `Sparepart baru: ${part.namaPart} (jual ${part.stokJual} + garansi ${part.stokGaransi})${part.supplier ? ` · supplier ${part.supplier}` : ''}${part.brandKompatibel ? ` · brand: ${part.brandKompatibel}` : ''}`,
      aktor: body.aktor,
    })
    await backupSparepartToGit('CREATE', part.kodePart, body.aktor)
    return NextResponse.json(part, { status: 201 })
  } catch (error) {
    console.error('Sparepart POST error:', error)
    return NextResponse.json({ error: 'Gagal menambah sparepart' }, { status: 500 })
  }
}
