/**
 * Menyiapkan database KHUSUS E2E: sinkron skema + akun admin uji.
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
  const data = {
    nama: 'E2E Admin',
    email: AKUN_E2E.email,
    username: 'e2eadmin',
    passwordHash: hashPassword(AKUN_E2E.password),
    role: 'ADMIN_WORKSHOP',
    aktif: true,
  }
  const ada = await prisma.pengguna.findFirst({ where: { email: AKUN_E2E.email } })
  if (ada) await prisma.pengguna.update({ where: { id: ada.id }, data })
  else await prisma.pengguna.create({ data })
  console.log('[e2e] akun admin uji siap:', AKUN_E2E.email)
} finally {
  await prisma.$disconnect()
}
