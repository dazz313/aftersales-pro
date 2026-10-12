import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logAudit, generateNoTiket } from '@/lib/audit'
import { autoGitBackup, backupSparepartToGit } from '@/lib/git-backup'

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

    const noTiket = await generateNoTiket()
    const partsInput: { sparepartId: number; qty: number }[] = Array.isArray(body.parts)
      ? body.parts
      : []

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

    const hasOrderPart = partResults.some((r) => r.status === 'ORDER_PRODUSEN')
    const sumberLaporan =
      body.sumberLaporan === 'KUNJUNGAN' || body.sumberLaporan === 'LAPORAN_TOKO' || body.sumberLaporan === 'LAPORAN_CUSTOMER'
        ? body.sumberLaporan
        : 'MANUAL'
    // Klasifikasi garansi tiket manual:
    // - tipe TOKO (stok toko) → otomatis GARANSI, biaya jasa dipaksa 0 (disable)
    // - tipe PERORANGAN → ikut pilihan klasifikasi (GARANSI dari customer / NON_GARANSI)
    const tipeCustomer = body.customerType === 'TOKO' ? 'TOKO' : 'PERORANGAN'
    const klasifikasiDiberi = body.klasifikasiGaransi === 'GARANSI' || body.klasifikasiGaransi === 'NON_GARANSI'
    let biayaJasa = Number(body.biayaJasa) || 0
    if (tipeCustomer === 'TOKO' || (tipeCustomer === 'PERORANGAN' && body.klasifikasiGaransi === 'GARANSI')) {
      await db.unitAsset.update({ where: { id: unit.id }, data: { statusGaransi: 'GARANSI' } })
      unit.statusGaransi = 'GARANSI'
      biayaJasa = 0
    } else if (klasifikasiDiberi) {
      await db.unitAsset.update({ where: { id: unit.id }, data: { statusGaransi: 'NON_GARANSI' } })
      unit.statusGaransi = 'NON_GARANSI'
    }
    const ticket = await db.serviceRequest.create({
      data: {
        noTiket,
        unitAssetId: Number(body.unitAssetId),
        status: 'REQUEST',
        sumberLaporan,
        tipeCustomer,
        lokasiUnit: 'TOKO',
        penanganan: 'BELUM',
        deskripsiKerusakan: body.deskripsiKerusakan,
        biayaJasa,
        parts: {
          create: partsInput.map((p, i) => ({
            sparepartId: Number(p.sparepartId),
            qty: Number(p.qty) || 1,
            statusPart: partResults[i]?.status ?? 'ORDER_PRODUSEN',
            // Stok toko mencukupi = produsen dianggap READY; sisanya menunggu konfirmasi via WA
            statusKonfirmasi: partResults[i]?.status === 'READY' ? 'READY' : 'MENUNGGU',
          })),
        },
      },
      include: { unitAsset: { include: { toko: true } }, parts: { include: { sparepart: true } } },
    })

    await logAudit({
      aksi: 'CREATE_SERVICE_REQUEST',
      entitas: 'service_request',
      entitasId: noTiket,
      deskripsi: `Tiket manual dibuat untuk unit ${unit.serialNumber} (${unit.modelUnit}, ${tipeCustomer === 'TOKO' ? 'stok toko → GARANSI otomatis' : unit.statusGaransi})${hasOrderPart ? ' — ada part ORDER_PRODUSEN' : ''}`,
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
