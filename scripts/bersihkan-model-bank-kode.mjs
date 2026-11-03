import fs from 'node:fs'
import { PrismaClient } from '@prisma/client'

/**
 * Bersihkan polusi modelTipe: sinkron lama sempat menyalin model unit tiket
 * ke 138 baris. Skrip ini mengembalikan kolom modelTipe ke kondisi backup
 * (hanya nilai eksplisit CSV/manual yang dipertahankan).
 *
 * Jalankan: node scripts/bersihkan-model-bank-kode.mjs [--terapkan]
 * Tanpa --terapkan hanya menampilkan ringkasan (dry-run).
 */
const backupPath = 'db/backups/custom-2026-11-03-171530.db'
const backupUrl = `file:${process.cwd().replace(/\\/g, '/')}/${backupPath}`
const terapkan = process.argv.includes('--terapkan')

if (!fs.existsSync(backupPath)) {
  console.error('Backup tidak ditemukan:', backupPath)
  process.exit(1)
}

const db = new PrismaClient()
const backup = new PrismaClient({ datasources: { db: { url: backupUrl } } })

try {
  const [sekarang, asli] = await Promise.all([
    db.bankKode.findMany({ select: { id: true, kode: true, namaPart: true, modelTipe: true } }),
    backup.bankKode.findMany({ select: { kode: true, modelTipe: true } }),
  ])
  const petaAsli = new Map(asli.map((b) => [b.kode, String(b.modelTipe ?? '').trim()]))

  let dikosongkan = 0
  let dipulihkan = 0
  let tetap = 0
  const contoh = []
  for (const b of sekarang) {
    const target = petaAsli.get(b.kode) ?? ''
    const kini = String(b.modelTipe ?? '').trim()
    if (kini === target) {
      if (kini) tetap++
      continue
    }
    if (!target) dikosongkan++
    else dipulihkan++
    if (contoh.length < 12) contoh.push(`${b.kode} | ${b.namaPart} | "${kini}" -> "${target}"`)
    if (terapkan) {
      await db.bankKode.update({ where: { id: b.id }, data: { modelTipe: target } })
    }
  }

  const eksplisit = [...petaAsli.entries()].filter(([, v]) => v)
  console.log(`Mode: ${terapkan ? 'TERAPKAN' : 'dry-run (tambahkan --terapkan)'}`)
  console.log(`Baris diperiksa      : ${sekarang.length}`)
  console.log(`Model eksplisit asli : ${eksplisit.length}`)
  console.log(`Model dikosongkan    : ${dikosongkan}`)
  console.log(`Model dipulihkan     : ${dipulihkan}`)
  console.log(`Sudah sesuai        : ${tetap}`)
  console.log('\nContoh perubahan:')
  for (const c of contoh) console.log('  ' + c)

  const sisa = await db.bankKode.count({ where: { modelTipe: { not: '' } } })
  console.log(`\nBaris dengan modelTipe terisi sekarang: ${sisa}`)
} finally {
  await db.$disconnect()
  await backup.$disconnect()
}
