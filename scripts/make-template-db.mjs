/**
 * Template database untuk versi desktop
 * -------------------------------------
 * Membuat db/template.db: schema penuh (prisma db push) + seed pengguna awal
 * (Admin & Teknisi contoh). File ini dibawa installer MSI; saat first run
 * Electron menyalinnya ke %APPDATA%/AfterSalesPro/data/aftersales.db.
 *
 * Pemakaian: node scripts/make-template-db.mjs
 */

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PrismaClient } from '@prisma/client'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const TEMPLATE = path.join(ROOT, 'db', 'template.db')

// 1. Push schema ke template.db
console.log('→ prisma db push ke template...')
if (fs.existsSync(TEMPLATE)) fs.unlinkSync(TEMPLATE)
const res = spawnSync(
  'npx',
  ['prisma', 'db', 'push', '--accept-data-loss', '--skip-generate', '--schema', path.join(ROOT, 'prisma', 'schema.prisma')],
  {
    cwd: ROOT,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, DATABASE_URL: `file:${TEMPLATE}`, PRISMA_HIDE_UPDATE_MESSAGE: '1' },
  }
)
if (res.status !== 0) {
  console.error('✗ Gagal push schema ke template')
  process.exit(1)
}

// 2. Seed pengguna awal
process.env.DATABASE_URL = `file:${TEMPLATE}`
const db = new PrismaClient()

async function seed() {
  const count = await db.pengguna.count()
  if (count === 0) {
    await db.pengguna.createMany({
      data: [
        { nama: 'Admin Workshop', email: 'admin@aftersales.local', role: 'ADMIN_WORKSHOP', aktif: true },
        { nama: 'Teknisi Lapangan', email: 'teknisi@aftersales.local', role: 'TEKNISI', aktif: true, wilayahKerja: 'Wilayah 1' },
      ],
    })
    console.log('✓ Seed pengguna awal: admin@aftersales.local & teknisi@aftersales.local')
  }
}

await seed()
await db.$disconnect()
console.log(`✓ Template database siap: ${TEMPLATE} (${(fs.statSync(TEMPLATE).size / 1024).toFixed(1)} KB)`)
