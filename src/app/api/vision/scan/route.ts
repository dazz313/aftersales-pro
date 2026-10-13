import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { autoGitBackup } from '@/lib/git-backup'
import { requireActiveSession } from '@/lib/auth-server'
import { saveInboxFile, isImageName, MAX_FILE_BYTES, type InboxKind } from '@/lib/telegram-files'
import { scanImage } from '@/lib/vision'

// POST /api/vision/scan (FormData: file, pengirim, caption, folder=KUNJUNGAN|SERVICE) — butuh login
export async function POST(request: Request) {
  try {
    const { session, denied } = await requireActiveSession(request)
    if (denied) return denied
    void session
    const form = await request.formData()
    const file = form.get('file')
    const pengirim = String(form.get('pengirim') ?? 'UPLOAD-UI')
    const caption = String(form.get('caption') ?? '')
    const kind: InboxKind = String(form.get('folder') ?? '').toUpperCase() === 'KUNJUNGAN' ? 'KUNJUNGAN' : 'SERVICE'
    if (!(file instanceof Blob)) return NextResponse.json({ error: 'File wajib diisi.' }, { status: 400 })
    if (file.size > MAX_FILE_BYTES) return NextResponse.json({ error: 'File maksimal 10 MB.' }, { status: 400 })
    const origName = (file as Blob & { name?: string }).name ?? 'upload.jpg'
    const dot = origName.lastIndexOf('.')
    const buffer = Buffer.from(await file.arrayBuffer())
    const { fileName, filePathRel } = await saveInboxFile(buffer, dot >= 0 ? origName.slice(dot) : '.jpg', kind, 'up')

    let status = 'OK', barcode: string | null = null, format: string | null = null, ocrText = '', conf: number | null = null
    if (isImageName(fileName)) {
      const hasil = await scanImage(buffer)
      barcode = hasil.barcode; format = hasil.barcodeFormat; ocrText = hasil.ocrText; conf = hasil.ocrConfidence
      if (!barcode && !ocrText) status = 'GAGAL_BACA'
    } else {
      status = 'FILE_NON_GAMBAR'
    }

    const scan = await db.visionScan.create({
      data: { sumber: 'UPLOAD', pengirim, fileName, filePath: filePathRel, mime: file.type || null, caption: caption || null, barcode, barcodeFormat: format, ocrText: ocrText || null, ocrConfidence: conf, status },
    })
    await db.inboxItem.create({
      data: { pengirim, fileName, filePath: filePathRel, mime: file.type || null, folder: kind, caption: caption || null, barcode, barcodeFormat: format, ocrText: ocrText || null, ocrConfidence: conf, status: 'PENDING' },
    })
    await db.waMessage.create({
      data: { pengirim, channel: 'TELEGRAM', tipe: 'IN', pesan: caption || `(upload: ${fileName})`, meta: JSON.stringify({ foto: filePathRel, folder: kind, barcode, sumber: 'UPLOAD' }) },
    })
    await autoGitBackup('CREATE', 'vision_scan', fileName, pengirim)
    return NextResponse.json({ ok: true, scan })
  } catch (error) {
    console.error('Vision scan error:', error)
    return NextResponse.json({ error: 'Gagal memproses gambar' }, { status: 500 })
  }
}

export async function GET() {
  const scans = await db.visionScan.findMany({ orderBy: { createdAt: 'desc' }, take: 50 })
  return NextResponse.json(scans)
}
