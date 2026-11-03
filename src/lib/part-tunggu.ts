/**
 * ===== Part yang masih ditunggu (belum datang) pada satu tiket =====
 *
 * Satu unit bisa rusak di beberapa bagian (top plate, side, rear, …). Part
 * dipesan bergelombang: setelah gelombang pertama datang dan dipasang, bisa
 * ditemukan kerusakan lain → part baru dipesan LAGI di tiket yang sama.
 *
 * Aturan yang dijaga di sini:
 * - tiket **belum boleh FINISH** selama masih ada baris part `ORDER_PRODUSEN`
 *   (qty > 0) — supaya tidak "terpaksa selesai" hanya karena part pertama tiba;
 * - chip alur surat jalan kembali ke status "menunggu part" saat ada pesanan
 *   susulan, bukan tetap "Part datang".
 *
 * Satu tiket = satu siklus unit. TIDAK perlu membuat tiket baru untuk part
 * tambahan; cukup `TAMBAH_PART` di tiket yang sama.
 */

export interface PartTungguSumber {
  qty: number
  statusPart: string
  kodePartCache?: string | null
  namaPartCache?: string | null
  sparepart?: { kodePart: string; namaPart: string } | null
}

/** Baris part yang masih menunggu kedatangan (belum READY). */
export function daftarPartBelumDatang<T extends PartTungguSumber>(parts: readonly T[]): T[] {
  return parts.filter((p) => p.qty > 0 && p.statusPart !== 'READY')
}

/** Label ringkas satu baris part, mis. "KP-001 Kapasitor ×1". */
export function labelPartTunggu(p: PartTungguSumber): string {
  const kode = p.sparepart?.kodePart?.trim() || p.kodePartCache?.trim() || '(tanpa kode)'
  const nama = p.sparepart?.namaPart?.trim() || p.namaPartCache?.trim() || ''
  return `${kode}${nama ? ` ${nama}` : ''} ×${p.qty}`
}

/**
 * Pesan siap tampil untuk menolak FINISH / memberi peringatan di UI.
 * String kosong = semua part sudah READY (boleh FINISH).
 */
export function pesanPartBelumDatang(parts: readonly PartTungguSumber[]): string {
  const daftar = daftarPartBelumDatang(parts)
  if (daftar.length === 0) return ''
  return (
    `Belum bisa Selesaikan (FINISH): masih ada ${daftar.length} part yang belum datang — ` +
    `${daftar.map(labelPartTunggu).join(', ')}. ` +
    'Tiket tetap PROSES; tambah part lain bila ada temuan baru, atau hapus baris part bila batal dipakai. ' +
    'Setelah semua part tiba (READY) dan dipasang, baru Selesaikan.'
  )
}
