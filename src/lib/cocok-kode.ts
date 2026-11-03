/**
 * ===== Pencocokan kode / nama / model sparepart (murni, tanpa dependensi) =====
 *
 * Dipakai Bank Kode Produsen & fitur "kode otomatis" saat menambah part:
 * pemilik sering mengetik kode model dengan gaya berbeda dari data yang
 * tersimpan — "RI-202S" vs "Top Plate RI 202 S" vs "RI202S". Pencocokan
 * `contains` biasa gagal pada perbedaan tanda hubung/spasi seperti itu.
 *
 * Modul ini menormalkan:
 *  - semua pemisah (-, /, ., koma, kurung) menjadi spasi;
 *  - batas huruf↔angka dipecah ("202S" → "202 S", "AX001" → "AX 001");
 *  - versi rapat tanpa spasi ("RI202S") untuk perbandingan;
 *  - model diekstrak dari nama part bila kolom model masih kosong
 *    ("Top Plate RI 202 S" → "RI 202 S").
 *
 * Penilaian menghasilkan 0–100 + daftar bidang yang cocok (kode/model/nama/
 * brand/produsen/catatan) supaya UI bisa menjelaskan MENGAPA baris itu muncul.
 */

/** UPPERCASE, semua pemisah jadi spasi, rapatkan spasi ganda. */
export function normCari(nilai: unknown): string {
  return String(nilai ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Versi tanpa spasi — "RI 202 S" → "RI202S". */
export function rapatCari(nilai: unknown): string {
  return normCari(nilai).replace(/ /g, '')
}

/**
 * Token dengan batas huruf↔angka dipisah:
 * "RI-202S" → ["RI","202","S"]; "AX001" → ["AX","001"].
 */
export function tokenCari(nilai: unknown): string[] {
  const n = normCari(nilai)
    .replace(/([A-Z])([0-9])/g, '$1 $2')
    .replace(/([0-9])([A-Z])/g, '$1 $2')
  return [...new Set(n.split(' ').filter(Boolean))]
}

/**
 * Varian kata kunci untuk query `contains` di database.
 * Contoh "RI-202S" → ["RI 202 S", "RI202S", "RI", "202"].
 */
export function varianDbCari(nilai: unknown, maksToken = 6): string[] {
  const teks = normCari(nilai)
  if (!teks) return []
  const set = new Set<string>()
  if (teks.length >= 2) set.add(teks)
  const rapat = rapatCari(teks)
  if (rapat.length >= 3) set.add(rapat)
  const token = tokenCari(teks)
  // Bentuk dengan batas huruf↔angka dipisah: "RI-202S" → "RI 202 S"
  if (token.length > 1) set.add(token.join(' '))
  for (const t of token) {
    if (t.length >= 2) set.add(t)
    if (set.size >= maksToken + 2) break
  }
  return [...set].slice(0, maksToken + 2)
}

/**
 * Kata yang sering muncul sebelum angka tetapi BUKAN awalan model
 * (mis. "ASSY 602", "CASE 528", "RING 528") — supaya model tidak salah tebak.
 */
const KATA_BUKAN_MODEL = new Set([
  'ASSY', 'CASE', 'RING', 'BODY', 'COVER', 'TOP', 'SIDE', 'BACK', 'BASE',
  'SET', 'SETS', 'TYPE', 'MODEL', 'SIZE', 'INCH', 'WATT', 'VOLT', 'KIT',
  'UNIT', 'PART', 'PANEL', 'PLATE', 'BURNER', 'VALVE', 'PUMP', 'MOTOR',
  'FAN', 'LID', 'TRAY', 'DOOR', 'GLASS', 'HOSE', 'PIPE', 'WIRE', 'CORD',
  'PLUG', 'SOCKET', 'SWITCH', 'KNOB', 'SEAL', 'GASKET', 'FILTER',
  'BEARING', 'SHAFT', 'GEAR', 'BELT', 'BLADE', 'FRAME', 'STAND', 'LEG',
  'HANDLE', 'GRIP', 'BUTTON', 'DIAL', 'LAMP', 'LED', 'PCB', 'MODULE',
  'SENSOR', 'THERMO', 'HEATER', 'COIL', 'CAP', 'RESISTOR', 'DIODE',
  'FUSE', 'RELAY', 'ADAPTER', 'CHARGER', 'BATTERY', 'TANK', 'BOWL', 'POT',
  'PAN', 'GRILL', 'RACK', 'SHELF', 'DRAWER', 'HINGE', 'SCREW', 'BOLT',
  'NUT', 'WASHER', 'SPRING', 'CLIP', 'BRACKET', 'MOUNT', 'SUPPORT', 'ARM',
  'ROD', 'TUBE', 'RHS', 'LHS', 'KIRI', 'KANAN', 'LEFT', 'RIGHT', 'FRONT',
  'REAR', 'UPPER', 'LOWER', 'INNER', 'OUTER', 'BIG', 'SMALL', 'NEW', 'OLD',
  'SERIES', 'SERI', 'WARNA', 'COLOR', 'BLACK', 'WHITE', 'RED', 'BLUE',
  'GREEN', 'SILVER', 'GREY', 'GRAY', 'BROWN', 'PAINT', 'GLOSS', 'MATT',
  // Satuan / bahan / kata teknis yang sering menempel angka — bukan model.
  'UF', 'VAC', 'VDC', 'MA', 'KW', 'MM', 'CM', 'KG', 'GR', 'ML', 'PCS',
  'DIA', 'OHM', 'ASM', 'NECK', 'IN', 'AS', 'SS', 'SUS', 'BIT', 'EF', 'PP',
])

/**
 * Ekstrak model dari nama part, mis.
 * "Top Plate RI 202 S" → "RI 202 S" · "KNOB ASSY (BLACK) RI-712" → "RI 712".
 * Mengembalikan '' bila tidak ada pola model yang meyakinkan.
 */
export function ekstrakModelDariNama(nama: unknown): string {
  const teks = normCari(nama)
  if (!teks) return ''
  const pola = /\b([A-Z]{2,4})([\s-]?)(\d{2,4})([\s-]?)([A-Z]{0,3})\b/g
  for (const m of teks.matchAll(pola)) {
    const awalan = m[1]
    if (KATA_BUKAN_MODEL.has(awalan)) continue
    const suffix = m[5]
    // Suffix setelah SPASI yang panjang (mis. "PC-250 BIT") adalah kata lain,
    // bukan bagian model — ambil "PC 250" saja. Suffix 1–2 huruf tetap ikut
    // ("RI 202 S", "PS 135 E"); suffix tanpa spasi ("MCM-528TS") tetap utuh.
    const pakaiSuffix = !(m[4] === ' ' && suffix.length > 2)
    return `${awalan} ${m[3]}${pakaiSuffix && suffix ? ` ${suffix}` : ''}`
  }
  return ''
}

/** Rapikan satu nilai model ke bentuk konsisten bila bentuknya jelas (mis. "RI-202S" → "RI 202 S"). */
export function rapikanModel(nilai: unknown): string {
  const asli = String(nilai ?? '').trim()
  const n = normCari(asli)
  if (!n) return ''
  const m = n.match(/^([A-Z]{1,4})[\s-]?(\d{1,4})[\s-]?([A-Z]{0,3})$/)
  if (m) return `${m[1]} ${m[2]}${m[3] ? ` ${m[3]}` : ''}`
  return asli
}

export interface BarisKodeCocok {
  kode?: string | null
  namaPart?: string | null
  modelTipe?: string | null
  brandKompatibel?: string | null
  produsen?: string | null
  catatan?: string | null
}

export interface SkorKode {
  /** 0–100 — makin tinggi makin relevan. */
  skor: number
  /** Bidang yang membuat baris ini cocok: kode/model/nama/brand/produsen/catatan. */
  pada: string[]
}

/**
 * Nilai kemiripan satu baris Bank Kode terhadap kata kunci.
 * Model yang masih kosong dihitung dari nama part, jadi "RI-202S" tetap
 * menemukan "Top Plate RI 202 S" walau kolom model belum diisi.
 */
export function skorCocokKode(kueri: unknown, baris: BarisKodeCocok): SkorKode {
  const qn = normCari(kueri)
  if (!qn) return { skor: 0, pada: [] }
  const qc = qn.replace(/ /g, '')
  const qt = tokenCari(qn)
  const model = String(baris.modelTipe ?? '').trim() || ekstrakModelDariNama(baris.namaPart ?? '')

  const bidang: { label: string; nilai: string; bobot: number }[] = [
    { label: 'kode', nilai: String(baris.kode ?? ''), bobot: 1 },
    { label: 'model', nilai: model, bobot: 1 },
    { label: 'nama', nilai: String(baris.namaPart ?? ''), bobot: 0.95 },
    { label: 'brand', nilai: String(baris.brandKompatibel ?? ''), bobot: 0.7 },
    { label: 'produsen', nilai: String(baris.produsen ?? ''), bobot: 0.6 },
    { label: 'catatan', nilai: String(baris.catatan ?? ''), bobot: 0.5 },
  ]

  let skor = 0
  const pada: string[] = []
  for (const b of bidang) {
    const fn = normCari(b.nilai)
    if (!fn) continue
    const fc = fn.replace(/ /g, '')
    let dasar = 0

    if (fc === qc) {
      dasar = 100
    } else if (qc.length >= 3 && fc.includes(qc)) {
      dasar = 96
    } else if (qn.length >= 3 && fn.includes(qn)) {
      dasar = 94
    } else if (qt.length) {
      const ft = tokenCari(fn)
      const setF = new Set(ft)
      let ada = 0
      for (const t of qt) {
        if (setF.has(t)) {
          ada += 1
        } else if (t.length >= 3 && ft.some((x) => x.length >= 3 && (x.startsWith(t) || t.startsWith(x)))) {
          ada += 0.75
        } else if (fc.includes(t)) {
          ada += 0.9
        }
      }
      const rasio = ada / qt.length
      if (rasio > 0) dasar = Math.round(55 + 45 * rasio)
    }

    const nilai = Math.round(dasar * b.bobot)
    if (nilai > skor) skor = nilai
    if (dasar >= 70) pada.push(b.label)
  }

  return { skor: Math.min(100, skor), pada }
}

/**
 * Jarak edit (Levenshtein) dengan batas maksimum — berhenti lebih awal bila
 * sudah melebihi `maks`. Dipakai untuk toleransi salah ketik kode.
 */
function jarakEditTerbatas(a: string, b: string, maks: number): number {
  if (Math.abs(a.length - b.length) > maks) return maks + 1
  let sebelumnya = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const kini = [i]
    let minimum = i
    for (let j = 1; j <= b.length; j++) {
      const biaya = a[i - 1] === b[j - 1] ? 0 : 1
      const nilai = Math.min(sebelumnya[j] + 1, kini[j - 1] + 1, sebelumnya[j - 1] + biaya)
      kini.push(nilai)
      if (nilai < minimum) minimum = nilai
    }
    if (minimum > maks) return maks + 1
    sebelumnya = kini
  }
  return sebelumnya[b.length]
}

/**
 * Skor kemiripan KHUSUS KODE — hanya membandingkan kode, bukan nama/brand.
 * Dipakai saat pengguna mengetik kode part: kode persis = 100, salah satu
 * memuat yang lain = 90 (mis. "RI202-001" menemukan "RI202-001-2-1X02-PR"),
 * dan salah ketik 1 karakter pada kode panjang = 82.
 *
 * Pencocokan token sengaja TIDAK dipakai di sini — kode berbeda sering berbagi
 * angka ("202") sehingga akan menampilkan referensi yang menyesatkan.
 */
export function skorKodeCocok(kueri: unknown, kode: unknown): SkorKode {
  const qc = rapatCari(kueri)
  const fc = rapatCari(kode)
  if (!qc || !fc) return { skor: 0, pada: [] }
  if (qc === fc) return { skor: 100, pada: ['kode'] }
  if (fc.includes(qc) || qc.includes(fc)) return { skor: 90, pada: ['kode'] }
  if (qc.length >= 6 && Math.abs(qc.length - fc.length) <= 1 && jarakEditTerbatas(qc, fc, 1) === 1) {
    return { skor: 82, pada: ['kode'] }
  }
  return { skor: 0, pada: [] }
}

export interface RingkasanBankKode {
  total: number
  jumlahModel: number
  perSumber: Record<string, number>
}

/**
 * Ringkas isi bank: total, jumlah model unik, dan sebaran sumber.
 * Model eksplisit dipakai bila ada; kalau kosong, model dibaca dari nama part
 * (hanya untuk ringkasan — tidak ditulis ke database).
 */
export function ringkasBankKode(
  rows: readonly { sumber?: string | null; modelTipe?: string | null; namaPart?: string | null }[],
): RingkasanBankKode {
  const perSumber: Record<string, number> = {}
  const model = new Set<string>()
  for (const r of rows) {
    const sumber = String(r.sumber ?? '').trim().toUpperCase() || 'LAIN'
    perSumber[sumber] = (perSumber[sumber] ?? 0) + 1
    const m = rapikanModel(r.modelTipe) || ekstrakModelDariNama(r.namaPart ?? '')
    if (m) model.add(rapatCari(m))
  }
  return { total: rows.length, jumlahModel: model.size, perSumber }
}
