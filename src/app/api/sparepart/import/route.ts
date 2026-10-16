import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { backupSparepartToGit } from '@/lib/git-backup'
import { requireActiveSession } from '@/lib/auth-server'
import { parseCsv, validateSparepartRows, buildCsvTemplate, CSV_MAX_ROWS } from '@/lib/csv'
import { catatBankKode } from '@/lib/bank-kode'

// GET /api/sparepart/import — unduh template CSV import sparepart
export async function GET() {
  const csv = buildCsvTemplate(
    ['kode_part', 'nama_part', 'brand_kompatibel', 'supplier', 'stok_jual', 'stok_garansi', 'stok_inventory', 'reorder_limit', 'harga_klaim'],
    [
      ['PRT-DNM-075', 'Dinamo Kipas Angin 16 inch', 'Miyako', 'PT Sinar Elektronik', '15', '5', '', '5', '185000'],
      ['PRT-SLP-220', 'Seal Pompa Air 125 Watt', 'Shimizu', 'PT Sinar Elektronik', '12', '3', '', '4', '120000'],
      ['PRT-TNG-101', 'Tungku Kompor Gas 2 Tungku', 'Rinnai', 'CV Sparepart Jaya', '6', '2', '', '3', '95000'],
    ]
  )
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="template_import_sparepart.csv"',
    },
  })
}

// POST /api/sparepart/import — import massal sparepart dari teks CSV
// body: { csvText: string, mode: 'skip' | 'update', aktor?: string }
export async function POST(request: Request) {
  try {
    const { session, denied } = await requireActiveSession(request)
    if (denied) return denied
    void session
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

    const { acc, headerError } = validateSparepartRows(headers, rows)
    if (headerError) {
      return NextResponse.json({ error: headerError }, { status: 400 })
    }

    // Cek kode yang sudah ada di database
    const pendingRows = acc.filter((a) => a.status === 'pending')
    const codes = pendingRows.map((a) => a.kode)
    const existing = codes.length
      ? await db.masterSparepart.findMany({ where: { kodePart: { in: codes } }, select: { kodePart: true } })
      : []
    const existingSet = new Set(existing.map((e) => e.kodePart))

    const toInsert: typeof pendingRows = []
    const toUpdate: typeof pendingRows = []

    for (const a of acc) {
      if (a.status !== 'pending' || !a.data) continue
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
        await db.masterSparepart.createMany({ data: toInsert.map((a) => a.data!.insert) })
        inserted = toInsert.length
      } catch (e) {
        console.error('Sparepart import createMany error:', e)
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
        await db.masterSparepart.update({ where: { kodePart: a.kode }, data: a.data!.update })
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
        aksi: 'IMPORT_MASTER_SPAREPART',
        entitas: 'master_sparepart',
        deskripsi: `Import CSV massal sparepart: ${inserted} ditambahkan, ${updated} diperbarui, ${skipped} dilewati, ${failed} gagal (mode: ${mode === 'skip' ? 'lewati' : 'perbarui'})`,
        aktor,
      })
      await backupSparepartToGit('IMPORT', `${inserted}+${updated}`, aktor)
      // Setiap kode yang masuk ikut tercatat di Bank Kode
      for (const a of [...toInsert, ...toUpdate]) {
        const d = a.data?.insert
        if (!d) continue
        await catatBankKode({
          kode: d.kodePart,
          namaPart: d.namaPart,
          brandKompatibel: d.brandKompatibel,
          produsen: d.supplier,
          sumber: 'KATALOG',
        })
      }
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
    console.error('Sparepart import error:', error)
    return NextResponse.json({ error: 'Gagal memproses import CSV sparepart' }, { status: 500 })
  }
}
