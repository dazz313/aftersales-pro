import fs from 'node:fs'
import path from 'node:path'
import QRCode from 'qrcode'

const cssPath = path.resolve('.next/static/chunks/3vh-anbpg0ihi.css')
const css = fs.readFileSync(cssPath, 'utf8')
const qr = await QRCode.toString('2603128725B', { type: 'svg', width: 72, margin: 1, color: { dark: '#0f172a', light: '#ffffff' } })
const qrSvg = qr.replace('<svg ', '<svg class="block h-full w-full" ')

const sticker = `
<div class="stiker-printroot mx-auto w-full max-w-[150px] overflow-hidden rounded-md border border-slate-900 bg-white text-center">
  <div class="flex items-center justify-between bg-slate-900 px-1 py-px">
    <span class="text-[5.5px] font-bold uppercase tracking-widest text-white">Unit Asset</span>
    <span class="text-[5.5px] font-bold uppercase text-emerald-300">GARANSI</span>
  </div>
  <div class="mx-auto mt-0.5 h-16 w-16">${qrSvg}</div>
  <div class="space-y-px px-1 pb-1 pt-0.5 text-left leading-tight">
    <p class="line-clamp-2 text-[8px] font-extrabold leading-[1.1] text-slate-900">RI-712GA(B)</p>
    <p class="truncate text-[6.5px] text-slate-500">Model <span class="font-semibold text-slate-800">RI-712GA(B)</span></p>
    <p class="truncate font-mono text-[6.5px] text-slate-500">SN <span class="font-bold text-slate-900">2603128725B</span></p>
    <p class="line-clamp-2 text-[6.5px] leading-[1.1] text-slate-500">Pemilik <span class="font-semibold text-slate-800">Toko Semeru Ahmad Yani</span></p>
  </div>
</div>`

const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${css}</style>
<style>
  html, body { background: #e2e8f0; margin: 0; padding: 12px; }
  .skala { width: 28mm; }
  .label { font: 11px system-ui; color: #334155; margin-bottom: 4px; }
</style></head>
<body>
  <div class="label">MINI 28 mm (skala 1:1)</div>
  <div class="skala">${sticker}</div>
  <div class="label" style="margin-top:12px">A4 44 mm (skala 1:1)</div>
  <div style="width:44mm">${sticker}</div>
</body></html>`

const out = path.join(process.env.TEMP ?? '.', 'stiker-mini-preview.html')
fs.writeFileSync(out, html)
console.log(out)
