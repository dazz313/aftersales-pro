import { db } from '@/lib/db'
import { normNama, skorNamaPart } from './nama-part'

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
  const modelTipe = String(input.modelTipe ?? '').trim()
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

/**
 * Cari kode di riwayat Bank Kode berdasarkan NAMA part yang diketik —
 * inti fitur "kode otomatis" di form tambah part service: pemilik menulis
 * nama, sistem mengisi/menyarankan kode bila nama itu pernah diinput
 * sebelumnya (katalog, produsen, workshop, order, CSV…).
 *
 * Kandidat diambil lewat token ≥3 huruf (contains — pola sama dgn GET
 * /api/bank-kode), lalu dinilai murni lewat skorNamaPart; hanya yang kuat
 * (≥80) dikembalikan, urut skor lalu kode.
 */
export async function cariKodeDariNama(nama: string, ambil = 6): Promise<KodeDariNama[]> {
  const bersih = normNama(nama)
  if (bersih.length < 3) return []
  const token = bersih.split(' ').filter((t) => t.length >= 3).slice(0, 4)
  if (!token.length) return []
  const or: Record<string, unknown>[] = []
  for (const t of token) {
    for (const v of new Set([t, t.toUpperCase()])) {
      or.push({ namaPart: { contains: v } })
    }
  }
  const kandidat = await db.bankKode.findMany({
    where: { OR: or },
    take: 300,
    orderBy: { updatedAt: 'desc' },
  })
  const hasil: KodeDariNama[] = []
  for (const k of kandidat) {
    const skor = skorNamaPart(bersih, k.namaPart)
    if (skor >= 80) {
      hasil.push({
        kode: k.kode,
        namaPart: k.namaPart,
        brandKompatibel: k.brandKompatibel,
        modelTipe: k.modelTipe,
        produsen: k.produsen,
        sumber: k.sumber,
        skor,
      })
    }
  }
  return hasil.sort((a, b) => b.skor - a.skor || a.kode.localeCompare(b.kode)).slice(0, ambil)
}
