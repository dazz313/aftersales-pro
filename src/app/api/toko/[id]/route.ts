import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { autoGitBackup } from '@/lib/git-backup'
import { requireActiveSession, requireManagerSession } from '@/lib/auth-server'

// PATCH /api/toko/[id] - update toko (termasuk check-in visit manual)
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { session, denied } = await requireActiveSession(request)
    if (denied) return denied
    const { id } = await params
    const body = await request.json()
    // Koordinat toko (set/reset pin peta) = aksi administratif: dibatasi
    // Admin Workshop/Manager, selaras dengan gate UI `bisaSetPin` pada dialog
    // peta. Field lain (nama/alamat/kontak/siklus/aktif) tetap terbuka untuk
    // semua role operasional seperti sebelumnya.
    if (body.latitude !== undefined || body.longitude !== undefined) {
      const roleDenied = requireManagerSession(session)
      if (roleDenied) return roleDenied
    }
    const data: Record<string, unknown> = {}
    if (body.namaToko !== undefined) data.namaToko = body.namaToko
    if (body.alamat !== undefined) data.alamat = body.alamat
    if (body.kontak !== undefined) data.kontak = body.kontak
    if (body.frekuensiVisit !== undefined) data.frekuensiVisit = Number(body.frekuensiVisit)
    // Centang "Tidak aktif" (false = toko berhenti/tutup, dikucilkan dari siklus visit)
    if (body.aktif !== undefined) data.aktif = Boolean(body.aktif)
    // Mode siklus kunjungan: REGULER (otomatis) | BY_REQUEST (hanya saat toko request)
    if (body.modeSiklus !== undefined) {
      if (!['REGULER', 'BY_REQUEST'].includes(body.modeSiklus)) {
        return NextResponse.json({ error: 'modeSiklus tidak valid (REGULER | BY_REQUEST)' }, { status: 400 })
      }
      data.modeSiklus = body.modeSiklus
    }
    if (body.jarakKm !== undefined) data.jarakKm = body.jarakKm === null || body.jarakKm === '' ? null : Math.max(0, Number(body.jarakKm) || 0)
    if (body.tglVisitTerakhir !== undefined) data.tglVisitTerakhir = new Date(body.tglVisitTerakhir)
    // Koordinat posisi toko (peta Field Ops): null = hapus posisi, validasi rentang WGS-84.
    if (body.latitude !== undefined || body.longitude !== undefined) {
      const lat = body.latitude === null ? null : Number(body.latitude)
      const lng = body.longitude === null ? null : Number(body.longitude)
      const valid = (n: number | null, min: number, max: number) => n === null || (Number.isFinite(n) && n >= min && n <= max)
      if (!valid(lat, -90, 90) || !valid(lng, -180, 180)) {
        return NextResponse.json({ error: 'Koordinat tidak valid (latitude -90..90, longitude -180..180)' }, { status: 400 })
      }
      data.latitude = lat
      data.longitude = lng
    }

    // Barcode toko (yang terbaca saat scan) — boleh diubah; harus unik.
    if (body.barcodeToko !== undefined) {
      const bc = String(body.barcodeToko ?? '').trim()
      if (!bc) {
        return NextResponse.json({ error: 'Barcode toko tidak boleh kosong' }, { status: 400 })
      }
      const exists = await db.masterToko.findFirst({ where: { barcodeToko: bc, NOT: { id: Number(id) } } })
      if (exists) {
        return NextResponse.json({ error: `Barcode "${bc}" sudah dipakai toko lain` }, { status: 409 })
      }
      data.barcodeToko = bc
    }

    const toko = await db.masterToko.update({ where: { id: Number(id) }, data })
    await logAudit({
      aksi: data.latitude !== undefined && data.longitude !== undefined ? 'SETPIN_MASTER_TOKO' : 'UPDATE_MASTER_TOKO',
      entitas: 'master_toko',
      entitasId: toko.kodeToko,
      deskripsi:
        data.latitude !== undefined && data.longitude !== undefined
          ? data.latitude === null && data.longitude === null
            ? 'Koordinat posisi toko dihapus (reset)'
            : `Koordinat toko diperbarui: ${toko.latitude}, ${toko.longitude}`
          : `Data toko diperbarui: ${Object.keys(data).join(', ')}`,
      aktor: body.aktor,
    })
    await autoGitBackup('UPDATE', 'master_toko', toko.kodeToko, body.aktor)
    return NextResponse.json(toko)
  } catch (error) {
    console.error('Toko PATCH error:', error)
    return NextResponse.json({ error: 'Gagal memperbarui toko' }, { status: 500 })
  }
}

// DELETE /api/toko/[id] - hanya Admin/Manager
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { session, denied } = await requireActiveSession(request)
    if (denied) return denied
    const roleDenied = requireManagerSession(session)
    if (roleDenied) return roleDenied
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
    await autoGitBackup('DELETE', 'master_toko', toko.kodeToko)
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Toko DELETE error:', error)
    return NextResponse.json({ error: 'Gagal menghapus toko' }, { status: 500 })
  }
}
