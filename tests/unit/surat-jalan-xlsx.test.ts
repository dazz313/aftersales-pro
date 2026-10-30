import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx'
import { cariBarisHeader, parseTabsheet } from '@/lib/surat-jalan'

/** Bangun buffer .xlsx dari array-of-array utk siap-parse. */
const buatXlsx = (aoa: unknown[][]) => {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'SJ')
  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as ArrayBuffer)
}

describe('cariBarisHeader — variasi kepala tabel surat jalan', () => {
  it('gabungan judul kolom dalam SATU sel dibagi "/" dan dipetakan ke kolom kosong berikutnya', () => {
    const hasil = cariBarisHeader([
      ['PT SANY INDONESIA   Faktur Mutasi Barang'],
      ['KODE PART / NAMA PART / QTY / SN UNIT', '', '', ''],
      ['SF-3128', 'Impeller Pompa Besar', 2, '02100056000'],
    ])
    expect(hasil).not.toBeNull()
    const kol = (field: string) => [...hasil!.map.entries()].find(([, f]) => f === field)?.[0]
    expect(kol('kodePart')).toBe(0)
    expect(kol('namaPart')).toBe(1)
    expect(kol('qty')).toBe(2)
    expect(kol('serialNumber')).toBe(3)
  })

  it('alias hampir sama: "PART NO." / "PART NAME" / "SN"', () => {
    const hasil = cariBarisHeader([['PART NO.', 'PART NAME', 'QTY', 'SN']])
    expect(hasil).not.toBeNull()
    const kol = (field: string) => [...hasil!.map.entries()].find(([, f]) => f === field)?.[0]
    expect(kol('kodePart')).toBe(0)
    expect(kol('namaPart')).toBe(1)
    expect(kol('serialNumber')).toBe(3)
  })

  it('kepala jauh di bawah (logo/judul banyak baris) tetap ditemukan ≤50 baris', () => {
    const atas: unknown[][] = []
    for (let i = 0; i < 38; i++) atas.push(['LOGO', 'PT SANY'])
    const hasil = cariBarisHeader([...atas, ['KODE', 'NAMA', 'QTY']])
    expect(hasil).not.toBeNull()
    expect(hasil!.idx).toBe(38)
  })
})

describe('parseTabsheet — file surat jalan produsen yang gagal sebelumnya', () => {
  it('sel header di-merge: "KODE PART / NAMA PART / QTY / SN UNIT" satu sel', () => {
    const buf = buatXlsx([
      ['PT SANY INDONESIA'],
      ['Faktur Mutasi Barang'],
      ['KODE PART / NAMA PART / QTY / SN UNIT', '', '', ''],
      ['SF-3128', 'Impeller Pompa Besar', 2, '02100056000'],
      ['WD-6200', 'Filter Kapasitor', 1, ''],
    ])
    const hasil = parseTabsheet(buf)
    expect(hasil.rows).toEqual([
      { kodePart: 'SF-3128', namaPart: 'Impeller Pompa Besar', qty: 2, serialNumber: '02100056000' },
      { kodePart: 'WD-6200', namaPart: 'Filter Kapasitor', qty: 1, serialNumber: undefined },
    ])
  })

  it('pemisah koma "KODE PART, NAMA PART, QTY" di sel gabungan', () => {
    const buf = buatXlsx([
      ['KODE PART, NAMA PART, QTY', '', ''],
      ['SF-3128', 'Impeller Pompa Besar', 2],
    ])
    const hasil = parseTabsheet(buf)
    expect(hasil.rows).toEqual([
      { kodePart: 'SF-3128', namaPart: 'Impeller Pompa Besar', qty: 2, serialNumber: undefined },
    ])
  })

  it('judul kolom tak persis ("PART NO." dll.) tetap terbaca — tanpa data hanya pesan baris kosong', () => {
    const buf = buatXlsx([['PART NO.', 'PART NAME', 'QTY', 'SN']])
    // Header dikenali (lewat alias longgar) → tidak melempar error "kolom".
    expect(() => parseTabsheet(buf)).toThrow(/Tidak ada baris part ditemukan/)
  })

  it('file tanpa identitas kolom kode tetap melempar pesan panduan (bukan diam)', () => {
    const buf = buatXlsx([
      ['Bukti Pengiriman'],
      ['Pengirim', 'PT SANY'],
    ])
    expect(() => parseTabsheet(buf)).toThrow(/Kolom kode part tidak terbaca/)
  })
})
