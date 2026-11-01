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
const list = await res.json()
console.log('jumlah toko:', list.length)
for (const t of list) {
  const target = (t.namaToko || '').trim()
  if (!target) { console.log('skip (nama kosong):', t.kodeToko); continue }
  if (t.barcodeToko === target) { console.log('skip (sudah nama):', t.kodeToko); continue }
  const r = await fetch(`http://localhost:3000/api/toko/${t.id}`, {
    method: 'PATCH', headers: auth, body: JSON.stringify({ barcodeToko: target, aktor: 'migrasi-nama' }),
  })
  const j = await r.json().catch(() => null)
  console.log(r.status, t.kodeToko, (t.barcodeToko ?? '') , '->', j?.barcodeToko)
}
console.log('selesai')
