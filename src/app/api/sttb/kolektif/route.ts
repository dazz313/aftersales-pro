import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { autoGitBackup } from '@/lib/git-backup'
import { getActiveSession } from '@/lib/auth-server'
import QRCode from 'qrcode'

/**
 * API STTB Kolektif per Toko (pick up unit).
 * Satu dokumen merangkum tiket siap pick up dari 1 toko yang sama:
 * tiket REQUEST/PROSES + masih di toko + sudah ber-STTB.
 *
 * Mode tambahan (jawaban kebutuhan tarik PARSIAL):
 *  `tandaiDitarik: true` → tiket yang di-CENTANG dan memenuhi aturan
 *  TARIK_WORKSHOP langsung ditandai terealisasi (SELECT → TARIK_WORKSHOP,
 *  lokasiUnit WORKSHOP) dan dibubuhkan nomor STTB-kolektif ini (noSttbKolektif)
 *  — kertas STTBK pertama-tama memberi nomor dokumen sesuai unit yang
 *  benar-benar ditarik, bukan seluruh daftar ready. Tiket yang tidak
 *  memenuhi aturan (part belum READY dsb.) tetap tercetak sebagai
 *  KEMBARAN list tanpa ditandai — jumlah diterapkan/dilewati dikirim via
 *  header X-Sttb-Marked / X-Sttb-Skipped.
 *
 * POST /api/sttb/kolektif
 * Body: { noTiket: string[], tandaiDitarik?: boolean }
 * → PDF A4 portrait (attachment). Menolak bila beda toko / belum siap pick up.
 */
