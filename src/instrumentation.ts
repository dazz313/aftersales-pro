/**
 * Dijalankan sekali saat server Next.js boot (runtime nodejs).
 * - Wajibkan AUTH_SECRET di production (gagal boot bila absen, kecuali
 *   mode desktop Electron yang single-user lokal).
 * - Memulai scheduler backup harian — lihat src/lib/backup-scheduler.ts.
 * - Memulai job retensi log 7 hari — lihat src/lib/log-retention.ts.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const isProd = process.env.NODE_ENV === 'production'
    const isDesktop = process.env.ELECTRON_RUN_AS_NODE === '1'
    if (isProd && !isDesktop && !process.env.AUTH_SECRET) {
      throw new Error(
        '[FATAL] AUTH_SECRET belum diisi. Set environment AUTH_SECRET ke string acak panjang ' +
          'sebelum menjalankan mode produksi (lihat .env.example).'
      )
    }
    const { startBackupScheduler } = await import('@/lib/backup-scheduler')
    startBackupScheduler()
    const { startLogRetention } = await import('@/lib/log-retention')
    startLogRetention()
  }
}
