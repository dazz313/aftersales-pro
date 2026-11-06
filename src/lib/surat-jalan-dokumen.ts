import QRCode from 'qrcode'
import * as XLSX from 'xlsx'

/**
 * Pembuat dokumen Surat Jalan Request (SJR) — PDF (A4 landscape + QR) & Excel.
 * Dipecahkan dari route /api/surat-jalan-request agar route cetak-ulang
 * (GET /api/surat-jalan-request/[id]) bisa memanggil builder yang sama:
 * dokumen hasil cetak ulang identik dengan cetakan pertama.
 */

export interface ItemBaris {
  serviceRequestId: number | null
  noTiket: string
  kodePart: string
  namaPart: string
  qty: number
  toko: string
  serialNumber: string
  modelUnit: string
}

export async function buatPdf(param: {
  noSurat: string
  tglRequest: Date
  items: ItemBaris[]
  totalQty: number
  infoToko: { nama: string; alamat: string; email: string }
  produsenTujuan: string
  dibuatOleh: string
}): Promise<ArrayBuffer> {
  const jsPDFModule = await import('jspdf')
  const jsPDF = jsPDFModule.jsPDF
  const { noSurat, tglRequest, items, totalQty, infoToko, produsenTujuan, dibuatOleh } = param
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' })
  const pageW = doc.internal.pageSize.getWidth() // 297
  const pageH = doc.internal.pageSize.getHeight() // 210
  const M = 12
  const tableRight = pageW - M
  const tglCetak = tglRequest.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })
  const qrPayload = `SJR:${noSurat}|ITEM:${items.length}|QTY:${totalQty}`
  const qrDataUrl = await QRCode.toDataURL(qrPayload, { width: 200, margin: 1 })

  // Potong teks bila melebar dari kolom
  const potong = (t: string, maxW: number): string => {
    if (doc.getTextWidth(t) <= maxW) return t
    let c = t
    while (c.length > 1 && doc.getTextWidth(c + '…') > maxW) c = c.slice(0, -1)
    return c + '…'
  }

  let y = 0
  const drawPageHeader = (halPertama: boolean) => {
    const T = 14
    doc.setTextColor(30, 41, 59)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(14)
    doc.text('SURAT JALAN REQUEST PART', M, T + 8)
    // Baris DI BAWAH judul REQUEST: tanggal request dokumen ini.
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10)
    doc.text(`Tanggal Request : ${tglCetak}`, M, T + 15)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.text(`No. ${noSurat}`, M, T + 21)
    // Kop perusahaan kanan — nama, alamat, email. QR pindah ke kaki dokumen
    // agar tidak tumpang tindih dengan kop.
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    doc.text(infoToko.nama, pageW - M, T + 7, { align: 'right' })
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    if (infoToko.alamat && infoToko.alamat !== '-') doc.text(potong(infoToko.alamat, 110), pageW - M, T + 13, { align: 'right' })
    if (infoToko.email) doc.text(`Email: ${infoToko.email}`, pageW - M, T + 19, { align: 'right' })
    doc.setDrawColor(30, 41, 59)
    doc.setLineWidth(0.8)
    doc.line(M, T + 27, pageW - M, T + 27)
    doc.setLineWidth(0.2)
    y = T + 32

    // Blok tujuan surat (halaman pertama): "Kepada: PT ..." — produsen penerima
    if (halPertama && produsenTujuan) {
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(9)
      doc.text('Kepada :', M, y + 5)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(11)
      doc.text(potong(produsenTujuan, 150), M, y + 11.5)
      y += 19
    }
  }
  drawPageHeader(true)

  const cols: { title: string; x: number; w: number }[] = [
    { title: 'No', x: M, w: 8 },
    { title: 'No. Tiket', x: M + 8, w: 30 },
    { title: 'Toko', x: M + 38, w: 34 },
    { title: 'Serial Number', x: M + 72, w: 27 },
    { title: 'Model Unit', x: M + 99, w: 38 },
    { title: 'Kode Part', x: M + 137, w: 30 },
    { title: 'Nama Part', x: M + 167, w: 74 },
    { title: 'Qty', x: M + 241, w: 20 },
  ]

  const drawTableHeader = () => {
    doc.setFillColor(226, 232, 240)
    doc.rect(M, y - 4.5, tableRight - M, 7, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    for (const c of cols) doc.text(c.title, c.x + 1.5, y)
    doc.setDrawColor(100, 116, 139)
    doc.rect(M, y - 4.5, tableRight - M, 7)
    for (const c of cols) doc.line(c.x, y - 4.5, c.x, y + 2.5)
    doc.line(tableRight, y - 4.5, tableRight, y + 2.5)
    y += 7
    doc.setFont('helvetica', 'normal')
  }
  drawTableHeader()

  items.forEach((i, idx) => {
    if (y > pageH - 26) {
      doc.addPage()
      drawPageHeader(false)
      drawTableHeader()
    }
    doc.setFontSize(8)
    doc.setTextColor(30, 41, 59)
    doc.text(String(idx + 1), cols[0].x + 1.5, y)
    doc.text(potong(i.noTiket, cols[1].w - 2), cols[1].x + 1.5, y)
    doc.text(potong(i.toko, cols[2].w - 2), cols[2].x + 1.5, y)
    doc.text(potong(i.serialNumber, cols[3].w - 2), cols[3].x + 1.5, y)
    doc.text(potong(i.modelUnit, cols[4].w - 2), cols[4].x + 1.5, y)
    doc.setFont('courier', 'bold')
    doc.text(potong(i.kodePart, cols[5].w - 2), cols[5].x + 1.5, y)
    doc.setFont('helvetica', 'normal')
    doc.text(potong(i.namaPart, cols[6].w - 2), cols[6].x + 1.5, y)
    doc.text(String(i.qty), tableRight - 1.5, y, { align: 'right' })
    doc.setDrawColor(203, 213, 225)
    doc.line(M, y + 2.5, tableRight, y + 2.5)
    y += 6
  })

  // Ringkasan
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(30, 41, 59)
  doc.text(`Total : ${items.length} item · ${totalQty} pcs · ${new Set(items.map((i) => i.toko)).size} toko`, M, y + 6)

  // Zona kaki dokumen — QR verifikasi kiri, tanda tangan kanan (surat resmi).
  // Catatan internal aplikasi dihapus sesuai permintaan: halaman bersih.
  if (y > pageH - 58) {
    doc.addPage()
    drawPageHeader(false)
  }
  const sigY = y + 12
  doc.addImage(qrDataUrl, 'PNG', M, sigY + 2, 22, 22)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(6)
  doc.setTextColor(100, 116, 139)
  doc.text('Scan QR verifikasi', M + 11, sigY + 27, { align: 'center' })

  doc.setTextColor(30, 41, 59)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.text('Hormat kami,', tableRight, sigY + 4, { align: 'right' })
  doc.setFontSize(8)
  doc.setTextColor(100, 116, 139)
  doc.text(potong(infoToko.nama, 70), tableRight, sigY + 9.5, { align: 'right' })
  doc.setDrawColor(30, 41, 59)
  doc.setLineWidth(0.4)
  doc.line(tableRight - 70, sigY + 24, tableRight, sigY + 24)
  doc.setLineWidth(0.2)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.setTextColor(30, 41, 59)
  doc.text(potong(dibuatOleh, 70), tableRight, sigY + 29, { align: 'right' })

  return doc.output('arraybuffer')
}

