/**
 * Ikon aplikasi AfterSales Pro
 * ----------------------------
 * SVG logo (rounded square emerald + monogram + kunci inggris) → PNG 512
 * → ICO (multi-size) untuk installer MSI/NSIS Windows.
 * Output: build/icon.png & build/icon.ico
 */

import sharp from 'sharp'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BUILD = path.join(ROOT, 'build')
fs.mkdirSync(BUILD, { recursive: true })

const svg = `
<svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0f172a"/>
      <stop offset="100%" stop-color="#064e3b"/>
    </linearGradient>
    <linearGradient id="acc" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#10b981"/>
      <stop offset="100%" stop-color="#14b8a6"/>
    </linearGradient>
  </defs>
  <rect x="16" y="16" width="480" height="480" rx="104" fill="url(#bg)"/>
  <rect x="16" y="16" width="480" height="480" rx="104" fill="none" stroke="url(#acc)" stroke-width="14" opacity="0.9"/>
  <!-- gearbox / roda gigi sederhana -->
  <g transform="translate(256,236)">
    <circle r="118" fill="none" stroke="url(#acc)" stroke-width="26"/>
    <g stroke="url(#acc)" stroke-width="30" stroke-linecap="round">
      <line x1="0" y1="-118" x2="0" y2="-152"/>
      <line x1="0" y1="118" x2="0" y2="152"/>
      <line x1="-118" y1="0" x2="-152" y2="0"/>
      <line x1="118" y1="0" x2="152" y2="0"/>
      <line x1="-83" y1="-83" x2="-107" y2="-107"/>
      <line x1="83" y1="83" x2="107" y2="107"/>
      <line x1="-83" y1="83" x2="-107" y2="107"/>
      <line x1="83" y1="-83" x2="107" y2="-107"/>
    </g>
    <circle r="46" fill="#f8fafc"/>
    <circle r="18" fill="#064e3b"/>
  </g>
  <text x="256" y="452" font-family="Arial, Helvetica, sans-serif" font-size="72" font-weight="800"
        fill="#f8fafc" text-anchor="middle" letter-spacing="6">AS PRO</text>
</svg>
`

const pngPath = path.join(BUILD, 'icon.png')
await sharp(Buffer.from(svg)).resize(512, 512).png().toFile(pngPath)
console.log('✓ build/icon.png dibuat')

// ICO multi-ukuran untuk MSI (png-to-ico kalau tersedia)
try {
  const pngToIco = (await import('png-to-ico')).default
  const sizes = [16, 24, 32, 48, 64, 128, 256]
  const images = await Promise.all(
    sizes.map((s) => sharp(pngPath).resize(s, s).png().toBuffer())
  )
  const ico = await pngToIco(images)
  fs.writeFileSync(path.join(BUILD, 'icon.ico'), ico)
  console.log('✓ build/icon.ico dibuat (16..256)')
} catch (e) {
  console.log('! png-to-ico tidak tersedia — electron-builder akan konversi PNG otomatis:', e.message)
}
