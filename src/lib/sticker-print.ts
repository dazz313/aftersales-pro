'use client'

import { useEffect, useSyncExternalStore } from 'react'

/**
 * Cetak stiker QR (toko, unit & kolektif) + SETTING KERTAS per perangkat.
 *
 * ===== ARSITEKTUR CETAK (iframe terisolasi, deterministik) =====================
 * Sebelumnya cetak mengandalkan atribut body[data-print-mode] + CSS @media print
 * halaman: kalau atribut terlewat saat pratinjau (Ctrl+P, timing afterprint,
 * CSS chunk gagal dimuat), seluruh isi halaman ikut tercetak di kertas.
 *
 * Sekarang tombol "Cetak" MEMBANGUN DOKUMEN CETAK SENDIRI di dalam iframe
 * tersembunyi yang hanya berisi stiker (dikloning dari pratinjau dialog) +
 * CSS utuh (Tailwind halaman) + aturan @page/grid locale. Hasil pratinjau
 * Chrome SELALU lembar stiker murni — tidak ada header/tabel/overlap lagi.
 *
 * Ctrl+P manual saat dialog terbuka tetap diarahkan ke pratinjau stiker via
 * useStickerPrint (fallback CSS halaman).
 *
 * SETTING KERTAS (localStorage per perangkat, pilihan di dialog):
 * - 'A4'      : printer biasa — @page A4 portrait margin 10 mm, stiker 44 mm.
 * - 'THERMAL' : printer label portable 58 mm — margin 5 mm, stiker 36 mm.
 * - 'MINI'    : label kecil — margin 3 mm, stiker 28 mm (paling hemat tempat).
 */

export type StikerMode = 'stiker' | 'stiker-kolektif'
export type KertasStiker = 'A4' | 'THERMAL' | 'MINI'

const KERTAS_KEY = 'stiker_kertas'

/* ==============================setting kertas ============================== */

/** Baca setting kertas stiker (per perangkat). Default: A4 (printer biasa). */
export function bacaKertasStiker(): KertasStiker {
  if (typeof window === 'undefined') return 'A4'
  try {
    const v = localStorage.getItem(KERTAS_KEY)
    return v === 'THERMAL' || v === 'MINI' ? v : 'A4'
  } catch {
    return 'A4'
  }
}

/** Simpan setting kertas stiker (per perangkat) + beritahu pelanggan yang menyimak. */
const kertasPengamat = new Set<() => void>()
export function simpanKertasStiker(k: KertasStiker) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(KERTAS_KEY, k)
  } catch {
    // penyimpanan diblokir — pilihan hanya berlaku di sesi ini
  }
  for (const p of kertasPengamat) p()
}

/**
 * Hook setting kertas stiker — via useSyncExternalStore (bukan setState-in-effect):
 * nilai live per perangkat, server selalu 'A4', tersinkron antar tab (storage event).
 */
function langgananKertas(cb: () => void) {
  if (typeof window !== 'undefined') window.addEventListener('storage', cb)
  kertasPengamat.add(cb)
  return () => {
    if (typeof window !== 'undefined') window.removeEventListener('storage', cb)
    kertasPengamat.delete(cb)
  }
}
export function useKertasStiker(): KertasStiker {
  return useSyncExternalStore(langgananKertas, () => bacaKertasStiker(), () => 'A4' as KertasStiker)
}

/* ============================ dokumen cetak iframe =========================== */

/**
 * Warnet CSS halaman yang aktif (Tailwind dsb.) sehingga kelas-kelas pada markup
 * stiker tetap berlaku di dalam iframe. Sheet yang tak terbaca (lintas asal)
 * dilewati dengan aman.
 */
export function kumpulkanCssHalaman(): string {
  const bagian: string[] = []
  try {
    for (const sheet of Array.from(document.styleSheets)) {
      try {
        bagian.push(Array.from(sheet.cssRules).map((r) => r.cssText).join('\n'))
      } catch {
        // cross-origin — lewati
      }
    }
  } catch {
    // iframe tanpa dokumen induk — abaikan
  }
  return bagian.join('\n')
}

/**
 * Aturan cetak mandiri (di luar @media — dokumen iframe langsung dibaca media
 * print oleh dialog cetak). Slot lebar stiker mengikuti kertas:
 * A4 = 44 mm (±4 stiker/lembar), THERMAL = 36 mm mini.
 * Lembar kolektif: baris dibagi merata dari atas ke bawah (space-between) dan
 * setiap baris rata tengah — sisa 1–3 stiker pun tetap simetris di tengah.
 */
export function aturanCetakStiker(kertas: KertasStiker): string {
  const lebar = kertas === 'MINI' ? '28mm' : kertas === 'THERMAL' ? '36mm' : '44mm'
  const halaman =
    kertas === 'MINI'
      ? '@page { margin: 3mm; }'
      : kertas === 'THERMAL'
        ? '@page { margin: 5mm; }'
        : '@page { size: A4 portrait; margin: 10mm; }'
  return `
${halaman}
body, body * { visibility: visible !important; } /* sifat utama iframe: isi = hanya stiker */
body { margin: 0; background: #fff; color: #0f172a; }
.cetak-pusat { display: flex; justify-content: center; }
.stiker-printroot:not(.stiker-kolektif-grid) {
  width: ${lebar} !important; max-width: ${lebar} !important; min-width: 0 !important;
  box-sizing: border-box !important; overflow: hidden; break-inside: avoid;
}
.stiker-printroot svg, .stiker-printroot canvas { max-width: 100% !important; height: auto !important; }
.stiker-printroot:not(.stiker-kolektif-grid) * { line-height: 1.1 !important; }
.stiker-kolektif-grid {
  display: flex !important;
  flex-wrap: wrap !important;
  justify-content: center !important;      /* baris apa pun (termasuk sisa) rata tengah */
  align-content: space-between !important; /* baris dibagi merata dari atas ke bawah lembar */
  gap: 3mm !important;
  min-height: calc(100vh - 1mm) !important;
  max-height: none !important;
  overflow: visible !important;
  width: 100% !important;
  padding: 0 !important;
  border: 0 !important;
  background: #fff !important;
}
`
}

