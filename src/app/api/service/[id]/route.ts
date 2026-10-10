import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logAudit, generateNoSttb } from '@/lib/audit'

// GET /api/service/[id] - detail satu tiket
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const ticket = await db.serviceRequest.findUnique({
      where: { id: Number(id) },
      include: {
        unitAsset: {
          include: {
            toko: true,
            customer: true,
          },
        },
        parts: { include: { sparepart: true } },
      },
    })
    if (!ticket) {
      return NextResponse.json({ error: 'Tiket tidak ditemukan' }, { status: 404 })
    }
    return NextResponse.json(ticket)
  } catch (error) {
    console.error('Service [id] GET error:', error)
    return NextResponse.json({ error: 'Gagal memuat detail tiket' }, { status: 500 })
  }
}

/**
 * PATCH /api/service/[id] - Transisi workflow tiket
 * Aksi: MULAI_PROSES | FINISH | SUBMIT_CLAIM | MARK_PAID | UPDATE_JASA
 *
 * Sesuai PRD Modul 2:
 * - 2.2 Process Service: pembuatan STTB (no_sttb) saat mulai proses
 * - 2.3 Finish Service: konfirmasi pengembalian + unggah nota berstempel
 * - 4.1 Claim Verification: verifikasi FINISH dengan bukti stempel
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await request.json()
    const ticketId = Number(id)
    const existing = await db.serviceRequest.findUnique({
      where: { id: ticketId },
      include: { unitAsset: true, parts: { include: { sparepart: true } } },
    })
    if (!existing) {
      return NextResponse.json({ error: 'Tiket tidak ditemukan' }, { status: 404 })
    }

    const aksi = body.aksi as string
    const aktor = body.aktor ?? 'ADMIN'

    if (aksi === 'MULAI_PROSES') {
      if (existing.status !== 'REQUEST') {
        return NextResponse.json({ error: 'Hanya tiket REQUEST yang dapat diproses' }, { status: 409 })
      }
      const noSttb = generateNoSttb(existing.noTiket)
      const updated = await db.serviceRequest.update({
        where: { id: ticketId },
        data: { status: 'PROSES', noSttb, slaFlag: false },
        include: { unitAsset: true, parts: { include: { sparepart: true } } },
      })
      await logAudit({
        aksi: 'MULAI_PROSES_SERVICE',
        entitas: 'service_request',
        entitasId: existing.noTiket,
        deskripsi: `Status REQUEST → PROSES. STTB ${noSttb} diterbitkan untuk penarikan unit ${existing.unitAsset.serialNumber}`,
        aktor,
      })
      return NextResponse.json(updated)
    }

    if (aksi === 'FINISH') {
      if (existing.status !== 'PROSES') {
        return NextResponse.json({ error: 'Hanya tiket PROSES yang dapat diselesaikan' }, { status: 409 })
      }
      if (!body.fotoNotaStempel) {
        return NextResponse.json(
          { error: 'Wajib mengunggah foto nota service berstempel toko sebelum FINISH' },
          { status: 400 }
        )
      }
      const updated = await db.serviceRequest.update({
        where: { id: ticketId },
        data: {
          status: 'FINISH',
          fotoNotaStempel: body.fotoNotaStempel,
          tandaTanganDigital: body.tandaTanganDigital ?? null,
          tglFinish: new Date(),
        },
        include: { unitAsset: true, parts: { include: { sparepart: true } } },
      })
      await logAudit({
        aksi: 'FINISH_SERVICE',
        entitas: 'service_request',
        entitasId: existing.noTiket,
        deskripsi: `Status PROSES → FINISH. Unit dikembalikan ke toko, nota berstempel diunggah (${body.fotoNotaStempel})`,
        aktor,
      })
      return NextResponse.json(updated)
    }

    if (aksi === 'SUBMIT_CLAIM') {
      if (existing.status !== 'FINISH') {
        return NextResponse.json({ error: 'Klaim hanya untuk tiket FINISH' }, { status: 409 })
      }
      if (!existing.fotoNotaStempel) {
        return NextResponse.json(
          { error: 'Verifikasi gagal: bukti nota berstempel belum tersedia' },
          { status: 409 }
        )
      }
      if (existing.statusKlaimProdusen !== 'DRAFT') {
        return NextResponse.json(
          { error: `Klaim sudah berstatus ${existing.statusKlaimProdusen}` },
          { status: 409 }
        )
      }
      const updated = await db.serviceRequest.update({
        where: { id: ticketId },
        data: { statusKlaimProdusen: 'SUBMITTED', tglKlaim: new Date() },
        include: { unitAsset: true, parts: { include: { sparepart: true } } },
      })
      await logAudit({
        aksi: 'SUBMIT_CLAIM',
        entitas: 'service_request',
        entitasId: existing.noTiket,
        deskripsi: 'Klaim diverifikasi & diajukan ke produsen (DRAFT → SUBMITTED)',
        aktor,
      })
      return NextResponse.json(updated)
    }

    if (aksi === 'MARK_PAID') {
      if (existing.statusKlaimProdusen !== 'SUBMITTED') {
        return NextResponse.json({ error: 'Hanya klaim SUBMITTED yang dapat ditandai PAID' }, { status: 409 })
      }
      const updated = await db.serviceRequest.update({
        where: { id: ticketId },
        data: { statusKlaimProdusen: 'PAID' },
        include: { unitAsset: true, parts: { include: { sparepart: true } } },
      })
      await logAudit({
        aksi: 'MARK_CLAIM_PAID',
        entitas: 'service_request',
        entitasId: existing.noTiket,
        deskripsi: 'Pembayaran klaim diterima dari produsen (SUBMITTED → PAID)',
        aktor,
      })
      return NextResponse.json(updated)
    }

    if (aksi === 'UPDATE_JASA') {
      const updated = await db.serviceRequest.update({
        where: { id: ticketId },
        data: { biayaJasa: Number(body.biayaJasa) || 0 },
        include: { unitAsset: true, parts: { include: { sparepart: true } } },
      })
      await logAudit({
        aksi: 'UPDATE_BIAYA_JASA',
        entitas: 'service_request',
        entitasId: existing.noTiket,
        deskripsi: `Biaya jasa diubah menjadi Rp ${Number(body.biayaJasa).toLocaleString('id-ID')}`,
        aktor,
      })
      return NextResponse.json(updated)
    }

    // Aksi khusus: terima part dari produsen (ORDER_PRODUSEN → READY + restock)
    if (aksi === 'TERIMA_PART_PRODUSEN') {
      const parts = existing.parts.filter((p) => p.statusPart === 'ORDER_PRODUSEN')
      if (parts.length === 0) {
        return NextResponse.json({ error: 'Tidak ada part dengan status ORDER_PRODUSEN' }, { status: 409 })
      }
      for (const p of parts) {
        await db.serviceRequestPart.update({ where: { id: p.id }, data: { statusPart: 'READY' } })
        // Part datang dari produsen → masuk stok konsinyasi lalu langsung terpakai tiket ini
        await db.masterSparepart.update({
          where: { id: p.sparepartId },
          data: { stokKonsinyasi: { increment: p.qty } },
        })
      }
      await logAudit({
        aksi: 'TERIMA_PART_PRODUSEN',
        entitas: 'service_request',
        entitasId: existing.noTiket,
        deskripsi: `${parts.length} part diterima dari produsen dan dialokasikan ke tiket`,
        aktor,
      })
      const updated = await db.serviceRequest.findUnique({
        where: { id: ticketId },
        include: { unitAsset: true, parts: { include: { sparepart: true } } },
      })
      return NextResponse.json(updated)
    }

    return NextResponse.json({ error: `Aksi tidak dikenal: ${aksi}` }, { status: 400 })
  } catch (error) {
    console.error('Service [id] PATCH error:', error)
    return NextResponse.json({ error: 'Gagal memproses aksi tiket' }, { status: 500 })
  }
}
