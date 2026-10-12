import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { autoGitBackup, backupSparepartToGit } from '@/lib/git-backup'

// PATCH /api/order/[id] - transisi status order customer
// Aksi: TERUSKAN (ke produsen) | DATANG (part tiba → stok+) | SELESAI (diserahkan) | BATAL
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await request.json()
    const existing = await db.permintaanOrder.findUnique({ where: { id: Number(id) } })
    if (!existing) {
      return NextResponse.json({ error: 'Order tidak ditemukan' }, { status: 404 })
    }
    const aksi = body.aksi as string
    const aktor = body.aktor ?? 'ADMIN'

    if (aksi === 'TERUSKAN') {
      if (existing.status !== 'BARU') {
        return NextResponse.json({ error: 'Hanya order BARU yang dapat diteruskan' }, { status: 409 })
      }
      const updated = await db.permintaanOrder.update({
        where: { id: existing.id },
        data: { status: 'DITERUSKAN' },
        include: {
          toko: { select: { id: true, kodeToko: true, namaToko: true } },
          customer: { select: { id: true, nama: true } },
        },
      })
      await logAudit({
        aksi: 'ORDER_DITERUSKAN',
        entitas: 'permintaan_order',
        entitasId: existing.noOrder,
        deskripsi: `Order ${existing.noOrder} diteruskan ke produsen/supplier (${existing.kodePart} ×${existing.qty})`,
        aktor,
      })
      await autoGitBackup('TERUSKAN', 'permintaan_order', existing.noOrder, aktor)
      return NextResponse.json(updated)
    }

    if (aksi === 'DATANG') {
      if (existing.status !== 'DITERUSKAN' && existing.status !== 'BARU') {
        return NextResponse.json({ error: 'Hanya order DITERUSKAN/BARU yang dapat ditandai datang' }, { status: 409 })
      }
      // Part tiba → masuk stok BISA JUAL (stok titipan bertambah)
      if (existing.sparepartId) {
        await db.masterSparepart.update({
          where: { id: existing.sparepartId },
          data: { stokJual: { increment: existing.qty }, stokInventory: { increment: existing.qty } },
        })
        await backupSparepartToGit('RESTOCK_ORDER', existing.kodePart, aktor)
      }
      const updated = await db.permintaanOrder.update({
        where: { id: existing.id },
        data: { status: 'DATANG' },
        include: {
          toko: { select: { id: true, kodeToko: true, namaToko: true } },
          customer: { select: { id: true, nama: true } },
        },
      })
      await logAudit({
        aksi: 'ORDER_DATANG',
        entitas: 'permintaan_order',
        entitasId: existing.noOrder,
        deskripsi: `Part order ${existing.noOrder} tiba (${existing.kodePart} ×${existing.qty}) — stok inventory bertambah`,
        aktor,
      })
      await autoGitBackup('DATANG', 'permintaan_order', existing.noOrder, aktor)
      return NextResponse.json(updated)
    }

    if (aksi === 'SELESAI') {
      if (existing.status !== 'DATANG') {
        return NextResponse.json({ error: 'Hanya order DATANG yang dapat diselesaikan' }, { status: 409 })
      }
      const updated = await db.permintaanOrder.update({
        where: { id: existing.id },
        data: { status: 'SELESAI', tglSelesai: new Date() },
        include: {
          toko: { select: { id: true, kodeToko: true, namaToko: true } },
          customer: { select: { id: true, nama: true } },
        },
      })
      await logAudit({
        aksi: 'ORDER_SELESAI',
        entitas: 'permintaan_order',
        entitasId: existing.noOrder,
        deskripsi: `Order ${existing.noOrder} selesai — part diserahkan ke ${existing.namaPemesan}`,
        aktor,
      })
      await autoGitBackup('SELESAI', 'permintaan_order', existing.noOrder, aktor)
      return NextResponse.json(updated)
    }

    if (aksi === 'BATAL') {
      if (existing.status === 'SELESAI' || existing.status === 'BATAL') {
        return NextResponse.json({ error: `Order sudah ${existing.status}` }, { status: 409 })
      }
      const updated = await db.permintaanOrder.update({
        where: { id: existing.id },
        data: { status: 'BATAL' },
        include: {
          toko: { select: { id: true, kodeToko: true, namaToko: true } },
          customer: { select: { id: true, nama: true } },
        },
      })
      await logAudit({
        aksi: 'ORDER_BATAL',
        entitas: 'permintaan_order',
        entitasId: existing.noOrder,
        deskripsi: `Order ${existing.noOrder} dibatalkan`,
        aktor,
      })
      await autoGitBackup('BATAL', 'permintaan_order', existing.noOrder, aktor)
      return NextResponse.json(updated)
    }

    return NextResponse.json({ error: `Aksi tidak dikenal: ${aksi}` }, { status: 400 })
  } catch (error) {
    console.error('Order PATCH error:', error)
    return NextResponse.json({ error: 'Gagal memproses order' }, { status: 500 })
  }
}
