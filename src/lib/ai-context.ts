/**
 * Konteks dinamis untuk AI (modul Analisa AI) — membungkus ringkasan
 * pergerakan kondisi aplikasi dari database supaya AI (chat & analisa) bisa
 * "melihat" situasi operasional sebelum memberi saran/jawaban.
 *
 * - operasional: ringkasan KPI tiket/klaim/stok/kunjungan + tiket belum
 *   diproses terbanyak (sudah divalidasi di /api/dashboard + analisa AI).
 * - audit: riwayat audit terbaru (untuk troubleshooting perubahan data).
 *
 * Semua best-effort: bila query gagal, nilainya null dan AI tetap bisa
 * berbicara (tanpa konteks) — tidak menggugurkan fitur chat/analisa.
 */
import { db } from '@/lib/db'

export interface KonteksAi {
  dibangunPada: string
  operasional: string | null
  audit: string | null
}

export async function kumpulkanKonteksAudit(max = 20): Promise<string | null> {
  try {
    const rows = await db.auditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: max,
      select: { aksi: true, entitas: true, deskripsi: true, aktor: true, createdAt: true },
    })
    if (rows.length === 0) return null
    const baris = rows
      .map((r) => `- [${new Date(r.createdAt).toLocaleString('id-ID')}] ${r.aksi} — ${r.deskripsi} (aktor: ${r.aktor ?? '-'})`)
      .join('\n')
    return `RIWAYAT AUDIT TERBARU (${rows.length} entri):\n${baris}`
  } catch (e) {
    console.error('AI context audit gagal:', e)
    return null
  }
}

export async function kumpulkanKonteksOperasional(): Promise<string | null> {
  try {
    const [cReq, cPro, cFin, sla, claims, spareparts, tiketAktif, daftarToko, kunjungan7] = await Promise.all([
      db.serviceRequest.count({ where: { status: 'REQUEST' } }),
      db.serviceRequest.count({ where: { status: 'PROSES' } }),
      db.serviceRequest.count({ where: { status: 'FINISH' } }),
      db.serviceRequest.count({ where: { status: 'REQUEST', slaFlag: true } }),
      db.serviceRequest.findMany({
        where: { status: 'FINISH', statusKlaimProdusen: 'DRAFT' },
        include: { parts: { include: { sparepart: true } }, unitAsset: true },
        orderBy: { tglFinish: 'desc' },
        take: 10,
      }),
      db.masterSparepart.findMany(),
      db.serviceRequest.findMany({
        where: { status: 'REQUEST' },
        include: {
          parts: { include: { sparepart: true } },
          unitAsset: { include: { toko: true } },
        },
      }),
      db.masterToko.findMany({
        where: { aktif: true },
        select: { kodeToko: true, namaToko: true, modeSiklus: true, tglVisitTerakhir: true, frekuensiVisit: true },
      }),
      db.kunjungan.count({ where: { tglKunjungan: { gte: new Date(Date.now() - 7 * 24 * 3600 * 1000) } } }),
    ])

    // Total estimasi dana klaim tertahan (jasa + part)
    const totalKlaimPending = claims.reduce((acc, t) => {
      const partValue = t.parts.reduce((a, p) => a + (p.sparepart?.hargaKlaim ?? 0) * p.qty, 0)
      return acc + t.biayaJasa + partValue
    }, 0)

    // Belum diproses: tiket REQUEST tanpa part READY — urut tertua dulu.
    const belumProsesSemua = tiketAktif
      .filter((t) => !t.parts.some((p) => p.statusPart === 'READY'))
      .sort((a, b) => new Date(a.tglTiket).getTime() - new Date(b.tglTiket).getTime())
    const belumProses = belumProsesSemua.slice(0, 3).map(
      (t) =>
        `${t.noTiket} | SN ${t.unitAsset?.serialNumber ?? '-'} | ${t.unitAsset?.modelUnit ?? '-'} | ${t.unitAsset?.toko ? `${t.unitAsset.toko.kodeToko} — ${t.unitAsset.toko.namaToko}` : 'Perorangan'} | part: ${t.parts.length} item`
    )

    const stokKritis = spareparts.filter((s) => s.stokInventory <= s.reorderLimit)
    const stokKosong = spareparts.filter((s) => s.stokInventory === 0)

    const daftarTerlambat = daftarToko
      .filter((t) => t.modeSiklus !== 'BY_REQUEST')
      .filter((t) => !t.tglVisitTerakhir || (Date.now() - new Date(t.tglVisitTerakhir).getTime()) / (24 * 3600 * 1000) > t.frekuensiVisit)
      .slice(0, 5)

    const total = cReq + cPro + cFin
    const barisBelumProses = belumProsesSemua.length
      ? `- Belum diproses (REQUEST tanpa part READY): ${belumProsesSemua.length} — ${belumProses.join(' ;; ')}.`
      : '- Belum diproses (REQUEST tanpa part READY): 0.'
    const lines = [
      `KONDISI APLIKASI (dibangun ${new Date().toLocaleString('id-ID')}):`,
      `- Tiket service: REQUEST=${cReq}, PROSES=${cPro}, FINISH=${cFin} (total ${total}). SLA lewat: ${sla}.`,
      barisBelumProses,
      `- Klaim produsen pending (DRAFT dari FINISH): ${claims.length} buah, nilai ±Rp ${Math.round(totalKlaimPending).toLocaleString('id-ID')}.`,
      `- Stok sparepart: total item ${spareparts.length}, kritis (stok<=reorder) ${stokKritis.length}, kosong ${stokKosong.length}.`,
      `- Kunjungan toko: ${daftarTerlambat.length} toko aktif terlambat visit (kunjungan 7 hari terakhir = ${kunjungan7}).`,
    ]
    return lines.join('\n')
  } catch (e) {
    console.error('AI context operasional gagal:', e)
    return null
  }
}

