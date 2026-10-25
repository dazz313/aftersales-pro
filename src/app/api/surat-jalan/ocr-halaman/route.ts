import { NextResponse } from 'next/server'
import { requireActiveSession } from '@/lib/auth-server'
import { ocrImage } from '@/lib/vision'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// POST /api/surat-jalan/ocr-halaman (FormData: file = satu halaman raster PDF)
// Pendukung PDF hasil scan: klien (browser) meraster halaman surat jalan via
// pdfjs → mengirim tabel JPEG per halaman ke sini → OCR tesseract (infra
// vision.ts yang sudah ada) → teks kembali ke klien untuk digabung & dipost
// kembali ke /api/surat-jalan/match pada mode `teks`. TIDAK menulis database.
export async function POST(request: Request) {
  const { denied } = await requireActiveSession(request)
  if (denied) return denied
  try {
    const form = await request.formData()
    const file = form.get('file')
    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json({ error: 'Halaman raster tidak terbaca' }, { status: 400 })
    }
    if (file.size > 8 * 1024 * 1024) {
      return NextResponse.json({ error: 'Ukuran halaman maksimal 8 MB' }, { status: 400 })
    }
    const mime = file.type || ''
    if (!mime.startsWith('image/')) {
      return NextResponse.json({ error: 'Halaman raster wajib bertipe gambar (JPEG/PNG)' }, { status: 400 })
    }
    const buffer = Buffer.from(await file.arrayBuffer())
    const ocr = await ocrImage(buffer)
    if (!ocr.text || !ocr.text.replace(/\s/g, '')) {
      return NextResponse.json({ error: 'Halaman ini tidak berisi teks yang terbaca (OCR kosong)' }, { status: 400 })
    }
    return NextResponse.json({ teks: ocr.text, confidence: ocr.confidence })
  } catch (error) {
    console.error('Surat jalan OCR halaman error:', error)
    return NextResponse.json({ error: 'Gagal OCR halaman raster' }, { status: 500 })
  }
}
