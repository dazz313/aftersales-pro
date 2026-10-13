import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getGatewayConfig, isWebhookAuthorized } from '@/lib/gateway'
import { autoGitBackup } from '@/lib/git-backup'
import { saveInboxFile, isImageName, type InboxKind } from '@/lib/telegram-files'
import { scanImage } from '@/lib/vision'
import { prosesLaporanTeks } from '@/lib/laporan'
import { getInboxMode } from '@/lib/inbox'

interface TgUpdate {
  update_id?: number
  message?: {
    message_id: number
    from?: { first_name?: string; username?: string }
    chat: { id: number }
    text?: string
    caption?: string
    photo?: { file_id: string }[]
    document?: { file_id: string; mime_type?: string; file_name?: string }
  }
}

async function downloadTelegramFile(token: string, fileId: string): Promise<{ buffer: Buffer; ext: string } | null> {
  const gf = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${fileId}`, { signal: AbortSignal.timeout(15_000) })
  const gj = (await gf.json().catch(() => ({}))) as { ok?: boolean; result?: { file_path?: string } }
  const fp = gj.result?.file_path
  if (!gf.ok || !gj.ok || !fp) return null
  const dl = await fetch(`https://api.telegram.org/file/bot${token}/${fp}`, { signal: AbortSignal.timeout(30_000) })
  if (!dl.ok) return null
  const buf = Buffer.from(await dl.arrayBuffer())
  const dot = fp.lastIndexOf('.')
  return { buffer: buf, ext: dot >= 0 ? fp.slice(dot) : '.jpg' }
}

async function balasTG(token: string, chatId: number | string, text: string) {
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => undefined)
}

/** Cari barcode toko di DB (normalisasi sama seperti lookup kunjungan existing). */
async function cariTokoDariBarcode(barcode: string) {
  const norm = barcode.trim().toUpperCase().replace(/^BC-/, '')
  const direct = await db.masterToko.findFirst({
    where: { OR: [{ barcodeToko: `BC-${norm}` }, { barcodeToko: barcode.trim() }, { kodeToko: norm }] },
    select: { id: true, kodeToko: true, namaToko: true },
  }).catch(() => null)
  if (direct) return direct
  const semua = await db.masterToko.findMany({ select: { id: true, kodeToko: true, namaToko: true, barcodeToko: true } })
  return (semua.find((t) => (t.barcodeToko ?? '').toUpperCase().replace(/^BC-/, '') === norm) as { id: number; kodeToko: string; namaToko: string } | undefined) ?? null
}

