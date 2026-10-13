/**
 * HAPUS SEMUA DATA KECUALI KARYAWAN (pengguna) — reset transaksi/master.
 * ---------------------------------------------------------------------------
 * ⚠️  IRREVERSIBLE tanpa backup. Sebelum jalankan: node scripts/backup-db.mjs
 * Data karyawan (akun login, role, kontak) TIDAK disentuh.
 * Tabel yang dikosongkan: tiket, part tiket, order, unit, kunjungan, audit,
 * WA message, backup log, vision scan, inbox, sparepart, customer, toko,
 * pengaturan.
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

console.log('⚠️  Menghapus semua data KECUALI karyawan...')
const karyawanSebelum = await prisma.pengguna.count()
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
])
const karyawanSesudah = await prisma.pengguna.count()
console.log(`✓ Selesai — karyawan dipertahankan: ${karyawanSesudah} akun (sebelumnya ${karyawanSebelum})`)
await prisma.$disconnect()
