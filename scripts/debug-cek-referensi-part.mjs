import fs from 'node:fs'
import crypto from 'node:crypto'

/**
 * Uji live referensi otomatis kode/nama part:
 *  - kode lengkap → menemukan kode itu + info katalog/pemakaian;
 *  - kode beda 1 huruf → tetap muncul (toleran salah ketik);
 *  - nama lengkap → menemukan kode yang pernah dipakai;
 *  - kode yang hanya berbagi angka TIDAK muncul (tidak menyesatkan).
 *
 * Jalankan: node scripts/debug-cek-referensi-part.mjs
 */
const env = fs.readFileSync('.env', 'utf8')
const m = env.match(/^AUTH_SECRET=(.*)$/m)
const SECRET = (m ? m[1].trim().replace(/^['"`]|['"`]$/g, '') : undefined) || 'aftersales-pro-secret-2026-ubah-lewat-env-AUTH_SECRET'
const b = (x) => Buffer.from(x).toString('base64url')
const h = b(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
const n = Math.floor(Date.now() / 1000)
const p = b(JSON.stringify({ nama: 'Admin Workshop', email: 'admin@local.test', username: null, sub: '26', role: 'ADMIN_WORKSHOP', iat: n, exp: n + 3600 }))
const s = b(crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest())
const auth = { Authorization: `Bearer ${h}.${p}.${s}`, 'Content-Type': 'application/json' }
const base = 'http://localhost:3000'

async function cek(label, params) {
  const qs = new URLSearchParams(params).toString()
  const r = await fetch(`${base}/api/bank-kode/referensi?${qs}`, { headers: auth })
  const j = await r.json().catch(() => ({}))
  console.log(`\n${label} (${qs}) -> ${r.status} total=${j.total ?? '-'}`)
  for (const it of j.items ?? []) {
    console.log(`  ${it.skor}% [${(it.cocokPada ?? []).join(',')}] ${it.kode} | ${it.namaPart} | katalog=${it.adaKatalog} stok=${it.stokInventory} dipakai=${it.dipakai} | ${it.sumber}`)
  }
  return j
}

const exact = await cek('KODE LENGKAP', { kode: 'RI202-001-2-1X02-PR' })
const prefix = await cek('KODE AWALAN', { kode: 'RI202-001' })
const typo = await cek('SALAH KETIK 1 HURUF', { kode: 'RI202-001-2-1X03-PR' })
const nama = await cek('NAMA LENGKAP', { nama: 'Top Plate RI 202 S' })
const beda = await cek('KODE BEDA (tidak boleh menyesatkan)', { kode: 'RI-202S' })

const okExact = (exact.items ?? []).some((x) => x.kode === 'RI202-001-2-1X02-PR' && x.skor === 100 && x.adaKatalog)
const okPrefix = (prefix.items ?? []).some((x) => x.kode === 'RI202-001-2-1X02-PR')
const okTypo = (typo.items ?? []).some((x) => x.kode === 'RI202-001-2-1X02-PR')
const okNama = (nama.items ?? []).some((x) => x.kode === 'RI202-001-2-1X02-PR')
const okBeda = !(beda.items ?? []).some((x) => x.kode === 'RI202-001-2-1X02-PR')

console.log('\n=== HASIL ===')
console.log(`Kode lengkap     : ${okExact ? 'OK' : 'GAGAL'}`)
console.log(`Kode awalan      : ${okPrefix ? 'OK' : 'GAGAL'}`)
console.log(`Salah ketik 1    : ${okTypo ? 'OK' : 'GAGAL'}`)
console.log(`Nama lengkap     : ${okNama ? 'OK' : 'GAGAL'}`)
console.log(`Tidak menyesatkan: ${okBeda ? 'OK' : 'GAGAL'}`)
process.exit(okExact && okPrefix && okTypo && okNama && okBeda ? 0 : 1)
