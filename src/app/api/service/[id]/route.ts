import { NextResponse } from 'next/server'
import { join, basename } from 'node:path'
import { db } from '@/lib/db'
import { logAudit, generateNoSttb } from '@/lib/audit'
import { autoGitBackup, backupSparepartToGit } from '@/lib/git-backup'
import { requireActiveSession } from '@/lib/auth-server'
import type { SessionPayload } from '@/lib/auth'
import { catatBankKode } from '@/lib/bank-kode'
import { konfigurasiEmail, kirimSmtp, susunEmailOrder } from '@/lib/order-email'

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
        // Item order-email menempel tiket (REQUEST_EMAIL / Reorder Email) —
        // dipakai UI utk badge "Email: PENDING/TERKIRIM" per baris part inden.
        orderEmailParts: { select: { id: true, kodePart: true, qty: true, status: true, createdAt: true } },
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
 * Koreksi part tiket FINISH hanya oleh Admin Workshop/Manager + flag disengaja
 * dari UI (`koreksiSelesai`) — pelindung riwayat tetap berlaku untuk role lain.
 */
function bolehKoreksiSelesai(flag: unknown, session: SessionPayload | null) {
  return Boolean(flag) && !!session && ['ADMIN_WORKSHOP', 'MANAGER'].includes(session.role)
}

