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

export type TipeNotifikasi = 'REGISTRASI_UNIT' | 'TIKET_BARU'

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

/** Notifikasi lebih tua dari 30 hari dibersihkan (biar tabel tidak membengkak). */
const UMUR_NOTIFIKASI_HARI = 30

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
