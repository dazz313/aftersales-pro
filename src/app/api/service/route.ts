import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logAudit, generateNoTiket, generateNoSttb } from '@/lib/audit'
import { umurTiketJam, isDataLama } from '@/lib/umur'
import { autoGitBackup, backupSparepartToGit } from '@/lib/git-backup'
import { requireActiveSession } from '@/lib/auth-server'
import { buatNotifikasi } from '@/lib/notifikasi'

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
    if (!body.unitAssetId || !body.deskripsiKerusakan) {
      return NextResponse.json({ error: 'Unit dan deskripsi kerusakan wajib diisi' }, { status: 400 })
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
    const unit = await db.unitAsset.findUnique({
      where: { id: Number(body.unitAssetId) },
      include: { toko: true },
    })
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
    // Klasifikasi garansi 3 pilihan:
    // - STOK_TOKO (stok toko) → otomatis garansi, biaya jasa dipaksa 0 (disable)
    // - GARANSI (dari customer) → biaya jasa dipaksa 0
    // - NON_GARANSI → biaya jasa manual
    const tipeCustomer = body.customerType === 'TOKO' ? 'TOKO' : 'PERORANGAN'
    const klas = body.klasifikasiGaransi
    const klasifikasiDiberi = klas === 'GARANSI' || klas === 'NON_GARANSI' || klas === 'STOK_TOKO'
    let biayaJasa = Number(body.biayaJasa) || 0
    if (tipeCustomer === 'TOKO') {
      await db.unitAsset.update({ where: { id: unit.id }, data: { statusGaransi: 'STOK_TOKO' } })
      unit.statusGaransi = 'STOK_TOKO'
      biayaJasa = 0
    } else if (klas === 'GARANSI' || klas === 'STOK_TOKO') {
      await db.unitAsset.update({ where: { id: unit.id }, data: { statusGaransi: klas } })
      unit.statusGaransi = klas
      biayaJasa = 0
    } else if (klasifikasiDiberi) {
      await db.unitAsset.update({ where: { id: unit.id }, data: { statusGaransi: 'NON_GARANSI' } })
      unit.statusGaransi = 'NON_GARANSI'
    }
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
        unitAssetId: Number(body.unitAssetId),
        status: autoProses ? 'PROSES' : 'REQUEST',
        ...(noSttbOtomatis ? { noSttb: noSttbOtomatis } : {}),
        sumberLaporan,
        tipeCustomer,
        lokasiUnit: 'TOKO',
        penanganan: langsungProses ? 'DI_TOKO' : 'BELUM',
        deskripsiKerusakan: body.deskripsiKerusakan,
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
      deskripsi: `Tiket manual dibuat untuk unit ${unit.serialNumber} (${unit.modelUnit}, ${unit.statusGaransi === 'STOK_TOKO' ? 'stok toko → GARANSI otomatis' : unit.statusGaransi})${hasOrderPart ? ' — ada part ORDER_PRODUSEN' : ''}${noSttbOtomatis ? ` — STTB ${noSttbOtomatis} terbit sejak request part` : ''}${autoProses ? ' — part READY → otomatis PROSES' : ''}${langsungProses ? ' — perbaikan tanpa part langsung PROSES/DI_TOKO (penyelesaian aktif)' : ''}`,
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
    // Notifikasi lonceng: tiket baru → semua role tahu ada permintaan baru.
    await buatNotifikasi({
      tipe: 'TIKET_BARU',
      judul: 'Tiket service baru',
      pesan: `${noTiket} · ${ticket.status} · ${unit.modelUnit || unit.nama || '(tanpa nama)'}${
        unit.toko ? ` — ${unit.toko.kodeToko} ${unit.toko.namaToko}` : ''
      }`,
      refType: 'service_request',
      refId: ticket.id,
      refLabel: noTiket,
      dibuatOleh: body.aktor ?? null,
    })
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
