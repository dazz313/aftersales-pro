/**
 * Logika TAHAP & AKSI untuk aplikasi mobile (Kotlin).
 *
 * Fungsi murni (tanpa Prisma) supaya mudah diuji: memetakan state tiket
 * (status + penanganan + lokasiUnit) menjadi satu tahap yang mudah ditampilkan
 * di HP, plus daftar aksi lanjutan yang BOLEH dipanggil lewat
 * `PATCH /api/service/[id]` dengan `{ aksi }`.
 *
 * Aturan di sini SENGAJA mencerminkan guard di route service agar tombol di HP
 * tidak menawarkan aksi yang pasti ditolak server. Server tetap sumber kebenaran:
 * validasi akhir (mis. tanggal, part READY, STTB) tetap di route.
 */

export type TahapMobile =
  | 'TERDAFTAR'
  | 'REQUEST'
  | 'REQUEST_EMAIL'
  | 'TUNGGU_PART'
  | 'PROSES'
  | 'PROSES_DI_TOKO'
  | 'DI_WORKSHOP'
  | 'FINISH'
  | 'FINISH_DI_WORKSHOP'
  | 'SELESAI_DI_TOKO'

export interface PartRingkas {
  statusPart?: string | null
  sparepart?: { kodePart?: string | null } | null
}

/** Bagian tiket yang dibutuhkan untuk menghitung tahap (subset ServiceRequest). */
export interface TiketTahap {
  status: string
  penanganan?: string | null
  lokasiUnit?: string | null
  tglKembaliKeToko?: string | Date | null
  parts?: PartRingkas[] | null
}

export interface AksiMobile {
  /** Nilai yang dikirim sebagai `{ "aksi": ... }` ke PATCH /api/service/[id]. */
  aksi: string
  label: string
  /** Field tambahan yang harus/boleh dikirim di body. */
  body?: string[]
  keterangan?: string
}

const LABEL_TAHAP: Record<TahapMobile, string> = {
  TERDAFTAR: 'Terdaftar — belum ada tiket service',
  REQUEST: 'Tiket REQUEST — menunggu part / penentuan penanganan',
  REQUEST_EMAIL: 'Tiket REQUEST EMAIL — menunggu order part ke produsen',
  TUNGGU_PART: 'Menunggu part di toko',
  PROSES: 'Proses — penanganan belum ditentukan',
  PROSES_DI_TOKO: 'Sedang dikerjakan di toko',
  DI_WORKSHOP: 'Unit di workshop',
  FINISH: 'Selesai dikerjakan',
  FINISH_DI_WORKSHOP: 'Selesai dikerjakan — unit masih di workshop',
  SELESAI_DI_TOKO: 'Selesai — unit sudah kembali ke toko',
}

/** Label tahap siap tampil di HP. */
export function labelTahap(tahap: TahapMobile): string {
  return LABEL_TAHAP[tahap]
}

/**
 * Hitung tahap dari state tiket.
 * `null` = unit terdaftar tetapi belum punya tiket service.
 */
export function hitungTahap(tiket: TiketTahap | null): TahapMobile {
  if (!tiket) return 'TERDAFTAR'
  const status = String(tiket.status ?? '').toUpperCase()
  const penanganan = String(tiket.penanganan ?? '').toUpperCase()
  const lokasi = String(tiket.lokasiUnit ?? '').toUpperCase()

  if (status === 'REQUEST_EMAIL') return 'REQUEST_EMAIL'
  if (status === 'REQUEST') {
    return penanganan === 'TUNGGU_PART_TOKO' ? 'TUNGGU_PART' : 'REQUEST'
  }
  if (status === 'PROSES') {
    if (penanganan === 'TUNGGU_PART_TOKO') return 'TUNGGU_PART'
    if (penanganan === 'DI_TOKO') return 'PROSES_DI_TOKO'
    if (penanganan === 'TARIK_WORKSHOP' || lokasi === 'WORKSHOP') return 'DI_WORKSHOP'
    return 'PROSES'
  }
  if (status === 'FINISH') {
    return lokasi === 'WORKSHOP' ? 'FINISH_DI_WORKSHOP' : 'SELESAI_DI_TOKO'
  }
  return 'REQUEST'
}

/**
 * Aksi lanjutan yang boleh ditawarkan di HP.
 *
 * Catatan alur (sesuai guard /api/service/[id]):
 * - REQUEST + semua part READY  → KERJAKAN_DI_TOKO / TARIK_WORKSHOP
 * - REQUEST + ada part belum READY → DAFTAR_TUNGGU_TOKO (unit tetap di toko)
 * - PROSES (penanganan BELUM)  → KERJAKAN_DI_TOKO / TARIK_WORKSHOP
 * - PROSES                     → FINISH
 * - PROSES / FINISH            → KEMBALI_KE_TOKO (sekali saja; tglKembaliKeToko null)
 */
export function aksiTersedia(tiket: TiketTahap | null): AksiMobile[] {
  if (!tiket) return []
  const status = String(tiket.status ?? '').toUpperCase()
  const penanganan = String(tiket.penanganan ?? '').toUpperCase()
  const sudahKembali = Boolean(tiket.tglKembaliKeToko)
  const parts = tiket.parts ?? []
  const belumReady = parts.filter((p) => String(p.statusPart ?? '').toUpperCase() !== 'READY')

  const daftar: AksiMobile[] = []

  const bisaTentukanPenanganan =
    status === 'REQUEST' || (status === 'PROSES' && penanganan === 'BELUM')

  if (bisaTentukanPenanganan) {
    if (belumReady.length > 0) {
      if (status === 'REQUEST') {
        daftar.push({
          aksi: 'DAFTAR_TUNGGU_TOKO',
          label: 'Tunggu Part di Toko',
          keterangan: `${belumReady.length} part belum READY — unit tetap disimpan di toko`,
        })
      }
    } else {
      daftar.push(
        {
          aksi: 'KERJAKAN_DI_TOKO',
          label: 'Kerjakan di Toko',
          keterangan: 'Unit dikerjakan di lokasi toko (tanpa penarikan)',
        },
        {
          aksi: 'TARIK_WORKSHOP',
          label: 'Bawa ke Workshop',
          keterangan: 'Unit ditarik ke workshop — nomor STTB terbit otomatis',
        },
      )
    }
  }

  if (status === 'PROSES') {
    daftar.push({
      aksi: 'FINISH',
      label: 'Selesaikan (Finish)',
      body: ['tglFinish?', 'fotoNotaStempel?', 'tandaTanganDigital?'],
      keterangan: 'Pengerjaan selesai; unit boleh masih di workshop',
    })
  }

  if ((status === 'PROSES' || status === 'FINISH') && !sudahKembali) {
    daftar.push({
      aksi: 'KEMBALI_KE_TOKO',
      label: 'Kirim Balik ke Toko',
      body: ['tglKembali?'],
      keterangan: 'Konfirmasi unit sampai di toko — STTB dicabut',
    })
  }

  return daftar
}
