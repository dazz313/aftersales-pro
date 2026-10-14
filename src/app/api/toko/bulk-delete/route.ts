import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { autoGitBackup } from '@/lib/git-backup'
import { requireActiveSession, requireManagerSession } from '@/lib/auth-server'

const MAKS_HAPUS = 500

// POST /api/toko/bulk-delete - hapus massal toko (hanya Admin/Manager)
// body: { ids: number[], aktor?: string }
// Toko yang masih punya unit/kunjungan/order TIDAK ikut terhapus —
// dilaporkan sebagai dilewati agar data relasi tidak rusak.
export async function POST(request: Request) {
  try {
    const { session, denied } = await requireActiveSession(request)
    if (denied) return denied
    const roleDenied = requireManagerSession(session)
    if (roleDenied) return roleDenied
    const body = (await request.json()) as { ids?: unknown; aktor?: string }
    const mentah = Array.isArray(body.ids) ? body.ids : []
    const ids = [...new Set(mentah.map((v) => Number(v)).filter((n) => Number.isFinite(n) && n > 0))]
    const aktor: string = body.aktor || 'SYSTEM'

    if (!ids.length) {
      return NextResponse.json({ error: 'Tidak ada toko yang dipilih' }, { status: 400 })
    }
    if (ids.length > MAKS_HAPUS) {
      return NextResponse.json({ error: `Maksimal ${MAKS_HAPUS} toko per penghapusan massal` }, { status: 400 })
    }

    const daftar = await db.masterToko.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        kodeToko: true,
        namaToko: true,
        unitAssets: { select: { id: true } },
        kunjungan: { select: { id: true } },
        orders: { select: { id: true } },
      },
    })
    const ada = new Set(daftar.map((t) => t.id))

    const terhapus: string[] = []
    const dilewati: { id: number; kodeToko: string; namaToko: string; alasan: string }[] = []

    for (const pil of ids) {
      if (!ada.has(pil)) {
        dilewati.push({ id: pil, kodeToko: '-', namaToko: '-', alasan: 'tidak ditemukan' })
        continue
      }
    }
    for (const t of daftar) {
      const halangan = t.unitAssets.length > 0
        ? `masih ada ${t.unitAssets.length} unit terdaftar`
        : t.kunjungan.length > 0
          ? `masih ada ${t.kunjungan.length} riwayat kunjungan`
          : t.orders.length > 0
            ? `masih ada ${t.orders.length} order sparepart`
            : null
      if (halangan) {
        dilewati.push({ id: t.id, kodeToko: t.kodeToko, namaToko: t.namaToko, alasan: halangan })
        continue
      }
      await db.masterToko.delete({ where: { id: t.id } })
      terhapus.push(t.kodeToko)
    }

    if (terhapus.length > 0) {
      await logAudit({
        aksi: 'BULK_DELETE_MASTER_TOKO',
        entitas: 'master_toko',
        deskripsi: `Hapus massal toko: ${terhapus.length} terhapus (${terhapus.slice(0, 10).join(', ')}${terhapus.length > 10 ? '…' : ''}), ${dilewati.length} dilewati`,
        aktor,
      })
      await autoGitBackup('BULK_DELETE', 'master_toko', `${terhapus.length}`, aktor)
    }

    return NextResponse.json({
      deleted: terhapus.length,
      deletedCodes: terhapus,
      skipped: dilewati,
      skippedCount: dilewati.length,
    })
  } catch (error) {
    console.error('Toko bulk-delete error:', error)
    return NextResponse.json({ error: 'Gagal menghapus massal toko' }, { status: 500 })
  }
}