export function buatXlsx(param: {
  noSurat: string
  tglRequest: Date
  items: ItemBaris[]
  totalQty: number
  lewatTanpaKode: number
  produsenTujuan: string
}): ArrayBuffer {
  const { noSurat, tglRequest, items, totalQty, lewatTanpaKode, produsenTujuan } = param
  const tglText = `${tglRequest.toLocaleDateString('id-ID')} ${tglRequest.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}`

  const wb = XLSX.utils.book_new()
  const body = items.map((i, idx) => [
    idx + 1,
    i.noTiket,
    i.toko,
    i.serialNumber,
    i.modelUnit,
    i.kodePart,
    i.namaPart,
    i.qty,
    tglText,
  ])
  const barisKepada = produsenTujuan ? [[`Kepada : ${produsenTujuan}`, '', '', '', '']] : []
  const request = XLSX.utils.aoa_to_sheet([
    ['SURAT JALAN REQUEST PART', '', '', '', ''],
    [`No. ${noSurat}`, '', '', '', ''],
    [`Tanggal Request : ${tglText}`, '', '', '', ''],
    ...barisKepada,
    [],
    ['No', 'No. Tiket', 'Toko', 'Serial Number', 'Model Unit', 'Kode Part', 'Nama Part', 'Qty', 'Tgl Request'],
    ...body,
  ])
  XLSX.utils.book_append_sheet(wb, request, 'Request')

  // Ringkasan per toko — langsung menjawab "part ini untuk toko mana".
  const tokoMap = new Map<string, { item: number; qty: number }>()
  for (const i of items) {
    const cur = tokoMap.get(i.toko) ?? { item: 0, qty: 0 }
    cur.item++
    cur.qty += i.qty || 1
    tokoMap.set(i.toko, cur)
  }
  const ringkasan = XLSX.utils.aoa_to_sheet([
    ['No. Surat Jalan', noSurat],
    ['Tanggal Request', tglText],
    ...(produsenTujuan ? [['Kepada (Produsen)', produsenTujuan]] : []),
    ['Jumlah Tiket', new Set(items.map((i) => i.noTiket)).size],
    ['Jumlah Item', items.length],
    ['Total Qty', `${totalQty} pcs`],
    ['Lewat (kode/nama belum lengkap)', lewatTanpaKode],
    [],
    ['Toko', 'Item', 'Qty'],
    ...[...tokoMap.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([t, v]) => [t, v.item, v.qty]),
  ])
  XLSX.utils.book_append_sheet(wb, ringkasan, 'Ringkasan')

  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
}
