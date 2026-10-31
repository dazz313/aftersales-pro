/**
 * Replica uji cetak stiker kolektif di kertas A4 — HTML statis yang memakai
 * CSS build asli (.next/static/chunks/*.css) + aturan baru (inline override),
 * lalu dirender Chrome headless ke PDF A4 (Page: A4, margin mengikuti @page).
 * Kontrollonso: posisi terpusat, tidak terpotong, kolom rapat.
 */
import fs from 'node:fs'

const baseCss = fs.readFileSync('.next/static/chunks/2wu0eo9up3ln-.css', 'utf8')

// Aturan baru (identik dgn src/app/globals.css terbaru — versi build masih lama)
const baru = `
@media print {
  body[data-print-mode^='stiker'] .stiker-printroot,
  body[data-print-mode^='stiker'] .stiker-printroot * { visibility: visible !important; }
  body[data-print-mode^='stiker'] [data-slot='dialog-content'].stiker-dialog {
    position: fixed !important; top: 0 !important; left: 50% !important;
    translate: none !important; transform: translateX(-50%) !important;
    width: auto !important; max-width: none !important; margin: 0 !important;
    border: 0 !important; padding: 0 !important; background: transparent !important; box-shadow: none !important;
  }
  body[data-print-mode='stiker-kolektif'] [data-slot='dialog-content'].stiker-dialog { width: 100% !important; }
  body[data-print-mode='stiker-kolektif'] .stiker-kolektif-grid {
    display: grid !important;
    grid-template-columns: repeat(auto-fill, 44mm) !important;
    grid-auto-rows: 1fr !important;
    align-items: center !important;
    min-height: calc(100vh - 1mm) !important;
    justify-content: center !important; align-content: flex-start !important;
    gap: 3mm !important; max-height: none !important; overflow: visible !important;
    padding: 0 !important; border: 0 !important; background: #fff !important;
  }
  body[data-print-mode='stiker-kolektif'][data-kertas='THERMAL'] .stiker-kolektif-grid {
    grid-template-columns: repeat(auto-fill, 36mm) !important;
  }
  body[data-print-mode^='stiker'] .stiker-printroot:not(.stiker-kolektif-grid) {
    width: 36mm !important; max-width: 36mm !important; min-width: 0 !important;
    padding: 1mm !important; box-sizing: border-box !important; overflow: hidden !important; break-inside: avoid;
  }
  body[data-print-mode^='stiker'] .stiker-printroot svg,
  body[data-print-mode^='stiker'] .stiker-printroot canvas { max-width: 100% !important; height: auto !important; }
  body[data-print-mode^='stiker'] .stiker-printroot:not(.stiker-kolektif-grid) * { line-height: 1.1 !important; }
  body[data-print-mode^='stiker'][data-kertas='A4'] .stiker-printroot:not(.stiker-kolektif-grid) {
    width: 44mm !important; max-width: 44mm !important;
  }
}
@media print { @page { size: A4 portrait; margin: 10mm; } }
@media print { body[data-print-mode='stiker-kolektif'] .stiker-dialog > *:not(.stiker-printroot) { display: none !important; } }
`

function stiker(kode, nama, i) {
  return `
  <div class="stiker-printroot" style="background:#fff;border:2px solid #0f172a;border-radius:8px;overflow:hidden">
    <div style="background:#16a34a;color:#fff;display:flex;justify-content:space-between;align-items:center;padding:2px 6px">
      <span style="font-size:7px;font-weight:800;letter-spacing:.15em">BARCODE KUNJUNGAN</span>
      <span style="font-size:7px;font-weight:800;background:rgba(255,255,255,.2);border-radius:999px;padding:1px 5px">Visit 14h</span>
    </div>
    <div style="text-align:center;padding:4px 6px">
      <p style="font-size:11px;font-weight:800;color:#0f172a">TOKO ${nama} ${i}</p>
      <p style="font-size:8px;color:#64748b;font-family:monospace">${kode}</p>
      <p style="font-size:8px;color:#64748b">Jl. Contoh Alamat No. ${i}</p>
    </div>
    <div style="border-top:1px solid #cbd5e1;display:flex;justify-content:center;padding:3px 4px 0">
      <svg width="170" height="40" xmlns="http://www.w3.org/2000/svg">
        ${Array.from({ length: 24 }).map((_, j) => `<rect x="${4 + j * 7}" y="0" width="${j % 3 === 0 ? 3 : 5}" height="28" fill="#0f172a"/>`).join('')}
        <text x="85" y="39" font-size="10" font-family="monospace" text-anchor="middle" fill="#0f172a">${kode}</text>
      </svg>
    </div>
    <div style="border-top:1px solid #cbd5e1;background:#f8fafc;display:flex;justify-content:space-between;align-items:center;padding:2px 6px">
      <span style="font-size:8px;font-weight:700;color:#0f172a;font-family:monospace">${kode}</span>
      <span style="font-size:7px;color:#64748b">Scan → check-in</span>
    </div>
  </div>`
}

const html = `<!DOCTYPE html>
<html lang="id"><head><meta charset="utf-8"><title>Uji Cetak Kolektif A4</title>
<style>${baseCss}</style><style>${baru}</style></head>
<body data-print-mode="stiker-kolektif" data-kertas="A4">
  <div data-slot="dialog-content" class="stiker-dialog" style="position:fixed;top:0;left:50%;transform:translateX(-50%);width:100%">
    <div class="stiker-kolektif-grid stiker-printroot" style="display:none" id="grid">
      ${Array.from({ length: 8 }).map((_, i) => stiker(`BC-DKV${String(i + 1).padStart(4, '0')}`, 'Dummy', i)).join('')}
    </div>
  </div>
</body></html>`

fs.writeFileSync('C:/Users/eraco/AppData/Local/Temp/opencode/uji-kolektif.html', html)
console.log('HTML siap:', html.length, 'karakter')
