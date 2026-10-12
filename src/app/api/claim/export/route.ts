import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import * as XLSX from 'xlsx'

/**
 * API Claim Export Engine (Modul 4.2 PRD)
 * Ekspor batch data klaim ke format .xlsx sesuai templat standar produsen.
 * GET /api/claim/export?status=DRAFT|SUBMITTED|PAID (default: DRAFT+SUBMITTED)
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const statusFilter = searchParams.get('status') // DRAFT | SUBMITTED | PAID | ALL

    const whereClause =
      statusFilter && statusFilter !== 'ALL'
        ? { statusKlaimProdusen: statusFilter }
        : { statusKlaimProdusen: { in: ['DRAFT', 'SUBMITTED'] } }

    const tickets = await db.serviceRequest.findMany({
      where: { status: 'FINISH', ...whereClause },
      include: {
        unitAsset: { include: { toko: true } },
        parts: { include: { sparepart: true } },
      },
      orderBy: { tglFinish: 'asc' },
    })

    // ============ Sheet 1: Rekap Klaim (templat standar produsen) ============
    const rekapRows: (string | number)[][] = tickets.map((t, idx) => {
      const partValue = t.parts.reduce((a, p) => a + (p.sparepart?.hargaKlaim ?? 0) * p.qty, 0)
      return [
        idx + 1,
        t.noTiket,
        t.noSttb ?? '-',
        t.tglFinish ? new Date(t.tglFinish).toLocaleDateString('id-ID') : '-',
        t.unitAsset.toko?.kodeToko ?? '-',
        t.unitAsset.toko?.namaToko ?? '-',
        t.unitAsset.serialNumber,
        t.unitAsset.modelUnit,
        t.unitAsset.statusGaransi.replace('_', '-'),
        t.parts.map((p) => `${p.sparepart.kodePart} x${p.qty}`).join(', '),
        t.parts.reduce((a, p) => a + p.qty, 0),
        t.biayaJasa,
        partValue,
        t.biayaJasa + partValue,
        t.statusKlaimProdusen,
      ]
    })

    const totalKlaim = rekapRows.reduce((acc, r) => acc + Number(r[12] ?? 0), 0)

    const wsRekap = XLSX.utils.aoa_to_sheet([
      ['REKAP KLAIM SERVICE - SURAT TANDA TERIMA BARANG (STTB)'],
      ['Digenerate otomatis oleh Sistem After-Sales Automation'],
      [`Tanggal Export: ${new Date().toLocaleString('id-ID')}`],
      [`Filter Status Klaim: ${statusFilter ?? 'DRAFT + SUBMITTED'}`],
      [],
      [
        'No',
        'No. Tiket',
        'No. STTB',
        'Tgl Selesai',
        'Kode Toko',
        'Nama Toko',
        'Serial Number',
        'Model Unit',
        'Garansi',
        'Sparepart Diganti',
        'Qty Part',
        'Biaya Jasa (Rp)',
        'Nilai Part (Rp)',
        'Total Klaim (Rp)',
        'Status Klaim',
      ],
      ...rekapRows,
      [],
      ['', '', '', '', '', '', '', '', '', '', '', 'TOTAL:', '', totalKlaim, ''],
    ])
    wsRekap['!cols'] = [
      { wch: 4 }, { wch: 18 }, { wch: 20 }, { wch: 12 }, { wch: 10 }, { wch: 28 },
      { wch: 22 }, { wch: 30 }, { wch: 13 }, { wch: 32 }, { wch: 9 }, { wch: 14 },
      { wch: 14 }, { wch: 15 }, { wch: 13 },
    ]

    // ============ Sheet 2: Rincian Sparepart ============
    const detailRows: (string | number)[][] = []
    let no = 1
    for (const t of tickets) {
      for (const p of t.parts) {
        detailRows.push([
          no++,
          t.noTiket,
          p.sparepart.kodePart,
          p.sparepart.namaPart,
          p.qty,
          p.sparepart.hargaKlaim,
          p.qty * p.sparepart.hargaKlaim,
          p.statusPart,
        ])
      }
    }
    const wsDetail = XLSX.utils.aoa_to_sheet([
      ['RINCIAN SPAREPART KLAIM INVENTORY'],
      [],
      ['No', 'No. Tiket', 'Kode Part', 'Nama Sparepart', 'Qty', 'Harga Klaim Unit (Rp)', 'Subtotal (Rp)', 'Status Part'],
      ...detailRows,
    ])
    wsDetail['!cols'] = [
      { wch: 4 }, { wch: 18 }, { wch: 14 }, { wch: 34 }, { wch: 6 }, { wch: 20 }, { wch: 15 }, { wch: 18 },
    ]

    // ============ Sheet 3: Ringkasan ============
    const byStatus: Record<string, { count: number; value: number }> = {}
    for (const t of tickets) {
      const partValue = t.parts.reduce((a, p) => a + (p.sparepart?.hargaKlaim ?? 0) * p.qty, 0)
      const val = t.biayaJasa + partValue
      byStatus[t.statusKlaimProdusen] = {
        count: (byStatus[t.statusKlaimProdusen]?.count ?? 0) + 1,
        value: (byStatus[t.statusKlaimProdusen]?.value ?? 0) + val,
      }
    }
    const wsSummary = XLSX.utils.aoa_to_sheet([
      ['RINGKASAN KLAIM BULANAN'],
      [],
      ['Status Klaim', 'Jumlah Tiket', 'Total Nilai (Rp)'],
      ...Object.entries(byStatus).map(([s, v]) => [s, v.count, v.value]),
      [],
      ['Diperuntukkan bagi:', 'PT. Sinar Elektronik Mandiri (Produsen)'],
      ['Diajukan oleh:', 'CV. Teknik Jaya Abadi Workshop'],
    ])
    wsSummary['!cols'] = [{ wch: 18 }, { wch: 14 }, { wch: 20 }]

    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, wsRekap, 'Rekap Klaim')
    XLSX.utils.book_append_sheet(wb, wsDetail, 'Rincian Sparepart')
    XLSX.utils.book_append_sheet(wb, wsSummary, 'Ringkasan')

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
    const filename = `Rekap-Klaim-${new Date().toISOString().slice(0, 10)}.xlsx`

    await logAudit({
      aksi: 'EXPORT_CLAIM_EXCEL',
      entitas: 'service_request',
      deskripsi: `Export Excel rekap klaim (${tickets.length} tiket, total Rp ${totalKlaim.toLocaleString('id-ID')})`,
      aktor: 'ADMIN_WORKSHOP',
    })

    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    console.error('Claim export error:', error)
    return NextResponse.json({ error: 'Gagal export Excel klaim' }, { status: 500 })
  }
}
