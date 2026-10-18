import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getActiveSession } from '@/lib/auth-server'

// GET /api/unit/[id]/pdf — PDF "DETAIL UNIT" untuk PERSIAPAN EMAIL order part yang
// kurang ke produsen. Isi: kop perusahaan, detail unit + pemilik, tiket berjalan,
// dan DAFTAR PART YANG KURANG yang diambil dari (a) part tiket berjalan berstatus
// ORDER (part dari stok yang READY tidak dihitung) serta (b) item OrderEmailPart
// aktif (PENDING/TERKIRIM) bila pernah dicatat. Tombol: Master Barcode/Unit →
// kolom aksi → dropdown "Aksi" → "PDF Detail Unit".
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getActiveSession(request)
    if (!session) {
      return NextResponse.json({ error: 'Sesi berakhir atau akun nonaktif. Silakan login ulang.' }, { status: 401 })
    }
    const { id } = await params
    const unitId = Number(id)
    if (!Number.isFinite(unitId) || unitId <= 0) {
      return NextResponse.json({ error: 'ID unit tidak valid' }, { status: 400 })
    }

    const unit = await db.unitAsset.findUnique({
      where: { id: unitId },
      include: {
        toko: true,
        customer: true,
        serviceRequests: {
          where: { status: { in: ['REQUEST', 'PROSES'] } },
          include: { parts: { include: { sparepart: true } } },
          orderBy: { createdAt: 'desc' },
        },
      },
    })
    if (!unit) return NextResponse.json({ error: 'Unit tidak ditemukan' }, { status: 404 })

    type Baris = { kode: string; nama: string; qty: number; status: string; sumber: string }
    const mentah: Baris[] = []
    for (const t of unit.serviceRequests) {
      for (const p of t.parts) {
        if (p.statusPart === 'READY') continue // part yang sudah didapat tidak perlu diorder
        mentah.push({
          kode: p.sparepart?.kodePart ?? '-',
          nama: p.sparepart?.namaPart ?? '-',
          qty: p.qty,
          status: p.statusPart,
          sumber: t.noTiket,
        })
      }
    }
    const orderEmailAktif = await db.orderEmailPart.findMany({
      where: { unitAssetId: unitId, status: { in: ['PENDING', 'TERKIRIM'] } },
      orderBy: { createdAt: 'asc' },
    })
    for (const o of orderEmailAktif) {
      mentah.push({ kode: o.kodePart, nama: o.namaPart, qty: o.qty, status: o.status, sumber: 'Kekurangan (email)' })
    }
    // Gabung kode sama → qty dijumlah (part bisa tercatat di tiket sekaligus daftar kekurangan)
    const baris: Baris[] = []
    for (const b of mentah) {
      const ada = baris.find((x) => x.kode.toUpperCase() === b.kode.toUpperCase())
      if (ada) {
        ada.qty += b.qty
        ada.sumber = ada.sumber !== b.sumber ? `${ada.sumber}, ${b.sumber}` : ada.sumber
      } else {
        baris.push({ ...b })
      }
    }

    const settings = await db.pengaturan.findMany()
    const s: Record<string, string> = {}
    for (const row of settings) s[row.kunci] = row.nilai
    const namaPerusahaan = s['nama_perusahaan'] || 'AFTERSALES PRO'
    const alamatPerusahaan = s['alamat_perusahaan'] || ''

    /* ============ PDF (A4 portrait) — pola sama dgn surat-jalan & STTB ============ */
    const jsPDFModule = await import('jspdf')
    const jsPDF = jsPDFModule.jsPDF
    const doc = new jsPDF({ unit: 'mm', format: 'a4' })
    const pageW = doc.internal.pageSize.getWidth() // 210
    const pageH = doc.internal.pageSize.getHeight() // 297
    const mL = 16
    const wContent = pageW - mL - mL // margin kiri == kanan

    let y = 18
    // ---- KOP ----
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(15)
    doc.text(namaPerusahaan, mL, y)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    y += 5
    if (alamatPerusahaan) {
      doc.text(alamatPerusahaan, mL, y)
      y += 5
    }
    doc.setDrawColor(30)
    doc.setLineWidth(0.6)
    doc.line(mL, y, pageW - mL, y)
    y += 8

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11.5)
    doc.text('DETAIL UNIT — PERSIAPAN ORDER PART KE PRODUSEN', mL, y)
    y += 4.5
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(90)
    doc.text('Lampiran email order part yang kurang — dibuat dari Master Barcode / Unit Asset', mL, y)
    doc.setTextColor(0)
    y += 8

    // ---- Detail unit ----
    const pemilik = unit.toko
      ? `${unit.toko.namaToko}${unit.toko.kodeToko ? ` (${unit.toko.kodeToko})` : ''}`
      : unit.customer
        ? `${unit.customer.nama} (perorangan)`
        : '-'
    const alamat = unit.toko?.alamat || unit.customer?.alamat || '-'
    const kontak = unit.toko?.kontak || unit.customer?.noWa || '-'
    const infoPairs: [string, string][] = [
      ['Nomor Seri', unit.serialNumber],
      ['Model / Tipe', unit.modelUnit + (unit.nama ? ` — ${unit.nama}` : '')],
      ['Merk', unit.merk || '-'],
      ['Status Garansi', unit.statusGaransi === 'STOK_TOKO' ? 'STOK TOKO' : unit.statusGaransi],
      ['Tgl Pembelian', unit.tglPembelian ? new Date(unit.tglPembelian).toLocaleDateString('id-ID') : '-'],
      ['Pemilik', pemilik],
      ['Alamat', alamat],
      ['Kontak', kontak],
    ]
    doc.setFontSize(10)
    for (const [label, nilai] of infoPairs) {
      doc.setFont('helvetica', 'bold')
      doc.text(label, mL, y)
      doc.setFont('helvetica', 'normal')
      const wrap = doc.splitTextToSize(nilai || '-', wContent - 36)
      doc.text(wrap, mL + 36, y)
      y += wrap.length * 4.6 + 1
    }

    // ---- Tiket berjalan ----
    const t = unit.serviceRequests[0]
    if (t) {
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(10)
      doc.text('Tiket Terkait', mL, y)
      doc.setFont('helvetica', 'normal')
      const wrapT = doc.splitTextToSize(
        `${t.noTiket} (status ${t.status}) · tgl ${t.tglTiket ? new Date(t.tglTiket).toLocaleDateString('id-ID') : '-'} · kerusakan: ${t.deskripsiKerusakan}`,
        wContent - 36
      )
      doc.text(wrapT, mL + 36, y)
      y += wrapT.length * 4.6 + 1
    }

    // ---- Tabel part yang kurang ----
    y += 7
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10.5)
    doc.text(`DAFTAR PART YANG KURANG${baris.length > 0 ? ` (${baris.length})` : ''}`, mL, y)
    y += 3
    doc.setDrawColor(200)
    doc.setLineWidth(0.3)
    doc.line(mL, y, pageW - mL, y)
    y += 6

    const colX = [mL, mL + 9, mL + 42, mL + 108, mL + 121, mL + 147]
    const namaLebar = colX[3] - colX[2] - 3
    const sumberLebar = pageW - mL - colX[5]
    const gambarHeader = () => {
      doc.setFillColor(237, 233, 254)
      doc.rect(mL, y - 4.4, wContent, 6.4, 'F')
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(8.5)
      doc.text('No', colX[0] + 1, y)
      doc.text('Kode Part', colX[1] + 1, y)
      doc.text('Nama Part', colX[2] + 1, y)
      doc.text('Qty', colX[3] + 1, y)
      doc.text('Status', colX[4] + 1, y)
      doc.text('Sumber', colX[5] + 1, y)
      doc.setFont('helvetica', 'normal')
      y += 7
    }

    if (baris.length === 0) {
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(9.5)
      doc.text('Belum ada part yang dicatat kurang / diorder ke produsen untuk unit ini.', mL, y)
      y += 5
      doc.text('Input lewat: Master Barcode/Unit Asset → tombol "Aksi" → "Input Kode & Sparepart".', mL, y)
      y += 6
    } else {
      gambarHeader()
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(9)
      baris.forEach((b, i) => {
        const wrapNama = doc.splitTextToSize(b.nama, namaLebar)
        const wrapSumber = doc.splitTextToSize(b.sumber, sumberLebar)
        const rowH = Math.max(5.2, Math.max(wrapNama.length, wrapSumber.length) * 4.2 + 1.6)
        if (y + rowH > pageH - 26) {
          doc.addPage()
          y = 18
          gambarHeader()
          doc.setFont('helvetica', 'normal')
          doc.setFontSize(9)
        }
        if (i % 2 === 1) {
          doc.setFillColor(248, 250, 252)
          doc.rect(mL, y - 4.4, wContent, rowH, 'F')
        }
        doc.text(String(i + 1), colX[0] + 1, y)
        doc.text(b.kode, colX[1] + 1, y)
        doc.text(wrapNama, colX[2] + 1, y)
        doc.text(String(b.qty), colX[3] + 1, y)
        doc.text(doc.splitTextToSize(b.status, colX[5] - colX[4] - 2), colX[4] + 1, y)
        doc.text(wrapSumber, colX[5] + 1, y)
        doc.setDrawColor(226)
        doc.setLineWidth(0.2)
        doc.line(mL, y - 4.4 + rowH, pageW - mL, y - 4.4 + rowH)
        y += rowH
      })
    }

    // ---- Catatan + ttd/footer ----
    y = Math.max(y, pageH - 40) + 4
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(70)
    const catatan: string[] = []
    if (s['email_produsen']) catatan.push(`Email produsen (tujuan): ${s['email_produsen']}`)
    if (s['kontak_produsen']) catatan.push(`WA produsen: ${s['kontak_produsen']}`)
    catatan.push('Mohon konfirmasi ketersediaan / jadwal kirim part di atas. Terima kasih.')
    doc.text(doc.splitTextToSize(catatan.join('\n'), wContent), mL, y)
    doc.setTextColor(130)
    doc.setFontSize(8)
    doc.text(
      `Dicetak ${new Date().toLocaleString('id-ID', { dateStyle: 'full', timeStyle: 'short' })} · oleh ${session.nama} · AfterSales Pro`,
      mL,
      pageH - 10
    )
    doc.setTextColor(0)

    const fname = `detail-unit-${(unit.serialNumber || String(unit.id)).replace(/[^\w.-]+/g, '-')}.pdf`
    const bytes = doc.output('arraybuffer')
    return new Response(bytes, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${fname}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    console.error('Unit PDF error:', error)
    return NextResponse.json({ error: 'Gagal membuat PDF detail unit' }, { status: 500 })
  }
}