function cariTeksLaporan(caption: string, barcode: string | null, ocr: string): string {
  if (/#LAPOR/i.test(caption)) return caption
  if (barcode && /#LAPOR/i.test(barcode)) return barcode
  const baris = ocr.split('\n').map((s) => s.trim()).find((s) => /#LAPOR\s+\S+\s+\S+\s+.+/i.test(s))
  return baris ?? caption
}

export async function POST(request: Request) {
  try {
    if (!isWebhookAuthorized(request)) {
      return NextResponse.json({ error: 'Webhook tidak terotorisasi' }, { status: 403 })
    }
    const body = (await request.json()) as TgUpdate
    const msg = body.message
    if (!msg) return NextResponse.json({ ok: true, aksi: 'BUKAN_PESAN' })

    const cfg = await getGatewayConfig()
    const mode = await getInboxMode()
    const chatId = msg.chat.id
    const pengirim = msg.from?.username ? `@${msg.from.username}` : (msg.from?.first_name ?? `TG-${chatId}`)
    const caption = (msg.caption ?? msg.text ?? '').trim()
    const fileId = msg.photo?.length
      ? msg.photo[msg.photo.length - 1].file_id
      : msg.document && (msg.document.mime_type?.startsWith('image/') || (msg.document.file_name && isImageName(msg.document.file_name)))
        ? msg.document.file_id
        : null

    // ---- A. Teks tanpa foto: TAHAN → inbox teks ; OTOMATIS → proses langsung ----
    if (!fileId) {
      if (mode === 'OTOMATIS') {
        const hasil = await prosesLaporanTeks({ pesan: caption, pengirim, channel: 'TELEGRAM', foto: null })
        return NextResponse.json(hasil)
      }
      await db.inboxItem.create({
        data: { pengirim, chatId: String(chatId), folder: 'SERVICE', caption: caption || null, status: 'PENDING' },
      })
      const pending = await db.inboxItem.count({ where: { status: 'PENDING' } })
      if (cfg.tgToken) await balasTG(cfg.tgToken, cfg.tgChatId || chatId, `📥 Pesan diterima & masuk PENAMPUNGAN (antrean #${pending}). Menunggu review admin di menu Inbox.`)
      await autoGitBackup('GATEWAY', 'inbox_item', 'TEKS_DITAHAN', pengirim)
      return NextResponse.json({ ok: true, aksi: 'TEKS_DITAHAN_DI_INBOX', antrean: pending })
    }

    // ---- B. Ada foto: wajib token untuk unduh ----
    if (!cfg.tgToken) {
      await db.waMessage.create({ data: { pengirim, channel: 'TELEGRAM', tipe: 'IN', pesan: caption || '(foto — token bot belum diisi)', meta: JSON.stringify({ aksi: 'FOTO_TANPA_TOKEN' }) } })
      await autoGitBackup('GATEWAY', 'gateway_message', 'FOTO_TANPA_TOKEN', pengirim)
      return NextResponse.json({ ok: true, aksi: 'FOTO_TANPA_TOKEN' })
    }
    const dl = await downloadTelegramFile(cfg.tgToken, fileId)
    if (!dl) return NextResponse.json({ ok: true, aksi: 'GAGAL_UNDUH_FILE' })

    // ---- C. Scan dulu (barcode + OCR), lalu pilah folder ----
    let barcode: string | null = null, format: string | null = null, ocrText = '', conf: number | null = null
    if (isImageName(dl.ext)) {
      const hasil = await scanImage(dl.buffer)
      barcode = hasil.barcode; format = hasil.barcodeFormat; ocrText = hasil.ocrText; conf = hasil.ocrConfidence
    }

    let kind: InboxKind = 'SERVICE'
    const tokoCocok = barcode ? await cariTokoDariBarcode(barcode) : null
    if (tokoCocok) kind = 'KUNJUNGAN'

    const { fileName, filePathRel } = await saveInboxFile(dl.buffer, dl.ext, kind)
    await db.visionScan.create({
      data: { sumber: 'TELEGRAM_WEBHOOK', pengirim, fileName, filePath: filePathRel, caption: caption || null, barcode, barcodeFormat: format, ocrText: ocrText || null, ocrConfidence: conf, status: !barcode && !ocrText ? 'GAGAL_BACA' : 'OK' },
    }).catch(() => null)
    await db.waMessage.create({
      data: { pengirim, channel: 'TELEGRAM', tipe: 'IN', pesan: caption || `(foto: ${fileName})`, meta: JSON.stringify({ foto: filePathRel, folder: kind, barcode, ocr: ocrText.slice(0, 500) }) },
    })

    // ---- D. Mode TAHAN → inbox ; OTOMATIS → proses langsung ----
    if (mode === 'TAHAN') {
      await db.inboxItem.create({
        data: {
          pengirim, chatId: String(chatId), fileName, filePath: filePathRel, folder: kind,
          caption: caption || null, barcode, barcodeFormat: format,
          ocrText: ocrText || null, ocrConfidence: conf, status: 'PENDING',
          hasilRef: tokoCocok ? `TOKO:${tokoCocok.kodeToko}` : null,
        },
      })
      const pending = await db.inboxItem.count({ where: { status: 'PENDING' } })
      await balasTG(cfg.tgToken, cfg.tgChatId || chatId, kind === 'KUNJUNGAN'
        ? `📥 Barcode toko *${tokoCocok!.namaToko} (${tokoCocok!.kodeToko})* terdeteksi → masuk folder KUNJUNGAN (antrean #${pending}).\nMenunggu konfirmasi admin di menu Inbox.`
        : `📥 Foto diterima → masuk folder SERVICE (antrean #${pending}).\n🔖 Barcode: ${barcode ?? '-'}\n📝 Teks: ${(ocrText || '-').slice(0, 300)}\n\nMenunggu review admin di menu Inbox.`)
      await autoGitBackup('GATEWAY', 'inbox_item', `DITAHAN_${kind}`, pengirim)
      return NextResponse.json({ ok: true, aksi: 'DITAHAN_DI_INBOX', folder: kind, file: filePathRel, barcode, ocrText, antrean: pending })
    }

    const teksLaporan = cariTeksLaporan(caption, barcode, ocrText)
    if (/#LAPOR/i.test(teksLaporan)) {
      const hasil = await prosesLaporanTeks({ pesan: teksLaporan, pengirim, channel: 'TELEGRAM', foto: filePathRel })
      return NextResponse.json({ folder: kind, file: filePathRel, barcode, ocrText, ...hasil })
    }
    await db.inboxItem.create({
      data: { pengirim, chatId: String(chatId), fileName, filePath: filePathRel, folder: kind, caption: caption || null, barcode, barcodeFormat: format, ocrText: ocrText || null, ocrConfidence: conf, status: 'PENDING', hasilRef: tokoCocok ? `TOKO:${tokoCocok.kodeToko}` : null },
    })
    await balasTG(cfg.tgToken, cfg.tgChatId || chatId,
      `📷 Foto tersimpan.\n🔖 Barcode: ${barcode ?? '-'}\n📝 Teks: ${(ocrText || '-').slice(0, 500)}\n\nTidak ada perintah #LAPOR — item masuk Inbox untuk review.`)
      await autoGitBackup('GATEWAY', 'inbox_item', 'FOTO_TERSIMPAN', pengirim)
      return NextResponse.json({ ok: true, aksi: 'FOTO_TERSIMPAN_TANPA_LAPOR', folder: kind, file: filePathRel, barcode, ocrText })
  } catch (error) {
    console.error('Telegram webhook error:', error)
    return NextResponse.json({ error: 'Webhook processing gagal' }, { status: 500 })
  }
}

// GET /api/telegram/webhook - health check + daftar file per folder + pindaian terakhir
export async function GET() {
  try {
    const { listInboxFiles } = await import('@/lib/telegram-files')
    const cfg = await getGatewayConfig()
    const out: Record<string, string[]> = {}
    for (const k of ['KUNJUNGAN', 'SERVICE'] as const) {
      out[k] = await listInboxFiles(k)
    }
    const scans = await db.visionScan.findMany({ orderBy: { createdAt: 'desc' }, take: 20 }).catch(() => [])
    return NextResponse.json({ ok: true, webhookSiap: cfg.tgToken !== '', files: out, scans })
  } catch (error) {
    console.error('Telegram webhook GET error:', error)
    return NextResponse.json({ error: 'Gagal memuat inbox' }, { status: 500 })
  }
}
