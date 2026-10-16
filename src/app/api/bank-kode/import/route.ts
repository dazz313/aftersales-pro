import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { requireActiveSession } from '@/lib/auth-server'
import { parseCsv, validateBankKodeRows, buildCsvTemplate, CSV_MAX_ROWS } from '@/lib/csv'

// GET /api/bank-kode/import — unduh template CSV kode produsen
// Kolom: kode (wajib), nama, brand, model, produsen, catatan (opsional).
export async function GET() {
  const csv = buildCsvTemplate(
    ['kode', 'nama', 'brand', 'model', 'produsen', 'catatan'],
    [
      ['PRT-KMP-075X', 'Kompresor AC 3/4 PK revisi produsen', 'Samsung', 'AC Split 1 PK', 'PT Sinar Elektronik', 'Rilis katalog Q3'],
      ['MX-88X-KLIMA', '', 'Daikin', 'AC Cassette 2 PK', 'PT Sinar Elektronik', 'Kode baru, nama menyusul'],
      ['PCB-INV-220-R2', 'PCB Mainboard Inverter R2', '', '', 'CV Sparepart Jaya', ''],
    ]
  )
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="template_import_bank_kode.csv"',
    },
  })
}

// POST /api/bank-kode/import — import massal kode baru rilis produsen
// body: { csvText: string, mode: 'skip' | 'update', aktor?: string }
export async function POST(request: Request) {
  try {
    const { denied } = await requireActiveSession(request)
    if (denied) return denied
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

    const { acc, headerError } = validateBankKodeRows(headers, rows)
    if (headerError) {
      return NextResponse.json({ error: headerError }, { status: 400 })
    }

    const pendingRows = acc.filter((a) => a.status === 'pending')
    const codes = pendingRows.map((a) => a.kode)
    const existing = codes.length
      ? await db.bankKode.findMany({ where: { kode: { in: codes } }, select: { kode: true } })
      : []
    const existingSet = new Set(existing.map((e) => e.kode))

    let inserted = 0
    let updated = 0
    for (const a of acc) {
      if (a.status !== 'pending' || !a.data) continue
      if (existingSet.has(a.kode)) {
        if (mode === 'update') {
          const patch = a.data.update
          if (Object.keys(patch).length > 0) {
            await db.bankKode.update({ where: { kode: a.kode }, data: patch })
            updated++
          } else {
            a.status = 'skip'
            a.message = `Kode "${a.kode}" sudah terdaftar dan baris CSV kosong (tidak ada yang diperbarui)`
            a.data = undefined
          }
        } else {
          a.status = 'skip'
          a.message = `Kode "${a.kode}" sudah terdaftar di Bank Kode (mode: lewati)`
          a.data = undefined
        }
      } else {
        await db.bankKode.create({ data: { ...a.data.insert, sumber: 'CSV' } })
        inserted++
      }
    }

    const errors = acc.filter((a) => a.status === 'error')
    const skipRows = acc.filter((a) => a.status === 'skip')

    if (inserted + updated > 0) {
      await logAudit({
        aksi: 'IMPORT_BANK_KODE',
        entitas: 'bank_kode',
        deskripsi: `Import CSV kode produsen: ${inserted} ditambahkan, ${updated} diperbarui, ${skipRows.length} dilewati, ${errors.length} gagal (mode: ${mode === 'skip' ? 'lewati' : 'perbarui'})`,
        aktor,
      })
    }

    const toDetail = ({ row, kode, nama, message }: { row: number; kode: string; nama: string; message?: string }) => ({ row, kode, nama, message: message ?? '' })

    return NextResponse.json({
      total: rows.length,
      inserted,
      updated,
      skipped: skipRows.length,
      failed: errors.length,
      errors: errors.map(toDetail),
      skippedDetails: skipRows.map(toDetail),
    })
  } catch (error) {
    console.error('BankKode import error:', error)
    return NextResponse.json({ error: 'Gagal memproses import CSV bank kode' }, { status: 500 })
  }
}
