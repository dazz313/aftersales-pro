import { NextResponse } from 'next/server'
import { getGatewayConfig, sendGatewayMessage, type GatewayChannel } from '@/lib/gateway'
import { requireActiveSession } from '@/lib/auth-server'

const mask = (s: string) => (s ? '••••••••' : '')

/**
 * GET /api/gateway/test — status koneksi gateway (token disamarkan).
 */
export async function GET(request: Request) {
  try {
    const { session, denied } = await requireActiveSession(request)
    if (denied) return denied
    void session
    const cfg = await getGatewayConfig()
    return NextResponse.json({
      whatsapp: {
        aktif: cfg.waAktif,
        url: cfg.waUrl,
        token: mask(cfg.waToken),
        terkonfigurasi: cfg.waAktif && !!cfg.waUrl,
      },
      telegram: {
        aktif: cfg.tgAktif,
        token: mask(cfg.tgToken),
        chatId: cfg.tgChatId,
        terkonfigurasi: cfg.tgAktif && !!cfg.tgToken && !!cfg.tgChatId,
      },
      channelDefault: cfg.channelDefault,
    })
  } catch (error) {
    console.error('Gateway status error:', error)
    return NextResponse.json({ error: 'Gagal memuat status gateway' }, { status: 500 })
  }
}

/**
 * POST /api/gateway/test { channel } — kirim pesan uji "Tes koneksi".
 */
export async function POST(request: Request) {
  try {
    const { session, denied } = await requireActiveSession(request)
    if (denied) return denied
    void session
    const body = await request.json().catch(() => ({}))
    const channel: GatewayChannel = body.channel === 'TELEGRAM' ? 'TELEGRAM' : 'WHATSAPP'
    const hasil = await sendGatewayMessage(channel, 'Tes koneksi gateway AfterSales Pro — abaikan pesan ini.')
    return NextResponse.json({ ok: hasil.ok, mode: hasil.mode, detail: hasil.detail, channel })
  } catch (error) {
    console.error('Gateway test error:', error)
    return NextResponse.json({ error: 'Tes gateway gagal' }, { status: 500 })
  }
}
