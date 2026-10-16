/**
 * Utilitas Import Massal CSV (Modul 1 — Master Data: Toko & Sparepart)
 * Mendukung: BOM UTF-8, delimiter otomatis (koma / titik-koma / tab),
 * field berkutip dengan escape "" , header fleksibel (alias, case-insensitive),
 * serta validasi baris yang dipakai bersama oleh API route (otoritatif)
 * dan pratinjau di sisi client (kosmetik) agar hasilnya konsisten.
 */

export interface ParsedCsv {
  headers: string[]
  rows: string[][]
  delimiter: string
}

const MAX_ROWS = 5000

function countOutsideQuotes(line: string, delim: string): number {
  let count = 0
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') inQuotes = !inQuotes
    else if (ch === delim && !inQuotes) count++
  }
  return count
}

function detectDelimiter(line: string): string {
  const candidates = [';', ',', '\t', '|']
  let best = ','
  let bestCount = 0
  for (const d of candidates) {
    const c = countOutsideQuotes(line, d)
    if (c > bestCount) {
      best = d
      bestCount = c
    }
  }
  return best
}

/**
 * Parser CSV state-machine: menangani kutip, kutip ganda (""), dan
 * delimiter di dalam kutip. Baris kosong dibuang.
 */
export function parseCsv(raw: string): ParsedCsv {
  const text = raw
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/^\n+/, '')
    .replace(/\n+$/, '')

  if (!text) return { headers: [], rows: [], delimiter: ',' }

  const delimiter = detectDelimiter(text.split('\n')[0])

  const records: string[][] = []
  let field = ''
  let record: string[] = []
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === delimiter) {
      record.push(field.trim())
      field = ''
    } else if (ch === '\n') {
      record.push(field.trim())
      records.push(record)
      record = []
      field = ''
    } else {
      field += ch
    }
  }
  record.push(field.trim())
  records.push(record)

  const headers = records.shift() ?? []
  const rows = records.filter((r) => r.some((c) => c !== '')).slice(0, MAX_ROWS)
  return { headers, rows, delimiter }
}

const normalizeHeader = (s: string) => s.toLowerCase().replace(/[\s_\-./\\]/g, '')

/**
 * Memetakan header CSV ke field aplikasi lewat daftar alias.
 * required = field yang wajib ada di CSV, jika tidak → pesan error header.
 */
export function mapHeaders(
  headers: string[],
  aliases: Record<string, string>,
  required: string[]
): { map: Record<string, number>; missing: string[] } {
  const normalized = headers.map(normalizeHeader)
  const map: Record<string, number> = {}
  for (const [field, aliasList] of Object.entries(aliases)) {
    const list = aliasList.split('|').map(normalizeHeader)
    const idx = normalized.findIndex((h) => list.includes(h))
    if (idx >= 0) map[field] = idx
  }
  const missing = required.filter((f) => map[f] === undefined)
  return { map, missing }
}

/**
 * Angka fleksibel untuk konteks Indonesia:
 * - "10" → 10 · "275.500" → 275500 (ribuan gaya ID) · "1.234.567" → 1234567
 * - "275.5" → 275.5 (desimal) · "275,5" → 275.5 (desimal koma)
 * - "1,234,567.89" → 1234567.89 (ribuan gaya EN) · "Rp 50.000" → 50000
 * Kosong → null. Tidak dikenali → NaN.
 */
export function parseNum(v: string): number | null {
  const s = v.trim().replace(/\s+/g, '').replace(/^rp/i, '')
  if (!s) return null
  // ribuan gaya Indonesia: 1.234.567 atau 1.234.567,89
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) return Number(s.replace(/\./g, '').replace(',', '.'))
  // ribuan gaya Inggris: 1,234,567 atau 1,234,567.89
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) return Number(s.replace(/,/g, ''))
  // desimal standar
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s)
  if (/^-?\d+(,\d+)?$/.test(s)) return Number(s.replace(',', '.'))
  return Number.NaN
}

/** Tanggal fleksibel: YYYY-MM-DD, DD/MM/YYYY (juga - dan .),
 *  atau BULAN SAJA: MM/YYYY, YYYY-MM, MM-YYYY (tanggal = tgl 1).
 *  Kosong → null. */
