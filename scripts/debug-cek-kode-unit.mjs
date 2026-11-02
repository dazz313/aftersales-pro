import fs from 'node:fs'
import crypto from 'node:crypto'

/**
 * Uji cepat isi QR stiker unit (format 4 identifikasi) terhadap API mobile:
 *   SN:<nomor seri>|MOD:<model>|TOK:<toko>|NAMA:<nama produk>
 *
 * Jalankan: node scripts/debug-cek-kode-unit.mjs
 * (butuh server hidup di http://localhost:3000 dan .env berisi AUTH_SECRET)
 */

const env = fs.readFileSync('.env', 'utf8')
const m = env.match(/^AUTH_SECRET=(.*)$/m)
const SECRET = (m ? m[1].trim().replace(/^['"`]|['"`]$/g, '') : undefined) || 'aftersales-pro-secret-2026-ubah-lewat-env-AUTH_SECRET'
const b = (x) => Buffer.from(x).toString('base64url')
const h = b(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
const n = Math.floor(Date.now() / 1000)
const p = b(JSON.stringify({ nama: 'Admin Workshop', email: 'admin@local.test', username: null, sub: '26', role: 'ADMIN_WORKSHOP', iat: n, exp: n + 3600 }))
const s = b(crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest())
const auth = { Authorization: `Bearer ${h}.${p}.${s}` }

/** Sama dengan bangunKodeUnit() di src/lib/kode-unit.ts (tanpa batas panjang, cukup untuk uji). */
const bangun = ({ serialNumber, modelUnit, nama, pemilik }) =>
  `SN:${serialNumber}|MOD:${modelUnit}|TOK:${pemilik}|NAMA:${nama}`

async function scan(label, kode) {
  const r = await fetch(`http://localhost:3000/api/mobile/scan?kode=${encodeURIComponent(kode)}`, { headers: auth })
  const j = await r.json()
  console.log(`${r.status} ${label} -> ${j.tipe}${j.tahap ? ` tahap=${j.tahap}` : ''}`)
  if (j.identifikasi) console.log('   identifikasi       :', JSON.stringify(j.identifikasi))
  if (j.identifikasiStiker) console.log('   identifikasiStiker :', JSON.stringify(j.identifikasiStiker))
  if (j.error) console.log('   error              :', j.error)
  return j
}

const kodeBaru = bangun({
  serialNumber: '2603128725B',
  modelUnit: 'RI-712GA(B)',
  nama: 'Kulkas 2 Pintu',
  pemilik: 'Toko Semeru Ahmad Yani',
})
console.log('contoh isi QR:', kodeBaru, `(${kodeBaru.length} karakter)\n`)

await scan('format baru (unit terdaftar)', kodeBaru)
await scan('format lama tanpa NAMA', 'SN:02100056000|MOD:WD-186 H|TOK:TOK-032')
await scan('stiker lama (nomor seri)', '2603128725B')
await scan('format baru, unit tak ada', 'SN:TIDAK-ADA-999|MOD:X|TOK:Toko Uji|NAMA:Produk Uji')
