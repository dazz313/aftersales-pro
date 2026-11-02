/**
 * KODE STIKER UNIT — isi QR yang ditempel di produk.
 *
 * Format (satu baris, dipisah `|`, kunci huruf besar):
 *
 *   SN:<nomor seri>|MOD:<model>|TOK:<toko/customer>|NAMA:<nama produk>
 *
 * Alasan:
 * - `SN:` selalu di depan → aplikasi lama yang hanya mencari bagian `SN:` tetap
 *   jalan, dan "Tag ID" di aplikasi mobile = nilai `SN:` (bukan seluruh teks QR).
 * - 4 identifikasi utama ikut tercetak di QR, jadi HP bisa menampilkan nama
 *   produk/model/toko **tanpa** menebak atau memanggil server lebih dulu.
 * - Tetap kompatibel mundur: QR lama yang hanya berisi nomor seri (atau format
 *   lama `SN:..|MOD:..|TOK:..` tanpa NAMA) tetap dikenali.
 *
 * Nilai dibatasi panjangnya supaya QR tetap renggang dan mudah dipindai saat
 * stiker dicetak mini 28 mm. Data lengkap tetap tersedia dari
 * `GET /api/mobile/scan` (server membaca database, bukan stiker).
 */

export const BATAS_FIELD = {
  serialNumber: 32,
  modelUnit: 24,
  namaProduk: 36,
  pemilik: 30,
} as const

export interface IdentitasUnit {
  /** Nomor seri = "Tag ID" yang dipakai aplikasi mobile. */
  serialNumber: string
  modelUnit: string
  namaProduk: string
  /** Nama toko (atau nama customer untuk unit perorangan). */
  pemilik: string
}

export interface SumberIdentitasUnit {
  serialNumber?: string | null
  modelUnit?: string | null
  nama?: string | null
  /** Nama toko/customer — dipakai sebagai nilai `TOK:`. */
  pemilik?: string | null
}

/** Buang pemisah & karakter kontrol, rapikan spasi, batasi panjang. */
function bersih(nilai: string | null | undefined, maks: number): string {
  return (nilai ?? '')
    .replace(/[|\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maks)
    .trim()
}

/**
 * Bangun isi QR stiker unit. Mengembalikan string kosong bila nomor seri belum
 * diisi (stiker tidak boleh dicetak tanpa kunci unik).
 */
export function bangunKodeUnit(unit: SumberIdentitasUnit): string {
  const serialNumber = bersih(unit.serialNumber, BATAS_FIELD.serialNumber)
  if (!serialNumber) return ''
  const modelUnit = bersih(unit.modelUnit, BATAS_FIELD.modelUnit)
  const namaProduk = bersih(unit.nama, BATAS_FIELD.namaProduk) || modelUnit
  const pemilik = bersih(unit.pemilik, BATAS_FIELD.pemilik)
  return [
    `SN:${serialNumber}`,
    `MOD:${modelUnit || '-'}`,
    `TOK:${pemilik || '-'}`,
    `NAMA:${namaProduk || '-'}`,
  ].join('|')
}

const KUNCI = new Set(['SN', 'MOD', 'TOK', 'NAMA'])

/**
 * Urai isi QR menjadi 4 identifikasi.
 * - `SN:..|MOD:..|TOK:..|NAMA:..` (format baru)
 * - `SN:..|MOD:..|TOK:..`         (format lama)
 * - `2603128725B`                 (stiker lama: hanya nomor seri)
 */
export function uraiKodeUnit(kode: string | null | undefined): IdentitasUnit | null {
  const teks = (kode ?? '').trim()
  if (!teks) return null

  const bagian = teks.split('|')
  const peta = new Map<string, string>()
  for (const b of bagian) {
    const pisah = b.indexOf(':')
    if (pisah <= 0) continue
    const kunci = b.slice(0, pisah).trim().toUpperCase()
    if (!KUNCI.has(kunci)) continue
    peta.set(kunci, b.slice(pisah + 1).trim())
  }

  if (peta.size === 0) {
    // Stiker lama: seluruh isi QR adalah nomor seri.
    return { serialNumber: teks, modelUnit: '', namaProduk: '', pemilik: '' }
  }

  const serialNumber = peta.get('SN') ?? ''
  if (!serialNumber) return null
  const modelUnit = peta.get('MOD') ?? ''
  return {
    serialNumber,
    modelUnit,
    namaProduk: peta.get('NAMA') ?? '',
    pemilik: peta.get('TOK') ?? '',
  }
}

/** True bila teks benar-benar berformat kunci-nilai stiker (`SN:...`). */
export function adalahKodeUnit(kode: string | null | undefined): boolean {
  return /(^|\|)\s*SN\s*:/i.test((kode ?? '').trim())
}

/**
 * Nomor seri untuk pencarian ke database — dari format apa pun (baru, lama,
 * atau hanya nomor seri).
 */
export function nomorSeriDariKode(kode: string | null | undefined): string {
  const identitas = uraiKodeUnit(kode)
  if (identitas) return identitas.serialNumber
  return (kode ?? '').trim()
}
