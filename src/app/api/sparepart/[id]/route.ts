import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'

// PATCH /api/sparepart/[id] - update / restock sparepart
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await request.json()
    const existing = await db.masterSparepart.findUnique({ where: { id: Number(id) } })
    if (!existing) {
      return NextResponse.json({ error: 'Sparepart tidak ditemukan' }, { status: 404 })
    }

    const data: Record<string, unknown> = {}
    if (body.namaPart !== undefined) data.namaPart = body.namaPart
    if (body.reorderLimit !== undefined) data.reorderLimit = Number(body.reorderLimit)
    if (body.hargaKlaim !== undefined) data.hargaKlaim = Number(body.hargaKlaim)

    // Restock: tambah stok (kiriman dari produsen)
    if (body.tambahStok !== undefined) {
      data.stokKonsinyasi = existing.stokKonsinyasi + Number(body.tambahStok)
    } else if (body.stokKonsinyasi !== undefined) {
      data.stokKonsinyasi = Number(body.stokKonsinyasi)
    }

    const part = await db.masterSparepart.update({ where: { id: Number(id) }, data })
    await logAudit({
      aksi: body.tambahStok ? 'RESTOCK_SPAREPART' : 'UPDATE_MASTER_SPAREPART',
      entitas: 'master_sparepart',
      entitasId: part.kodePart,
      deskripsi: body.tambahStok
        ? `Restock +${body.tambahStok} ${part.namaPart} (stok kini ${part.stokKonsinyasi})`
        : `Data sparepart diperbarui: ${Object.keys(data).join(', ')}`,
      aktor: body.aktor,
    })
    return NextResponse.json(part)
  } catch (error) {
    console.error('Sparepart PATCH error:', error)
    return NextResponse.json({ error: 'Gagal memperbarui sparepart' }, { status: 500 })
  }
}

// DELETE /api/sparepart/[id]
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const used = await db.serviceRequestPart.count({ where: { sparepartId: Number(id) } })
    if (used > 0) {
      return NextResponse.json(
        { error: `Tidak dapat menghapus: sparepart sudah dipakai di ${used} tiket service` },
        { status: 409 }
      )
    }
    const part = await db.masterSparepart.delete({ where: { id: Number(id) } })
    await logAudit({
      aksi: 'DELETE_MASTER_SPAREPART',
      entitas: 'master_sparepart',
      entitasId: part.kodePart,
      deskripsi: `Sparepart dihapus: ${part.namaPart}`,
    })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Sparepart DELETE error:', error)
    return NextResponse.json({ error: 'Gagal menghapus sparepart' }, { status: 500 })
  }
}
