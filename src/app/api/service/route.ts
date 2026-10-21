import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { logAudit, generateNoTiket, generateNoSttb } from '@/lib/audit'
import { umurTiketJam, isDataLama } from '@/lib/umur'
import { autoGitBackup, backupSparepartToGit } from '@/lib/git-backup'
import { requireActiveSession } from '@/lib/auth-server'

// GET /api/service - list semua tiket dengan relasi lengkap
export async function GET() {
  try {
    const tickets = await db.serviceRequest.findMany({
      include: {
        unitAsset: {
          include: {
            toko: { select: { id: true, kodeToko: true, namaToko: true } },
            customer: { select: { id: true, nama: true, noWa: true } },
          },
        },
        parts: { include: { sparepart: true } },
        // Item order-email menempel tiket — dipakai UI: chip Ready/Inden + tombol
        // Email Order/Kirim Email dikondisikan pada item PENDING/TERKIRIM.
        orderEmailParts: { select: { id: true, kodePart: true, qty: true, status: true, createdAt: true } },
      },
      orderBy: [{ tglTiket: 'desc' }, { createdAt: 'desc' }],
    })
    const now = Date.now()
    const result = tickets.map((t) => ({
      ...t,
      // Basis umur = tglTiket (tanggal kejadian), bukan createdAt (hari upload) —
      // agar data lama/backfill tidak tercatat berumur 0 jam.
      umurTiketJam: umurTiketJam(t, now) ?? 0,
      isDataLama: isDataLama(t),
      hariSejakFinish: t.tglFinish
        ? Math.floor((now - new Date(t.tglFinish).getTime()) / (24 * 3600 * 1000))
        : null,
      nilaiKlaim:
        t.biayaJasa + t.parts.reduce((a, p) => a + (p.sparepart?.hargaKlaim ?? 0) * p.qty, 0),
    }))
    return NextResponse.json(result)
  } catch (error) {
    console.error('Service GET error:', error)
    return NextResponse.json({ error: 'Gagal memuat data tiket service' }, { status: 500 })
  }
}

