import { db } from '@/lib/db'

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
  if (!existing.produsen && produsen) patch.produsen = produsen
  if (!existing.catatan && catatan) patch.catatan = catatan
  if (Object.keys(patch).length === 0) return 'sudah-ada'
  await db.bankKode.update({ where: { kode }, data: patch })
  return 'dilengkapi'
}
