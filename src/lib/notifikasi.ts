import { db } from '@/lib/db'

/**
 * Notifikasi In-App (lonceng header)
 * ------------------------------------
 * Sumber kebenaran notifikasi ada di SERVER (tabel Notifikasi), bukan di
 * localStorage browser. Semua role (teknisi / admin / manager) melihat daftar
 * notifikasi yang sama; status "sudah dibaca" dicatat per pengguna (tabel
 * NotifikasiBaca) sehingga satu user membuka lonceng tidak menghilangkan
 * notifikasi untuk user lain.
 *
 * Pemicu yang sudah terpasang:
 *  • Registrasi Service unit baru  → POST /api/unit
 *  • Registrasi Service massal     → POST /api/unit/import
 *  • Tiket service baru (manual)   → POST /api/service
 *  • Tiket service baru (bot WA)   → src/lib/laporan.ts
 *
 * Catatan: helper ini SENGAJA tidak melempar error. Notifikasi adalah info
 * tambahan — kegagalan menulis notifikasi tidak boleh membatalkan transaksi
 * registrasi unit.
 */

/** Role internal yang wajib melihat notifikasi operasional. */
export const ROLE_NOTIFIKASI = 'TEKNISI,ADMIN_WORKSHOP,MANAGER'

/**
 * Notifikasi keluar aplikasi (WhatsApp / Telegram).
 *
 * Sakelar (tabel Pengaturan):
 *  - notifikasi_gateway_aktif        : master — "true" = boleh kirim ke grup
 *  - notifikasi_registrasi_gateway   : notifikasi registrasi unit (default true)
 *  - notifikasi_produsen_gateway     : permintaan sparepart ke produsen (default true)
 *  - notifikasi_alert_gateway        : ringkasan alert harian (default true)
 *
 * Semua default-nya OFF untuk master switch → tidak ada pesan yang keluar
 * aplikasi tanpa diizinkan lewat Pengaturan.
 */
export type JenisNotifGateway = 'registrasi' | 'produsen' | 'alert'

/**
 * Sakelar notifikasi LONCENG untuk ringkasan alert harian — tabel Pengaturan
 * kunci `alert_lonceng_aktif`. Default MATI (tak ada baris/nilai ≠ "true"):
 * ringkasan alert tetap disusun & dikirim ke grup gateway (sakelar
 * notifikasi_alert_gateway tersendiri), tapi TIDAK lagi memunculkan
 * notifikasi/toast di lonceng. Alasannya: ringkasan menghitung SEMUA kondisi
 * yang sekadar menunggu ditindak (part stok ≤ reorder, toko lewat jadwal,
 * tiket SLA lewat, dsb.) sehingga tiap hari pasti berbunyi — pola kemunculannya
 * yang muncul di waktu aksi user (tick 30 menit kebetulan bersamaan dengan
 * registrasi unit) membuatnya terasa seperti dipicu oleh aksi itu.
 * Salakan bila admin memang ingin ringkasan juga tampil di lonceng.
 */
export async function alertLoncengAktif(): Promise<boolean> {
  try {
    const row = await db.pengaturan.findUnique({ where: { kunci: 'alert_lonceng_aktif' } })
    return row?.nilai === 'true'
  } catch {
    return false
  }
}

export async function gatewayNotifAktif(jenis: JenisNotifGateway): Promise<boolean> {
  try {
    const rows = await db.pengaturan.findMany({
      where: { kunci: { in: ['notifikasi_gateway_aktif', `notifikasi_${jenis}_gateway`] } },
    })
    const map: Record<string, string> = {}
    for (const r of rows) map[r.kunci] = r.nilai
    if (map['notifikasi_gateway_aktif'] !== 'true') return false
    return map[`notifikasi_${jenis}_gateway`] !== 'false'
  } catch {
    return false
  }
}

/**
 * Kirim notifikasi ke channel default gateway (WA/Telegram sesuai
 * Pengaturan). Mengembalikan hasil; kalau sakelar mati → mode 'DIMATIKAN'.
 */
