'use client'

import { useEffect } from 'react'

/**
 * Mode cetak stiker barcode (toko, unit & kolektif).
 *
 * CSS cetak global (globals.css) menyembunyikan seluruh halaman saat print dan
 * hanya menampilkan nota servis (.nota-printroot) — itulah sebabnya stiker yang
 * dicetak lewat window.print() biasa menghasilkan kertas kosong. Komponen stiker
 * menandai body dengan data-print-mode='stiker' (tunggal) atau
 * 'stiker-kolektif' (banyak stiker dalam 1 lembar) sehingga CSS hanya
 * menampilkan elemen .stiker-printroot — mini 42 mm per stiker.
 */

export type StikerMode = 'stiker' | 'stiker-kolektif'

function setStikerMode(mode: StikerMode | null) {
  if (typeof document === 'undefined') return
  if (mode) document.body.setAttribute('data-print-mode', mode)
  else document.body.removeAttribute('data-print-mode')
}

/** Tombol "Cetak Stiker": pasang mode stiker → buka dialog cetak → bersihkan mode. */
export function cetakStiker(mode: StikerMode = 'stiker') {
  setStikerMode(mode)
  window.print()
  setStikerMode(null)
}

/**
 * Dipasang selama dialog stiker terbuka:
 * - tangani Ctrl+P manual — mode dipasang saat print mulai (beforeprint)
 *   dan dilepas setelah selesai (afterprint), sehingga print halaman lain tetap
 *   mengikuti aturan nota/global.
 * - timpa ukuran kertas @page hanya selama dialog terbuka (aturan @page A5
 *   landscape milik nota di globals.css tidak bisa dikondisikan lewat selector).
 *   Margin 5 mm: stiker mini 42 mm + margin 5×2 = 52 mm — muat di printer
 *   label thermal portable 58 mm maupun A4.
 */
export function useStickerPrint(active: boolean, mode: StikerMode = 'stiker') {
  useEffect(() => {
    if (!active) return

    const style = document.createElement('style')
    style.dataset.stikerPrint = 'page'
    style.textContent = '@media print { @page { size: auto; margin: 5mm; } }'
    document.head.appendChild(style)

    const before = () => setStikerMode(mode)
    const after = () => setStikerMode(null)
    window.addEventListener('beforeprint', before)
    window.addEventListener('afterprint', after)

    return () => {
      style.remove()
      window.removeEventListener('beforeprint', before)
      window.removeEventListener('afterprint', after)
      setStikerMode(null)
    }
  }, [active, mode])
}
