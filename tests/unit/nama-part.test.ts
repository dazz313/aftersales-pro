import { describe, it, expect } from 'vitest'
import { normNama, skorNamaPart } from '@/lib/nama-part'

describe('normNama', () => {
  it('UPPERCASE, buang tanda baca, rapatkan spasi', () => {
    expect(normNama('Impeller, Pompa Besar')).toBe('IMPELLER POMPA BESAR')
    expect(normNama('  filter-kapasitor  2200W  ')).toBe('FILTER KAPASITOR 2200W')
  })
})

describe('skorNamaPart', () => {
  it('100 — identik walau tanda baca/kapital beda', () => {
    expect(skorNamaPart('Impeller Pompa Besar', 'impeller, pompa besar')).toBe(100)
  })

  it('90 — kandidat perluasan nama (awalan sama)', () => {
    expect(skorNamaPart('Impeller Pompa', 'Impeller Pompa Besar')).toBe(90)
  })

  it('≥80 — semua token utama ada di kandidat (urutan beda)', () => {
    const skor = skorNamaPart('Pompa Impeller Besar', 'Impeller Pompa Besar')
    expect(skor).toBeGreaterThanOrEqual(80)
  })

  it('<80 — hanya sebagian token cocok', () => {
    expect(skorNamaPart('Impeller Pompa Besar', 'Filter Kapasitor 2200')).toBeLessThan(80)
  })

  it('0 — nama kosong / tanpa token ≥3 huruf', () => {
    expect(skorNamaPart('', 'Impeller')).toBe(0)
    expect(skorNamaPart('ab cd', 'Impeller')).toBe(0)
  })
})
