import { NextResponse } from 'next/server'
import { mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { autoGitBackup } from '@/lib/git-backup'
import { getSession } from '@/lib/auth'

const LOGO_DIR = ['upload', 'logo']
const MAX_FILE_BYTES = 2 * 1024 * 1024
const ALLOWED_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
}

async function logoPath(): Promise<string | null> {
  try {
    const dir = join(process.cwd(), ...LOGO_DIR)
    const files = await readdir(dir)
    const hit = files.find((f) => f.startsWith('logo.'))
    return hit ? join(dir, hit) : null
  } catch {
    return null
  }
}

/** GET /api/logo — logo perusahaan (404 bila belum diunggah; client fallback ke ikon). */
export async function GET() {
  try {
    const file = await logoPath()
    if (!file) {
      return NextResponse.json({ error: 'Logo belum diunggah' }, { status: 404 })
    }
    const dot = file.lastIndexOf('.')
    const buf = await readFile(file)
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        'Content-Type': ALLOWED_EXT[file.slice(dot).toLowerCase()] ?? 'application/octet-stream',
        'Cache-Control': 'private, max-age=3600',
      },
    })
  } catch {
    return NextResponse.json({ error: 'Logo tidak ditemukan' }, { status: 404 })
  }
}

/** POST /api/logo (FormData: file PNG/JPG/WebP/GIF ≤ 2MB) — hanya Admin/Manager. */
export async function POST(request: Request) {
  try {
    const session = await getSession(request)
    if (!session || !['ADMIN_WORKSHOP', 'MANAGER'].includes(session.role)) {
      return NextResponse.json({ error: 'Akses ditolak: hanya Admin Workshop/Manager' }, { status: 403 })
    }
    const form = await request.formData()
    const file = form.get('file')
    if (!(file instanceof Blob)) {
      return NextResponse.json({ error: 'File logo wajib diunggah' }, { status: 400 })
    }
    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json({ error: 'Ukuran logo maksimal 2 MB' }, { status: 400 })
    }
    const origName = (file as Blob & { name?: string }).name ?? 'logo.png'
    const dot = origName.lastIndexOf('.')
    const ext = (dot >= 0 ? origName.slice(dot) : '.png').toLowerCase()
    if (!ALLOWED_EXT[ext]) {
      return NextResponse.json({ error: 'Format harus PNG, JPG, WebP, atau GIF' }, { status: 400 })
    }
    const dir = join(process.cwd(), ...LOGO_DIR)
    await mkdir(dir, { recursive: true })
    // Hapus logo lama bila ekstensi berbeda
    try {
      for (const f of await readdir(dir)) {
        if (f.startsWith('logo.') && f !== `logo${ext}`) await unlink(join(dir, f))
      }
    } catch {
      /* abaikan */
    }
    await writeFile(join(dir, `logo${ext}`), Buffer.from(await file.arrayBuffer()))
    await db.pengaturan.upsert({
      where: { kunci: 'logo_perusahaan' },
      update: { nilai: '/api/logo' },
      create: { kunci: 'logo_perusahaan', nilai: '/api/logo' },
    })
    await logAudit({
      aksi: 'UPLOAD_LOGO',
      entitas: 'pengaturan',
      entitasId: 'logo_perusahaan',
      deskripsi: `Logo perusahaan diperbarui (${origName}, ${(file.size / 1024).toFixed(0)} KB)`,
      aktor: session.nama,
    })
    await autoGitBackup('UPDATE', 'logo_perusahaan', '', session.nama)
    return NextResponse.json({ ok: true, url: '/api/logo' })
  } catch (error) {
    console.error('Logo upload error:', error)
    return NextResponse.json({ error: 'Gagal mengunggah logo' }, { status: 500 })
  }
}
