// Uji aturan urutan: tgl part datang melewati tglFinish tiket FINISH lama → 400.
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

const t = await (await fetch('http://localhost:3000/api/service', { headers: { Authorization: A.Authorization } })).json()
const c = t.filter((x) => x.status === 'FINISH' && x.tglFinish && new Date(x.tglFinish).getTime() < Date.now() - 10 * 24 * 3600_000)[0]
const d = new Date(new Date(c.tglFinish).getTime() + 3 * 24 * 3600_000).toISOString()
const r = await fetch(`http://localhost:3000/api/service/${c.id}`, { method: 'PATCH', headers: A, body: JSON.stringify({ aksi: 'KOREKSI_TGL_PART_DATANG', tglPartDatang: d, koreksiSelesai: true }) })
const j = await r.json().catch(() => ({}))
console.log(c.noTiket, '| tglFinish', c.tglFinish, '| uji', d, '=> status', r.status, r.status >= 400 ? `error="${j.error}"` : JSON.stringify(j.tglPartDatang))
