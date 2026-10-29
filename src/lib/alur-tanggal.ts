/**
 * ===== Validasi urutan tanggal alur service (FINISH vs part datang) =====
 * Dipusatkan agar API tiket (FINISH / KOREKSI_TGL_FINISH) memakai aturan yang
 * sama persis dan aturannya bisa diuji unit:
 *
 *   part datang → part dipasang → unit kembali ke toko → FINISH
 *
 * Tanggal FINISH TIDAK BOLEH lebih awal daripada kedatangan part maupun
 * pemasangan part — minimal SAMA HARI dengan kedatangan/pemasangan
 * (jam diabaikan, sehingga part datang sore & selesai pagi di hari yang
 * sama tetap diterima).
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
 * Return string pesan error bila tanggal FINISH melanggar urutan alur,
 * null bila valid. Pesan siap-kanal-tolak (400) dari API tiket.
 */
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
