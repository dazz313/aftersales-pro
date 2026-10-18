import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { autoGitBackup } from '@/lib/git-backup'
import { requireActiveSession } from '@/lib/auth-server'

// GET /api/toko - list semua toko + status kepatuhan visit
export async function GET() {
  try {
    const toko = await db.masterToko.findMany({
      include: {
        unitAssets: { select: { id: true } },
        kunjungan: { orderBy: { tglKunjungan: 'desc' }, take: 1 },
      },
      orderBy: { kodeToko: 'asc' },
    })
    const now = Date.now()
    const result = toko.map((t) => {
      const hariSejak = t.tglVisitTerakhir
        ? Math.floor((now - new Date(t.tglVisitTerakhir).getTime()) / (24 * 3600 * 1000))
        : null
      return {
        ...t,
        jumlahUnit: t.unitAssets.length,
        // Toko tidak aktif / siklus BY REQUEST tidak pernah "terlambat" —
        // kunjungannya diatur sendiri (tidak ikut siklus otomatis).
        visitTerlambat: !t.aktif || t.modeSiklus === 'BY_REQUEST' ? false : hariSejak === null || hariSejak > t.frekuensiVisit,
        hariSejakVisit: hariSejak,
      }
    })
    return NextResponse.json(result)
  } catch (error) {
    console.error('Toko GET error:', error)
    return NextResponse.json({ error: 'Gagal memuat data toko' }, { status: 500 })
  }
}

// POST /api/toko - tambah toko baru
export async function POST(request: Request) {
  try {
    const { session, denied } = await requireActiveSession(request)
    if (denied) return denied
    void session
    const body = await request.json()
    if (!body.kodeToko || !body.namaToko) {
      return NextResponse.json({ error: 'Kode toko dan nama toko wajib diisi' }, { status: 400 })
    }
    const exists = await db.masterToko.findUnique({ where: { kodeToko: body.kodeToko } })
    if (exists) {
      return NextResponse.json({ error: `Kode toko ${body.kodeToko} sudah terdaftar` }, { status: 409 })
    }
    // Barcode per-TOKO untuk identifikasi kunjungan otomatis via scan
    const barcodeToko = (body.barcodeToko || `BC-${String(body.kodeToko).toUpperCase()}`).trim()
    const barcodeExists = await db.masterToko.findUnique({ where: { barcodeToko } })
    if (barcodeExists) {
      return NextResponse.json({ error: `Barcode ${barcodeToko} sudah dipakai toko lain` }, { status: 409 })
    }
    const toko = await db.masterToko.create({
      data: {
        kodeToko: body.kodeToko,
        namaToko: body.namaToko,
        alamat: body.alamat ?? null,
        kontak: body.kontak ?? null,
        frekuensiVisit: Number(body.frekuensiVisit) || 14,
        tglVisitTerakhir: body.tglVisitTerakhir ? new Date(body.tglVisitTerakhir) : null,
        barcodeToko,
        jarakKm: body.jarakKm === undefined || body.jarakKm === null || body.jarakKm === '' ? null : Math.max(0, Number(body.jarakKm) || 0),
      },
    })
    await logAudit({
      aksi: 'CREATE_MASTER_TOKO',
      entitas: 'master_toko',
      entitasId: toko.kodeToko,
      deskripsi: `Toko baru ditambahkan: ${toko.namaToko} — barcode kunjungan ${toko.barcodeToko}`,
      aktor: body.aktor,
    })
    await autoGitBackup('CREATE', 'master_toko', toko.kodeToko, body.aktor)
    return NextResponse.json(toko, { status: 201 })
  } catch (error) {
    console.error('Toko POST error:', error)
    return NextResponse.json({ error: 'Gagal menambah toko' }, { status: 500 })
  }
}
