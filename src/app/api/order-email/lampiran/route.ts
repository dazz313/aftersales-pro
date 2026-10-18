import { NextResponse } from 'next/server'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, basename, extname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { getActiveSession } from '@/lib/auth-server'

const MAKS = 10 * 1024 * 1024 // 10 MB
const EKSTENSI_OK = ['.pdf', '.jpg', '.jpeg', '.png', '.webp']

// POST /api/order-email/lampiran (FormData: file, serviceRequestId) — UPLOAD LAMPIRAN
// untuk tiket REQUEST EMAIL (mis. PDF Detail Unit). File disimpan di
// upload/lampiran-email/ dan dicatat di tiket (lampiranEmail) untuk dilampirkan
// saat aksi "Kirim Email". Mengunggah ulang menimpa lampiran tiket (yang lama
// tetap sebagai arsip file).
export async function POST(request: Request) {
  try {
    const session = await getActiveSession(request)
    if (!session) {
      return NextResponse.json({ error: 'Sesi berakhir atau akun nonaktif. Silakan login ulang.' }, { status: 401 })
    }

    const form = await request.formData()
    const file = form.get('file')
    const sid = Number(form.get('serviceRequestId'))
    if (!Number.isFinite(sid) || sid <= 0) {
      return NextResponse.json({ error: 'Tiket tidak valid' }, { status: 400 })
    }
    if (!(file instanceof Blob)) {
      return NextResponse.json({ error: 'File wajib diisi' }, { status: 400 })
    }
    if (file.size > MAKS) {
      return NextResponse.json({ error: 'Ukuran file maksimal 10 MB' }, { status: 400 })
    }

    const tiket = await db.serviceRequest.findUnique({ where: { id: sid } })
    if (!tiket || tiket.status !== 'REQUEST_EMAIL') {
      return NextResponse.json({ error: 'Tiket tidak ditemukan / bukan tiket REQUEST EMAIL' }, { status: 404 })
    }

    const namaAsli = (file as Blob & { name?: string }).name ?? 'lampiran.pdf'
    const ext = extname(namaAsli).toLowerCase()
    if (!EKSTENSI_OK.includes(ext)) {
      return NextResponse.json({ error: `Format tidak didukung (${EKSTENSI_OK.join(', ')})` }, { status: 400 })
    }

    const dir = join(process.cwd(), 'upload', 'lampiran-email')
    await mkdir(dir, { recursive: true })
    const safeStem = basename(namaAsli, ext).replace(/[^\w.-]+/g, '-').slice(0, 40) || 'lampiran'
    const fileName = `lampiran-${tiket.noTiket.replace(/[^\w-]+/g, '-')}-${safeStem.slice(0, 24)}-${randomUUID().slice(0, 8)}${ext}`
    await writeFile(join(dir, fileName), Buffer.from(await file.arrayBuffer()))

    const updated = await db.serviceRequest.update({
      where: { id: sid },
      data: { lampiranEmail: fileName },
    })

    await logAudit({
      aksi: 'UPLOAD_LAMPIRAN',
      entitas: 'service_request',
      entitasId: tiket.noTiket,
      deskripsi: `Lampiran ${fileName} diunggah untuk tiket REQUEST EMAIL ${tiket.noTiket} (${(file.size / 1024).toFixed(0)} KB)`,
      aktor: session.nama,
    })

    return NextResponse.json({ ok: true, lampiranEmail: updated.lampiranEmail, noTiket: tiket.noTiket })
  } catch (error) {
    console.error('Lampiran upload error:', error)
    return NextResponse.json({ error: 'Gagal mengunggah lampiran' }, { status: 500 })
  }
}
