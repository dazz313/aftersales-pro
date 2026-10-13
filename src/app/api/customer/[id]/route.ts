import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { autoGitBackup } from '@/lib/git-backup'
import { requireActiveSession, requireManagerSession } from '@/lib/auth-server'

// PATCH /api/customer/[id] - update data customer (nama, no WA, alamat)
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { session, denied } = await requireActiveSession(request)
    if (denied) return denied
    void session
    const { id } = await params
    const body = await request.json()
    const existing = await db.masterCustomer.findUnique({ where: { id: Number(id) } })
    if (!existing) {
      return NextResponse.json({ error: 'Customer tidak ditemukan' }, { status: 404 })
    }
    const data: Record<string, unknown> = {}
    if (body.nama !== undefined) {
      const nama = String(body.nama ?? '').trim()
      if (!nama) {
        return NextResponse.json({ error: 'Nama customer wajib diisi' }, { status: 400 })
      }
      data.nama = nama
    }
    if (body.noWa !== undefined) data.noWa = body.noWa ? String(body.noWa) : null
    if (body.alamat !== undefined) data.alamat = body.alamat ? String(body.alamat) : null

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: 'Tidak ada perubahan data' }, { status: 400 })
    }
    const customer = await db.masterCustomer.update({ where: { id: Number(id) }, data })
    await logAudit({
      aksi: 'UPDATE_MASTER_CUSTOMER',
      entitas: 'master_customer',
      entitasId: String(customer.id),
      deskripsi: `Data customer diperbarui: ${Object.keys(data).join(', ')} (${customer.nama})`,
      aktor: body.aktor,
    })
    await autoGitBackup('UPDATE', 'master_customer', customer.nama, body.aktor)
    return NextResponse.json(customer)
  } catch (error) {
    console.error('Customer PATCH error:', error)
    return NextResponse.json({ error: 'Gagal memperbarui customer' }, { status: 500 })
  }
}

// DELETE /api/customer/[id] - hanya Admin/Manager
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { session, denied } = await requireActiveSession(request)
    if (denied) return denied
    const roleDenied = requireManagerSession(session)
    if (roleDenied) return roleDenied
    const { id } = await params
    const customerId = Number(id)
    const unitCount = await db.unitAsset.count({ where: { customerId } })
    if (unitCount > 0) {
      return NextResponse.json(
        { error: `Tidak dapat menghapus: masih ada ${unitCount} unit milik customer ini` },
        { status: 409 }
      )
    }
    const customer = await db.masterCustomer.delete({ where: { id: customerId } })
    await logAudit({
      aksi: 'DELETE_MASTER_CUSTOMER',
      entitas: 'master_customer',
      entitasId: String(customer.id),
      deskripsi: `Customer dihapus: ${customer.nama}`,
    })
    await autoGitBackup('DELETE', 'master_customer', customer.nama)
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Customer DELETE error:', error)
    return NextResponse.json({ error: 'Gagal menghapus customer' }, { status: 500 })
  }
}
