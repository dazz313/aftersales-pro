import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { autoGitBackup } from '@/lib/git-backup'
import { requireActiveSession } from '@/lib/auth-server'

// GET /api/order - daftar permintaan order sparepart customer
export async function GET() {
  try {
    const orders = await db.permintaanOrder.findMany({
      include: {
        toko: { select: { id: true, kodeToko: true, namaToko: true } },
        customer: { select: { id: true, nama: true } },
      },
      orderBy: { createdAt: 'desc' },
    })
    return NextResponse.json(orders)
  } catch (error) {
    console.error('Order GET error:', error)
    return NextResponse.json({ error: 'Gagal memuat permintaan order' }, { status: 500 })
  }
}

async function generateNoOrder(): Promise<string> {
  const now = new Date()
  const ymd = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
  const count = await db.permintaanOrder.count({ where: { noOrder: { startsWith: `ORD-${ymd}` } } })
  return `ORD-${ymd}-${String(count + 1).padStart(4, '0')}`
}

// POST /api/order - catat permintaan order sparepart dari customer (toko/perorangan)
export async function POST(request: Request) {
  try {
    const { session, denied } = await requireActiveSession(request)
    if (denied) return denied
    void session
    const body = await request.json()
    const sparepartId = body.sparepartId ? Number(body.sparepartId) : null
    const qty = Math.max(1, Math.trunc(Number(body.qty) || 1))
    if (!sparepartId) {
      return NextResponse.json({ error: 'Sparepart wajib dipilih' }, { status: 400 })
    }
    const sp = await db.masterSparepart.findUnique({ where: { id: sparepartId } })
    if (!sp) {
      return NextResponse.json({ error: 'Sparepart tidak ditemukan' }, { status: 404 })
    }
    const tipeCustomer = body.tipeCustomer === 'TOKO' ? 'TOKO' : 'PERORANGAN'
    let namaPemesan = String(body.namaPemesan ?? '').trim()
    let tokoId: number | null = null
    let customerId: number | null = null
    if (tipeCustomer === 'TOKO') {
      if (!body.tokoId) {
        return NextResponse.json({ error: 'Toko pemesan wajib dipilih' }, { status: 400 })
      }
      const toko = await db.masterToko.findUnique({ where: { id: Number(body.tokoId) } })
      if (!toko) {
        return NextResponse.json({ error: 'Toko tidak ditemukan' }, { status: 404 })
      }
      tokoId = toko.id
      namaPemesan = namaPemesan || `${toko.kodeToko} — ${toko.namaToko}`
    } else {
      if (body.customerId) {
        const cust = await db.masterCustomer.findUnique({ where: { id: Number(body.customerId) } })
        if (!cust) {
          return NextResponse.json({ error: 'Customer tidak ditemukan' }, { status: 404 })
        }
        customerId = cust.id
        namaPemesan = namaPemesan || cust.nama
      }
      if (!namaPemesan) {
        return NextResponse.json({ error: 'Nama pemesan wajib diisi' }, { status: 400 })
      }
    }
    const order = await db.permintaanOrder.create({
      data: {
        noOrder: await generateNoOrder(),
        tipeCustomer,
        tokoId,
        customerId,
        namaPemesan,
        sparepartId: sp.id,
        kodePart: sp.kodePart,
        namaPart: sp.namaPart,
        brand: sp.brandKompatibel ?? '',
        qty,
        status: 'BARU',
        catatan: body.catatan ? String(body.catatan) : null,
      },
      include: {
        toko: { select: { id: true, kodeToko: true, namaToko: true } },
        customer: { select: { id: true, nama: true } },
      },
    })
    await logAudit({
      aksi: 'CREATE_ORDER_CUSTOMER',
      entitas: 'permintaan_order',
      entitasId: order.noOrder,
      deskripsi: `Order customer: ${order.namaPemesan} memesan ${sp.kodePart} ×${qty}${sp.stokInventory === 0 ? ' (stok titipan KOSONG)' : ''}`,
      aktor: body.aktor,
    })
    await autoGitBackup('CREATE', 'permintaan_order', order.noOrder, body.aktor)
    return NextResponse.json(order, { status: 201 })
  } catch (error) {
    console.error('Order POST error:', error)
    return NextResponse.json({ error: 'Gagal mencatat order' }, { status: 500 })
  }
}
