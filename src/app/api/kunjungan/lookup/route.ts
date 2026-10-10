import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

/**
 * GET /api/kunjungan/lookup?barcode=BC-TOK-001
 * Pratinjau hasil scan barcode toko TANPA mencatat kunjungan.
 * Sistem mengenali toko dari nilai barcode (per toko, bukan per unit).
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const barcode = (searchParams.get('barcode') ?? '').trim()
    if (!barcode) {
      return NextResponse.json({ error: 'Parameter barcode wajib diisi' }, { status: 400 })
    }

    const norm = barcode.toUpperCase().replace(/^BC-/, '')
    // SQLite tidak mendukung mode insensitive — normalisasi di sisi aplikasi.
    // Coba cocokkan langsung (BC-[KODE] atau kode toko), lalu fallback scan kecil (dataset master toko kecil).
    let toko = await db.masterToko.findFirst({
      where: { OR: [{ barcodeToko: `BC-${norm}` }, { barcodeToko: barcode }, { kodeToko: norm }] },
      include: {
        _count: { select: { unitAssets: true, kunjungan: true } },
        kunjungan: { orderBy: { tglKunjungan: 'desc' }, take: 1, include: { teknisi: { select: { nama: true } } } },
      },
    })
    if (!toko) {
      const all = await db.masterToko.findMany({
        include: {
          _count: { select: { unitAssets: true, kunjungan: true } },
          kunjungan: { orderBy: { tglKunjungan: 'desc' }, take: 1, include: { teknisi: { select: { nama: true } } } },
        },
      })
      toko = all.find((t) => (t.barcodeToko ?? '').toUpperCase().replace(/^BC-/, '') === norm || t.kodeToko.toUpperCase() === norm) ?? null
    }

    if (!toko) {
      return NextResponse.json(
        { error: `Barcode "${barcode}" tidak dikenali — bukan barcode toko yang terdaftar.` },
        { status: 404 }
      )
    }

    const hariSejak = toko.tglVisitTerakhir
      ? Math.floor((Date.now() - new Date(toko.tglVisitTerakhir).getTime()) / (24 * 3600 * 1000))
      : null

    return NextResponse.json({
      toko: {
        id: toko.id,
        kodeToko: toko.kodeToko,
        namaToko: toko.namaToko,
        alamat: toko.alamat,
        kontak: toko.kontak,
        frekuensiVisit: toko.frekuensiVisit,
        tglVisitTerakhir: toko.tglVisitTerakhir,
        barcodeToko: toko.barcodeToko,
      },
      jumlahUnit: toko._count.unitAssets,
      totalKunjungan: toko._count.kunjungan,
      hariSejakVisit: hariSejak,
      visitTerlambat: hariSejak === null || hariSejak > toko.frekuensiVisit,
      kunjunganTerakhir: toko.kunjungan[0]
        ? { waktu: toko.kunjungan[0].tglKunjungan, teknisi: toko.kunjungan[0].teknisi.nama, metode: toko.kunjungan[0].metodeCheckin }
        : null,
    })
  } catch (error) {
    console.error('Kunjungan lookup error:', error)
    return NextResponse.json({ error: 'Gagal melakukan lookup barcode' }, { status: 500 })
  }
}
