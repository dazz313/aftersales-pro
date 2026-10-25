/**
 * ===== Nama Part — penilai kemiripan nama (murni, tanpa dependensi) =====
 *
 * Dipakai fitur "kode otomatis" saat menambah sparepart di proses service:
 * pemilik mengetik NAMA part, sistem mencocokkannya ke riwayat kode yang
 * pernah diinput (Bank Kode). Normalisasi & penilaian dibuat murni agar mudah
 * diuji dan dipakai ulang (lib Bank Kode, endpoint cari-nama, dsb.).
 */

/** UPPERCASE, buang tanda baca jadi spasi, rapatkan spasi ganda. */
export function normNama(s: string): string {
  return String(s ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Skor kemiripan 0–100 antara nama yang diketik & nama riwayat.
 * - 100 = identik setelah normalisasi (tanda baca/spasi diabaikan)
 * - 90  = salah satu adalah awalan/berisikat yang lain (nama diperluas)
 * - <80 = proporsi token ≥3 huruf yang ada di keduanya × 80
 * Ambang "layak disarankan" di pemanggil: ≥80.
 */
export function skorNamaPart(target: string, kandidat: string): number {
  const t = normNama(target)
  const k = normNama(kandidat)
  if (!t || !k) return 0
  const tc = t.replace(/ /g, '')
  const kc = k.replace(/ /g, '')
  if (tc === kc) return 100
  if (kc.startsWith(tc) || tc.startsWith(kc)) return 90
  const tokenTarget = t.split(' ').filter((x) => x.length >= 3)
  if (!tokenTarget.length) return 0
  const tokenKandidat = new Set(k.split(' '))
  let ada = 0
  for (const x of tokenTarget) if (tokenKandidat.has(x)) ada++
  return Math.round((ada / tokenTarget.length) * 80)
}
