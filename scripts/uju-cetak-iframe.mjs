/**
 * Replika dokumen cetak iframe (persis jalur bangunHtmlCetak): CSS build asli +
 * aturan dari aturanCetakStiker() (diekstrak langsung dari src agar tak
 * menyimpang) + markup stiker unit dummy. Screenshot headless:
 * kolektif (A4) & tunggal.
 */
import fs from 'node:fs'

const ns = fs.readFileSync('src/lib/sticker-print.ts', 'utf8')
const kx = ns.indexOf('export function aturanCetakStiker')
const mulai = ns.indexOf('`', kx) + 1
const akhir = ns.indexOf('`', mulai)
let aturan = ns.slice(mulai, akhir)
// ganti placeholder template: kertas = 'A4' (default juga untuk varian thermal diuji terpisah)
const b = (kertas) => aturan
  .replace('${halaman}', kertas === 'THERMAL' ? '@page { margin: 5mm; }' : '@page { size: A4 portrait; margin: 10mm; }')
  .replaceAll('${lebar}', kertas === 'THERMAL' ? '36mm' : '44mm')

const cssBuild = fs.readFileSync('.next/static/chunks/31vtrlvudlfok.css', 'utf8')

function stikerUnit(kode, nama, i) {
  return `
  <div class="stiker-printroot rounded-md border border-slate-200 bg-white overflow-hidden">
    <div class="flex items-center justify-between bg-slate-900 px-1.5 py-0.5">
      <span class="text-[7px] font-bold uppercase tracking-widest text-white">Unit Asset Sticker</span>
    </div>
    <div class="px-1.5 pt-1 text-center">
      <svg width="160" height="34" xmlns="http://www.w3.org/2000/svg">
        ${Array.from({ length: 26 }).map((_, j) => `<rect x="${2 + j * 6}" y="0" width="${j % 4 === 0 ? 2 : 4}" height="24" fill="#0f172a"/>`).join('')}
        <text x="80" y="33" font-size="9" font-family="monospace" text-anchor="middle" fill="#0f172a">${kode}</text>
      </svg>
      <p class="text-[8px] text-slate-500">No. Seri</p>
    </div>
    <div class="border-t border-slate-100 px-1.5 py-1 text-left">
      <p class="text-[9px] font-bold text-slate-900">${nama} ${i}</p>
      <p class="text-[7px] text-slate-500">Terpasang dari Toko</p>
      <p class="text-[7px] text-slate-500">Tipe: PV 330 WDT</p>
    </div>
    <div class="flex items-center justify-between border-t border-slate-900/10 bg-slate-50 px-1.5 py-0.5">
      <span class="rounded-full bg-emerald-600 px-1.5 py-0.5 text-[7px] font-bold text-white">(SCAN ${kode.slice(-4)})</span>
      <span class="text-[6.5px] text-slate-400">Type 10268</span>
    </div>
  </div>`
}

const konkretoleting = Array.from({ length: 6 })
  .map((_, i) => stikerUnit(`809019${String(3120 + i).slice(-4)}`, 'KULKAS 1 PINTU SANYO', i))
  .join('')

const kolektif = `<!DOCTYPE html><html lang="id"><head><meta charset="utf-8"><title>Cetak Stiker</title>
<style>${cssBuild}</style>
<style>${b('A4')}</style>
</head><body>
<div class="stiker-kolektif-grid stiker-printroot">${konkretoleting}
</div></body></html>`

const tunggal = `<!DOCTYPE html><html lang="id"><head><meta charset="utf-8"><title>Cetak Stiker</title>
<style>${cssBuild}</style>
<style>${b('THERMAL')}</style>
</head><body>
<div class="cetak-pusat">${stikerUnit('8090193120', 'KULKAS 1 PINTU SANYO', 9)}</div></body></html>`

const arah = 'C:/Users/eraco/AppData/Local/Temp/opencode'
fs.writeFileSync(`${arah}/uji-iframe-kolektif.html`, kolektif)
fs.writeFileSync(`${arah}/uji-iframe-tunggal.html`, tunggal)
console.log('OK — 2 dokumen replika iframe siap')
