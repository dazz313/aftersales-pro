/**
 * Helper Nota Servis BASS — murni (tanpa Prisma), dipakai server & client.
 */

// Tipe data nota yang dikirim API (sesuai model Prisma Nota/NotaItem)
export interface NotaItemData {
  id?: number
  kode?: string | null
  nama?: string | null
  harga?: number | null
  qty?: number | null
}

export interface NotaData {
  id?: number
  nomorBass?: string
  lokasi?: string | null // Indoor | Outdoor
  tanggal?: string | null // "YYYY-MM-DD"
  jamMasuk?: string | null
  nama?: string
  alamat?: string | null
  telp?: string | null
  hp?: string | null
  merk?: string | null
  lp?: string | null
  model?: string | null
  noSeri?: string | null
  tglBeli?: string | null
  garansi?: string | null // Ya | Tdk
  tglSelesai?: string | null
  jamSelesai?: string | null
  pengaduan?: string | null
  kelengkapan?: string | null
  penyebab?: string | null
  perbaikan?: string | null
  biayaService?: number | null
  biayaTransportasi?: number | null
  ppnPersen?: number | null
  total?: number | null
  tglAmbil?: string | null
  ttdCustomer1?: string | null
  ttdTeknisi?: string | null
  ttdCustomer2?: string | null
  namaCustomer1?: string | null
  namaTeknisi?: string | null
  namaCustomer2?: string | null
  status?: string // draft | selesai | diambil
  createdAt?: string
  updatedAt?: string
  items?: NotaItemData[]
}

export const MERK_NOTA = [
  'Miyako',
  'Daikin',
  'Rinnai',
  'Shimizu',
  'Hisense',
  'TCL',
  'Toshiba',
  'Akari',
  'Philips',
  'Electrolux',
] as const

export type StatusNota = 'draft' | 'selesai' | 'diambil'

export const STATUS_NOTA_LABEL: Record<string, string> = {
  draft: 'Draft',
  selesai: 'Selesai',
  diambil: 'Diambil',
}

/** Nomor BASS harus 6 digit angka. */
export function nomorBassValid(n: string | null | undefined): boolean {
  return /^\d{6}$/.test((n ?? '').trim())
}

/** Format rupiah dengan titik ribuan (contoh: 12.500). */
export function rupiahNota(n: number | null | undefined): string {
  const v = Number(n ?? 0)
  if (!Number.isFinite(v)) return '0'
  return v.toLocaleString('id-ID', { maximumFractionDigits: 0 })
}

/** Parse teks rupiah apapun (contoh "Rp 12.500" atau "12500") → number. */
export function parseRupiahNota(text: string | null | undefined): number {
  if (text == null || text === '') return 0
  const digits = String(text).replace(/[^\d-]/g, '')
  if (digits === '' || digits === '-') return 0
  const n = Number(digits)
  return Number.isFinite(n) ? n : 0
}

/** "YYYY-MM-DD" → "D-M-YYYY" untuk tampilan nota. */
export function tanggalNota(iso: string | null | undefined): string {
  if (!iso) return ''
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return iso
  const d = Number(m[3]) // hari (DD)
  const mo = Number(m[2]) // bulan (MM)
  return `${d}-${mo}-${m[1]}`
}

/** Tanggal hari ini dalam format input date "YYYY-MM-DD" (lokal). */
export function hariIniNota(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export interface NotaHitung {
  totalSparepart: number
  subTotal: number
  ppn: number
  total: number
  garansiPenuh: boolean
}

/**
 * Hitung ringkasan biaya nota:
 * - Total Suku Cadang = Σ (harga × qty) baris
 * - Sub Total = Suku Cadang + Biaya Service + Transportasi
 * - PPN = ppnPersen % dari Sub Total; Total = Sub Total + PPN
 * Garansi "Ya" + opsi garansi penuh → seluruh biaya tolak/0 ("Biaya ditanggung garansi").
 */
export function hitungBiayaNota(nota: NotaData, itemsOverride?: NotaItemData[]): NotaHitung {
  const items = itemsOverride ?? nota.items ?? []
  const totalSparepart = items.reduce((acc, it) => acc + (Number(it.harga) || 0) * (Number(it.qty) || 0), 0)
  const biayaService = Number(nota.biayaService) || 0
  const biayaTransportasi = Number(nota.biayaTransportasi) || 0
  const garansiPenuh = (nota.garansi ?? '') === 'Ya' && (nota.total ?? 0) === 0
  if (garansiPenuh) {
    return { totalSparepart: 0, subTotal: 0, ppn: 0, total: 0, garansiPenuh }
  }
  const subTotal = totalSparepart + biayaService + biayaTransportasi
  const ppn = Math.round((subTotal * (Number(nota.ppnPersen) || 0)) / 100)
  const total = subTotal + ppn
  return { totalSparepart, subTotal, ppn, total, garansiPenuh }
}

/** Angka acak 6 digit untuk nomor BASS (kadegan awal form kosong). */
export function nomorBassAcak(): string {
  return String(Math.floor(100000 + Math.random() * 900000))
}