/** Normalisasi kode part untuk pencocokan item order-email — sama dgn matcher surat jalan masuk. */
const NORM_KODE = (s: string | null | undefined) => (s || '').toString().toUpperCase().replace(/[^A-Z0-9#]/g, '')

/**
 * PATCH /api/service/[id] - Transisi workflow tiket
 * Aksi: MULAI_PROSES | FINISH | SUBMIT_CLAIM | MARK_PAID | UPDATE_JASA
 *   | KONFIRMASI_PRODUSEN | DAFTAR_TUNGGU_TOKO | KERJAKAN_DI_TOKO
 *   | TARIK_WORKSHOP | KIRIM_PART_RUSAK | KEMBALI_KE_TOKO | TERIMA_PART_PRODUSEN
 *   | TAMBAH_PART | HAPUS_PART | UBAH_QTY_PART | KIRIM_PRODUSEN_WA | INPUT_PART_PRODUSEN
 *   | ORDER_EMAIL_REORDER (daftarkan baris inden ORDER_PRODUSEN sebagai item email)
 *
 * Alur lapangan: REQUEST (lapor) → konfirmasi produsen (READY/TIDAK_READY)
 * → TIDAK_READY: terdaftar & simpan di toko | READY: kerjakan di toko / tarik workshop+STTB
 * → PROSES: bongkar, part rusak → produsen (surat jalan), part baru datang & dipasang
 * → kembali ke toko (cabut STTB) → FINISH (nota stempel + TTD)
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { session, denied } = await requireActiveSession(request)
    if (denied) return denied
    const { id } = await params
    const body = await request.json()
    const ticketId = Number(id)
    const existing = await db.serviceRequest.findUnique({
      where: { id: ticketId },
      include: {
        unitAsset: { include: { toko: true } },
        parts: { include: { sparepart: true } },
      },
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
      // Aturan inti: tanpa kode+nama part yang READY → tidak bisa PROSES
      if (!existing.parts.some((p) => p.statusPart === 'READY')) {
        return NextResponse.json(
          { error: 'Belum bisa diproses: input kode & nama sparepart dulu (tiket tercatat di panel Belum Terproses)' },
          { status: 409 }
        )
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

    // ---- Aksi kirim email order part (Kekurangan Part) ke produsen ----
    // Tiket REQUEST_EMAIL (order email biasa, SV-EM) ATAU tiket biasa
    // (REQUEST/PROSES) yang baris inden-nya sudah didaftarkan sebagai item
    // email via aksi ORDER_EMAIL_REORDER — dua pintu masuk, satu pengirim.
    if (aksi === 'KIRIM_EMAIL_PRODUSEN') {
      const items = await db.orderEmailPart.findMany({
        where: { serviceRequestId: ticketId, status: 'PENDING' },
        orderBy: { createdAt: 'asc' },
      })
      if (existing.status !== 'REQUEST_EMAIL' && items.length === 0) {
        return NextResponse.json({ error: 'Tidak ada part menunggu email di tiket ini — daftarkan part inden dulu via Email Order (ORDER_EMAIL_REORDER)' }, { status: 409 })
      }
      if (items.length === 0) {
        return NextResponse.json({ error: 'Tidak ada part menunggu email di tiket ini (semua sudah terkirim)' }, { status: 409 })
      }
      const it0 = items[0]
      const { subjek, isi } = susunEmailOrder({
        noTiket: existing.noTiket,
        serialNumber: it0.serialNumber,
        modelUnit: it0.modelUnit,
        merk: existing.unitAsset?.merk ?? null,
        tokoNama: it0.tokoNama,
        catatan: it0.catatan,
        lampiranNama: existing.lampiranEmail,
        items: items.map((i) => ({ kodePart: i.kodePart, namaPart: i.namaPart, qty: i.qty })),
      })
      const cfg = await konfigurasiEmail()
      const smtpLengkap = Boolean(cfg.ke && cfg.host && cfg.user && cfg.pass && cfg.dari)
      if (smtpLengkap) {
        const lampiran = existing.lampiranEmail
          ? {
              path: join(process.cwd(), 'upload', 'lampiran-email', basename(existing.lampiranEmail)),
              filename: existing.lampiranEmail,
            }
          : undefined
        try {
          await kirimSmtp(cfg, subjek, isi, lampiran)
        } catch (e) {
          const pesan = e instanceof Error ? e.message : String(e)
          await db.orderEmailPart.updateMany({
            where: { serviceRequestId: ticketId, status: 'PENDING' },
            data: { emailPesanGagal: pesan, emailMode: 'SMTP' },
          })
          return NextResponse.json({ error: `Kirim SMTP gagal: ${pesan}` }, { status: 502 })
        }
        await db.orderEmailPart.updateMany({
          where: { serviceRequestId: ticketId, status: 'PENDING' },
          data: {
            status: 'TERKIRIM',
            emailTujuan: cfg.ke,
            emailKirimAt: new Date(),
            emailOleh: aktor,
            emailMode: 'SMTP',
            emailPesanGagal: null,
          },
        })
        await logAudit({
          aksi: 'ORDER_EMAIL_TERKIRIM',
          entitas: 'service_request',
          entitasId: existing.noTiket,
          deskripsi: `Email order part ${items.length} item dikirim ke ${cfg.ke} (tiket ${existing.noTiket})${lampiran ? ' + lampiran ' + existing.lampiranEmail : ''}`,
          aktor,
        })
        await autoGitBackup('KIRIM_EMAIL_PRODUSEN', 'service_request', existing.noTiket, aktor)
        return NextResponse.json({ ok: true, mode: 'SMTP', terkirim: items.length, ke: cfg.ke, noTiket: existing.noTiket })
      }
      // SMTP belum diset → draf mailto (isi lengkap; item tetap PENDING)
      const mailto =
        `mailto:${encodeURIComponent(cfg.ke || '')}` +
        `?subject=${encodeURIComponent(subjek)}&body=${encodeURIComponent(isi)}`
      await logAudit({
        aksi: 'ORDER_EMAIL_DRAF',
        entitas: 'service_request',
        entitasId: existing.noTiket,
        deskripsi: `Draf email order part ${items.length} item dibuka (SMTP belum diset) — tiket ${existing.noTiket}`,
        aktor,
      })
      return NextResponse.json({ ok: true, mode: 'MAILTO', ke: cfg.ke || '', mailto, noTiket: existing.noTiket })
    }

    // ---- Reorder part inden (ORDER_PRODUSEN) → daftarkan sebagai item order email (PENDING) ----
    // Dari tiket biasa (REQUEST/PROSES) — untuk unit dengan beberapa part rusak,
    // sebagian READY dari stok dan sisanya inden. Baris inden TIDAK membuat tiket
    // SV-EM baru: item menempel ke TIKET INI (serviceRequestId) sehingga aksi
    // Kirim Email di atas & matcher Surat Jalan Masuk tetap mengenalinya.
    // Idempoten: baris inden yang sudah punya item PENDING/TERKIRIM dilewati —
    // aman diklik ulang tanpa menciptakan order ganda.
    if (aksi === 'ORDER_EMAIL_REORDER') {
      if (existing.status === 'FINISH') {
        return NextResponse.json({ error: 'Tiket sudah FINISH — koreksi part lebih dulu via Admin/Manager' }, { status: 409 })
      }
      const inden = existing.parts.filter((p) => p.statusPart === 'ORDER_PRODUSEN')
      if (inden.length === 0) {
        return NextResponse.json({ error: 'Tidak ada part inden (ORDER_PRODUSEN) di tiket ini — semua part sudah ready' }, { status: 409 })
      }
      const sudah = await db.orderEmailPart.findMany({
        where: { serviceRequestId: ticketId, status: { in: ['PENDING', 'TERKIRIM'] } },
      })
      const sudahKode = new Set(
        sudah.map((o) => NORM_KODE(o.kodePart))
      )
      const baru = inden.filter((p) => !sudahKode.has(NORM_KODE(p.sparepart.kodePart)))
      if (baru.length === 0) {
        await logAudit({
          aksi: 'ORDER_EMAIL_REORDER',
          entitas: 'service_request',
          entitasId: existing.noTiket,
          deskripsi: `Semua part inden sudah terdaftar di order email — tidak ada order ganda dibuat (tiket ${existing.noTiket})`,
          aktor,
        })
        return NextResponse.json({ ok: true, dibuat: 0, noTiket: existing.noTiket })
      }
      const dibuatItems: string[] = []
      for (const p of baru) {
        await db.orderEmailPart.create({
          data: {
            kodePart: p.sparepart.kodePart,
            namaPart: p.sparepart.namaPart,
            brand: existing.unitAsset.merk || null,
            qty: p.qty,
            unitAssetId: existing.unitAssetId,
            serialNumber: existing.unitAsset.serialNumber || null,
            modelUnit: existing.unitAsset.modelUnit || null,
            tokoKode: existing.unitAsset.toko?.kodeToko ?? null,
            tokoNama: existing.unitAsset.toko?.namaToko ?? null,
            catatan: `Reorder part inden — tiket ${existing.noTiket}`,
            diinputOleh: aktor,
            status: 'PENDING',
            serviceRequestId: ticketId,
          },
        })
        dibuatItems.push(`${p.sparepart.kodePart} ×${p.qty}`)
      }
      await logAudit({
        aksi: 'ORDER_EMAIL_REORDER',
        entitas: 'service_request',
        entitasId: existing.noTiket,
        deskripsi: `Reorder ${baru.length} part inden via email: ${dibuatItems.join(', ')} — item menempel ke tiket ${existing.noTiket}, siap dikirim ke produsen`,
        aktor,
      })
      await autoGitBackup('ORDER_EMAIL_REORDER', 'service_request', existing.noTiket, aktor)
      const updated = await db.serviceRequest.findUnique({
        where: { id: ticketId },
        include: {
          unitAsset: { include: { toko: { select: { id: true, kodeToko: true, namaToko: true } }, customer: { select: { id: true, nama: true, noWa: true } } } },
          parts: { include: { sparepart: true } },
          orderEmailParts: { select: { id: true, kodePart: true, qty: true, status: true, createdAt: true } },
        },
      })
      return NextResponse.json({ ok: true, dibuat: baru.length, noTiket: existing.noTiket, ticket: updated })
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
      if (existing.status === 'FINISH' || (existing.status === 'PROSES' && existing.penanganan !== 'BELUM')) {
        return NextResponse.json({ error: 'Penanganan sudah ditentukan untuk tiket ini' }, { status: 409 })
      }
      if (existing.status !== 'REQUEST' && existing.status !== 'PROSES') {
        return NextResponse.json({ error: 'Hanya tiket REQUEST/PROSES yang dapat mulai dikerjakan' }, { status: 409 })
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
        // Kode+nama READY → STTB otomatis terbit (dibawa saat pick up ke toko)
        data: { status: 'PROSES', penanganan: 'DI_TOKO', lokasiUnit: 'TOKO', slaFlag: false, ...(existing.noSttb ? {} : { noSttb: generateNoSttb(existing.noTiket) }) },
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
      if (existing.status === 'FINISH' || (existing.status === 'PROSES' && existing.penanganan !== 'BELUM')) {
        return NextResponse.json({ error: 'Penanganan sudah ditentukan untuk tiket ini' }, { status: 409 })
      }
      if (existing.status !== 'REQUEST' && existing.status !== 'PROSES') {
        return NextResponse.json({ error: 'Hanya tiket REQUEST/PROSES yang dapat ditarik ke workshop' }, { status: 409 })
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
      const data: Record<string, unknown> = { biayaJasa: Number(body.biayaJasa) || 0 }
      if (body.deskripsiKerusakan !== undefined) data.deskripsiKerusakan = String(body.deskripsiKerusakan ?? '')
      const updated = await db.serviceRequest.update({
        where: { id: ticketId },
        data,
        include: { unitAsset: true, parts: { include: { sparepart: true } } },
      })
      await logAudit({
        aksi: 'UPDATE_BIAYA_JASA',
        entitas: 'service_request',
        entitasId: existing.noTiket,
        deskripsi: body.deskripsiKerusakan !== undefined
          ? `Deskripsi & biaya jasa tiket diperbarui (jasa Rp ${Number(body.biayaJasa).toLocaleString('id-ID')})`
          : `Biaya jasa diubah menjadi Rp ${Number(body.biayaJasa).toLocaleString('id-ID')}`,
        aktor,
      })
      await autoGitBackup(aksi, 'service_request', existing.noTiket, aktor)
      return NextResponse.json(updated)
    }

    // Aksi khusus: siapkan pesan WA ke produsen (1 klik → otomatis terkirim).
    // Mengembalikan waUrl (wa.me dengan teks terisi) + mencatat pengiriman.
    if (aksi === 'KIRIM_PRODUSEN_WA') {
      const [cfg, produsen] = await Promise.all([
        db.pengaturan.findUnique({ where: { kunci: 'kontak_produsen' } }),
        db.pengguna.findFirst({ where: { role: 'PRODUSEN', aktif: true }, orderBy: { id: 'asc' } }),
      ])
      const noWa = (cfg?.nilai ?? '').replace(/\D/g, '') || (produsen?.noWa ?? '').replace(/\D/g, '')
      if (!noWa) {
        return NextResponse.json(
          { error: 'Nomor WA produsen belum diisi (Pengaturan → Profil → No. WA Produsen)' },
          { status: 409 }
        )
      }
      const unitFull = await db.unitAsset.findUnique({
        where: { id: existing.unitAssetId },
        include: { toko: { select: { kodeToko: true, namaToko: true } } },
      })
      const teks =
        `*PERMINTAAN PART* — ${existing.noTiket}\n` +
        `Unit: ${unitFull?.modelUnit ?? existing.unitAsset.modelUnit}${unitFull?.merk ? ` (${unitFull.merk})` : ''}\n` +
        `SN: ${existing.unitAsset.serialNumber}\n` +
        `Toko: ${unitFull?.toko ? `${unitFull.toko.kodeToko} — ${unitFull.toko.namaToko}` : '-'}\n` +
        `Kerusakan: ${existing.deskripsiKerusakan ?? '-'}\n` +
        `Mohon info kode & nama sparepart + ketersediaan stok.`
      await logAudit({
        aksi: 'KIRIM_PRODUSEN_WA',
        entitas: 'service_request',
        entitasId: existing.noTiket,
        deskripsi: `Permintaan part dikirim ke produsen via WA (${noWa})`,
        aktor,
      })
      const updated = await db.serviceRequest.findUnique({
        where: { id: ticketId },
        include: { unitAsset: true, parts: { include: { sparepart: true } } },
      })
      await autoGitBackup(aksi, 'service_request', existing.noTiket, aktor)
      return NextResponse.json({ ...updated, waUrl: `https://wa.me/${noWa}?text=${encodeURIComponent(teks)}` })
    }

    // Aksi khusus: input balasan produsen (KODE + NAMA part).
    // Bila kode belum ada di katalog → otomatis didaftarkan (tercollect),
    // lalu dipasang ke tiket (reserve bila stok ada, ORDER bila kosong).
    if (aksi === 'INPUT_PART_PRODUSEN') {
      if (existing.status === 'FINISH') {
        return NextResponse.json({ error: 'Tiket FINISH tidak dapat ditambah part' }, { status: 409 })
      }
      const kodePart = String(body.kodePart ?? '').trim().toUpperCase()
      const namaPart = String(body.namaPart ?? '').trim()
      const qty = Math.max(1, Math.trunc(Number(body.qty) || 1))
      if (!kodePart || !namaPart) {
        return NextResponse.json({ error: 'Kode dan nama sparepart dari produsen wajib diisi' }, { status: 400 })
      }
      let sp = await db.masterSparepart.findUnique({ where: { kodePart } })
      if (!sp) {
        const unitFull = await db.unitAsset.findUnique({ where: { id: existing.unitAssetId } })
        sp = await db.masterSparepart.create({
          data: {
            kodePart,
            namaPart,
            brandKompatibel: unitFull?.merk ?? '',
            supplier: '',
            stokJual: 0,
            stokGaransi: 0,
            stokInventory: 0,
            reorderLimit: 5,
            hargaKlaim: 0,
          },
        })
        await logAudit({
          aksi: 'CREATE_MASTER_SPAREPART',
          entitas: 'master_sparepart',
          entitasId: sp.kodePart,
          deskripsi: `Kode baru dari produsen otomatis masuk katalog: ${sp.namaPart}`,
          aktor,
        })
      }
      await catatBankKode({
        kode: sp.kodePart,
        namaPart: sp.namaPart,
        brandKompatibel: sp.brandKompatibel ?? '',
        produsen: sp.supplier ?? '',
        sumber: 'PRODUSEN',
      })
      let statusPart = 'ORDER_PRODUSEN'
      let statusKonfirmasi = 'MENUNGGU'
      // Cek duplikat SEBELUM menyentuh stok (agar 409 tidak membocorkan reserve)
      const partLama = existing.parts.find((p) => p.sparepartId === sp.id)
      const stokCukup = sp.stokInventory >= qty
      if (partLama && partLama.statusPart === 'READY' && !stokCukup) {
        return NextResponse.json(
          { error: `Part ${sp.kodePart} sudah READY ×${partLama.qty} di tiket ini — stok tambahan tidak cukup. Restock dulu atau kurangi qty.` },
          { status: 409 }
        )
      }
      if (stokCukup) {
        const ambilJual = Math.min(sp.stokJual, qty)
        await db.masterSparepart.update({
          where: { id: sp.id },
          data: {
            stokJual: { decrement: ambilJual },
            stokGaransi: { decrement: qty - ambilJual },
            stokInventory: { decrement: qty },
            totalTerpakai: { increment: qty },
          },
        })
        statusPart = 'READY'
        statusKonfirmasi = 'READY'
        await backupSparepartToGit('RESERVE', sp.kodePart, aktor)
      }
      // Cegah part ganda tanpa warning: kode yang sama digabung bila statusnya
      // sama; bila beda status, baris baru dicatat eksplisit (jujur, tidak diam-diam).
      if (partLama && partLama.statusPart === statusPart) {
        await db.serviceRequestPart.update({ where: { id: partLama.id }, data: { qty: partLama.qty + qty } })
        await logAudit({
          aksi: 'INPUT_PART_PRODUSEN',
          entitas: 'service_request',
          entitasId: existing.noTiket,
          deskripsi: `Balasan produsen digabung ke baris yang sama: ${sp.kodePart} +${qty} (total ${partLama.qty + qty}, ${statusPart}, sumber PRODUSEN)`,
          aktor,
        })
      } else {
        await db.serviceRequestPart.create({
          data: { serviceRequestId: ticketId, sparepartId: sp.id, qty, statusPart, statusKonfirmasi, sumberPart: 'PRODUSEN' },
        })
        await logAudit({
          aksi: 'INPUT_PART_PRODUSEN',
          entitas: 'service_request',
          entitasId: existing.noTiket,
          deskripsi: partLama
            ? `Balasan produsen dicatat terpisah (beda status): ${sp.kodePart} ×${qty} → ${statusPart} (sumber PRODUSEN)`
            : `Balasan produsen dicatat: ${sp.kodePart} ×${qty} → ${statusPart} (sumber PRODUSEN)`,
          aktor,
        })
      }
      // Aturan inti: STTB terbit SEJAK REQUEST PART (READY ataupun ORDER) —
      // tidak menunggu part datang. READY → sekalian otomatis PROSES.
      if (existing.status === 'REQUEST' && (!existing.noSttb || statusPart === 'READY')) {
        const noSttbAuto = existing.noSttb ?? generateNoSttb(existing.noTiket)
        const jadiProses = statusPart === 'READY'
        await db.serviceRequest.update({
          where: { id: ticketId },
          data: { ...(jadiProses ? { status: 'PROSES' } : {}), noSttb: noSttbAuto },
        })
        await logAudit({
          aksi: jadiProses ? 'AUTO_PROSES' : 'STTB_TERBIT_REQUEST',
          entitas: 'service_request',
          entitasId: existing.noTiket,
          deskripsi: jadiProses
            ? `Kode & nama part terinput dan READY → status otomatis REQUEST → PROSES + STTB ${noSttbAuto} terbit (dibawa saat pick up)`
            : `Part diminta (${statusPart}) → STTB ${noSttbAuto} terbit sejak request part (dibawa saat pick up, tanpa menunggu part datang)`,
          aktor,
        })
      }
      const updated = await db.serviceRequest.findUnique({
        where: { id: ticketId },
        include: { unitAsset: true, parts: { include: { sparepart: true } } },
      })
      await autoGitBackup(aksi, 'service_request', existing.noTiket, aktor)
      return NextResponse.json(updated)
    }

    // Aksi khusus: tambah sparepart saat pengerjaan (PROSES/REQUEST).
    // Dua cara: pilih dari katalog (sparepartId) ATAU tulis kode+nama baru
    // (kodePart+namaPart — otomatis didaftarkan bila belum ada, agar part
    // tambahan selalu bisa dimasukkan walau belum ada di katalog).
    // Stok cukup → READY (direserve); stok kurang → ORDER_PRODUSEN + menunggu konfirmasi.
    if (aksi === 'TAMBAH_PART') {
      if (existing.status === 'FINISH') {
        return NextResponse.json({ error: 'Tiket FINISH tidak dapat ditambah part' }, { status: 409 })
      }
      const qty = Math.max(1, Math.trunc(Number(body.qty) || 1))
      let sp = null as null | { id: number; kodePart: string; namaPart: string; stokJual: number; stokGaransi: number; stokInventory: number }
      if (Number(body.sparepartId) > 0) {
        sp = await db.masterSparepart.findUnique({ where: { id: Number(body.sparepartId) } })
        if (!sp) {
          return NextResponse.json({ error: 'Sparepart tidak ditemukan' }, { status: 404 })
        }
      } else {
        const kodePart = String(body.kodePart ?? '').trim().toUpperCase()
        const namaPart = String(body.namaPart ?? '').trim()
        if (!kodePart || !namaPart) {
          return NextResponse.json({ error: 'Pilih part dari katalog ATAU isi kode + nama part tambahan' }, { status: 400 })
        }
        sp = await db.masterSparepart.findUnique({ where: { kodePart } })
        if (!sp) {
          const unitFull = await db.unitAsset.findUnique({ where: { id: existing.unitAssetId } })
          sp = await db.masterSparepart.create({
            data: {
              kodePart,
              namaPart,
              brandKompatibel: unitFull?.merk ?? '',
              supplier: '',
              stokJual: 0,
              stokGaransi: 0,
              stokInventory: 0,
              reorderLimit: 5,
              hargaKlaim: 0,
            },
          })
          await logAudit({
            aksi: 'CREATE_MASTER_SPAREPART',
            entitas: 'master_sparepart',
            entitasId: sp.kodePart,
            deskripsi: `Part tambahan dari workshop otomatis masuk katalog: ${sp.namaPart}`,
            aktor,
          })
        }
        await catatBankKode({
          kode: sp.kodePart,
          namaPart: sp.namaPart,
          brandKompatibel: (sp as { brandKompatibel?: string }).brandKompatibel ?? '',
          sumber: 'WORKSHOP',
        })
      }
      let statusPart = 'ORDER_PRODUSEN'
      let statusKonfirmasi = 'MENUNGGU'
      // Cek duplikat SEBELUM menyentuh stok (agar 409 tidak membocorkan reserve)
      const partLama = existing.parts.find((p) => p.sparepartId === sp.id)
      const stokCukup = sp.stokInventory >= qty
      if (partLama && partLama.statusPart === 'READY' && !stokCukup) {
        return NextResponse.json(
          { error: `Part ${sp.kodePart} sudah READY ×${partLama.qty} di tiket ini — stok tambahan tidak cukup. Restock dulu atau kurangi qty.` },
          { status: 409 }
        )
      }
      if (stokCukup) {
        const ambilJual = Math.min(sp.stokJual, qty)
        await db.masterSparepart.update({
          where: { id: sp.id },
          data: {
            stokJual: { decrement: ambilJual },
            stokGaransi: { decrement: qty - ambilJual },
            stokInventory: { decrement: qty },
            totalTerpakai: { increment: qty },
          },
        })
        statusPart = 'READY'
        statusKonfirmasi = 'READY'
      }
      if (partLama && partLama.statusPart === statusPart) {
        await db.serviceRequestPart.update({ where: { id: partLama.id }, data: { qty: partLama.qty + qty } })
        await logAudit({
          aksi: 'TAMBAH_PART_SERVICE',
          entitas: 'service_request',
          entitasId: existing.noTiket,
          deskripsi: `Tambah part digabung ke baris yang sama: ${sp.kodePart} +${qty} (total ${partLama.qty + qty}, ${statusPart})`,
          aktor,
        })
      } else {
        await db.serviceRequestPart.create({
          data: { serviceRequestId: ticketId, sparepartId: sp.id, qty, statusPart, statusKonfirmasi },
        })
        await logAudit({
          aksi: 'TAMBAH_PART_SERVICE',
          entitas: 'service_request',
          entitasId: existing.noTiket,
          deskripsi: partLama
            ? `Tambah part dicatat terpisah (beda status): ${sp.kodePart} ×${qty} → ${statusPart}`
            : statusPart === 'READY'
              ? `Tambah part saat pengerjaan: ${sp.kodePart} ×${qty} READY (stok direserve)`
              : `Tambah part saat pengerjaan: ${sp.kodePart} ×${qty} stok tidak cukup → ORDER ke produsen`,
          aktor,
        })
      }
      if (statusPart === 'READY') {
        await backupSparepartToGit('RESERVE', sp.kodePart, aktor)
      }
      // Aturan inti: STTB terbit SEJAK REQUEST PART (READY ataupun ORDER) —
      // tidak menunggu part datang. READY → sekalian otomatis PROSES.
      if (existing.status === 'REQUEST' && (!existing.noSttb || statusPart === 'READY')) {
        const noSttbAuto = existing.noSttb ?? generateNoSttb(existing.noTiket)
        const jadiProses = statusPart === 'READY'
        await db.serviceRequest.update({
          where: { id: ticketId },
          data: { ...(jadiProses ? { status: 'PROSES' } : {}), noSttb: noSttbAuto },
        })
        await logAudit({
          aksi: jadiProses ? 'AUTO_PROSES' : 'STTB_TERBIT_REQUEST',
          entitas: 'service_request',
          entitasId: existing.noTiket,
          deskripsi: jadiProses
            ? `Kode & nama part terinput dan READY → status otomatis REQUEST → PROSES + STTB ${noSttbAuto} terbit (dibawa saat pick up)`
            : `Part diminta (${statusPart}) → STTB ${noSttbAuto} terbit sejak request part (dibawa saat pick up, tanpa menunggu part datang)`,
          aktor,
        })
      }
      const updated = await db.serviceRequest.findUnique({
        where: { id: ticketId },
        include: { unitAsset: true, parts: { include: { sparepart: true } } },
      })
      await autoGitBackup(aksi, 'service_request', existing.noTiket, aktor)
      return NextResponse.json(updated)
    }

    // Aksi koreksi: hapus baris part yang salah input (kode/qty keliru).
    // Hanya untuk tiket non-FINISH. Stok yang pernah direserve dikembalikan:
    // READY + konfirmasi READY = stok katalog direserve → kembalikan ke stok;
    // READY via penerimaan order (konfirmasi masih MENUNGGU) = stok brand tak
    // tersentuh → hanya kurangi hitungan terpakai; ORDER = hapus baris saja.
    if (aksi === 'HAPUS_PART') {
      // Tiket FINISH riwayatnya terkunci — KECUALI koreksi disengaja Admin
      // Workshop/Manager (flag `koreksiSelesai`): tiket diberi tanda "(edited)".
      if (existing.status === 'FINISH' && !bolehKoreksiSelesai(body.koreksiSelesai, session)) {
        return NextResponse.json(
          { error: `Tiket FINISH tidak dapat dihapus part-nya (riwayat terkunci — koreksi hanya oleh Admin Workshop/Manager${session && ['ADMIN_WORKSHOP', 'MANAGER'].includes(session.role) ? ' melalui tombol koreksi dengan konfirmasi' : ''})` },
          { status: 409 }
        )
      }
      const partId = Number(body.partId)
      if (!partId) {
        return NextResponse.json({ error: 'Baris part wajib dipilih' }, { status: 400 })
      }
      const baris = existing.parts.find((p) => p.id === partId)
      if (!baris) {
        return NextResponse.json({ error: 'Part tidak ditemukan di tiket ini' }, { status: 404 })
      }
      const direserve = baris.statusPart === 'READY' && baris.statusKonfirmasi === 'READY'
      if (baris.statusPart === 'READY') {
        const kembaliStok = direserve ? baris.qty : 0
        await db.masterSparepart.update({
          where: { id: baris.sparepartId },
          data: {
            ...(kembaliStok > 0 ? { stokJual: { increment: kembaliStok }, stokInventory: { increment: kembaliStok } } : {}),
            totalTerpakai: Math.max(0, (baris.sparepart.totalTerpakai ?? 0) - baris.qty),
          },
        })
        if (kembaliStok > 0) await backupSparepartToGit('RETURN', baris.sparepart.kodePart, aktor)
      }
      await db.serviceRequestPart.delete({ where: { id: baris.id } })
      // Tandai tiket yang pernah dikoreksi setelah FINISH (badge "(edited)" di UI)
      if (existing.status === 'FINISH' && session) {
        await db.serviceRequest.update({ where: { id: ticketId }, data: { editedAt: new Date(), editedBy: session.username ?? session.nama } })
      }
      await logAudit({
        aksi: 'HAPUS_PART_SERVICE',
        entitas: 'service_request',
        entitasId: existing.noTiket,
        deskripsi: `Koreksi salah input: baris ${baris.sparepart.kodePart} ×${baris.qty} (${baris.statusPart}) dihapus dari tiket${direserve ? ` — stok dikembalikan +${baris.qty}` : ''}${existing.status === 'FINISH' ? ' [TIKET FINISH — koreksi Admin/Manager]' : ''}`,
        aktor,
      })
      const updated = await db.serviceRequest.findUnique({
        where: { id: ticketId },
        include: { unitAsset: true, parts: { include: { sparepart: true } } },
      })
      await autoGitBackup(aksi, 'service_request', existing.noTiket, aktor)
      return NextResponse.json(updated)
    }

    // Aksi koreksi: ubah qty baris part (kelebihan/kekurangan input).
    // Naik → reserve tambahan (stok harus cukup bila READY); turun → stok dikembalikan.
    if (aksi === 'UBAH_QTY_PART') {
      if (existing.status === 'FINISH' && !bolehKoreksiSelesai(body.koreksiSelesai, session)) {
        return NextResponse.json(
          { error: `Tiket FINISH tidak dapat diubah part-nya (riwayat terkunci — koreksi hanya oleh Admin Workshop/Manager${session && ['ADMIN_WORKSHOP', 'MANAGER'].includes(session.role) ? ' melalui tombol koreksi dengan konfirmasi' : ''})` },
          { status: 409 }
        )
      }
      const partId = Number(body.partId)
      const qtyBaru = Math.trunc(Number(body.qty) || 0)
      if (!partId || qtyBaru < 1) {
        return NextResponse.json({ error: 'Baris part dan qty baru (≥1) wajib diisi' }, { status: 400 })
      }
      const baris = existing.parts.find((p) => p.id === partId)
      if (!baris) {
        return NextResponse.json({ error: 'Part tidak ditemukan di tiket ini' }, { status: 404 })
      }
      const selisih = qtyBaru - baris.qty
      if (selisih !== 0 && baris.statusPart === 'READY') {
        const sp = await db.masterSparepart.findUnique({ where: { id: baris.sparepartId } })
        if (!sp) {
          return NextResponse.json({ error: 'Sparepart tidak ditemukan' }, { status: 404 })
        }
        if (selisih > 0) {
          if (sp.stokInventory < selisih) {
            return NextResponse.json(
              { error: `Stok tidak cukup untuk tambah +${selisih} ${sp.kodePart} (sisa ${sp.stokInventory}). Restock dulu atau kurangi qty.` },
              { status: 409 }
            )
          }
          const ambilJual = Math.min(sp.stokJual, selisih)
          await db.masterSparepart.update({
            where: { id: sp.id },
            data: {
              stokJual: { decrement: ambilJual },
              stokGaransi: { decrement: selisih - ambilJual },
              stokInventory: { decrement: selisih },
              totalTerpakai: { increment: selisih },
            },
          })
        } else {
          const kembali = -selisih
          await db.masterSparepart.update({
            where: { id: sp.id },
            data: {
              stokJual: { increment: kembali },
              stokInventory: { increment: kembali },
              totalTerpakai: Math.max(0, (sp.totalTerpakai ?? 0) - kembali),
            },
          })
          await backupSparepartToGit('RETURN', sp.kodePart, aktor)
        }
      }
      await db.serviceRequestPart.update({
        where: { id: baris.id },
        data: {
          qty: qtyBaru,
          // Koreksi qty pada FINISH → baris ikut ditandai "(edited)"
          ...(existing.status === 'FINISH' && session ? { editedAt: new Date(), editedBy: session.username ?? session.nama } : {}),
        },
      })
      await logAudit({
        aksi: 'UBAH_QTY_PART_SERVICE',
        entitas: 'service_request',
        entitasId: existing.noTiket,
        deskripsi: `Koreksi qty: ${baris.sparepart.kodePart} ${baris.qty} → ${qtyBaru}${selisih !== 0 && baris.statusPart === 'READY' ? (selisih > 0 ? ` (reserve tambahan +${selisih})` : ` (stok dikembalikan +${-selisih})`) : ''}${existing.status === 'FINISH' ? ' [TIKET FINISH — koreksi Admin/Manager]' : ''}`,
        aktor,
      })
      if (existing.status === 'FINISH' && session) {
        await db.serviceRequest.update({ where: { id: ticketId }, data: { editedAt: new Date(), editedBy: session.username ?? session.nama } })
      }
      const updated = await db.serviceRequest.findUnique({
        where: { id: ticketId },
        include: { unitAsset: true, parts: { include: { sparepart: true } } },
      })
      await autoGitBackup(aksi, 'service_request', existing.noTiket, aktor)
      return NextResponse.json(updated)
    }

    // Aksi koreksi Admin Workshop/Manager: ubah kode/nama dan/atau qty SATU baris
    // part — termasuk tiket FINISH (kesalahan input baru ketahuan setelah selesai).
    // Setiap baris yang dikoreksi & tiketnya ditandai editedAt/editedBy → badge
    // kecil "(edited)" di UI; riwayat lengkap tersimpan di Audit Log.
    // Logika stok mengikuti aturan HAPUS_PART/UBAH_QTY_PART agar stok tetap benar.
    if (aksi === 'KOREKSI_PART') {
      if (!session || !['ADMIN_WORKSHOP', 'MANAGER'].includes(session.role)) {
        return NextResponse.json({ error: 'Koreksi part hanya oleh Admin Workshop/Manager' }, { status: 403 })
      }
      const partId = Number(body.partId)
      if (!partId) {
        return NextResponse.json({ error: 'Baris part wajib dipilih' }, { status: 400 })
      }
      const baris = existing.parts.find((p) => p.id === partId)
      if (!baris) {
        return NextResponse.json({ error: 'Part tidak ditemukan di tiket ini' }, { status: 404 })
      }
      const editedBy = session.username ?? session.nama
      const kodeInput = String(body.kodePart ?? '').trim().toUpperCase()
      const namaInput = String(body.namaPart ?? '').trim()
      const qtyInput = body.qty === undefined || body.qty === null || body.qty === '' ? baris.qty : Math.trunc(Number(body.qty) || 0)
      if (!kodeInput) {
        return NextResponse.json({ error: 'Kode part tidak boleh kosong' }, { status: 400 })
      }
      if (qtyInput < 1) {
        return NextResponse.json({ error: 'Qty minimal 1 — untuk membuang baris part pakai tombol hapus' }, { status: 400 })
      }
      const kodeBerubah = kodeInput !== baris.sparepart.kodePart
      const namaBerubah = !!namaInput && namaInput !== baris.sparepart.namaPart && !kodeBerubah
      const selisih = qtyInput - baris.qty
      if (!kodeBerubah && !namaBerubah && selisih === 0) {
        return NextResponse.json({ error: 'Tidak ada perubahan data part' }, { status: 400 })
      }
      // direserve = READY + konfirmasi READY → stok katalog benar-benar direserve.
      // READY + konfirmasi MENUNGGU (diterima order per-unit) → stok tak tersentuh,
      // hanya hitungan terpakai. ORDER_PRODUSEN → belum ada pencatatan stok.
      const direserve = baris.statusPart === 'READY' && baris.statusKonfirmasi === 'READY'
      const catatanStok: string[] = []
      let masterBaruId: number | null = null
      if (kodeBerubah) {
        // Kode salah input → relink ke master yang benar (auto-daftar bila belum ada).
        let baru = await db.masterSparepart.findUnique({ where: { kodePart: kodeInput } })
        if (!baru) {
          baru = await db.masterSparepart.create({
            data: {
              kodePart: kodeInput,
              namaPart: namaInput || baris.sparepart.namaPart,
              brandKompatibel: existing.unitAsset.merk ?? '',
              supplier: '',
              stokJual: 0,
              stokGaransi: 0,
              stokInventory: 0,
              reorderLimit: 5,
              hargaKlaim: 0,
            },
          })
          await catatBankKode({ kode: baru.kodePart, namaPart: baru.namaPart, brandKompatibel: baru.brandKompatibel ?? '', sumber: 'WORKSHOP' })
          await logAudit({
            aksi: 'CREATE_MASTER_SPAREPART',
            entitas: 'master_sparepart',
            entitasId: baru.kodePart,
            deskripsi: `Kode koreksi part otomatis masuk katalog: ${baru.namaPart} (tiket ${existing.noTiket})`,
            aktor,
          })
        } else if (namaInput && namaInput !== baru.namaPart) {
          await db.masterSparepart.update({ where: { id: baru.id }, data: { namaPart: namaInput } })
        }
        masterBaruId = baru.id
        if (baris.statusPart === 'READY') {
          // Pemakaian dibalikkan pada master LAMA (pattern HAPUS_PART) lalu
          // dipindahkan ke master BARU (part fisik memang sudah terpasang).
          if (direserve) {
            await db.masterSparepart.update({
              where: { id: baris.sparepartId },
              data: { stokJual: { increment: baris.qty }, stokInventory: { increment: baris.qty } },
            })
            catatanStok.push(`stok ${baris.sparepart.kodePart} dikembalikan +${baris.qty}`)
            await backupSparepartToGit('RETURN', baris.sparepart.kodePart, aktor)
          }
          await db.masterSparepart.update({
            where: { id: baris.sparepartId },
            data: { totalTerpakai: Math.max(0, (baris.sparepart.totalTerpakai ?? 0) - baris.qty) },
          })
          await db.masterSparepart.update({
            where: { id: baru.id },
            data: { totalTerpakai: { increment: qtyInput } },
          })
          catatanStok.push(`terpakai ${baris.sparepart.kodePart} -${baris.qty} → ${baru.kodePart} +${qtyInput}`)
        }
      } else {
        // Kode tetap — koreksi nama katalog dan/atau qty (pattern UBAH_QTY_PART).
        if (namaBerubah) {
          await db.masterSparepart.update({ where: { id: baris.sparepartId }, data: { namaPart: namaInput } })
        }
        if (selisih !== 0 && baris.statusPart === 'READY') {
          const target = await db.masterSparepart.findUnique({ where: { id: baris.sparepartId } })
          if (!target) {
            return NextResponse.json({ error: 'Sparepart tidak ditemukan' }, { status: 404 })
          }
          if (direserve) {
            if (selisih > 0) {
              if (target.stokInventory < selisih) {
                return NextResponse.json(
                  { error: `Stok tidak cukup untuk tambah +${selisih} ${target.kodePart} (sisa ${target.stokInventory}). Restock dulu atau kurangi qty.` },
                  { status: 409 }
                )
              }
              const ambilJual = Math.min(target.stokJual, selisih)
              await db.masterSparepart.update({
                where: { id: target.id },
                data: {
                  stokJual: { decrement: ambilJual },
                  stokGaransi: { decrement: selisih - ambilJual },
                  stokInventory: { decrement: selisih },
                },
              })
              catatanStok.push(`reserve tambahan +${selisih}`)
            } else {
              const kembali = -selisih
              await db.masterSparepart.update({
                where: { id: target.id },
                data: { stokJual: { increment: kembali }, stokInventory: { increment: kembali } },
              })
              catatanStok.push(`stok dikembalikan +${kembali}`)
              await backupSparepartToGit('RETURN', target.kodePart, aktor)
            }
          }
          await db.masterSparepart.update({
            where: { id: target.id },
            data: { totalTerpakai: Math.max(0, (target.totalTerpakai ?? 0) + selisih) },
          })
          catatanStok.push(`terpakai ${target.kodePart} ${selisih > 0 ? '+' : ''}${selisih}`)
        }
      }
      await db.serviceRequestPart.update({
        where: { id: baris.id },
        data: {
          ...(masterBaruId ? { sparepartId: masterBaruId } : {}),
          qty: qtyInput,
          editedAt: new Date(),
          editedBy,
        },
      })
      await db.serviceRequest.update({ where: { id: ticketId }, data: { editedAt: new Date(), editedBy } })
      const kataKode = kodeBerubah ? `kode ${baris.sparepart.kodePart} → ${kodeInput}` : `kode ${baris.sparepart.kodePart}`
      const kataNama = namaInput && namaInput !== baris.sparepart.namaPart ? `, nama "${baris.sparepart.namaPart}" → "${namaInput}"` : ''
      const kataQty = selisih !== 0 ? `, qty ${baris.qty} → ${qtyInput}` : ''
      await logAudit({
        aksi: 'KOREKSI_PART_SERVICE',
        entitas: 'service_request',
        entitasId: existing.noTiket,
        deskripsi: `Koreksi part [edited]: ${kataKode}${kataNama}${kataQty}${catatanStok.length ? ` — ${catatanStok.join(', ')}` : ''}${existing.statusKlaimProdusen !== 'DRAFT' ? ` (klaim ${existing.statusKlaimProdusen} — nilai klaim mengikuti koreksi)` : ''}`,
        aktor,
      })
      await autoGitBackup(aksi, 'service_request', existing.noTiket, aktor)
      const updated = await db.serviceRequest.findUnique({
        where: { id: ticketId },
        include: { unitAsset: true, parts: { include: { sparepart: true } } },
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
        // Part dipesan KHUSUS untuk unit ini → TIDAK menyentuh stok brand
        // (stokJual/stokGaransi/stokInventory), hanya dicatat sebagai terpakai
        // agar jumlah pemakaian part tetap terlihat di inventory.
        await db.masterSparepart.update({
          where: { id: p.sparepartId },
          data: { totalTerpakai: { increment: p.qty } },
        })
      }
      // Item order-email yang menempel ke tiket ini (Reorder Email / alur SV-EM)
      // ikut ditandai DATANG — part fisik datang & dipasang, tidak lagi menunggu.
      const emailKena = await db.orderEmailPart.updateMany({
        where: { serviceRequestId: ticketId, status: { in: ['PENDING', 'TERKIRIM'] } },
        data: { status: 'DATANG' },
      })
      await logAudit({
        aksi: 'TERIMA_PART_PRODUSEN',
        entitas: 'service_request',
        entitasId: existing.noTiket,
        deskripsi: `${parts.length} part diterima dari produsen dan dialokasikan ke tiket (order per-unit: stok brand tidak berubah, terpakai +${parts.reduce((n, p) => n + p.qty, 0)})${emailKena.count > 0 ? ` — ${emailKena.count} item order email ikut DATANG` : ''}`,
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
