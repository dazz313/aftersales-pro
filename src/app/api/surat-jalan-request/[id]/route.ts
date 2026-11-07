import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { requireActiveSession } from '@/lib/auth-server'
import { buatPdf, buatXlsx, type ItemBaris } from '@/lib/surat-jalan-dokumen'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * GET /api/surat-jalan-request/[id]?format=pdf|xlsx|json — CETAK ULANG.
 * Regenerate dokumen SJR dari SNAPSHOT yang tersimpan saat pertama dicetak
 * (tabel surat_jalan_request + item-nya). Karakteristik:
 *  - Nomor dokumen SAMA dengan cetakan asli (SJR-YYYYMMDD-NNNN) → tidak ada
 *    persuratan nomor ganda; semua salinan satu bundel punya nomor sama.
 *  - TIDAK membuat record baru, TIDAK mengubah tglRequestPart tiket.
 *  - Isi dokumen persis seperti saat pertama dicetak (aman: harga/qty sudah
 *    di-snapshot di tabel item, tidak mengikuti perubahan master setelahnya).
 * Sekarang dan seterusnya user cukup buka "Riwayat Persuratan" di Proses
 * Service, cari bundelnya (per toko/per tiket), klik cetak ulang.
 */

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { session, denied } = await requireActiveSession(request)
    if (denied) return denied
    const aktor = session?.nama ?? 'SYSTEM'

    const { id: rawId } = await params
    const id = Number(rawId)
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: 'ID surat jalan request tidak valid' }, { status: 400 })
    }

    const sjr = await db.suratJalanRequest.findUnique({
      where: { id },
      include: { items: { orderBy: { id: 'asc' } } },
    })
    if (!sjr) {
      return NextResponse.json({ error: 'Dokumen surat jalan tidak ditemukan' }, { status: 404 })
    }

    const items: ItemBaris[] = sjr.items.map((i) => ({
      serviceRequestId: i.serviceRequestId,
      noTiket: i.noTiket,
      kodePart: i.kodePart,
      namaPart: i.namaPart ?? '',
      qty: i.qty,
      toko: i.toko ?? '-',
      serialNumber: i.serialNumber ?? '-',
      modelUnit: i.modelUnit ?? '-',
    }))
    const totalQty = sjr.totalQty || items.reduce((a, i) => a + i.qty, 0)

    const { searchParams } = new URL(request.url)
    const format = searchParams.get('format') ?? 'json'

    if (format === 'json') {
      return NextResponse.json({
        id: sjr.id,
        noSurat: sjr.noSurat,
        tglRequest: sjr.tglRequest,
        dibuatOleh: sjr.dibuatOleh,
        produsenTujuan: sjr.produsenTujuan,
        totalTiket: sjr.totalTiket,
        totalItem: sjr.totalItem,
        totalQty: sjr.totalQty,
        lewatTanpaKode: sjr.lewatTanpaKode,
        items,
      })
    }

    if (format !== 'pdf' && format !== 'xlsx') {
      return NextResponse.json({ error: 'Format harus pdf, xlsx, atau json' }, { status: 400 })
    }

    const settings = await db.pengaturan.findMany()
    const s: Record<string, string> = {}
    for (const row of settings) s[row.kunci] = row.nilai
    const infoToko = {
      nama: s['nama_perusahaan'] ?? 'Workshop',
      alamat: s['alamat_perusahaan'] ?? '-',
      email: (s['email_perusahaan'] ?? '').trim(),
    }
    const admin = await db.pengguna.findFirst({
      where: { role: 'ADMIN_WORKSHOP', aktif: true },
      orderBy: { id: 'asc' },
      select: { nama: true },
    })
    const adminWorkshop = admin?.nama ?? 'Admin Workshop'

    // Catat aktivitas cetak-ulang di audit — jejak siapa memakai salinan ini.
    await logAudit({
      aksi: 'CETAK_SJ_ULANG',
      entitas: 'surat_jalan_request',
      entitasId: sjr.noSurat,
      deskripsi: `Cetak ulang surat jalan request ${sjr.noSurat} (${format.toUpperCase()}) — nomor sama, isi sesuai snapshot asli`,
      aktor,
    })

    if (format === 'pdf') {
      const pdf = await buatPdf({
        noSurat: sjr.noSurat,
        tglRequest: sjr.tglRequest,
        items,
        totalQty,
        infoToko,
        produsenTujuan: sjr.produsenTujuan ?? '',
        dibuatOleh: aktor,
        adminWorkshop,
      })
      return new NextResponse(pdf, {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="Surat-Jalan-Request-${sjr.noSurat}.pdf"`,
        },
      })
    }

    const xlsx = buatXlsx({
      noSurat: sjr.noSurat,
      tglRequest: sjr.tglRequest,
      items,
      totalQty,
      lewatTanpaKode: sjr.lewatTanpaKode,
      produsenTujuan: sjr.produsenTujuan ?? '',
    })
    return new NextResponse(xlsx, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="Surat-Jalan-Request-${sjr.noSurat}.xlsx"`,
      },
    })
  } catch (error) {
    console.error('Surat jalan cetak ulang error:', error)
    return NextResponse.json({ error: 'Gagal mencetak ulang surat jalan' }, { status: 500 })
  }
}
