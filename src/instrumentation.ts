/**
 * Dijalankan sekali saat server Next.js boot (runtime nodejs).
 * Memulai scheduler backup harian — lihat src/lib/backup-scheduler.ts.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startBackupScheduler } = await import('@/lib/backup-scheduler')
    startBackupScheduler()
  }
}
