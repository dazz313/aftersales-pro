import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: ReturnType<typeof buatKlien> | undefined
}

/**
 * Tulis-ke-spreadsheet: operasi Prisma yang mengubah data (bukan baca).
 * Nama = nilai `operation` pada query extension ($allOperations).
 */
const AKSI_TULIS_PRISMA = new Set([
  'create', 'createMany', 'createManyAndReturn',
  'update', 'updateMany', 'upsert',
  'delete', 'deleteMany',
])

/**
 * Sinkron cepat Google Spreadsheet (media komunikasi data dgn produsen).
 * Setiap tulis yang BERHASIL ke tiket service / part tiket / unit asset
 * memicu `mintaSinkronServiceUnit()` (gsheets.ts) — dikoalesasi di sana
 * (maks 1x push per menit, sisanya digabung). Dibuat sbg Prisma query
 * extension ($extends — $use middleware sudah dihapus di Prisma 6) agar
 * SEMUA route (service, unit, surat jalan terapkan, klaim, dll.) otomatis
 * tercakup tanpa disunting satu per satu.
 * Dynamic import memutus ketergantungan sirkular db → gsheets → db.
 */
function picuSinkronSheet(): void {
  import('@/lib/gsheets')
    .then((m) => m.mintaSinkronServiceUnit())
    .catch(() => {
      // Sinkron gagal dimuat — backup berkala tetap jaring pengaman.
    })
}

function buatKlien() {
  const dasar = new PrismaClient({
    // Log SQL (prisma:query) HANYA di development — di produksi log ini jadi
    // 99% isi file log PM2 (±3 MB/hari) tanpa manfaat. Level warn/error tetap
    // aktif supaya masalah Prisma kelihatan. Retensi file log: 7 hari
    // (src/lib/log-retention.ts).
    log: process.env.NODE_ENV === 'production' ? ['warn', 'error'] : ['query', 'warn', 'error'],
  })
  return dasar.$extends({
    query: {
      // Kunci = nama model camelCase. Trigger HANYA utk operasi tulis yang
      // berhasil (query(args) sudah selesai tanpa throw).
      serviceRequest: {
        async $allOperations({ operation, args: _args, query }) {
          const hasil = await query(_args)
          if (AKSI_TULIS_PRISMA.has(operation)) picuSinkronSheet()
          return hasil
        },
      },
      serviceRequestPart: {
        async $allOperations({ operation, args: _args, query }) {
          const hasil = await query(_args)
          if (AKSI_TULIS_PRISMA.has(operation)) picuSinkronSheet()
          return hasil
        },
      },
      unitAsset: {
        async $allOperations({ operation, args: _args, query }) {
          const hasil = await query(_args)
          if (AKSI_TULIS_PRISMA.has(operation)) picuSinkronSheet()
          return hasil
        },
      },
    },
  })
}

export const db =
  globalForPrisma.prisma ??
  buatKlien()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db

/**
 * SQLite mode WAL — penting untuk mode LAN (banyak komputer klien pollen
 * lonceng notifikasi + beberapa orang menulis registrasi bersamaan):
 *  • pembaca tidak lagi memblokir penulis (dan sebaliknya),
 *  • readers/writers konkuren tanpa error "database is locked".
 * Di-ensure sekali saat boot; diabaikan bila gagal (mis. DB sedang terkunci
 * sesaat oleh proses lain) — aplikasi tetap jalan seperti sebelumnya.
 */
const faseBuild = process.env.NEXT_PHASE === 'phase-production-build'
if (!faseBuild) {
  void db.$queryRawUnsafe('PRAGMA journal_mode = WAL').catch((e: unknown) => {
    console.warn('Gagal mengaktifkan SQLite WAL:', e instanceof Error ? e.message : JSON.stringify(e))
  })
  // synchronous=NORMAL: aman dengan WAL (tahan crash proses, hanya kehilangan
  // transaksi terakhir pada mati listrik tiba-tiba). Jauh lebih cepat daripada
  // FULL (default) di disk lambat (HDD) — menghindari fsync tiap transaksi.
  void db.$executeRawUnsafe('PRAGMA synchronous = NORMAL').catch((e: unknown) => {
    console.warn('Gagal set synchronous:', e instanceof Error ? e.message : JSON.stringify(e))
  })
  // Tunggu hingga 5 detik bila DB sedang terkunci oleh proses lain (mis.
  // backup/scheduler) alih-alih langsung error "database is locked".
  void db.$executeRawUnsafe('PRAGMA busy_timeout = 5000').catch((e: unknown) => {
    console.warn('Gagal set busy_timeout:', e instanceof Error ? e.message : JSON.stringify(e))
  })
  // Cache & temp di RAM — kurangi I/O disk untuk query/sort sementara.
  void db.$executeRawUnsafe('PRAGMA cache_size = -8000').catch(() => {}) // ~8 MB
  void db.$executeRawUnsafe('PRAGMA temp_store = MEMORY').catch(() => {})
}
