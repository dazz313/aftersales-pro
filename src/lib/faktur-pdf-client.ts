/**
 * ===== Raster PDF (sisi klien) untuk PDF hasil scan =====
 *
 * Tesseract (server) tidak menerima langsung PDF — oleh karena itu, bila
 * server melaporkan PDF_HASIL_SCAN (tanpa lapisan teks), KLIEN merender
 * halaman ke canvas (pdfjs-dist, worker statis di /pdfjs/) → kirim JPEG ke
 * /api/surat-jalan/ocr-halaman → gabungkan seluruh teks → hasil kembali ke
 * /api/surat-jalan/match pada mode `teks`.
 */
import { authHeaders } from '@/lib/api'

/** Ekstrak semua halaman (maks 12) → teks gabungan hasil OCR. */
export async function rasterDariPdf(
  file: File,
  jumlahHalaman: number,
  onProgres?: (halamanSelesai: number, total: number) => void
): Promise<string> {
  const pdfjs = await import('pdfjs-dist')
  // Worker statis — disalin sekali ke public/pdfjs/ agar bekerja offline
  // (web maupun Electron desktop) tanpa CDN.
  pdfjs.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.min.mjs'
  const data = await file.arrayBuffer()
  const doc = await pdfjs.getDocument({ data }).promise
  const total = Math.max(1, Math.min(doc.numPages || jumlahHalaman || 1, 12))
  let gabung = ''
  for (let n = 1; n <= total; n++) {
    const page = await doc.getPage(n)
    // Skala 2.4 — OCR tesseract butuh teks cukup besar; 1.0 = 72dpi terlalu
    // kasar untuk kode part kecil, 2.4 (~173dpi) seimbang antara ketajaman
    // dan kecepatan OCR per halaman.
    const viewport = page.getViewport({ scale: 2.4 })
    const canvas = document.createElement('canvas')
    canvas.width = Math.floor(viewport.width)
    canvas.height = Math.floor(viewport.height)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Browser tidak dapat menyiapkan kanvas raster (ctx kosong)')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    await page.render({ canvasContext: ctx, viewport }).promise
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.92))
    canvas.remove()
    const halamanSelesai = n
    if (blob) {
      const fd = new FormData()
      fd.append('file', blob, `faktur-hal-${halamanSelesai}.jpg`)
      const res = await fetch('/api/surat-jalan/ocr-halaman', { method: 'POST', headers: authHeaders(), body: fd })
      const j = (await res.json().catch(() => ({}))) as { teks?: string; error?: string }
      if (!res.ok) throw new Error(`OCR halaman ${halamanSelesai} gagal: ${j.error || res.status}`)
      if (j.teks && j.teks.replace(/\s/g, '')) gabung += (gabung ? '\n' : '') + j.teks
    }
    onProgres?.(halamanSelesai, total)
  }
  if (!gabung.replace(/\s/g, '')) {
    throw new Error('Seluruh halaman PDF gagal terbaca (OCR kosong) — coba foto faktur langsung sebagai JPG/PNG, atau ketik ulang ke templat Excel.')
  }
  return gabung
}
