/**
 * ===== Validasi urutan tanggal alur service (FINISH vs tgl kembali) =====
 * Dipusatkan agar API tiket (FINISH / KOREKSI_TGL_FINISH / KEMBALI_KE_TOKO)
 * memakai aturan yang sama persis dan aturannya bisa diuji unit:
 *
 *   part datang → part dipasang → FINISH → unit kembali ke toko
 *
 * Dua fungsi saling melengkapi (arah berlawanan):
 *  - pesanAlurTglFinish : FINISH tidak boleh lebih awal daripada kedatangan
 *    part maupun pemasangan part (minimal SAMA HARI); untuk tiket alur lama
 *    yang sudah terekam kembali, FINISH minimal sesudah tanggal kembali.
 *  - pesanAlurTglKembali: tgl kembali (alur baru — dicatat saat unit sampai
 *    di toko, setelah FINISH) tidak boleh lebih awal dari part datang, part
 *    terpasang, ataupun tglFinish.
 * Jam diabaikan (pembanding hari kalender), sehingga part datang sore &
 * selesai pagi di hari yang sama tetap diterima.
 */
export type TiketTanggal = {
  tglPartDatang?: Date | string | null
  tglKembaliKeToko?: Date | string | null
  parts?: { tglPasang?: Date | string | null; sparepart?: { kodePart?: string } | null; kodePartCache?: string | null }[]
}

/** Indeks hari kalender (waktu lokal diabaikan jam) — pembanding "minimal sama hari". */
export function hariKe(d: Date | string | number): number {
  const x = new Date(d)
  return new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
}

/**
 * Return string pesan error bila tanggal unit KEMBALI ke toko melanggar
 * urutan alur, null bila valid. Kebalikan pesanAlurTglFinish:
 *
 *   part datang → part dipasang → FINISH → unit kembali ke toko
 *
 * Alur baru memungkinkan FINISH saat unit masih di workshop (tglFinish =
 * rekaman pekerjaan selesai); tanggal kembali dicatat belakangan saat unit
 * benar-benar sampai di toko — jadi tidak boleh SEBELUM tanggal selesai
 * pengerjaan / kedatangan / pemasangan part (minimal SAMA HARI).
 */
export type TiketAlurKembali = {
  tglFinish?: Date | string | null
  tglPartDatang?: Date | string | null
  parts?: { tglPasang?: Date | string | null; sparepart?: { kodePart?: string } | null; kodePartCache?: string | null }[]
}

export function pesanAlurTglKembali(tglKembali: Date, tiket: TiketAlurKembali): string | null {
  const hariKembali = hariKe(tglKembali)
  // 1) Part datang dari produsen
  if (tiket.tglPartDatang && hariKembali < hariKe(tiket.tglPartDatang as string)) {
    const tgl = new Date(tiket.tglPartDatang as string).toLocaleDateString('id-ID')
    return `Tanggal kembali tidak boleh lebih awal dari tanggal part datang (${tgl}) — minimal sama hari dengan kedatangan part.`
  }
  // 2) Pemasangan part
  for (const p of tiket.parts ?? []) {
    if (p.tglPasang && hariKembali < hariKe(p.tglPasang as string)) {
      const kode = (p.sparepart?.kodePart ?? p.kodePartCache ?? 'part').trim() || 'part'
      const tgl = new Date(p.tglPasang as string).toLocaleDateString('id-ID')
      return `Tanggal kembali tidak boleh lebih awal dari tanggal pemasangan part ${kode} (${tgl}) — minimal sama hari part terpasang.`
    }
  }
  // 3) Tanggal FINISH (pekerjaan selesai di workshop)
  if (tiket.tglFinish && hariKembali < hariKe(tiket.tglFinish as string)) {
    const tgl = new Date(tiket.tglFinish as string).toLocaleDateString('id-ID')
    return `Tanggal kembali tidak boleh lebih awal dari tanggal selesai dikerjakan (${tgl}) — minimal sama hari dengan FINISH.`
  }
  return null
}

