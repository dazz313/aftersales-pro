/**
 * Build Desktop Windows (MSI + NSIS)
 * ==================================
 * Orkestrasi build installer versi desktop. Jalankan di Windows (lokal atau CI):
 *
 *   npm install
 *   node scripts/build-desktop.mjs
 *
 * Hasil: dist/desktop/AfterSalesPro-Setup-<versi>-x64.msi (+ .exe NSIS)
 *
 * Tahap:
 *   1. prisma generate (engine sesuai OS build)
 *   2. next build standalone (scripts/next-build.mjs)
 *   3. template database (scripts/make-template-db.mjs)
 *   4. staging dist/desktop/staging:
 *      app/standalone  → server Next.js + node_modules ter-trace
 *      app/node_modules→ .prisma (engine), @prisma/client, @prisma/engines, prisma CLI
 *      app/mcp         → MCP server ter-bundle (server.cjs) + contoh config
 *      prisma/         → schema.prisma + template.db
 *   5. electron-builder → MSI & NSIS
 */

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const STAGING = path.join(ROOT, 'dist', 'desktop', 'staging')
const APP_DIR = path.join(STAGING, 'app')
const PRISMA_DIR = path.join(STAGING, 'prisma')

function run(cmd, args, opts = {}) {
  console.log(`\n→ ${cmd} ${args.join(' ')}`)
  const res = spawnSync(cmd, args, {
    cwd: ROOT,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: {
      ...process.env,
      DATABASE_URL: process.env.DATABASE_URL || 'file:./db/custom.db',
      NEXT_TELEMETRY_DISABLED: '1',
      PRISMA_HIDE_UPDATE_MESSAGE: '1',
      CSC_IDENTITY_AUTO_DISCOVERY: 'false',
      ...opts.env,
    },
    ...opts,
  })
  if (res.status !== 0) {
    console.error(`✗ Perintah gagal: ${cmd} ${args.join(' ')}`)
    process.exit(1)
  }
}

function cp(src, dest) {
  if (!fs.existsSync(src)) {
    console.error(`✗ Sumber tidak ada: ${src}`)
    process.exit(1)
  }
  fs.cpSync(src, dest, { recursive: true })
  console.log(`✓ Salin ${path.relative(ROOT, src)}`)
}

// ---------- 1-3. Generate, build, template ----------
run('npx', ['prisma', 'generate'])
run('node', ['scripts/next-build.mjs'])
run('node', ['scripts/make-template-db.mjs'])

// ---------- 4. Staging ----------
console.log('\n→ Siapkan staging...')
fs.rmSync(STAGING, { recursive: true, force: true })
fs.mkdirSync(APP_DIR, { recursive: true })
fs.mkdirSync(PRISMA_DIR, { recursive: true })

// 4a. Standalone Next.js
cp(path.join(ROOT, '.next', 'standalone'), path.join(APP_DIR, 'standalone'))

// 4b. Prisma runtime untuk server standalone (belt & braces — tracing kadang melewatkan engine)
cp(path.join(ROOT, 'node_modules', '.prisma'), path.join(APP_DIR, 'standalone', 'node_modules', '.prisma'))

// 4c. Prisma CLI + engine (dipakai Electron untuk `db push` saat upgrade versi)
cp(path.join(ROOT, 'node_modules', 'prisma'), path.join(APP_DIR, 'node_modules', 'prisma'))
cp(path.join(ROOT, 'node_modules', '@prisma', 'engines'), path.join(APP_DIR, 'node_modules', '@prisma', 'engines'))
cp(path.join(ROOT, 'node_modules', '@prisma', 'client'), path.join(APP_DIR, 'node_modules', '@prisma', 'client'))
cp(path.join(ROOT, 'node_modules', '.prisma'), path.join(APP_DIR, 'node_modules', '.prisma'))

// 4d. MCP server — bundle satu file (SDK + dependensi), @prisma/client tetap eksternal
console.log('\n→ Bundle MCP server (esbuild)...')
fs.mkdirSync(path.join(APP_DIR, 'mcp'), { recursive: true })
run('npx', [
  'esbuild', 'mcp/server.mjs',
  '--bundle',
  '--platform=node',
  '--format=cjs',
  '--external:@prisma/client',
  '--external:@prisma/engines',
  `--outfile=${path.join(APP_DIR, 'mcp', 'server.cjs')}`,
])
cp(path.join(ROOT, 'mcp', 'claude-desktop-config.example.json'), path.join(APP_DIR, 'mcp', 'claude-desktop-config.example.json'))

// 4e. Prisma schema + template DB untuk installer
cp(path.join(ROOT, 'prisma', 'schema.prisma'), path.join(PRISMA_DIR, 'schema.prisma'))
cp(path.join(ROOT, 'db', 'template.db'), path.join(PRISMA_DIR, 'template.db'))

// ---------- 5. electron-builder ----------
console.log('\n→ electron-builder (Windows MSI + NSIS)...')
run('npx', ['electron-builder', '--win', 'msi', 'nsis', '--config', 'electron-builder.yml'])

console.log('\n=== BUILD DESKTOP SELESAI ===')
const dist = path.join(ROOT, 'dist', 'desktop')
for (const f of fs.readdirSync(dist)) {
  if (f.endsWith('.msi') || f.endsWith('.exe')) {
    const size = (fs.statSync(path.join(dist, f)).size / 1024 / 1024).toFixed(1)
    console.log(`  • ${f} (${size} MB)`)
  }
}
