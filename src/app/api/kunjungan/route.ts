import { NextResponse } from 'next/server'
import type { MasterToko } from '@prisma/client'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { autoGitBackup } from '@/lib/git-backup'
import { requireActiveSession } from '@/lib/auth-server'

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
    const { session, denied } = await requireActiveSession(request)
    if (denied) return denied
    void session
    const body = await request.json()
    const metodeCheckin: 'SCAN_BARCODE' | 'MANUAL' = body.metodeCheckin === 'SCAN_BARCODE' ? 'SCAN_BARCODE' : 'MANUAL'

    // ===== Resolusi toko: via scan barcode (utama) atau pilihan manual =====
    let toko: MasterToko | null = null
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

    // Tanggal check-in boleh diisi manual (backdate) — default: saat ini.
    let tglKunjungan: Date | undefined
    if (body.tglKunjungan) {
      const d = new Date(String(body.tglKunjungan))
      if (Number.isNaN(d.getTime())) {
        return NextResponse.json({ error: 'Tanggal check-in tidak valid' }, { status: 400 })
      }
      if (d.getTime() > Date.now() + 24 * 3600 * 1000) {
        return NextResponse.json({ error: 'Tanggal check-in tidak boleh melebihi besok' }, { status: 400 })
      }
      tglKunjungan = d
    }

    const [kunjungan] = await Promise.all([
      db.kunjungan.create({
        data: {
          tokoId: toko.id,
          teknisiId: Number(body.teknisiId),
          metodeCheckin,
          barcodeTerscan,
          tglKunjungan,
          fotoOnsite: body.fotoOnsite || null,
          catatanStokRusak: body.catatanStokRusak ?? null,
        },
      }),
      // Update tgl visit terakhir toko (siklus kunjungan reset) — ikut tanggal check-in
      db.masterToko.update({
        where: { id: toko.id },
        data: { tglVisitTerakhir: tglKunjungan ?? new Date() },
      }),
    ])

    await logAudit({
      aksi: 'CREATE_KUNJUNGAN',
      entitas: 'kunjungan',
      entitasId: String(kunjungan.id),
      deskripsi: `Teknisi ${teknisi.nama} check-in ${metodeCheckin === 'SCAN_BARCODE' ? 'via scan barcode' : 'manual'} di ${toko.namaToko} (${toko.kodeToko})${barcodeTerscan ? ` · barcode: ${barcodeTerscan}` : ''}${tglKunjungan ? ` · tgl ${tglKunjungan.toLocaleString('id-ID')}` : ''}`,
      aktor: teknisi.nama,
    })

    await autoGitBackup('CREATE', 'kunjungan', `${toko.kodeToko}`, teknisi.nama)
    return NextResponse.json({ ...kunjungan, toko, teknisi }, { status: 201 })
  } catch (error) {
    console.error('Kunjungan POST error:', error)
    return NextResponse.json({ error: 'Gagal mencatat kunjungan' }, { status: 500 })
  }
}
