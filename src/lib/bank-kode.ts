import { db } from '@/lib/db'
import { ekstrakModelDariNama, normCari, rapikanModel, skorCocokKode, skorKodeCocok, varianDbCari } from './cocok-kode'

/**
 * Bank Kode — pencatat terpusat semua kode sparepart yang pernah masuk aplikasi.
 * Dipanggil dari: POST /api/sparepart, import CSV sparepart, INPUT_PART_PRODUSEN,
 * TAMBAH_PART manual, dan API bank-kode itu sendiri.
 *
 * Aturan: kode dinormalisasi UPPERCASE-trim. Baris yang sudah ada TIDAK pernah
 * ditimpa dengan data kosong — hanya sel kosong yang dilengkapi + updatedAt.
 */
export type BankKodeSumber = 'KATALOG' | 'PRODUSEN' | 'WORKSHOP' | 'ORDER' | 'CSV' | 'MANUAL' | 'SINKRON'

export interface CatatKodeInput {
  kode: string
  namaPart?: string
  brandKompatibel?: string
  modelTipe?: string
  produsen?: string
  sumber?: BankKodeSumber
  catatan?: string
}

export function normalisasiKode(v: unknown): string {
  return String(v ?? '').trim().toUpperCase()
}

/** Catat satu kode ke bank (upsert aman). Return 'baru' | 'dilengkapi' | 'sudah-ada'. */
export async function catatBankKode(input: CatatKodeInput): Promise<'baru' | 'dilengkapi' | 'sudah-ada'> {
  const kode = normalisasiKode(input.kode)
  if (!kode) return 'sudah-ada'
  const namaPart = String(input.namaPart ?? '').trim()
  const brandKompatibel = String(input.brandKompatibel ?? '').trim()
  // Model hanya disimpan bila memang diberikan eksplisit (CSV/manual).
  // Jangan menebak dari nama part di sini: satu part bisa dipakai banyak model
  // dan tebakan otomatis justru mengotori data. Pencarian tetap bisa menemukan
  // model dari nama lewat skorCocokKode (dihitung saat mencari).
  const modelTipe = rapikanModel(input.modelTipe)
  const produsen = String(input.produsen ?? '').trim()
  const sumber = input.sumber ?? 'KATALOG'
  const catatan = String(input.catatan ?? '').trim()

  const existing = await db.bankKode.findUnique({ where: { kode } })
  if (!existing) {
    await db.bankKode.create({
      data: {
        kode,
        namaPart,
        brandKompatibel,
        modelTipe,
        produsen,
        sumber,
        catatan: catatan || null,
      },
    })
    return 'baru'
  }
  const patch: Record<string, string> = {}
  if (!existing.namaPart && namaPart) patch.namaPart = namaPart
  if (!existing.brandKompatibel && brandKompatibel) patch.brandKompatibel = brandKompatibel
  if (!existing.modelTipe && modelTipe) patch.modelTipe = modelTipe
  if (!existing.produsen && produsen) patch.produsen = produsen
  if (!existing.catatan && catatan) patch.catatan = catatan
  if (Object.keys(patch).length === 0) return 'sudah-ada'
  await db.bankKode.update({ where: { kode }, data: patch })
  return 'dilengkapi'
}

export interface KodeDariNama {
  kode: string
  namaPart: string
  brandKompatibel: string
  modelTipe: string
  produsen: string
  sumber: string
  skor: number
}

/** Satu baris referensi: data Bank Kode + info katalog/pemakaian. */
export interface ReferensiPart extends KodeDariNama {
  /** Bidang yang membuat baris ini cocok (kode/nama/model). */
  cocokPada: string[]
  /** Model untuk ditampilkan (kolom model atau hasil ekstraksi nama). */
  modelTampil: string
  adaKatalog: boolean
  stokJual: number
  stokGaransi: number
  stokInventory: number
  totalTerpakai: number
  /** Berapa baris tiket service yang pernah memakai kode ini. */
  dipakai: number
}

/**
 * Cari referensi part dari input KODE atau NAMA yang sudah cukup lengkap.
 *
 * - Kode dianggap lengkap bila ≥4 karakter (setelah dibersihkan) — dicocokkan
 *   ke kolom `kode` saja, toleran strip/spasi ("RI-202S" ≈ "RI202S").
 * - Nama dianggap lengkap bila ≥3 karakter — dicocokkan ke nama/model.
 * - Bila keduanya terisi, skor diambil yang terbaik dari kedua cara.
 *
 * Hasil diperkaya stok katalog & jumlah pemakaian di tiket supaya pengguna
 * bisa langsung memutuskan memakai kode lama atau membuat kode baru.
 */
