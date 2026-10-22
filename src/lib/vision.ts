import {
  RGBLuminanceSource, BinaryBitmap, HybridBinarizer,
  MultiFormatReader, DecodeHintType, BarcodeFormat,
} from '@zxing/library'
import { createWorker } from 'tesseract.js'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import jpeg from 'jpeg-js'
import { PNG } from 'pngjs'
import { TESSDATA_DIR } from '@/lib/paths'

/**
 * Vision (barcode + OCR) TANPA dependensi native.
 * sharp sengaja tidak dipakai: biner prebuilt-nya crash (SIGILL) di CPU lama
 * tanpa AVX (mis. AMD E1). Decoder murni-JS: JPEG via jpeg-js, PNG via pngjs.
 */

export interface ScanResult {
  barcode: string | null
  barcodeFormat: string | null
  ocrText: string
  ocrConfidence: number | null
}

const MAX_DIM = 1280 // samakan dengan resolusi maksimum foto Telegram

function isJpeg(b: Buffer): boolean {
  return b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff
}

function isPng(b: Buffer): boolean {
  return (
    b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
    b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a
  )
}

interface RawRGBA {
  data: Buffer
  width: number
  height: number
}

function decodePixels(buffer: Buffer): RawRGBA | null {
  try {
    if (isJpeg(buffer)) {
      const d = jpeg.decode(buffer, { maxMemoryUsageInMB: 512 })
      return { data: Buffer.from(d.data), width: d.width, height: d.height }
    }
    if (isPng(buffer)) {
      const d = PNG.sync.read(buffer)
      return { data: Buffer.from(d.data), width: d.width, height: d.height }
    }
    return null
  } catch {
    return null
  }
}

/** Grayscale + downscale area-average ke MAX_DIM (cepat bila sudah ≤1280px). */
function toLuminance(raw: RawRGBA): { luma: Uint8ClampedArray; width: number; height: number } {
  const { data, width: w0, height: h0 } = raw
  const scale = Math.min(1, MAX_DIM / Math.max(w0, h0))
  const width = Math.max(1, Math.round(w0 * scale))
  const height = Math.max(1, Math.round(h0 * scale))
  const luma = new Uint8ClampedArray(width * height)
  if (scale === 1) {
    for (let i = 0; i < width * height; i++) {
      luma[i] = (0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]) | 0
    }
    return { luma, width, height }
  }
  const xRatio = w0 / width
  const yRatio = h0 / height
  for (let y = 0; y < height; y++) {
    const y0 = Math.floor(y * yRatio)
    const y1 = Math.min(h0, Math.ceil((y + 1) * yRatio))
    for (let x = 0; x < width; x++) {
      const x0 = Math.floor(x * xRatio)
      const x1 = Math.min(w0, Math.ceil((x + 1) * xRatio))
      let r = 0
      let g = 0
      let b = 0
      let n = 0
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const i = (sy * w0 + sx) * 4
          r += data[i]
          g += data[i + 1]
          b += data[i + 2]
          n++
        }
      }
      luma[y * width + x] = ((0.299 * r + 0.587 * g + 0.114 * b) / n) | 0
    }
  }
  return { luma, width, height }
}

/** Decode barcode/QR dari gambar. Return null bila tidak ada barcode terbaca. */
export async function decodeBarcode(buffer: Buffer): Promise<{ text: string; format: string } | null> {
  try {
    const raw = decodePixels(buffer)
    if (!raw) return null
    const { luma, width, height } = toLuminance(raw)
    const hints = new Map()
    hints.set(DecodeHintType.POSSIBLE_FORMATS, [
      BarcodeFormat.QR_CODE, BarcodeFormat.CODE_128, BarcodeFormat.CODE_39,
      BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A,
      BarcodeFormat.UPC_E, BarcodeFormat.ITF, BarcodeFormat.DATA_MATRIX,
      BarcodeFormat.AZTEC, BarcodeFormat.PDF_417,
    ])
    hints.set(DecodeHintType.TRY_HARDER, true)
    const source = new RGBLuminanceSource(luma, width, height)
    const bitmap = new BinaryBitmap(new HybridBinarizer(source))
    const reader = new MultiFormatReader()
    reader.setHints(hints)
    const result = reader.decode(bitmap)
    const text = result.getText()?.trim()
    if (!text) return null
    return { text, format: String(result.getBarcodeFormat()) }
  } catch (e) {
    if (process.env.VISION_DEBUG) console.error('[vision-debug] decode gagal:', (e as Error)?.constructor?.name, (e as Error)?.message)
    return null // NotFoundException dsb. = tidak ada barcode
  }
}

