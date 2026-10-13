import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { isWebhookAuthorized } from '@/lib/gateway'
import { prosesLaporanTeks, type GatewayChannel } from '@/lib/laporan'

// POST /api/wa/webhook - simulator Gateway (WhatsApp / Telegram), perilaku tidak berubah
export async function POST(request: Request) {
  try {
    if (!isWebhookAuthorized(request)) {
      return NextResponse.json({ error: 'Webhook tidak terotorisasi' }, { status: 403 })
    }
    const body = await request.json()
    const result = await prosesLaporanTeks({
      pesan: body.pesan || '',
      pengirim: body.pengirim || 'UNKNOWN',
      channel: (body.channel === 'TELEGRAM' ? 'TELEGRAM' : 'WHATSAPP') as GatewayChannel,
      foto: body.foto ?? null,
    })
    return NextResponse.json(result)
  } catch (error) {
    console.error('WA webhook error:', error)
    return NextResponse.json({ error: 'Webhook processing gagal' }, { status: 500 })
  }
}

// GET /api/wa/webhook - riwayat pesan gateway (untuk simulator chat, semua channel)
export async function GET() {
  try {
    const messages = await db.waMessage.findMany({ orderBy: { createdAt: 'asc' } })
    return NextResponse.json(messages)
  } catch (error) {
    console.error('Gateway webhook GET error:', error)
    return NextResponse.json({ error: 'Gagal memuat riwayat pesan' }, { status: 500 })
  }
}
