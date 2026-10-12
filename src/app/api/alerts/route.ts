import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'

/**
 * API System Alert Engine (Modul 5.2 + Section 7 PRD)
 * Menjalankan business rules cron job:
 * - ALT-01: Toko Melewati Jadwal Kunjungan
 * - ALT-02: SLA Sparepart Pending (REQUEST > 24 jam)
 * - ALT-03: Low Stock Sparepart (ROP)
 * - ALT-04: Potential Unclaimed Revenue (FINISH > 7 hari, klaim DRAFT)
 */
export async function GET() {
  try {
    const now = Date.now()

    const [tokoList, tiketRequest, spareparts, tiketFinish] = await Promise.all([
      db.masterToko.findMany({ orderBy: { namaToko: 'asc' } }),
      db.serviceRequest.findMany({
        where: { status: 'REQUEST' },
        include: { unitAsset: true, parts: { include: { sparepart: true } } },
      }),
      db.masterSparepart.findMany({ orderBy: { kodePart: 'asc' } }),
      db.serviceRequest.findMany({
        where: { status: 'FINISH' },
        include: { unitAsset: true, parts: { include: { sparepart: true } } },
      }),
    ])

    // ===== ALT-01: Toko Melewati Jadwal Kunjungan =====
    const alerts1 = tokoList
      .map((t) => {
        if (!t.tglVisitTerakhir) {
          return { toko: t, hariTerlambat: t.frekuensiVisit, neverVisited: true }
        }
        const hariSejak = Math.floor((now - new Date(t.tglVisitTerakhir).getTime()) / (24 * 3600 * 1000))
        return { toko: t, hariSejak, terlambat: hariSejak > t.frekuensiVisit }
      })
      .filter((x) => x.neverVisited || (x as { terlambat?: boolean }).terlambat)
      .map((x) => ({
        kode: 'ALT-01',
        nama: 'Toko Melewati Jadwal Kunjungan',
        severity: 'warning',
        entitas: (x as { toko: typeof tokoList[number] }).toko.namaToko,
        detail: `Belum dikunjungi sesuai siklus ${(x as { toko: typeof tokoList[number] }).toko.frekuensiVisit} hari (sejak ${(x as { hariSejak?: number }).hariSejak ?? '∞'} hari terakhir)`,
        meta: { tokoId: (x as { toko: typeof tokoList[number] }).toko.id },
      }))

    // ===== ALT-02: SLA Sparepart Pending (REQUEST > 24 jam) =====
    const SLA_JAM = 24
    const slaTerlambat = tiketRequest.filter(
      (t) => (now - new Date(t.createdAt).getTime()) > SLA_JAM * 3600 * 1000
    )

    // Persist flag merah (aksi otomatis sistem)
    for (const t of slaTerlambat) {
      if (!t.slaFlag) {
        await db.serviceRequest.update({ where: { id: t.id }, data: { slaFlag: true } })
        await logAudit({
          aksi: 'ALT02_SLA_FLAG',
          entitas: 'service_request',
          entitasId: t.noTiket,
          deskripsi: 'Flag merah ALT-02 dipasang: REQUEST > 24 jam tanpa konfirmasi part',
          aktor: 'CRON-ENGINE',
        })
      }
    }

    const alerts2 = slaTerlambat.map((t) => {
      const jamBerlalu = Math.floor((now - new Date(t.createdAt).getTime()) / 3600000)
      return {
        kode: 'ALT-02',
        nama: 'SLA Sparepart Pending',
        severity: 'critical',
        entitas: t.noTiket,
        detail: `Tiket status REQUEST sudah ${jamBerlalu} jam (> ${SLA_JAM} jam SLA) tanpa konfirmasi ketersediaan part — reminder otomatis dikirim ke Produsen`,
        meta: { tiketId: t.id, noTiket: t.noTiket, jam: jamBerlalu },
      }
    })

    // ===== ALT-03: Low Stock Sparepart (ROP) =====
    const stokKritis = spareparts.filter((s) => s.stokInventory <= s.reorderLimit)
    const alerts3 = stokKritis.map((s) => ({
      kode: 'ALT-03',
      nama: 'Low Stock Sparepart (ROP)',
      severity: s.stokInventory === 0 ? 'critical' : 'warning',
      entitas: s.kodePart,
      detail: `Stok ${s.namaPart} tersisa ${s.stokInventory} ${s.stokInventory === 0 ? '(KOSONG)' : `≤ reorder limit ${s.reorderLimit}`} — draft formulir Re-Order Sparepart digenerate`,
      meta: { sparepartId: s.id, stok: s.stokInventory, limit: s.reorderLimit },
    }))

    // ===== ALT-04: Potential Unclaimed Revenue =====
    const BATAS_HARI = 7
    const unclaimed = tiketFinish.filter(
      (t) =>
        t.tglFinish &&
        (now - new Date(t.tglFinish).getTime()) > BATAS_HARI * 24 * 3600 * 1000 &&
        t.statusKlaimProdusen === 'DRAFT'
    )
    const totalUnclaimed = unclaimed.reduce((acc, t) => {
      const partValue = t.parts.reduce((a, p) => a + (p.sparepart?.hargaKlaim ?? 0) * p.qty, 0)
      return acc + t.biayaJasa + partValue
    }, 0)

    const alerts4 = unclaimed.map((t) => {
      const hariSejak = Math.floor((now - new Date(t.tglFinish as Date).getTime()) / (24 * 3600 * 1000))
      const partValue = t.parts.reduce((a, p) => a + (p.sparepart?.hargaKlaim ?? 0) * p.qty, 0)
      return {
        kode: 'ALT-04',
        nama: 'Potential Unclaimed Revenue',
        severity: 'warning',
        entitas: t.noTiket,
        detail: `FINISH sejak ${hariSejak} hari tapi klaim masih DRAFT — dana tertahan Rp ${(t.biayaJasa + partValue).toLocaleString('id-ID')}`,
        meta: { tiketId: t.id, noTiket: t.noTiket, nilai: t.biayaJasa + partValue },
      }
    })

    const allAlerts = [...alerts1, ...alerts2, ...alerts3, ...alerts4]
    const critical = allAlerts.filter((a) => a.severity === 'critical').length

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      total: allAlerts.length,
      critical,
      totalUnclaimedRevenue: totalUnclaimed,
      alerts: allAlerts,
    })
  } catch (error) {
    console.error('Alerts API error:', error)
    return NextResponse.json({ error: 'Gagal menjalankan alert engine' }, { status: 500 })
  }
}
