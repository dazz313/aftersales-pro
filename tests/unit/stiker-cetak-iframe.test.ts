import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Uji integritas dokumen cetak stiker (iframe self-contained):
 * - CSS halaman ikut tertanam (kelas Tailwind stiker tetap berlaku)
 * - aturan @page & lebar slot mengikuti pilihan kertas
 * - mode tunggal terpusat (.cetak-pusat), kolektif pakai flex space-between
 */

describe('bangunHtmlCetak / aturanCetakStiker', () => {
  beforeEach(() => vi.resetModules())
  afterEach(() => vi.unstubAllGlobals())

  async function modul() {
    return await import('@/lib/sticker-print')
  }

  it('A4: @page A4 portrait 10mm, slot stiker 44 mm, lembar kolektif space-between + rata tengah', async () => {
    const m = await modul()
    const aturan = m.aturanCetakStiker('A4')
    expect(aturan).toContain('@page { size: A4 portrait; margin: 10mm; }')
    expect(aturan).toContain('width: 44mm !important')
    expect(aturan).toContain('align-content: space-between')
    expect(aturan).toContain('justify-content: center')
    expect(aturan.match(/36mm/g)).toBeNull()

    const html = m.bangunHtmlCetak('<div class="stiker-printroot">x</div>', 'stiker', 'A4', '/*halaman*/')
    expect(html).toContain('/*halaman*/')
    expect(html).toContain('<div class="cetak-pusat">')
    expect(html).toContain('<!DOCTYPE html>')
    expect(html).toContain('charset="utf-8"')
  })

  it('THERMAL: margin 5mm, slot stiker 36 mm', async () => {
    const m = await modul()
    const aturan = m.aturanCetakStiker('THERMAL')
    expect(aturan).toContain('@page { margin: 5mm; }')
    expect(aturan).toContain('width: 36mm !important')
    expect(aturan.match(/44mm/g)).toBeNull()
  })

  it('MINI: margin 3mm, slot stiker 28 mm (label kecil)', async () => {
    const m = await modul()
    const aturan = m.aturanCetakStiker('MINI')
    expect(aturan).toContain('@page { margin: 3mm; }')
    expect(aturan).toContain('width: 28mm !important')
    expect(aturan.match(/44mm/g)).toBeNull()
    expect(aturan.match(/36mm/g)).toBeNull()
  })

  it('Kolektif: markup stiker diteruskan apa adanya (tanpa pembungkus pusat)', async () => {
    const m = await modul()
    const inner = '<div class="stiker-kolektif-grid stiker-printroot"><div class="stiker-printroot">s1</div></div>'
    const html = m.bangunHtmlCetak(inner, 'stiker-kolektif', 'A4', '')
    expect(html).toContain(inner)
    const badan = html.slice(html.indexOf('<body>') + 6)
    expect(badan).not.toContain('cetak-pusat')
    // container grid mencegah slot satu Lup: rule .stiker-printroot:not(.stiker-kolektif-grid)
    expect(html).toContain(':not(.stiker-kolektif-grid)')
  })
})
