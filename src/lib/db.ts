import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    // Log SQL (prisma:query) HANYA di development — di produksi log ini jadi
    // 99% isi file log PM2 (±3 MB/hari) tanpa manfaat. Level warn/error tetap
    // aktif supaya masalah Prisma kelihatan. Retensi file log: 7 hari
    // (src/lib/log-retention.ts).
    log: process.env.NODE_ENV === 'production' ? ['warn', 'error'] : ['query', 'warn', 'error'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db

/**
 * SQLite mode WAL — penting untuk mode LAN (banyak komputer klien pollen
 * lonceng notifikasi + beberapa orang menulis registrasi bersamaan):
 *  • pembaca tidak lagi memblokir penulis (dan sebaliknya),
 *  • readers/writers konkuren tanpa error "database is locked".
 * Di-ensure sekali saat boot; diabaikan bila gagal (mis. DB sedang terkunci
 * sesaat oleh proses lain) — aplikasi tetap jalan seperti sebelumnya.
 */
void db.$queryRawUnsafe('PRAGMA journal_mode = WAL').catch((e: unknown) => {
  console.warn('Gagal mengaktifkan SQLite WAL:', e instanceof Error ? e.message : e)
})