/**
 * ===== Durasi unit di workshop =====
 * Indikator "lama unit di workshop" (menggantikan posisi kolom Umur lama di
 * UI — kini berdampingan dengan Tgl Finish & Part terpasang). Tidak ada kolom
 * khusus "masuk workshop", jadi diambil tanggal PALING AWAL dari sinyal
 * kerja unit di workshop: request part/SJ (tglRequestPart), part datang,
 * pemasangan part (tglPasang per baris), dan FINISH. Bila tanggal kembali
 * sudah terekam, hitungan dipotong sampai tanggal itu (durasi lampau).
 *
 * Approximasi diakui: tglPasang bisa tercatat saat unit masih di toko —
 * hasil tetap "sejak sinyal kerja paling awal", cukup akurat utk sekilas.
 */
export type TiketDurasiWorkshop = {
  tglRequestPart?: Date | string | null
  tglPartDatang?: Date | string | null
  tglKembaliKeToko?: Date | string | null
  tglFinish?: Date | string | null
  parts?: { tglPasang?: Date | string | null }[]
}

/** jam unit di workshop + tanggal acuan mulai (ISO). Null bila tak ada sinyal. */
export function durasiUnitWorkshop(
  t: TiketDurasiWorkshop,
  now = Date.now()
): { jam: number; mulai: string } | null {
  const kandidat: number[] = []
  for (const s of [t.tglRequestPart, t.tglPartDatang, t.tglFinish]) {
    if (!s) continue
    const ms = new Date(s as string | Date).getTime()
    if (!Number.isNaN(ms)) kandidat.push(ms)
  }
  for (const p of t.parts ?? []) {
    if (!p.tglPasang) continue
    const ms = new Date(p.tglPasang as string | Date).getTime()
    if (!Number.isNaN(ms)) kandidat.push(ms)
  }
  if (kandidat.length === 0) return null
  const mulai = Math.min(...kandidat)
  const akhir = t.tglKembaliKeToko ? new Date(t.tglKembaliKeToko as string).getTime() : now
  const jam = Math.max(0, Math.floor((akhir - mulai) / 3600000))
  return { jam, mulai: new Date(mulai).toISOString() }
}

export function pesanAlurTglFinish(tglFinish: Date, tiket: TiketTanggal): string | null {
  const hariFinish = hariKe(tglFinish)
  // 1) Part datang dari produsen (Surat Jalan Masuk / tombol Part Datang)
  if (tiket.tglPartDatang && hariFinish < hariKe(tiket.tglPartDatang as string)) {
    const tgl = new Date(tiket.tglPartDatang as string).toLocaleDateString('id-ID')
    return `Tanggal selesai tidak boleh lebih awal dari tanggal part datang (${tgl}) — minimal sama hari dengan kedatangan part.`
  }
  // 2) Pemasangan part (tglPasang per baris part) — part dipasang setelah datang
  for (const p of tiket.parts ?? []) {
    if (p.tglPasang && hariFinish < hariKe(p.tglPasang as string)) {
      const kode = (p.sparepart?.kodePart ?? p.kodePartCache ?? 'part').trim() || 'part'
      const tgl = new Date(p.tglPasang as string).toLocaleDateString('id-ID')
      return `Tanggal selesai tidak boleh lebih awal dari tanggal pemasangan part ${kode} (${tgl}) — minimal sama hari part terpasang.`
    }
  }
  // 3) Unit kembali ke toko dicatat (KEMBALI_KE_TOKO / FINISH) — nota distempel di toko
  if (tiket.tglKembaliKeToko && hariFinish < hariKe(tiket.tglKembaliKeToko as string)) {
    const tgl = new Date(tiket.tglKembaliKeToko as string).toLocaleDateString('id-ID')
    return `Tanggal selesai tidak boleh lebih awal dari tanggal unit dikembalikan ke toko (${tgl}).`
  }
  return null
}
