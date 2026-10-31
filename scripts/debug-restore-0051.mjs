// Kembalikan tglPartDatang SVC-2610-0051 ke nilai semula (dari uji tadi).
import fs from 'node:fs'
import crypto from 'node:crypto'

const env = fs.readFileSync('.env', 'utf8')
const m = env.match(/^AUTH_SECRET=(.*)$/m)
const SECRET = (m ? m[1].trim().replace(/^['"]|['"]$/g, '') : undefined) || 'aftersales-pro-secret-2026-ubah-lewat-env-AUTH_SECRET'
const b = (x) => Buffer.from(x).toString('base64url')
const h = b(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
const n = Math.floor(Date.now() / 1000)
const p = b(JSON.stringify({ nama: 'Admin Workshop', email: 'admin@local.test', username: null, sub: '26', role: 'ADMIN_WORKSHOP', iat: n, exp: n + 3600 }))
const s = b(crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest())
const A = { Authorization: `Bearer ${h}.${p}.${s}`, 'Content-Type': 'application/json' }

const ASLI = '2026-10-31T00:00:18.333Z'
const tickets = await (await fetch('http://localhost:3000/api/service', { headers: { Authorization: A.Authorization } })).json()
const c = tickets.find((t) => t.noTiket === 'SVC-2610-0051')
console.log('sekarang:', c.tglPartDatang)
if (new Date(c.tglPartDatang).getTime() !== new Date(ASLI).getTime()) {
  const r = await fetch(`http://localhost:3000/api/service/${c.id}`, { method: 'PATCH', headers: A, body: JSON.stringify({ aksi: 'KOREKSI_TGL_PART_DATANG', tglPartDatang: ASLI, koreksiSelesai: true }) })
  console.log('restore:', r.status)
  const t2 = await (await fetch('http://localhost:3000/api/service', { headers: { Authorization: A.Authorization } })).json()
  console.log('setelah restore:', t2.find((t) => t.noTiket === 'SVC-2610-0051')?.tglPartDatang)
} else {
  console.log('sudah benar')
}
