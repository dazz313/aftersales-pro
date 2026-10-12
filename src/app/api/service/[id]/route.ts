import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logAudit, generateNoSttb } from '@/lib/audit'
import { autoGitBackup, backupSparepartToGit } from '@/lib/git-backup'

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
 *   | KONFIRMASI_PRODUSEN | DAFTAR_TUNGGU_TOKO | KERJAKAN_DI_TOKO
 *   | TARIK_WORKSHOP | KIRIM_PART_RUSAK | KEMBALI_KE_TOKO | TERIMA_PART_PRODUSEN
 *   | TAMBAH_PART
 *
 * Alur lapangan: REQUEST (lapor) → konfirmasi produsen (READY/TIDAK_READY)
 * → TIDAK_READY: terdaftar & simpan di toko | READY: kerjakan di toko / tarik workshop+STTB
 * → PROSES: bongkar, part rusak → produsen (surat jalan), part baru datang & dipasang
 * → kembali ke toko (cabut STTB) → FINISH (nota stempel + TTD)
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
        data: { status: 'PROSES', noSttb, slaFlag: false, lokasiUnit: 'WORKSHOP', penanganan: 'TARIK_WORKSHOP' },
        include: { unitAsset: true, parts: { include: { sparepart: true } } },
      })
      await logAudit({
        aksi: 'MULAI_PROSES_SERVICE',
        entitas: 'service_request',
        entitasId: existing.noTiket,
        deskripsi: `Status REQUEST → PROSES. STTB ${noSttb} diterbitkan untuk penarikan unit ${existing.unitAsset.serialNumber} ke workshop`,
        aktor,
      })
      await autoGitBackup(aksi, 'service_request', existing.noTiket, aktor)
      return NextResponse.json(updated)
    }

    // ---- Alur service lapangan ----
    // 1) KONFIRMASI_PRODUSEN — jawaban produsen via WA per part: READY / TIDAK_READY
    if (aksi === 'KONFIRMASI_PRODUSEN') {
      const sk = body.statusKonfirmasi === 'TIDAK_READY' ? 'TIDAK_READY' : 'READY'
      if (body.partId !== undefined && body.partId !== null && body.partId !== '') {
        const part = existing.parts.find((p) => p.id === Number(body.partId))
        if (!part) {
          return NextResponse.json({ error: 'Part tidak ditemukan di tiket ini' }, { status: 404 })
        }
        await db.serviceRequestPart.update({ where: { id: part.id }, data: { statusKonfirmasi: sk } })
      } else {
        if (existing.parts.length === 0) {
          return NextResponse.json({ error: 'Tiket ini tidak membutuhkan sparepart' }, { status: 409 })
        }
        await db.serviceRequestPart.updateMany({ where: { serviceRequestId: ticketId }, data: { statusKonfirmasi: sk } })
      }
      await logAudit({
        aksi: 'KONFIRMASI_PRODUSEN',
        entitas: 'service_request',
        entitasId: existing.noTiket,
        deskripsi: `Produsen mengonfirmasi ketersediaan part: ${sk}${body.partId ? ` (part #${body.partId})` : ' (semua part)'}`,
        aktor,
      })
      const updated = await db.serviceRequest.findUnique({
        where: { id: ticketId },
        include: { unitAsset: true, parts: { include: { sparepart: true } } },
      })
      await autoGitBackup(aksi, 'service_request', existing.noTiket, aktor)
      return NextResponse.json(updated)
    }

    // 2) DAFTAR_TUNGGU_TOKO — part tidak ready: teregistrasi, unit tetap disimpan di toko
    if (aksi === 'DAFTAR_TUNGGU_TOKO') {
      if (existing.status !== 'REQUEST') {
        return NextResponse.json({ error: 'Hanya tiket REQUEST yang dapat didaftarkan tunggu' }, { status: 409 })
      }
      const updated = await db.serviceRequest.update({
        where: { id: ticketId },
        data: { penanganan: 'TUNGGU_PART_TOKO', lokasiUnit: 'TOKO' },
        include: { unitAsset: true, parts: { include: { sparepart: true } } },
      })
      await logAudit({
        aksi: 'DAFTAR_TUNGGU_TOKO',
        entitas: 'service_request',
        entitasId: existing.noTiket,
        deskripsi: 'Part tidak ready — tiket teregistrasi dan unit tetap disimpan di toko menunggu part dari produsen',
        aktor,
      })
      await autoGitBackup(aksi, 'service_request', existing.noTiket, aktor)
      return NextResponse.json(updated)
    }

    const butuhPartSiap = () => existing.parts.filter((p) => p.statusPart !== 'READY')

    // 3a) KERJAKAN_DI_TOKO — part ready: unit dikerjakan di toko (tanpa STTB)
    if (aksi === 'KERJAKAN_DI_TOKO') {
      if (existing.status !== 'REQUEST') {
        return NextResponse.json({ error: 'Hanya tiket REQUEST yang dapat mulai dikerjakan' }, { status: 409 })
      }
      const belumSiap = butuhPartSiap()
      if (belumSiap.length > 0) {
        return NextResponse.json(
          { error: `Belum bisa dikerjakan: ${belumSiap.length} part belum READY (${belumSiap.map((p) => p.sparepart.kodePart).join(', ')})` },
          { status: 409 }
        )
      }
      const updated = await db.serviceRequest.update({
        where: { id: ticketId },
        data: { status: 'PROSES', penanganan: 'DI_TOKO', lokasiUnit: 'TOKO', slaFlag: false },
        include: { unitAsset: true, parts: { include: { sparepart: true } } },
      })
      await logAudit({
        aksi: 'KERJAKAN_DI_TOKO',
        entitas: 'service_request',
        entitasId: existing.noTiket,
        deskripsi: `Status REQUEST → PROSES. Unit dikerjakan di toko (tanpa penarikan unit ke workshop)`,
        aktor,
      })
      await autoGitBackup(aksi, 'service_request', existing.noTiket, aktor)
      return NextResponse.json(updated)
    }

    // 3b) TARIK_WORKSHOP — part ready: unit ditarik ke workshop dengan STTB
    if (aksi === 'TARIK_WORKSHOP') {
      if (existing.status !== 'REQUEST') {
        return NextResponse.json({ error: 'Hanya tiket REQUEST yang dapat ditarik ke workshop' }, { status: 409 })
      }
      const belumSiap = butuhPartSiap()
      if (belumSiap.length > 0) {
        return NextResponse.json(
          { error: `Belum bisa ditarik: ${belumSiap.length} part belum READY (${belumSiap.map((p) => p.sparepart.kodePart).join(', ')})` },
          { status: 409 }
        )
      }
      const noSttb = existing.noSttb ?? generateNoSttb(existing.noTiket)
      const updated = await db.serviceRequest.update({
        where: { id: ticketId },
        data: { status: 'PROSES', noSttb, penanganan: 'TARIK_WORKSHOP', lokasiUnit: 'WORKSHOP', slaFlag: false },
        include: { unitAsset: true, parts: { include: { sparepart: true } } },
      })
      await logAudit({
        aksi: 'TARIK_WORKSHOP',
        entitas: 'service_request',
        entitasId: existing.noTiket,
        deskripsi: `Status REQUEST → PROSES. Unit ditarik ke workshop dengan STTB ${noSttb}`,
        aktor,
      })
      await autoGitBackup(aksi, 'service_request', existing.noTiket, aktor)
      return NextResponse.json(updated)
    }

    // 4) KIRIM_PART_RUSAK — catat nomor surat jalan pengiriman part rusak ke produsen
    if (aksi === 'KIRIM_PART_RUSAK') {
      if (existing.status !== 'PROSES') {
        return NextResponse.json({ error: 'Hanya tiket PROSES yang dapat dikirim part rusaknya' }, { status: 409 })
      }
      const noSJ = String(body.noSuratJalan ?? '').trim()
      if (!noSJ) {
        return NextResponse.json({ error: 'Nomor surat jalan wajib diisi' }, { status: 400 })
      }
      const updated = await db.serviceRequest.update({
        where: { id: ticketId },
        data: { noSuratJalan: noSJ },
        include: { unitAsset: true, parts: { include: { sparepart: true } } },
      })
      await logAudit({
        aksi: 'KIRIM_PART_RUSAK',
        entitas: 'service_request',
        entitasId: existing.noTiket,
        deskripsi: `Part rusak dikirim ke produsen via surat jalan ${noSJ}`,
        aktor,
      })
      await autoGitBackup(aksi, 'service_request', existing.noTiket, aktor)
      return NextResponse.json(updated)
    }

    // 5) KEMBALI_KE_TOKO — part baru terpasang: unit kembali ke toko, STTB dicabut
    if (aksi === 'KEMBALI_KE_TOKO') {
      if (existing.status !== 'PROSES') {
        return NextResponse.json({ error: 'Hanya tiket PROSES yang dapat dikembalikan ke toko' }, { status: 409 })
      }
      const updated = await db.serviceRequest.update({
        where: { id: ticketId },
        data: { lokasiUnit: 'TOKO', sttbDicabut: true, tglKembaliKeToko: new Date() },
        include: { unitAsset: true, parts: { include: { sparepart: true } } },
      })
      await logAudit({
        aksi: 'KEMBALI_KE_TOKO',
        entitas: 'service_request',
        entitasId: existing.noTiket,
        deskripsi: `Unit kembali ke toko, STTB ${existing.noSttb ?? '-'} dicabut — siap pengajuan nota servis`,
        aktor,
      })
      await autoGitBackup(aksi, 'service_request', existing.noTiket, aktor)
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
          // Nota berstempel + TTD = unit sudah kembali ke toko & STTB tercabut
          lokasiUnit: 'TOKO',
          sttbDicabut: true,
          tglKembaliKeToko: existing.tglKembaliKeToko ?? new Date(),
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
      await autoGitBackup(aksi, 'service_request', existing.noTiket, aktor)
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
      await autoGitBackup(aksi, 'service_request', existing.noTiket, aktor)
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
      await autoGitBackup(aksi, 'service_request', existing.noTiket, aktor)
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
      await autoGitBackup(aksi, 'service_request', existing.noTiket, aktor)
      return NextResponse.json(updated)
    }

    // Aksi khusus: tambah sparepart saat pengerjaan (PROSES/REQUEST).
    // Stok cukup → READY (direserve); stok kurang → ORDER_PRODUSEN + menunggu konfirmasi.
    if (aksi === 'TAMBAH_PART') {
      if (existing.status === 'FINISH') {
        return NextResponse.json({ error: 'Tiket FINISH tidak dapat ditambah part' }, { status: 409 })
      }
      const sparepartId = Number(body.sparepartId)
      const qty = Math.max(1, Math.trunc(Number(body.qty) || 1))
      if (!sparepartId) {
        return NextResponse.json({ error: 'Sparepart wajib dipilih' }, { status: 400 })
      }
      const sp = await db.masterSparepart.findUnique({ where: { id: sparepartId } })
      if (!sp) {
        return NextResponse.json({ error: 'Sparepart tidak ditemukan' }, { status: 404 })
      }
      let statusPart = 'ORDER_PRODUSEN'
      let statusKonfirmasi = 'MENUNGGU'
      if (sp.stokInventory >= qty) {
        const ambilJual = Math.min(sp.stokJual, qty)
        await db.masterSparepart.update({
          where: { id: sp.id },
          data: {
            stokJual: { decrement: ambilJual },
            stokGaransi: { decrement: qty - ambilJual },
            stokInventory: { decrement: qty },
          },
        })
        statusPart = 'READY'
        statusKonfirmasi = 'READY'
      }
      await db.serviceRequestPart.create({
        data: { serviceRequestId: ticketId, sparepartId: sp.id, qty, statusPart, statusKonfirmasi },
      })
      await logAudit({
        aksi: 'TAMBAH_PART_SERVICE',
        entitas: 'service_request',
        entitasId: existing.noTiket,
        deskripsi: statusPart === 'READY'
          ? `Tambah part saat pengerjaan: ${sp.kodePart} ×${qty} READY (stok direserve)`
          : `Tambah part saat pengerjaan: ${sp.kodePart} ×${qty} stok tidak cukup → ORDER ke produsen`,
        aktor,
      })
      if (statusPart === 'READY') {
        await backupSparepartToGit('RESERVE', sp.kodePart, aktor)
      }
      const updated = await db.serviceRequest.findUnique({
        where: { id: ticketId },
        include: { unitAsset: true, parts: { include: { sparepart: true } } },
      })
      await autoGitBackup(aksi, 'service_request', existing.noTiket, aktor)
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
        // Part datang dari produsen → masuk stok GARANSI lalu langsung terpakai tiket ini
        await db.masterSparepart.update({
          where: { id: p.sparepartId },
          data: { stokGaransi: { increment: p.qty }, stokInventory: { increment: p.qty } },
        })
      }
      await logAudit({
        aksi: 'TERIMA_PART_PRODUSEN',
        entitas: 'service_request',
        entitasId: existing.noTiket,
        deskripsi: `${parts.length} part diterima dari produsen dan dialokasikan ke tiket`,
        aktor,
      })
      await backupSparepartToGit('TERIMA_PART', existing.noTiket, aktor)
      const updated = await db.serviceRequest.findUnique({
        where: { id: ticketId },
        include: { unitAsset: true, parts: { include: { sparepart: true } } },
      })
      await autoGitBackup(aksi, 'service_request', existing.noTiket, aktor)
      return NextResponse.json(updated)
    }

    return NextResponse.json({ error: `Aksi tidak dikenal: ${aksi}` }, { status: 400 })
  } catch (error) {
    console.error('Service [id] PATCH error:', error)
    return NextResponse.json({ error: 'Gagal memproses aksi tiket' }, { status: 500 })
  }
}
