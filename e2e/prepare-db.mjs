/**
 * Menyiapkan database KHUSUS E2E: skema bersih + data seed + akun admin uji.
 * Dijalankan oleh webServer Playwright SEBELUM `next dev` — DATABASE_URL
 * diambil dari environment (lihat playwright.config.ts). Tidak menyentuh
 * db/custom.db pengembangan.
 */
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { randomBytes, scryptSync } from 'node:crypto'
import { PrismaClient } from '@prisma/client'

const url = process.env.DATABASE_URL
if (!url || !url.startsWith('file:')) {
  console.error('[e2e] DATABASE_URL (file:<path>) wajib diisi.')
  process.exit(1)
}

const filePath = url.slice('file:'.length)
fs.mkdirSync(path.dirname(filePath), { recursive: true })

// Mulai dari kondisi bersih: hapus file SQLite (beserta -wal/-shm) agar tiap
// sesi E2E deterministik dan tidak ada sisa data dari run sebelumnya.
for (const sufiks of ['', '-wal', '-shm']) {
  const f = filePath + sufiks
  if (fs.existsSync(f)) fs.rmSync(f)
}

console.log('[e2e] prisma db push ->', filePath)
execSync('npx prisma db push --skip-generate --accept-data-loss', {
  stdio: 'inherit',
  env: process.env,
})

/** Hash scrypt dengan format sama seperti src/lib/auth-node.ts. */
function hashPassword(plain) {
  const salt = randomBytes(16)
  return `scrypt$${salt.toString('hex')}$${scryptSync(plain, salt, 64).toString('hex')}`
}

export const AKUN_E2E = { email: 'e2e-admin@example.test', password: 'e2e-pass-123' }

const prisma = new PrismaClient()
try {
  // 1) Admin uji
  await prisma.pengguna.create({
    data: {
      nama: 'E2E Admin',
      email: AKUN_E2E.email,
      username: 'e2eadmin',
      passwordHash: hashPassword(AKUN_E2E.password),
      role: 'ADMIN_WORKSHOP',
      aktif: true,
    },
  })

  // 2) Master toko
  const toko = await prisma.masterToko.create({
    data: {
      kodeToko: 'E2E-TOKO',
      namaToko: 'Toko E2E',
      alamat: 'Jl. Pengujian No. 1',
      kontak: '081200000001',
      barcodeToko: 'E2E-TOKO-BC',
      aktif: true,
    },
  })

  // 3) Master customer
  const customer = await prisma.masterCustomer.create({
    data: { nama: 'Customer E2E', noWa: '081211112222', alamat: 'Jl. Pengujian No. 2' },
  })

  // 4) Unit asset (GARANSI default → diubah ke NON_GARANSI saat tiket dibuat tes)
  await prisma.unitAsset.create({
    data: {
      serialNumber: 'SN-E2E-001',
      modelUnit: 'Kipas E2E',
      merk: 'E2E',
      nama: 'Unit E2E',
      tokoId: toko.id,
      customerId: customer.id,
      statusGaransi: 'NON_GARANSI',
      tglPembelian: new Date('2024-01-15T00:00:00.000Z'),
    },
  })

  // 5) Sparepart dengan stok cukup → part READY (auto PROSES) saat dipakai tiket
  await prisma.masterSparepart.create({
    data: {
      kodePart: 'E2E-PART-01',
      namaPart: 'Kapasitor E2E',
      brandKompatibel: 'E2E',
      supplier: 'Internal',
      stokJual: 20,
      stokGaransi: 0,
      stokInventory: 20,
      reorderLimit: 5,
      hargaKlaim: 45000,
    },
  })

  console.log('[e2e] seed siap — admin, toko, customer, unit SN-E2E-001, part E2E-PART-01')
} finally {
  await prisma.$disconnect()
}
