import { db } from '@/lib/db'
import { umurTiketJam, isDataLama, formatUmur } from '@/lib/umur'
import { logAudit } from '@/lib/audit'

/**
 * Alert Engine (Modul 5.2 + Section 7 PRD)
 * --------------------------------------
 * Aturan bisnis yang dijalankan terjadwal:
 *  ALT-01 Toko melewati jadwal kunjungan
 *  ALT-02 SLA sparepart pending (REQUEST > 24 jam)
 *  ALT-03 Stok sparepart kritis (≤ reorder limit)
 *  ALT-04 Potensi klaim belum diajukan (FINISH > 7 hari, klaim DRAFT)
 *  ALT-05 Unit belum diproses (REQUEST tanpa part READY > 24 jam)
 *  ALT-06 Unit teregistrasi tanpa tiket (registrasi > 24 jam, belum jadi tiket)
 *
 * Dulu modul ini hanya ditampilkan di Dashboard — teksnya menjanjikan
 * "reminder otomatis dikirim ke Produsen" padahal tidak pernah ada
 * pengiriman. Sekarang hasil evaluasi dipakai bersama oleh:
 *  • Dashboard/API  → src/app/api/alerts/route.ts
 *  • Pengiriman harian ke grup + notifikasi lonceng → src/lib/alert-scheduler.ts
 */

export interface AlertItem {
  kode: string
  nama: string
  severity: 'warning' | 'critical'
  entitas: string
  detail: string
  meta: Record<string, unknown>
}

export interface HasilAlert {
  generatedAt: string
  total: number
  critical: number
  totalUnclaimedRevenue: number
  alerts: AlertItem[]
}

const HARI_MS = 24 * 3600 * 1000
/** ALT-06: window unit yang masih "baru" tanpa tiket (hari). */
const JENDELA_UNIT_TANPA_TIKET_HARI = 7
const MAKS_ALERT = 200

