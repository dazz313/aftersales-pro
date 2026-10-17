import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { autoGitBackup } from '@/lib/git-backup'
import { requireActiveSession, requireManagerSession } from '@/lib/auth-server'

const MAKS_HAPUS = 500

// POST /api/unit/bulk-delete - hapus massal unit registrasi (koreksi kesalahan input)
// body: { ids: number[], aktor?: string }
// Unit yang sudah punya tiket service TIDAK ikut terhapus (riwayat & klaim harus
// utuh) — dilaporkan sebagai dilewati, tidak menggagalkan seluruh batch.
export async function POST(request: Request) {
  try {
    const { session, denied } = await requireActiveSession(request)
    if (denied) return denied
    // Hapus massal = aksi berbahaya, sama seperti toko/bulk-delete: khusus Admin Workshop/Manager
    const roleDenied = requireManagerSession(session)
    if (roleDenied) return roleDenied
    const body = (await request.json()) as { ids?: unknown; aktor?: string }
    const mentah = Array.isArray(body.ids) ? body.ids : []
    const ids = [...new Set(mentah.map((v) => Number(v)).filter((n) => Number.isFinite(n) && n > 0))]
    const aktor: string = body.aktor || 'SYSTEM'

    if (!ids.length) {
      return NextResponse.json({ error: 'Tidak ada unit yang dipilih' }, { status: 400 })
    }
    if (ids.length > MAKS_HAPUS) {
      return NextResponse.json({ error: `Maksimal ${MAKS_HAPUS} unit per penghapusan massal` }, { status: 400 })
    }

    const daftar = await db.unitAsset.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        serialNumber: true,
        modelUnit: true,
        serviceRequests: { select: { noTiket: true } },
      },
    })
    const ada = new Set(daftar.map((u) => u.id))

    const terhapus: string[] = []
    const dilewati: { id: number; serialNumber: string; modelUnit: string; alasan: string }[] = []

    for (const pil of ids) {
      if (!ada.has(pil)) {
        dilewati.push({ id: pil, serialNumber: '-', modelUnit: '-', alasan: 'tidak ditemukan' })
      }
    }
    for (const u of daftar) {
      if (u.serviceRequests.length > 0) {
        const noList = u.serviceRequests.map((t) => t.noTiket).join(', ')
        dilewati.push({
          id: u.id,
          serialNumber: u.serialNumber,
          modelUnit: u.modelUnit,
          alasan: `sudah punya tiket ${noList}`,
        })
        continue
      }
      await db.unitAsset.delete({ where: { id: u.id } })
      terhapus.push(u.serialNumber)
    }

    if (terhapus.length > 0) {
      await logAudit({
        aksi: 'BULK_DELETE_UNIT_ASSET',
        entitas: 'unit_asset',
        deskripsi: `Hapus massal unit: ${terhapus.length} terhapus (${terhapus.slice(0, 10).join(', ')}${terhapus.length > 10 ? '…' : ''}), ${dilewati.length} dilewati`,
        aktor,
      })
      await autoGitBackup('BULK_DELETE', 'unit_asset', `${terhapus.length}`, aktor)
    }

    return NextResponse.json({
      deleted: terhapus.length,
      deletedSerials: terhapus,
      skipped: dilewati,
      skippedCount: dilewati.length,
    })
  } catch (error) {
    console.error('Unit bulk-delete error:', error)
    return NextResponse.json({ error: 'Gagal menghapus massal unit' }, { status: 500 })
  }
}
