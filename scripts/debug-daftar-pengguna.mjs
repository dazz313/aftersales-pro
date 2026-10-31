/** Baca daftar pengguna via API (JWT sesi dirakit dari AUTH_SECRET) — hanya baca. */
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
const auth = { Authorization: `Bearer ${h}.${p}.${s}` }

const r = await fetch('http://localhost:3000/api/pengguna', { headers: auth })
const j = await r.json().catch(() => null)
const list = Array.isArray(j) ? j : (j?.data ?? j?.pengguna ?? [])
console.log('status:', r.status, 'jumlah:', Array.isArray(list) ? list.length : '?')
for (const u of (list || []).slice(0, 20)) console.log(u.id, u.email, u.username, u.role)
