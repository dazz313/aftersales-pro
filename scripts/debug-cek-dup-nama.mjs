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
const res = await fetch('http://localhost:3000/api/toko', { headers: auth })
const list = await res.json()
const seen = new Map()
for (const t of list) {
  const key = (t.namaToko || '').trim().toLowerCase()
  if (seen.has(key)) console.log('DUP:', JSON.stringify(t.namaToko))
  seen.set(key, t.kodeToko)
}
console.log('total:', list.length, 'unik nama:', seen.size)
console.log('contoh nama dengan spasi:', list[0].namaToko)
