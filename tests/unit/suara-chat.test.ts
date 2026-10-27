import { describe, it, expect } from 'vitest'
import { deteksiPesanBaru } from '@/lib/suara-chat'
import type { ChatPesanItem } from '@/lib/types'

const pesan = (id: number, pengirimId: number): ChatPesanItem =>
  ({ id, pengirimId, penerimaId: null, isi: `pesan-${id}`, createdAt: new Date().toISOString() }) as ChatPesanItem

describe('deteksiPesanBaru', () => {
  it('muat pertama (idTerakhir 0) → hanya kembalikan maxId, tinta tanpa bunyi', () => {
    const r = deteksiPesanBaru([pesan(5, 27), pesan(9, 27)], 26, 0)
    expect(r.maxId).toBe(9)
    expect(r.adaBaru).toBe(true) // dipakai hanya bila bukan muat pertama
  })

  it('pesan baru dari ORANG LAIN → adaBaru true', () => {
    const r = deteksiPesanBaru([pesan(10, 27)], 26, 9)
    expect(r.adaBaru).toBe(true)
    expect(r.maxId).toBe(10)
  })

  it('pesan baru dari SENDIRI → adaBaru false, maxId tetap naik', () => {
    const r = deteksiPesanBaru([pesan(11, 26)], 26, 10)
    expect(r.adaBaru).toBe(false)
    expect(r.maxId).toBe(11)
  })

  it('campuran: sendiri + orang lain → bunyi (karena ada dari orang lain)', () => {
    const r = deteksiPesanBaru([pesan(12, 26), pesan(13, 27)], 26, 11)
    expect(r.adaBaru).toBe(true)
    expect(r.maxId).toBe(13)
  })

  it('riwayat lama semua (id ≤ penanda) → tidak ada bunyi', () => {
    const r = deteksiPesanBaru([pesan(8, 27), pesan(9, 27)], 26, 9)
    expect(r.adaBaru).toBe(false)
    expect(r.maxId).toBe(9)
  })

  it('daftar kosong → tidak berubah', () => {
    const r = deteksiPesanBaru([], 26, 42)
    expect(r).toEqual({ maxId: 42, adaBaru: false })
  })

  it('pesanan acak (terbaru dulu) tetap benar dihitung', () => {
    const r = deteksiPesanBaru([pesan(15, 27), pesan(14, 26), pesan(13, 27)], 26, 12)
    expect(r.adaBaru).toBe(true)
    expect(r.maxId).toBe(15)
  })
})
