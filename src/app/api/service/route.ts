import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logAudit, generateNoTiket } from '@/lib/audit'
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
      },
      orderBy: { createdAt: 'desc' },
    })
    const now = Date.now()
    const result = tickets.map((t) => ({
      ...t,
      umurTiketJam: Math.floor((now - new Date(t.createdAt).getTime()) / 3600000),
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

    const noTiket = await generateNoTiket()
    const partsInput: { sparepartId: number; qty: number }[] = Array.isArray(body.parts)
      ? body.parts
      : []

    // Jalan pintas: kode + nama part langsung (dari Master Data / balasan produsen).
    // Bila kode belum ada di katalog → otomatis didaftarkan (tercollect).
    const produsenKode = String(body.kodePart ?? '').trim().toUpperCase()
    const produsenNama = String(body.namaPart ?? '').trim()
    if ((produsenKode || produsenNama) && !(produsenKode && produsenNama)) {
      return NextResponse.json({ error: 'Kode dan nama sparepart wajib diisi bersamaan' }, { status: 400 })
    }

    // Validasi & reserve stok part
    const partResults: { part: string; status: string }[] = []
    for (const p of partsInput) {
      const sp = await db.masterSparepart.findUnique({ where: { id: Number(p.sparepartId) } })
      if (!sp) continue
      const qty = Number(p.qty) || 1
      if (sp.stokInventory >= qty) {
        // Reserve: ambil dari stok BISA JUAL dulu, kekurangan dari stok GARANSI
        const ambilJual = Math.min(sp.stokJual, qty)
        await db.masterSparepart.update({
          where: { id: sp.id },
          data: {
            stokJual: { decrement: ambilJual },
            stokGaransi: { decrement: qty - ambilJual },
            stokInventory: { decrement: qty },
          },
        })
        partResults.push({ part: sp.namaPart, status: 'READY' })
      } else {
        partResults.push({ part: sp.namaPart, status: 'ORDER_PRODUSEN' })
      }
    }

    // Part dari kode produsen (baru/lama) — ikut direserve bila stok ada
    let produsenSparepartId: number | null = null
    let produsenStatus = 'ORDER_PRODUSEN'
    let produsenKonfirmasi = 'MENUNGGU'
    if (produsenKode && produsenNama) {
      let sp = await db.masterSparepart.findUnique({ where: { kodePart: produsenKode } })
      if (!sp) {
        sp = await db.masterSparepart.create({
          data: {
            kodePart: produsenKode,
            namaPart: produsenNama,
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
      const qty = Math.max(1, Math.trunc(Number(body.qty) || 1))
      if (sp.stokInventory >= qty) {
        const ambilJual = Math.min(sp.stokJual, qty)
        await db.masterSparepart.update({
          where: { id: sp.id },
          data: {
            stokJual: { decrement: ambilJual },
            stokGaransi: { decrement: qty - ambilJual },
            stokInventory: { decrement: qty },
          },
        })
        produsenStatus = 'READY'
        produsenKonfirmasi = 'READY'
      }
      produsenSparepartId = sp.id
      partResults.push({ part: sp.namaPart, status: produsenStatus })
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
    // Aturan inti: kode+nama part terinput & READY → otomatis PROSES.
    // Tanpa part READY → tetap REQUEST (dipantau panel Belum Terproses).
    const autoProses = hasReadyPart
    const ticket = await db.serviceRequest.create({
      data: {
        noTiket,
        unitAssetId: Number(body.unitAssetId),
        status: autoProses ? 'PROSES' : 'REQUEST',
        sumberLaporan,
        tipeCustomer,
        lokasiUnit: 'TOKO',
        penanganan: 'BELUM',
        deskripsiKerusakan: body.deskripsiKerusakan,
        biayaJasa,
        parts: {
          create: [
            ...partsInput.map((p, i) => ({
              sparepartId: Number(p.sparepartId),
              qty: Number(p.qty) || 1,
              statusPart: partResults[i]?.status ?? 'ORDER_PRODUSEN',
              // Stok toko mencukupi = produsen dianggap READY; sisanya menunggu konfirmasi via WA
              statusKonfirmasi: partResults[i]?.status === 'READY' ? 'READY' : 'MENUNGGU',
            })),
            ...(produsenSparepartId
              ? [{
                  sparepartId: produsenSparepartId,
                  qty: Math.max(1, Math.trunc(Number(body.qty) || 1)),
                  statusPart: produsenStatus,
                  statusKonfirmasi: produsenKonfirmasi,
                  sumberPart: 'PRODUSEN',
                }]
              : []),
          ],
        },
      },
      include: { unitAsset: { include: { toko: true } }, parts: { include: { sparepart: true } } },
    })

    await logAudit({
      aksi: 'CREATE_SERVICE_REQUEST',
      entitas: 'service_request',
      entitasId: noTiket,
      deskripsi: `Tiket manual dibuat untuk unit ${unit.serialNumber} (${unit.modelUnit}, ${unit.statusGaransi === 'STOK_TOKO' ? 'stok toko → GARANSI otomatis' : unit.statusGaransi})${hasOrderPart ? ' — ada part ORDER_PRODUSEN' : ''}${autoProses ? ' — part READY → otomatis PROSES' : ''}`,
      aktor: body.aktor,
    })
    if (partResults.some((r) => r.status === 'READY')) {
      await backupSparepartToGit('RESERVE', partsInput.map((p) => String(p.sparepartId)).join(',') || noTiket, body.aktor)
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
