import { describe, expect, it } from 'vitest'
import {
  daftarPartBelumDatang,
  labelPartTunggu,
  pesanPartBelumDatang,
} from '@/lib/part-tunggu'
import { alurSjState } from '@/lib/alur-sj'
import type { ServiceTicket } from '@/lib/types'

/**
 * Satu unit bisa rusak di beberapa bagian → part dipesan bergelombang pada
 * tiket yang SAMA (tanpa tiket baru). Uji aturan:
 *  - FINISH ditahan selama masih ada part ORDER_PRODUSEN
 *  - chip alur SJ kembali "menunggu part" saat ada pesanan susulan
 */

const part = (over: Partial<{ id: number; qty: number; statusPart: string; kode: string; nama: string }> = {}) => ({
  id: over.id ?? 1,
  qty: over.qty ?? 1,
  statusPart: over.statusPart ?? 'ORDER_PRODUSEN',
  sparepart: { kodePart: over.kode ?? 'TP-001', namaPart: over.nama ?? 'Top Plate' },
})

describe('daftarPartBelumDatang / labelPartTunggu', () => {
  it('hanya mengambil baris qty > 0 yang belum READY', () => {
    const parts = [
      part({ id: 1, statusPart: 'READY' }),
      part({ id: 2, statusPart: 'ORDER_PRODUSEN' }),
      part({ id: 3, qty: 0, statusPart: 'ORDER_PRODUSEN' }),
    ]
    expect(daftarPartBelumDatang(parts).map((p) => p.id)).toEqual([2])
  })

  it('label memakai kode + nama + qty, fallback ke cache bila master hilang', () => {
    expect(labelPartTunggu(part({ kode: 'TP-001', nama: 'Top Plate', qty: 2 }))).toBe('TP-001 Top Plate ×2')
    expect(
      labelPartTunggu({
        qty: 1,
        statusPart: 'ORDER_PRODUSEN',
        kodePartCache: 'RW-009',
        namaPartCache: 'Rear Plate',
        sparepart: null,
      })
    ).toBe('RW-009 Rear Plate ×1')
  })

  it('pesan kosong bila semua part READY', () => {
    expect(pesanPartBelumDatang([part({ statusPart: 'READY' })])).toBe('')
  })

  it('pesan menyebut part yang ditunggu + jalan keluar (tambah/hapus part)', () => {
    const pesan = pesanPartBelumDatang([
      part({ id: 1, kode: 'TP-001', nama: 'Top Plate' }),
      part({ id: 2, kode: 'RW-009', nama: 'Rear Plate', qty: 2 }),
    ])
    expect(pesan).toContain('2 part')
    expect(pesan).toContain('TP-001 Top Plate ×1')
    expect(pesan).toContain('RW-009 Rear Plate ×2')
    expect(pesan).toContain('tambah part')
    expect(pesan).toContain('hapus baris part')
  })
})

describe('alurSjState — pesanan part susulan', () => {
  const dasar = {
    id: 1,
    status: 'PROSES',
    tglRequestPart: '2026-11-01T00:00:00.000Z',
    tglPartDatang: '2026-11-02T00:00:00.000Z',
    noSuratJalan: 'SJ-1',
    parts: [] as ReturnType<typeof part>[],
  }

  const tiket = (over: Record<string, unknown>) => ({ ...dasar, ...over }) as unknown as ServiceTicket

  it('part pertama datang & semua READY → PART_DATANG', () => {
    expect(alurSjState(tiket({ parts: [part({ statusPart: 'READY' })] }))).toBe('PART_DATANG')
  })

  it('setelah part datang ada pesanan susulan → kembali menunggu (bukan PART_DATANG)', () => {
    const t = tiket({
      parts: [part({ id: 1, statusPart: 'READY' }), part({ id: 2, statusPart: 'ORDER_PRODUSEN' })],
    })
    expect(alurSjState(t)).toBe('BEKAS_TERKIRIM')
  })

  it('pesanan susulan tanpa surat jalan → BELUM_SJ', () => {
    const t = tiket({
      noSuratJalan: null,
      tglRequestPart: null,
      tglPartDatang: null,
      parts: [part({ statusPart: 'ORDER_PRODUSEN' })],
    })
    expect(alurSjState(t)).toBe('BELUM_SJ')
  })

  it('tiket FINISH selalu TAK_PERLU_SJ', () => {
    const t = tiket({ status: 'FINISH', parts: [part({ statusPart: 'ORDER_PRODUSEN' })] })
    expect(alurSjState(t)).toBe('TAK_PERLU_SJ')
  })
})
