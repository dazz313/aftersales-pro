/**
 * Unduh data bahasa Tesseract (eng + ind) ke cache repo (.cache/tesseract).
 *
 * kenapa perlu:
 *  • Tesseract mengunduh traineddata (~30 MB) saat OCR pertama — tanpa cache
 *    lokal, scan pertama timeout dan butuh internet.
 *  • Cache di folder repo (bukan %TEMP%) → tidak dihapus Windows, tetap ada
 *    setelah restart, dan dipakai offline.
 *
 * Pemakaian: node scripts/fetch-tessdata.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..')
const DIR = path.join(ROOT, '.cache', 'tesseract')
const BASE = 'https://tessdata.projectnaptha.com/4.0.0'

fs.mkdirSync(DIR, { recursive: true })

for (const lang of ['eng', 'ind']) {
  const target = path.join(DIR, `${lang}.traineddata`)
  if (fs.existsSync(target) && fs.statSync(target).size > 1_000_000) {
    console.log(`✓ ${lang} sudah ada (${(fs.statSync(target).size / 1048576).toFixed(1)} MB)`)
    continue
  }
  process.stdout.write(`… unduh ${lang} … `)
  const res = await fetch(`${BASE}/${lang}.traineddata.gz`)
  if (!res.ok) throw new Error(`${lang}: HTTP ${res.status}`)
  const out = zlib.gunzipSync(Buffer.from(await res.arrayBuffer()))
  fs.writeFileSync(target, out)
  console.log(`✓ ${lang} (${(out.length / 1048576).toFixed(1)} MB) → ${target}`)
}
console.log('✓ Cache data bahasa Tesseract siap')
