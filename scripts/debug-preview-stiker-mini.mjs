import fs from 'node:fs'
import path from 'node:path'
import QRCode from 'qrcode'

/**
 * Pratinjau stiker unit MINI (28 mm) — memakai isi QR format baru:
 *   SN:<nomor seri>|MOD:<model>|TOK:<toko>|NAMA:<nama produk>
 * Dipakai untuk memastikan QR + 4 identifikasi masih terbaca saat dicetak mini.
 */

const cssPath = path.resolve('.next/static/chunks/0eho54tvqf1t3.css')
const css = fs.readFileSync(cssPath, 'utf8')

const contoh = {
  serialNumber: '2603128725B',
  modelUnit: 'RI-712GA(B)',
  nama: 'Kulkas 2 Pintu',
  pemilik: 'Toko Semeru Ahmad Yani',
}

const kodeQr = `SN:${contoh.serialNumber}|MOD:${contoh.modelUnit}|TOK:${contoh.pemilik}|NAMA:${contoh.nama}`
const qr = await QRCode.toString(kodeQr, {
  type: 'svg',
  width: 96,
  margin: 1,
  errorCorrectionLevel: 'M',
  color: { dark: '#0f172a', light: '#ffffff' },
})
const qrSvg = qr.replace('<svg ', '<svg class="block h-full w-full" ')
const modul = (qr.match(/viewBox="0 0 (\d+) /) ?? [])[1]

const sticker = `
<div class="stiker-printroot mx-auto w-full max-w-[150px] overflow-hidden rounded-md border border-slate-900 bg-white text-center">
  <div class="flex items-center justify-between bg-slate-900 px-1 py-px">
    <span class="text-[5.5px] font-bold uppercase tracking-widest text-white">Unit Asset</span>
    <span class="text-[5.5px] font-bold uppercase text-emerald-300">GARANSI</span>
  </div>
  <div class="mx-auto mt-0.5 h-20 w-20">${qrSvg}</div>
  <div class="space-y-px px-1 pb-1 pt-0.5 text-left leading-tight">
    <p class="line-clamp-2 text-[8px] font-extrabold leading-[1.1] text-slate-900">${contoh.nama}</p>
    <p class="truncate text-[6.5px] text-slate-500">Model <span class="font-semibold text-slate-800">${contoh.modelUnit}</span></p>
    <p class="truncate font-mono text-[6.5px] text-slate-500">Tag ID <span class="font-bold text-slate-900">${contoh.serialNumber}</span></p>
    <p class="line-clamp-2 text-[6.5px] leading-[1.1] text-slate-500">Pemilik <span class="font-semibold text-slate-800">${contoh.pemilik}</span></p>
  </div>
</div>`

const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${css}</style>
<style>
  html, body { background: #e2e8f0; margin: 0; padding: 12px; }
  .skala { width: 28mm; }
  .label { font: 11px system-ui; color: #334155; margin-bottom: 4px; }
</style></head>
<body>
  <div class="label">MINI 28 mm (skala 1:1) — QR ${modul} modul</div>
  <div class="skala">${sticker}</div>
  <div class="label" style="margin-top:12px">A4 44 mm (skala 1:1)</div>
  <div style="width:44mm">${sticker}</div>
  <div class="label" style="margin-top:12px">Isi QR (${kodeQr.length} karakter)</div>
  <code style="font: 10px monospace; word-break: break-all">${kodeQr}</code>
</body></html>`

const out = path.join(process.env.TEMP ?? '.', 'stiker-mini-preview.html')
fs.writeFileSync(out, html)
console.log(out)
console.log('isi QR:', kodeQr)
console.log('modul QR:', modul)
