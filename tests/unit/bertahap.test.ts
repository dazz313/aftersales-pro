import { describe, it, expect } from 'vitest'
import { potongBertahap, batasAktif, UKURAN_BERTAHAP } from '@/lib/bertahap'

describe('potongBertahap', () => {
  const items = Array.from({ length: 150 }, (_, i) => i + 1)

  it('memotong sesuai batas dan melaporkan sisa', () => {
    const r = potongBertahap(items, UKURAN_BERTAHAP)
    expect(r.tampil).toHaveLength(UKURAN_BERTAHAP)
    expect(r.tampil[0]).toBe(1)
    expect(r.tampil.at(-1)).toBe(UKURAN_BERTAHAP)
    expect(r.total).toBe(150)
    expect(r.sisa).toBe(150 - UKURAN_BERTAHAP)
    expect(r.adaLagi).toBe(true)
  })

  it('menampilkan seluruh daftar bila batas >= jumlah', () => {
    const r = potongBertahap(items, 1000)
    expect(r.tampil).toHaveLength(150)
    expect(r.sisa).toBe(0)
    expect(r.adaLagi).toBe(false)
  })

  it('menangani daftar kosong / null / undefined', () => {
    expect(potongBertahap([], 60)).toMatchObject({ total: 0, sisa: 0, adaLagi: false })
    expect(potongBertahap(null, 60).tampil).toEqual([])
    expect(potongBertahap(undefined, 60).total).toBe(0)
  })

  it('aman terhadap batas NaN/negatif/desimal', () => {
    expect(potongBertahap(items, NaN).tampil).toEqual([])
    expect(potongBertahap(items, -5).tampil).toEqual([])
    expect(potongBertahap(items, 2.9).tampil).toHaveLength(2)
  })

  it('mempertahankan urutan asli (tidak menyortir)', () => {
    const data = ['c', 'a', 'b']
    expect(potongBertahap(data, 2).tampil).toEqual(['c', 'a'])
  })
})

describe('batasAktif', () => {
  it('memakai batas tersimpan bila kunci filter sama', () => {
    expect(batasAktif({ kunci: 'a|b', batas: 180 }, 'a|b')).toBe(180)
  })

  it('kembali ke ukuran awal bila kunci filter berubah', () => {
    expect(batasAktif({ kunci: 'a|b', batas: 180 }, 'a|c')).toBe(UKURAN_BERTAHAP)
    expect(batasAktif({ kunci: 'a|b', batas: 180 }, 'a|c', 25)).toBe(25)
  })
})
