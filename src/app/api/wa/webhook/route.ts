import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logAudit, generateNoTiket, generateNoSttb } from '@/lib/audit'

/**
 * WhatsApp Gateway Webhook Engine (Section 6 PRD)
 *
 * Command standard: #LAPOR [Nomor_Seri] [Kode_Sparepart] [Deskripsi_Kerusakan]
 *
 * Processing rules:
 * 1. Terima payload (teks & gambar) dari WA Gateway
 * 2. Serial & Warranty Check: cari serial_number di unit_asset → status garansi + toko asal
 * 3. Cek stok part:
 *    - READY: kurangi stok, buat part READY, tiket + draft STTB, balas grup
 *    - KOSONG: status ORDER_PRODUSEN, notifikasi permintaan ke produsen
 */

interface ParsedCommand {
  command: string
  serial: string
  kodePart: string
  deskripsi: string
}

function parseCommand(text: string): ParsedCommand | null {
  // Format: #LAPOR SN-XXX PRT-XXX deskripsi bebas...
  const match = text.trim().match(/^#LAPOR\s+(\S+)\s+(\S+)\s+(.+)$/i)
  if (!match) return null
  return {
    command: '#LAPOR',
    serial: match[1].toUpperCase(),
    kodePart: match[2].toUpperCase(),
    deskripsi: match[3].trim(),
  }
}

// POST /api/wa/webhook - menerima pesan dari WA Gateway
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const pengirim: string = body.pengirim || 'UNKNOWN'
    const pesan: string = body.pesan || ''
    const fotoTerkirim: string | null = body.foto ?? null

    // Log pesan masuk (IN)
    await db.waMessage.create({
      data: {
        pengirim,
        tipe: 'IN',
        pesan,
        meta: JSON.stringify({ foto: fotoTerkirim }),
      },
    })

    // Parse command
    const cmd = parseCommand(pesan)
    if (!cmd) {
      const replyText =
        '⚠️ Format laporan tidak dikenali.\n\nGunakan format:\n*#LAPOR [Nomor_Seri] [Kode_Sparepart] [Deskripsi_Kerusakan]*\n\nContoh:\n#LAPOR SN-ACSP-2023-00101 PRT-CMP-01 AC tidak dingin, kompresor mati'
      await db.waMessage.create({
        data: { pengirim: 'WA-BOT', tipe: 'OUT', pesan: replyText, meta: JSON.stringify({ aksi: 'FORMAT_INVALID' }) },
      })
      return NextResponse.json({ ok: true, reply: replyText, aksi: 'FORMAT_INVALID' })
    }

    // ===== Step 2: Serial & Warranty Check =====
    const unit = await db.unitAsset.findUnique({
      where: { serialNumber: cmd.serial },
      include: { toko: true, customer: true },
    })
    if (!unit) {
      const replyText = `❌ Nomor seri *${cmd.serial}* tidak ditemukan di database unit asset.\nPastikan barcode unit terdaftar, atau hubungi Admin Workshop.`
      await db.waMessage.create({
        data: { pengirim: 'WA-BOT', tipe: 'OUT', pesan: replyText, meta: JSON.stringify({ aksi: 'SERIAL_NOT_FOUND' }) },
      })
      return NextResponse.json({ ok: true, reply: replyText, aksi: 'SERIAL_NOT_FOUND' })
    }

    // ===== Step 3: Pengecekan Stok Part =====
    const sparepart = await db.masterSparepart.findUnique({ where: { kodePart: cmd.kodePart } })
    if (!sparepart) {
      const replyText = `❌ Kode sparepart *${cmd.kodePart}* tidak dikenali di katalog konsinyasi.\nPeriksa kembali kode part, atau hubungi Admin Workshop.`
      await db.waMessage.create({
        data: { pengirim: 'WA-BOT', tipe: 'OUT', pesan: replyText, meta: JSON.stringify({ aksi: 'PART_NOT_FOUND' }) },
      })
      return NextResponse.json({ ok: true, reply: replyText, aksi: 'PART_NOT_FOUND' })
    }

    const noTiket = await generateNoTiket()
    const garansiInfo =
      unit.statusGaransi === 'GARANSI'
        ? `Unit terdeteksi *GARANSI* (${unit.modelUnit})`
        : `Unit terdeteksi *NON-GARANSI* (${unit.modelUnit})`
    const tokoInfo = unit.toko ? `dari ${unit.toko.namaToko} (${unit.toko.kodeToko})` : ''

    if (sparepart.stokKonsinyasi > 0) {
      // ===== Part Available: reserve stok, tiket langsung PROSES + STTB (PRD 3.2 step 2) =====
      await db.masterSparepart.update({
        where: { id: sparepart.id },
        data: { stokKonsinyasi: { decrement: 1 } },
      })
      const noSttb = generateNoSttb(noTiket)
      const ticket = await db.serviceRequest.create({
        data: {
          noTiket,
          unitAssetId: unit.id,
          status: 'PROSES', // PRD: part READY → tiket otomatis PROSES, STTB diterbitkan
          noSttb,
          deskripsiKerusakan: cmd.deskripsi,
          fotoKerusakanWa: fotoTerkirim,
          biayaJasa: 0,
          parts: { create: [{ sparepartId: sparepart.id, qty: 1, statusPart: 'READY' }] },
        },
      })

      const replyText = `✅ ${garansiInfo} ${tokoInfo}.\n\n*Tiket #${noTiket} Berhasil Terbuat.*\nPart *READY*: ${sparepart.namaPart} (sisa stok ${sparepart.stokKonsinyasi - 1}).\n📄 Link STTB (PDF): /api/sttb/${noTiket}\n\nSilakan teknisi mengangkut unit ke workshop dengan dokumen STTB tersebut.`

      await db.waMessage.create({
        data: {
          pengirim: 'WA-BOT',
          tipe: 'OUT',
          pesan: replyText,
          meta: JSON.stringify({ noTiket, aksi: 'TIKET_DIBUAT_PART_READY', noSttb }),
        },
      })
      await logAudit({
        aksi: 'CREATE_SERVICE_REQUEST',
        entitas: 'service_request',
        entitasId: noTiket,
        deskripsi: `Tiket otomatis via WA Bot: unit ${unit.serialNumber}, part ${sparepart.kodePart} READY (stok direserve) → status PROSES, STTB ${noSttb} diterbitkan otomatis`,
        aktor: 'WA-BOT',
      })
      return NextResponse.json({
        ok: true,
        reply: replyText,
        aksi: 'TIKET_DIBUAT_PART_READY',
        noTiket,
        noSttb,
        tiketId: ticket.id,
      })
    } else {
      // ===== Part Out of Stock: ORDER_PRODUSEN + notifikasi produsen =====
      const ticket = await db.serviceRequest.create({
        data: {
          noTiket,
          unitAssetId: unit.id,
          status: 'REQUEST',
          deskripsiKerusakan: cmd.deskripsi,
          fotoKerusakanWa: fotoTerkirim,
          biayaJasa: 0,
          parts: { create: [{ sparepartId: sparepart.id, qty: 1, statusPart: 'ORDER_PRODUSEN' }] },
        },
      })

      const replyText = `🎫 ${garansiInfo} ${tokoInfo}.\n\n*Tiket #${noTiket} Terbuat.*\n⚠️ Part *KOSONG*: ${sparepart.namaPart} (${sparepart.kodePart}).\n🔴 Notifikasi permintaan sparepart otomatis dikirim ke pihak Produsen.\n\nMenunggu pengiriman sparepart dari produsen.`

      await db.waMessage.create({
        data: {
          pengirim: 'WA-BOT',
          tipe: 'OUT',
          pesan: replyText,
          meta: JSON.stringify({ noTiket, aksi: 'PART_ORDER_PRODUSEN', notifikasiProdusen: true }),
        },
      })
      await logAudit({
        aksi: 'CREATE_SERVICE_REQUEST',
        entitas: 'service_request',
        entitasId: noTiket,
        deskripsi: `Tiket otomatis via WA Bot: unit ${unit.serialNumber}, part ${sparepart.kodePart} KOSONG → ORDER_PRODUSEN, notifikasi dikirim ke produsen`,
        aktor: 'WA-BOT',
      })
      return NextResponse.json({
        ok: true,
        reply: replyText,
        aksi: 'PART_ORDER_PRODUSEN',
        noTiket,
        tiketId: ticket.id,
      })
    }
  } catch (error) {
    console.error('WA webhook error:', error)
    return NextResponse.json({ error: 'Webhook processing gagal' }, { status: 500 })
  }
}

// GET /api/wa/webhook - riwayat pesan WA (untuk simulator chat)
export async function GET() {
  try {
    const messages = await db.waMessage.findMany({ orderBy: { createdAt: 'asc' } })
    return NextResponse.json(messages)
  } catch (error) {
    console.error('WA webhook GET error:', error)
    return NextResponse.json({ error: 'Gagal memuat riwayat pesan' }, { status: 500 })
  }
}
