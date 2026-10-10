import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'

// GET /api/kunjungan - riwayat kunjungan + info kepatuhan
export async function GET() {
  try {
    const kunjungan = await db.kunjungan.findMany({
      include: {
        toko: { select: { id: true, kodeToko: true, namaToko: true, alamat: true } },
        teknisi: { select: { id: true, nama: true, wilayahKerja: true } },
      },
      orderBy: { tglKunjungan: 'desc' },
      take: 100,
    })
    return NextResponse.json(kunjungan)
  } catch (error) {
    console.error('Kunjungan GET error:', error)
    return NextResponse.json({ error: 'Gagal memuat data kunjungan' }, { status: 500 })
  }
}

/**
 * POST /api/kunjungan - Check-in kunjungan onsite (teknisi)
 * Body: { tokoId, teknisiId, fotoOnsite?, catatanStokRusak?, serialTerdeteksi? }
 * Kunjungan onsite dipercepat dengan scan barcode/QR unit (Modul 1.2 PRD)
 */
export async function POST(request: Request) {
  try {
    const body = await request.json()
    if (!body.tokoId || !body.teknisiId) {
      return NextResponse.json({ error: 'Toko dan teknisi wajib dipilih' }, { status: 400 })
    }
    const toko = await db.masterToko.findUnique({ where: { id: Number(body.tokoId) } })
    if (!toko) {
      return NextResponse.json({ error: 'Toko tidak ditemukan' }, { status: 404 })
    }
    const teknisi = await db.pengguna.findUnique({ where: { id: Number(body.teknisiId) } })
    if (!teknisi) {
      return NextResponse.json({ error: 'Teknisi tidak ditemukan' }, { status: 404 })
    }

    const [kunjungan] = await Promise.all([
      db.kunjungan.create({
        data: {
          tokoId: Number(body.tokoId),
          teknisiId: Number(body.teknisiId),
          fotoOnsite: body.fotoOnsite ?? null,
          catatanStokRusak: body.catatanStokRusak ?? null,
        },
      }),
      // Update tgl visit terakhir toko (siklus kunjungan reset)
      db.masterToko.update({
        where: { id: Number(body.tokoId) },
        data: { tglVisitTerakhir: new Date() },
      }),
    ])

    await logAudit({
      aksi: 'CREATE_KUNJUNGAN',
      entitas: 'kunjungan',
      entitasId: String(kunjungan.id),
      deskripsi: `Teknisi ${teknisi.nama} check-in onsite di ${toko.namaToko} (${toko.kodeToko})${body.serialTerdeteksi ? ` — unit ter-scan: ${body.serialTerdeteksi}` : ''}`,
      aktor: teknisi.nama,
    })

    return NextResponse.json(
      { ...kunjungan, toko, teknisi },
      { status: 201 }
    )
  } catch (error) {
    console.error('Kunjungan POST error:', error)
    return NextResponse.json({ error: 'Gagal mencatat kunjungan' }, { status: 500 })
  }
}
