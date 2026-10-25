import { describe, it, expect } from 'vitest'
import { teksDariPdf, uraikanTeksSuratJalan } from '@/lib/surat-jalan-teks'

describe('uraikanTeksSuratJalan', () => {
  it('jalur kepala tabel alias: gap spasi ≥2 sebagai pemisah kolom', () => {
    const teks = [
      'PT SANY INDONESIA   Faktur Mutasi Barang',
      'No. Surat Jalan : SJR-20261025-0003   Tanggal : 25/10/2026',
      '',
      'KODE PART   NAMA PART   QTY   SN UNIT',
      'SF-3128   Impeller Pompa Besar   2   02100056000',
      'WD-6200   Filter Kapasitor   1',
      'Total Item : 2',
    ].join('\n')
    const hasil = uraikanTeksSuratJalan(teks)
    expect(hasil.noSuratJalan).toBe('SJR-20261025-0003')
    expect(hasil.tglSurat).not.toBeNull()
    expect(hasil.rows).toEqual([
      { kodePart: 'SF-3128', namaPart: 'Impeller Pompa Besar', qty: 2, serialNumber: '02100056000' },
      { kodePart: 'WD-6200', namaPart: 'Filter Kapasitor', qty: 1, serialNumber: undefined },
    ])
  })

  it('jalur tanpa kepala: baris polos dengan celah kolom', () => {
    const teks = [
      'FAKTUR MUTASI',
      'SF-3128  Impeller Pompa Besar  2  02100056000',
      'WD-6200A  Filter Kapasitor  1  02100056001',
    ].join('\n')
    const r = uraikanTeksSuratJalan(teks)
    expect(r.rows.length).toBe(2)
    expect(r.rows[0]).toMatchObject({ kodePart: 'SF-3128', qty: 2, serialNumber: '02100056000' })
    expect(r.rows[1]).toMatchObject({ kodePart: 'WD-6200A', qty: 1, serialNumber: '02100056001' })
  })

  it('OCR baris kompakt (spasi tunggal) tetap terklasifikasi via tokenisasi', () => {
    const teks = ['FAKTUR MUTASI', 'SF-3128 Impeller Pompa Besar 2 02100056000'].join('\n')
    const r = uraikanTeksSuratJalan(teks)
    expect(r.rows.length).toBe(1)
    expect(r.rows[0]).toMatchObject({ kodePart: 'SF-3128', qty: 2, serialNumber: '02100056000' })
  })
})

describe('teksDariPdf (lapisan teks PDF)', () => {
  it('mengekstrak teks PDF jsPDF & terurai menjadi baris part', async () => {
    const { jsPDF } = await import('jspdf')
    const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' })
    doc.setFontSize(12)
    doc.text('No. Surat Jalan : SJR-20261025-0003', 12, 20)
    doc.text('Produsen : PT SANY INDONESIA', 12, 28)
    const kolomX = [12, 70, 150, 185]
    const kepala = ['KODE PART', 'NAMA PART', 'QTY', 'SN UNIT']
    kepala.forEach((t, j) => doc.text(t, kolomX[j], 40))
    const isi = [
      ['SF-3128', 'Impeller Pompa Besar', '2', '02100056000'],
      ['WD-6200', 'Filter Kapasitor', '1', ''],
    ]
    isi.forEach((b, i) => {
      const y = 48 + i * 8
      b.forEach((t, j) => {
        if (t) doc.text(t, kolomX[j], y)
      })
    })
    const buffer = Buffer.from(doc.output('arraybuffer'))
    const teks = await teksDariPdf(buffer)
    expect(teks).toContain('KODE PART')
    const hasil = uraikanTeksSuratJalan(teks)
    expect(hasil.noSuratJalan).toBe('SJR-20261025-0003')
    expect(hasil.produsen).toBe('PT SANY INDONESIA')
    expect(hasil.rows.some((r) => r.kodePart === 'SF-3128' && r.qty === 2)).toBe(true)
    expect(hasil.rows.some((r) => r.kodePart === 'WD-6200' && r.namaPart === 'Filter Kapasitor')).toBe(true)
  }, 45000)
})
