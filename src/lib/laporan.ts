import { db } from '@/lib/db'
import { logAudit, generateNoTiket, generateNoSttb } from '@/lib/audit'
import { sendGatewayMessage, labelChannel, type GatewayChannel } from '@/lib/gateway'

export type { GatewayChannel }

export interface LaporanInput {
  pesan: string
  pengirim: string
  channel: GatewayChannel
  foto: string | null
}

/** Parse: #LAPOR [Nomor_Seri] [Kode_Sparepart] [Deskripsi_Kerusakan] */
export function parseLaporanCommand(text: string) {
  const match = text.trim().match(/^#LAPOR\s+(\S+)\s+(\S+)\s+(.+)$/i)
  if (!match) return null
  return { command: '#LAPOR', serial: match[1].toUpperCase(), kodePart: match[2].toUpperCase(), deskripsi: match[3].trim() }
}

async function balas(channel: GatewayChannel, text: string, meta: Record<string, unknown>) {
  const fwd = await sendGatewayMessage(channel, text)
  await db.waMessage.create({
    data: { pengirim: 'GATEWAY-BOT', channel, tipe: 'OUT', pesan: text, meta: JSON.stringify({ ...meta, mode: fwd.mode }) },
  })
  return fwd
}

/**
 * Proses satu laporan teks sampai tuntas (dipakai webhook WA, webhook Telegram,
 * dan persetujuan Inbox). Return serializable — aman di-return sebagai JSON.
 */
export async function prosesLaporanTeks(input: LaporanInput) {
  const { pesan, pengirim, channel, foto } = input
  const fotoTerkirim = foto ?? null

  await db.waMessage.create({
    data: { pengirim, channel, tipe: 'IN', pesan, meta: JSON.stringify({ foto: fotoTerkirim }) },
  })

  const cmd = parseLaporanCommand(pesan)
  if (!cmd) {
    const replyText =
      '⚠️ Format laporan tidak dikenali.\n\nGunakan format:\n*#LAPOR [Nomor_Seri] [Kode_Sparepart] [Deskripsi_Kerusakan]*\n\nContoh:\n#LAPOR SN-ACSP-2023-00101 PRT-CMP-01 AC tidak dingin, kompresor mati'
    const fwd = await balas(channel, replyText, { aksi: 'FORMAT_INVALID' })
    return { ok: true, reply: replyText, aksi: 'FORMAT_INVALID', channel, mode: fwd.mode }
  }

  const unit = await db.unitAsset.findUnique({
    where: { serialNumber: cmd.serial },
    include: { toko: true, customer: true },
  })
  if (!unit) {
    const replyText = `❌ Nomor seri *${cmd.serial}* tidak ditemukan di database unit asset.\nPastikan barcode unit terdaftar, atau hubungi Admin Workshop.`
    const fwd = await balas(channel, replyText, { aksi: 'SERIAL_NOT_FOUND' })
    return { ok: true, reply: replyText, aksi: 'SERIAL_NOT_FOUND', channel, mode: fwd.mode }
  }

  const sparepart = await db.masterSparepart.findUnique({ where: { kodePart: cmd.kodePart } })
  if (!sparepart) {
    const replyText = `❌ Kode sparepart *${cmd.kodePart}* tidak dikenali di katalog inventory.\nPeriksa kembali kode part, atau hubungi Admin Workshop.`
    const fwd = await balas(channel, replyText, { aksi: 'PART_NOT_FOUND' })
    return { ok: true, reply: replyText, aksi: 'PART_NOT_FOUND', channel, mode: fwd.mode }
  }

  const noTiket = await generateNoTiket()
  const garansiInfo =
    unit.statusGaransi === 'GARANSI'
      ? `Unit terdeteksi *GARANSI* (${unit.modelUnit})`
      : `Unit terdeteksi *NON-GARANSI* (${unit.modelUnit})`
  const tokoInfo = unit.toko ? `dari ${unit.toko.namaToko} (${unit.toko.kodeToko})` : ''

  if (sparepart.stokInventory > 0) {
    await db.masterSparepart.update({
      where: { id: sparepart.id },
      data: { stokInventory: { decrement: 1 } },
    })
    const noSttb = generateNoSttb(noTiket)
    const ticket = await db.serviceRequest.create({
      data: {
        noTiket,
        unitAssetId: unit.id,
        status: 'PROSES',
        noSttb,
        deskripsiKerusakan: cmd.deskripsi,
        fotoKerusakanWa: fotoTerkirim,
        biayaJasa: 0,
        parts: { create: [{ sparepartId: sparepart.id, qty: 1, statusPart: 'READY' }] },
      },
    })
    const replyText = `✅ ${garansiInfo} ${tokoInfo}.\n\n*Tiket #${noTiket} Berhasil Terbuat.*\nPart *READY*: ${sparepart.namaPart} (sisa stok ${sparepart.stokInventory - 1}).\n📄 Link STTB (PDF): /api/sttb/${noTiket}\n\nSilakan teknisi mengangkut unit ke workshop dengan dokumen STTB tersebut.`
    const fwd = await balas(channel, replyText, { noTiket, aksi: 'TIKET_DIBUAT_PART_READY', noSttb })
    await logAudit({
      aksi: 'CREATE_SERVICE_REQUEST',
      entitas: 'service_request',
      entitasId: noTiket,
      deskripsi: `Tiket otomatis via ${labelChannel(channel)} Bot: unit ${unit.serialNumber}, part ${sparepart.kodePart} READY (stok direserve) → status PROSES, STTB ${noSttb} diterbitkan otomatis`,
      aktor: `${labelChannel(channel)}-BOT`,
    })
    return { ok: true, reply: replyText, aksi: 'TIKET_DIBUAT_PART_READY', noTiket, noSttb, tiketId: ticket.id, channel, mode: fwd.mode }
  } else {
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
    const fwd = await balas(channel, replyText, { noTiket, aksi: 'PART_ORDER_PRODUSEN', notifikasiProdusen: true })
    await logAudit({
      aksi: 'CREATE_SERVICE_REQUEST',
      entitas: 'service_request',
      entitasId: noTiket,
      deskripsi: `Tiket otomatis via ${labelChannel(channel)} Bot: unit ${unit.serialNumber}, part ${sparepart.kodePart} KOSONG → ORDER_PRODUSEN, notifikasi dikirim ke produsen`,
      aktor: `${labelChannel(channel)}-BOT`,
    })
    return { ok: true, reply: replyText, aksi: 'PART_ORDER_PRODUSEN', noTiket, tiketId: ticket.id, channel, mode: fwd.mode }
  }
}
