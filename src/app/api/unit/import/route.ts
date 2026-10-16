import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { autoGitBackup } from '@/lib/git-backup'
import { requireActiveSession } from '@/lib/auth-server'
import { parseBrandRules, detectGaransi } from '@/lib/brand'
import { parseCsv, validateUnitRows, buildCsvTemplate, CSV_MAX_ROWS } from '@/lib/csv'

// GET /api/unit/import — unduh template CSV registrasi massal unit per toko/perorangan
// Urutan kolom mengikuti layout Master Barcode: tgl_input, toko_customer, merk,
// model_tipe, nomor_seri, status + tgl_garansi (tgl beli = awal masa garansi,
// tampil di field Status) + opsional nama_unit & nama_customer.
// tgl_input = tanggal input real dari dokumen (bila kosong, dicatat waktu impor).
// Header lama (nama_toko, tanggal, tgl_pembelian, no_seri) tetap dikenali saat impor.
export async function GET() {
  const csv = buildCsvTemplate(
    ['tgl_input', 'toko_customer', 'merk', 'model_tipe', 'nomor_seri', 'status', 'tgl_garansi', 'nama_unit', 'nama_customer'],
    [
      ['2025-07-20', 'TOK-001', 'Miyako', 'Kipas Angin 16 inch K-1601', 'SN-KPAS-2025-10001', 'STOK-TOKO', '', 'Kipas Ruang Tamu', 'Bpk. Hendra Gunawan'],
      ['2025-08-16', 'TOK-001', 'Shimizu', 'Pompa Air 125 Watt P-125', 'SN-PMPA-2025-10002', 'GARANSI', '2025-08-15', '', ''],
      ['2023-03-20', '', 'Rinnai', 'Kompor Gas 2 Tungku KG-201', 'SN-KMPR-2023-10311', 'NON-GARANSI', '15/03/2023', 'Kompor Dapur', 'Warung Makan Bu Tini'],
    ]
  )
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="template_import_unit.csv"',
    },
  })
}

