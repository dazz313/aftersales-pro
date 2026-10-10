import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'

// PATCH /api/toko/[id] - update toko (termasuk check-in visit manual)
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await request.json()
    const data: Record<string, unknown> = {}
    if (body.namaToko !== undefined) data.namaToko = body.namaToko
    if (body.alamat !== undefined) data.alamat = body.alamat
    if (body.kontak !== undefined) data.kontak = body.kontak
    if (body.frekuensiVisit !== undefined) data.frekuensiVisit = Number(body.frekuensiVisit)
    if (body.tglVisitTerakhir !== undefined) data.tglVisitTerakhir = new Date(body.tglVisitTerakhir)

    const toko = await db.masterToko.update({ where: { id: Number(id) }, data })
    await logAudit({
      aksi: 'UPDATE_MASTER_TOKO',
      entitas: 'master_toko',
      entitasId: toko.kodeToko,
      deskripsi: `Data toko diperbarui: ${Object.keys(data).join(', ')}`,
      aktor: body.aktor,
    })
    return NextResponse.json(toko)
  } catch (error) {
    console.error('Toko PATCH error:', error)
    return NextResponse.json({ error: 'Gagal memperbarui toko' }, { status: 500 })
  }
}

// DELETE /api/toko/[id]
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const tokoId = Number(id)
    const unitCount = await db.unitAsset.count({ where: { tokoId } })
    if (unitCount > 0) {
      return NextResponse.json(
        { error: `Tidak dapat menghapus: masih ada ${unitCount} unit terdaftar di toko ini` },
        { status: 409 }
      )
    }
    const toko = await db.masterToko.delete({ where: { id: tokoId } })
    await logAudit({
      aksi: 'DELETE_MASTER_TOKO',
      entitas: 'master_toko',
      entitasId: toko.kodeToko,
      deskripsi: `Toko dihapus: ${toko.namaToko}`,
    })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Toko DELETE error:', error)
    return NextResponse.json({ error: 'Gagal menghapus toko' }, { status: 500 })
  }
}
