import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { autoGitBackup } from '@/lib/git-backup'
import { requireActiveSession } from '@/lib/auth-server'
import { buatNotifikasi, susunPesanRegistrasi, ROLE_NOTIFIKASI } from '@/lib/notifikasi'

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

// POST /api/unit - registrasi service (unit baru)
export async function POST(request: Request) {
  try {
    const { session, denied } = await requireActiveSession(request)
    if (denied) return denied
    void session
    const body = await request.json()
    // Wajib cukup: NAMA UNIT, KERUSAKAN (diagnosa awal), PEMILIK (toko mitra /
    // customer). Nomor seri & model OPSIONAL — nomor seri TIDAK digenerate
    // otomatis: dikosongkan = tetap kosong & diinput belakangan lewat Edit Unit
    // (kolom serial bukan unique lagi → beberapa unit boleh tanpa nomor seri).
    const nama = String(body.nama ?? '').trim()
    const kerusakan = String(body.kerusakanAwal ?? '').trim()
    if (!nama || !kerusakan) {
      return NextResponse.json({ error: 'Nama unit dan kerusakan unit wajib diisi — nomor seri & model boleh menyusul' }, { status: 400 })
    }
    // Normalisasi: cegah dobel via beda kapital/spasi ("sn-001" vs "SN-001 ")
    const model = String(body.modelUnit ?? '').trim()
    const tokoIdBaru = body.tokoId ? Number(body.tokoId) : null
    if (tokoIdBaru && !(await db.masterToko.findUnique({ where: { id: tokoIdBaru } }))) {
      return NextResponse.json({ error: 'Toko tidak ditemukan' }, { status: 404 })
    }
    const customerIdBaru = body.customerId ? Number(body.customerId) : null
    if (customerIdBaru && !(await db.masterCustomer.findUnique({ where: { id: customerIdBaru } }))) {
      return NextResponse.json({ error: 'Customer tidak ditemukan' }, { status: 404 })
    }
    if (!tokoIdBaru && !customerIdBaru) {
      return NextResponse.json({ error: 'Pemilik unit wajib diisi — pilih toko mitra atau customer' }, { status: 400 })
    }
    // Nomor seri tidak digenerate otomatis — bila dikosongkan kolom tetap kosong
    // dan diinput belakangan lewat Edit Unit.
    const serial = String(body.serialNumber ?? '').trim().toUpperCase()
    // Trap dobel: kunci = nomor seri + pemilik toko. Sama persis → tolak langsung.
    // NOTE: nomor seri TIDAK unik lagi (boleh kosong) → pakai findFirst; unit
    // TANPA nomor seri tidak bisa di-trap per serial & boleh duplikat kosong.
    if (serial) {
      const exists = await db.unitAsset.findFirst({
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
        // Diagnosa awal (bahasa awam) — boleh kosong; terekam sejak registrasi
        // tanpa menunggu kode part terbit (lihat komentar kolom di schema).
        kerusakanAwal: String(body.kerusakanAwal ?? '').trim() || null,
        tokoId: tokoIdBaru,
        customerId: customerIdBaru,
        statusGaransi: body.statusGaransi === 'NON_GARANSI' ? 'NON_GARANSI' : body.statusGaransi === 'STOK_TOKO' ? 'STOK_TOKO' : 'GARANSI',
        tglPembelian: body.tglPembelian ? new Date(body.tglPembelian) : null,
        createdAt,
      },
      include: {
        toko: { select: { kodeToko: true, namaToko: true } },
        customer: { select: { nama: true } },
      },
    })
    await logAudit({
      aksi: 'CREATE_UNIT_ASSET',
      entitas: 'unit_asset',
      entitasId: unit.serialNumber,
      deskripsi: `Unit baru teregistrasi: ${unit.nama || unit.modelUnit} (${unit.statusGaransi})${susulan ? ' — input susulan (backdate)' : ''}${unit.kerusakanAwal ? ' — diagnosa awal kerusakan tercatat' : ''}`,
      aktor: body.aktor,
    })
    // Notifikasi lonceng: unit baru teregistrasi → teknisi/admin/manager tahu
    // ada unit yang harus ditindaklanjuti (unit ini belum jadi tiket service).
    await buatNotifikasi({
      tipe: 'REGISTRASI_UNIT',
      judul: 'Registrasi unit baru',
      pesan: susunPesanRegistrasi({
        nama: unit.nama,
        merk: unit.merk,
        modelUnit: unit.modelUnit,
        serialNumber: unit.serialNumber,
        kerusakanAwal: unit.kerusakanAwal,
        statusGaransi: unit.statusGaransi,
        toko: unit.toko,
        customer: unit.customer,
      }),
      refType: 'unit',
      refId: unit.id,
      refLabel: unit.serialNumber || unit.nama,
      dibuatOleh: body.aktor ?? session?.nama ?? null,
      untukRole: ROLE_NOTIFIKASI,
    })
    await autoGitBackup('CREATE', 'unit_asset', unit.serialNumber, body.aktor)
    return NextResponse.json(unit, { status: 201 })
  } catch (error) {
    console.error('Unit POST error:', error)
    return NextResponse.json({ error: 'Gagal menambah unit' }, { status: 500 })
  }
}
