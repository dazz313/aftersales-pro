import { describe, it, expect } from 'vitest'
import {
  nomorBassValid,
  rupiahNota,
  parseRupiahNota,
  tanggalNota,
  hitungBiayaNota,
} from '@/lib/nota'

describe('nomorBassValid', () => {
  it('menerima tepat 6 digit', () => {
    expect(nomorBassValid('123456')).toBe(true)
    expect(nomorBassValid(' 123456 ')).toBe(true)
  })

  it('menolak selain 6 digit', () => {
    expect(nomorBassValid('12345')).toBe(false)
    expect(nomorBassValid('1234567')).toBe(false)
    expect(nomorBassValid('abcdef')).toBe(false)
    expect(nomorBassValid(null)).toBe(false)
    expect(nomorBassValid(undefined)).toBe(false)
  })
})

describe('rupiahNota', () => {
  it('format ribuan gaya Indonesia', () => {
    expect(rupiahNota(12500)).toBe('12.500')
    expect(rupiahNota(0)).toBe('0')
  })

  it('nilai tidak valid → "0"', () => {
    expect(rupiahNota(null)).toBe('0')
    expect(rupiahNota(Number.NaN)).toBe('0')
  })
})

describe('parseRupiahNota', () => {
  it('mengubah teks rupiah menjadi angka', () => {
    expect(parseRupiahNota('Rp 12.500')).toBe(12500)
    expect(parseRupiahNota('12500')).toBe(12500)
    expect(parseRupiahNota('12.500')).toBe(12500)
  })

  it('kosong / tidak valid → 0', () => {
    expect(parseRupiahNota('')).toBe(0)
    expect(parseRupiahNota(null)).toBe(0)
    expect(parseRupiahNota('abc')).toBe(0)
  })
})

describe('tanggalNota', () => {
  it('mengubah "YYYY-MM-DD" → "D-M-YYYY"', () => {
    expect(tanggalNota('2025-08-17')).toBe('17-8-2025')
  })

  it('kosong → "", format lain dibiarkan apa adanya', () => {
    expect(tanggalNota('')).toBe('')
    expect(tanggalNota(null)).toBe('')
    expect(tanggalNota('bukan-tanggal')).toBe('bukan-tanggal')
  })
})

describe('hitungBiayaNota', () => {
  it('menghitung subtotal + PPN dari item & biaya', () => {
    const hasil = hitungBiayaNota({
      items: [{ harga: 10000, qty: 2 }],
      biayaService: 5000,
      biayaTransportasi: 2000,
      ppnPersen: 10,
    })
    expect(hasil.totalSparepart).toBe(20000)
    expect(hasil.subTotal).toBe(27000)
    expect(hasil.ppn).toBe(2700)
    expect(hasil.total).toBe(29700)
    expect(hasil.garansiPenuh).toBe(false)
  })

  it('garansi penuh (garansi "Ya" + total 0) → seluruh biaya 0', () => {
    const hasil = hitungBiayaNota({
      garansi: 'Ya',
      total: 0,
      items: [{ harga: 10000, qty: 2 }],
      biayaService: 5000,
      ppnPersen: 10,
    })
    expect(hasil.garansiPenuh).toBe(true)
    expect(hasil.total).toBe(0)
    expect(hasil.subTotal).toBe(0)
  })

  it('itemsOverride menggantikan items pada data nota', () => {
    const hasil = hitungBiayaNota(
      { items: [{ harga: 999, qty: 9 }], biayaService: 0 },
      [{ harga: 5000, qty: 1 }]
    )
    expect(hasil.totalSparepart).toBe(5000)
    expect(hasil.total).toBe(5000)
  })
})
