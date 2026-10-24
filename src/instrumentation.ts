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
    // Webhook WA/Telegram bersifat publik (mudah dijangkau lewat Cloudflare),
    // jadi tanpa WEBHOOK_SECRET siapa pun bisa memicu proses inbound.
    // Sengaja hanya PERINGATAN (bukan gagal boot) agar tidak mematahkan
    // deployment lama — segera isi WEBHOOK_SECRET di produksi.
    if (isProd && !isDesktop && !process.env.WEBHOOK_SECRET) {
      console.warn(
        '[PERINGATAN] WEBHOOK_SECRET belum diisi. Endpoint webhook (/api/wa/webhook, ' +
          '/api/telegram/webhook) dapat dipanggil siapa saja. Disarankan mengisi ' +
          'WEBHOOK_SECRET dan/atau melindunginya dengan Cloudflare Access (Zero Trust).'
      )
    }
    const { startBackupScheduler } = await import('@/lib/backup-scheduler')
    startBackupScheduler()
    const { startLogRetention } = await import('@/lib/log-retention')
    startLogRetention()
    const { startAlertScheduler } = await import('@/lib/alert-scheduler')
    startAlertScheduler()
  }
}
