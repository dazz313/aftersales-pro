import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { autoGitBackup } from '@/lib/git-backup'
import { getActiveSession } from '@/lib/auth-server'
import QRCode from 'qrcode'

/**
 * API Surat Pengembalian Barang ke Toko (unit selesai service).
 * Kebalikan STTB: saat STTB dipakai untuk MENARIK unit dari toko,
 * dokumen ini menjadi BUKTI PENGEMBALIAN unit yang sudah dikerjakan
 * (dipasang / selesai service) dari workshop kembali ke tokonya.
 *
 * Dua mode pemakaian (pilihan pengguna di UI):
 *  - PER TOKO   : 1 tiket → 1 dokumen (bukti pengembalian satu unit)
 *  - KOLEKTIF   : beberapa tiket 1 toko yang sama → 1 dokumen merangkum semua
 *
 * Syarat tiket: tanggal kembali ke toko sudah tercatat (tglKembaliKeToko —
 * diisi otomatis oleh aksi "Kembalikan ke Toko" (cabut STTB) atau FINISH).
 * Kolom "Tanggal Dikembalikan" per baris diambil dari tanggal itu, sehingga
 * kop dokumen selalu punya tanggal barang dikembalikan ke toko.
 *
 * POST /api/sttb/kembali
 * Body: { noTiket: string[] }
 * → PDF A4 portrait (attachment). Menolak bila beda toko / kurang tanggal kembali.
 */
