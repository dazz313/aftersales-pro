import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { autoGitBackup } from '@/lib/git-backup'

// PATCH /api/kunjungan/[id] - koreksi catatan / foto kunjungan
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await request.json()
    const existing = await db.kunjungan.findUnique({
      where: { id: Number(id) },
      include: { toko: { select: { kodeToko: true, namaToko: true } } },
    })
    if (!existing) {
      return NextResponse.json({ error: 'Kunjungan tidak ditemukan' }, { status: 404 })
    }
    const data: Record<string, unknown> = {}
    if (body.catatanStokRusak !== undefined) {
      data.catatanStokRusak = body.catatanStokRusak ? String(body.catatanStokRusak) : null
    }
    if (body.fotoOnsite !== undefined) {
      data.fotoOnsite = body.fotoOnsite ? String(body.fotoOnsite) : null
    }
    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: 'Tidak ada perubahan data' }, { status: 400 })
    }
    const kunjungan = await db.kunjungan.update({ where: { id: Number(id) }, data })
    await logAudit({
      aksi: 'UPDATE_KUNJUNGAN',
      entitas: 'kunjungan',
      entitasId: String(kunjungan.id),
      deskripsi: `Catatan kunjungan ${existing.toko.kodeToko} diperbarui: ${Object.keys(data).join(', ')}`,
      aktor: body.aktor,
    })
    await autoGitBackup('UPDATE', 'kunjungan', `#${kunjungan.id}`, body.aktor)
    return NextResponse.json(kunjungan)
  } catch (error) {
    console.error('Kunjungan PATCH error:', error)
    return NextResponse.json({ error: 'Gagal memperbarui kunjungan' }, { status: 500 })
  }
}
