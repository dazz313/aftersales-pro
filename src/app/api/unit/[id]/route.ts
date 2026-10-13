import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { autoGitBackup } from '@/lib/git-backup'

// PATCH /api/unit/[id] - koreksi data unit (serial tidak dapat diubah)
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await request.json()
    const existing = await db.unitAsset.findUnique({ where: { id: Number(id) } })
    if (!existing) {
      return NextResponse.json({ error: 'Unit tidak ditemukan' }, { status: 404 })
    }
    const data: Record<string, unknown> = {}
    if (body.modelUnit !== undefined) {
      const model = String(body.modelUnit ?? '').trim()
      if (!model) {
        return NextResponse.json({ error: 'Model/tipe unit wajib diisi' }, { status: 400 })
      }
      data.modelUnit = model
    }
    if (body.merk !== undefined) data.merk = String(body.merk ?? '').trim()
    if (body.nama !== undefined) data.nama = String(body.nama ?? '').trim()
    if (body.tokoId !== undefined) {
      const tokoId = body.tokoId ? Number(body.tokoId) : null
      if (tokoId && !(await db.masterToko.findUnique({ where: { id: tokoId } }))) {
        return NextResponse.json({ error: 'Toko tidak ditemukan' }, { status: 404 })
      }
      data.tokoId = tokoId
    }
    if (body.customerId !== undefined) {
      const customerId = body.customerId ? Number(body.customerId) : null
      if (customerId && !(await db.masterCustomer.findUnique({ where: { id: customerId } }))) {
        return NextResponse.json({ error: 'Customer tidak ditemukan' }, { status: 404 })
      }
      data.customerId = customerId
    }
    if (body.statusGaransi !== undefined) {
      data.statusGaransi = body.statusGaransi === 'NON_GARANSI' ? 'NON_GARANSI' : 'GARANSI'
    }
    if (body.tglPembelian !== undefined) {
      data.tglPembelian = body.tglPembelian ? new Date(body.tglPembelian) : null
    }
    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: 'Tidak ada perubahan data' }, { status: 400 })
    }
    const unit = await db.unitAsset.update({ where: { id: Number(id) }, data })
    await logAudit({
      aksi: 'UPDATE_UNIT_ASSET',
      entitas: 'unit_asset',
      entitasId: unit.serialNumber,
      deskripsi: `Data unit diperbarui: ${Object.keys(data).join(', ')} (${unit.serialNumber})`,
      aktor: body.aktor,
    })
    await autoGitBackup('UPDATE', 'unit_asset', unit.serialNumber, body.aktor)
    return NextResponse.json(unit)
  } catch (error) {
    console.error('Unit PATCH error:', error)
    return NextResponse.json({ error: 'Gagal memperbarui unit' }, { status: 500 })
  }
}
