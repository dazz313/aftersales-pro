import { describe, it, expect } from 'vitest'
import {
  umurTiketJam,
  formatUmur,
  isDataLama,
  tanggalAcuanUmur,
  BATAS_DATA_LAMA_HARI,
} from '@/lib/umur'

const JAM = 3600 * 1000
const HARI = 24 * JAM

describe('umurTiketJam', () => {
  it('menghitung umur dari tglTiket (bukan createdAt)', () => {
    const now = Date.UTC(2025, 0, 2, 0, 0, 0)
    const tglTiket = new Date(Date.UTC(2025, 0, 1, 0, 0, 0))
    const createdAt = new Date(Date.UTC(2025, 0, 2, 0, 0, 0))
    expect(umurTiketJam({ tglTiket, createdAt }, now)).toBe(24)
  })

  it('fallback ke createdAt bila tglTiket tidak ada', () => {
    const now = Date.UTC(2025, 0, 2, 0, 0, 0)
    expect(umurTiketJam({ createdAt: new Date(now - 5 * JAM) }, now)).toBe(5)
  })

  it('tidak pernah negatif (tanggal masa depan → 0)', () => {
    const now = Date.UTC(2025, 0, 1, 0, 0, 0)
    expect(umurTiketJam({ tglTiket: new Date(now + 10 * JAM) }, now)).toBe(0)
  })

  it('null bila tidak ada tanggal valid', () => {
    expect(umurTiketJam({}, Date.now())).toBeNull()
    expect(umurTiketJam({ tglTiket: 'bukan-tanggal' }, Date.now())).toBeNull()
  })
})

describe('tanggalAcuanUmur', () => {
  it('memprioritaskan tglTiket', () => {
    const tglTiket = new Date(Date.UTC(2025, 0, 1))
    const createdAt = new Date(Date.UTC(2025, 5, 1))
    expect(tanggalAcuanUmur({ tglTiket, createdAt })).toBe(tglTiket.getTime())
  })
})

describe('formatUmur', () => {
  it('jam (< 24)', () => {
    expect(formatUmur(0)).toBe('0 jam')
    expect(formatUmur(18)).toBe('18 jam')
  })

  it('hari + sisa jam', () => {
    expect(formatUmur(24)).toBe('1 hari')
    expect(formatUmur(30)).toBe('1 hari 6 jam')
    expect(formatUmur(49)).toBe('2 hari 1 jam')
  })

  it('null → 0 jam', () => {
    expect(formatUmur(null)).toBe('0 jam')
    expect(formatUmur(undefined)).toBe('0 jam')
  })
})

describe('isDataLama', () => {
  it('true bila selisih upload vs kejadian melebihi batas', () => {
    const tglTiket = new Date(Date.UTC(2025, 0, 1))
    const createdAt = new Date(tglTiket.getTime() + (BATAS_DATA_LAMA_HARI + 3) * HARI)
    expect(isDataLama({ tglTiket, createdAt })).toBe(true)
  })

  it('false bila selisih masih dalam batas', () => {
    const tglTiket = new Date(Date.UTC(2025, 0, 1))
    const createdAt = new Date(tglTiket.getTime() + 3 * HARI)
    expect(isDataLama({ tglTiket, createdAt })).toBe(false)
  })

  it('false bila salah satu tanggal tidak ada', () => {
    expect(isDataLama({ tglTiket: new Date() })).toBe(false)
    expect(isDataLama({})).toBe(false)
  })
})
