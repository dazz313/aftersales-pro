import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

/**
 * API Dashboard KPI (Modul 5.1 PRD)
 * - Ringkasan jumlah tiket aktif (REQUEST, PROSES, FINISH)
 * - Total klaim pending (DRAFT pada tiket FINISH)
 * - Grafik tren kerusakan per model unit
 * - Statistik stok kritis
 */
export async function GET() {
  try {
    const [
      countRequest,
      countProses,
      countFinish,
      tiketSlaTerlambat,
      claimsDraft,
      claimsSubmitted,
      spareparts,
      serviceRequests,
      tokoList,
      kunjungan7hari,
      unitTanpaTiket,
      totalUnit,
    ] = await Promise.all([
      db.serviceRequest.count({ where: { status: 'REQUEST' } }),
      db.serviceRequest.count({ where: { status: 'PROSES' } }),
      db.serviceRequest.count({ where: { status: 'FINISH' } }),
      db.serviceRequest.count({ where: { status: 'REQUEST', slaFlag: true } }),
      // Klaim pending: FINISH tapi DRAFT
      db.serviceRequest.findMany({
        where: { status: 'FINISH', statusKlaimProdusen: 'DRAFT' },
        include: { parts: { include: { sparepart: true } }, unitAsset: true },
      }),
      db.serviceRequest.count({ where: { statusKlaimProdusen: 'SUBMITTED' } }),
      db.masterSparepart.findMany(),
      db.serviceRequest.findMany({
        include: { unitAsset: { include: { toko: { select: { kodeToko: true, namaToko: true } } } }, parts: { include: { sparepart: true } } },
      }),
      db.masterToko.findMany(),
      db.kunjungan.count({
        where: { tglKunjungan: { gte: new Date(Date.now() - 7 * 24 * 3600 * 1000) } },
      }),
      // Unit terdaftar tapi belum pernah diproses (tanpa tiket service sama sekali)
      db.unitAsset.count({ where: { serviceRequests: { none: {} } } }),
      db.unitAsset.count(),
    ])

    // Total estimasi dana klaim tertahan (ALT-04): jasa + part
    const totalKlaimPending = claimsDraft.reduce((acc, t) => {
      const partValue = t.parts.reduce((a, p) => a + (p.sparepart?.hargaKlaim ?? 0) * p.qty, 0)
      return acc + t.biayaJasa + partValue
    }, 0)

    // Tren kerusakan per model unit
    const kerusakanPerModel: Record<string, number> = {}
    for (const t of serviceRequests) {
      const model = t.unitAsset?.modelUnit ?? 'Unknown'
      kerusakanPerModel[model] = (kerusakanPerModel[model] ?? 0) + 1
    }
    const trenKerusakan = Object.entries(kerusakanPerModel)
      .map(([model, jumlah]) => ({ model, jumlah }))
      .sort((a, b) => b.jumlah - a.jumlah)

    // Distribusi garansi unit yang diservis (STOK_TOKO dihitung garansi)
    const garansiCount = { GARANSI: 0, NON_GARANSI: 0 }
    for (const t of serviceRequests) {
      if (t.unitAsset?.statusGaransi === 'NON_GARANSI') garansiCount.NON_GARANSI++
      else garansiCount.GARANSI++
    }

    // Stok kritis (ALT-03)
    const stokKritis = spareparts.filter((s) => s.stokInventory <= s.reorderLimit)
    const stokKosong = spareparts.filter((s) => s.stokInventory === 0)
    const nilaiTotalStok = spareparts.reduce((acc, s) => acc + s.stokInventory * s.hargaKlaim, 0)

    // Kepatuhan kunjungan toko (ALT-01 basis data)
    const now = Date.now()
    const tokoTerlambat = tokoList.filter((t) => {
      if (!t.tglVisitTerakhir) return true
      const hariSejak = (now - new Date(t.tglVisitTerakhir).getTime()) / (24 * 3600 * 1000)
      return hariSejak > t.frekuensiVisit
    })

    // Tren tiket 14 hari terakhir (untuk line chart)
    const hariIni = new Date()
    hariIni.setHours(0, 0, 0, 0)
    const tren14hari: { tanggal: string; tiket: number }[] = []
    for (let i = 13; i >= 0; i--) {
      const d = new Date(hariIni)
      d.setDate(d.getDate() - i)
      const next = new Date(d)
      next.setDate(next.getDate() + 1)
      const jumlah = serviceRequests.filter(
        (t) => new Date(t.createdAt) >= d && new Date(t.createdAt) < next
      ).length
      tren14hari.push({
        tanggal: d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short' }),
        tiket: jumlah,
      })
    }

    // Unit belum terproses: REQUEST tanpa part READY (belum input kode+nama / stok kosong).
    // Diurut tertua dulu agar tidak dilupakan karena lama pending.
    const belumProsesSemua = serviceRequests
      .filter((t) => t.status === 'REQUEST' && !t.parts.some((p) => p.statusPart === 'READY'))
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    const belumProses = {
      count: belumProsesSemua.length,
      items: belumProsesSemua.slice(0, 8).map((t) => ({
        noTiket: t.noTiket,
        serial: t.unitAsset?.serialNumber ?? '-',
        model: t.unitAsset?.modelUnit ?? '-',
        toko: t.unitAsset?.toko ? `${t.unitAsset.toko.kodeToko} — ${t.unitAsset.toko.namaToko}` : '-',
        umurJam: Math.floor((now - new Date(t.createdAt).getTime()) / 3600000),
        adaPart: t.parts.length > 0,
      })),
    }

    return NextResponse.json({
      tiket: {
        request: countRequest,
        proses: countProses,
        finish: countFinish,
        slaTerlambat: tiketSlaTerlambat,
        total: countRequest + countProses + countFinish,
      },
      belumProses,
      unitBelumDiproses: { count: unitTanpaTiket, total: totalUnit },
      klaim: {
        pendingCount: claimsDraft.length,
        pendingValue: totalKlaimPending,
        submitted: claimsSubmitted,
      },
      stok: {
        totalItem: spareparts.length,
        kritis: stokKritis.length,
        kosong: stokKosong.length,
        nilaiTotal: nilaiTotalStok,
      },
      operasional: {
        totalToko: tokoList.length,
        tokoTerlambatVisit: tokoTerlambat.length,
        kunjungan7hari,
      },
      trenKerusakan,
      garansiCount,
      tren14hari,
    })
  } catch (error) {
    console.error('Dashboard API error:', error)
    return NextResponse.json({ error: 'Gagal memuat data dashboard' }, { status: 500 })
  }
}
