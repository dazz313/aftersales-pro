import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { autoGitBackup } from '@/lib/git-backup'

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
 *
 * Dua metode check-in:
 * 1. SCAN_BARCODE (utama): teknisi memindai barcode yang ditempel di TOKO
 *    (satu barcode per toko, bukan per unit). Sistem otomatis mengenali toko
 *    dari nilai barcode (BC-[KODETOKO]) dan mencatat kunjungan seketika.
 *    body: { barcode, teknisiId, catatanStokRusak?, fotoOnsite? }
 * 2. MANUAL: pilih toko dari daftar.
 *    body: { tokoId, teknisiId, fotoOnsite?, catatanStokRusak? }
 */
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const metodeCheckin: 'SCAN_BARCODE' | 'MANUAL' = body.metodeCheckin === 'SCAN_BARCODE' ? 'SCAN_BARCODE' : 'MANUAL'

    // ===== Resolusi toko: via scan barcode (utama) atau pilihan manual =====
    let toko = null
    let barcodeTerscan: string | null = null

    if (body.barcode) {
      barcodeTerscan = String(body.barcode).trim()
      // Terima nilai apa pun formatnya: BC-TOK-001, bc-tok-001, TOK-001
      // (SQLite tidak mendukung mode insensitive — normalisasi di sisi aplikasi)
      const norm = barcodeTerscan.toUpperCase().replace(/^BC-/, '')
      toko = await db.masterToko.findFirst({
        where: { OR: [{ barcodeToko: `BC-${norm}` }, { barcodeToko: barcodeTerscan }, { kodeToko: norm }] },
      })
      if (!toko) {
        const all = await db.masterToko.findMany()
        toko = all.find((t) => (t.barcodeToko ?? '').toUpperCase().replace(/^BC-/, '') === norm || t.kodeToko.toUpperCase() === norm) ?? null
      }
      if (!toko) {
        return NextResponse.json(
          { error: `Barcode "${barcodeTerscan}" tidak dikenali — bukan barcode toko yang terdaftar. Periksa stiker atau gunakan check-in manual.` },
          { status: 404 }
        )
      }
    } else if (body.tokoId) {
      toko = await db.masterToko.findUnique({ where: { id: Number(body.tokoId) } })
      if (!toko) {
        return NextResponse.json({ error: 'Toko tidak ditemukan' }, { status: 404 })
      }
    } else {
      return NextResponse.json({ error: 'Scan barcode toko atau pilih toko terlebih dahulu' }, { status: 400 })
    }

    if (!body.teknisiId) {
      return NextResponse.json({ error: 'Teknisi wajib dipilih' }, { status: 400 })
    }
    const teknisi = await db.pengguna.findUnique({ where: { id: Number(body.teknisiId) } })
    if (!teknisi) {
      return NextResponse.json({ error: 'Teknisi tidak ditemukan' }, { status: 404 })
    }

    const [kunjungan] = await Promise.all([
      db.kunjungan.create({
        data: {
          tokoId: toko.id,
          teknisiId: Number(body.teknisiId),
          metodeCheckin,
          barcodeTerscan,
          fotoOnsite: body.fotoOnsite ?? null,
          catatanStokRusak: body.catatanStokRusak ?? null,
        },
      }),
      // Update tgl visit terakhir toko (siklus kunjungan reset)
      db.masterToko.update({
        where: { id: toko.id },
        data: { tglVisitTerakhir: new Date() },
      }),
    ])

    await logAudit({
      aksi: 'CREATE_KUNJUNGAN',
      entitas: 'kunjungan',
      entitasId: String(kunjungan.id),
      deskripsi: `Teknisi ${teknisi.nama} check-in ${metodeCheckin === 'SCAN_BARCODE' ? 'via scan barcode' : 'manual'} di ${toko.namaToko} (${toko.kodeToko})${barcodeTerscan ? ` — barcode: ${barcodeTerscan}` : ''}`,
      aktor: teknisi.nama,
    })

    await autoGitBackup('CREATE', 'kunjungan', `${toko.kodeToko}`, teknisi.nama)
    return NextResponse.json({ ...kunjungan, toko, teknisi }, { status: 201 })
  } catch (error) {
    console.error('Kunjungan POST error:', error)
    return NextResponse.json({ error: 'Gagal mencatat kunjungan' }, { status: 500 })
  }
}
