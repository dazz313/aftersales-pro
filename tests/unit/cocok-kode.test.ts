import { describe, expect, it } from 'vitest'
import {
  ekstrakModelDariNama,
  normCari,
  rapikanModel,
  ringkasBankKode,
  skorCocokKode,
  skorKodeCocok,
  skorNamaCocok,
  tokenCari,
  varianDbCari,
} from '@/lib/cocok-kode'

/**
 * Kasus nyata dari pengguna:
 *   dicari "RI-202S" → harus menemukan
 *   "RI202-001-2-1X02-PR | Top Plate RI 202 S"
 * walau kolom model masih kosong dan penulisan berbeda (strip vs spasi).
 */
describe('normCari / tokenCari / varianDbCari', () => {
  it('menyamakan tanda hubung, garis miring, titik & spasi', () => {
    expect(normCari('RI-202S')).toBe('RI 202S')
    expect(normCari('Top Plate RI 202 S')).toBe('TOP PLATE RI 202 S')
    expect(normCari('  a/b.c  ')).toBe('A B C')
  })

  it('memecah batas huruf↔angka menjadi token', () => {
    expect(tokenCari('RI-202S')).toEqual(['RI', '202', 'S'])
    expect(tokenCari('AX001')).toEqual(['AX', '001'])
  })

  it('varian DB memuat bentuk berspasi, rapat, dan token ≥2 huruf', () => {
    const v = varianDbCari('RI-202S')
    expect(v).toContain('RI 202 S')
    expect(v).toContain('RI202S')
    expect(v).toContain('RI')
    expect(v).toContain('202')
    expect(v).not.toContain('S')
  })
})

describe('ekstrakModelDariNama / rapikanModel', () => {
  it('mengambil model dari nama part', () => {
    expect(ekstrakModelDariNama('Top Plate RI 202 S')).toBe('RI 202 S')
    expect(ekstrakModelDariNama('KNOB ASSY (BLACK) RI-712')).toBe('RI 712')
    expect(ekstrakModelDariNama('Casing PS 135 E')).toBe('PS 135 E')
    expect(ekstrakModelDariNama('BEARING - 6202ZZ PC-250 BIT')).toBe('PC 250')
  })

  it('tidak menebak kata bagian sebagai model', () => {
    expect(ekstrakModelDariNama('OUT CASE ASSY 602')).toBe('')
    expect(ekstrakModelDariNama('BIG BURNER ASSY (RI-5/RI-6)')).toBe('')
    expect(ekstrakModelDariNama('TOP PLATE 522 E')).toBe('')
    expect(ekstrakModelDariNama('CAPACITOR - 8 UF, 450VAC')).toBe('')
    expect(ekstrakModelDariNama('FOUR SWITCH ASSY C + DIODA IN5408 3A + KNOB')).toBe('')
    expect(ekstrakModelDariNama('BURNER HEAD (TTC DIA. 110)')).toBe('')
    expect(ekstrakModelDariNama('Neck 18 Inch')).toBe('')
    expect(ekstrakModelDariNama('STATOR ASM (W/FRAME) 125W - COMMON SPARE PART')).toBe('')
  })

  it('tetap menemukan model di antara kata bagian', () => {
    expect(ekstrakModelDariNama('BODY SETS (430SS/TF2370A1) RH-127SS')).toBe('RH 127 SS')
    expect(ekstrakModelDariNama('MAIN PCB FOR WDP-300 (D)')).toBe('WDP 300 D')
    expect(ekstrakModelDariNama('FRONT FRAME MCG-171 (BLACK)')).toBe('MCG 171')
  })

  it('merapikan model ke bentuk konsisten', () => {
    expect(rapikanModel('RI-202S')).toBe('RI 202 S')
    expect(rapikanModel('WD-186 H')).toBe('WD 186 H')
    expect(rapikanModel('Miyako 16 inch')).toBe('Miyako 16 inch')
  })
})

