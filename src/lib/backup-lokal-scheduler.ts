import { db } from '@/lib/db'
import { backupLokal } from '@/lib/backup-lokal'

/**
 * Scheduler backup berkala ke penyimpanan server (db/backups/).
 * Berjalan di dalam proses server, tiap interval jam (default 4 jam).
 * Dijalankan sekali saat boot via src/instrumentation.ts.
 */
const g = globalThis as unknown as { __asproBackupLokalScheduler?: boolean }

async function tick() {
  try {
    const rows = await db.pengaturan.findMany({ where: { kunci: 'backup_lokal_interval_jam' } })
    const intervalJam = Number(rows[0]?.nilai) > 0 ? Number(rows[0].nilai) : 4
    const res = await backupLokal()
    console.log(`[backup-lokal] ${res.message}`)
  } catch (e) {
    console.error('[backup-lokal] Gagal:', (e as Error).message)
  }
}

export function startBackupLokalScheduler() {
  if (g.__asproBackupLokalScheduler) return
  g.__asproBackupLokalScheduler = true
  // tunda tick pertama 2 menit agar boot tidak terbebani
  setTimeout(() => {
    void tick()
    // interval default 4 jam; dibaca ulang tiap tick dari setting
    setInterval(() => void tick(), 4 * 60 * 60 * 1000).unref?.()
  }, 2 * 60 * 1000).unref?.()
  console.log('[backup-lokal] Aktif — backup berkala ke db/backups (default tiap 4 jam)')
}
