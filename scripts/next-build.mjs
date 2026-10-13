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

function cp(src, dest) {
  if (!fs.existsSync(src)) {
    console.warn(`! Lewati (tidak ada): ${src}`)
    return
  }
  fs.cpSync(src, dest, { recursive: true })
  console.log(`✓ Salin ${path.relative(ROOT, src)} → ${path.relative(ROOT, dest)}`)
}

console.log('→ next build (standalone)...')
const res = spawnSync('npx', ['next', 'build'], {
  cwd: ROOT,
  stdio: 'inherit',
  shell: process.platform === 'win32',
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
