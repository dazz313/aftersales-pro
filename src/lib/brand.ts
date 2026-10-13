/**
 * Aturan merk & masa garansi (murni, aman dipakai client & server).
 * Disimpan di Pengaturan kunci `brand_daftar` sebagai JSON:
 *   [{"nama":"Miyako","garansiBulan":12}, ...]
 */

export interface BrandRule {
  nama: string
  garansiBulan: number
}

export const DEFAULT_BRANDS: BrandRule[] = [
  { nama: 'Miyako', garansiBulan: 12 },
  { nama: 'Rinnai', garansiBulan: 12 },
  { nama: 'Shimizu', garansiBulan: 12 },
]

export const BRAND_DAFTAR_KEY = 'brand_daftar'

/** Parse daftar merk dari nilai pengaturan (fallback ke default bila kosong/rusak). */
export function parseBrandRules(raw: unknown): BrandRule[] {
  try {
    if (!raw || (typeof raw === 'string' && !raw.trim())) return [...DEFAULT_BRANDS]
    const arr = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (!Array.isArray(arr)) return [...DEFAULT_BRANDS]
    const out: BrandRule[] = []
    for (const r of arr) {
      const nama = String(r?.nama ?? '').trim()
      const bulan = Math.max(0, Math.trunc(Number(r?.garansiBulan) || 0))
      if (nama) out.push({ nama, garansiBulan: bulan })
    }
    return out.length ? out : [...DEFAULT_BRANDS]
  } catch {
    return [...DEFAULT_BRANDS]
  }
}

/** Selisih bulan penuh antara tanggal beli dan tanggal acuan. */
export function umurBulan(tglBeli: Date, acuan = new Date()): number {
  let m = (acuan.getFullYear() - tglBeli.getFullYear()) * 12 + (acuan.getMonth() - tglBeli.getMonth())
  if (acuan.getDate() < tglBeli.getDate()) m -= 1
  return Math.max(0, m)
}

/**
 * Deteksi garansi dari merk + tanggal pembelian.
 * Kembali null bila merk tak ada di daftar atau tanggal kosong
 * (→ status diisi manual).
 */
export function detectGaransi(
  merk: string,
  tglPembelian: Date | string | null | undefined,
  rules: BrandRule[],
  acuan = new Date()
): 'GARANSI' | 'NON_GARANSI' | null {
  const found = rules.find((r) => r.nama.toLowerCase() === String(merk ?? '').trim().toLowerCase())
  if (!found || !tglPembelian) return null
  const tgl = tglPembelian instanceof Date ? tglPembelian : new Date(tglPembelian)
  if (Number.isNaN(tgl.getTime())) return null
  return umurBulan(tgl, acuan) < found.garansiBulan ? 'GARANSI' : 'NON_GARANSI'
}
