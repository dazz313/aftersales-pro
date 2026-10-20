import { NextResponse } from 'next/server'
import QRCode from 'qrcode'
import * as XLSX from 'xlsx'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { autoGitBackup } from '@/lib/git-backup'
import { requireActiveSession } from '@/lib/auth-server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Satu route, dua peran:
 * - POST — Surat Jalan REQUEST part ke Produsen (keluar). Dipanggil dialog
 *   cetak "Surat Jalan" di Service Tiket. Setiap unduhan: (1) data request
 *   DISIMPAN sebagai dokumen SJR-YYYYMMDD-NNNN (snapshot tiket + part + qty
 *   + toko + serial/model); (2) tiket ditandai `tglRequestPart` (request
 *   pertama yang menang) → tampil di bawah badge REQUEST; (3) dokumen
 *   PDF/Excel dibuat dengan baris "Tanggal Request :" tepat di bawah judul.
 *   Body: { noTiket: string[], format?: 'pdf' | 'xlsx' } — tanpa format → JSON.
 * - GET — riwayat 10 dokumen request terakhir PLUS cross-check ke surat
 *   jalan masuk: diterima (pasangan kode|tiket ada di SJ DITERAPKAN),
 *   dicatat (di DRAF/DIPERIKSA), belum (tak ada jejakkiriman).
 */

interface ItemBaris {
  serviceRequestId: number | null
  noTiket: string
  kodePart: string
  namaPart: string
  qty: number
  toko: string
  serialNumber: string
  modelUnit: string
}

