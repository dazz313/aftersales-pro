// Cek validitas file backup: query count dari DB backup (read-only).
import fs from 'node:fs'
import path from 'node:path'
import { PrismaClient } from '@prisma/client'

const backupPath = process.argv[2]
if (!backupPath || !fs.existsSync(backupPath)) {
  console.error('pakai: node scripts/check-backup.mjs <file.db>')
  process.exit(1)
}
// Arahkan Prisma ke file backup — hanya baca via count (tidak menulis).
process.env.DATABASE_URL = 'file:' + backupPath.replace(/\\/g, '/')
const db = new PrismaClient()
const [pengguna, toko, tiket, kunjungan, sparepart] = await Promise.all([
  db.pengguna.count(),
  db.masterToko.count(),
  db.serviceRequest.count(),
  db.kunjungan.count(),
  db.masterSparepart.count(),
])
await db.$disconnect()
console.log(`✓ Backup valid: ${path.basename(backupPath)}`)
console.log(`  pengguna=${pengguna} toko=${toko} tiket=${tiket} kunjungan=${kunjungan} sparepart=${sparepart}`)