export async function POST(request: Request) {
  try {
    const session = await getActiveSession(request)
    if (!session) {
      return NextResponse.json({ error: 'Sesi berakhir atau akun nonaktif. Silakan login ulang.' }, { status: 401 })
    }
    const aktor = session?.nama ?? 'SYSTEM'

    const body = (await request.json().catch(() => null)) as { noTiket?: unknown[]; tandaiDitarik?: unknown } | null
    const tandaiDitarik = body?.tandaiDitarik === true
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
        parts: { select: { statusPart: true } },
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

    // Syarat pick up: unit masih di toko + sudah ber-STTB (STTB terbit sejak
    // request part, tidak menunggu part datang). Status REQUEST (menunggu
    // part) maupun PROSES boleh ikut — yang penting belum ditarik/selesai.
    const takSiap = tickets.filter(
      (t) => (t.status !== 'REQUEST' && t.status !== 'PROSES') || t.lokasiUnit !== 'TOKO' || !t.noSttb
    )
    if (takSiap.length > 0) {
      return NextResponse.json(
        {
          error: `Belum siap pick up: ${takSiap.map((t) => `${t.noTiket} (${t.status}${!t.noSttb ? ', tanpa STTB — input part dulu' : ''}${t.lokasiUnit !== 'TOKO' ? ', unit tidak di toko' : ''})`).join(', ')}. STTB kolektif hanya untuk tiket REQUEST/PROSES ber-STTB yang unitnya masih di toko.`,
        },
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
      where: { aksi: 'CETAK_STTB_KOLEKTIF', createdAt: { gte: startOfDay } },
    })
    const noKolektif = `STTBK-${ymd}-${String(usedToday + 1).padStart(4, '0')}`
    const tglCetak = today.toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' })

    const totalUnit = tickets.length
    const qrPayload = `STTBK:${noKolektif}|TOKO:${toko.kodeToko}|UNIT:${totalUnit}|TGL:${ymd}`
    const qrDataUrl = await QRCode.toDataURL(qrPayload, { width: 200, margin: 1 })

    const pdfBytes = await buatPdfKolektif({
      tickets,
      toko,
      noKolektif,
      tglCetak,
      today,
      qrDataUrl,
      namaWorkshop,
      alamatWorkshop,
      emailWorkshop,
    })

    // ===== Opsional: sahkan yang ditarik — kertas = realita (tarik parsial) =====
    // Hanya tiket yang memenuhi aturan TARIK_WORKSHOP (part semua READY, belum
    // FINISH, penanganan belum saat PROSES) yang ditandai; sisanya cukup
    // tercetak di dokumen tanpa perubahan status.
    let diterapkan = 0
    if (tandaiDitarik) {
      const siap = tickets.filter(
        (t) =>
          (t.status === 'REQUEST' || t.status === 'PROSES') &&
          t.lokasiUnit === 'TOKO' &&
          !!t.noSttb &&
          t.parts.length > 0 &&
          t.parts.every((p) => p.statusPart === 'READY') &&
          (t.status === 'REQUEST' ? true : t.penanganan === 'BELUM')
      )
      if (siap.length > 0) {
        await db.$transaction(async (tx) => {
          for (const t of siap) {
            await tx.serviceRequest.update({
              where: { id: t.id },
              data: {
                status: 'PROSES',
                noSttb: t.noSttb,
                penanganan: 'TARIK_WORKSHOP',
                lokasiUnit: 'WORKSHOP',
                slaFlag: false,
                noSttbKolektif: noKolektif,
              },
            })
          }
        })
        diterapkan = siap.length
        await logAudit({
          aksi: 'SAHKAN_TARIK_KOLEKTIF',
          entitas: 'service_request',
          entitasId: noKolektif,
          deskripsi: `STTB kolektif ${noKolektif} disahkan ditarik: ${siap.length}/${tickets.length} unit (${siap.map((t) => t.noTiket).join(', ')}) — lokasi unit → WORKSHOP, Penanganan (STTB) ikut nomor dokumen`,
          aktor,
        })
      }
    }

    await logAudit({
      aksi: 'CETAK_STTB_KOLEKTIF',
      entitas: 'sttb_kolektif',
      entitasId: noKolektif,
      deskripsi: `Cetak STTB kolektif ${noKolektif}: ${tickets.length} unit siap pick up dari ${toko.kodeToko} — ${toko.namaToko}${tandaiDitarik ? ` · ${diterapkan} disahkan ditarik` : ''}`,
      aktor,
    })
    await autoGitBackup('STTB_KOLEKTIF' + (tandaiDitarik ? '_SAHKAN' : ''), 'service_request', noKolektif, aktor)

    return new NextResponse(pdfBytes as ArrayBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="Surat-Tanda-Terima-${noKolektif}.pdf"`,
        'Cache-Control': 'no-store',
        'X-Sttb-Kolektif-No': noKolektif,
        'X-Sttb-Marked': String(diterapkan),
        'X-Sttb-Skipped': String(tickets.length - diterapkan),
      },
    })
  } catch (error) {
    console.error('STTB kolektif error:', error)
    return NextResponse.json({ error: 'Gagal membuat STTB kolektif' }, { status: 500 })
  }
}


// ============ PDF A4 portrait — dibungkus fungsi agar POST & GET (cetak
// ulang) memakai builder yang sama. Isi identik dengan cetakan pertama. ============
interface TiketPdfKolektif {
  noTiket: string
  deskripsiKerusakan?: string | null
  unitAsset: { serialNumber: string; modelUnit: string }
}
interface TokoPdfKolektif { kodeToko: string; namaToko: string; alamat?: string | null }

async function buatPdfKolektif(param: {
  tickets: TiketPdfKolektif[]
  toko: TokoPdfKolektif
  noKolektif: string
  tglCetak: string
  today: Date
  qrDataUrl: string
  namaWorkshop: string
  alamatWorkshop: string
  emailWorkshop: string
}): Promise<ArrayBuffer> {
  const jsPDFModule = await import('jspdf')
  const jsPDF = jsPDFModule.jsPDF
  const { tickets, toko, noKolektif, tglCetak, today, qrDataUrl } = param
  const namaWorkshop = param.namaWorkshop || 'Workshop'
  const alamatWorkshop = param.alamatWorkshop || '-'
  const emailWorkshop = param.emailWorkshop || ''

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
    // Kiri: judul + No. dokumen. Kanan: nama + alamat + email perusahaan.
    doc.text('SURAT TANDA TERIMA BARANG', M, T + 12)
    doc.setFontSize(9)
    doc.setFont('helvetica', 'normal')
    doc.text(`No. ${noKolektif}`, M, T + 20)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    doc.text(namaWorkshop, pageW - M, T + 11, { align: 'right' })
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.text(alamatWorkshop, pageW - M, T + 17, { align: 'right', maxWidth: 100 })
    if (emailWorkshop) doc.text(emailWorkshop, pageW - M, T + 22, { align: 'right', maxWidth: 110 })
    // Garis pemisah kop — isi surat
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

  // Satu baris per UNIT. Kolom No. STTB dihapus (nomor sudah satu per
  // dokumen di kop). Bahasa manusia: deskripsi kerusakan, bukan kode part.
  const cols: { title: string; x: number; w: number }[] = [
    { title: 'No', x: M, w: 8 },
    { title: 'No. Tiket', x: M + 8, w: 32 },
    { title: 'Serial Number', x: M + 40, w: 28 },
    { title: 'Model Unit', x: M + 68, w: 36 },
    { title: 'Deskripsi Kerusakan', x: M + 104, w: 76 },
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
  const totalUnit = tickets.length
  for (const t of tickets) {
    const cModel = wrap2(t.unitAsset.modelUnit, cols[3].w - 2)
    const cRusak = wrap2(t.deskripsiKerusakan?.trim() || '-', cols[4].w - 2)
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
    cRusak.forEach((ln, i) => doc.text(ln, cols[4].x + 1.5, yy(i)))
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
  doc.text(`TOTAL — ${totalUnit} unit siap pick up`, cols[1].x + 1.5, y)
  y += 14
  doc.setFont('helvetica', 'normal')

  // Tanda tangan: penyerah (toko) & pengambil (workshop)
  // Pindah halaman bila sisa ruang tidak cukup untuk blok TTD + tanggal kembali
  if (y > pageH - 70) {
    doc.addPage()
    drawPageHeader()
    y += 2
  }
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
  // Tanggal dikembalikan ke toko — ditulis di dokumen agar tak perlu tulis tangan
  y += 12
  doc.setFontSize(10)
  doc.setTextColor(30, 41, 59)
  doc.text('Tanggal dikembalikan :', M, y)
  doc.setDrawColor(100, 116, 139)
  doc.line(M + 52, y, M + 102, y)
  doc.text('Paraf :', M + 112, y)
  doc.line(M + 130, y, M + 165, y)

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

  return doc.output('arraybuffer')
}

// ============ GET — riwayat & cetak ulang STTB kolektif ============
/**
 * GET /api/sttb/kolektif?noDokumen=STTBK-YYYYMMDD-NNNN&format=pdf
 *   → Cetak ulang dengan nomor SAMA (tidak membuat dokumen baru; tidak ada
 *     efek status apapun ke tiket). Dicari dari tiket yang membawa nomor ini
 *     di kolom noSttbKolektif. Aturan kelayakan pick up TIDAK dikenakan
 *     (status tiket sudah terlanjut — justru itu alasan cetak ulang).
 * GET /api/sttb/kolektif?noTiket=A,B,C → JSON riwayat bundel tiket.
 */
export async function GET(request: Request) {
  try {
    const session = await getActiveSession(request)
    if (!session) {
      return NextResponse.json({ error: 'Sesi berakhir atau akun nonaktif. Silakan login ulang.' }, { status: 401 })
    }
    const aktor = session?.nama ?? 'SYSTEM'

    const { searchParams } = new URL(request.url)
    const noDokumen = (searchParams.get('noDokumen') || '').trim()
    const noTiketRaw = (searchParams.get('noTiket') || '').trim()
    const format = searchParams.get('format')

    if (!noDokumen && !noTiketRaw) {
      return NextResponse.json({ error: 'Berikan noDokumen (cetak ulang) atau noTiket (riwayat)' }, { status: 400 })
    }

    if (noDokumen) {
      if (format !== 'pdf') {
        return NextResponse.json({ error: 'Sertakan format=pdf untuk cetak ulang' }, { status: 400 })
      }
      const tickets = await db.serviceRequest.findMany({
        where: { noSttbKolektif: noDokumen },
        include: { unitAsset: { include: { toko: true } } },
        orderBy: { noTiket: 'asc' },
      })
      if (tickets.length === 0) {
        return NextResponse.json({ error: 'Dokumen STTBK tidak ditemukan / belum pernah disahkan' }, { status: 404 })
      }
      const toko = tickets[0].unitAsset.toko
      if (!toko) {
        return NextResponse.json({ error: 'Dokumen ini tidak punya toko yang sah — cek data tiket.' }, { status: 409 })
      }
      const settings = await db.pengaturan.findMany()
      const sv: Record<string, string> = {}
      for (const row of settings) sv[row.kunci] = row.nilai
      const ymdDok = noDokumen.slice(6, 14) // STTBK-YYYYMMDD-NNNN → ymd
      const tglCetak = new Date(`${ymdDok.slice(0, 4)}-${ymdDok.slice(4, 6)}-${ymdDok.slice(6, 8)}`).toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' })
      const totalUnit = tickets.length
      const qrPayload = `STTBK:${noDokumen}|TOKO:${toko.kodeToko}|UNIT:${totalUnit}|TGL:${ymdDok}`
      const qrDataUrl = await QRCode.toDataURL(qrPayload, { width: 200, margin: 1 })

      const pdfBytes = await buatPdfKolektif({
        tickets,
        toko,
        noKolektif: noDokumen,
        tglCetak,
        today: new Date(),
        qrDataUrl,
        namaWorkshop: sv['nama_perusahaan'] ?? 'Workshop',
        alamatWorkshop: sv['alamat_perusahaan'] ?? '-',
        emailWorkshop: (sv['email_perusahaan'] ?? '').trim(),
      })
      await logAudit({
        aksi: 'CETAK_STTBK_ULANG',
        entitas: 'sttb_kolektif',
        entitasId: noDokumen,
        deskripsi: `Cetak ulang STTB kolektif ${noDokumen}: ${tickets.length} unit — nomor sama dengan dokumen asli`,
        aktor,
      })
      return new NextResponse(pdfBytes as ArrayBuffer, {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="Surat-Tanda-Terima-${noDokumen}.pdf"`,
          'Cache-Control': 'no-store',
          'X-Sttb-Marked': '0',
        },
      })
    }

    // ===== Riwayat bundel untuk tiket terpilih =====
    const daftar = noTiketRaw.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 100)
    if (daftar.length === 0) {
      return NextResponse.json({ error: 'noTiket kosong' }, { status: 400 })
    }
    const tiket = await db.serviceRequest.findMany({
      where: { noTiket: { in: daftar } },
      select: { noTiket: true, noSttbKolektif: true },
    })
    const dokumen = tiket.map((t) => ({
      noTiket: t.noTiket,
      sttbKolektif: t.noSttbKolektif
        ? {
            nomor: t.noSttbKolektif,
            link: `/api/sttb/kolektif?noDokumen=${t.noSttbKolektif}&format=pdf`,
          }
        : null,
    }))
    return NextResponse.json(dokumen)
  } catch (error) {
    console.error('STTB kolektif GET error:', error)
    return NextResponse.json({ error: 'Gagal memuat riwayat/cetak ulang STTB kolektif' }, { status: 500 })
  }
}
