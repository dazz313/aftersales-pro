/**
 * Render bertahap (pagination sisi klien) untuk daftar panjang.
 *
 * SENGAJA sisi klien: daftar-daftar besar (tiket, kunjungan, master) sudah punya
 * filter/pencarian/penyeleksian internal yang berjalan di memori. Bila dipindah
 * ke pagination sisi server, semua logika itu WAJIB ditulis ulang per-query —
 * berisiko tinggi mematahkan alur kerja. Dengan memotong RENDER, biaya DOM tiap
 * frame turun drastis tanpa mengubah perilaku filter/pencarian sama sekali.
 *
 * (Bila kelak muatan jaringan jadi masalah, endpoint dapat ditambah pagination
 * sisi server secara opt-in tanpa mengubah API yang ada.)
 */

/** Jumlah baris yang ditampilkan lebih dulu, dan pertambahan tiap "tampilkan lebih banyak". */
export const UKURAN_BERTAHAP = 60

export interface HasilBertahap<T> {
  /** Baris yang dirender. */
  tampil: T[]
  /** Jumlah total baris pada daftar sumber. */
  total: number
  /** Sisa baris yang belum dirender. */
  sisa: number
  /** True bila masih ada baris yang belum dirender. */
  adaLagi: boolean
}

/**
 * Potong daftar untuk ditampilkan. Aman terhadap input null/undefined dan batas
 * yang tidak masuk akal (NaN/negatif → 0 baris).
 */
export function potongBertahap<T>(
  items: readonly T[] | null | undefined,
  batas: number
): HasilBertahap<T> {
  const list = items ?? []
  const total = list.length
  const aman = Number.isFinite(batas) ? Math.max(0, Math.floor(batas)) : 0
  const tampil = list.slice(0, aman)
  const sisa = Math.max(0, total - tampil.length)
  return { tampil, total, sisa, adaLagi: sisa > 0 }
}

/** Batas render yang tersimpan + "kunci" filter yang menyebabkannya. */
export interface BatasState {
  /** Sidik jari filter/pencarian yang berlaku saat batas terakhir diubah. */
  kunci: string
  /** Batas render yang tersimpan. */
  batas: number
}

/**
 * Hitung batas render yang berlaku. Bila filter berubah (kunci beda), otomatis
 * kembali ke ukuran awal — sehingga daftar ter-reset ke halaman pertama TANPA
 * useEffect/setState di dalam efek (menghindari render berantai).
 */
export function batasAktif(state: BatasState, kunci: string, ukuran: number = UKURAN_BERTAHAP): number {
  return state.kunci === kunci ? state.batas : ukuran
}
