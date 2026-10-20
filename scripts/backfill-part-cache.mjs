/**
 * Backfill cache kode/nama part (sekali jalan).
 * ------------------------------------------------
 * Kolom baru ServiceRequestPart.kodePartCache/namaPartCache — snapshot kode &
 * nama pada momen kunci (sahkan pemasangan, FINISH, koreksi part) supaya
 * statistik pemasangan tetap stabil walau master sparepart diubah/dihapus.
 *
 * Backfill ini mengisi cache semua baris part dgn nilai master saat ini
 * (idempotent — baris yang sudah punya cache tidak disentuh).
 *
 * Pemakaian: node scripts/backfill-part-cache.mjs
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
  const baris = await db.serviceRequestPart.findMany({
    include: { sparepart: { select: { kodePart: true, namaPart: true } } },
    orderBy: { id: 'asc' },
  })
  let terisi = 0
  for (const p of baris) {
    if (p.kodePartCache !== null || p.namaPartCache !== null) continue
    const kode = p.sparepart?.kodePart?.trim() || null
    const nama = p.sparepart?.namaPart?.trim() || null
    if (!kode && !nama) continue
    await db.serviceRequestPart.update({
      where: { id: p.id },
      data: { kodePartCache: kode, namaPartCache: nama },
    })
    terisi++
  }
  console.log(`✓ Selesai: ${terisi}/${baris.length} baris part diberi cache kode/nama.`)
} catch (e) {
  console.error('✗ Backfill cache part gagal:', e.message ?? e)
  process.exit(1)
} finally {
  await db.$disconnect()
}