export async function jalankanAlertEngine(): Promise<HasilAlert> {
  const now = Date.now()

  const [tokoList, tiketRequest, tiketFinish, spareparts, unitTanpaTiket] = await Promise.all([
    db.masterToko.findMany({ orderBy: { namaToko: 'asc' } }),
    db.serviceRequest.findMany({
      where: { status: 'REQUEST' },
      include: { unitAsset: true, parts: { include: { sparepart: true } } },
    }),
    db.serviceRequest.findMany({
      where: { status: 'FINISH' },
      include: { unitAsset: true, parts: { include: { sparepart: true } } },
    }),
    db.masterSparepart.findMany({ orderBy: { kodePart: 'asc' } }),
    // ALT-06: unit terdaftar tapi belum pernah dibuatkan tiket service
    db.unitAsset.findMany({
      where: { serviceRequests: { none: {} } },
      include: { toko: { select: { kodeToko: true, namaToko: true } }, customer: { select: { nama: true } } },
      orderBy: { createdAt: 'desc' },
      take: 500,
    }),
  ])

  const alerts: AlertItem[] = []

  // ===== ALT-01: Toko Melewati Jadwal Kunjungan =====
  for (const t of tokoList) {
    if (!t.aktif || t.modeSiklus === 'BY_REQUEST') continue
    if (!t.tglVisitTerakhir) {
      alerts.push({
        kode: 'ALT-01',
        nama: 'Toko Melewati Jadwal Kunjungan',
        severity: 'warning',
        entitas: t.namaToko,
        detail: `Belum dikunjungi sama sekali (siklus ${t.frekuensiVisit} hari) — jadwalkan kunjungan.`,
        meta: { tokoId: t.id, neverVisited: true },
      })
      continue
    }
    const hariSejak = Math.floor((now - new Date(t.tglVisitTerakhir).getTime()) / HARI_MS)
    if (hariSejak > t.frekuensiVisit) {
      alerts.push({
        kode: 'ALT-01',
        nama: 'Toko Melewati Jadwal Kunjungan',
        severity: 'warning',
        entitas: t.namaToko,
        detail: `Belum dikunjungi sesuai siklus ${t.frekuensiVisit} hari (sejak ${hariSejak} hari terakhir)`,
        meta: { tokoId: t.id, hariSejak },
      })
    }
  }

  // ===== ALT-02: SLA Sparepart Pending (REQUEST > 24 jam) =====
  const SLA_JAM = 24
  const slaTerlambat = tiketRequest.filter(
    (t) => !isDataLama(t) && (umurTiketJam(t, now) ?? 0) > SLA_JAM
  )
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
  for (const t of slaTerlambat) {
    const jamBerlalu = umurTiketJam(t, now) ?? 0
    alerts.push({
      kode: 'ALT-02',
      nama: 'SLA Sparepart Pending',
      severity: 'critical',
      entitas: t.noTiket,
      detail: `Tiket status REQUEST sudah ${formatUmur(jamBerlalu)} (> ${SLA_JAM} jam SLA) tanpa konfirmasi ketersediaan part — reminder dikirim ke Produsen`,
      meta: { tiketId: t.id, noTiket: t.noTiket, jam: jamBerlalu },
    })
  }

  // ===== ALT-03: Low Stock Sparepart (ROP) =====
  for (const s of spareparts) {
    if (s.stokInventory > s.reorderLimit) continue
    alerts.push({
      kode: 'ALT-03',
      nama: 'Low Stock Sparepart (ROP)',
      severity: s.stokInventory === 0 ? 'critical' : 'warning',
      entitas: s.kodePart,
      detail: `Stok ${s.namaPart} tersisa ${s.stokInventory} ${s.stokInventory === 0 ? '(KOSONG)' : `(≤ reorder limit ${s.reorderLimit})`} — draft formulir Re-Order Sparepart digenerate`,
      meta: { sparepartId: s.id, stok: s.stokInventory, limit: s.reorderLimit },
    })
  }

  // ===== ALT-04: Potential Unclaimed Revenue =====
  const BATAS_HARI = 7
  const unclaimed = tiketFinish.filter(
    (t) =>
      t.tglFinish &&
      (now - new Date(t.tglFinish).getTime()) > BATAS_HARI * HARI_MS &&
      t.statusKlaimProdusen === 'DRAFT'
  )
  const totalUnclaimed = unclaimed.reduce((acc, t) => {
    const partValue = t.parts.reduce((a, p) => a + (p.sparepart?.hargaKlaim ?? 0) * p.qty, 0)
    return acc + t.biayaJasa + partValue
  }, 0)
  for (const t of unclaimed) {
    const hariSejak = Math.floor((now - new Date(t.tglFinish as Date).getTime()) / HARI_MS)
    const partValue = t.parts.reduce((a, p) => a + (p.sparepart?.hargaKlaim ?? 0) * p.qty, 0)
    alerts.push({
      kode: 'ALT-04',
      nama: 'Potential Unclaimed Revenue',
      severity: 'warning',
      entitas: t.noTiket,
      detail: `FINISH sejak ${hariSejak} hari tapi klaim masih DRAFT — dana tertahan Rp ${(t.biayaJasa + partValue).toLocaleString('id-ID')}`,
      meta: { tiketId: t.id, noTiket: t.noTiket, nilai: t.biayaJasa + partValue },
    })
  }

  // ===== ALT-05: Unit Belum Terproses =====
  for (const t of tiketRequest) {
    if (t.parts.some((p) => p.statusPart === 'READY')) continue
    if (isDataLama(t)) continue
    const jamBerlalu = umurTiketJam(t, now) ?? 0
    if (jamBerlalu <= 24) continue
    alerts.push({
      kode: 'ALT-05',
      nama: 'Unit Belum Terproses',
      severity: jamBerlalu > 72 ? 'critical' : 'warning',
      entitas: t.noTiket,
      detail: `Belum ada kode + nama part yang READY selama ${formatUmur(jamBerlalu)} — input dari Master Data (tombol Part) atau detail tiket`,
      meta: { tiketId: t.id, noTiket: t.noTiket, jam: jamBerlalu },
    })
  }

  // ===== ALT-06: Unit Teregistrasi Tanpa Tiket =====
  // Unit yang didaftarkan (Registrasi Service) tapi belum pernah jadi tiket
  // service → gampang terlupa. Backdate (createdAt lama) tidak dihitung.
  const batasUnit = now - JENDELA_UNIT_TANPA_TIKET_HARI * HARI_MS
  const unitTerlupa = unitTanpaTiket.filter((u) => new Date(u.createdAt).getTime() >= batasUnit)
  for (const u of unitTerlupa) {
    const jamBerlalu = (now - new Date(u.createdAt).getTime()) / 3600_000
    alerts.push({
      kode: 'ALT-06',
      nama: 'Unit Terregistrasi Tanpa Tiket',
      severity: jamBerlalu > 72 ? 'critical' : 'warning',
      entitas: u.serialNumber || u.nama || `#${u.id}`,
      detail: `Unit teregistrasi ${formatUmur(jamBerlalu)} lalu tapi belum punya tiket service${u.toko ? ` (${u.toko.kodeToko} ${u.toko.namaToko})` : u.customer?.nama ? ` (${u.customer.nama})` : ''} — buat tiketnya`,
      meta: { unitId: u.id, jam: jamBerlalu },
    })
  }

  const terpotong = alerts.slice(0, MAKS_ALERT)
  return {
    generatedAt: new Date().toISOString(),
    total: terpotong.length,
    critical: terpotong.filter((a) => a.severity === 'critical').length,
    totalUnclaimedRevenue: totalUnclaimed,
    alerts: terpotong,
  }
}

/** Susun teks ringkasan alert untuk dikirim ke grup WA/Telegram. */
export function susunTeksAlert(hasil: HasilAlert): string {
  const kode = new Map<string, AlertItem[]>()
  for (const a of hasil.alerts) {
    const arr = kode.get(a.kode) ?? []
    arr.push(a)
    kode.set(a.kode, arr)
  }
  const bagian: string[] = [`⚠️ *RINGKASAN ALERT* (${hasil.total} aktif, ${hasil.critical} kritis)`]
  for (const [k, list] of kode) {
    bagian.push(`\n*${k} — ${list[0].nama}* (${list.length})`)
    for (const a of list.slice(0, 8)) {
      bagian.push(`• ${a.entitas}: ${a.detail}`)
    }
    if (list.length > 8) bagian.push(`…dan ${list.length - 8} lainnya`)
  }
  return bagian.join('\n')
}
