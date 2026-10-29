import { describe, it, expect } from 'vitest'
import { hariKe, pesanAlurTglFinish } from '@/lib/alur-tanggal'

// Uji "minimal sama hari": tanggal FINISH tidak boleh lebih awal dari
// kedatangan part / pemasangan part / kembali ke toko — jam diabaikan.
// Default tiket uji berasal dari jam 15:00 lokal agar batas menyeberang
// tengah malam UTC saat digeser (menguji pembanding hari lokal, bukan UTC).
const pangkal = (y: number, m: number, d: number, jam = 15) => new Date(y, m - 1, d, jam)

describe('hariKe', () => {
  it('membuang jam — tanggal beda jam di hari yang sama bernilai sama', () => {
    const pagi = pangkal(2026, 10, 25, 7)
    const sore = pangkal(2026, 10, 25, 21)
    expect(hariKe(pagi)).toBe(hariKe(sore))
  })

  it('beda hari bernilai beda walau begitu dekat tengah malam', () => {
    const hampirTengahMalam = new Date(2026, 9, 25, 23, 59, 59)
    const lewatTengahMalam = new Date(2026, 9, 26, 0, 0, 1)
    expect(hariKe(lewatTengahMalam)).toBeGreaterThan(hariKe(hampirTengahMalam))
  })
})

describe('pesanAlurTglFinish — part datang', () => {
  const tiket = { tglPartDatang: pangkal(2026, 10, 25) }

  it('melarang FINISH lebih awal dari tanggal part datang', () => {
    const pesan = pesanAlurTglFinish(pangkal(2026, 10, 24, 23), tiket)
    expect(pesan).toContain('part datang')
    expect(pesan).toContain('25/10/2026')
  })

  it('menerima FINISH di hari yang sama walau part datang sore', () => {
    // Part datang 25/10 15:00 — selesai 25/10 08:00 (lebih pagi) tetap sah:
    // "minimal sama hari", bukan minimal sesudah jam kedatangan.
    expect(pesanAlurTglFinish(pangkal(2026, 10, 25, 8), tiket)).toBeNull()
  })

  it('menerima FINISH setelah tanggal part datang', () => {
    expect(pesanAlurTglFinish(pangkal(2026, 10, 26, 8), tiket)).toBeNull()
  })

  it('tanpa tglPartDatang tidak ada larangan dari sumber ini', () => {
    expect(pesanAlurTglFinish(pangkal(2026, 10, 1), { tglPartDatang: null })).toBeNull()
  })
})

describe('pesanAlurTglFinish — pemasangan part', () => {
  it('melarang FINISH sebelum part terpasang (pakai kode part di pesan)', () => {
    const pesan = pesanAlurTglFinish(pangkal(2026, 10, 24), {
      parts: [{ tglPasang: pangkal(2026, 10, 25), sparepart: { kodePart: 'ABC-001' } }],
    })
    expect(pesan).toContain('pemasangan part ABC-001')
  })

  it('menerima FINISH sama hari pemasangan', () => {
    expect(
      pesanAlurTglFinish(pangkal(2026, 10, 25, 8), {
        parts: [{ tglPasang: pangkal(2026, 10, 25, 17), sparepart: { kodePart: 'ABC-001' } }],
      })
    ).toBeNull()
  })

  it('fallback kodePartCache bila relasi master kosong', () => {
    const pesan = pesanAlurTglFinish(pangkal(2026, 10, 1), {
      parts: [{ tglPasang: pangkal(2026, 10, 2), kodePartCache: 'XYZ-9' }],
    })
    expect(pesan).toContain('XYZ-9')
  })
})

describe('pesanAlurTglFinish — kembali ke toko', () => {
  it('melarang FINISH sebelum unit sampai di toko', () => {
    const pesan = pesanAlurTglFinish(pangkal(2026, 10, 24), {
      tglKembaliKeToko: pangkal(2026, 10, 25),
    })
    expect(pesan).toContain('dikembalikan ke toko')
  })

  it('menerima FINISH sama hari unit sampai di toko', () => {
    expect(
      pesanAlurTglFinish(pangkal(2026, 10, 25, 9), {
        tglKembaliKeToko: pangkal(2026, 10, 25, 14),
      })
    ).toBeNull()
  })
})

describe('pesanAlurTglFinish — urutan pemeriksaan', () => {
  it('prioritas larangan: part datang didahulukan sebelum pemasangan', () => {
    const pesan = pesanAlurTglFinish(pangkal(2026, 10, 23), {
      tglPartDatang: pangkal(2026, 10, 24),
      parts: [{ tglPasang: pangkal(2026, 10, 25), sparepart: { kodePart: 'ABC-001' } }],
    })
    expect(pesan).toContain('part datang')
  })

  it('tiket tanpa semua tanggal → valid', () => {
    expect(pesanAlurTglFinish(pangkal(2026, 10, 1), {})).toBeNull()
  })
})
