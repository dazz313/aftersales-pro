/**
 * Backfill STTB untuk tiket lama (sekali jalan).
 * ------------------------------------------------
 * Aturan baru: STTB terbit SEJAK REQUEST PART. Tiket yang sudah terlanjur
 * punya part (REQUEST/PROSES) tapi belum ber-STTB diterbitkan di sini agar
 * konsisten dan bisa ikut STTB kolektif per toko.
 * Tiket FINISH tanpa STTB TIDAK disentuh (riwayat terkunci).
 *
 * Pemakaian: node scripts/backfill-sttb.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PrismaClient } from '@prisma/client'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

if (!process.env.DATABASE_URL) {
  const envFile = path.join(ROOT, '.env')
  if (fs.existsSync(envFile)) {
    const m = fs.readFileSync(envFile, 'utf8').match(/^DATABASE_URL=(.+)$/m)
    if (m) process.env.DATABASE_URL = m[1].trim()
  }
}
if (!process.env.DATABASE_URL) process.env.DATABASE_URL = 'file:./db/custom.db'

let dbPath = process.env.DATABASE_URL.replace(/^file:/, '')
if (!path.isAbsolute(dbPath)) dbPath = path.join(ROOT, dbPath)
process.env.DATABASE_URL = `file:${dbPath.replace(/\\/g, '/')}`

const db = new PrismaClient()
try {
  const kandidat = await db.serviceRequest.findMany({
    where: {
      noSttb: null,
      status: { in: ['REQUEST', 'PROSES'] },
      parts: { some: {} },
    },
    select: { id: true, noTiket: true, status: true },
  })
  if (kandidat.length === 0) {
    console.log('✓ Tidak ada tiket yang perlu backfill STTB.')
  } else {
    for (const t of kandidat) {
      const noSttb = t.noTiket.replace(/^SV-/, 'STTB-')
      await db.serviceRequest.update({ where: { id: t.id }, data: { noSttb } })
      await db.auditLog.create({
        data: {
          aksi: 'STTB_BACKFILL',
          entitas: 'service_request',
          entitasId: t.noTiket,
          deskripsi: `Backfill: STTB ${noSttb} diterbitkan untuk tiket ${t.status} yang sudah punya part (aturan STTB sejak request part)`,
          aktor: 'SYSTEM',
        },
      })
      console.log(`✓ ${t.noTiket} (${t.status}) → ${noSttb}`)
    }
    console.log(`✓ Selesai: ${kandidat.length} tiket diberi STTB.`)
  }
} catch (e) {
  console.error('✗ Backfill STTB gagal:', e.message ?? e)
  process.exit(1)
} finally {
  await db.$disconnect()
}
