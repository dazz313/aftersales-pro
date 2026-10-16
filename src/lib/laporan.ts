import { db } from '@/lib/db'
import { logAudit, generateNoTiket, generateNoSttb } from '@/lib/audit'
import { isGaransi } from '@/lib/types'
import { autoGitBackup, backupSparepartToGit } from '@/lib/git-backup'
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
 * Setiap pesan gateway mengubah data (IN + balasan OUT) → selalu backup git.
 */
export async function prosesLaporanTeks(input: LaporanInput) {
  const out = await prosesLaporanTeksInner(input)
  await autoGitBackup('GATEWAY', 'gateway_message', (out as { aksi?: string }).aksi ?? '', input.pengirim)
  return out
}

async function prosesLaporanTeksInner(input: LaporanInput) {
  const { pesan, pengirim, channel, foto } = input
  const fotoTerkirim = foto ?? null

  await db.waMessage.create({
    data: { pengirim, channel, tipe: 'IN', pesan, meta: JSON.stringify({ foto: fotoTerkirim }) },
  })

  const cmd = parseLaporanCommand(pesan)
  if (!cmd) {
    const replyText =
      '⚠️ Format laporan tidak dikenali.\n\nGunakan format:\n*#LAPOR [Nomor_Seri] [Kode_Sparepart] [Deskripsi_Kerusakan]*\n\nContoh:\n#LAPOR SN-KPAS-2023-00101 PRT-DNM-01 Kipas tidak berputar, dinamo mati'
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

  // Cegah tiket ganda (mis. retry webhook / laporan dikirim 2×):
  // unit yang masih punya tiket aktif dipakai ulang, bukan dibuat baru.
  const tiketAktif = await db.serviceRequest.findFirst({
    where: { unitAssetId: unit.id, status: { in: ['REQUEST', 'PROSES'] } },
    orderBy: { createdAt: 'desc' },
  })
  if (tiketAktif) {
    const replyText =
      `⚠️ Unit *${unit.serialNumber}* sudah memiliki tiket aktif *#${tiketAktif.noTiket}* (status ${tiketAktif.status}).\n` +
      `Laporan dicatat tanpa membuat tiket ganda — pantau progres pada tiket tersebut.`
    const fwd = await balas(channel, replyText, { noTiket: tiketAktif.noTiket, aksi: 'TIKET_DUPLIKAT_DITOLAK' })
    await logAudit({
      aksi: 'TIKET_DUPLIKAT_DITOLAK',
      entitas: 'service_request',
      entitasId: tiketAktif.noTiket,
      deskripsi: `Laporan via ${labelChannel(channel)} Bot ditolak duplikat: unit ${unit.serialNumber} masih punya tiket aktif`,
      aktor: `${labelChannel(channel)}-BOT`,
    })
    return { ok: true, reply: replyText, aksi: 'TIKET_DUPLIKAT_DITOLAK', noTiket: tiketAktif.noTiket, tiketId: tiketAktif.id, channel, mode: fwd.mode }
  }

  const noTiket = await generateNoTiket()
  const garansiInfo =
    isGaransi(unit.statusGaransi)
      ? `Unit terdeteksi *GARANSI* (${unit.modelUnit})`
      : `Unit terdeteksi *NON-GARANSI* (${unit.modelUnit})`
  const tokoInfo = unit.toko ? `dari ${unit.toko.namaToko} (${unit.toko.kodeToko})` : ''

  if (sparepart.stokInventory > 0) {
    // Reserve: ambil dari stok BISA JUAL dulu, sisa ke stok GARANSI; total selalu sinkron.
    const ambilJual = Math.min(sparepart.stokJual, 1)
    const ambilGaransi = 1 - ambilJual
    await db.masterSparepart.update({
      where: { id: sparepart.id },
      data: {
        stokJual: { decrement: ambilJual },
        stokGaransi: { decrement: ambilGaransi },
        stokInventory: { decrement: 1 },
        totalTerpakai: { increment: 1 },
      },
    })
    const noSttb = generateNoSttb(noTiket)
    const ticket = await db.serviceRequest.create({
      data: {
        noTiket,
        unitAssetId: unit.id,
        status: 'PROSES',
        noSttb,
        sumberLaporan: 'WA_BOT',
        lokasiUnit: 'WORKSHOP',
        penanganan: 'TARIK_WORKSHOP',
        deskripsiKerusakan: cmd.deskripsi,
        fotoKerusakanWa: fotoTerkirim,
        biayaJasa: 0,
        parts: { create: [{ sparepartId: sparepart.id, qty: 1, statusPart: 'READY', statusKonfirmasi: 'READY' }] },
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
    await backupSparepartToGit('RESERVE', sparepart.kodePart, `${labelChannel(channel)}-BOT`)
    return { ok: true, reply: replyText, aksi: 'TIKET_DIBUAT_PART_READY', noTiket, noSttb, tiketId: ticket.id, channel, mode: fwd.mode }
  } else {
    const ticket = await db.serviceRequest.create({
      data: {
        noTiket,
        unitAssetId: unit.id,
        status: 'REQUEST',
        sumberLaporan: 'WA_BOT',
        lokasiUnit: 'TOKO',
        penanganan: 'BELUM',
        deskripsiKerusakan: cmd.deskripsi,
        fotoKerusakanWa: fotoTerkirim,
        biayaJasa: 0,
        parts: { create: [{ sparepartId: sparepart.id, qty: 1, statusPart: 'ORDER_PRODUSEN', statusKonfirmasi: 'MENUNGGU' }] },
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
