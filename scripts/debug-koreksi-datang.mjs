// Uji PATCH aksi KOREKSI_TGL_PART_DATANG terhadap server produksi
// (hanya jalur validasi TANPA mengubah data tiket).
import fs from 'node:fs'
import crypto from 'node:crypto'

const env = fs.readFileSync('.env', 'utf8')
const m = env.match(/^AUTH_SECRET=(.*)$/m)
const SECRET = (m ? m[1].trim().replace(/^['"]|['"]$/g, '') : undefined) || 'aftersales-pro-secret-2026-ubah-lewat-env-AUTH_SECRET'
const b = (x) => Buffer.from(x).toString('base64url')
const h = b(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
const n = Math.floor(Date.now() / 1000)
const p = b(JSON.stringify({ nama: 'Admin Workshop', email: 'admin@local.test', username: null, sub: '26', role: 'ADMIN_WORKSHOP', iat: n, exp: n + 3600 }))
const sig = b(crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest())
const auth = { Authorization: `Bearer ${h}.${p}.${sig}`, 'Content-Type': 'application/json' }

const r0 = await fetch('http://localhost:3000/api/service', { headers: { Authorization: auth.Authorization } })
const tickets = await r0.json()
const finish = tickets.filter((t) => t.status === 'FINISH')
const contoh = finish[0]
console.log(`total tiket: ${tickets.length}, FINISH: ${finish.length}`)
if (contoh) {
  console.log(`tiket uji: ${contoh.noTiket} | tglFinish: ${contoh.tglFinish} | tglPartDatang: ${contoh.tglPartDatang ?? '-'}`)
}

async function patch(body, label) {
  if (!contoh) return console.log(label, '— dilewati (tidak ada tiket FINISH)')
  const r = await fetch(`http://localhost:3000/api/service/${contoh.id}`, { method: 'PATCH', headers: auth, body: JSON.stringify(body) })
  const j = await r.json().catch(() => ({}))
  console.log(`${label}: status=${r.status}${r.status >= 400 ? ` error="${j.error}"` : ''}`)
}

// 1) Tanpa flag koreksi → 409 (tidak mengubah apa pun)
await patch({ aksi: 'KOREKSI_TGL_PART_DATANG', tglPartDatang: new Date().toISOString() }, 'tanpa flag (harus 409)')
// 2) Tanggal masa depan → 400
const masaDepan = new Date(Date.now() + 30 * 24 * 3600_000).toISOString()
await patch({ aksi: 'KOREKSI_TGL_PART_DATANG', tglPartDatang: masaDepan, koreksiSelesai: true }, 'tanggal masa depan (harus 400)')
// 3) Sebelum tiket dibuat → 400
const sebelum = new Date(new Date(contoh.createdAt).getTime() - 30 * 24 * 3600_000).toISOString()
await patch({ aksi: 'KOREKSI_TGL_PART_DATANG', tglPartDatang: sebelum, koreksiSelesai: true }, 'sebelum createdAt (harus 400)')
// 4) Lebih lambat dari tglFinish (tiket FINISH) → 400
if (contoh.tglFinish) {
  const setelahFinish = new Date(new Date(contoh.tglFinish).getTime() + 10 * 24 * 3600_000).toISOString()
  await patch({ aksi: 'KOREKSI_TGL_PART_DATANG', tglPartDatang: setelahFinish, koreksiSelesai: true }, 'lewat tgl finish (harus 400)')
}
