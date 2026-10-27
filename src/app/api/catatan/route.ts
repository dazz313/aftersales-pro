import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireActiveSession } from '@/lib/auth-server'
import { logAudit } from '@/lib/audit'

// GET /api/catatan — daftar catatan (notes) yang terlihat oleh sesi aktif:
//  - untukRole null → semua role
//  - untukRole "TEKNISI,MANAGER" → hanya bila role sesi ada di daftar
// Balasan ikut (penulis + role), terurut terbaru dulu; di-ascending saat render.
export async function GET(request: Request) {
  try {
    const { session, denied } = await requireActiveSession(request)
    if (denied) return denied
    const role = session!.role

    const semua = await db.catatan.findMany({
      where: { OR: [{ untukRole: null }, { untukRole: { contains: role } }] },
      orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }],
      include: {
        penulis: { select: { nama: true, role: true } },
        balasan: { orderBy: { createdAt: 'asc' }, include: { penulis: { select: { nama: true, role: true } } } },
      },
    })
    // `contains` agar multivalue "TEKNISI,MANAGER" lolos — filter teliti di klien ini
    const items = semua.filter((c) => !c.untukRole || c.untukRole.split(',').map((r) => r.trim()).includes(role))
    return NextResponse.json({ items })
  } catch (error) {
    console.error('Catatan GET error:', error)
    return NextResponse.json({ error: 'Gagal memuat catatan' }, { status: 500 })
  }
}

// POST /api/catatan — buat catatan baru (semua role boleh menulis — komunikasi antar akun).
// Body: { judul?: string, isi: string, untukRole?: string|null }
export async function POST(request: Request) {
  try {
    const { session, denied } = await requireActiveSession(request)
    if (denied) return denied
    const meId = Number(session!.sub)
    const role = session!.role

    const body = (await request.json().catch(() => null)) as { judul?: string; isi?: string; untukRole?: string | null } | null
    const isi = (body?.isi ?? '').trim()
    if (!isi) return NextResponse.json({ error: 'Isi catatan wajib diisi' }, { status: 400 })
    if (isi.length > 5000) return NextResponse.json({ error: 'Isi catatan terlalu panjang (maks 5000 karakter)' }, { status: 400 })
    const judul = (body?.judul ?? '').trim() || null
    const untukRole = (body?.untukRole ?? '').trim() || null

    const catatan = await db.catatan.create({
      data: { judul, isi, untukRole, penulisId: meId },
      include: { penulis: { select: { nama: true, role: true } }, balasan: true },
    })
    await logAudit({
      aksi: 'CATATAN_BARU',
      entitas: 'catatan',
      entitasId: String(catatan.id),
      deskripsi: `Catatan${judul ? ` "${judul}"` : ''} dibuat${untukRole ? ` — untuk role ${untukRole}` : ''}`,
      aktor: session!.nama || role,
    })
    return NextResponse.json({ ok: true, catatan }, { status: 201 })
  } catch (error) {
    console.error('Catatan POST error:', error)
    return NextResponse.json({ error: 'Gagal membuat catatan' }, { status: 500 })
  }
}
