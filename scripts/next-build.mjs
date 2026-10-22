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

// Bersihkan folder standalone lama SEBELUM build. Next tidak menghapus isi
// folder ini saat build → file lama (db/, upload/, logs/, src/) tertinggal dan
// ikut ter-deploy. Membersihkan di sini juga desalination output: build
// standalone jadi ringan (tidak ikut menyalin data repo).
const STANDALONE_DIR = path.join(ROOT, '.next', 'standalone')
if (fs.existsSync(STANDALONE_DIR)) {
  try {
    fs.rmSync(STANDALONE_DIR, { recursive: true, force: true })
    console.log('✓ Folder .next/standalone lama dibersihkan')
  } catch (e) {
    console.warn(`! Gagal membersihkan .next/standalone: ${e.message}`)
    console.warn('  (server PM2 mungkin masih jalan — stop dulu agar file database Prisma tidak terkunci)')
  }
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
// DATABASE_URL untuk proses build — WAJIB absolut. Nilai relatif
// ('file:./db/custom.db') di-resolve relatif terhadap folder schema
// (prisma/) → Prisma membuka DB yang tidak ada ("Unable to open the database
// file") saat build.
function dbUrlAbsolut() {
  const raw = process.env.DATABASE_URL || 'file:./db/custom.db'
  if (!raw.startsWith('file:')) return raw
  let p = raw.slice('file:'.length)
  if (p.startsWith('./')) p = path.join(ROOT, p.slice(2))
  return `file:${p.replace(/\\/g, '/')}`
}

const res = spawnSync(cmd, args, {
  cwd: ROOT,
  stdio: 'inherit',
  env: { ...process.env, DATABASE_URL: dbUrlAbsolut(), NEXT_TELEMETRY_DISABLED: '1' },
})
if (res.status !== 0) {
  console.error('✗ next build gagal')
  process.exit(1)
}

cp(path.join(ROOT, '.next', 'static'), path.join(ROOT, '.next', 'standalone', '.next', 'static'))
cp(path.join(ROOT, 'public'), path.join(ROOT, '.next', 'standalone', 'public'))

// Bersihkan folder data/source yang ikut ter-copy ke output standalone.
// Next menyalin sebagian folder project (src, db, upload, logs, .cache …)
// ke dalam .next/standalone — bukan bagian dari bundle server, tapi berisi
// DATA (custom.db, backup, snapshot, foto inbox, cache bahasa Tesseract).
// Buang supaya output ringan & tidak ada data yang ditulis ke folder build.
// (Folder prisma/ & package.json TETAP dipakai — jangan dihapus.)
const BUANG_DARI_STANDALONE = [
  'src', 'db', 'logs', 'upload', 'download', '.cache',
  'scripts', 'mcp', 'mini-services', 'electron', 'tests', 'examples',
  'worklog.md', 'AGENTS.md',
]
for (const d of BUANG_DARI_STANDALONE) {
  const p = path.join(ROOT, '.next', 'standalone', d)
  if (!fs.existsSync(p)) continue
  try {
    fs.rmSync(p, { recursive: true, force: true })
  } catch (e) {
    console.warn(`! Gagal buang ${d} dari standalone: ${e.message}`)
  }
}
console.log(`✓ Folder data dibuang dari standalone: ${BUANG_DARI_STANDALONE.join(', ')}`)
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
