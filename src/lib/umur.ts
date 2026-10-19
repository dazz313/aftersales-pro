/**
 * Helper umur tiket — SATU-SATUNYA acuan perhitungan umur.
 * ------------------------------------------------------------------
 * Basis umur = tglTiket (tanggal kejadian/laporan, boleh backdate untuk
 * data historis), BUKAN createdAt (hari upload). Sebelumnya umur dihitung
 * dari createdAt sehingga data lama yang diupload belakangan tercatat
 * berumur 0 jam dan lolos SLA.
 *
 * Data lama = selisih |createdAt - tglTiket| > BATAS_DATA_LAMA_HARI.
 * Untuk data lama, umur di-nonaktifkan di UI (badge DATA LAMA) dan
 * dikecualikan dari pengingat otomatis (alert SLA / laporan pending).
 */

export const BATAS_DATA_LAMA_HARI = 7

type Tanggal = string | Date | null | undefined

function keMs(t: Tanggal): number | null {
  if (!t) return null
  const ms = new Date(t).getTime()
  return Number.isNaN(ms) ? null : ms
}

/** Tanggal acuan umur: tglTiket bila valid, fallback createdAt. */
export function tanggalAcuanUmur(t: { tglTiket?: Tanggal; createdAt?: Tanggal }): number | null {
  return keMs(t.tglTiket) ?? keMs(t.createdAt)
}

/** Umur tiket dalam jam (dibulatkan ke bawah). Null bila tak ada tanggal valid. */
export function umurTiketJam(
  t: { tglTiket?: Tanggal; createdAt?: Tanggal },
  now = Date.now()
): number | null {
  const acuan = tanggalAcuanUmur(t)
  if (acuan === null) return null
  return Math.max(0, Math.floor((now - acuan) / 3600000))
}

/**
 * Teks umur yang mudah dibaca: "18 jam", "2 hari 5 jam", "7 hari".
 * > 24 jam tampil dalam hari (+ sisa jam) agar tidak perlu menghitung ke bawah.
 */
export function formatUmur(jam?: number | null): string {
  const h = Math.max(0, Math.floor(jam ?? 0))
  if (h < 24) return `${h} jam`
  const hari = Math.floor(h / 24)
  const sisa = h % 24
  return sisa > 0 ? `${hari} hari ${sisa} jam` : `${hari} hari`
}

/**
 * True bila tiket adalah data lama/backfill: selisih hari upload
 * (createdAt) vs tanggal kejadian (tglTiket) melebihi batas.
 */
export function isDataLama(
  t: { tglTiket?: Tanggal; createdAt?: Tanggal },
  batasHari = BATAS_DATA_LAMA_HARI
): boolean {
  const tiket = keMs(t.tglTiket)
  const buat = keMs(t.createdAt)
  if (tiket === null || buat === null) return false
  return Math.abs(buat - tiket) > batasHari * 24 * 3600 * 1000
}
