// Uji GET /api/ai/models terhadap server produksi (token sesi dirakit dari AUTH_SECRET).
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

const t0 = Date.now()
const r = await fetch('http://localhost:3000/api/ai/models', { headers: { Authorization: `Bearer ${h}.${p}.${s}` } })
const j = await r.json().catch(() => null)
console.log(`status=${r.status} ${(Date.now() - t0) / 1000}`.replace(' ', 's'), '| ok:', j?.ok, '| jumlah model:', j?.models?.length)
if (j?.models?.length) console.log('contoh:', j.models.slice(0, 12).join(', '))
if (j?.error) console.log('error:', j.error)
