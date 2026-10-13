import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { autoGitBackup } from '@/lib/git-backup'
import { isGaransi } from '@/lib/types'
import { getActiveSession } from '@/lib/auth-server'
import * as XLSX from 'xlsx'
import QRCode from 'qrcode'

/**
 * API Surat Jalan Kolektif (Modul 4 — pengiriman part ke produsen)
 * Mencetak rincian kolektif unit/tiket yang part rusaknya dikirim ke produsen
 * sebagai SURAT JALAN dalam bentuk PDF (jsPDF landscape + QR verifikasi)
 * dan Excel (.xlsx, 2 sheet: Surat Jalan + Ringkasan per Tiket).
 *
 * POST /api/surat-jalan
 * Body: { noTiket: string[], format: 'pdf' | 'xlsx' }
 * → binary file (attachment) dengan nama Surat-Jalan-<No SJ>.pdf/.xlsx
 */

interface ItemRow {
  noTiket: string
  noSttb: string
  serialNumber: string
  modelUnit: string
  tokoAsal: string
  kodePart: string
  namaPart: string
  qty: number
  garansi: string
  nilaiPart: number
}

export async function POST(request: Request) {
  try {
    const session = await getActiveSession(request)
    if (!session) {
      return NextResponse.json({ error: 'Sesi berakhir atau akun nonaktif. Silakan login ulang.' }, { status: 401 })
    }
    const aktor = session?.nama ?? 'SYSTEM'

    const body = await request.json().catch(() => null) as { noTiket?: unknown[]; format?: string } | null
    const noTiketList: string[] = Array.isArray(body?.noTiket)
      ? [...new Set(body.noTiket.map((s: unknown) => String(s).trim()).filter(Boolean))]
      : []
    const format = body?.format === 'xlsx' ? 'xlsx' : 'pdf'

    if (noTiketList.length === 0) {
      return NextResponse.json({ error: 'Pilih minimal 1 tiket untuk surat jalan' }, { status: 400 })
    }
    if (noTiketList.length > 200) {
      return NextResponse.json({ error: 'Maksimal 200 tiket per surat jalan' }, { status: 400 })
    }

    const tickets = await db.serviceRequest.findMany({
      where: { noTiket: { in: noTiketList } },
      include: {
        unitAsset: { include: { toko: true, customer: true } },
        parts: { include: { sparepart: true } },
      },
      orderBy: { noTiket: 'asc' },
    })

    if (tickets.length === 0) {
      return NextResponse.json({ error: 'Tiket tidak ditemukan' }, { status: 404 })
    }
    const foundSet = new Set(tickets.map((t) => t.noTiket))
    const missing = noTiketList.filter((n) => !foundSet.has(n))
    if (missing.length > 0) {
      return NextResponse.json(
        { error: `Tiket tidak ditemukan: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? ' …' : ''}` },
        { status: 404 }
      )
    }

    const settings = await db.pengaturan.findMany()
    const s: Record<string, string> = {}
    for (const row of settings) s[row.kunci] = row.nilai
    const namaPengirim = s['nama_perusahaan'] ?? 'CV. Teknik Jaya Abadi Workshop'
    const alamatPengirim = s['alamat_perusahaan'] ?? '-'
    const penerima = s['partner_produsen'] ?? 'PT. Sinar Elektronik Mandiri (Produsen)'

    // Nomor surat jalan berurutan per hari: SJ-YYYYMMDD-0001
    const today = new Date()
    const ymd = today.toISOString().slice(0, 10).replace(/-/g, '')
    const startOfDay = new Date(today)
    startOfDay.setHours(0, 0, 0, 0)
    const usedToday = await db.auditLog.count({
      where: { aksi: 'CETAK_SURAT_JALAN', createdAt: { gte: startOfDay } },
    })
    const noSJ = `SJ-${ymd}-${String(usedToday + 1).padStart(4, '0')}`
    const tglCetak = today.toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' })

    // Flatten part → baris item
    const items: ItemRow[] = []
    for (const t of tickets) {
      for (const p of t.parts) {
        items.push({
          noTiket: t.noTiket,
          noSttb: t.noSttb ?? '-',
          serialNumber: t.unitAsset.serialNumber,
          modelUnit: t.unitAsset.modelUnit,
          tokoAsal: t.unitAsset.toko ? `${t.unitAsset.toko.namaToko} (${t.unitAsset.toko.kodeToko})` : '-',
          kodePart: p.sparepart.kodePart,
          namaPart: p.sparepart.namaPart,
          qty: p.qty,
          garansi: isGaransi(t.unitAsset.statusGaransi) ? 'GARANSI' : 'NON-GARANSI',
          nilaiPart: (p.sparepart.hargaKlaim ?? 0) * p.qty,
        })
      }
    }
    const totalQty = items.reduce((a, i) => a + i.qty, 0)
    const totalNilai = items.reduce((a, i) => a + i.nilaiPart, 0) + tickets.reduce((a, t) => a + t.biayaJasa, 0)
    const qtyPerTiket = new Map<number, number>()
    for (const t of tickets) {
      qtyPerTiket.set(t.id, t.parts.reduce((a, p) => a + p.qty, 0))
    }

    // QR verifikasi
    const qrPayload = `SJ:${noSJ}|TIKET:${tickets.length}|ITEM:${items.length}|QTY:${totalQty}|TGL:${ymd}`
    const qrDataUrl = await QRCode.toDataURL(qrPayload, { width: 200, margin: 1 })

    const filenameBase = `Surat-Jalan-${noSJ}`
    // Nama penerima tanpa embel "(Produsen)" untuk dokumen
    const penerimaBersih = penerima.replace(/\s*\(produsen\)/gi, '').trim() || penerima

    if (format === 'xlsx') {
      // ============ Excel: Sheet 1 Surat Jalan ============
      const headerInfo: (string | number)[][] = [
        ['SURAT JALAN — PENGIRIMAN SPAREPART RUSAK'],
        [`No. Surat Jalan: ${noSJ}`, '', '', '', '', '', `Tanggal: ${tglCetak}`],
        [`Pengirim: ${namaPengirim}`, '', '', '', '', '', `Kepada: ${penerimaBersih}`],
        [`Alamat: ${alamatPengirim}`, '', '', '', '', '', `QR verifikasi: ${qrPayload}`],
        [],
      ]
      const colHeader = [
        'No', 'No. Tiket', 'No. STTB', 'Serial Number', 'Model Unit', 'Toko Asal',
        'Kode Part', 'Nama Sparepart', 'Qty', 'Garansi', 'Nilai Part (Rp)',
      ]
      const rows: (string | number)[][] = items.map((it, i) => [
        i + 1, it.noTiket, it.noSttb, it.serialNumber, it.modelUnit, it.tokoAsal,
        it.kodePart, it.namaPart, it.qty, it.garansi, it.nilaiPart,
      ])
      const footer: (string | number)[][] = [
        [],
        ['', '', '', '', '', '', '', '', `TOTAL: ${totalQty} pcs`, '', items.reduce((a, i) => a + i.nilaiPart, 0)],
        ['', '', '', '', '', '', '', '', '', 'Biaya Jasa:', tickets.reduce((a, t) => a + t.biayaJasa, 0)],
        ['', '', '', '', '', '', '', '', '', 'TOTAL KLAIM:', totalNilai],
        [],
        ['Pengirim (Workshop)', '', '', '', '', '', '', '', '', '', 'Penerima'],
        ['_________________________', '', '', '', '', '', '', '', '', '', '_________________________'],
        [namaPengirim, '', '', '', '', '', '', '', '', '', penerimaBersih],
      ]
      const ws = XLSX.utils.aoa_to_sheet([...headerInfo, colHeader, ...rows, ...footer])
      ws['!cols'] = [
        { wch: 4 }, { wch: 18 }, { wch: 20 }, { wch: 22 }, { wch: 30 }, { wch: 36 },
        { wch: 20 }, { wch: 40 }, { wch: 6 }, { wch: 13 }, { wch: 16 },
      ]

      // ============ Sheet 2 Ringkasan per Tiket ============
      const rekapHeader = [
        'No', 'No. Tiket', 'No. STTB', 'Serial Number', 'Model Unit', 'Toko Asal',
        'Jumlah Item Part', 'Total Qty (pcs)', 'Biaya Jasa (Rp)', 'Nilai Part (Rp)', 'Total Klaim (Rp)', 'Status Klaim',
      ]
      const rekapRows: (string | number)[][] = tickets.map((t, i) => {
        const nilaiPart = t.parts.reduce((a, p) => a + (p.sparepart?.hargaKlaim ?? 0) * p.qty, 0)
        return [
          i + 1, t.noTiket, t.noSttb ?? '-', t.unitAsset.serialNumber, t.unitAsset.modelUnit,
          t.unitAsset.toko ? `${t.unitAsset.toko.namaToko} (${t.unitAsset.toko.kodeToko})` : '-',
          t.parts.length, qtyPerTiket.get(t.id) ?? 0, t.biayaJasa, nilaiPart, t.biayaJasa + nilaiPart, t.statusKlaimProdusen,
        ]
      })
      const wsRekap = XLSX.utils.aoa_to_sheet([
        [`RINGKASAN PER TIKET — ${noSJ}`, '', '', '', '', `Kepada: ${penerima}`],
        [],
        rekapHeader,
        ...rekapRows,
        [],
        ['', '', '', '', '', '', '', `TOTAL: ${totalQty} pcs`, tickets.reduce((a, t) => a + t.biayaJasa, 0), items.reduce((a, i) => a + i.nilaiPart, 0), totalNilai, ''],
      ])
      wsRekap['!cols'] = [
        { wch: 4 }, { wch: 18 }, { wch: 20 }, { wch: 22 }, { wch: 28 }, { wch: 30 },
        { wch: 15 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 13 },
      ]

      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'Surat Jalan')
      XLSX.utils.book_append_sheet(wb, wsRekap, 'Ringkasan per Tiket')
      const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer

      await logAudit({
        aksi: 'CETAK_SURAT_JALAN',
        entitas: 'surat_jalan',
        entitasId: noSJ,
        deskripsi: `Cetak Surat Jalan ${noSJ} (Excel): ${tickets.length} tiket, ${items.length} item part, ${totalQty} pcs — untuk ${penerima}`,
        aktor,
      })
      // Cap nomor SJ ke tiket agar alur terpantau (part rusak terkirim ke produsen)
      await db.serviceRequest.updateMany({ where: { noTiket: { in: noTiketList } }, data: { noSuratJalan: noSJ } })
      await autoGitBackup('SURAT_JALAN', 'service_request', noSJ, aktor)

      return new NextResponse(new Uint8Array(buf), {
        status: 200,
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="${filenameBase}.xlsx"`,
          'Cache-Control': 'no-store',
          'X-Surat-Jalan-No': noSJ,
        },
      })
    }

    // ============ PDF (A4 landscape, QR verifikasi, multi-page) ============
    const jsPDFModule = await import('jspdf')
    const jsPDF = jsPDFModule.jsPDF
    const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' })
    const pageW = doc.internal.pageSize.getWidth() // 297
    const pageH = doc.internal.pageSize.getHeight() // 210
    const M = 12 // margin
    let y = 0

    const drawPageHeader = () => {
      doc.setFillColor(15, 118, 110) // emerald-700
      doc.rect(0, 0, pageW, 24, 'F')
      doc.setTextColor(255, 255, 255)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(15)
      doc.text('SURAT JALAN', M, 10)
      doc.setFontSize(9)
      doc.setFont('helvetica', 'normal')
      doc.text('Pengiriman Sparepart Rusak', M, 16)
      doc.setFontSize(8)
      doc.text(namaPengirim, pageW - M, 9, { align: 'right' })
      doc.text(alamatPengirim, pageW - M, 14, { align: 'right', maxWidth: 90 })
      doc.setTextColor(30, 41, 59)
      y = 32
    }

    drawPageHeader()

    // Info dokumen + QR
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(12)
    doc.text(`No. Surat Jalan : ${noSJ}`, M, y)
    doc.addImage(qrDataUrl, 'PNG', pageW - M - 24, y - 7, 24, 24)
    doc.setFontSize(9)
    doc.setFont('helvetica', 'normal')
    y += 6
    doc.text(`Tanggal         : ${tglCetak}`, M, y)
    y += 5
    doc.setFont('helvetica', 'bold')
    doc.text(`Pengirim        : ${namaPengirim}`, M, y)
    y += 5
    doc.setFont('helvetica', 'normal')
    doc.text(`Kepada          : ${penerimaBersih}`, M, y)
    // Caption QR — di bawah gambar QR, tetap dalam margin kanan
    doc.setFontSize(6)
    doc.setTextColor(100, 116, 139)
    doc.text('Scan QR verifikasi', pageW - M - 12, y + 3, { align: 'center' })
    doc.setTextColor(30, 41, 59)
    y += 9

    // Potong teks agar muat 1 baris (mencegah wrap tumpang tindih antar baris)
    const fit = (text: string, maxW: number): string => {
      if (doc.getTextWidth(text) <= maxW) return text
      let t = text
      while (t.length > 1 && doc.getTextWidth(t + '…') > maxW) t = t.slice(0, -1)
      return t + '…'
    }

    // Bungkus teks maks 2 baris agar kode part & nama toko TAMPIL LENGKAP
    const wrap2 = (text: string, maxW: number): string[] => {
      const lines = doc.splitTextToSize(text, maxW) as string[]
      if (lines.length <= 2) return lines
      const out = lines.slice(0, 2)
      out[1] = fit(out[1], maxW)
      return out
    }

    // Tabel item — kolom Kondisi dihapus; lebar dialihkan agar kode & toko muat penuh
    const cols: { title: string; x: number; w: number; wrap?: boolean }[] = [
      { title: 'No', x: M, w: 8 },
      { title: 'No. Tiket', x: M + 8, w: 26 },
      { title: 'Serial Number', x: M + 34, w: 30 },
      { title: 'Model Unit', x: M + 64, w: 34 },
      { title: 'Toko Asal', x: M + 98, w: 44, wrap: true },
      { title: 'Kode Part', x: M + 142, w: 26, wrap: true },
      { title: 'Nama Sparepart', x: M + 168, w: 61, wrap: true },
      { title: 'Qty', x: M + 229, w: 8 },
      { title: 'Garansi', x: M + 237, w: 24 },
    ]
    const tableRight = M + 261
    if (tableRight > pageW - M) {
      // fallback keamanan lebar
      cols[cols.length - 1].w = pageW - M - cols[cols.length - 1].x
    }

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

    doc.setFontSize(8)
    let no = 1
    for (const it of items) {
      // Sel dengan wrap (toko, kode, nama) boleh 2 baris agar tampil lengkap
      const c4 = wrap2(it.tokoAsal, cols[4].w - 2)
      const c5 = wrap2(it.kodePart, cols[5].w - 2)
      const c6 = wrap2(it.namaPart, cols[6].w - 2)
      const baris = Math.max(c4.length, c5.length, c6.length)
      const rowH = baris > 1 ? 11 : 6
      if (y + rowH > pageH - 45) {
        doc.addPage()
        drawPageHeader()
        y += 2
        drawTableHeader()
        doc.setFontSize(8)
      }
      // zebra
      if (no % 2 === 0) {
        doc.setFillColor(248, 250, 252)
        doc.rect(M, y - 4, tableRight - M, rowH - 1, 'F')
      }
      const yy = (i: number) => y + i * 4.5
      doc.text(String(no++), cols[0].x + 1.5, y)
      doc.text(fit(it.noTiket, cols[1].w - 2), cols[1].x + 1.5, y)
      doc.text(fit(it.serialNumber, cols[2].w - 2), cols[2].x + 1.5, y)
      doc.text(fit(it.modelUnit, cols[3].w - 2), cols[3].x + 1.5, y)
      c4.forEach((ln, i) => doc.text(ln, cols[4].x + 1.5, yy(i)))
      c5.forEach((ln, i) => doc.text(ln, cols[5].x + 1.5, yy(i)))
      c6.forEach((ln, i) => doc.text(ln, cols[6].x + 1.5, yy(i)))
      doc.text(String(it.qty), cols[7].x + 1.5, y)
      doc.text(fit(it.garansi, cols[8].w - 2), cols[8].x + 1.5, y)
      y += rowH
    }

    // Baris total
    if (y > pageH - 45) {
      doc.addPage()
      drawPageHeader()
      y += 2
    }
    doc.setFillColor(204, 251, 241) // emerald-100
    doc.rect(M, y - 4, tableRight - M, 7, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8.5)
    doc.text(`TOTAL — ${tickets.length} tiket / ${items.length} item part`, cols[1].x + 1.5, y)
    doc.text(`${totalQty} pcs`, cols[7].x + 1.5, y)
    doc.text(fit(`Rp ${totalNilai.toLocaleString('id-ID')}`, cols[8].w - 2), cols[8].x + 1.5, y)
    y += 14
    doc.setFont('helvetica', 'normal')

    // Tanda tangan
    const colW = (pageW - 2 * M) / 2
    doc.setTextColor(30, 41, 59)
    doc.setFontSize(10)
    doc.text('Pengirim', M + colW / 2, y, { align: 'center' })
    doc.text('Penerima', M + colW + colW / 2, y, { align: 'center' })
    y += 20
    doc.setDrawColor(100, 116, 139)
    doc.line(M + colW / 2 - 30, y, M + colW / 2 + 30, y)
    doc.line(M + colW + colW / 2 - 30, y, M + colW + colW / 2 + 30, y)
    y += 5
    doc.setFontSize(8)
    doc.setTextColor(100, 116, 139)
    doc.text('TTD & Stempel', M + colW / 2, y, { align: 'center' })
    doc.text('TTD & Stempel', M + colW + colW / 2, y, { align: 'center' })

    // Footer + nomor halaman
    const nPages = doc.getNumberOfPages()
    for (let i = 1; i <= nPages; i++) {
      doc.setPage(i)
      doc.setFontSize(7)
      doc.setTextColor(130, 130, 130)
      doc.text(
        `${noSJ} · Digenerate otomatis oleh Sistem After-Sales Automation pada ${today.toLocaleString('id-ID')}`,
        M,
        pageH - 5
      )
      doc.text(`Halaman ${i} dari ${nPages}`, pageW - M, pageH - 5, { align: 'right' })
    }

    const pdfBytes = doc.output('arraybuffer')

    await logAudit({
      aksi: 'CETAK_SURAT_JALAN',
      entitas: 'surat_jalan',
      entitasId: noSJ,
      deskripsi: `Cetak Surat Jalan ${noSJ} (PDF): ${tickets.length} tiket, ${items.length} item part, ${totalQty} pcs — untuk ${penerima}`,
      aktor,
    })
    // Cap nomor SJ ke tiket agar alur terpantau (part rusak terkirim ke produsen)
    await db.serviceRequest.updateMany({ where: { noTiket: { in: noTiketList } }, data: { noSuratJalan: noSJ } })

    return new NextResponse(pdfBytes as ArrayBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filenameBase}.pdf"`,
        'Cache-Control': 'no-store',
        'X-Surat-Jalan-No': noSJ,
      },
    })
  } catch (error) {
    console.error('Surat jalan error:', error)
    return NextResponse.json({ error: 'Gagal generate surat jalan' }, { status: 500 })
  }
}