describe('skorCocokKode', () => {
  const topPlate = { kode: 'RI202-001-2-1X02-PR', namaPart: 'Top Plate RI 202 S' }

  it('"RI-202S" menemukan "Top Plate RI 202 S" (kolom model kosong)', () => {
    const hasil = skorCocokKode('RI-202S', topPlate)
    expect(hasil.skor).toBeGreaterThanOrEqual(90)
    expect(hasil.pada).toContain('model')
    expect(hasil.pada).toContain('nama')
  })

  it('bentuk rapat & spasi juga cocok', () => {
    expect(skorCocokKode('ri202s', topPlate).skor).toBeGreaterThanOrEqual(90)
    expect(skorCocokKode('RI 202', topPlate).skor).toBeGreaterThanOrEqual(90)
  })

  it('nama part juga bisa dicari', () => {
    expect(skorCocokKode('top plate', topPlate).skor).toBeGreaterThanOrEqual(85)
  })

  it('kode persis mendapat skor tertinggi', () => {
    const hasil = skorCocokKode('RI-202S', { kode: 'RI-202S', namaPart: '2601271041' })
    expect(hasil.skor).toBe(100)
    expect(hasil.pada).toContain('kode')
  })

  it('brand cocok dengan bobot lebih rendah', () => {
    const hasil = skorCocokKode('RINNAI', { ...topPlate, brandKompatibel: 'RINNAI' })
    expect(hasil.skor).toBe(70)
    expect(hasil.pada).toContain('brand')
  })

  it('tidak mencocokkan part yang tidak berhubungan', () => {
    expect(skorCocokKode('filter kapasitor', topPlate).skor).toBeLessThan(45)
  })
})

describe('skorKodeCocok', () => {
  it('kode persis (beda strip/spasi) = 100', () => {
    expect(skorKodeCocok('RI202-001-2-1X02-PR', 'RI202-001-2-1X02-PR').skor).toBe(100)
    expect(skorKodeCocok('ri202 001 2 1x02 pr', 'RI202-001-2-1X02-PR').skor).toBe(100)
  })

  it('kode yang memuat kueri tetap ditemukan', () => {
    expect(skorKodeCocok('RI202-001', 'RI202-001-2-1X02-PR').skor).toBe(90)
    expect(skorKodeCocok('RI202-001-2-1X02-PR-EXTRA', 'RI202-001-2-1X02-PR').skor).toBe(90)
  })

  it('salah ketik 1 huruf pada kode panjang masih dianggap mirip', () => {
    expect(skorKodeCocok('RI202-001-2-1X03-PR', 'RI202-001-2-1X02-PR').skor).toBe(82)
  })

  it('kode berbeda yang hanya berbagi angka TIDAK dicocokkan', () => {
    expect(skorKodeCocok('RI-202S', 'RI202-001-2-1X02-PR').skor).toBe(0)
    expect(skorKodeCocok('C5Q-1', 'RI202-001-2-1X02-PR').skor).toBe(0)
  })
})

describe('skorNamaCocok', () => {
  it('nama persis = 100 (beda kapital/tanda baca diabaikan)', () => {
    expect(skorNamaCocok('Top Plate RI 202 S', 'Top Plate RI 202 S').skor).toBe(100)
    expect(skorNamaCocok('top plate ri-202s', 'TOP PLATE RI 202 S').skor).toBe(100)
  })

  it('model di dalam nama juga dianggap persis', () => {
    const hasil = skorNamaCocok('RI 202 S', 'Top Plate RI 202 S')
    expect(hasil.skor).toBe(100)
    expect(hasil.pada).toContain('model')
  })

  it('nama yang memuat kueri = 95', () => {
    expect(skorNamaCocok('Top Plate', 'Top Plate RI 202 S').skor).toBe(95)
  })
})

describe('ringkasBankKode', () => {
  it('menghitung total, model unik (eksplisit atau dari nama), dan sebaran sumber', () => {
    const r = ringkasBankKode([
      { sumber: 'KATALOG', modelTipe: 'RI-202S', namaPart: 'Top Plate RI 202 S' },
      { sumber: 'CSV', modelTipe: 'RI 202 S', namaPart: 'Top Plate RI 202 S' },
      { sumber: 'KATALOG', modelTipe: '', namaPart: 'Top Plate RI 202 S' },
      { sumber: 'KATALOG', modelTipe: '', namaPart: 'Filter Kapasitor 2200' },
    ])
    expect(r.total).toBe(4)
    expect(r.jumlahModel).toBe(1)
    expect(r.perSumber).toEqual({ KATALOG: 3, CSV: 1 })
  })
})