// POST /api/service - buat tiket manual (oleh Admin Workshop)
export async function POST(request: Request) {
  try {
    const { session, denied } = await requireActiveSession(request)
    if (denied) return denied
    void session
    const body = await request.json()
    // Syarat pokok tiket manual: NAMA + JENIS BARANG — no seri & model tidak wajib.
    // Deskripsi kerusakan OPSIONAL. Jalur unit terdaftar (unitAssetId) tetap
    // diterima demi kompatibilitas pemanggil lama (Master Data → tiket part/perbaiki).
    const namaBarang = String(body.namaBarang ?? '').trim()
    const jenisBarang = String(body.jenisBarang ?? '').trim()
    if (!body.unitAssetId && (!namaBarang || !jenisBarang)) {
      return NextResponse.json(
        { error: 'Nama dan jenis barang wajib diisi — no seri & model tidak diperlukan' },
        { status: 400 }
      )
    }
    // Tanggal kejadian/laporan — opsional, default sekarang. Mendukung backdate
    // untuk upload data historis; ditolak bila invalid atau setelah besok.
    let tglTiket = new Date()
    if (body.tglTiket !== undefined && body.tglTiket !== null && body.tglTiket !== '') {
      const parsed = new Date(body.tglTiket)
      const batas = new Date()
      batas.setDate(batas.getDate() + 1)
      batas.setHours(23, 59, 59, 999)
      if (Number.isNaN(parsed.getTime()) || parsed > batas) {
        return NextResponse.json({ error: 'Tanggal tiket tidak valid atau melebihi batas' }, { status: 400 })
      }
      tglTiket = parsed
    }
    // Tipe pemilik didefinisikan di sini — dipakai jalur manual & klasifikasi di bawah.
    const tipeCustomer = body.customerType === 'TOKO' ? 'TOKO' : 'PERORANGAN'
    type UnitWithToko = Prisma.UnitAssetGetPayload<{ include: { toko: true } }>
    let unit: UnitWithToko | null = null
    if (body.unitAssetId) {
      // Jalur lama: unit yang sudah terdaftar dipilih lewat id.
      unit = await db.unitAsset.findUnique({
        where: { id: Number(body.unitAssetId) },
        include: { toko: true },
      })
    } else {
      // Jalur entri manual (Tiket Manual): tidak ada pemilihan unit — unit dicari
      // dari identitas sederhana (pemilik + nama + jenis barang) dan dipakai bila
      // sudah pernah ada; bila belum, unit baru terdaftar otomatis TANPA no seri
      // (serial auto-generate) & model (modelUnit = jenis barang).
      const tokoId = body.tokoId ? Number(body.tokoId) : null
      const customerId = body.customerId ? Number(body.customerId) : null
      const pemilik = tipeCustomer === 'TOKO' ? { tokoId } : { customerId }
      if (!tokoId && !customerId) {
        return NextResponse.json({ error: 'Pemilik unit (toko / customer) wajib dipilih' }, { status: 400 })
      }
      const noSeri = String(body.noSeri ?? '').trim()
      if (noSeri) {
        unit = await db.unitAsset.findUnique({ where: { serialNumber: noSeri }, include: { toko: true } })
      } else {
        unit = await db.unitAsset.findFirst({
          where: { ...pemilik, nama: namaBarang, modelUnit: jenisBarang },
          orderBy: { createdAt: 'desc' },
          include: { toko: true },
        })
      }
      if (!unit) {
        unit = await db.unitAsset.create({
          data: {
            serialNumber:
              noSeri ||
              `AUTO-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`,
            modelUnit: jenisBarang,
            nama: namaBarang,
            // Diagnosa awal bila deskripsi diisi (opsional di tiket manual).
            kerusakanAwal: String(body.deskripsiKerusakan ?? '').trim() || null,
            ...pemilik,
          },
          include: { toko: true },
        })
      }
    }
    if (!unit) {
      return NextResponse.json({ error: 'Unit tidak ditemukan' }, { status: 404 })
    }
    // Cegah tiket ganda: unit yang masih punya tiket aktif tidak bisa dibuatkan tiket baru.
    // (Menutup celah double-klik / webhook retry menyimpan data yang sama dua kali.)
    const tiketAktif = await db.serviceRequest.findFirst({
      where: { unitAssetId: unit.id, status: { in: ['REQUEST', 'PROSES'] } },
      orderBy: { createdAt: 'desc' },
    })
    if (tiketAktif) {
      return NextResponse.json(
        { error: `Unit ${unit.serialNumber} sudah memiliki tiket aktif ${tiketAktif.noTiket} (status ${tiketAktif.status}) — tambah part / proses di tiket tersebut, jangan buat baru.` },
        { status: 409 }
      )
    }

    const noTiket = await generateNoTiket(tglTiket)

    // ===== Multi-part per tiket: 1 unit bisa punya >1 kode sparepart =====
    // Tiap item: { sparepartId } dari katalog ATAU { kodePart + namaPart } manual.
    type PartIn = { sparepartId?: number; kodePart?: string; namaPart?: string; qty: number }
    const partsRaw: PartIn[] = Array.isArray(body.parts) ? body.parts : []

    // Jalur lama (single kodePart+namaPart) tetap diterima demi kompatibilitas.
    const legacyKode = String(body.kodePart ?? '').trim().toUpperCase()
    const legacyNama = String(body.namaPart ?? '').trim()
    if ((legacyKode || legacyNama) && !(legacyKode && legacyNama)) {
      return NextResponse.json({ error: 'Kode dan nama sparepart wajib diisi bersamaan' }, { status: 400 })
    }
    if (legacyKode && legacyNama) {
      partsRaw.push({ kodePart: legacyKode, namaPart: legacyNama, qty: Number(body.qty) || 1 })
    }

    // Normalisasi + ANTI-PENGULANGAN: kode part yang sama tidak boleh dua
    // kali dalam 1 tiket (dicek sebelum menyentuh stok).
    type PartResolved = { spId: number | null; kode: string; nama: string; qty: number; manual: boolean }
    const resolvedParts: PartResolved[] = []
    const seenKode = new Set<string>()
    for (const p of partsRaw) {
      const qty = Math.max(1, Math.trunc(Number(p.qty) || 1))
      let sp: { id: number; kodePart: string; namaPart: string } | null = null
      let kode = ''
      let nama = ''
      let manual = false
      if (Number(p.sparepartId) > 0) {
        sp = await db.masterSparepart.findUnique({ where: { id: Number(p.sparepartId) } })
        if (!sp) {
          return NextResponse.json({ error: 'Sparepart tidak ditemukan' }, { status: 404 })
        }
        kode = sp.kodePart
        nama = sp.namaPart
      } else {
        kode = String(p.kodePart ?? '').trim().toUpperCase()
        nama = String(p.namaPart ?? '').trim()
        if (!kode || !nama) {
          return NextResponse.json(
            { error: 'Tiap part wajib pilih dari katalog ATAU isi kode + nama bersamaan' },
            { status: 400 }
          )
        }
        manual = true
        // Kode manual ternyata sudah ada di katalog → pakai part yang sama
        sp = await db.masterSparepart.findUnique({ where: { kodePart: kode } })
      }
      if (seenKode.has(kode)) {
        return NextResponse.json(
          { error: `Part ${kode} (${nama}) dimasukkan dua kali dalam tiket ini — gabungkan jumlahnya jadi satu baris.` },
          { status: 400 }
        )
      }
      seenKode.add(kode)
      resolvedParts.push({ spId: sp ? sp.id : null, kode, nama, qty, manual })
    }

    // Validasi & reserve stok per part (kode baru dari input manual otomatis terdaftar)
    const partResults: { part: string; status: string }[] = []
    const partsCreate: {
      sparepartId: number
      qty: number
      statusPart: string
      statusKonfirmasi: string
      sumberPart?: string
    }[] = []
    for (const r of resolvedParts) {
      let sp = r.spId
        ? await db.masterSparepart.findUnique({ where: { id: r.spId } })
        : await db.masterSparepart.findUnique({ where: { kodePart: r.kode } })
      if (!sp) {
        sp = await db.masterSparepart.create({
          data: {
            kodePart: r.kode,
            namaPart: r.nama,
            brandKompatibel: unit.merk ?? '',
            supplier: '',
            stokJual: 0,
            stokGaransi: 0,
            stokInventory: 0,
            reorderLimit: 5,
            hargaKlaim: 0,
          },
        })
      }
      let statusPart = 'ORDER_PRODUSEN'
      let statusKonfirmasi = 'MENUNGGU'
      if (sp.stokInventory >= r.qty) {
        // Reserve: ambil dari stok BISA JUAL dulu, kekurangan dari stok GARANSI
        const ambilJual = Math.min(sp.stokJual, r.qty)
        await db.masterSparepart.update({
          where: { id: sp.id },
          data: {
            stokJual: { decrement: ambilJual },
            stokGaransi: { decrement: r.qty - ambilJual },
            stokInventory: { decrement: r.qty },
            totalTerpakai: { increment: r.qty },
          },
        })
        statusPart = 'READY'
        statusKonfirmasi = 'READY'
      }
      partsCreate.push({
        sparepartId: sp.id,
        qty: r.qty,
        statusPart,
        statusKonfirmasi,
        ...(r.manual ? { sumberPart: 'PRODUSEN' } : {}),
      })
      partResults.push({ part: sp.namaPart, status: statusPart })
    }

    const hasOrderPart = partResults.some((r) => r.status === 'ORDER_PRODUSEN')
    const hasReadyPart = partResults.some((r) => r.status === 'READY')
    const sumberLaporan =
      body.sumberLaporan === 'KUNJUNGAN' || body.sumberLaporan === 'LAPORAN_TOKO' || body.sumberLaporan === 'LAPORAN_CUSTOMER'
        ? body.sumberLaporan
        : 'MANUAL'
    // Klasifikasi garansi 3 pilihan:
    // - STOK_TOKO (stok toko) → otomatis garansi, biaya jasa dipaksa 0 (disable)
    // - GARANSI (dari customer) → biaya jasa dipaksa 0
    // - NON_GARANSI → biaya jasa manual
    // Klasifikasi garansi kini lewat DROPDOWN 3 pilihan (Stok Toko / Garansi / Non Garansi):
    // - STOK_TOKO → stok toko → garansi otomatis, biaya jasa dipaksa 0 (disable)
    // - GARANSI (unit titipan customer aktif garansi termasuk di sini) → biaya jasa 0
    // - NON_GARANSI → biaya jasa manual
    // Toko TIDAK lagi otomatis stok-toko: toko kerap memegang unit titipan customer,
    // jadi klasifikasi dipilih bebas terlepas dari pemiliknya (toko / perorangan).
    let klas = String(body.klasifikasiGaransi ?? '').trim().toUpperCase()
    if (klas !== 'STOK_TOKO' && klas !== 'GARANSI' && klas !== 'NON_GARANSI') {
      klas = tipeCustomer === 'TOKO' ? 'STOK_TOKO' : 'NON_GARANSI'
    }
    let biayaJasa = Number(body.biayaJasa) || 0
    await db.unitAsset.update({ where: { id: unit.id }, data: { statusGaransi: klas } })
    unit.statusGaransi = klas
    if (klas !== 'NON_GARANSI') biayaJasa = 0
    // Aturan inti: STTB terbit SEJAK REQUEST PART — begitu tiket punya part
    // (kode+nama diminta, READY ataupun ORDER), nomor STTB langsung ada untuk
    // dibawa saat pick up. Tidak menunggu part datang. Part READY → otomatis
    // PROSES sekalian. Tanpa part → tetap REQUEST tanpa STTB.
    // Perbaikan tanpa sparepart bisa LANGSUNG diaktifkan penyelesaiannya
    // (contoh: "STEEL/stell impeller" — kerjakan di toko, langsung bisa FINISH).
    const langsungProses = body.langsungProses === true && resolvedParts.length === 0
    const autoProses = hasReadyPart || langsungProses
    const noSttbOtomatis = resolvedParts.length > 0 ? generateNoSttb(noTiket) : null
    const ticket = await db.serviceRequest.create({
      data: {
        noTiket,
        unitAssetId: unit.id,
        status: autoProses ? 'PROSES' : 'REQUEST',
        ...(noSttbOtomatis ? { noSttb: noSttbOtomatis } : {}),
        sumberLaporan,
        tipeCustomer,
        lokasiUnit: 'TOKO',
        penanganan: langsungProses ? 'DI_TOKO' : 'BELUM',
        deskripsiKerusakan: String(body.deskripsiKerusakan ?? '').trim() || null,
        biayaJasa,
        tglTiket,
        parts: { create: partsCreate },
      },
      include: { unitAsset: { include: { toko: true } }, parts: { include: { sparepart: true } } },
    })

    await logAudit({
      aksi: 'CREATE_SERVICE_REQUEST',
      entitas: 'service_request',
      entitasId: noTiket,
      deskripsi: `Tiket manual dibuat untuk unit ${unit.serialNumber} (${unit.modelUnit}, ${unit.statusGaransi === 'STOK_TOKO' ? 'STOK TOKO — garansi otomatis' : unit.statusGaransi === 'GARANSI' ? 'GARANSI' : 'NON GARANSI'})${body.unitAssetId ? '' : ' — entri manual nama+jenis barang, unit didaftarkan otomatis tanpa no seri/model'}${hasOrderPart ? ' — ada part ORDER_PRODUSEN' : ''}${noSttbOtomatis ? ` — STTB ${noSttbOtomatis} terbit sejak request part` : ''}${autoProses ? ' — part READY → otomatis PROSES' : ''}${langsungProses ? ' — perbaikan tanpa part langsung PROSES/DI_TOKO (penyelesaian aktif)' : ''}`,
      aktor: body.aktor,
    })
    // Folder Kekurangan Sparepart: begitu tiket part unit ini dibuat (part dari produsen
    // sudah datang → diinput sama seperti unit lain), seluruh item order email unit-nya
    // otomatis SELESAI agar antrean di Master Data → Kekurangan Sparepart bersih.
    const orderEmailTerpaut = await db.orderEmailPart.findMany({
      where: { unitAssetId: unit.id, status: { in: ['PENDING', 'TERKIRIM'] } },
      select: { id: true, kodePart: true },
    })
    if (orderEmailTerpaut.length > 0) {
      await db.orderEmailPart.updateMany({
        where: { id: { in: orderEmailTerpaut.map((p) => p.id) } },
        data: { status: 'SELESAI' },
      })
      await logAudit({
        aksi: 'MARK_EMAIL_SELESAI',
        entitas: 'order_email_part',
        entitasId: orderEmailTerpaut.map((p) => p.kodePart).join(','),
        deskripsi: `Part sudah datang → tiket ${noTiket} dibuat → ${orderEmailTerpaut.length} item order email otomatis selesai`,
        aktor: body.aktor,
      })
      await autoGitBackup('UPDATE', 'order_email_part', 'selesai-otomatis', body.aktor)
    }
    if (partResults.some((r) => r.status === 'READY')) {
      await backupSparepartToGit('RESERVE', partsCreate.map((p) => String(p.sparepartId)).join(',') || noTiket, body.aktor)
    }
    await autoGitBackup('CREATE', 'service_request', noTiket, body.aktor)

    return NextResponse.json(
      { ...ticket, partResults },
      { status: 201 }
    )
  } catch (error) {
    console.error('Service POST error:', error)
    return NextResponse.json({ error: 'Gagal membuat tiket service' }, { status: 500 })
  }
}
