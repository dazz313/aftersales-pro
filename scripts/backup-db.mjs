/**
 * Backup database SQLite (live-safe) → db/backups/custom-YYYYMMDD-HHmm.db
 * ---------------------------------------------------------------------------
 * Pakai VACUUM INTO: menghasilkan snapshot konsisten WALAU aplikasi sedang
 * berjalan / menulis (online backup SQLite) — file hasil tidak perlu dikunci.
 * Rotasi: sisakan 42 file terakhir (≈7 hari pada interval 4 jam).
 *
 * Pemakaian:
 *   node scripts/backup-db.mjs          (manual / via Task Scheduler / via build)
 * Restore (bila perlu):
 *   1. Stop server, 2. salin file backup → db/custom.db, 3. start server lagi.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PrismaClient } from '@prisma/client'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BACKUP_DIR = path.join(ROOT, 'db', 'backups')
const KEEP = 42

// DATABASE_URL dari env ATAU parse .env (Task Scheduler tidak memuat .env)
if (!process.env.DATABASE_URL) {
  const envFile = path.join(ROOT, '.env')
  if (fs.existsSync(envFile)) {
    const m = fs.readFileSync(envFile, 'utf8').match(/^DATABASE_URL=(.+)$/m)
    if (m) process.env.DATABASE_URL = m[1].trim()
  }
}
if (!process.env.DATABASE_URL) process.env.DATABASE_URL = 'file:./db/custom.db'

// Samakan ke path absolut agar tidak ambigu di mana Prisma me-resolve relatif
let dbPath = process.env.DATABASE_URL.replace(/^file:/, '')
if (!path.isAbsolute(dbPath)) dbPath = path.join(ROOT, dbPath)
process.env.DATABASE_URL = `file:${dbPath.replace(/\\/g, '/')}`

if (!fs.existsSync(dbPath)) {
  console.error(`✗ Database tidak ditemukan: ${dbPath}`)
  process.exit(1)
}

fs.mkdirSync(BACKUP_DIR, { recursive: true })
const d = new Date()
const p2 = (n) => String(n).padStart(2, '0')
const stamp = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`
const dest = path.join(BACKUP_DIR, `custom-${stamp}.db`)
// Bila file dengan stamp sama sudah ada (backup rapat/jam dipercepat), hapus
// dulu — VACUUM INTO menolak menulis ke file yang sudah ada.
if (fs.existsSync(dest)) fs.unlinkSync(dest)

const db = new PrismaClient()
try {
  await db.$executeRawUnsafe(`VACUUM INTO '${dest.replace(/\\/g, '/')}'`)
  const size = fs.statSync(dest).size
  console.log(`✓ Backup OK → ${path.relative(ROOT, dest)} (${(size / 1024).toFixed(0)} KB)`)
} catch (e) {
  console.error(`✗ Backup GAGAL: ${e.message}`)
  process.exit(1)
} finally {
  await db.$disconnect()
}

// Rotasi: sisakan KEEP file terbaru (nama ber-sort kronologis)
const files = fs
  .readdirSync(BACKUP_DIR)
  .filter((f) => /^custom-\d{4}-\d{2}-\d{2}-\d{4,6}\.db$/.test(f))
  .sort()
for (const f of files.slice(0, Math.max(files.length - KEEP, 0))) {
  fs.unlinkSync(path.join(BACKUP_DIR, f))
  console.log(`  rotasi: hapus ${f}`)
}
console.log(`Total backup tersimpan: ${Math.min(files.length, KEEP)}/${KEEP}`)
