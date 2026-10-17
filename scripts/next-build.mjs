/**
 * Build Next.js (standalone) — lintas-platform (Linux/Windows/macOS)
 * -------------------------------------------------------------------
 * Pengganti `next build && cp -r ...` yang tidak jalan di Windows.
 * 1. `next build` (output: standalone)
 * 2. Salin .next/static → .next/standalone/.next/static
 * 3. Salin public → .next/standalone/public
 */

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// Backup DB SEBELUM build — melindungi data produksi saat upgrade/penambahan
// fitur. Build DIBATALKAN bila backup gagal (set BACKUP_SKIP=1 untuk paksa).
if (process.env.BACKUP_SKIP !== '1') {
  console.log('→ Backup database sebelum build...')
  const b = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'backup-db.mjs')], { cwd: ROOT, stdio: 'inherit' })
  if (b.status !== 0) {
    console.error('✗ Backup database GAGAL — build dihentikan agar data tidak hilang. Perbaiki dulu, atau BACKUP_SKIP=1 bila yakin.')
    process.exit(1)
  }
}

function cp(src, dest) {
  if (!fs.existsSync(src)) {
    console.warn(`! Lewati (tidak ada): ${src}`)
    return
  }
  fs.cpSync(src, dest, { recursive: true })
  console.log(`✓ Salin ${path.relative(ROOT, src)} → ${path.relative(ROOT, dest)}`)
}

console.log('→ next build (standalone)...')
// Panggil CLI Next.js langsung via node (tanpa shell) agar argumen tidak
// digabung/di-escape ulang — menghindari deprecation DEP0190 & injection.
const nextCli = path.join(ROOT, 'node_modules', 'next', 'dist', 'bin', 'next')
let cmd, args
if (fs.existsSync(nextCli)) {
  cmd = process.execPath
  args = [nextCli, 'build']
} else {
  console.warn('! CLI Next.js tidak ditemukan, fallback ke npx...')
  cmd = process.platform === 'win32' ? 'npx.cmd' : 'npx'
  args = ['next', 'build']
}
const res = spawnSync(cmd, args, {
  cwd: ROOT,
  stdio: 'inherit',
  env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL || 'file:./db/custom.db', NEXT_TELEMETRY_DISABLED: '1' },
})
if (res.status !== 0) {
  console.error('✗ next build gagal')
  process.exit(1)
}

cp(path.join(ROOT, '.next', 'static'), path.join(ROOT, '.next', 'standalone', '.next', 'static'))
cp(path.join(ROOT, 'public'), path.join(ROOT, '.next', 'standalone', 'public'))
// Sinkronkan .env mesin ini ke standalone: server warunkah chdir ke
// .next/standalone saat boot, dan salinan .env basi di sana akan
// membayangi .env asli (pernah menyebabkan AUTH_SECRET "hilang").
// .env tetap gitignored — tiap mesin memakai secrets-nya sendiri.
try {
  const dotenv = path.join(ROOT, '.env')
  if (fs.existsSync(dotenv)) {
    fs.copyFileSync(dotenv, path.join(ROOT, '.next', 'standalone', '.env'))
    console.log('✓ Sinkron .env → .next/standalone/.env')
  }
} catch (e) {
  console.warn(`! Gagal menyinkron .env: ${e.message}`)
}
console.log('✓ Standalone build siap: .next/standalone')
