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

/** Tanggal fleksibel: YYYY-MM-DD atau DD/MM/YYYY (juga - dan .). Kosong → null. */
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
}

export interface TokoUpdateData {
  namaToko: string
  alamat?: string
  kontak?: string
  frekuensiVisit?: number
  tglVisitTerakhir?: Date
  barcodeToko?: string
}

export interface TokoValidated {
  insert: TokoInsertData
  update: TokoUpdateData
}

export interface ValidatedRow<T> {
  row: number
  kode: string
  nama: string
  status: 'pending' | 'error'
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
        acc.push({ row: rowNum, kode, nama, status: 'error', message: `Tanggal "${tv}" tidak dikenali (gunakan YYYY-MM-DD atau DD/MM/YYYY)` })
        return
      }
      tglVisitTerakhir = d
    }

    const alamat = get('alamat')
    const kontak = get('kontak')
    acc.push({
      row: rowNum,
      kode,
      nama,
      status: 'pending',
      data: {
        insert: { kodeToko: kode, namaToko: nama, alamat: alamat || null, kontak: kontak || null, frekuensiVisit, tglVisitTerakhir, barcodeToko },
        update: {
          namaToko: nama,
          ...(alamat ? { alamat } : {}),
          ...(kontak ? { kontak } : {}),
          ...(fv ? { frekuensiVisit } : {}),
          ...(tglVisitTerakhir ? { tglVisitTerakhir } : {}),
          ...(barcode ? { barcodeToko } : {}),
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
