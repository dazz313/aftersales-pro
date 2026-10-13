import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { requireActiveSession } from '@/lib/auth-server'
import * as XLSX from 'xlsx'
import QRCode from 'qrcode'

/**
 * Laporan kolektif UNIT PENDING — unit yang >24 jam belum mendapat
 * kode + nama sparepart (REQUEST tanpa part READY).
 * GET /api/pending/export?format=pdf|xlsx — untuk diemailkan / dikirim
 * ke grup WA-Telegram sebagai pengingat berkala.
 */

interface PendingRow {
  noTiket: string
  tglLapor: string
  serial: string
  model: string
  merk: string
  toko: string
  umur: string
  statusPart: string
}

function umurText(jam: number): string {
  if (jam < 24) return `${jam} jam`
  const hari = Math.floor(jam / 24)
  const sisa = jam % 24
  return sisa === 0 ? `${hari} hari` : `${hari} hari ${sisa} jam`
}

export async function GET(request: Request) {
  try {
    const { session, denied } = await requireActiveSession(request)
    if (denied) return denied
    void session
    const format = new URL(request.url).searchParams.get('format') === 'xlsx' ? 'xlsx' : 'pdf'
    const now = Date.now()
    const BATAS_JAM = 24

    const tickets = await db.serviceRequest.findMany({
      where: { status: 'REQUEST' },
      include: {
        unitAsset: { include: { toko: { select: { kodeToko: true, namaToko: true } } } },
        parts: { select: { id: true, statusPart: true } },
      },
      orderBy: { createdAt: 'asc' },
    })
    const pending = tickets.filter(
      (t) =>
        !t.parts.some((p) => p.statusPart === 'READY') &&
        now - new Date(t.createdAt).getTime() > BATAS_JAM * 3600 * 1000
    )
    const rows: PendingRow[] = pending.map((t) => {
      const jam = Math.floor((now - new Date(t.createdAt).getTime()) / 3600000)
      return {
        noTiket: t.noTiket,
        tglLapor: new Date(t.createdAt).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }),
        serial: t.unitAsset.serialNumber,
        model: t.unitAsset.modelUnit,
        merk: t.unitAsset.merk || '-',
        toko: t.unitAsset.toko ? `${t.unitAsset.toko.namaToko} (${t.unitAsset.toko.kodeToko})` : '-',
        umur: umurText(jam),
        statusPart: t.parts.length === 0 ? 'BELUM INPUT PART' : 'MENUNGGU READY',
      }
    })

    const today = new Date()
    const tglCetak = today.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })
    const stamp = today.toISOString().slice(0, 10)
    const filenameBase = `Unit-Pending-${stamp}`
    const qrPayload = `PENDING:${rows.length}|TGL:${stamp}`
    const qrDataUrl = await QRCode.toDataURL(qrPayload, { width: 200, margin: 1 })

    await logAudit({
      aksi: 'CETAK_LAPORAN_PENDING',
      entitas: 'laporan_pending',
      deskripsi: `Cetak laporan unit pending (${format.toUpperCase()}): ${rows.length} unit >24 jam tanpa kode+nama part`,
      aktor: session?.nama ?? 'SYSTEM',
    })

    if (format === 'xlsx') {
      const ws = XLSX.utils.aoa_to_sheet([
        ['LAPORAN UNIT PENDING — BELUM ADA KODE & NAMA SPAREPART (>24 JAM)'],
        [`Tanggal cetak: ${tglCetak}`, '', '', '', '', '', `Total: ${rows.length} unit`],
        [],
        ['No', 'No. Tiket', 'Tgl Lapor', 'Serial Number', 'Model Unit', 'Merk', 'Toko Asal', 'Umur Pending', 'Status Part'],
        ...rows.map((r, i) => [i + 1, r.noTiket, r.tglLapor, r.serial, r.model, r.merk, r.toko, r.umur, r.statusPart]),
      ])
      ws['!cols'] = [
        { wch: 4 }, { wch: 18 }, { wch: 13 }, { wch: 22 }, { wch: 30 }, { wch: 14 },
        { wch: 36 }, { wch: 16 }, { wch: 20 },
      ]
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'Unit Pending')
      const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
      return new NextResponse(new Uint8Array(buf), {
        status: 200,
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="${filenameBase}.xlsx"`,
          'Cache-Control': 'no-store',
        },
      })
    }

    // ============ PDF (A4 landscape + QR) ============
    const jsPDFModule = await import('jspdf')
    const jsPDF = jsPDFModule.jsPDF
    const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' })
    const pageW = doc.internal.pageSize.getWidth()
    const pageH = doc.internal.pageSize.getHeight()
    const M = 12
    let y = 0

    const drawPageHeader = () => {
      doc.setFillColor(180, 83, 9) // amber-700 (peringatan)
      doc.rect(0, 0, pageW, 24, 'F')
      doc.setTextColor(255, 255, 255)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(15)
      doc.text('LAPORAN UNIT PENDING', M, 10)
      doc.setFontSize(9)
      doc.setFont('helvetica', 'normal')
      doc.text('Unit >24 jam belum mendapat kode & nama sparepart', M, 16)
      doc.setTextColor(30, 41, 59)
      y = 32
    }
    drawPageHeader()

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(12)
    doc.text(`Total : ${rows.length} unit`, M, y)
    doc.addImage(qrDataUrl, 'PNG', pageW - M - 24, y - 7, 24, 24)
    doc.setFontSize(9)
    doc.setFont('helvetica', 'normal')
    y += 6
    doc.text(`Tanggal cetak : ${tglCetak}`, M, y)
    y += 9

    const cols = [
      { title: 'No', x: M, w: 10 },
      { title: 'No. Tiket', x: M + 10, w: 30 },
      { title: 'Tgl Lapor', x: M + 40, w: 24 },
      { title: 'Serial Number', x: M + 64, w: 36 },
      { title: 'Model Unit', x: M + 100, w: 44 },
      { title: 'Merk', x: M + 144, w: 24 },
      { title: 'Toko Asal', x: M + 168, w: 52 },
      { title: 'Umur Pending', x: M + 220, w: 26 },
      { title: 'Status Part', x: M + 246, w: 27 },
    ]
    const tableRight = M + 273

    const drawTableHeader = () => {
      doc.setFillColor(226, 232, 240)
      doc.rect(M, y - 4.5, tableRight - M, 7, 'F')
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(8)
      for (const c of cols) doc.text(c.title, c.x + 1.5, y)
      y += 7
      doc.setFont('helvetica', 'normal')
    }
    drawTableHeader()

    const wrap2 = (text: string, maxW: number): string[] => {
      const lines = doc.splitTextToSize(text, maxW) as string[]
      return lines.slice(0, 2)
    }

    doc.setFontSize(8)
    let no = 1
    for (const r of rows) {
      const cToko = wrap2(r.toko, cols[6].w - 2)
      const cModel = wrap2(r.model, cols[4].w - 2)
      const rowH = Math.max(cToko.length, cModel.length) > 1 ? 11 : 6
      if (y + rowH > pageH - 30) {
        doc.addPage()
        drawPageHeader()
        y += 2
        drawTableHeader()
        doc.setFontSize(8)
      }
      if (no % 2 === 0) {
        doc.setFillColor(255, 251, 235)
        doc.rect(M, y - 4, tableRight - M, rowH - 1, 'F')
      }
      const yy = (i: number) => y + i * 4.5
      doc.text(String(no++), cols[0].x + 1.5, y)
      doc.text(r.noTiket, cols[1].x + 1.5, y)
      doc.text(r.tglLapor, cols[2].x + 1.5, y)
      doc.text(r.serial, cols[3].x + 1.5, y)
      cModel.forEach((ln, i) => doc.text(ln, cols[4].x + 1.5, yy(i)))
      doc.text(r.merk, cols[5].x + 1.5, y)
      cToko.forEach((ln, i) => doc.text(ln, cols[6].x + 1.5, yy(i)))
      doc.text(r.umur, cols[7].x + 1.5, y)
      doc.text(r.statusPart, cols[8].x + 1.5, y)
      y += rowH
    }
    if (rows.length === 0) {
      doc.setFontSize(10)
      doc.setTextColor(100, 116, 139)
      doc.text('Tidak ada unit pending — semua tiket sudah berproses.', M, y + 4)
      doc.setTextColor(30, 41, 59)
    }

    const nPages = doc.getNumberOfPages()
    for (let i = 1; i <= nPages; i++) {
      doc.setPage(i)
      doc.setFontSize(7)
      doc.setTextColor(130, 130, 130)
      doc.text(`Unit-Pending-${stamp} · Digenerate otomatis oleh Sistem After-Sales`, M, pageH - 5)
      doc.text(`Halaman ${i} dari ${nPages}`, pageW - M, pageH - 5, { align: 'right' })
    }

    const pdfBytes = doc.output('arraybuffer')
    return new NextResponse(pdfBytes as ArrayBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filenameBase}.pdf"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    console.error('Pending export error:', error)
    return NextResponse.json({ error: 'Gagal membuat laporan pending' }, { status: 500 })
  }
}
