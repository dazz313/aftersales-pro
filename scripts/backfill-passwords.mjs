/**
 * Backfill kredensial login untuk pengguna existing:
 * - username: local-part email (bila kosong)
 * - passwordHash: ADMIN_WORKSHOP → "admin123", lainnya → "aftersales123"
 * Aman dijalankan berulang (idempotent): baris yang sudah punya password dilewati.
 * Pemakaian: node scripts/backfill-passwords.mjs
 */
import { randomBytes, scryptSync } from 'node:crypto'
import { PrismaClient } from '@prisma/client'

function hashPassword(plain) {
  const salt = randomBytes(16)
  const hash = scryptSync(plain, salt, 64)
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`
}

const db = new PrismaClient()

async function main() {
  const users = await db.pengguna.findMany()
  let updated = 0
  for (const u of users) {
    const data = {}
    if (!u.username) {
      const local = u.email.split('@')[0]
      const clash = await db.pengguna.findFirst({ where: { username: local, NOT: { id: u.id } } })
      if (!clash) data.username = local
    }
    if (!u.passwordHash) {
      data.passwordHash = u.role === 'ADMIN_WORKSHOP' ? hashPassword('admin123') : hashPassword('aftersales123')
    }
    if (Object.keys(data).length > 0) {
      await db.pengguna.update({ where: { id: u.id }, data })
      updated++
      console.log(`  ✓ ${u.email} → username=${data.username ?? '(tetap)'} password=${data.passwordHash ? 'di-set' : '(tetap)'}`)
    }
  }
  console.log(`Selesai: ${updated}/${users.length} pengguna diperbarui`)
}

main()
  .catch((e) => {
    console.error('Backfill gagal:', e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
