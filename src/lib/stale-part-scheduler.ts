import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { autoGitBackup } from '@/lib/git-backup'

/**
 * Job: tiket REQUEST yang tidak ada aktivitas > 6 hari otomatis dianggap
 * part-nya TIDAK_READY (produsen dianggap tidak bisa menyediakan / tidak
 * merespons), sehingga unit bisa didaftarkan "tetap di toko" (tunggu part).
 * Berjalan periodik di dalam proses server (lihat instrumentation.ts).
 */
const BATAS_HARI = 6
const g = globalThis as unknown as { __asproStalePartScheduler?: boolean }

async function tick() {
  try {
    const batas = new Date(Date.now() - BATAS_HARI * 24 * 60 * 60 * 1000)
    const tiket = await db.serviceRequest.findMany({
      where: {
        status: 'REQUEST',
        penanganan: 'BELUM',
        createdAt: { lt: batas },
        parts: { some: { statusKonfirmasi: { in: ['MENUNGGU', 'READY'] } } },
      },
      include: { parts: true },
    })
    if (tiket.length === 0) return
    let totalPart = 0
    for (const t of tiket) {
      const target = t.parts.filter((p) => p.statusKonfirmasi === 'MENUNGGU' || p.statusKonfirmasi === 'READY')
      if (target.length === 0) continue
      await db.serviceRequestPart.updateMany({
        where: { id: { in: target.map((p) => p.id) } },
        data: { statusKonfirmasi: 'TIDAK_READY' },
      })
      totalPart += target.length
      await logAudit({
        aksi: 'AUTO_TIDAK_READY_STALE',
        entitas: 'service_request',
        entitasId: t.noTiket,
        deskripsi: `Tiket tidak ada aktivitas > ${BATAS_HARI} hari — ${target.length} part otomatis ditandai TIDAK_READY`,
        aktor: 'SYSTEM-STALE',
      })
    }
    if (totalPart > 0) {
      console.log(`[stale-part] ${tiket.length} tiket stale → ${totalPart} part ditandai TIDAK_READY`)
      await autoGitBackup('AUTO_TIDAK_READY_STALE', 'service_request', `${tiket.length} tiket`, 'SYSTEM-STALE')
    }
  } catch (e) {
    console.error('[stale-part] Gagal:', (e as Error).message)
  }
}

export function startStalePartScheduler() {
  if (g.__asproStalePartScheduler) return
  g.__asproStalePartScheduler = true
  // Tunda tick pertama 2 menit agar boot tidak terbebani
  setTimeout(() => {
    void tick()
    setInterval(() => void tick(), 30 * 60_000).unref?.()
  }, 2 * 60_000).unref?.()
  console.log('[stale-part] Aktif — cek tiket stale tiap 30 menit')
}