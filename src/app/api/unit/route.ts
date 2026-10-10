import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'

// GET /api/unit - list unit asset + data barcode
export async function GET() {
  try {
    const units = await db.unitAsset.findMany({
      include: {
        toko: { select: { id: true, kodeToko: true, namaToko: true } },
        customer: { select: { id: true, nama: true, noWa: true } },
        serviceRequests: { select: { id: true, noTiket: true, status: true }, orderBy: { createdAt: 'desc' } },
      },
      orderBy: { createdAt: 'desc' },
    })
    const result = units.map((u) => ({
      ...u,
      // Format barcode sesuai PRD: SN:[serial_number]|MOD:[model_unit]|TOK:[kode_toko]
      barcodeData: `SN:${u.serialNumber}|MOD:${u.modelUnit}|TOK:${u.toko?.kodeToko ?? '-'}`,
    }))
    return NextResponse.json(result)
  } catch (error) {
    console.error('Unit GET error:', error)
    return NextResponse.json({ error: 'Gagal memuat data unit' }, { status: 500 })
  }
}

// POST /api/unit - registrasi unit baru
export async function POST(request: Request) {
  try {
    const body = await request.json()
    if (!body.serialNumber || !body.modelUnit) {
      return NextResponse.json({ error: 'Serial number dan model unit wajib diisi' }, { status: 400 })
    }
    const exists = await db.unitAsset.findUnique({ where: { serialNumber: body.serialNumber } })
    if (exists) {
      return NextResponse.json({ error: `Serial number ${body.serialNumber} sudah terdaftar` }, { status: 409 })
    }
    const unit = await db.unitAsset.create({
      data: {
        serialNumber: body.serialNumber,
        modelUnit: body.modelUnit,
        tokoId: body.tokoId ? Number(body.tokoId) : null,
        customerId: body.customerId ? Number(body.customerId) : null,
        statusGaransi: body.statusGaransi === 'NON_GARANSI' ? 'NON_GARANSI' : 'GARANSI',
        tglPembelian: body.tglPembelian ? new Date(body.tglPembelian) : null,
      },
    })
    await logAudit({
      aksi: 'CREATE_UNIT_ASSET',
      entitas: 'unit_asset',
      entitasId: unit.serialNumber,
      deskripsi: `Unit baru teregistrasi: ${unit.modelUnit} (${unit.statusGaransi})`,
      aktor: body.aktor,
    })
    return NextResponse.json(unit, { status: 201 })
  } catch (error) {
    console.error('Unit POST error:', error)
    return NextResponse.json({ error: 'Gagal menambah unit' }, { status: 500 })
  }
}
