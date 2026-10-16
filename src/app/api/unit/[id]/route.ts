import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { autoGitBackup } from '@/lib/git-backup'
import { requireActiveSession } from '@/lib/auth-server'

// PATCH /api/unit/[id] - koreksi data unit (termasuk nomor seri,
// selama belum dipakai di tiket service & tidak duplikat unit lain)
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { session, denied } = await requireActiveSession(request)
    if (denied) return denied
    void session
    const { id } = await params
    const body = await request.json()
    const existing = await db.unitAsset.findUnique({ where: { id: Number(id) } })
    if (!existing) {
      return NextResponse.json({ error: 'Unit tidak ditemukan' }, { status: 404 })
    }
    const data: Record<string, unknown> = {}
    if (body.serialNumber !== undefined) {
      const serial = String(body.serialNumber ?? '').trim().toUpperCase()
      if (!serial) {
        return NextResponse.json({ error: 'Nomor seri tidak boleh kosong' }, { status: 400 })
      }
      if (serial !== existing.serialNumber) {
        const dupe = await db.unitAsset.findUnique({ where: { serialNumber: serial } })
        if (dupe) {
          return NextResponse.json({ error: `Nomor seri ${serial} sudah dipakai oleh unit ${dupe.modelUnit}` }, { status: 409 })
        }
        const dipakai = await db.serviceRequest.findFirst({
          where: { unitAssetId: existing.id },
          select: { noTiket: true },
        })
        if (dipakai) {
          return NextResponse.json(
            { error: `Nomor seri terkunci: unit ini sudah punya tiket ${dipakai.noTiket} — riwayat service & barcode harus utuh sehingga nomor seri tidak dapat diubah.` },
            { status: 409 }
          )
        }
        data.serialNumber = serial
      }
    }
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
      data.statusGaransi = body.statusGaransi === 'NON_GARANSI' ? 'NON_GARANSI' : body.statusGaransi === 'STOK_TOKO' ? 'STOK_TOKO' : 'GARANSI'
    }
    if (body.tglPembelian !== undefined) {
      data.tglPembelian = body.tglPembelian ? new Date(body.tglPembelian) : null
    }
    // Koreksi tanggal input registrasi (backdate susulan / salah tanggal)
    if (body.tglInput !== undefined && body.tglInput !== null && body.tglInput !== '') {
      const parsed = new Date(body.tglInput)
      const batas = new Date()
      batas.setDate(batas.getDate() + 1)
      batas.setHours(23, 59, 59, 999)
      if (Number.isNaN(parsed.getTime()) || parsed > batas) {
        return NextResponse.json({ error: 'Tanggal input tidak valid atau melebihi batas' }, { status: 400 })
      }
      data.createdAt = parsed
    }
    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: 'Tidak ada perubahan data' }, { status: 400 })
    }
    const unit = await db.unitAsset.update({ where: { id: Number(id) }, data })
    await logAudit({
      aksi: 'UPDATE_UNIT_ASSET',
      entitas: 'unit_asset',
      entitasId: unit.serialNumber,
      deskripsi: `Data unit diperbarui: ${Object.keys(data).join(', ')}${data.serialNumber ? ` (${existing.serialNumber} → ${data.serialNumber})` : ` (${unit.serialNumber})`}`,
      aktor: body.aktor,
    })
    await autoGitBackup('UPDATE', 'unit_asset', unit.serialNumber, body.aktor)
    return NextResponse.json(unit)
  } catch (error) {
    console.error('Unit PATCH error:', error)
    return NextResponse.json({ error: 'Gagal memperbarui unit' }, { status: 500 })
  }
}

// DELETE /api/unit/[id] - hapus unit registrasi (mengakomodir kesalahan input).
// Terkunci bila unit sudah punya tiket service — riwayat & klaim harus utuh.
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { session, denied } = await requireActiveSession(request)
    if (denied) return denied
    void session
    const { id } = await params
    const existing = await db.unitAsset.findUnique({
      where: { id: Number(id) },
      include: { serviceRequests: { select: { noTiket: true } } },
    })
    if (!existing) {
      return NextResponse.json({ error: 'Unit tidak ditemukan' }, { status: 404 })
    }
    if (existing.serviceRequests.length > 0) {
      const noList = existing.serviceRequests.map((t) => t.noTiket).join(', ')
      return NextResponse.json(
        { error: `Unit ${existing.serialNumber} terkunci: sudah punya tiket ${noList} — riwayat service & klaim produsen harus utuh sehingga tidak dapat dihapus.` },
        { status: 409 }
      )
    }
    let body: { aktor?: string } = {}
    try {
      body = await request.json()
    } catch {
      body = {}
    }
    await db.unitAsset.delete({ where: { id: Number(id) } })
    await logAudit({
      aksi: 'DELETE_UNIT_ASSET',
      entitas: 'unit_asset',
      entitasId: existing.serialNumber,
      deskripsi: `Unit dihapus dari registrasi (koreksi kesalahan input): ${existing.serialNumber} — ${existing.modelUnit}`,
      aktor: body.aktor,
    })
    await autoGitBackup('DELETE', 'unit_asset', existing.serialNumber, body.aktor)
    return NextResponse.json({ ok: true, serialNumber: existing.serialNumber })
  } catch (error) {
    console.error('Unit DELETE error:', error)
    return NextResponse.json({ error: 'Gagal menghapus unit' }, { status: 500 })
  }
}