export async function POST(request: Request) {
  try {
    const session = await getActiveSession(request)
    if (!session) {
      return NextResponse.json({ error: 'Sesi berakhir atau akun nonaktif. Silakan login ulang.' }, { status: 401 })
    }
    const aktor = session?.nama ?? 'SYSTEM'

    const body = (await request.json().catch(() => null)) as { noTiket?: unknown[] } | null
    const noTiketList: string[] = Array.isArray(body?.noTiket)
      ? [...new Set(body.noTiket.map((s: unknown) => String(s).trim()).filter(Boolean))]
      : []
    if (noTiketList.length === 0) {
      return NextResponse.json({ error: 'Pilih minimal 1 tiket untuk surat pengembalian' }, { status: 400 })
    }
    if (noTiketList.length > 100) {
      return NextResponse.json({ error: 'Maksimal 100 tiket per surat pengembalian' }, { status: 400 })
    }

    const tickets = await db.serviceRequest.findMany({
      where: { noTiket: { in: noTiketList } },
      include: {
        unitAsset: { include: { toko: true } },
      },
      orderBy: { noTiket: 'asc' },
    })
    const foundSet = new Set(tickets.map((t) => t.noTiket))
    const missing = noTiketList.filter((n) => !foundSet.has(n))
    if (missing.length > 0) {
      return NextResponse.json({ error: `Tiket tidak ditemukan: ${missing.slice(0, 5).join(', ')}` }, { status: 404 })
    }

    // Wajib 1 toko yang sama (per toko maupun kolektif — dokumen kembali satu toko)
    const tokoIds = new Set(tickets.map((t) => t.unitAsset.tokoId ?? 0))
    if (tokoIds.size !== 1 || tickets[0].unitAsset.tokoId == null) {
      return NextResponse.json(
        { error: 'Surat pengembalian merangkum 1 toko — centang tiket dari toko yang sama.' },
        { status: 400 }
      )
    }
    const toko = tickets[0].unitAsset.toko!

    // Syarat inti: tanggal barang dikembalikan ke toko sudah tercatat —
    // tanpa itu dokumen ini tidak ada isinya.
    const belumKembali = tickets.filter((t) => !t.tglKembaliKeToko)
    if (belumKembali.length > 0) {
      const daftar = belumKembali.map((t) => `${t.noTiket} (${t.status}${t.status !== 'FINISH' ? ', belum cabut STTB' : ''})`).join(', ')
      return NextResponse.json(
        { error: `Tanggal kembali belum tercatat: ${daftar}. Tekan "Kembalikan ke Toko" (atau FINISH) dulu untuk tiketnya.` },
        { status: 409 }
      )
    }

    const settings = await db.pengaturan.findMany()
    const s: Record<string, string> = {}
    for (const row of settings) s[row.kunci] = row.nilai
    const namaWorkshop = s['nama_perusahaan'] ?? 'Workshop'
    const alamatWorkshop = s['alamat_perusahaan'] ?? '-'
    const emailWorkshop = (s['email_perusahaan'] ?? '').trim()

    const today = new Date()
    const ymd = today.toISOString().slice(0, 10).replace(/-/g, '')
    const startOfDay = new Date(today)
    startOfDay.setHours(0, 0, 0, 0)
    const usedToday = await db.auditLog.count({
      where: { aksi: 'CETAK_KEMBALI_TOKO', createdAt: { gte: startOfDay } },
    })
    const noDokumen = `SKTB-${ymd}-${String(usedToday + 1).padStart(4, '0')}`
    const tglCetak = today.toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' })

    const totalUnit = tickets.length
    const qrPayload = `SKTB:${noDokumen}|TOKO:${toko.kodeToko}|UNIT:${totalUnit}|TGL:${ymd}`
    const qrDataUrl = await QRCode.toDataURL(qrPayload, { width: 200, margin: 1 })

    // ============ PDF (A4 portrait + grid penuh) ============
    const jsPDFModule = await import('jspdf')
    const jsPDF = jsPDFModule.jsPDF
    const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })
    const pageW = doc.internal.pageSize.getWidth() // 210
    const pageH = doc.internal.pageSize.getHeight() // 297
    const M = 15
    const tableRight = pageW - M // 195
    let y = 0

    const drawPageHeader = () => {
      // Kop TANPA arsir (hemat tinta): teks gelap + garis pemisah ke isi surat.
      // Margin atas 2cm (20mm) dari tepi kertas agar tidak terpotong printer.
      const T = 20
      doc.setTextColor(30, 41, 59)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(14)
      doc.text('SURAT PENGEMBALIAN BARANG', M, T + 12)
      doc.setFontSize(9)
      doc.setFont('helvetica', 'normal')
      doc.text(`No. ${noDokumen}`, M, T + 20)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(11)
      doc.text(namaWorkshop, pageW - M, T + 11, { align: 'right' })
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(8)
      doc.text(alamatWorkshop, pageW - M, T + 17, { align: 'right', maxWidth: 100 })
      if (emailWorkshop) doc.text(emailWorkshop, pageW - M, T + 22, { align: 'right', maxWidth: 110 })
      doc.setDrawColor(30, 41, 59)
      doc.setLineWidth(0.8)
      doc.line(M, T + 28, pageW - M, T + 28)
      doc.setLineWidth(0.2)
      y = T + 36
    }
    drawPageHeader()

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(12)
    doc.addImage(qrDataUrl, 'PNG', pageW - M - 24, y - 7, 24, 24)
    doc.setFontSize(9)
    doc.setFont('helvetica', 'normal')
    doc.text(`Tanggal cetak : ${tglCetak}`, M, y)
    y += 5
    doc.setFont('helvetica', 'bold')
    doc.text(`Toko          : ${toko.kodeToko} — ${toko.namaToko}`, M, y)
    y += 5
    doc.setFont('helvetica', 'normal')
    if (toko.alamat) {
      doc.text(`Alamat        : ${toko.alamat}`, M, y, { maxWidth: pageW - 2 * M - 30 })
      y += 5
    }
    doc.setFontSize(6)
    doc.setTextColor(100, 116, 139)
    doc.text('Scan QR verifikasi', pageW - M - 12, y + 1, { align: 'center' })
    doc.setTextColor(30, 41, 59)
    y += 7

    const fit = (text: string, maxW: number): string => {
      if (doc.getTextWidth(text) <= maxW) return text
      let t = text
      while (t.length > 1 && doc.getTextWidth(t + '…') > maxW) t = t.slice(0, -1)
      return t + '…'
    }
    const wrap2 = (text: string, maxW: number): string[] => {
      const lines = doc.splitTextToSize(text, maxW) as string[]
      if (lines.length <= 2) return lines
      const out = lines.slice(0, 2)
      out[1] = fit(out[1], maxW)
      return out
    }

    // Satu baris per UNIT — tanggal kembali tercetak per baris (ambil dari
    // tglKembaliKeToko tiket, jadi walau unit kembali beda hari, tiap baris
    // tetap jelas tanggal barangnya dikembalikan ke toko).
    const cols: { title: string; x: number; w: number }[] = [
      { title: 'No', x: M, w: 8 },
      { title: 'No. Tiket', x: M + 8, w: 30 },
      { title: 'Serial Number', x: M + 38, w: 28 },
      { title: 'Model Unit', x: M + 66, w: 34 },
      { title: 'Tgl Kembali', x: M + 100, w: 18 },
      { title: 'Deskripsi Kerusakan', x: M + 118, w: 62 },
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

    const garisKolom = (yAtas: number, h: number) => {
      doc.setDrawColor(148, 163, 184)
      for (const c of cols) doc.line(c.x, yAtas, c.x, yAtas + h)
      doc.line(tableRight, yAtas, tableRight, yAtas + h)
    }

    doc.setFontSize(8)
    let no = 1
    for (const t of tickets) {
      const cModel = wrap2(t.unitAsset.modelUnit, cols[3].w - 2)
      const cRusak = wrap2(t.deskripsiKerusakan?.trim() || '-', cols[5].w - 2)
      const tglKembali = new Date(t.tglKembaliKeToko as Date).toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric' })
      const rowH = Math.max(cModel.length, cRusak.length) > 1 ? 11 : 6
      if (y + rowH > pageH - 60) {
        doc.addPage()
        drawPageHeader()
        y += 2
        drawTableHeader()
        doc.setFontSize(8)
      }
      if (no % 2 === 0) {
        doc.setFillColor(248, 250, 252)
        doc.rect(M, y - 4, tableRight - M, rowH - 1, 'F')
      }
      garisKolom(y - 4, rowH - 1)
      doc.setDrawColor(148, 163, 184)
      doc.line(M, y + rowH - 5, tableRight, y + rowH - 5)
      const yy = (i: number) => y + i * 4.5
      doc.text(String(no++), cols[0].x + 1.5, y)
      doc.text(fit(t.noTiket, cols[1].w - 2), cols[1].x + 1.5, y)
      doc.text(fit(t.unitAsset.serialNumber, cols[2].w - 2), cols[2].x + 1.5, y)
      cModel.forEach((ln, i) => doc.text(ln, cols[3].x + 1.5, yy(i)))
      doc.text(fit(tglKembali, cols[4].w - 2), cols[4].x + 1.5, y)
      cRusak.forEach((ln, i) => doc.text(ln, cols[5].x + 1.5, yy(i)))
      y += rowH
    }

    // Baris total bersih (bingkai luar saja)
    if (y > pageH - 60) {
      doc.addPage()
      drawPageHeader()
      y += 2
    }
    doc.setFillColor(204, 251, 241)
    doc.rect(M, y - 4, tableRight - M, 7, 'F')
    doc.setDrawColor(100, 116, 139)
    doc.rect(M, y - 4, tableRight - M, 7)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8.5)
    doc.text(`TOTAL — ${totalUnit} unit dikembalikan ke toko`, cols[1].x + 1.5, y)
    y += 14
    doc.setFont('helvetica', 'normal')

    // Tanda tangan: penyerah (workshop) & penerima (toko)
    if (y > pageH - 70) {
      doc.addPage()
      drawPageHeader()
      y += 2
    }
    const colW = (pageW - 2 * M) / 2
    doc.setTextColor(30, 41, 59)
    doc.setFontSize(10)
    doc.text('Diserahkan (Workshop)', M + colW / 2, y, { align: 'center' })
    doc.text('Diterima (Toko)', M + colW + colW / 2, y, { align: 'center' })
    y += 20
    doc.setDrawColor(100, 116, 139)
    doc.line(M + colW / 2 - 30, y, M + colW / 2 + 30, y)
    doc.line(M + colW + colW / 2 - 30, y, M + colW + colW / 2 + 30, y)
    y += 5
    doc.setFontSize(8)
    doc.setTextColor(100, 116, 139)
    doc.text('Nama & TTD', M + colW / 2, y, { align: 'center' })
    doc.text(`${toko.kodeToko} — ${toko.namaToko}`, M + colW + colW / 2, y, { align: 'center' })

    const nPages = doc.getNumberOfPages()
    for (let i = 1; i <= nPages; i++) {
      doc.setPage(i)
      doc.setFontSize(7)
      doc.setTextColor(130, 130, 130)
      doc.text(
        `${noDokumen} · Digenerate otomatis oleh Sistem After-Sales pada ${today.toLocaleString('id-ID')}`,
        M,
        pageH - 5
      )
      doc.text(`Halaman ${i} dari ${nPages}`, pageW - M, pageH - 5, { align: 'right' })
    }

    const pdfBytes = doc.output('arraybuffer')

    await logAudit({
      aksi: 'CETAK_KEMBALI_TOKO',
      entitas: 'surat_kembali_toko',
      entitasId: noDokumen,
      deskripsi: `Cetak surat pengembalian barang ${noDokumen}${totalUnit > 1 ? ' (kolektif)' : ' (per toko)'}: ${tickets.length} unit dikembalikan ke ${toko.kodeToko} — ${toko.namaToko}`,
      aktor,
    })
    await autoGitBackup('STTB_KEMBALI', 'service_request', noDokumen, aktor)

    return new NextResponse(pdfBytes as ArrayBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="Surat-Pengembalian-Barang-${noDokumen}.pdf"`,
        'Cache-Control': 'no-store',
        'X-Sttb-Kembali-No': noDokumen,
      },
    })
  } catch (error) {
    console.error('Surat pengembalian error:', error)
    return NextResponse.json({ error: 'Gagal membuat surat pengembalian barang' }, { status: 500 })
  }
}
