import { db } from '@/lib/db'
import { runBackup } from '@/lib/gsheets'
import { autoGitBackup } from '@/lib/git-backup'

/**
 * Scheduler backup harian (berjalan di dalam proses server).
 * ------------------------------------------------------------
 * Dijalankan sekali saat server boot via src/instrumentation.ts.
 * Tiap 60 detik: bila `gs_jadwal_aktif=true` dan jam sekarang sudah
 * melewati `gs_jadwal_jam` (HH:MM) dan jadwal hari ini belum dijalankan
 * (`gs_jadwal_terakhir` ≠ tanggal hari ini) → runBackup('AUTO').
 *
 * Catatan: server harus hidup saat jam jadwal tiba (server desktop/
 * localhost umumnya standby 24 jam). Riwayat tercatat di BackupLog.
 */

const g = globalThis as unknown as { __asproBackupScheduler?: boolean }

function todayStr(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function nowHM(d = new Date()): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

async function tick() {
  try {
    const rows = await db.pengaturan.findMany({
      where: { kunci: { in: ['gs_jadwal_aktif', 'gs_jadwal_jam', 'gs_jadwal_terakhir'] } },
    })
    const map: Record<string, string> = {}
    for (const r of rows) map[r.kunci] = r.nilai
    if (map['gs_jadwal_aktif'] !== 'true') return
    const jam = /^([01]\d|2[0-3]):[0-5]\d$/.test(map['gs_jadwal_jam'] ?? '') ? map['gs_jadwal_jam'] : '02:00'
    if (nowHM() < jam) return
    if ((map['gs_jadwal_terakhir'] ?? '').slice(0, 10) === todayStr()) return

    console.log(`[backup-scheduler] Backup harian dimulai (jadwal ${jam})...`)
    const outcome = await runBackup('AUTO', 'SYSTEM-JADWAL')
    await db.pengaturan.upsert({
      where: { kunci: 'gs_jadwal_terakhir' },
      update: { nilai: `${todayStr()} ${nowHM()}` },
      create: { kunci: 'gs_jadwal_terakhir', nilai: `${todayStr()} ${nowHM()}` },
    })
    await autoGitBackup('BACKUP_JADWAL', 'backup_harian', outcome.status, 'SYSTEM-JADWAL')
    console.log(`[backup-scheduler] Selesai: ${outcome.status} — ${outcome.message}`)
  } catch (e) {
    console.error('[backup-scheduler] Gagal:', (e as Error).message)
  }
}

export function startBackupScheduler() {
  if (g.__asproBackupScheduler) return
  g.__asproBackupScheduler = true
  // Tunda tick pertama 60 detik agar boot server tidak terbebani
  setTimeout(() => {
    void tick()
    setInterval(() => void tick(), 60_000).unref?.()
  }, 60_000).unref?.()
  console.log('[backup-scheduler] Aktif — cek jadwal tiap 60 detik')
}
