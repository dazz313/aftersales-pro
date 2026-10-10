import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { parseCsv, validateTokoRows, buildCsvTemplate, CSV_MAX_ROWS } from '@/lib/csv'

// GET /api/toko/import — unduh template CSV import toko
export async function GET() {
  const csv = buildCsvTemplate(
    ['kode_toko', 'nama_toko', 'alamat', 'kontak', 'frekuensi_visit', 'barcode_toko'],
    [
      ['TOK-101', 'Toko Elektronik Makmur', 'Jl. Sudirman No. 12, Jakarta Pusat', '021-5551234', '14', 'BC-TOK-101'],
      ['TOK-102', 'CV Sumber Rejeki Abadi', 'Jl. Merdeka No. 45, Bandung', '081234567890', '7', 'BC-TOK-102'],
      ['TOK-103', 'Toko Sinar Jaya', 'Jl. Ahmad Yani No. 8, Surabaya', 'sinarjaya@tokoku.id', '14', ''],
    ]
  )
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="template_import_toko.csv"',
    },
  })
}

// POST /api/toko/import — import massal toko dari teks CSV
// body: { csvText: string, mode: 'skip' | 'update', aktor?: string }
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const csvText = typeof body.csvText === 'string' ? body.csvText : ''
    const mode: 'skip' | 'update' = body.mode === 'update' ? 'update' : 'skip'
    const aktor: string = body.aktor || 'SYSTEM'

    if (!csvText.trim()) {
      return NextResponse.json({ error: 'Data CSV masih kosong' }, { status: 400 })
    }

    const { headers, rows } = parseCsv(csvText)
    if (headers.length === 0) {
      return NextResponse.json({ error: 'Header CSV tidak terbaca — pastikan file memiliki baris header' }, { status: 400 })
    }
    if (rows.length === 0) {
      return NextResponse.json({ error: 'Tidak ada baris data di dalam CSV' }, { status: 400 })
    }
    if (rows.length > CSV_MAX_ROWS) {
      return NextResponse.json({ error: `Maksimal ${CSV_MAX_ROWS} baris per import (ditemukan ${rows.length})` }, { status: 400 })
    }

    const { acc, headerError } = validateTokoRows(headers, rows)
    if (headerError) {
      return NextResponse.json({ error: headerError }, { status: 400 })
    }

    // Cek kode & barcode yang sudah ada di database
    const pendingRows = acc.filter((a) => a.status === 'pending')
    const codes = pendingRows.map((a) => a.kode)
    const barcodes = [...new Set(pendingRows.map((a) => a.data!.insert.barcodeToko))]
    const [existing, existingBarcodeRows] = await Promise.all([
      codes.length
        ? db.masterToko.findMany({ where: { kodeToko: { in: codes } }, select: { kodeToko: true } })
        : Promise.resolve([] as { kodeToko: string }[]),
      barcodes.length
        ? db.masterToko.findMany({ where: { barcodeToko: { in: barcodes } }, select: { barcodeToko: true, kodeToko: true } })
        : Promise.resolve([] as { barcodeToko: string; kodeToko: string }[]),
    ])
    const existingSet = new Set(existing.map((e) => e.kodeToko))
    const barcodeOwner = new Map(existingBarcodeRows.map((b) => [b.barcodeToko, b.kodeToko]))

    const toInsert: typeof pendingRows = []
    const toUpdate: typeof pendingRows = []

    for (const a of acc) {
      if (a.status !== 'pending' || !a.data) continue
      const owner = barcodeOwner.get(a.data.insert.barcodeToko)
      if (owner && owner !== a.kode) {
        a.status = 'error'
        a.message = `Barcode "${a.data.insert.barcodeToko}" sudah dipakai toko ${owner} — gunakan barcode lain`
        a.data = undefined
        continue
      }
      if (existingSet.has(a.kode)) {
        if (mode === 'update') toUpdate.push(a)
        else {
          a.status = 'skip'
          a.message = `Kode "${a.kode}" sudah terdaftar di database (mode: lewati)`
          a.data = undefined
        }
      } else {
        toInsert.push(a)
      }
    }
    const skipped = acc.filter((a) => a.status === 'skip').length

    // Eksekusi insert (batch)
    let inserted = 0
    if (toInsert.length) {
      try {
        await db.masterToko.createMany({ data: toInsert.map((a) => a.data!.insert) })
        inserted = toInsert.length
      } catch (e) {
        console.error('Toko import createMany error:', e)
        for (const a of toInsert) {
          a.status = 'error'
          a.message = 'Gagal menyimpan ke database'
          a.data = undefined
        }
      }
    }

    // Eksekusi update (per baris)
    let updated = 0
    for (const a of toUpdate) {
      try {
        await db.masterToko.update({ where: { kodeToko: a.kode }, data: a.data!.update })
        updated++
      } catch {
        a.status = 'error'
        a.message = `Gagal memperbarui data untuk kode "${a.kode}"`
        a.data = undefined
      }
    }

    const errors = acc.filter((a) => a.status === 'error')
    const skipRows = acc.filter((a) => a.status === 'skip')
    const failed = errors.length

    if (inserted + updated > 0) {
      await logAudit({
        aksi: 'IMPORT_MASTER_TOKO',
        entitas: 'master_toko',
        deskripsi: `Import CSV massal toko: ${inserted} ditambahkan, ${updated} diperbarui, ${skipped} dilewati, ${failed} gagal (mode: ${mode === 'skip' ? 'lewati' : 'perbarui'})`,
        aktor,
      })
    }

    const toDetail = ({ row, kode, nama, message }: { row: number; kode: string; nama: string; message?: string }) => ({ row, kode, nama, message: message ?? '' })

    return NextResponse.json({
      total: rows.length,
      inserted,
      updated,
      skipped,
      failed,
      errors: errors.map(toDetail),
      skippedDetails: skipRows.map(toDetail),
    })
  } catch (error) {
    console.error('Toko import error:', error)
    return NextResponse.json({ error: 'Gagal memproses import CSV toko' }, { status: 500 })
  }
}
