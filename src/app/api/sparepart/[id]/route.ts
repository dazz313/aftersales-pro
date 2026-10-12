import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { backupSparepartToGit } from '@/lib/git-backup'

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
    if (body.brandKompatibel !== undefined) data.brandKompatibel = String(body.brandKompatibel ?? '').trim()
    if (body.supplier !== undefined) data.supplier = String(body.supplier ?? '').trim()
    if (body.reorderLimit !== undefined) data.reorderLimit = Number(body.reorderLimit)
    if (body.hargaKlaim !== undefined) data.hargaKlaim = Number(body.hargaKlaim)

    // Stok baru (set langsung) → total selalu = jual + garansi
    const jualSet = body.stokJual !== undefined && body.stokJual !== null && body.stokJual !== ''
    const garansiSet = body.stokGaransi !== undefined && body.stokGaransi !== null && body.stokGaransi !== ''
    if (jualSet || garansiSet) {
      const stokJual = jualSet ? Math.max(0, Math.trunc(Number(body.stokJual))) : existing.stokJual
      const stokGaransi = garansiSet ? Math.max(0, Math.trunc(Number(body.stokGaransi))) : existing.stokGaransi
      data.stokJual = stokJual
      data.stokGaransi = stokGaransi
      data.stokInventory = stokJual + stokGaransi
    }

    // Restock: kiriman dari produsen — default masuk stok BISA JUAL,
    // tambahStokGaransi (opsional) masuk stok GARANSI. Total ikut bertambah.
    // Bila digabung dengan set stok langsung di atas, restock menumpuk di atasnya.
    if (body.tambahStok !== undefined || body.tambahStokGaransi !== undefined) {
      const tambahJual = Math.trunc(Number(body.tambahStok) || 0)
      const tambahGaransi = Math.trunc(Number(body.tambahStokGaransi) || 0)
      const baseJual = data.stokJual !== undefined ? (data.stokJual as number) : existing.stokJual
      const baseGaransi = data.stokGaransi !== undefined ? (data.stokGaransi as number) : existing.stokGaransi
      data.stokJual = Math.max(0, baseJual + tambahJual)
      data.stokGaransi = Math.max(0, baseGaransi + tambahGaransi)
      data.stokInventory = (data.stokJual as number) + (data.stokGaransi as number)
    } else if (body.stokInventory !== undefined && !jualSet && !garansiSet) {
      // Kompatibel legacy: bila hanya total dikirim, selisihnya masuk/keluar stok jual
      const total = Math.max(0, Math.trunc(Number(body.stokInventory)))
      data.stokInventory = total
      data.stokJual = Math.max(0, total - existing.stokGaransi)
    }

    const part = await db.masterSparepart.update({ where: { id: Number(id) }, data })
    const isRestock = body.tambahStok !== undefined || body.tambahStokGaransi !== undefined
    await logAudit({
      aksi: isRestock ? 'RESTOCK_SPAREPART' : 'UPDATE_MASTER_SPAREPART',
      entitas: 'master_sparepart',
      entitasId: part.kodePart,
      deskripsi: isRestock
        ? `Restock +${Number(body.tambahStok) || 0} jual / +${Number(body.tambahStokGaransi) || 0} garansi ${part.namaPart} (jual ${part.stokJual}, garansi ${part.stokGaransi}, total ${part.stokInventory})`
        : `Data sparepart diperbarui: ${Object.keys(data).join(', ')}`,
      aktor: body.aktor,
    })
    await backupSparepartToGit(isRestock ? 'RESTOCK' : 'UPDATE', part.kodePart, body.aktor)
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
    await backupSparepartToGit('DELETE', part.kodePart)
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Sparepart DELETE error:', error)
    return NextResponse.json({ error: 'Gagal menghapus sparepart' }, { status: 500 })
  }
}