/**
 * Susun dokumen HTML cetak (PURE; diuji vitest): CSS halaman + aturan cetak
 * + markup stiker. Mode tunggal dibungkus .cetak-pusat agar terpusat kertas.
 */
export function bangunHtmlCetak(
  markupStiker: string,
  mode: StikerMode,
  kertas: KertasStiker,
  cssHalaman: string,
): string {
  const arena = mode === 'stiker' ? `<div class="cetak-pusat">${markupStiker}</div>` : markupStiker
  return `<!DOCTYPE html><html lang="id"><head><meta charset="utf-8"><title>Cetak Stiker</title>
<style>${cssHalaman}</style>
<style>${aturanCetakStiker(kertas)}</style>
</head><body>${arena}</body></html>`
}

/**
 * CORE CETAK: kloning elemen pratinjau → iframe tersembunyi → window.print().
 *markup seluruh dokumen DI luar iframe tidak ikut tercetak — hasil pratinjau
 * Chrome pasti hanya stiker, apa pun kondisi halaman/CSS/atribut body.
 */
export function cetakStikerDariElemen(ambilSumber: () => Element | null, mode: StikerMode, kertas: KertasStiker): boolean {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false
  const sumber = ambilSumber()
  if (!sumber) return false

  const klon = sumber.cloneNode(true) as HTMLElement
  // Buang gaya pratinjau dialog yang mesti direkonvensikan oleh aturan cetak
  klon.classList.remove('flex', 'flex-wrap', 'gap-2', 'max-h-[60vh]', 'overflow-auto', 'rounded-md', 'border', 'border-slate-100', 'bg-slate-50', 'p-2')
  klon.removeAttribute('style')

  const html = bangunHtmlCetak(klon.outerHTML, mode, kertas, kumpulkanCssHalaman())

  const iframe = document.createElement('iframe')
  iframe.setAttribute('aria-hidden', 'true')
  iframe.setAttribute('title', 'Cetak stiker')
  iframe.style.position = 'fixed'
  iframe.style.right = '0'
  iframe.style.bottom = '0'
  iframe.style.width = '1px'
  iframe.style.height = '1px'
  iframe.style.border = '0'
  iframe.style.opacity = '0'
  iframe.style.visibility = 'hidden'
  iframe.srcdoc = html

  const bersih = () => { try { iframe.remove() } catch { /* sudah terhapus */ } }
  iframe.addEventListener('load', () => {
    try {
      iframe.contentWindow?.addEventListener('afterprint', () => setTimeout(bersih, 400))
      iframe.contentWindow?.focus()
      iframe.contentWindow?.print()
    } catch {
      bersih()
    }
  })
  document.body.appendChild(iframe)
  // jaring pengaman bila load/print tak pernah jalan
  window.setTimeout(bersih, 120_000)
  return true
}

/** Tombol "Cetak Stiker" di dialog tunggal toko/unit — pratinjau tunggal. */
export function cetakStikerTunggal(kertas: KertasStiker): boolean {
  return cetakStikerDariElemen(
    () => document.querySelector('.stiker-dialog .stiker-printroot:not(.stiker-kolektif-grid)'),
    'stiker',
    kertas,
  )
}

/** Tombol "Cetak N Stiker" di dialog kolektif — semua stiker dalam 1 lembar. */
export function cetakStikerKolektif(kertas: KertasStiker): boolean {
  return cetakStikerDariElemen(() => document.querySelector('.stiker-kolektif-grid'), 'stiker-kolektif', kertas)
}

/**
 * Dipasang selama dialog stiker terbuka — jalur Ctrl+P manual (fallback):
 * - pasang mode body saat print mulai (beforeprint) dan lepas setelah selesai
 *   (afterprint) — CSS cetak halaman lalu hanya menampilkan stiker.
 * - timpa ukuran kertas @page sesuai setting kertas yang dipilih.
 * TomboL "Cetak" TIDAK memakai jalur ini (langsung iframe).
 */
export function useStickerPrint(active: boolean, mode: StikerMode = 'stiker', kertas: KertasStiker = 'A4') {
  useEffect(() => {
    if (!active) return
    const setStikerMode = (aktif: boolean) => {
      if (aktif) {
        document.body.setAttribute('data-print-mode', mode)
        document.body.setAttribute('data-kertas', kertas)
      } else {
        document.body.removeAttribute('data-print-mode')
        document.body.removeAttribute('data-kertas')
      }
    }
    const style = document.createElement('style')
    style.dataset.stikerPrint = 'page'
    style.textContent =
      kertas === 'MINI'
        ? '@media print { @page { size: auto; margin: 3mm; } }'
        : kertas === 'THERMAL'
          ? '@media print { @page { size: auto; margin: 5mm; } }'
          : '@media print { @page { size: A4 portrait; margin: 10mm; } }'
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
  }, [active, mode, kertas])
}
