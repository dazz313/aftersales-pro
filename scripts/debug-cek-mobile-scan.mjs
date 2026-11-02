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

async function scan(kode) {
  const r = await fetch(`http://localhost:3000/api/mobile/scan?kode=${encodeURIComponent(kode)}`, { headers: auth })
  const j = await r.json()
  console.log(
    r.status,
    JSON.stringify(kode),
    '->',
    j.tipe ?? 'ERROR',
    j.tahap ? `tahap=${j.tahap}` : '',
    j.aksiTersedia ? `aksi=[${j.aksiTersedia.map((a) => a.aksi).join(',')}]` : '',
    j.error ? `err=${j.error}` : '',
  )
  if (j.identifikasi) console.log('   identifikasi:', JSON.stringify(j.identifikasi))
  return j
}

await scan('Toko Andika')
await scan('BC-TOK-032')
await scan('toko andika')
await scan('KODE-NGAWUR-999')

const unitRes = await fetch('http://localhost:3000/api/unit', { headers: auth })
const units = await unitRes.json()
const aktif = ['REQUEST', 'REQUEST_EMAIL', 'PROSES']
const unit =
  units.find((u) => u.serialNumber && (u.serviceRequests ?? []).some((t) => aktif.includes(t.status))) ??
  units.find((u) => u.serialNumber && (u.serviceRequests ?? []).length > 0) ??
  units.find((u) => u.serialNumber)
if (unit) {
  const hasil = await scan(unit.serialNumber)
  const tiket = (unit.serviceRequests ?? []).find((t) => aktif.includes(t.status)) ?? (unit.serviceRequests ?? [])[0]
  if (tiket) await scan(tiket.noTiket)
  if (hasil.tipe === 'UNIT_GANDA') console.log('  (unit ganda, kandidat:', hasil.kandidat.length, ')')
}

const tanpaToken = await fetch('http://localhost:3000/api/mobile/scan?kode=Toko%20Andika')
console.log('tanpa token ->', tanpaToken.status, (await tanpaToken.json()).error)

const svcRes = await fetch('http://localhost:3000/api/service', { headers: auth })
const tiketList = await svcRes.json()
const proses = tiketList.find((t) => t.status === 'PROSES')
if (proses) {
  console.log('--- contoh tiket PROSES:', proses.noTiket, '| serial:', proses.unitAsset?.serialNumber)
  await scan(proses.unitAsset?.serialNumber ?? proses.noTiket)
}


