import { describe, expect, it } from 'vitest'
import {
  BATAS_FIELD,
  adalahKodeUnit,
  bangunKodeUnit,
  nomorSeriDariKode,
  uraiKodeUnit,
} from '@/lib/kode-unit'

/**
 * Isi QR stiker unit = 4 identifikasi:
 *   SN:<nomor seri>|MOD:<model>|TOK:<toko>|NAMA:<nama produk>
 * Tag ID di aplikasi mobile = nilai SN (nomor seri), bukan seluruh teks QR.
 */

describe('bangunKodeUnit', () => {
  it('menyusun 4 identifikasi dengan SN di depan', () => {
    const kode = bangunKodeUnit({
      serialNumber: '2603128725B',
      modelUnit: 'RI-712GA(B)',
      nama: 'Kulkas 2 Pintu',
      pemilik: 'Toko Semeru Ahmad Yani',
    })
    expect(kode).toBe('SN:2603128725B|MOD:RI-712GA(B)|TOK:Toko Semeru Ahmad Yani|NAMA:Kulkas 2 Pintu')
    expect(kode.startsWith('SN:')).toBe(true)
  })

  it('mengembalikan string kosong bila nomor seri belum diisi', () => {
    expect(bangunKodeUnit({ serialNumber: '', modelUnit: 'X', nama: 'Y', pemilik: 'Z' })).toBe('')
    expect(bangunKodeUnit({ serialNumber: null, modelUnit: 'X' })).toBe('')
  })

  it('memakai model sebagai nama produk bila nama kosong', () => {
    const kode = bangunKodeUnit({ serialNumber: 'SN1', modelUnit: 'AC-1', nama: '  ', pemilik: null })
    expect(kode).toBe('SN:SN1|MOD:AC-1|TOK:-|NAMA:AC-1')
  })

  it('membersihkan pemisah & baris baru di dalam nilai', () => {
    const kode = bangunKodeUnit({
      serialNumber: 'SN|1',
      modelUnit: 'A\nB',
      nama: 'Produk  Uji',
      pemilik: 'Toko|Dua',
    })
    expect(kode).toBe('SN:SN 1|MOD:A B|TOK:Toko Dua|NAMA:Produk Uji')
    expect(kode.split('|')).toHaveLength(4)
  })

  it('membatasi panjang tiap field agar QR tetap mudah dipindai', () => {
    const kode = bangunKodeUnit({
      serialNumber: 'S'.repeat(100),
      modelUnit: 'M'.repeat(100),
      nama: 'N'.repeat(100),
      pemilik: 'T'.repeat(100),
    })
    const u = uraiKodeUnit(kode)!
    expect(u.serialNumber).toHaveLength(BATAS_FIELD.serialNumber)
    expect(u.modelUnit).toHaveLength(BATAS_FIELD.modelUnit)
    expect(u.namaProduk).toHaveLength(BATAS_FIELD.namaProduk)
    expect(u.pemilik).toHaveLength(BATAS_FIELD.pemilik)
  })
})

describe('uraiKodeUnit', () => {
  it('membaca format baru lengkap', () => {
    const hasil = uraiKodeUnit('SN:2603128725B|MOD:RI-712GA(B)|TOK:Toko Semeru|NAMA:Kulkas')
    expect(hasil).toEqual({
      serialNumber: '2603128725B',
      modelUnit: 'RI-712GA(B)',
      pemilik: 'Toko Semeru',
      namaProduk: 'Kulkas',
    })
  })

  it('membaca format lama tanpa NAMA', () => {
    const hasil = uraiKodeUnit('SN:02100056000|MOD:WD-186 H|TOK:TOK-032')
    expect(hasil).toEqual({
      serialNumber: '02100056000',
      modelUnit: 'WD-186 H',
      pemilik: 'TOK-032',
      namaProduk: '',
    })
  })

  it('membaca stiker lama yang hanya berisi nomor seri', () => {
    expect(uraiKodeUnit('2603128725B')).toEqual({
      serialNumber: '2603128725B',
      modelUnit: '',
      namaProduk: '',
      pemilik: '',
    })
  })

  it('tidak peka huruf besar/kecil pada kunci', () => {
    const hasil = uraiKodeUnit('sn:ABC|mod:M1|tok:Toko A|nama:Produk')
    expect(hasil?.serialNumber).toBe('ABC')
    expect(hasil?.modelUnit).toBe('M1')
    expect(hasil?.pemilik).toBe('Toko A')
    expect(hasil?.namaProduk).toBe('Produk')
  })

  it('mengabaikan kunci tak dikenal', () => {
    const hasil = uraiKodeUnit('SN:ABC|XXX:buang|NAMA:Produk')
    expect(hasil?.serialNumber).toBe('ABC')
    expect(hasil?.namaProduk).toBe('Produk')
  })

  it('null untuk teks kosong atau format tanpa SN', () => {
    expect(uraiKodeUnit('')).toBeNull()
    expect(uraiKodeUnit(null)).toBeNull()
    expect(uraiKodeUnit('MOD:M1|TOK:Toko')).toBeNull()
  })
})

describe('adalahKodeUnit', () => {
  it('true hanya untuk payload berkunci SN', () => {
    expect(adalahKodeUnit('SN:1|MOD:2')).toBe(true)
    expect(adalahKodeUnit('2603128725B')).toBe(false)
    expect(adalahKodeUnit('Toko Andika')).toBe(false)
    expect(adalahKodeUnit('')).toBe(false)
  })
})

describe('nomorSeriDariKode', () => {
  it('mengambil nomor seri dari format apa pun (Tag ID = nomor seri)', () => {
    expect(nomorSeriDariKode('SN:2603128725B|MOD:RI|TOK:Toko|NAMA:Kulkas')).toBe('2603128725B')
    expect(nomorSeriDariKode('SN:02100056000|MOD:WD|TOK:TOK-032')).toBe('02100056000')
    expect(nomorSeriDariKode('2603128725B')).toBe('2603128725B')
    expect(nomorSeriDariKode('  Toko Andika  ')).toBe('Toko Andika')
  })
})