export function parseDateFlexible(v: string): Date | null {
  const s = v.trim()
  if (!s) return null
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s)
  if (m) {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
    return Number.isNaN(d.getTime()) ? null : d
  }
  m = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/.exec(s)
  if (m) {
    const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]))
    return Number.isNaN(d.getTime()) ? null : d
  }
  // Toleransi bulan saja (hari = 1): "08/2025", "2025-08", "08-2025"
  m = /^(\d{1,2})[/.\-](\d{4})$/.exec(s)
  if (m && Number(m[1]) >= 1 && Number(m[1]) <= 12) {
    return new Date(Number(m[2]), Number(m[1]) - 1, 1)
  }
  m = /^(\d{4})[/.\-](\d{1,2})$/.exec(s)
  if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12) {
    return new Date(Number(m[1]), Number(m[2]) - 1, 1)
  }
  return null
}

/** Builder template CSV (delimiter ";" ramah Excel Indonesia + BOM UTF-8). */
export function buildCsvTemplate(headers: string[], exampleRows: string[][]): string {
  const esc = (v: string) => (/[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
  const lines = [headers.map(esc).join(';'), ...exampleRows.map((r) => r.map(esc).join(';'))]
  return '\uFEFF' + lines.join('\r\n')
}

// ============================================================
// Master Toko
// ============================================================

export const TOKO_ALIASES: Record<string, string> = {
  kodeToko: 'kode_toko|kodetoko|kode toko|kode|kode store|kode_toko_mitra|kdc',
  namaToko: 'nama_toko|namatoko|nama toko|nama|name|nama_toko_mitra',
  alamat: 'alamat|address|lokasi',
  kontak: 'kontak|contact|telp|telepon|no_telp|notelp|no_hp|nohp|hp|wa|whatsapp|no_wa',
  frekuensiVisit: 'frekuensi_visit|frekuensivisit|frekuensi|siklus|siklus_visit|frekuensi_kunjungan|visit_hari',
  tglVisitTerakhir: 'tgl_visit_terakhir|tglvisitterakhir|tgl_visit|tglvisit|visit_terakhir|last_visit|tanggal_visit_terakhir',
  barcodeToko: 'barcode_toko|barcodetoko|barcode|kode_barcode|barcode kunjungan',
  jarakKm: 'jarak_km|jarakkm|jarak|jarak_workshop|jarakworkshop|distance|km',
}

export const TOKO_REQUIRED_LABELS: Record<string, string> = {
  kodeToko: '"kode_toko"',
  namaToko: '"nama_toko"',
}

export interface TokoInsertData {
  kodeToko: string
  namaToko: string
  alamat: string | null
  kontak: string | null
  frekuensiVisit: number
  tglVisitTerakhir: Date | null
  barcodeToko: string
  jarakKm: number | null
}

export interface TokoUpdateData {
  namaToko: string
  alamat?: string
  kontak?: string
  frekuensiVisit?: number
  tglVisitTerakhir?: Date
  barcodeToko?: string
  jarakKm?: number | null
}

export interface TokoValidated {
  insert: TokoInsertData
  update: TokoUpdateData
}

export interface ValidatedRow<T> {
  row: number
  kode: string
  nama: string
  status: 'pending' | 'error' | 'skip'
  message?: string
  data?: T
}

export function validateTokoRows(headers: string[], rows: string[][]): {
  acc: ValidatedRow<TokoValidated>[]
  headerError?: string
} {
  const { map, missing } = mapHeaders(headers, TOKO_ALIASES, ['kodeToko', 'namaToko'])
  if (missing.length) {
    const label = missing.map((m) => TOKO_REQUIRED_LABELS[m]).join(' dan ')
    return {
      acc: [],
      headerError: `Kolom wajib ${label} tidak ditemukan pada baris pertama CSV. Unduh template untuk melihat format yang benar.`,
    }
  }

  const acc: ValidatedRow<TokoValidated>[] = []
  const seen = new Set<string>()
  const seenBarcode = new Set<string>()

  rows.forEach((r, idx) => {
    const rowNum = idx + 2 // +1 header, +1 karena 1-indexed
    const get = (f: string) => (map[f] === undefined ? '' : (r[map[f]] ?? '').trim())
    const kode = get('kodeToko')
    const nama = get('namaToko')
    const barcode = get('barcodeToko').toUpperCase()

    if (!kode) {
      acc.push({ row: rowNum, kode, nama, status: 'error', message: 'Kode toko kosong — kolom kode wajib diisi' })
      return
    }
    if (!nama) {
      acc.push({ row: rowNum, kode, nama, status: 'error', message: 'Nama toko kosong — kolom nama wajib diisi' })
      return
    }
    if (seen.has(kode)) {
      acc.push({ row: rowNum, kode, nama, status: 'error', message: `Kode "${kode}" muncul lebih dari satu kali di dalam file` })
      return
    }
    seen.add(kode)

    // Barcode per toko: default BC-[KODETOKO] jika kolom kosong
    const barcodeToko = (barcode || `BC-${kode.toUpperCase()}`).trim()
    if (seenBarcode.has(barcodeToko)) {
      acc.push({ row: rowNum, kode, nama, status: 'error', message: `Barcode "${barcodeToko}" muncul lebih dari satu kali di dalam file` })
      return
    }
    seenBarcode.add(barcodeToko)

    let frekuensiVisit = 14
    const fv = get('frekuensiVisit')
    if (fv) {
      const n = parseNum(fv)
      if (n === null || Number.isNaN(n) || n < 1) {
        acc.push({ row: rowNum, kode, nama, status: 'error', message: `Frekuensi visit "${fv}" tidak valid (isi angka ≥ 1, kosongkan untuk default 14 hari)` })
        return
      }
      frekuensiVisit = Math.round(n)
    }

    let tglVisitTerakhir: Date | null = null
    const tv = get('tglVisitTerakhir')
    if (tv) {
      const d = parseDateFlexible(tv)
      if (!d) {
        acc.push({ row: rowNum, kode, nama, status: 'error', message: `Tanggal "${tv}" tidak dikenali (gunakan YYYY-MM-DD, DD/MM/YYYY, atau bulan saja MM/YYYY)` })
        return
      }
      tglVisitTerakhir = d
    }

    // Jarak dari workshop (km, opsional — kosong = belum diketahui, terisi saat maps terintegrasi)
    let jarakKm: number | null = null
    const jk = get('jarakKm')
    if (jk) {
      const n = parseNum(jk)
      if (n === null || Number.isNaN(n) || n < 0) {
        acc.push({ row: rowNum, kode, nama, status: 'error', message: `Jarak "${jk}" tidak valid (isi angka km ≥ 0, kosongkan bila belum diketahui)` })
        return
      }
      jarakKm = n
    }

    const alamat = get('alamat')
    const kontak = get('kontak')
    acc.push({
      row: rowNum,
      kode,
      nama,
      status: 'pending',
      data: {
        insert: { kodeToko: kode, namaToko: nama, alamat: alamat || null, kontak: kontak || null, frekuensiVisit, tglVisitTerakhir, barcodeToko, jarakKm },
        update: {
          namaToko: nama,
          ...(alamat ? { alamat } : {}),
          ...(kontak ? { kontak } : {}),
          ...(fv ? { frekuensiVisit } : {}),
          ...(tglVisitTerakhir ? { tglVisitTerakhir } : {}),
          ...(barcode ? { barcodeToko } : {}),
          ...(jk ? { jarakKm } : {}),
        },
      },
    })
  })

  return { acc }
}

// ============================================================
// Master Sparepart
// ============================================================

export const SPAREPART_ALIASES: Record<string, string> = {
  kodePart: 'kode_part|kodepart|kode part|kode|kode_sparepart|part_number|partnumber|part_no|sku',
  namaPart: 'nama_part|namapart|nama part|nama|nama_sparepart|name|nama_barang',
  brandKompatibel: 'brand_kompatibel|brandkompatibel|brand kompatibel|brand|merk|kompatibel|compatible_brand',
  supplier: 'supplier|pemasok|vendor|distributor',
  stokJual: 'stok_jual|stokjual|stok jual|bisa_jual|bisajual|stok_bisa_jual|jual',
  stokGaransi: 'stok_garansi|stokgaransi|stok garansi|garansi|stok_klaim',
  stokInventory: 'stok_inventory|stok_konsinyasi|stokkonsinyasi|stok|stok_total|qty|quantity|jumlah|stok_awal',
  reorderLimit: 'reorder_limit|reorderlimit|reorder|rop|limit|min_stok|minstok|stok_minimum',
  hargaKlaim: 'harga_klaim|hargaklaim|harga klaim|harga|harga_satuan|price',
}

export const SPAREPART_REQUIRED_LABELS: Record<string, string> = {
  kodePart: '"kode_part"',
  namaPart: '"nama_part"',
}

export interface SparepartInsertData {
  kodePart: string
  namaPart: string
  brandKompatibel: string
  supplier: string
  stokJual: number
  stokGaransi: number
  stokInventory: number
  reorderLimit: number
  hargaKlaim: number
}

export interface SparepartUpdateData {
  namaPart: string
  brandKompatibel?: string
  supplier?: string
  stokJual?: number
  stokGaransi?: number
  stokInventory?: number
  reorderLimit?: number
  hargaKlaim?: number
}

export interface SparepartValidated {
  insert: SparepartInsertData
  update: SparepartUpdateData
}

export function validateSparepartRows(headers: string[], rows: string[][]): {
  acc: ValidatedRow<SparepartValidated>[]
  headerError?: string
} {
  const { map, missing } = mapHeaders(headers, SPAREPART_ALIASES, ['kodePart', 'namaPart'])
  if (missing.length) {
    const label = missing.map((m) => SPAREPART_REQUIRED_LABELS[m]).join(' dan ')
    return {
      acc: [],
      headerError: `Kolom wajib ${label} tidak ditemukan pada baris pertama CSV. Unduh template untuk melihat format yang benar.`,
    }
  }

  const acc: ValidatedRow<SparepartValidated>[] = []
  const seen = new Set<string>()

  rows.forEach((r, idx) => {
    const rowNum = idx + 2
    const get = (f: string) => (map[f] === undefined ? '' : (r[map[f]] ?? '').trim())
    const kode = get('kodePart')
    const nama = get('namaPart')

    if (!kode) {
      acc.push({ row: rowNum, kode, nama, status: 'error', message: 'Kode part kosong — kolom kode wajib diisi' })
      return
    }
    if (!nama) {
      acc.push({ row: rowNum, kode, nama, status: 'error', message: 'Nama part kosong — kolom nama wajib diisi' })
      return
    }
    if (seen.has(kode)) {
      acc.push({ row: rowNum, kode, nama, status: 'error', message: `Kode "${kode}" muncul lebih dari satu kali di dalam file` })
      return
    }
    seen.add(kode)

    const brandKompatibel = get('brandKompatibel')
    const supplier = get('supplier')

    // stok bisa-jual & garansi (int ≥ 0, default 0).
    // Kompatibel legacy: bila kolom baru kosong tapi stok_inventory/total ada → seluruhnya stok jual.
    const parseStok = (label: string, raw: string): { ok: boolean; val: number; msg?: string } => {
      if (!raw) return { ok: true, val: 0 }
      const n = parseNum(raw)
      if (n === null || Number.isNaN(n) || n < 0) {
        return { ok: false, val: 0, msg: `Stok ${label} "${raw}" tidak valid (isi angka ≥ 0, kosongkan untuk default 0)` }
      }
      return { ok: true, val: Math.round(n) }
    }
    const sj = parseStok('jual', get('stokJual'))
    if (!sj.ok) {
      acc.push({ row: rowNum, kode, nama, status: 'error', message: sj.msg! })
      return
    }
    const sg = parseStok('garansi', get('stokGaransi'))
    if (!sg.ok) {
      acc.push({ row: rowNum, kode, nama, status: 'error', message: sg.msg! })
      return
    }
    let stokJual = sj.val
    let stokGaransi = sg.val
    const st = get('stokInventory')
    if (st) {
      const n = parseNum(st)
      if (n === null || Number.isNaN(n) || n < 0) {
        acc.push({ row: rowNum, kode, nama, status: 'error', message: `Stok "${st}" tidak valid (isi angka ≥ 0, kosongkan untuk default 0)` })
        return
      }
      if (!get('stokJual') && !get('stokGaransi')) {
        stokJual = Math.round(n) // file lama: total → stok jual
      }
    }
    const stokInventory = stokJual + stokGaransi || (st ? Math.round(parseNum(st) ?? 0) : 0)

    // reorder limit (int ≥ 0, default 5)
    let reorderLimit = 5
    const rl = get('reorderLimit')
    if (rl) {
      const n = parseNum(rl)
      if (n === null || Number.isNaN(n) || n < 0) {
        acc.push({ row: rowNum, kode, nama, status: 'error', message: `Reorder limit "${rl}" tidak valid (isi angka ≥ 0, kosongkan untuk default 5)` })
        return
      }
      reorderLimit = Math.round(n)
    }

    // harga klaim (≥ 0, default 0)
    let hargaKlaim = 0
    const hk = get('hargaKlaim')
    if (hk) {
      const n = parseNum(hk)
      if (n === null || Number.isNaN(n) || n < 0) {
        acc.push({ row: rowNum, kode, nama, status: 'error', message: `Harga klaim "${hk}" tidak valid (isi angka ≥ 0, kosongkan untuk default 0)` })
        return
      }
      hargaKlaim = n
    }

    acc.push({
      row: rowNum,
      kode,
      nama,
      status: 'pending',
      data: {
        insert: { kodePart: kode, namaPart: nama, brandKompatibel, supplier, stokJual, stokGaransi, stokInventory, reorderLimit, hargaKlaim },
        update: {
          namaPart: nama,
          ...(get('brandKompatibel') ? { brandKompatibel } : {}),
          ...(get('supplier') ? { supplier } : {}),
          ...(get('stokJual') || get('stokGaransi') || st ? { stokJual, stokGaransi, stokInventory } : {}),
          ...(rl ? { reorderLimit } : {}),
          ...(hk ? { hargaKlaim } : {}),
        },
      },
    })
  })

  return { acc }
}

export const CSV_MAX_ROWS = MAX_ROWS

// ============================================================
// Bank Kode Produsen — registry kode sparepart rumit dari produsen.
// Hanya kode yang wajib; nama/brand/produsen/catatan opsional
// (kode baru rilis produsen sering belum ada namanya).
// ============================================================

export const BANKKODE_ALIASES: Record<string, string> = {
  kode: 'kode|kode_part|kodepart|kode sparepart|kode_sparepart|part_number|partnumber|part_no|sku|kode_produsen|kodeprodusen|kode_barang|kodebarang',
  nama: 'nama|nama_part|namapart|nama sparepart|nama_sparepart|nama_barang|namabarang|description|deskripsi',
  brand: 'brand|merk|merek|brand_kompatibel|brandkompatibel|kompatibel',
  modelTipe: 'model|tipe|type|model_tipe|modeltipe|model/tipe|varian',
  produsen: 'produsen|supplier|pemasok|vendor|distributor|pabrikan|manufacturer',
  catatan: 'catatan|keterangan|note|notes|remarks',
}

export const BANKKODE_REQUIRED_LABELS: Record<string, string> = {
  kode: '"kode"',
}

export interface BankKodeInsertData {
  kode: string
  namaPart: string
  brandKompatibel: string
  modelTipe: string
  produsen: string
  catatan: string | null
}

export interface BankKodeUpdateData {
  namaPart?: string
  brandKompatibel?: string
  modelTipe?: string
  produsen?: string
  catatan?: string | null
}

export interface BankKodeValidated {
  insert: BankKodeInsertData
  update: BankKodeUpdateData
}

export function validateBankKodeRows(headers: string[], rows: string[][]): {
  acc: ValidatedRow<BankKodeValidated>[]
  headerError?: string
} {
  const { map, missing } = mapHeaders(headers, BANKKODE_ALIASES, ['kode'])
  if (missing.length) {
    const label = missing.map((m) => BANKKODE_REQUIRED_LABELS[m]).join(' dan ')
    return {
      acc: [],
      headerError: `Kolom wajib ${label} tidak ditemukan pada baris pertama CSV. Unduh template untuk melihat format yang benar.`,
    }
  }

  const acc: ValidatedRow<BankKodeValidated>[] = []
  const seen = new Set<string>()

  rows.forEach((r, idx) => {
    const rowNum = idx + 2
    const get = (f: string) => (map[f] === undefined ? '' : (r[map[f]] ?? '').trim())
    const kode = get('kode').toUpperCase()
    const nama = get('nama')

    if (!kode) {
      acc.push({ row: rowNum, kode, nama, status: 'error', message: 'Kode kosong — kolom kode wajib diisi' })
      return
    }
    if (seen.has(kode)) {
      acc.push({ row: rowNum, kode, nama, status: 'error', message: `Kode "${kode}" muncul lebih dari satu kali di dalam file` })
      return
    }
    seen.add(kode)

    const brandKompatibel = get('brand')
    const modelTipe = get('modelTipe')
    const produsen = get('produsen')
    const catatan = get('catatan')

    acc.push({
      row: rowNum,
      kode,
      nama,
      status: 'pending',
      data: {
        insert: { kode, namaPart: nama, brandKompatibel, modelTipe, produsen, catatan: catatan || null },
        update: {
          ...(nama ? { namaPart: nama } : {}),
          ...(brandKompatibel ? { brandKompatibel } : {}),
          ...(modelTipe ? { modelTipe } : {}),
          ...(produsen ? { produsen } : {}),
          ...(catatan ? { catatan } : {}),
        },
      },
    })
  })

  return { acc }
}

// ============================================================
// Unit Asset (registrasi massal per toko/perorangan)
// Urutan layout master: toko/customer, merk, model/tipe, nomor_seri,
// status + tgl garansi (tgl pembelian = awal masa garansi).
// Tanggal input diisi otomatis saat registrasi.
// Relasi toko/customer ke ID dilakukan di API (butuh database).
// Header lama (nama_toko, tanggal, tgl_pembelian, no_seri, ...) tetap dikenali.
// ============================================================

export const UNIT_ALIASES: Record<string, string> = {
  serialNumber: 'no_seri|noseri|no seri|nomor_seri|nomorseri|nomor seri|serial|serial_number|serialnumber|sn',
  modelUnit: 'model|tipe|type|model_tipe|modeltipe|model/tipe|modelunit|model_unit|modelunit|varian',
  nama: 'nama|nama_unit|namaunit|nama unit|label|nama_panggilan',
  merk: 'merk|brand|merek|manufacturer|pabrikan',
  toko: 'toko|kode_toko|kodetoko|kode toko|nama_toko|namatoko|nama toko|toko_customer|tokocustomer|toko/customer|store',
  customer: 'customer|nama_customer|namacustomer|nama customer|pemilik|pelanggan|pembeli',
  statusGaransi: 'status|garansi|status_garansi|statusgaransi|status garansi|kondisi_garansi',
  tglPembelian: 'tanggal|tgl|tgl_beli|tglbeli|tanggal_beli|tanggalbeli|tanggal beli|tgl_pembelian|tglpembelian|tgl pembelian|tgl_garansi|tglgaransi|tanggal_garansi|tanggalgaransi|bulan_beli|tahun_beli',
  tglInput: 'tgl_input|tglinput|tgl input|tanggal_input|tanggalinput|tanggal input|waktu_input|waktuinput|waktu input',
}

export const UNIT_REQUIRED_LABELS: Record<string, string> = {
  serialNumber: '"nomor_seri"',
  modelUnit: '"model/tipe"',
}

/** Status garansi 3 pilihan: mengandung "non"/"tidak"/"habis"/"expired" → NON_GARANSI;
 *  mengandung "toko"/"titip"/"display"/"konsinyasi" → STOK_TOKO (otomatis garansi);
 *  sisanya GARANSI. */
export function parseStatusGaransi(v: string): 'STOK_TOKO' | 'GARANSI' | 'NON_GARANSI' {
  const s = v.trim()
  if (/non|tidak|habis|expired|void/i.test(s)) return 'NON_GARANSI'
  if (/toko|titip|display|konsinyasi|pajang/i.test(s)) return 'STOK_TOKO'
  return 'GARANSI'
}

export interface UnitInsertData {
  serialNumber: string
  modelUnit: string
  nama: string
  merk: string
  tokoKey: string // kode atau nama toko (diresolusi di API)
  customerNama: string // nama customer (dicari, bila tak ada dibuat baru)
  statusGaransi: 'STOK_TOKO' | 'GARANSI' | 'NON_GARANSI'
  statusOtomatis: boolean // true bila kolom status kosong → API boleh auto-deteksi dari merk+tgl
  tglPembelian: Date | null
  tglInput: Date | null // tanggal input real dari dokumen → createdAt (kosong = waktu impor)
}

export interface UnitUpdateData {
  modelUnit: string
  nama?: string
  merk?: string
  tokoKey?: string
  customerNama?: string
  statusGaransi?: 'STOK_TOKO' | 'GARANSI' | 'NON_GARANSI'
  statusOtomatis?: boolean
  tglPembelian?: Date | null
}

export interface UnitValidated {
  insert: UnitInsertData
  update: UnitUpdateData
}

export function validateUnitRows(headers: string[], rows: string[][]): {
  acc: ValidatedRow<UnitValidated>[]
  headerError?: string
} {
  const { map, missing } = mapHeaders(headers, UNIT_ALIASES, ['serialNumber', 'modelUnit'])
  if (missing.length) {
    const label = missing.map((m) => UNIT_REQUIRED_LABELS[m]).join(' dan ')
    return {
      acc: [],
      headerError: `Kolom wajib ${label} tidak ditemukan pada baris pertama CSV. Unduh template untuk melihat format yang benar.`,
    }
  }

  const acc: ValidatedRow<UnitValidated>[] = []
  const seen = new Set<string>()

  rows.forEach((r, idx) => {
    const rowNum = idx + 2
    const get = (f: string) => (map[f] === undefined ? '' : (r[map[f]] ?? '').trim())
    const serial = get('serialNumber').toUpperCase()
    const model = get('modelUnit')
    const nama = get('nama')
    const merk = get('merk')

    if (!serial) {
      acc.push({ row: rowNum, kode: serial, nama: nama || model, status: 'error', message: 'No. seri kosong — kolom no seri wajib diisi' })
      return
    }
    if (!model) {
      acc.push({ row: rowNum, kode: serial, nama: nama || serial, status: 'error', message: 'Model/tipe kosong — kolom model wajib diisi' })
      return
    }
    if (seen.has(serial)) {
      acc.push({ row: rowNum, kode: serial, nama: nama || model, status: 'error', message: `No. seri "${serial}" muncul lebih dari satu kali di dalam file` })
      return
    }
    seen.add(serial)

    const statusRaw = get('statusGaransi')
    const statusGaransi = parseStatusGaransi(statusRaw || 'GARANSI')

    let tglPembelian: Date | null = null
    const tb = get('tglPembelian')
    if (tb) {
      const d = parseDateFlexible(tb)
      if (!d) {
        acc.push({ row: rowNum, kode: serial, nama: nama || model, status: 'error', message: `Tgl pembelian "${tb}" tidak dikenali (gunakan YYYY-MM-DD, DD/MM/YYYY, atau bulan saja MM/YYYY)` })
        return
      }
      tglPembelian = d
    }

    // Tgl input real dari dokumen (opsional) — bila kosong, createdAt = waktu impor
    let tglInput: Date | null = null
    const ti = get('tglInput')
    if (ti) {
      const d = parseDateFlexible(ti)
      if (!d) {
        acc.push({ row: rowNum, kode: serial, nama: nama || model, status: 'error', message: `Tgl input "${ti}" tidak dikenali (gunakan YYYY-MM-DD atau DD/MM/YYYY)` })
        return
      }
      tglInput = d
    }

    const tokoKey = get('toko')
    const customerNama = get('customer')

    acc.push({
      row: rowNum,
      kode: serial,
      nama: nama || model,
      status: 'pending',
      data: {
        insert: { serialNumber: serial, modelUnit: model, nama, merk, tokoKey, customerNama, statusGaransi, statusOtomatis: !statusRaw, tglPembelian, tglInput },
        update: {
          modelUnit: model,
          ...(nama ? { nama } : {}),
          ...(merk ? { merk } : {}),
          ...(tokoKey ? { tokoKey } : {}),
          ...(customerNama ? { customerNama } : {}),
          ...(statusRaw ? { statusGaransi } : { statusOtomatis: true }),
          ...(tb ? { tglPembelian } : {}),
        },
      },
    })
  })

  return { acc }
}