const NORM = (s: string) => (s || '').toUpperCase().replace(/[^A-Z0-9#]/g, '')

export async function POST(request: Request) {
  try {
    const { session, denied } = await requireActiveSession(request)
    if (denied) return denied
    const aktor = session?.nama ?? 'SYSTEM'

    const body = (await request.json().catch(() => null)) as
      | { noTiket?: unknown[]; format?: unknown; produsen?: unknown }
      | null
    const noTiketList: string[] = Array.isArray(body?.noTiket)
      ? [...new Set(body.noTiket.map((s: unknown) => String(s).trim()).filter(Boolean))]
      : []
    if (noTiketList.length === 0) {
      return NextResponse.json({ error: 'Pilih minimal 1 tiket untuk surat jalan request' }, { status: 400 })
    }
    if (noTiketList.length > 100) {
      return NextResponse.json({ error: 'Maksimal 100 tiket per surat jalan request' }, { status: 400 })
    }
    // Produsen tujuan surat ("Kepada: PT ...") — input dialog, atau saran merk
    // unit dari klien bila kosong; hanya dicatat, tidak divalidasi ke master.
    const produsenTujuan =
      typeof body?.produsen === 'string' ? body.produsen.trim().slice(0, 120) : ''
    const format = body?.format === 'xlsx' ? 'xlsx' : body?.format === 'pdf' ? 'pdf' : null

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
      return NextResponse.json(
        { error: `Tiket tidak ditemukan: ${missing.slice(0, 5).join(', ')}` },
        { status: 404 }
      )
    }

    // Snapshot item — hanya part dengan kode+nama lengkap (yang belum keisi
    // komunikasi part dilewatkan; angka lewatnya ikut dilaporkan di dokumen).
    const items: ItemBaris[] = []
    let lewatTanpaKode = 0
    for (const t of tickets) {
      for (const p of t.parts) {
        const kode = (p.sparepart?.kodePart ?? '').trim()
        const nama = (p.sparepart?.namaPart ?? '').trim()
        if (!kode || !nama) {
          lewatTanpaKode++
          continue
        }
        items.push({
          serviceRequestId: t.id,
          noTiket: t.noTiket,
          kodePart: kode,
          namaPart: nama,
          qty: p.qty,
          toko: t.unitAsset.toko?.namaToko ?? '-',
          serialNumber: t.unitAsset.serialNumber || '-',
          modelUnit: t.unitAsset.modelUnit || '-',
        })
      }
    }
    if (items.length === 0) {
      return NextResponse.json(
        { error: 'Tiket terpilih belum punya part dengan kode+nama. Lengkapi part di tiket dulu.' },
        { status: 400 }
      )
    }

    // Nomor dokumen harian: SJR-YYYYMMDD-NNNN (tiap unduhan = 1 dokumen baru —
    // riwayat lengkap, tgl request tiket tidak diubah ulang setelah terisi).
    const now = new Date()
    const ymd = now.toISOString().slice(0, 10).replace(/-/g, '')
    const startOfDay = new Date(now)
    startOfDay.setHours(0, 0, 0, 0)
    const usedToday = await db.suratJalanRequest.count({
      where: { tglRequest: { gte: startOfDay } },
    })
    const noSurat = `SJR-${ymd}-${String(usedToday + 1).padStart(4, '0')}`
    const totalQty = items.reduce((a, i) => a + (i.qty || 1), 0)

    const sjr = await db.suratJalanRequest.create({
      data: {
        noSurat,
        tglRequest: now,
        produsenTujuan: produsenTujuan || null,
        dibuatOleh: aktor,
        totalTiket: tickets.length,
        totalItem: items.length,
        totalQty,
        lewatTanpaKode,
        items: {
          create: items.map((i) => ({
            serviceRequestId: i.serviceRequestId,
            noTiket: i.noTiket,
            kodePart: i.kodePart,
            namaPart: i.namaPart,
            qty: i.qty,
            toko: i.toko,
            serialNumber: i.serialNumber,
            modelUnit: i.modelUnit,
          })),
        },
      },
    })

    // Tandai tiket — tgl request ditampilkan di bawah badge REQUEST.
    await db.serviceRequest.updateMany({
      where: { noTiket: { in: noTiketList }, tglRequestPart: null },
      data: { tglRequestPart: now },
    })

    await logAudit({
      aksi: 'CETAK_SJ_REQUEST',
      entitas: 'surat_jalan_request',
      entitasId: noSurat,
      deskripsi: `Surat jalan request part: ${tickets.length} tiket · ${items.length} item · ${totalQty} pcs${lewatTanpaKode ? ` · ${lewatTanpaKode} part lewat (kode/nama kurang)` : ''}`,
      aktor,
    })
    await autoGitBackup('CREATE', 'surat_jalan_request', noSurat, aktor)

    if (!format) {
      return NextResponse.json({
        ok: true,
        id: sjr.id,
        noSurat,
        tglRequest: now,
        totalItem: items.length,
        totalQty,
        lewatTanpaKode,
      })
    }

    const settings = await db.pengaturan.findMany()
    const s: Record<string, string> = {}
    for (const row of settings) s[row.kunci] = row.nilai
    const infoToko = {
      nama: s['nama_perusahaan'] ?? 'Workshop',
      alamat: s['alamat_perusahaan'] ?? '-',
      email: (s['email_perusahaan'] ?? '').trim(),
    }

    if (format === 'pdf') {
      const pdf = await buatPdf({ noSurat, tglRequest: now, items, infoToko, totalQty, produsenTujuan, dibuatOleh: aktor })
      return new NextResponse(pdf, {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="Surat-Jalan-Request-${noSurat}.pdf"`,
        },
      })
    }
    const xlsx = buatXlsx({ noSurat, tglRequest: now, items, totalQty, lewatTanpaKode, produsenTujuan })
    return new NextResponse(xlsx, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="Surat-Jalan-Request-${noSurat}.xlsx"`,
      },
    })
  } catch (error) {
    console.error('Surat jalan REQUEST error:', error)
    return NextResponse.json({ error: 'Gagal membuat surat jalan request' }, { status: 500 })
  }
}

// ============ PDF A4 landscape (jspdf) — kop + Tanggal Request + tabel ============
async function buatPdf(param: {
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

// ============ XLSX — 2 sheet: Request (baris) + Ringkasan (per toko) ============
function buatXlsx(param: {
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

// ===== GET — riwayat 10 dokumen request + cross-check ke surat jalan masuk =====
// diterima = pasangan kode|tiket ada di SJ DITERAPKAN (resmi, tglPartDatang terisi)
// dicatat  = pasangan ada di SJ DRAF/DIPERIKSA (produsen tandai kirim, menunggu cek → terapkan)
// belum    = tak ada jejak kiriman
export async function GET(request: Request) {
  try {
    const { denied } = await requireActiveSession(request)
    if (denied) return denied

    const [sjs, masuk] = await Promise.all([
      db.suratJalanRequest.findMany({
        orderBy: { tglRequest: 'desc' },
        take: 10,
        include: { items: { orderBy: { id: 'asc' } } },
      }),
      db.suratJalanMasuk.findMany({
        orderBy: { createdAt: 'desc' },
        take: 60,
        select: {
          noSuratJalan: true,
          status: true,
          refSjrNo: true,
          items: { select: { kodePart: true, cocokTiketId: true } },
        },
      }),
    ])

    // Dua keranjang pencocokan: resmi diterima (DITERAPKAN) vs baru dicatat
    // (DRAF/DIPERIKSA) — tiap keranjang memuat pasangan kode|tiket + daftar kode.
    const diterima = { pair: new Set<string>(), kode: new Set<string>() }
    const dicatat = { pair: new Set<string>(), kode: new Set<string>() }
    for (const s of masuk) {
      const target = s.status === 'DITERAPKAN' ? diterima : dicatat
      for (const it of s.items) {
        const kode = NORM(it.kodePart)
        target.kode.add(kode)
        target.pair.add(`${kode}|${it.cocokTiketId ?? 'x'}`)
      }
    }
    const cocok = (serviceRequestId: number | null, kodePart: string, b: typeof diterima): boolean => {
      const kode = NORM(kodePart)
      return b.pair.has(`${kode}|${serviceRequestId ?? 'x'}`) || (serviceRequestId == null && b.kode.has(kode))
    }

    const hasil = sjs.map((s) => {
      let nDiterima = 0
      let nDicatat = 0
      const belum: { noTiket: string; kodePart: string; namaPart: string }[] = []
      for (const it of s.items) {
        if (cocok(it.serviceRequestId, it.kodePart, diterima)) nDiterima++
        else if (cocok(it.serviceRequestId, it.kodePart, dicatat)) nDicatat++
        else belum.push({ noTiket: it.noTiket, kodePart: it.kodePart, namaPart: it.namaPart ?? '' })
      }
      return {
        noSurat: s.noSurat,
        tglRequest: s.tglRequest,
        dibuatOleh: s.dibuatOleh,
        totalTiket: s.totalTiket,
        totalItem: s.totalItem,
        totalQty: s.totalQty,
        lewatTanpaKode: s.lewatTanpaKode,
        diterima: nDiterima,
        dicatat: nDicatat,
        belum: belum.length,
        contohBelum: belum.slice(0, 8),
      }
    })

    return NextResponse.json(hasil)
  } catch (error) {
    console.error('Surat jalan REQUEST GET error:', error)
    return NextResponse.json({ error: 'Gagal memuat riwayat request surat jalan' }, { status: 500 })
  }
}