// POST /api/unit/import — registrasi massal unit dari teks CSV
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

    const { acc, headerError } = validateUnitRows(headers, rows)
    if (headerError) {
      return NextResponse.json({ error: headerError }, { status: 400 })
    }

    const pendingRows = acc.filter((a) => a.status === 'pending')

    // Resolusi toko sekali jalan (cocok kode dulu, lalu nama — case-insensitive)
    const tokoKeys = [...new Set(pendingRows.map((a) => a.data!.insert.tokoKey).filter(Boolean))]
    const semuaToko = tokoKeys.length ? await db.masterToko.findMany() : []
    const byKode = new Map(semuaToko.map((t) => [t.kodeToko.toUpperCase(), t]))
    const byNama = new Map(semuaToko.map((t) => [t.namaToko.toUpperCase(), t]))
    const resolveToko = (key: string) => {
      const k = key.trim().toUpperCase()
      return byKode.get(k) ?? byNama.get(k) ?? null
    }
    for (const a of pendingRows) {
      const key = a.data!.insert.tokoKey
      if (!key) continue
      if (!resolveToko(key)) {
        a.status = 'error'
        a.message = `Toko "${key}" tidak terdaftar di Master Toko (cocokkan kode/nama)`
        a.data = undefined
      }
    }

    // Customer: cari yang ada, sisanya dibuat baru otomatis
    const custNames = [...new Set(pendingRows.filter((a) => a.data).map((a) => a.data!.insert.customerNama).filter(Boolean))]
    const custMap = new Map<string, number>()
    if (custNames.length) {
      const ada = await db.masterCustomer.findMany({ where: { nama: { in: custNames } }, select: { id: true, nama: true } })
      for (const c of ada) custMap.set(c.nama, c.id)
      const baru = custNames.filter((n) => ![...custMap.keys()].some((k) => k.toUpperCase() === n.toUpperCase()))
      // cocokkan case-insensitive dulu sebelum membuat baru
      const adaUpper = new Map(ada.map((c) => [c.nama.toUpperCase(), c.id]))
      const perluBuat: string[] = []
      for (const n of baru) {
        const hit = adaUpper.get(n.toUpperCase())
        if (hit) custMap.set(n, hit)
        else perluBuat.push(n)
      }
      if (perluBuat.length) {
        await db.masterCustomer.createMany({ data: perluBuat.map((nama) => ({ nama })) })
        const dibuat = await db.masterCustomer.findMany({ where: { nama: { in: perluBuat } }, select: { id: true, nama: true } })
        for (const c of dibuat) custMap.set(c.nama, c.id)
      }
    }
    const resolveCust = (nama: string): number | null => {
      if (!nama) return null
      if (custMap.has(nama)) return custMap.get(nama)!
      const hit = [...custMap.entries()].find(([k]) => k.toUpperCase() === nama.toUpperCase())
      return hit ? hit[1] : null
    }

    // Aturan merk & masa garansi untuk auto-deteksi status (bila kolom status kosong)
    const brandRow = await db.pengaturan.findUnique({ where: { kunci: 'brand_daftar' } })
    const brandRules = parseBrandRules(brandRow?.nilai)

    // Cek serial yang sudah ada di database (sekalian ambil merk/tgl untuk fallback auto)
    const serials = pendingRows.filter((a) => a.data).map((a) => a.data!.insert.serialNumber)
    const existing = serials.length
      ? await db.unitAsset.findMany({ where: { serialNumber: { in: serials } }, select: { serialNumber: true, merk: true, tglPembelian: true, tokoId: true } })
      : []
    const existingMap = new Map(existing.map((e) => [e.serialNumber, e]))
    const existingSet = new Set(existing.map((e) => e.serialNumber))

    const toInsert: typeof pendingRows = []
    const toUpdate: typeof pendingRows = []

    for (const a of acc) {
      if (a.status !== 'pending' || !a.data) continue
      if (existingSet.has(a.data.insert.serialNumber)) {
        if (mode === 'update') toUpdate.push(a)
        else {
          a.status = 'skip'
          a.message = `No. seri "${a.kode}" sudah terdaftar di database (mode: lewati)`
          a.data = undefined
        }
      } else {
        toInsert.push(a)
      }
    }
    const skipped = acc.filter((a) => a.status === 'skip').length

    const buildRow = (a: (typeof pendingRows)[number], isUpdate: boolean) => {
      const d = isUpdate ? a.data!.update : a.data!.insert
      const tokoId = d.tokoKey ? resolveToko(d.tokoKey)?.id ?? null : isUpdate ? undefined : null
      const customerId = (d as { customerNama?: string }).customerNama
        ? resolveCust((d as { customerNama?: string }).customerNama!)
        : isUpdate
          ? undefined
          : null
      // Status: hormati kolom CSV bila diisi; bila kosong auto-deteksi dari merk+tgl pembelian
      let statusGaransi: 'STOK_TOKO' | 'GARANSI' | 'NON_GARANSI' | undefined
      // Tgl input real dari dokumen (khusus insert → createdAt; update tak menyentuh createdAt)
      const tglInputEff: Date | null = 'tglInput' in d ? (d as { tglInput: Date | null }).tglInput : null
      if ('statusGaransi' in d && d.statusGaransi && !(d as { statusOtomatis?: boolean }).statusOtomatis) {
        statusGaransi = d.statusGaransi as 'STOK_TOKO' | 'GARANSI' | 'NON_GARANSI'
      } else {
        // Kolom status kosong: stok toko (ada toko) → STOK_TOKO, else deteksi merk+tgl
        const prev = existingMap.get(a.data!.insert.serialNumber)
        const tokoEff = d.tokoKey ? resolveToko(d.tokoKey) : null
        if (tokoEff || (!d.tokoKey && prev?.tokoId)) {
          statusGaransi = 'STOK_TOKO'
        } else {
          const merkEff = ('merk' in d && (d as { merk?: string }).merk) || a.data!.insert.merk || prev?.merk || ''
          const tglRaw = ('tglPembelian' in d ? (d as { tglPembelian?: Date | null }).tglPembelian : undefined)
          const tglEff = tglRaw !== undefined ? tglRaw : (a.data!.insert.tglPembelian ?? prev?.tglPembelian ?? null)
          statusGaransi = detectGaransi(merkEff, tglEff, brandRules) ?? (isUpdate ? undefined : 'GARANSI')
        }
      }
      return {
        serialNumber: a.data!.insert.serialNumber,
        modelUnit: d.modelUnit,
        ...(d.nama !== undefined ? { nama: d.nama } : {}),
        ...(d.merk !== undefined ? { merk: d.merk } : {}),
        ...(tokoId !== undefined ? { tokoId } : {}),
        ...(customerId !== undefined ? { customerId } : {}),
        ...(statusGaransi ? { statusGaransi } : {}),
        ...('tglPembelian' in d && (d as { tglPembelian?: Date | null }).tglPembelian !== undefined
          ? { tglPembelian: (d as { tglPembelian?: Date | null }).tglPembelian }
          : {}),
        // Tgl input real dari dokumen → createdAt (hanya saat insert; update tak menyentuhnya)
        ...(tglInputEff ? { createdAt: tglInputEff } : {}),
      }
    }

    let inserted = 0
    if (toInsert.length) {
      try {
        await db.unitAsset.createMany({ data: toInsert.map((a) => buildRow(a, false)) })
        inserted = toInsert.length
      } catch (e) {
        console.error('Unit import createMany error:', e)
        for (const a of toInsert) {
          a.status = 'error'
          a.message = 'Gagal menyimpan ke database'
          a.data = undefined
        }
      }
    }

    let updated = 0
    for (const a of toUpdate) {
      try {
        await db.unitAsset.update({ where: { serialNumber: a.data!.insert.serialNumber }, data: buildRow(a, true) })
        updated++
      } catch {
        a.status = 'error'
        a.message = `Gagal memperbarui unit "${a.kode}"`
        a.data = undefined
      }
    }

    const errors = acc.filter((a) => a.status === 'error')
    const skipRows = acc.filter((a) => a.status === 'skip')
    const failed = errors.length

    if (inserted + updated > 0) {
      await logAudit({
        aksi: 'IMPORT_UNIT_ASSET',
        entitas: 'unit_asset',
        deskripsi: `Import CSV massal unit: ${inserted} ditambahkan, ${updated} diperbarui, ${skipped} dilewati, ${failed} gagal (mode: ${mode === 'skip' ? 'lewati' : 'perbarui'})`,
        aktor,
      })
      await autoGitBackup('IMPORT', 'unit_asset', `${inserted}+${updated}`, aktor)
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
    console.error('Unit import error:', error)
    return NextResponse.json({ error: 'Gagal memproses import CSV unit' }, { status: 500 })
  }
}