export async function cariReferensiPart(
  input: { kode?: string; nama?: string },
  ambil = 6,
): Promise<ReferensiPart[]> {
  const kode = normalisasiKode(input.kode)
  const nama = String(input.nama ?? '').trim()
  const kunciKode = normCari(kode)
  const kunciNama = normCari(nama)
  const pakaiKode = kunciKode.replace(/ /g, '').length >= 4
  const pakaiNama = kunciNama.length >= 3
  if (!pakaiKode && !pakaiNama) return []

  const varian = varianDbCari(pakaiKode && !pakaiNama ? kode : nama)
  const varianKode = pakaiKode ? varianDbCari(kode) : []
  const semuaVarian = [...new Set([...varian, ...varianKode])]
  if (!semuaVarian.length) return []

  const bankOr: Record<string, unknown>[] = []
  const masterOr: Record<string, unknown>[] = []
  for (const v of semuaVarian) {
    if (pakaiKode) {
      bankOr.push({ kode: { contains: v } })
      masterOr.push({ kodePart: { contains: v } })
    }
    if (pakaiNama) {
      bankOr.push({ namaPart: { contains: v } }, { modelTipe: { contains: v } })
      masterOr.push({ namaPart: { contains: v } })
    }
  }

  const [bankRows, masterRows] = await Promise.all([
    bankOr.length
      ? db.bankKode.findMany({ where: { OR: bankOr }, take: 400, orderBy: { updatedAt: 'desc' } })
      : Promise.resolve([]),
    masterOr.length ? db.masterSparepart.findMany({ where: { OR: masterOr }, take: 300 }) : Promise.resolve([]),
  ])

  type Baris = {
    kode: string
    namaPart: string
    brandKompatibel: string
    modelTipe: string
    produsen: string
    sumber: string
  }
  const peta = new Map<string, Baris>()
  for (const m of masterRows) {
    peta.set(m.kodePart, {
      kode: m.kodePart,
      namaPart: m.namaPart,
      brandKompatibel: m.brandKompatibel ?? '',
      modelTipe: '',
      produsen: m.supplier ?? '',
      sumber: 'KATALOG',
    })
  }
  // Baris Bank Kode menang atas master (sumber & catatan lebih lengkap).
  for (const b of bankRows) {
    peta.set(b.kode, {
      kode: b.kode,
      namaPart: b.namaPart,
      brandKompatibel: b.brandKompatibel ?? '',
      modelTipe: b.modelTipe ?? '',
      produsen: b.produsen ?? '',
      sumber: b.sumber ?? 'KATALOG',
    })
  }

  const hasil: ReferensiPart[] = []
  for (const row of peta.values()) {
    const skorKode = pakaiKode ? skorKodeCocok(kode, row.kode) : null
    const skorNama = pakaiNama ? skorCocokKode(nama, { namaPart: row.namaPart, modelTipe: row.modelTipe }) : null
    const skor = Math.max(skorKode?.skor ?? 0, skorNama?.skor ?? 0)
    if (skor < 80) continue
    const pada = [...new Set([...(skorKode?.pada ?? []), ...(skorNama?.pada ?? [])])]
    hasil.push({
      ...row,
      skor,
      cocokPada: pada,
      modelTampil: row.modelTipe || ekstrakModelDariNama(row.namaPart),
      adaKatalog: false,
      stokJual: 0,
      stokGaransi: 0,
      stokInventory: 0,
      totalTerpakai: 0,
      dipakai: 0,
    })
  }

  hasil.sort((a, b) => b.skor - a.skor || a.kode.localeCompare(b.kode))
  const terpilih = hasil.slice(0, ambil * 3)
  if (!terpilih.length) return []

  // Perkaya dengan data katalog + jumlah pemakaian di tiket.
  const kodeList = terpilih.map((h) => h.kode)
  const masters = await db.masterSparepart.findMany({ where: { kodePart: { in: kodeList } } })
  const petaMaster = new Map(masters.map((m) => [m.kodePart, m]))
  const idList = masters.map((m) => m.id)
  const pakai = idList.length
    ? await db.serviceRequestPart.groupBy({
        by: ['sparepartId'],
        where: { sparepartId: { in: idList } },
        _count: { _all: true },
      })
    : []
  const petaPakai = new Map(pakai.map((p) => [p.sparepartId, p._count._all]))

  for (const h of terpilih) {
    const m = petaMaster.get(h.kode)
    if (!m) continue
    h.adaKatalog = true
    h.stokJual = m.stokJual
    h.stokGaransi = m.stokGaransi
    h.stokInventory = m.stokInventory
    h.totalTerpakai = m.totalTerpakai
    h.dipakai = petaPakai.get(m.id) ?? 0
  }

  // Urutkan akhir: skor, lalu paling sering dipakai, lalu kode.
  return terpilih.sort((a, b) => b.skor - a.skor || b.dipakai - a.dipakai || a.kode.localeCompare(b.kode)).slice(0, ambil)
}

/**
 * Cari kode di riwayat Bank Kode berdasarkan NAMA part yang diketik —
 * inti fitur "kode otomatis" di form tambah part service: pemilik menulis
 * nama, sistem mengisi/menyarankan kode bila nama itu pernah diinput
 * sebelumnya (katalog, produsen, workshop, order, CSV…).
 *
 * Kandidat diambil lewat varian token (toleran tanda hubung/spasi — "RI-202S"
 * ikut menemukan "Top Plate RI 202 S"), lalu dinilai lewat skorCocokKode pada
 * bidang nama + model; hanya yang kuat (≥80) dikembalikan, urut skor lalu kode.
 */
export async function cariKodeDariNama(nama: string, ambil = 6): Promise<KodeDariNama[]> {
  return cariReferensiPart({ nama }, ambil)
}
