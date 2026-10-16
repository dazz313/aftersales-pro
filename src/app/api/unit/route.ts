import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { autoGitBackup } from '@/lib/git-backup'
import { requireActiveSession } from '@/lib/auth-server'

// GET /api/unit - list unit asset + data barcode
export async function GET() {
  try {
    const units = await db.unitAsset.findMany({
      include: {
        toko: { select: { id: true, kodeToko: true, namaToko: true } },
        customer: { select: { id: true, nama: true, noWa: true } },
        // Sertakan part per tiket agar tab Unit bisa memisahkan unit yang
        // sudah dapat kode sparepart vs yang belum (tanpa fetch tambahan)
        serviceRequests: {
          select: {
            id: true,
            noTiket: true,
            status: true,
            parts: { select: { qty: true, sparepart: { select: { kodePart: true } } } },
          },
          orderBy: { createdAt: 'desc' },
        },
      },
      orderBy: [{ tglPembelian: 'desc' }, { createdAt: 'desc' }],
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
    const { session, denied } = await requireActiveSession(request)
    if (denied) return denied
    void session
    const body = await request.json()
    // Normalisasi: cegah dobel via beda kapital/spasi ("sn-001" vs "SN-001 ")
    const serial = String(body.serialNumber ?? '').trim().toUpperCase()
    const model = String(body.modelUnit ?? '').trim()
    if (!serial || !model) {
      return NextResponse.json({ error: 'Serial number dan model unit wajib diisi' }, { status: 400 })
    }
    const tokoIdBaru = body.tokoId ? Number(body.tokoId) : null
    if (tokoIdBaru && !(await db.masterToko.findUnique({ where: { id: tokoIdBaru } }))) {
      return NextResponse.json({ error: 'Toko tidak ditemukan' }, { status: 404 })
    }
    const customerIdBaru = body.customerId ? Number(body.customerId) : null
    if (customerIdBaru && !(await db.masterCustomer.findUnique({ where: { id: customerIdBaru } }))) {
      return NextResponse.json({ error: 'Customer tidak ditemukan' }, { status: 404 })
    }
    // Trap dobel: kunci = nomor seri + toko. Sama persis → tolak langsung.
    const exists = await db.unitAsset.findUnique({
      where: { serialNumber: serial },
      include: { toko: { select: { kodeToko: true, namaToko: true } } },
    })
    if (exists) {
      const tokoLama = exists.toko ? `${exists.toko.kodeToko} — ${exists.toko.namaToko}` : 'tanpa toko'
      if ((exists.tokoId ?? null) === tokoIdBaru) {
        return NextResponse.json({ error: `Unit ${serial} sudah terdaftar di ${tokoLama} — input ganda ditolak.` }, { status: 409 })
      }
      return NextResponse.json({ error: `Nomor seri ${serial} sudah terdaftar di ${tokoLama} — periksa data, jangan input ulang.` }, { status: 409 })
    }
    // Tanggal input registrasi — opsional, default sekarang. Mendukung backdate
    // untuk susulan input lama (tanggal bisa ditelusuri dari postingan WA);
    // ditolak bila invalid atau setelah besok.
    let createdAt = new Date()
    let susulan = false
    if (body.tglInput !== undefined && body.tglInput !== null && body.tglInput !== '') {
      const parsed = new Date(body.tglInput)
      const batas = new Date()
      batas.setDate(batas.getDate() + 1)
      batas.setHours(23, 59, 59, 999)
      if (Number.isNaN(parsed.getTime()) || parsed > batas) {
        return NextResponse.json({ error: 'Tanggal input tidak valid atau melebihi batas' }, { status: 400 })
      }
      createdAt = parsed
      susulan = true
    }
    const unit = await db.unitAsset.create({
      data: {
        serialNumber: serial,
        modelUnit: model,
        merk: String(body.merk ?? '').trim(),
        nama: String(body.nama ?? '').trim(),
        tokoId: tokoIdBaru,
        customerId: customerIdBaru,
        statusGaransi: body.statusGaransi === 'NON_GARANSI' ? 'NON_GARANSI' : body.statusGaransi === 'STOK_TOKO' ? 'STOK_TOKO' : 'GARANSI',
        tglPembelian: body.tglPembelian ? new Date(body.tglPembelian) : null,
        createdAt,
      },
    })
    await logAudit({
      aksi: 'CREATE_UNIT_ASSET',
      entitas: 'unit_asset',
      entitasId: unit.serialNumber,
      deskripsi: `Unit baru teregistrasi: ${unit.modelUnit} (${unit.statusGaransi})${susulan ? ' — input susulan (backdate)' : ''}`,
      aktor: body.aktor,
    })
    await autoGitBackup('CREATE', 'unit_asset', unit.serialNumber, body.aktor)
    return NextResponse.json(unit, { status: 201 })
  } catch (error) {
    console.error('Unit POST error:', error)
    return NextResponse.json({ error: 'Gagal menambah unit' }, { status: 500 })
  }
}