export async function kirimNotifikasiGateway(
  teks: string,
  jenis: JenisNotifGateway,
  meta: Record<string, unknown> = {}
): Promise<{ ok: boolean; mode: string; detail: string }> {
  if (!(await gatewayNotifAktif(jenis))) {
    return { ok: false, mode: 'DIMATIKAN', detail: 'Notifikasi ke grup dimatikan di Pengaturan.' }
  }
  const { getGatewayConfig, kirimGateway } = await import('@/lib/gateway')
  const cfg = await getGatewayConfig()
  const hasil = await kirimGateway(cfg.channelDefault, teks, {
    pengirim: 'ASPRO-NOTIFIKASI',
    meta: { ...meta, jenis },
  })
  return { ok: hasil.ok, mode: hasil.mode, detail: hasil.detail }
}

export type TipeNotifikasi = 'REGISTRASI_UNIT' | 'TIKET_BARU' | 'ALERT'

export interface BuatNotifikasiInput {
  tipe: TipeNotifikasi
  judul: string
  pesan: string
  /** 'unit' | 'service_request' | 'unit-massal' — untuk lonceng melompat ke layar tujuan. */
  refType?: string
  refId?: number
  /** Nomor seri unit / nomor tiket — ditampilkan di lonceng. */
  refLabel?: string
  /** Nama/user yang memicu (aktor). */
  dibuatOleh?: string | null
  /** null = semua role; else daftar role dipisah koma. */
  untukRole?: string | null
}

/** Tulis satu notifikasi. Gagal → catat di log server, return null (tidak melempar). */
export async function buatNotifikasi(input: BuatNotifikasiInput): Promise<number | null> {
  try {
    const n = await db.notifikasi.create({
      data: {
        tipe: input.tipe,
        judul: input.judul,
        pesan: input.pesan,
        refType: input.refType ?? null,
        refId: input.refId ?? null,
        refLabel: input.refLabel ?? null,
        dibuatOleh: input.dibuatOleh ?? null,
        untukRole: input.untukRole ?? null,
      },
    })
    void bersihkanNotifikasiLama()
    return n.id
  } catch (e) {
    console.error('Gagal menyimpan notifikasi:', e)
    return null
  }
}

/** Notifikasi lebih tua dari 7 hari dibersihkan (biar tabel tidak membengkak & sesuai kebijakan retensi log). */
const UMUR_NOTIFIKASI_HARI = 7

export async function bersihkanNotifikasiLama(): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - UMUR_NOTIFIKASI_HARI * 24 * 3600 * 1000)
    const lama = await db.notifikasi.findMany({ where: { createdAt: { lt: cutoff } }, select: { id: true } })
    if (!lama.length) return
    const ids = lama.map((n) => n.id)
    await db.notifikasiBaca.deleteMany({ where: { notifikasiId: { in: ids } } })
    await db.notifikasi.deleteMany({ where: { id: { in: ids } } })
  } catch (e) {
    console.error('Gagal membersihkan notifikasi lama:', e)
  }
}

/**
 * Susun teks notifikasi registrasi unit.
 * Dipisah dari DB agar bisa dipakai juga oleh impor CSV.
 */
export function susunPesanRegistrasi(p: {
  nama: string
  merk?: string | null
  modelUnit?: string | null
  serialNumber?: string | null
  kerusakanAwal?: string | null
  statusGaransi?: string | null
  toko?: { kodeToko: string; namaToko: string } | null
  customer?: { nama: string } | null
}): string {
  const bagian: string[] = []
  const unit = [p.merk?.trim(), p.modelUnit?.trim()].filter(Boolean).join(' ')
  bagian.push(p.nama?.trim() || unit || '(tanpa nama)')
  if (p.serialNumber?.trim()) bagian.push(`No. seri ${p.serialNumber.trim()}`)
  if (p.toko) bagian.push(`Toko ${p.toko.kodeToko} — ${p.toko.namaToko}`)
  else if (p.customer?.nama) bagian.push(`Customer ${p.customer.nama}`)
  if (p.statusGaransi) bagian.push(`Garansi ${p.statusGaransi}`)
  const owner = bagian.join(' · ')
  return p.kerusakanAwal?.trim()
    ? `${owner}\nKerusakan awal: ${p.kerusakanAwal.trim()}`
    : owner
}
