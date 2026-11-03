import fs from 'node:fs'
import crypto from 'node:crypto'

/**
 * Uji live Bank Kode:
 *  - pencarian "RI-202S" harus menemukan "Top Plate RI 202 S"
 *    walau kolom model kosong & penulisan beda (strip vs spasi);
 *  - sinkron tidak boleh menyalin model unit tiket ke part lain
 *    (gas valve / FSDF tidak boleh berlabel "RI 202 S");
 *  - ringkasan sumber & jumlah model tampil.
 *
 * Jalankan: node scripts/debug-cek-bank-kode.mjs
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

async function tampil(q) {
  const r = await fetch(`${base}/api/bank-kode?q=${encodeURIComponent(q)}&take=8`, { headers: auth })
  const j = await r.json().catch(() => ({}))
  console.log(`\nq="${q}" -> ${r.status} totalCocok=${j.totalCocok ?? '-'} totalBank=${j.totalBank ?? '-'} model=${j.ringkasan?.jumlahModel ?? '-'}`)
  for (const x of j.items ?? []) {
    console.log(`  ${x.skor ?? '-'} [${(x.cocokPada ?? []).join(',')}] ${x.kode} | ${x.namaPart} | model=${x.modelTampil ?? '-'} | ${x.sumber}`)
  }
  if (j.ringkasan?.perSumber) console.log('  sumber:', JSON.stringify(j.ringkasan.perSumber))
  return j
}

console.log('=== SINKRON (idempoten) ===')
const r = await fetch(`${base}/api/bank-kode/sinkron`, {
  method: 'POST',
  headers: auth,
  body: JSON.stringify({ aktor: 'debug' }),
})
console.log(r.status, await r.json().catch(() => null))

console.log('\n=== PENCARIAN ===')
const a = await tampil('RI-202S')
await tampil('ri202s')
await tampil('top plate')
await tampil('rinnai')
const gas = await tampil('gas single total')

const items = a.items ?? []
const adaTopPlate = items.some((x) => /TOP PLATE RI 202 S/i.test(x.namaPart ?? ''))
const salahModel = [...items, ...(gas.items ?? [])].filter(
  (x) => /RI 202 S/i.test(x.modelTampil ?? '') && !/TOP PLATE RI 202 S|RI202-001-2-1X02-PR/i.test(`${x.namaPart} ${x.kode}`),
)
console.log(`\nTop Plate ditemukan : ${adaTopPlate ? 'OK' : 'GAGAL'}`)
console.log(`Model salah tempel  : ${salahModel.length === 0 ? 'OK (tidak ada)' : `GAGAL (${salahModel.length})`}`)
for (const x of salahModel) console.log(`  ${x.kode} | ${x.namaPart} | model=${x.modelTampil}`)
process.exit(adaTopPlate && salahModel.length === 0 ? 0 : 1)
