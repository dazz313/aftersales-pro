import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import QRCode from 'qrcode'

/**
 * API STTB PDF Generator (Modul 2.2 PRD)
 * Surat Tanda Terima Barang (STTB) otomatis dengan QR Code unik.
 * GET /api/sttb/[noTiket] → PDF binary (application/pdf)
 */
export async function GET(_request: Request, { params }: { params: Promise<{ noTiket: string }> }) {
  try {
    const { noTiket } = await params
    const ticket = await db.serviceRequest.findUnique({
      where: { noTiket: decodeURIComponent(noTiket) },
      include: {
        unitAsset: {
          include: {
            toko: true,
            customer: true,
          },
        },
        parts: { include: { sparepart: true } },
      },
    })
    if (!ticket) {
      return NextResponse.json({ error: 'Tiket tidak ditemukan' }, { status: 404 })
    }
    if (!ticket.noSttb) {
      return NextResponse.json(
        { error: 'STTB belum diterbitkan. Mulai proses tiket terlebih dahulu.' },
        { status: 409 }
      )
    }

    const [settings, jsPDFModule] = await Promise.all([
      db.pengaturan.findMany(),
      import('jspdf'),
    ])
    const jsPDF = jsPDFModule.jsPDF
    const settingsMap: Record<string, string> = {}
    for (const s of settings) settingsMap[s.kunci] = s.nilai

    // QR Code berisi data verifikasi STTB
    const qrPayload = `STTB:${ticket.noSttb}|TIKET:${ticket.noTiket}|SN:${ticket.unitAsset.serialNumber}|TGL:${new Date().toISOString().slice(0, 10)}`
    const qrDataUrl = await QRCode.toDataURL(qrPayload, { width: 200, margin: 1 })

    const doc = new jsPDF({ unit: 'mm', format: 'a4' })
    const pageW = doc.internal.pageSize.getWidth()
    let y = 0

    // ===== Header =====
    doc.setFillColor(30, 41, 59)
    doc.rect(0, 0, pageW, 32, 'F')
    doc.setTextColor(255, 255, 255)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(16)
    doc.text('SURAT TANDA TERIMA BARANG (STTB)', pageW / 2, 13, { align: 'center' })
    doc.setFontSize(10)
    doc.setFont('helvetica', 'normal')
    doc.text(settingsMap['nama_perusahaan'] ?? 'Workshop', pageW / 2, 20, { align: 'center' })
    doc.setFontSize(8)
    doc.text(settingsMap['alamat_perusahaan'] ?? '-', pageW / 2, 25, { align: 'center' })
    y = 42

    // ===== Info dokumen =====
    doc.setTextColor(30, 41, 59)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    doc.text(`No. STTB : ${ticket.noSttb}`, 15, y)
    y += 6
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)
    doc.text(`No. Tiket : ${ticket.noTiket}`, 15, y)
    y += 6
    doc.text(
      `Tanggal Terbit : ${new Date(ticket.createdAt).toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' })}`,
      15,
      y
    )
    y += 6
    doc.text(`Status Garansi : ${ticket.unitAsset.statusGaransi.replace('_', '-')}`, 15, y)
    y += 10

    // ===== QR Code =====
    doc.addImage(qrDataUrl, 'PNG', pageW - 55, 38, 40, 40)
    doc.setFontSize(7)
    doc.setTextColor(100, 100, 100)
    doc.text('Scan QR untuk verifikasi dokumen', pageW - 35, 82, { align: 'center' })

    // ===== Data Unit =====
    doc.setDrawColor(200, 200, 200)
    doc.line(15, y - 4, pageW - 15, y - 4)
    doc.setTextColor(30, 41, 59)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    doc.text('A. DATA UNIT', 15, y)
    y += 7
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)
    const unitRows: [string, string][] = [
      ['Nomor Seri', ticket.unitAsset.serialNumber],
      ['Model Unit', ticket.unitAsset.modelUnit],
      ['Toko Asal', ticket.unitAsset.toko ? `${ticket.unitAsset.toko.namaToko} (${ticket.unitAsset.toko.kodeToko})` : '-'],
      ['Pemilik/Pelanggan', ticket.unitAsset.customer?.nama ?? '-'],
      ['Kerusakan Dilaporkan', ticket.deskripsiKerusakan ?? '-'],
    ]
    for (const [label, value] of unitRows) {
      doc.setFont('helvetica', 'bold')
      doc.text(label, 20, y)
      doc.setFont('helvetica', 'normal')
      const labelW = doc.getTextWidth(label)
      doc.text(`: ${value}`, 20 + labelW + 2, y, { maxWidth: pageW - 60 })
      y += 6
    }
    y += 4

    // ===== Data Sparepart =====
    doc.setDrawColor(200, 200, 200)
    doc.line(15, y - 4, pageW - 15, y - 4)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    doc.text('B. SPAREPART DIALOKASIKAN', 15, y)
    y += 7
    doc.setFontSize(9)
    doc.setFillColor(241, 245, 249)
    doc.rect(15, y - 5, pageW - 30, 7, 'F')
    doc.text('Kode Part', 18, y)
    doc.text('Nama Sparepart', 55, y)
    doc.text('Qty', 130, y)
    doc.text('Status', 150, y)
    y += 7
    doc.setFont('helvetica', 'normal')
    for (const p of ticket.parts) {
      doc.text(p.sparepart.kodePart, 18, y)
      doc.text(p.sparepart.namaPart, 55, y, { maxWidth: 70 })
      doc.text(String(p.qty), 130, y)
      doc.text(p.statusPart === 'READY' ? 'READY (Dialokasikan)' : 'ORDER PRODUSEN', 150, y)
      y += 6
    }
    y += 6

    // ===== Penyerahan unit =====
    doc.setDrawColor(200, 200, 200)
    doc.line(15, y - 4, pageW - 15, y - 4)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    doc.text('C. PERNYATAAN PENYERAHAN', 15, y)
    y += 7
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)
    const pernyataan =
      'Unit sebagaimana disebut di atas diserahkan kepada Workshop untuk dilakukan pemeriksaan dan perbaikan. ' +
      'Sparepart yang digunakan merupakan stok inventory dari Produsen. Unit akan dikembalikan ke toko asal ' +
      'setelah perbaikan selesai dengan disertai nota service berstempel toko sebagai bukti pengembalian.'
    doc.text(doc.splitTextToSize(pernyataan, pageW - 30), 15, y)
    y += 24

    // ===== Signature =====
    const colW = (pageW - 40) / 2
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)
    doc.text('Penerima (Workshop)', 15 + colW / 2, y, { align: 'center' })
    doc.text('Pengirim / Toko', 15 + colW + colW / 2, y, { align: 'center' })
    y += 22
    doc.setDrawColor(120, 120, 120)
    doc.line(15 + colW / 2 - 25, y, 15 + colW / 2 + 25, y)
    doc.line(15 + colW + colW / 2 - 25, y, 15 + colW + colW / 2 + 25, y)
    y += 5
    doc.setFontSize(8)
    doc.text(`TTD & Stempel - ${new Date().toLocaleDateString('id-ID')}`, 15 + colW / 2, y, { align: 'center' })
    doc.text(`TTD & Stempel - ${ticket.unitAsset.toko?.namaToko ?? '-'}`, 15 + colW + colW / 2, y, { align: 'center' })

    // ===== Footer =====
    doc.setFontSize(7)
    doc.setTextColor(130, 130, 130)
    doc.text(
      `Dokumen ini digenerate otomatis oleh Sistem After-Sales Automation pada ${new Date().toLocaleString('id-ID')} | ${settingsMap['partner_produsen'] ?? ''}`,
      pageW / 2,
      288,
      { align: 'center' }
    )

    const pdfBytes = doc.output('arraybuffer')

    return new NextResponse(pdfBytes as ArrayBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${ticket.noSttb}.pdf"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    console.error('STTB PDF error:', error)
    return NextResponse.json({ error: 'Gagal generate PDF STTB' }, { status: 500 })
  }
}
