import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { autoGitBackup } from '@/lib/git-backup'
import { getActiveSession } from '@/lib/auth-server'
import QRCode from 'qrcode'

/**
 * API STTB Kolektif per Toko (pick up unit).
 * Satu dokumen merangkum SEMUA tiket siap pick up dari 1 toko yang sama:
 * tiket PROSES + masih di toko + penanganan BELUM + sudah ber-STTB
 * (STTB otomatis terbit saat kode+nama part READY).
 *
 * POST /api/sttb/kolektif
 * Body: { noTiket: string[] }
 * → PDF A4 portrait (attachment). Menolak bila beda toko / belum siap pick up.
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
      return NextResponse.json({ error: 'Pilih minimal 1 tiket untuk STTB kolektif' }, { status: 400 })
    }
    if (noTiketList.length > 100) {
      return NextResponse.json({ error: 'Maksimal 100 tiket per STTB kolektif' }, { status: 400 })
    }

    const tickets = await db.serviceRequest.findMany({
      where: { noTiket: { in: noTiketList } },
      include: {
        unitAsset: { include: { toko: true } },
        parts: { include: { sparepart: true } },
      },
      orderBy: { noTiket: 'asc' },
    })
    const foundSet = new Set(tickets.map((t) => t.noTiket))
    const missing = noTiketList.filter((n) => !foundSet.has(n))
    if (missing.length > 0) {
      return NextResponse.json({ error: `Tiket tidak ditemukan: ${missing.slice(0, 5).join(', ')}` }, { status: 404 })
    }

    // Wajib 1 toko yang sama
    const tokoIds = new Set(tickets.map((t) => t.unitAsset.tokoId ?? 0))
    if (tokoIds.size !== 1 || tickets[0].unitAsset.tokoId == null) {
      return NextResponse.json(
        { error: 'STTB kolektif merangkum 1 toko — centang tiket dari toko yang sama.' },
        { status: 400 }
      )
    }
    const toko = tickets[0].unitAsset.toko!

    // Wajib siap pick up: PROSES + masih di toko + penanganan BELUM + sudah ber-STTB
    const takSiap = tickets.filter(
      (t) => t.status !== 'PROSES' || t.lokasiUnit !== 'TOKO' || t.penanganan !== 'BELUM' || !t.noSttb
    )
    if (takSiap.length > 0) {
      return NextResponse.json(
        {
          error: `Belum siap pick up: ${takSiap.map((t) => `${t.noTiket} (${t.status}${!t.noSttb ? ', tanpa STTB' : ''})`).join(', ')}. STTB kolektif hanya untuk tiket PROSES ber-STTB yang unitnya masih di toko.`,
        },
        { status: 409 }
      )
    }

    const settings = await db.pengaturan.findMany()
    const s: Record<string, string> = {}
    for (const row of settings) s[row.kunci] = row.nilai
    const namaWorkshop = s['nama_perusahaan'] ?? 'Workshop'
    const alamatWorkshop = s['alamat_perusahaan'] ?? '-'
    const kontakWorkshop = [(s['email_perusahaan'] ?? '').trim(), (s['telepon_perusahaan'] ?? '').trim()].filter(Boolean).join(' • ')

    const today = new Date()
    const ymd = today.toISOString().slice(0, 10).replace(/-/g, '')
    const startOfDay = new Date(today)
    startOfDay.setHours(0, 0, 0, 0)
    const usedToday = await db.auditLog.count({
      where: { aksi: 'CETAK_STTB_KOLEKTIF', createdAt: { gte: startOfDay } },
    })
    const noKolektif = `STTBK-${ymd}-${String(usedToday + 1).padStart(4, '0')}`
    const tglCetak = today.toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' })

    const totalQty = tickets.reduce((a, t) => a + t.parts.reduce((x, p) => x + p.qty, 0), 0)
    const qrPayload = `STTBK:${noKolektif}|TOKO:${toko.kodeToko}|TIKET:${tickets.length}|QTY:${totalQty}|TGL:${ymd}`
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
      doc.setFillColor(30, 41, 59)
      doc.rect(0, 0, pageW, 34, 'F')
      doc.setTextColor(255, 255, 255)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(15)
      doc.text('STTB KOLEKTIF — PICK UP UNIT', pageW / 2, 12, { align: 'center' })
      doc.setFontSize(9)
      doc.setFont('helvetica', 'normal')
      doc.text(namaWorkshop, pageW / 2, 19, { align: 'center' })
      doc.setFontSize(8)
      doc.text(alamatWorkshop, pageW / 2, 24, { align: 'center', maxWidth: 150 })
      if (kontakWorkshop) doc.text(kontakWorkshop, pageW / 2, 29, { align: 'center', maxWidth: 150 })
      doc.setTextColor(30, 41, 59)
      y = 42
    }
    drawPageHeader()

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(12)
    doc.text(`No. Dokumen : ${noKolektif}`, M, y)
    doc.addImage(qrDataUrl, 'PNG', pageW - M - 24, y - 7, 24, 24)
    doc.setFontSize(9)
    doc.setFont('helvetica', 'normal')
    y += 6
    doc.text(`Tanggal       : ${tglCetak}`, M, y)
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

    const cols: { title: string; x: number; w: number }[] = [
      { title: 'No', x: M, w: 8 },
      { title: 'No. Tiket', x: M + 8, w: 30 },
      { title: 'No. STTB', x: M + 38, w: 30 },
      { title: 'Serial Number', x: M + 68, w: 26 },
      { title: 'Model Unit', x: M + 94, w: 34 },
      { title: 'Kode + Nama Part', x: M + 128, w: 52 },
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
      const partText = t.parts.length === 0
        ? '-'
        : t.parts.map((p) => `${p.sparepart.kodePart} · ${p.sparepart.namaPart} ×${p.qty}`).join(' ; ')
      const cModel = wrap2(t.unitAsset.modelUnit, cols[4].w - 2)
      const cPart = wrap2(partText, cols[5].w - 2)
      const rowH = Math.max(cModel.length, cPart.length) > 1 ? 11 : 6
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
      doc.text(fit(t.noSttb ?? '-', cols[2].w - 2), cols[2].x + 1.5, y)
      doc.text(fit(t.unitAsset.serialNumber, cols[3].w - 2), cols[3].x + 1.5, y)
      cModel.forEach((ln, i) => doc.text(ln, cols[4].x + 1.5, yy(i)))
      cPart.forEach((ln, i) => doc.text(ln, cols[5].x + 1.5, yy(i)))
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
    doc.text(`TOTAL — ${tickets.length} unit siap pick up / ${totalQty} pcs part`, cols[1].x + 1.5, y)
    y += 14
    doc.setFont('helvetica', 'normal')

    // Tanda tangan: penyerah (toko) & pengambil (workshop)
    const colW = (pageW - 2 * M) / 2
    doc.setTextColor(30, 41, 59)
    doc.setFontSize(10)
    doc.text('Diserahkan (Toko)', M + colW / 2, y, { align: 'center' })
    doc.text('Diambil (Workshop)', M + colW + colW / 2, y, { align: 'center' })
    y += 20
    doc.setDrawColor(100, 116, 139)
    doc.line(M + colW / 2 - 30, y, M + colW / 2 + 30, y)
    doc.line(M + colW + colW / 2 - 30, y, M + colW + colW / 2 + 30, y)
    y += 5
    doc.setFontSize(8)
    doc.setTextColor(100, 116, 139)
    doc.text(`${toko.kodeToko} — ${toko.namaToko}`, M + colW / 2, y, { align: 'center' })
    doc.text('Nama & TTD', M + colW + colW / 2, y, { align: 'center' })

    const nPages = doc.getNumberOfPages()
    for (let i = 1; i <= nPages; i++) {
      doc.setPage(i)
      doc.setFontSize(7)
      doc.setTextColor(130, 130, 130)
      doc.text(
        `${noKolektif} · Digenerate otomatis oleh Sistem After-Sales pada ${today.toLocaleString('id-ID')}`,
        M,
        pageH - 5
      )
      doc.text(`Halaman ${i} dari ${nPages}`, pageW - M, pageH - 5, { align: 'right' })
    }

    const pdfBytes = doc.output('arraybuffer')

    await logAudit({
      aksi: 'CETAK_STTB_KOLEKTIF',
      entitas: 'sttb_kolektif',
      entitasId: noKolektif,
      deskripsi: `Cetak STTB kolektif ${noKolektif}: ${tickets.length} unit siap pick up dari ${toko.kodeToko} — ${toko.namaToko}`,
      aktor,
    })
    await autoGitBackup('STTB_KOLEKTIF', 'service_request', noKolektif, aktor)

    return new NextResponse(pdfBytes as ArrayBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="STTB-Kolektif-${noKolektif}.pdf"`,
        'Cache-Control': 'no-store',
        'X-Sttb-Kolektif-No': noKolektif,
      },
    })
  } catch (error) {
    console.error('STTB kolektif error:', error)
    return NextResponse.json({ error: 'Gagal membuat STTB kolektif' }, { status: 500 })
  }
}
