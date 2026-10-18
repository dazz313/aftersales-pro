import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { autoGitBackup } from '@/lib/git-backup'
import { requireActiveSession } from '@/lib/auth-server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// GET /api/surat-jalan/[id] — detail draft (header + item + tiket rujukan)
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireActiveSession(_request)
    const { id } = await ctx.params
    const sj = await db.suratJalanMasuk.findUnique({ where: { id: Number(id) }, include: { items: { orderBy: { id: 'asc' } } } })
    if (!sj) return NextResponse.json({ error: 'Draft surat jalan tidak ditemukan' }, { status: 404 })
    const tiketIds = [...new Set(sj.items.filter((i) => i.cocokTiketId != null).map((i) => i.cocokTiketId as number))]
    const ts = tiketIds.length
      ? await db.serviceRequest.findMany({
          where: { id: { in: tiketIds } },
          select: { id: true, noTiket: true, status: true, unitAsset: { select: { serialNumber: true, modelUnit: true } } },
        })
      : []
    const tiketMap = new Map(ts.map((t) => [t.id, t]))
    // Daftar kandidat tetap disertakan agar UI bisa memilih/mengganti tiket di fase cek.
    const { ambilKandidat } = await import('@/lib/surat-jalan')
    const kandidat = await ambilKandidat()
    return NextResponse.json({
      id: sj.id,
      noSuratJalan: sj.noSuratJalan,
      tglSurat: sj.tglSurat,
      produsen: sj.produsen,
      namaFile: sj.namaFile,
      totalItem: sj.items.length,
      cocokCount: sj.items.filter((i) => i.statusMatch === 'COCOK').length,
      tanpaTiket: sj.items.filter((i) => i.statusMatch !== 'COCOK').length,
      createdAt: sj.createdAt,
      createdBy: sj.createdBy,
      status: sj.status,
      cekManual: sj.cekManual,
      diperiksaAt: sj.diperiksaAt,
      diperiksaOleh: sj.diperiksaOleh,
      diterapkanAt: sj.diterapkanAt,
      diterapkanOleh: sj.diterapkanOleh,
      items: sj.items.map((i) => ({
        id: i.id,
        kodePart: i.kodePart,
        namaPart: i.namaPart,
        qty: i.qty,
        serialNumber: i.serialNumber,
        statusMatch: i.statusMatch,
        cocokTipe: i.cocokTipe,
        tiket:
          i.cocokTiketId != null
            ? {
                id: i.cocokTiketId,
                noTiket: tiketMap.get(i.cocokTiketId)?.noTiket ?? '-',
                status: tiketMap.get(i.cocokTiketId)?.status ?? '-',
                serial: tiketMap.get(i.cocokTiketId)?.unitAsset.serialNumber ?? '',
                model: tiketMap.get(i.cocokTiketId)?.unitAsset.modelUnit ?? '-',
              }
            : null,
        alasan: i.alasan,
      })),
      kandidat: kandidat.map((c) => ({
        key: c.key,
        serviceRequestId: c.serviceRequestId,
        noTiket: c.noTiket,
        statusTiket: c.statusTiket,
        serial: c.serial,
        model: c.model,
        kodePart: c.kodePart,
        namaPart: c.namaPart,
        qty: c.qty,
        sudahReady: c.sudahReady,
      })),
    })
  } catch (error) {
    console.error('Surat jalan detail error:', error)
    return NextResponse.json({ error: 'Gagal memuat detail surat jalan' }, { status: 500 })
  }
}

// DELETE /api/surat-jalan/[id] — hapus draft (DITERAPKAN tidak boleh dihapus)
export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { session, denied } = await requireActiveSession(request)
    if (denied) return denied
    const { id } = await ctx.params
    const sjId = Number(id)
    const sj = await db.suratJalanMasuk.findUnique({ where: { id: sjId }, select: { noSuratJalan: true, status: true } })
    if (!sj) return NextResponse.json({ error: 'Draft tidak ditemukan' }, { status: 404 })
    if (sj.status === 'DITERAPKAN') return NextResponse.json({ error: 'Surat jalan sudah diterapkan — tidak dapat dihapus' }, { status: 409 })
    await db.suratJalanMasukItem.deleteMany({ where: { suratJalanMasukId: sjId } })
    await db.suratJalanMasuk.delete({ where: { id: sjId } })
    await logAudit({ aksi: 'HAPUS', entitas: 'surat_jalan_masuk', entitasId: sj.noSuratJalan, deskripsi: `Draft surat jalan dihapus (status ${sj.status})`, aktor: session?.nama ?? 'SYSTEM' })
    await autoGitBackup('DELETE', 'surat_jalan_masuk_draft', sj.noSuratJalan, session?.nama ?? 'SYSTEM')
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Surat jalan DELETE error:', error)
    return NextResponse.json({ error: 'Gagal menghapus draft surat jalan' }, { status: 500 })
  }
}
