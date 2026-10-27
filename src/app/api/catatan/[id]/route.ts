import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireActiveSession, requireManagerSession } from '@/lib/auth-server'
import { logAudit } from '@/lib/audit'

// PATCH /api/catatan/[id] — ubah catatan LAMA / balas catatan / sematkan (pin).
// HANYA SATU dari `aksi` per panggilan:
//  - { isi, judul?, untukRole? }              → EDIT (penulis sendiri, atau Admin/Manager)
//  - { aksi: 'BALAS', isi }                   → tambah balasan (semua role yang melihat)
//  - { aksi: 'PIN', pinned?: boolean }        → pin/buka pin (Admin Workshop/Manager)
// DELETE — hapus catatan (penulis sendiri, atau Admin/Manager).
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { session, denied } = await requireActiveSession(request)
    if (denied) return denied
    const meId = Number(session!.sub)
    const role = session!.role
    const isAdminFor = ['ADMIN_WORKSHOP', 'MANAGER'].includes(role)
    const aktor = session!.nama || role

    const { id } = await params
    const catatanId = Number(id)
    const existing = await db.catatan.findUnique({ where: { id: catatanId } })
    if (!existing) return NextResponse.json({ error: 'Catatan tidak ditemukan' }, { status: 404 })

    const body = (await request.json().catch(() => null)) as
      | { aksi?: string; isi?: string; judul?: string; untukRole?: string | null; pinned?: boolean }
      | null

    // ---- Pin / unpin (Admin Workshop/Manager) ----
    if (body?.aksi === 'PIN') {
      const guard = requireManagerSession(session)
      if (guard) return guard
      const pinned = body.pinned ?? !existing.pinned
      await db.catatan.update({ where: { id: catatanId }, data: { pinned } })
      await logAudit({
        aksi: pinned ? 'CATATAN_PIN' : 'CATATAN_UNPIN',
        entitas: 'catatan',
        entitasId: String(catatanId),
        deskripsi: `${pinned ? 'Catatan disematkan' : 'Sematan catatan dibuka'} — ${existing.judul ?? 'tanpa judul'}`,
        aktor,
      })
      return NextResponse.json({ ok: true })
    }

    // ---- Balasan (semua role yang bisa melihat catatan; penulis atau tujuan role) ----
    if (body?.aksi === 'BALAS') {
      const isi = (body.isi ?? '').trim()
      if (!isi) return NextResponse.json({ error: 'Balasan tidak boleh kosong' }, { status: 400 })
      if (isi.length > 2000) return NextResponse.json({ error: 'Balasan terlalu panjang (maks 2000 karakter)' }, { status: 400 })
      if (existing.untukRole && !existing.untukRole.split(',').map((r) => r.trim()).includes(role)) {
        return NextResponse.json({ error: 'Catatan ini bukan untuk role Anda' }, { status: 403 })
      }
      const balasan = await db.catatanBalasan.create({
        data: { catatanId, penulisId: meId, isi },
        include: { penulis: { select: { nama: true, role: true } } },
      })
      return NextResponse.json({ ok: true, balasan }, { status: 201 })
    }

    // ---- Edit isi/judul/untukRole (penulis sendiri atau Admin/Manager) ----
    const isi = (body?.isi ?? '').trim()
    if (!isi) return NextResponse.json({ error: 'Isi catatan wajib diisi' }, { status: 400 })
    if (isi.length > 5000) return NextResponse.json({ error: 'Isi catatan terlalu panjang (maks 5000 karakter)' }, { status: 400 })
    if (existing.penulisId !== meId && !isAdminFor) {
      return NextResponse.json({ error: 'Hanya penulis catatan (atau Admin Workshop/Manager) yang bisa mengubah' }, { status: 403 })
    }
    const updated = await db.catatan.update({
      where: { id: catatanId },
      data: {
        isi,
        judul: (body?.judul ?? '').trim() || null,
        untukRole: (body?.untukRole ?? '').trim() || null,
        editedAt: new Date(),
        editedBy: aktor,
      },
      include: { penulis: { select: { nama: true, role: true } }, balasan: { orderBy: { createdAt: 'asc' }, include: { penulis: { select: { nama: true, role: true } } } } },
    })
    await logAudit({
      aksi: 'CATATAN_UBAH',
      entitas: 'catatan',
      entitasId: String(catatanId),
      deskripsi: `Catatan diubah — ${updated.judul ?? 'tanpa judul'}`,
      aktor,
    })
    return NextResponse.json({ ok: true, catatan: updated })
  } catch (error) {
    console.error('Catatan PATCH error:', error)
    return NextResponse.json({ error: 'Gagal memperbarui catatan' }, { status: 500 })
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { session, denied } = await requireActiveSession(request)
    if (denied) return denied
    const meId = Number(session!.sub)
    const role = session!.role
    const isAdminFor = ['ADMIN_WORKSHOP', 'MANAGER'].includes(role)

    const { id } = await params
    const catatanId = Number(id)
    const existing = await db.catatan.findUnique({ where: { id: catatanId } })
    if (!existing) return NextResponse.json({ error: 'Catatan tidak ditemukan' }, { status: 404 })
    if (existing.penulisId !== meId && !isAdminFor) {
      return NextResponse.json({ error: 'Hanya penulis catatan (atau Admin Workshop/Manager) yang bisa menghapus' }, { status: 403 })
    }
    await db.catatan.delete({ where: { id: catatanId } })
    await logAudit({
      aksi: 'CATATAN_HAPUS',
      entitas: 'catatan',
      entitasId: String(catatanId),
      deskripsi: `Catatan dihapus — ${existing.judul ?? 'tanpa judul'}`,
      aktor: session!.nama || role,
    })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Catatan DELETE error:', error)
    return NextResponse.json({ error: 'Gagal menghapus catatan' }, { status: 500 })
  }
}
