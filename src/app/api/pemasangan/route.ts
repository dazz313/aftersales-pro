import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { autoGitBackup } from '@/lib/git-backup'
import { requireActiveSession } from '@/lib/auth-server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Pemasangan Part (per Toko).
 *
 * GET  /api/pemasangan — dua kelompok:
 *   - siap    : part READY yang belum dipasang (syarat: tiket PROSES — unit
 *               ditarik, statusPart READY, bukan jawaban TIDAK_READY, kode+nama
 *               lengkap)
 *   - riwayat : part yang sudah dipasang 7 hari terakhir (tglPasang + oleh)
 *   Baris siap mentok ke toko — kelompokkan per toko di UI untuk dicentang.
 *
 * POST /api/pemasangan — SAHKAN PEMASANGAN
 *   body: { itemIds: number[], format?: 'pdf' }
 *   Menandai tglPasang=sekarang + pasangOleh di setiap item (sekali saja),
 *   lalu bila format=pdf menghasilkan Dokumen Pemasangan (per toko, dengan
 *   baris tanda tangan Workshop/Toko). Tanpa format → JSON ringkasan.
 */

const NORM = (s: string) => (s || '').toUpperCase().replace(/[^A-Z0-9#]/g, '')

// Nomor dokumen pemasangan selalu rekonstruksi dari waktu pasang asli —
// dipakai saat sahkan (menciptakan) maupun saat cetak ulang, sehingga
// cetakan ulang memakai nomor & waktu ASLI dokumen (bukan waktu cetak).
const pmsDocNo = (waktu: Date): string =>
  `PMS-${waktu.toISOString().slice(0, 10).replace(/-/g, '')}-${String(waktu.getHours()).padStart(2, '0')}${String(waktu.getMinutes()).padStart(2, '0')}`

export async function GET(request: Request) {
  try {
    const { denied } = await requireActiveSession(request)
    if (denied) return denied

    // Tiket SEMUA diambil — saring di bawah: siap = tiket PROSES;
    // riwayat = sejarah nyata (termasuk tiket yang kini sudah FINISH).
    const tickets = await db.serviceRequest.findMany({
      select: {
        noTiket: true,
        status: true,
        lokasiUnit: true,
        unitAsset: {
          select: { serialNumber: true, modelUnit: true, merk: true, toko: { select: { kodeToko: true, namaToko: true } } },
        },
        parts: {
          include: { sparepart: { select: { kodePart: true, namaPart: true } } },
        },
      },
    })

    interface Baris {
      id: number
      noTiket: string
      statusTiket: string
      lokasiUnit: string
      kodeToko: string
      toko: string
      serial: string
      model: string
      kodePart: string
      namaPart: string
      qty: number
      tglPasang: Date | null
      pasangOleh: string | null
      docNo: string | null
    }
    const batasRiwayat = new Date(Date.now() - 7 * 24 * 3600 * 1000)
    const siap: Baris[] = []
    const riwayat: Baris[] = []
    for (const t of tickets) {
      for (const p of t.parts) {
        // Baris kembar yg di-nolkan saat gabung FINISH disembunyikan dari panel.
        if (p.qty <= 0) continue
        // Cache dulu (snapshot saat pemasangan/FINISH/koreksi) — statistik
        // stabil; fallback live master bila cache belum terstempel.
        const kode = (p.kodePartCache ?? p.sparepart?.kodePart ?? '').trim()
        const nama = (p.namaPartCache ?? p.sparepart?.namaPart ?? '').trim()
        if (!kode || !nama) continue
        const baris: Baris = {
          id: p.id,
          noTiket: t.noTiket,
          statusTiket: t.status,
          lokasiUnit: t.lokasiUnit,
          kodeToko: t.unitAsset.toko?.kodeToko ?? '-',
          toko: t.unitAsset.toko?.namaToko ?? '-',
          serial: t.unitAsset.serialNumber || '',
          model: t.unitAsset.modelUnit || '',
          kodePart: kode,
          namaPart: nama,
          qty: p.qty,
          tglPasang: p.tglPasang,
          pasangOleh: p.pasangOleh,
          docNo: p.tglPasang ? pmsDocNo(p.tglPasang) : null,
        }
        if (p.tglPasang) {
          if (p.tglPasang >= batasRiwayat) riwayat.push(baris)
          continue
        }
        // Lolos pemasangan HANYA bila tiket sudah PROSES (unit ditarik ke
        // workshop) dan part READY/diterima — tiket masih REQUEST tidak dihitung.
        if (t.status === 'PROSES' && p.statusPart === 'READY' && p.statusKonfirmasi !== 'TIDAK_READY') siap.push(baris)
      }
    }
    siap.sort((a, b) => a.toko.localeCompare(b.toko) || a.noTiket.localeCompare(b.noTiket) || NORM(a.kodePart).localeCompare(NORM(b.kodePart)))
    riwayat.sort((a, b) => new Date(b.tglPasang!).getTime() - new Date(a.tglPasang!).getTime())

    return NextResponse.json({ siap, riwayat })
  } catch (error) {
    console.error('Pemasangan GET error:', error)
    return NextResponse.json({ error: 'Gagal memuat data pemasangan part' }, { status: 500 })
  }
}

interface ItemDoc {
  noTiket: string
  toko: string
  serial: string
  model: string
  kodePart: string
  namaPart: string
  qty: number
}

export async function POST(request: Request) {
  try {
    const { session, denied } = await requireActiveSession(request)
    if (denied) return denied
    const aktor = session?.nama ?? 'SYSTEM'

    const body = (await request.json().catch(() => null)) as
      | { itemIds?: unknown[]; format?: unknown; cetakUlang?: unknown }
      | null
    const itemIds: number[] = Array.isArray(body?.itemIds)
      ? [...new Set(body.itemIds.map((x: unknown) => Number(x)).filter((n) => Number.isInteger(n) && n > 0))]
      : []
    if (itemIds.length === 0) return NextResponse.json({ error: 'Tidak ada item terpilih' }, { status: 400 })
    if (itemIds.length > 300) return NextResponse.json({ error: 'Maksimal 300 item per sahkan' }, { status: 400 })
    const format = body?.format === 'pdf' ? 'pdf' : null

    const rows = await db.serviceRequestPart.findMany({
      where: { id: { in: itemIds } },
      select: {
        id: true,
        qty: true,
        tglPasang: true,
        pasangOleh: true,
        kodePartCache: true,
        namaPartCache: true,
        sparepart: { select: { kodePart: true, namaPart: true } },
        serviceRequest: {
          select: {
            noTiket: true,
            status: true,
            lokasiUnit: true,
            unitAsset: { select: { serialNumber: true, modelUnit: true, toko: { select: { namaToko: true } } } },
          },
        },
      },
    })
    // ===== CETAK ULANG dokumen pemasangan (rusak/tercecer): regenerasi dengan
    // nomor & waktu ASLI dokumen, tanpa mengubah penanda pemasangan apa pun. =====
    if (body?.cetakUlang === true) {
      const belum = rows.filter((r) => !r.tglPasang)
      if (rows.length !== itemIds.length || belum.length > 0) {
        return NextResponse.json(
          { error: 'Ada item belum dipasang / tidak ditemukan — cetak ulang hanya untuk item yang sudah masuk Riwayat.' },
          { status: 400 },
        )
      }
      const waktuAsli = new Date(rows[0].tglPasang!)
      if (rows.some((r) => new Date(r.tglPasang!).getTime() !== waktuAsli.getTime())) {
        return NextResponse.json(
          { error: 'Item terpilih dari dokumen berbeda (waktu pasang tidak seragam) — pilih dokumen yang sama.' },
          { status: 400 },
        )
      }
      const olehAsli = rows[0].pasangOleh || aktor
      const docNo = pmsDocNo(waktuAsli)
      const barisDoc: ItemDoc[] = rows.map((r) => ({
        noTiket: r.serviceRequest.noTiket,
        toko: r.serviceRequest.unitAsset.toko?.namaToko ?? '-',
        serial: r.serviceRequest.unitAsset.serialNumber || '-',
        model: r.serviceRequest.unitAsset.modelUnit || '-',
        // Cache dulu (snapshot saat pemasangan/koreksi) — baris terpasang tetap
        // stabil walau master berubah; fallback live master bila belum ada cache.
        kodePart: (r.kodePartCache || r.sparepart?.kodePart || '-').trim(),
        namaPart: (r.namaPartCache || r.sparepart?.namaPart || '-').trim(),
        qty: r.qty,
      }))
      barisDoc.sort((a, b) => a.toko.localeCompare(b.toko) || a.noTiket.localeCompare(b.noTiket) || NORM(a.kodePart).localeCompare(NORM(b.kodePart)))
      await logAudit({
        aksi: 'CETAK_ULANG_PASANG',
        entitas: 'service_request_part',
        entitasId: docNo,
        deskripsi: `Cetak ulang dokumen pemasangan ${docNo}: ${rows.length} item`,
        aktor,
      })
      const sekarangCetakan = new Date()
      const catatanCetak = `Cetak ulang pada ${sekarangCetakan.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })} pukul ${sekarangCetakan.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}`
      const settingsUlang = await db.pengaturan.findMany()
      const sUlang: Record<string, string> = {}
      for (const rowSet of settingsUlang) sUlang[rowSet.kunci] = rowSet.nilai
      const pdf = await buatPdfPemasangan({
        docNo,
        waktu: waktuAsli,
        aktor: olehAsli,
        infoToko: {
          nama: sUlang['nama_perusahaan'] ?? 'Workshop',
          alamat: sUlang['alamat_perusahaan'] ?? '-',
          email: (sUlang['email_perusahaan'] ?? '').trim(),
        },
        baris: barisDoc,
        catatanCetak,
      })
      return new NextResponse(pdf, {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="Dokumen-Pemasangan-Ulang-${docNo}.pdf"`,
        },
      })
    }

    const belumProses = rows.filter((r) => r.serviceRequest.status !== 'PROSES')
    if (belumProses.length > 0) {
      const daftar = belumProses.map((r) => r.serviceRequest.noTiket).slice(0, 5).join(', ')
      return NextResponse.json(
        { error: `Tiket ${daftar}${belumProses.length > 5 ? ', …' : ''} belum masuk PROSES — hanya unit yang sudah ditarik (PROSES) yang bisa disahkan dipasang.` },
        { status: 400 },
      )
    }
    const target = rows.filter((r) => !r.tglPasang)
    if (target.length === 0) {
      return NextResponse.json({ error: 'Item terpilih sudah dipasang semua — lihat panel Riwayat.' }, { status: 400 })
    }

    const now = new Date()
    // Stamp per baris — cache kode/nama snapshot master saat pemasangan
    // (statistik tetap stabil walau master diubah nanti).
    for (const r of target) {
      await db.serviceRequestPart.update({
        where: { id: r.id },
        data: {
          tglPasang: now,
          pasangOleh: aktor,
          kodePartCache: r.sparepart?.kodePart?.trim() || null,
          namaPartCache: r.sparepart?.namaPart?.trim() || null,
        },
      })
    }

    const tokoUnik = new Set(target.map((r) => r.serviceRequest.unitAsset.toko?.namaToko ?? '-'))
    await logAudit({
      aksi: 'PASANG_PART',
      entitas: 'service_request_part',
      entitasId: `items:${target.length}`,
      deskripsi: `Pemasangan part disahkan: ${target.length} item · ${tokoUnik.size} toko · ${target.map((r) => r.serviceRequest.noTiket).slice(0, 5).join(', ')}${target.length > 5 ? ', …' : ''}`,
      aktor,
    })
    await autoGitBackup('UPDATE', 'service_request_part_pasang', String(target[0].id), aktor)

    if (!format) {
      return NextResponse.json({ ok: true, terpasang: target.length, toko: tokoUnik.size })
    }

    // Dokumen Pemasangan — nomor dari waktu sah (PMS-YYYYMMDD-HHMM), per toko
    // ber seksi dengan baris ttd Workshop/Toko.
    const docNo = pmsDocNo(now)
    const baris: ItemDoc[] = target.map((r) => ({
      noTiket: r.serviceRequest.noTiket,
      toko: r.serviceRequest.unitAsset.toko?.namaToko ?? '-',
      serial: r.serviceRequest.unitAsset.serialNumber || '-',
      model: r.serviceRequest.unitAsset.modelUnit || '-',
      // Baris baru — master live saat itu (cache baru juga distempel di atas).
      kodePart: (r.kodePartCache || r.sparepart?.kodePart || '-').trim(),
      namaPart: (r.namaPartCache || r.sparepart?.namaPart || '-').trim(),
      qty: r.qty,
    }))
    baris.sort((a, b) => a.toko.localeCompare(b.toko) || a.noTiket.localeCompare(b.noTiket) || NORM(a.kodePart).localeCompare(NORM(b.kodePart)))

    const settings = await db.pengaturan.findMany()
    const s: Record<string, string> = {}
    for (const row of settings) s[row.kunci] = row.nilai
    const infoToko = {
      nama: s['nama_perusahaan'] ?? 'Workshop',
      alamat: s['alamat_perusahaan'] ?? '-',
      email: (s['email_perusahaan'] ?? '').trim(),
    }

    const pdf = await buatPdfPemasangan({ docNo, waktu: now, aktor, infoToko, baris })
    return new NextResponse(pdf, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="Dokumen-Pemasangan-${docNo}.pdf"`,
      },
    })
  } catch (error) {
    console.error('Pemasangan POST error:', error)
    return NextResponse.json({ error: 'Gagal menyahkan pemasangan part' }, { status: 500 })
  }
}

// ===== PDF A4 landscape — Dokumen Pemasangan Part per toko (kode part utuh + kolom ceklis) =====
async function buatPdfPemasangan(param: {
  docNo: string
  waktu: Date
  aktor: string
  infoToko: { nama: string; alamat: string; email: string }
  baris: ItemDoc[]
  catatanCetak?: string | null
}): Promise<ArrayBuffer> {
  const jsPDFModule = await import('jspdf')
  const jsPDF = jsPDFModule.jsPDF
  const { docNo, waktu, aktor, infoToko, baris, catatanCetak } = param
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' })
  const pageW = doc.internal.pageSize.getWidth() // 297
  const pageH = doc.internal.pageSize.getHeight() // 210
  const M = 14
  const kanan = pageW - M
  const waktuText = `${waktu.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })} pukul ${waktu.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}`

  // Kop
  doc.setTextColor(30, 41, 59)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(13)
  doc.text('DOKUMEN PEMASANGAN PART', M, 18)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.text(`No. ${docNo}`, M, 24)
  doc.text(`Waktu Pemasangan : ${waktuText}`, M, 29)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.text(infoToko.nama, kanan, 16, { align: 'right' })
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.text(infoToko.alamat === '-' ? '' : infoToko.alamat, kanan, 21, { align: 'right', maxWidth: 90 })
  if (infoToko.email) doc.text(`Email: ${infoToko.email}`, kanan, 27, { align: 'right', maxWidth: 90 })
  doc.setDrawColor(30, 41, 59)
  doc.setLineWidth(0.8)
  doc.line(M, 33, kanan, 33)
  doc.setLineWidth(0.2)

  // Potong teks bila melebar
  const potong = (t: string, maxW: number): string => {
    if (doc.getTextWidth(t) <= maxW) return t
    let c = t
    while (c.length > 1 && doc.getTextWidth(c + '…') > maxW) c = c.slice(0, -1)
    return c + '…'
  }

  // Kode part UTUH (penting untuk cross-check): font diperkecil bila panjang — tidak pernah dipotong
  const tulisKode = (kode: string, maxW: number, x: number, yy: number): void => {
    let size = 8
    doc.setFontSize(size)
    while (size > 5 && doc.getTextWidth(kode) > maxW) {
      size -= 0.5
      doc.setFontSize(size)
    }
    doc.text(kode, x, yy)
    doc.setFontSize(8)
  }

  // Kelompokkan per toko
  const groupToko = new Map<string, ItemDoc[]>()
  for (const i of baris) {
    const arr = groupToko.get(i.toko) ?? []
    arr.push(i)
    groupToko.set(i.toko, arr)
  }

  const kolom: { title: string; x: number; w: number }[] = [
    { title: 'No', x: M, w: 8 },
    { title: 'No. Tiket', x: M + 8, w: 28 },
    { title: 'Serial Number', x: M + 36, w: 30 },
    { title: 'Model Unit', x: M + 66, w: 32 },
    { title: 'Kode Part', x: M + 98, w: 36 },
    { title: 'Nama Part', x: M + 134, w: 104 },
    { title: 'Qty', x: M + 238, w: 12 },
    { title: 'Cek', x: M + 250, w: 19 },
  ]
  const tabelKanan = M + 269

  let y = 41
  for (const [toko, arr] of groupToko.entries()) {
    const butuhKetinggian = 10 + 7 + arr.length * 6 + 20
    if (y + butuhKetinggian > pageH - 14) {
      doc.addPage()
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(10)
      doc.text(`Lanjutan ${docNo}`, M, 16)
      doc.setDrawColor(100, 116, 139)
      doc.line(M, 19, kanan, 19)
      y = 26
    }

    // Sep seksi toko
    doc.setFillColor(226, 232, 240)
    doc.rect(M, y - 4, tabelKanan - M, 7, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9.5)
    doc.text(`Toko : ${toko}  —  ${arr.length} item`, M + 2, y)
    y += 7

    // Kepala tabel
    doc.setFontSize(8)
    for (const c of kolom) doc.text(c.title, c.x + 1.5, y)
    doc.setDrawColor(100, 116, 139)
    doc.rect(M, y - 4.5, tabelKanan - M, 7)
    for (const c of kolom) doc.line(c.x, y - 4.5, c.x, y + 2.5)
    doc.line(tabelKanan, y - 4.5, tabelKanan, y + 2.5)
    y += 7

    // Baris item — kolom terakhir: kotak ceklis untuk dicentang manual saat pemasangan
    doc.setFont('helvetica', 'normal')
    arr.forEach((i, idx) => {
      doc.setTextColor(30, 41, 59)
      doc.text(String(idx + 1), kolom[0].x + 1.5, y)
      doc.text(potong(i.noTiket, kolom[1].w - 2), kolom[1].x + 1.5, y)
      doc.text(potong(i.serial, kolom[2].w - 2), kolom[2].x + 1.5, y)
      doc.text(potong(i.model, kolom[3].w - 2), kolom[3].x + 1.5, y)
      doc.setFont('courier', 'bold')
      tulisKode(i.kodePart, kolom[4].w - 2, kolom[4].x + 1.5, y)
      doc.setFont('helvetica', 'normal')
      doc.text(potong(i.namaPart, kolom[5].w - 2), kolom[5].x + 1.5, y)
      doc.text(String(i.qty), kolom[6].x + kolom[6].w - 1.5, y, { align: 'right' })
      // Kotak ceklis di ujung baris
      const sisi = 5.5
      const kotakX = kolom[7].x + (kolom[7].w - sisi) / 2
      doc.setDrawColor(30, 41, 59)
      doc.setLineWidth(0.3)
      doc.rect(kotakX, y - 3.9, sisi, sisi)
      doc.setLineWidth(0.2)
      doc.setDrawColor(203, 213, 225)
      doc.line(M, y + 2.5, tabelKanan, y + 2.5)
      y += 6
    })

    // Baris ttd seksi
    y += 6
    doc.setFontSize(8.5)
    doc.setTextColor(100, 116, 139)
    doc.text(`Dipasang oleh (Workshop): ${potong(aktor, 60)}`, M, y + 2.5)
    doc.text('Diterima oleh (Toko) : ____________________', tabelKanan - 95, y + 2.5)
    doc.setTextColor(30, 41, 59)
    y += 10
  }

  // Catatan kontrol dokumen (cetakan ulang) — kiri bawah halaman terakhir
  if (catatanCetak) {
    doc.setFont('helvetica', 'italic')
    doc.setFontSize(7)
    doc.setTextColor(100, 116, 139)
    doc.text(catatanCetak, M, pageH - 6)
  }

  return doc.output('arraybuffer')
}
