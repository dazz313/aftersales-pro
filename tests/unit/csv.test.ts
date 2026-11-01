import { describe, it, expect } from 'vitest'
import {
  parseCsv,
  parseNum,
  parseDateFlexible,
  parseStatusGaransi,
  mapHeaders,
  validateTokoRows,
  TOKO_ALIASES,
} from '@/lib/csv'

describe('parseCsv', () => {
  it('memisah header & baris dengan delimiter koma', () => {
    const { headers, rows, delimiter } = parseCsv('kode,nama\nTOK1,Toko Satu\nTOK2,Toko Dua')
    expect(delimiter).toBe(',')
    expect(headers).toEqual(['kode', 'nama'])
    expect(rows).toEqual([
      ['TOK1', 'Toko Satu'],
      ['TOK2', 'Toko Dua'],
    ])
  })

  it('mendeteksi delimiter titik-koma (Excel Indonesia)', () => {
    const { headers, rows, delimiter } = parseCsv('kode;nama\nTOK1;Toko Satu')
    expect(delimiter).toBe(';')
    expect(headers).toEqual(['kode', 'nama'])
    expect(rows).toEqual([['TOK1', 'Toko Satu']])
  })

  it('membuang BOM UTF-8 dan baris kosong', () => {
    const { headers, rows } = parseCsv('\uFEFFkode,nama\n\nTOK1,Toko Satu\n\n')
    expect(headers).toEqual(['kode', 'nama'])
    expect(rows).toEqual([['TOK1', 'Toko Satu']])
  })

  it('menangani field berkutip yang memuat delimiter', () => {
    const { rows } = parseCsv('kode,nama\n"TOK,1","Toko, Satu"')
    expect(rows).toEqual([['TOK,1', 'Toko, Satu']])
  })

  it('menangani kutip ganda yang di-escape ("")', () => {
    const { rows } = parseCsv('nama\n"Toko ""Merdeka"" Satu"')
    expect(rows).toEqual([['Toko "Merdeka" Satu']])
  })

  it('teks kosong menghasilkan struktur kosong', () => {
    expect(parseCsv('')).toEqual({ headers: [], rows: [], delimiter: ',' })
  })
})

describe('parseNum', () => {
  it('angka polos', () => {
    expect(parseNum('10')).toBe(10)
    expect(parseNum('-5')).toBe(-5)
  })

  it('ribuan gaya Indonesia (titik)', () => {
    expect(parseNum('275.500')).toBe(275500)
    expect(parseNum('1.234.567')).toBe(1234567)
  })

  it('desimal gaya Indonesia (koma)', () => {
    expect(parseNum('275,5')).toBe(275.5)
  })

  it('ribuan + desimal gaya Inggris', () => {
    expect(parseNum('1,234,567.89')).toBe(1234567.89)
  })

  it('membuang prefix "Rp" dan spasi', () => {
    expect(parseNum('Rp 50.000')).toBe(50000)
  })

  it('kosong → null, tidak dikenali → NaN', () => {
    expect(parseNum('')).toBeNull()
    expect(Number.isNaN(parseNum('abc') as number)).toBe(true)
  })
})

describe('parseDateFlexible', () => {
  it('format ISO YYYY-MM-DD', () => {
    const d = parseDateFlexible('2025-08-17')!
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2025, 7, 17])
  })

  it('format DD/MM/YYYY', () => {
    const d = parseDateFlexible('17/08/2025')!
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2025, 7, 17])
  })

  it('bulan saja → tanggal 1', () => {
    const a = parseDateFlexible('08/2025')!
    expect([a.getFullYear(), a.getMonth(), a.getDate()]).toEqual([2025, 7, 1])
    const b = parseDateFlexible('2025-08')!
    expect([b.getFullYear(), b.getMonth(), b.getDate()]).toEqual([2025, 7, 1])
  })

  it('kosong / tidak dikenali → null', () => {
    expect(parseDateFlexible('')).toBeNull()
    expect(parseDateFlexible('bukan tanggal')).toBeNull()
  })
})

describe('parseStatusGaransi', () => {
  it('kata negatif → NON_GARANSI', () => {
    expect(parseStatusGaransi('NON-GARANSI')).toBe('NON_GARANSI')
    expect(parseStatusGaransi('garansi habis')).toBe('NON_GARANSI')
  })

  it('kata stok toko → STOK_TOKO', () => {
    expect(parseStatusGaransi('stok toko')).toBe('STOK_TOKO')
    expect(parseStatusGaransi('titipan')).toBe('STOK_TOKO')
  })

  it('default → GARANSI', () => {
    expect(parseStatusGaransi('Garansi')).toBe('GARANSI')
    expect(parseStatusGaransi('')).toBe('GARANSI')
  })
})

describe('mapHeaders', () => {
  it('memetakan header fleksibel (case-insensitive & alias)', () => {
    const { map, missing } = mapHeaders(['Kode Toko', 'Nama Toko'], TOKO_ALIASES, ['kodeToko', 'namaToko'])
    expect(missing).toEqual([])
    expect(map.kodeToko).toBe(0)
    expect(map.namaToko).toBe(1)
  })

  it('melaporkan kolom wajib yang hilang', () => {
    const { missing } = mapHeaders(['foo', 'bar'], TOKO_ALIASES, ['kodeToko', 'namaToko'])
    expect(missing).toEqual(['kodeToko', 'namaToko'])
  })
})

describe('validateTokoRows', () => {
  it('menandai baris valid sebagai pending dan barcode default nama toko', () => {
    const { acc, headerError } = validateTokoRows(
      ['kode_toko', 'nama_toko'],
      [['TOK1', 'Toko Satu']]
    )
    expect(headerError).toBeUndefined()
    expect(acc).toHaveLength(1)
    expect(acc[0].status).toBe('pending')
    expect(acc[0].data?.insert.barcodeToko).toBe('Toko Satu')
  })

  it('menolak kode kosong dan kode ganda di dalam file', () => {
    const { acc } = validateTokoRows(
      ['kode_toko', 'nama_toko'],
      [
        ['TOK1', 'Toko Satu'],
        ['', 'Tanpa Kode'],
        ['TOK1', 'Duplikat'],
      ]
    )
    expect(acc[0].status).toBe('pending')
    expect(acc[1].status).toBe('error')
    expect(acc[2].status).toBe('error')
    expect(acc[2].message).toContain('lebih dari satu kali')
  })

  it('mengembalikan headerError bila kolom wajib tidak ada', () => {
    const { acc, headerError } = validateTokoRows(['foo'], [['x']])
    expect(acc).toHaveLength(0)
    expect(headerError).toContain('kode_toko')
  })
})
