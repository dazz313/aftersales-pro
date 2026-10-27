'use client'

import { useEffect } from 'react'

/**
 * Mode cetak stiker barcode (toko & unit).
 *
 * CSS cetak global (globals.css) menyembunyikan seluruh halaman saat print dan
 * hanya menampilkan nota servis (.nota-printroot) — itulah sebabnya stiker yang
 * dicetak lewat window.print() biasa menghasilkan kertas kosong. Komponen stiker
 * menandai body dengan data-print-mode='stiker' sehingga CSS hanya menampilkan
 * elemen .stiker-printroot, ditempel di pojok kiri atas kertas.
 */

const MODE = 'stiker'

function setStikerMode(on: boolean) {
  if (typeof document === 'undefined') return
  if (on) document.body.setAttribute('data-print-mode', MODE)
  else document.body.removeAttribute('data-print-mode')
}

/** Tombol "Cetak Stiker": pasang mode stiker → buka dialog cetak → bersihkan mode. */
export function cetakStiker() {
  setStikerMode(true)
  window.print()
  setStikerMode(false)
}

/**
 * Dipasang selama dialog stiker terbuka:
 * - tangani Ctrl+P manual — mode 'stiker' dipasang saat print mulai (beforeprint)
 *   dan dilepas setelah selesai (afterprint), sehingga print halaman lain tetap
 *   mengikuti aturan nota/global.
 * - timpa ukuran kertas @page hanya selama dialog terbuka (aturan @page A5
 *   landscape milik nota di globals.css tidak bisa dikondisikan lewat selector).
 */
export function useStickerPrint(active: boolean) {
  useEffect(() => {
    if (!active) return

    const style = document.createElement('style')
    style.dataset.stikerPrint = 'page'
    style.textContent = '@media print { @page { size: auto; margin: 10mm; } }'
    document.head.appendChild(style)

    const before = () => setStikerMode(true)
    const after = () => setStikerMode(false)
    window.addEventListener('beforeprint', before)
    window.addEventListener('afterprint', after)

    return () => {
      style.remove()
      window.removeEventListener('beforeprint', before)
      window.removeEventListener('afterprint', after)
      setStikerMode(false)
    }
  }, [active])
}
