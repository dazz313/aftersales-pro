import { describe, it, expect } from 'vitest'
import { bersihkanSpreadsheetId } from '@/lib/gsheets'

describe('bersihkanSpreadsheetId', () => {
  const ID = '1WfaovZCUOEXz69qtf_X2eHuLdTX7rRPSBuxING6zD0w'

  it('ID murni tetap utuh', () => {
    expect(bersihkanSpreadsheetId(ID)).toBe(ID)
  })

  it('URL utuh dgn /edit?gid=0#gid=0 → hanya ID', () => {
    expect(bersihkanSpreadsheetId(`https://docs.google.com/spreadsheets/d/${ID}/edit?gid=0#gid=0`)).toBe(ID)
  })

  it('fragmen dgn /edit… (nilai yang ditempel user) → hanya ID', () => {
    expect(bersihkanSpreadsheetId(`${ID}/edit?gid=0#gid=0`)).toBe(ID)
  })

  it('dengan spasi & kutip → hanya ID', () => {
    expect(bersihkanSpreadsheetId(`  "${ID}  "`)).toBe(ID)
  })

  it('ID salah (terlalu pendek) → dikembalikan tanpa diubah', () => {
    expect(bersihkanSpreadsheetId('id-pendek-123')).toBe('id-pendek-123')
  })
})
