/**
 * ===== Alur Surat Jalan per tiket — DETEKSI UNIT SUDAH/BELUM KE PRODUSEN =====
 * Jawaban atas "unit ini sudah dipesankan / alat bekasnya sudah dikirim?".
 * Terbaca langsung dari kolom tiket (tanpa tabel baru):
 * - BELUM_SJ        : masih ada part inden (ORDER_PRODUSEN) & belum pernah
 *                     dibuatkan surat jalan → alat bekas masih di kita
 * - SJR_TANPA_KIRIM : surat jalan sudah dicetak (tglRequestPart) tetapi alat
 *                     bekas BELUM terkirim (noSuratJalan kosong) — bisa beda hari
 * - BEKAS_TERKIRIM  : alat bekas sudah dikirim (noSuratJalan terisi), menunggu
 *                     part pengganti datang dari produsen
 * - PART_DATANG     : part pengganti sudah datang (tglPartDatang — diisi scan
 *                     Surat Jalan Masuk ATAU tombol "Part Datang" manual)
 * - TAK_PERLU_SJ    : tiket FINISH (alur part sudah tamat — tidak lagi ada
 *                     "bekas terkirim"/"part datang" yang relevan; part
 *                     terpasangnya tampil di kolom Tgl Finish) ATAU tanpa
 *                     part inden (semua READY / tanpa part) — strip
 *                     tidak ditampilkan agar daftar tetap bersih
 *
 * Dipakai bersama oleh service-view (badge + filter) dan surat-jalan-dialog
 * (guard dokumen dobel).
 */
import type { ServiceTicket } from './types'

export type AlurSj = 'BELUM_SJ' | 'SJR_TANPA_KIRIM' | 'BEKAS_TERKIRIM' | 'PART_DATANG' | 'TAK_PERLU_SJ'

export const ALUR_SJ_STYLES: Record<Exclude<AlurSj, 'TAK_PERLU_SJ'>, { label: string; cls: string }> = {
  BELUM_SJ: { label: 'Belum dibuatkan SJ', cls: 'border-rose-300 bg-rose-50 text-rose-700' },
  SJR_TANPA_KIRIM: { label: 'SJ dibuat — bekas belum kirim', cls: 'border-amber-300 bg-amber-50 text-amber-800' },
  BEKAS_TERKIRIM: { label: 'Bekas terkirim', cls: 'border-sky-300 bg-sky-50 text-sky-700' },
  PART_DATANG: { label: 'Part datang', cls: 'border-emerald-300 bg-emerald-50 text-emerald-700' },
}

/** Tanggal pendek DD/MM utk label chip (sama gaya dgn teks "Req:" lama). */
export const tglPendek = (s: string) => new Date(s).toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit' })

export function alurSjState(t: ServiceTicket): AlurSj {
  // Tiket FINISH keluar dari alur surat jalan part datang sampai-benar:
  // pengerjaan sudah tamat — tidak ada lagi "menunggu datang"/"bekas
  // terkirim" yang relevan. Chip-nya tidak dirender, filter & hitungan alur
  // SJ tidak menghitungnya, dialog surat jalan tidak menyertakannya.
  if (t.status === 'FINISH') return 'TAK_PERLU_SJ'

  // Pesanan susulan: satu unit bisa rusak di beberapa bagian. Setelah part
  // gelombang pertama datang, temuan baru bisa membuat part dipesan LAGI di
  // tiket yang sama. Selama masih ada part ORDER_PRODUSEN, status harus
  // kembali "menunggu part" — bukan tetap "Part datang" (menyesatkan, seolah
  // unit siap FINISH).
  const adaInden = t.parts.some((p) => p.qty > 0 && p.statusPart !== 'READY')
  if (adaInden) {
    if (t.noSuratJalan) return 'BEKAS_TERKIRIM'
    if (t.tglRequestPart) return 'SJR_TANPA_KIRIM'
    return 'BELUM_SJ'
  }

  if (t.tglPartDatang) return 'PART_DATANG'
  if (t.noSuratJalan) return 'BEKAS_TERKIRIM'
  if (t.tglRequestPart) return 'SJR_TANPA_KIRIM'
  return 'TAK_PERLU_SJ'
}
