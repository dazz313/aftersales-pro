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
    // Cocokkan barcode (BC-... / nama toko / kode toko), case-insensitive.
    let toko = await db.masterToko.findFirst({
      where: { OR: [{ barcodeToko: barcode }, { barcodeToko: `BC-${norm}` }, { kodeToko: norm }] },
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
      const bLower = barcode.trim().toLowerCase()
      toko = all.find((t) =>
        (t.barcodeToko ?? '').trim().toLowerCase() === bLower ||
        (t.namaToko ?? '').trim().toLowerCase() === bLower ||
        (t.barcodeToko ?? '').toUpperCase().replace(/^BC-/, '') === norm ||
        (t.kodeToko ?? '').toUpperCase() === norm
      ) ?? null
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
        latitude: toko.latitude,
        longitude: toko.longitude,
        frekuensiVisit: toko.frekuensiVisit,
        tglVisitTerakhir: toko.tglVisitTerakhir,
        barcodeToko: toko.barcodeToko,
      },
      jumlahUnit: toko._count.unitAssets,
      totalKunjungan: toko._count.kunjungan,
      hariSejakVisit: hariSejak,
      // Toko tidak aktif / siklus BY REQUEST tidak dianggap "terlambat" —
      // kunjungannya atas permintaan (konsisten Field Ops & ALT-01).
      visitTerlambat: !toko.aktif || toko.modeSiklus === 'BY_REQUEST' ? false : hariSejak === null || hariSejak > toko.frekuensiVisit,
      kunjunganTerakhir: toko.kunjungan[0]
        ? { waktu: toko.kunjungan[0].tglKunjungan, teknisi: toko.kunjungan[0].teknisi.nama, metode: toko.kunjungan[0].metodeCheckin }
        : null,
    })
  } catch (error) {
    console.error('Kunjungan lookup error:', error)
    return NextResponse.json({ error: 'Gagal melakukan lookup barcode' }, { status: 500 })
  }
}