/** Gabungan konteks operasional + audit untuk satu penyusunan konteks AI. */
export async function kumpulkanKonteks(): Promise<KonteksAi> {
  const [operasional, audit] = await Promise.all([kumpulkanKonteksOperasional(), kumpulkanKonteksAudit()])
  return { dibangunPada: new Date().toISOString(), operasional, audit }
}

/**
 * Status tiket service + part-nya — untuk akses AI cek detail:
 *  - tiket tertentu (noTiket) → status tiket + daftar part (READY / ORDER_PRODUSEN / TIDAK_READY).
 *  - tanpa argumen → tiket berstatus PROSES (siap final assembly / butuh penanganan lanjut).
 * Mengembalikan teks ringkas untuk konteks AI. Best-effort.
 */
export async function statusTiket(noTiket?: string): Promise<string | null> {
  try {
    if (noTiket) {
      const t = await db.serviceRequest.findUnique({
        where: { noTiket },
        include: { parts: { include: { sparepart: true } }, unitAsset: true },
      })
      if (!t) return `TIKET ${noTiket} TIDAK DITEMUKAN.`
      const bagian = t.parts
        .map((p) => `part=${p.sparepart?.kodePart ?? '?'} nama=${p.sparepart?.namaPart ?? '?'} qty=${p.qty} statusPart=${p.statusPart} statusKonfirmasi=${p.statusKonfirmasi ?? '-'}`)
        .join(' | ')
      return `TIKET ${t.noTiket}: status=${t.status} lokasiUnit=${t.lokasiUnit} penanganan=${t.penanganan} unitSN=${t.unitAsset?.serialNumber ?? '-'} model=${t.unitAsset?.modelUnit ?? '-'}\nPARTS: ${bagian || 'tanpa part'}`
    }
    const daftar = await db.serviceRequest.findMany({
      where: { status: 'PROSES' },
      include: { parts: { include: { sparepart: true } } },
      orderBy: { tglTiket: 'desc' },
      take: 30,
    })
    if (daftar.length === 0) return null
    const blok = daftar
      .map((t) => `TIKET ${t.noTiket}: status=${t.status} PARTS: ${t.parts.map((p) => `part=${p.sparepart?.kodePart ?? '?'} statusPart=${p.statusPart} statusKonfirmasi=${p.statusKonfirmasi ?? '-'} qty=${p.qty}`).join(' | ') || 'tanpa part'}`)
      .join('\n')
    return `STATUS TIKET PROSES (final assembly / butuh penanganan):\n${blok}`
  } catch (e) {
    console.error('AI statusTiket gagal:', e)
    return null
  }
}
