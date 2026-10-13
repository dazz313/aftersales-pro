/**
 * HAPUS SEMUA DATA — kosongkan seluruh tabel (termasuk karyawan/pengguna).
 * ---------------------------------------------------------------------------
 * ⚠️  IRREVERSIBLE tanpa backup. Sebelum jalankan: node scripts/backup-db.mjs
 * Setelah wipe, dibuat 1 akun ADMIN_WORKSHOP default agar sistem tetap bisa
 * login:  username/email: budi    password: admin123
 * Ganti password segera setelah login pertama.
 */
import { PrismaClient } from '@prisma/client'
import { randomBytes, scryptSync } from 'node:crypto'

function hashPassword(plain) {
  const salt = randomBytes(16)
  const hash = scryptSync(plain, salt, 64)
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`
}

const prisma = new PrismaClient()

console.log('⚠️  Menghapus SEMUA data (15 tabel)...')
await prisma.$transaction([
  prisma.serviceRequestPart.deleteMany(),
  prisma.serviceRequest.deleteMany(),
  prisma.permintaanOrder.deleteMany(),
  prisma.unitAsset.deleteMany(),
  prisma.kunjungan.deleteMany(),
  prisma.auditLog.deleteMany(),
  prisma.waMessage.deleteMany(),
  prisma.backupLog.deleteMany(),
  prisma.visionScan.deleteMany(),
  prisma.inboxItem.deleteMany(),
  prisma.masterSparepart.deleteMany(),
  prisma.masterCustomer.deleteMany(),
  prisma.masterToko.deleteMany(),
  prisma.pengaturan.deleteMany(),
  prisma.pengguna.deleteMany(),
])
console.log('✓ Semua tabel kosong')

await prisma.pengguna.create({
  data: {
    nama: 'Budi Santoso',
    email: 'budi@teknikjaya.co.id',
    username: 'budi',
    kodeTeknisi: 'TKN-001',
    passwordHash: hashPassword('admin123'),
    role: 'ADMIN_WORKSHOP',
  },
})
console.log('✓ Admin default dibuat: budi / admin123 (ganti password segera)')

const sisa = await prisma.pengguna.count()
console.log(`Selesai. Total pengguna: ${sisa}`)
await prisma.$disconnect()
