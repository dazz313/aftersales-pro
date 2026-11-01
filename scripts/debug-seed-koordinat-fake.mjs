/**
 * Isi koordinat FAKE untuk toko yang belum punya lat/long (idempotent:
 * hanya menulis bila latitude/longitude masih null). Dipakai sementara
 * sampai user memasukkan koordinat real lewat dialog Edit Toko.
 */
import fs from 'node:fs'
import crypto from 'node:crypto'

const env = fs.readFileSync('.env', 'utf8')
const m = env.match(/^AUTH_SECRET=(.*)$/m)
const SECRET = (m ? m[1].trim().replace(/^['"`]|['"`]$/g, '') : undefined) || 'aftersales-pro-secret-2026-ubah-lewat-env-AUTH_SECRET'
const b = (x) => Buffer.from(x).toString('base64url')
const h = b(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
const n = Math.floor(Date.now() / 1000)
const p = b(JSON.stringify({ nama: 'Admin Workshop', email: 'admin@local.test', username: null, sub: '26', role: 'ADMIN_WORKSHOP', iat: n, exp: n + 3600 }))
const s = b(crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest())
const auth = { Authorization: `Bearer ${h}.${p}.${s}`, 'Content-Type': 'application/json' }

const res = await fetch('http://localhost:3000/api/toko', { headers: auth })
const tokoList = await res.json()
console.log('jumlah toko:', tokoList.length)

// basis Jakarta; geser sedikit per toko supaya tidak tumpang-tindih
const baseLat = -6.2
const baseLng = 106.8
let i = 0
for (const t of tokoList) {
  if (t.latitude != null && t.longitude != null) { console.log('skip (sudah ada):', t.kodeToko); continue }
  const lat = baseLat + (i % 5) * 0.012 + Math.floor(i / 5) * 0.006
  const lng = baseLng + (i % 5) * 0.015 + Math.floor(i / 5) * 0.008
  const r = await fetch(`http://localhost:3000/api/toko/${t.id}`, {
    method: 'PATCH', headers: auth, body: JSON.stringify({ latitude: lat, longitude: lng, aktor: 'seed-fake' }),
  })
  const j = await r.json().catch(() => null)
  console.log(r.status, t.kodeToko, '->', j?.latitude, j?.longitude)
  i++
}
console.log('selesai')