/**
 * Path worker Tesseract.
 *
 * MASALAH: tesseract.js menghitung workerPath dari `__dirname` modulnya
 * (`path.join(__dirname, '..', '..', 'worker-script', 'node', 'index.js')`).
 * Di build standalone Next.js, __dirname diganti placeholder "/ROOT" →
 * runtime menjadi "C:\ROOT\node_modules\tesseract.js\..." → MODULE_NOT_FOUND
 * (OCR selalu gagal di produksi). Jadi workerPath dihitung sendiri saat
 * runtime, dari lokasi file yang benar-benar ada di disk.
 */
function workerPathTesseract(): string | undefined {
  const suffix = join('node_modules', 'tesseract.js', 'src', 'worker-script', 'node', 'index.js')
  const kandidat: string[] = []
  try {
    const req = createRequire(join(process.cwd(), 'noop.js'))
    kandidat.push(req.resolve('tesseract.js/src/worker-script/node/index.js'))
  } catch {
    /* abaikan — lanjut kandidat manual */
  }
  kandidat.push(join(process.cwd(), suffix))
  kandidat.push(join(process.cwd(), '..', suffix))
  kandidat.push(join(process.cwd(), '..', '..', suffix))
  for (const p of kandidat) {
    try {
      if (existsSync(p)) return p
    } catch {
      /* abaikan */
    }
  }
  return undefined
}

/** OCR tulisan dalam foto (Indonesia + Inggris). Gagal → string kosong. */
export async function ocrImage(buffer: Buffer, timeoutMs = 120_000): Promise<{ text: string; confidence: number | null }> {
  try {
    const run = async (langs: string) => {
      const opts: Record<string, unknown> = {
        // Cache bahasa (traineddata) di folder repo — bukan %TEMP% yang bisa
        // dihapus Windows; dipakai offline & tidak perlu unduh ulang.
        cachePath: TESSDATA_DIR,
      }
      const wp = workerPathTesseract()
      if (wp) opts.workerPath = wp
      try {
        const { mkdir } = await import('node:fs/promises')
        await mkdir(/*turbopackIgnore: true*/ TESSDATA_DIR, { recursive: true })
      } catch {
        /* abaikan */
      }
      const worker = await createWorker(langs, undefined, opts as never)
      try {
        const { data } = await worker.recognize(buffer)
        return { text: (data.text ?? '').trim(), confidence: typeof data.confidence === 'number' ? data.confidence : null }
      } finally {
        await worker.terminate().catch(() => undefined)
      }
    }
    const withTimeout = <T,>(p: Promise<T>): Promise<T> =>
      Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error('OCR timeout')), timeoutMs))])
    try {
      return await withTimeout(run('ind+eng'))
    } catch {
      return await withTimeout(run('eng')) // fallback bila model 'ind' gagal diunduh
    }
  } catch (e) {
    console.error('OCR gagal:', (e as Error).message)
    return { text: '', confidence: null }
  }
}

/** Gabungan: barcode dulu (cepat), lalu OCR. */
export async function scanImage(buffer: Buffer): Promise<ScanResult> {
  const [bar, ocr] = await Promise.all([decodeBarcode(buffer), ocrImage(buffer)])
  return {
    barcode: bar?.text ?? null,
    barcodeFormat: bar?.format ?? null,
    ocrText: ocr.text,
    ocrConfidence: ocr.confidence,
  }
}
