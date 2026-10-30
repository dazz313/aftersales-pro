/**
 * Debug ujung-ke-ujung /api/ai/tren & /api/ai/analisa-upload pada
 * server produksi (localhost:3000) — token sesi dirakit manual dari
 * AUTH_SECRET .env (user ADMIN sintetis; hanya ujung handshake, bukan
 * pengganti login pengguna).
 */
import fs from 'node:fs'
import crypto from 'node:crypto'
import * as XLSX from 'xlsx'

const env = fs.readFileSync('.env', 'utf8')
const envGet = (k, def) => {
  const m = env.match(new RegExp(`^${k}=(.*)$`, 'm'))
  return m ? m[1].trim().replace(/^["']|["']$/g, '') : def
}
const SECRET = envGet('AUTH_SECRET', 'aftersales-pro-secret-2026-ubah-lewat-env-AUTH_SECRET')

// ── HS256 JWT manual (format sama dengan src/lib/auth.ts)
const b64u = (buf) => Buffer.from(buf).toString('base64url')
const header = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
const now = Math.floor(Date.now() / 1000)
const payload = b64u(JSON.stringify({
  nama: 'Admin Workshop',
  email: 'admin@local.test',
  username: null,
  sub: '26',
  role: 'ADMIN_WORKSHOP',
  iat: now,
  exp: now + 3600,
}))
const sig = b64u(crypto.createHmac('sha256', SECRET).update(`${header}.${payload}`).digest())
const token = `${header}.${payload}.${sig}`
const auth = { Authorization: `Bearer ${token}` }

const PORT = 3000

// ── Buat file Excel uji: ada kode toko yang ADA & yang TIDAK ADA di aplikasi
const aoa = [
  ['KODE TOKO', 'NAMA TOKO', 'JUMLAH UNIT', 'KODE PART', 'NAMA PART', 'STOK'],
  ['DK-01', 'Toko Depok', 3, 'SF-3128', 'Impeller Pompa Besar', 2],
  ['XX-99', 'Toko Tidak Terdaftar', 5, 'ZZ-0001', 'Part Fiktif Uji', 7],
  ['JK-02', 'Toko Jakarta', 1, 'WD-6200', 'Filter Kapasitor', 0],
]
const wb = XLSX.utils.book_new()
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Data')
const buf = Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }))

async function main() {
  console.log('=== POST /api/ai/tren (TAHUN) ===')
  let t0 = Date.now()
  const r1 = await fetch(`http://localhost:${PORT}/api/ai/tren`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth },
    body: JSON.stringify({ periode: 'TAHUN' }),
  })
  const j1 = await r1.json().catch(() => ({}))
  console.log(`status=${r1.status} ${((Date.now() - t0) / 1000).toFixed(1)}s`)
  console.log('periode:', j1.periode, '| jumlah sel:', j1.series?.length, '| total:', JSON.stringify(j1.total))
  console.log('narasi:', j1.narasi ? `ADA (${j1.narasi.length} karakter, model ${j1.model})` : 'NULL', '| catatan:', j1.catatan)

  console.log('\n=== POST /api/ai/analisa-upload (Excel uji) ===')
  t0 = Date.now()
  const fd = new FormData()
  fd.append('file', new File([buf], 'uji.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
  fd.append('pertanyaan', 'Toko mana yang belum terdaftar di aplikasi?')
  const r2 = await fetch(`http://localhost:${PORT}/api/ai/analisa-upload`, {
    method: 'POST',
    headers: auth,
    body: fd,
  })
  const j2 = await r2.json().catch(() => null)
  console.log(`status=${r2.status} ${((Date.now() - t0) / 1000).toFixed(1)}s`)
  if (!j2) {
    console.log('BODY BUKAN JSON — pemborong kemungkinan proxied:', (await r2.text()).slice(0, 300))
    return
  }
  if (j2.error) { console.log('ERROR:', j2.error); return }
  console.log('fileMeta:', JSON.stringify(j2.fileMeta))
  console.log('statistik:', JSON.stringify(j2.statistik))
  console.log('bandingkan:', JSON.stringify(j2.bandingkan))
  console.log('catatan:', j2.catatan)
}

await main()
