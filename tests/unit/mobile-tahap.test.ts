import { describe, expect, it } from 'vitest'
import { aksiTersedia, hitungTahap, labelTahap, type TiketTahap } from '@/lib/mobile-tahap'

const part = (statusPart: string) => ({ statusPart, sparepart: { kodePart: `KP-${statusPart}` } })

describe('hitungTahap', () => {
  it('unit tanpa tiket = TERDAFTAR', () => {
    expect(hitungTahap(null)).toBe('TERDAFTAR')
    expect(labelTahap('TERDAFTAR')).toContain('belum ada tiket')
  })

  it('REQUEST menunggu part di toko = TUNGGU_PART', () => {
    expect(hitungTahap({ status: 'REQUEST', penanganan: 'TUNGGU_PART_TOKO', parts: [] })).toBe('TUNGGU_PART')
  })

  it('PROSES + TARIK_WORKSHOP = DI_WORKSHOP', () => {
    expect(hitungTahap({ status: 'PROSES', penanganan: 'TARIK_WORKSHOP', lokasiUnit: 'WORKSHOP' })).toBe('DI_WORKSHOP')
  })

  it('PROSES + DI_TOKO = PROSES_DI_TOKO', () => {
    expect(hitungTahap({ status: 'PROSES', penanganan: 'DI_TOKO', lokasiUnit: 'TOKO' })).toBe('PROSES_DI_TOKO')
  })

  it('FINISH di workshop vs sudah kembali ke toko', () => {
    expect(hitungTahap({ status: 'FINISH', lokasiUnit: 'WORKSHOP' })).toBe('FINISH_DI_WORKSHOP')
    expect(hitungTahap({ status: 'FINISH', lokasiUnit: 'TOKO' })).toBe('SELESAI_DI_TOKO')
  })

  it('REQUEST EMAIL punya tahap sendiri', () => {
    expect(hitungTahap({ status: 'REQUEST_EMAIL' })).toBe('REQUEST_EMAIL')
  })
})

describe('aksiTersedia', () => {
  it('tanpa tiket tidak menawarkan aksi', () => {
    expect(aksiTersedia(null)).toEqual([])
  })

  it('REQUEST dengan part belum READY hanya boleh daftar tunggu', () => {
    const aksi = aksiTersedia({ status: 'REQUEST', parts: [part('ORDER_PRODUSEN')] }).map((a) => a.aksi)
    expect(aksi).toEqual(['DAFTAR_TUNGGU_TOKO'])
  })

  it('REQUEST dengan semua part READY boleh kerjakan di toko / tarik workshop', () => {
    const aksi = aksiTersedia({ status: 'REQUEST', parts: [part('READY')] }).map((a) => a.aksi)
    expect(aksi).toContain('KERJAKAN_DI_TOKO')
    expect(aksi).toContain('TARIK_WORKSHOP')
    expect(aksi).not.toContain('DAFTAR_TUNGGU_TOKO')
  })

  it('PROSES menawarkan FINISH dan KEMBALI_KE_TOKO', () => {
    const tiket: TiketTahap = { status: 'PROSES', penanganan: 'TARIK_WORKSHOP', lokasiUnit: 'WORKSHOP', parts: [] }
    const aksi = aksiTersedia(tiket).map((a) => a.aksi)
    expect(aksi).toContain('FINISH')
    expect(aksi).toContain('KEMBALI_KE_TOKO')
  })

  it('KEMBALI_KE_TOKO tidak ditawarkan dua kali setelah tanggal kembali terekam', () => {
    const aksi = aksiTersedia({
      status: 'FINISH',
      lokasiUnit: 'TOKO',
      tglKembaliKeToko: '2026-01-02T00:00:00.000Z',
      parts: [],
    }).map((a) => a.aksi)
    expect(aksi).not.toContain('KEMBALI_KE_TOKO')
    expect(aksi).not.toContain('FINISH')
  })

  it('FINISH yang masih di workshop hanya menawarkan kirim balik ke toko', () => {
    const aksi = aksiTersedia({ status: 'FINISH', lokasiUnit: 'WORKSHOP', parts: [] }).map((a) => a.aksi)
    expect(aksi).toEqual(['KEMBALI_KE_TOKO'])
  })
})
