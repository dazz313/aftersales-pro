import fs from 'node:fs'
import crypto from 'node:crypto'
import { PrismaClient } from '@prisma/client'

/**
 * Uji penjagaan FINISH: tiket PROSES yang masih punya part ORDER_PRODUSEN
 * harus DITOLAK (409) — supaya tidak "terpaksa selesai" saat part gelombang
 * pertama datang padahal masih ada pesanan susulan.
 *
 * Jalankan: node scripts/debug-cek-finish-part.mjs
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

const db = new PrismaClient()

let kandidat = await db.serviceRequest.findFirst({
  where: {
    status: 'PROSES',
    parts: { some: { qty: { gt: 0 }, statusPart: 'ORDER_PRODUSEN' } },
  },
  include: { parts: { include: { sparepart: true } } },
  orderBy: { id: 'desc' },
})

// Tidak ada tiket asli yang bisa dipakai → buat tiket uji sementara, lalu hapus.
let sementara = false
if (!kandidat) {
  const unit = await db.unitAsset.findFirst({ orderBy: { id: 'asc' } })
  const part = await db.masterSparepart.findFirst({ orderBy: { id: 'asc' } })
  if (!unit || !part) {
    console.log('Tidak ada unit/sparepart untuk membuat tiket uji.')
    await db.$disconnect()
    process.exit(0)
  }
  const noTiket = `DEBUG-PART-${Date.now()}`
  kandidat = await db.serviceRequest.create({
    data: {
      noTiket,
      unitAssetId: unit.id,
      status: 'PROSES',
      lokasiUnit: 'WORKSHOP',
      penanganan: 'TARIK_WORKSHOP',
      deskripsiKerusakan: 'Uji penjagaan FINISH (tiket sementara)',
      parts: { create: [{ sparepartId: part.id, qty: 1, statusPart: 'ORDER_PRODUSEN', statusKonfirmasi: 'MENUNGGU' }] },
    },
    include: { parts: { include: { sparepart: true } } },
  })
  sementara = true
  console.log(`(tidak ada tiket asli — dibuat tiket uji sementara ${noTiket})`)
}

const tunggu = kandidat.parts.filter((x) => x.qty > 0 && x.statusPart !== 'READY')
console.log(`Tiket uji: ${kandidat.noTiket} (id ${kandidat.id})`)
for (const t of tunggu) console.log(`  - ${t.sparepart?.kodePart ?? t.kodePartCache ?? '?'} ×${t.qty}`)

const r = await fetch(`http://localhost:3000/api/service/${kandidat.id}`, {
  method: 'PATCH',
  headers: auth,
  body: JSON.stringify({ aksi: 'FINISH', aktor: 'debug' }),
})
const j = await r.json().catch(() => null)
console.log(`\nFINISH -> ${r.status}`)
console.log('pesan:', j?.error ?? '(tidak ada error)')

const sesudah = await db.serviceRequest.findUnique({ where: { id: kandidat.id }, select: { status: true, tglFinish: true } })
console.log('status tiket sesudah uji:', sesudah?.status, '| tglFinish:', sesudah?.tglFinish ?? null)

if (sementara) {
  await db.serviceRequestPart.deleteMany({ where: { serviceRequestId: kandidat.id } })
  await db.serviceRequest.delete({ where: { id: kandidat.id } })
  console.log('tiket uji sementara dihapus kembali.')
}

const sisa = await db.serviceRequest.count({ where: { noTiket: { startsWith: 'DEBUG-PART-' } } })
console.log('sisa tiket uji di database:', sisa)

await db.$disconnect()
