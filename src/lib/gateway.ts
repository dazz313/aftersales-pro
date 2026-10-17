import { timingSafeEqual } from 'node:crypto'
import { db } from '@/lib/db'

/**
 * Gateway Multi-Channel (WhatsApp & Telegram)
 * -------------------------------------------
 * Konfigurasi disimpan di tabel Pengaturan (diatur lewat menu Pengaturan → Gateway):
 *  - gateway_wa_aktif       : "true" | "false"  → channel WhatsApp aktif
 *  - gateway_wa_url         : endpoint API WA gateway (Fonnte / Wablas / custom webhook)
 *  - gateway_wa_token       : token otorisasi WA gateway
 *  - gateway_tg_aktif       : "true" | "false"  → channel Telegram aktif
 *  - gateway_tg_token       : token bot Telegram (dari @BotFather)
 *  - gateway_tg_chat_id     : chat/group ID tujuan Telegram
 *  - gateway_channel_default: "WHATSAPP" | "TELEGRAM" → channel default notifikasi sistem
 *
 * Simulasi bot (#LAPOR) tetap berjalan penuh di dalam aplikasi; helper ini
 * tambahan untuk meneruskan balasan bot ke API eksternal jika kredensial diisi.
 */

export type GatewayChannel = 'WHATSAPP' | 'TELEGRAM'

export interface GatewayConfig {
  waAktif: boolean
  waUrl: string
  waToken: string
  tgAktif: boolean
  tgToken: string
  tgChatId: string
  channelDefault: GatewayChannel
}

export async function getGatewayConfig(): Promise<GatewayConfig> {
  const rows = await db.pengaturan.findMany({
    where: { kunci: { startsWith: 'gateway_' } },
  })
  const map: Record<string, string> = {}
  for (const r of rows) map[r.kunci] = r.nilai
  return {
    waAktif: map['gateway_wa_aktif'] !== 'false', // default aktif
    waUrl: map['gateway_wa_url'] ?? '',
    waToken: map['gateway_wa_token'] ?? '',
    tgAktif: map['gateway_tg_aktif'] === 'true', // default nonaktif sampai dikonfigurasi
    tgToken: map['gateway_tg_token'] ?? '',
    tgChatId: map['gateway_tg_chat_id'] ?? '',
    channelDefault: map['gateway_channel_default'] === 'TELEGRAM' ? 'TELEGRAM' : 'WHATSAPP',
  }
}

export interface SendResult {
  ok: boolean
  mode: 'REAL' | 'SIMULASI'
  detail: string
}

/**
 * Kirim pesan keluar melalui channel.
 * - WHATSAPP: POST ke gateway_wa_url dengan Authorization Bearer token (kompatibel Fonnte/Wablas style)
 * - TELEGRAM : POST https://api.telegram.org/bot{token}/sendMessage ke chat_id
 * Jika kredensial belum lengkap → SIMULASI (pesan tetap tercatat di log gateway).
 */
export async function sendGatewayMessage(channel: GatewayChannel, text: string): Promise<SendResult> {
  const cfg = await getGatewayConfig()

  if (channel === 'TELEGRAM') {
    if (!cfg.tgAktif || !cfg.tgToken || !cfg.tgChatId) {
      return { ok: true, mode: 'SIMULASI', detail: 'Telegram belum dikonfigurasi (bot token / chat ID kosong) — pesan hanya tercatat di log gateway.' }
    }
    try {
      const res = await fetch(`https://api.telegram.org/bot${cfg.tgToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: cfg.tgChatId, text, parse_mode: 'Markdown' }),
        signal: AbortSignal.timeout(10_000),
      })
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string }
      if (res.ok && data.ok) {
        return { ok: true, mode: 'REAL', detail: 'Pesan terkirim via Telegram Bot API.' }
      }
      return { ok: false, mode: 'REAL', detail: `Telegram API menolak: ${data.description ?? res.status}` }
    } catch (e) {
      return { ok: false, mode: 'REAL', detail: `Gagal menghubungi Telegram API: ${(e as Error).message}` }
    }
  }

  // WHATSAPP
  if (!cfg.waAktif || !cfg.waUrl) {
    return { ok: true, mode: 'SIMULASI', detail: 'WhatsApp gateway belum dikonfigurasi (URL/token kosong) — pesan hanya tercatat di log gateway.' }
  }
  try {
    const res = await fetch(cfg.waUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(cfg.waToken ? { Authorization: `Bearer ${cfg.waToken}` } : {}),
      },
      body: JSON.stringify({ message: text }),
      signal: AbortSignal.timeout(10_000),
    })
    if (res.ok) return { ok: true, mode: 'REAL', detail: `Pesan terkirim via WhatsApp gateway (${res.status}).` }
    return { ok: false, mode: 'REAL', detail: `WhatsApp gateway menolak: HTTP ${res.status}` }
  } catch (e) {
    return { ok: false, mode: 'REAL', detail: `Gagal menghubungi WhatsApp gateway: ${(e as Error).message}` }
  }
}

export function labelChannel(channel: string): string {
  return channel === 'TELEGRAM' ? 'Telegram' : 'WhatsApp'
}

/**
 * Otorisasi webhook inbound (produksi).
 * Bila env WEBHOOK_SECRET diisi, pemanggil wajib menyertakan nilai yang sama
 * via query `?secret=` atau header `x-webhook-secret` (dibandingkan
 * timing-safe). Bila env kosong: FAIL-CLOSED di produksi (NODE_ENV=production
 * → semua request webhook ditolak, agar secret lupa-set tidak membuka pintu
 * publik); di mode dev/simulator tetap terbuka agar simulator internal jalan.
 */
export function isWebhookAuthorized(request: Request): boolean {
  const secret = process.env.WEBHOOK_SECRET
  if (!secret) return process.env.NODE_ENV !== 'production'
  const url = new URL(request.url)
  const given = url.searchParams.get('secret') ?? request.headers.get('x-webhook-secret') ?? ''
  const a = Buffer.from(given)
  const b = Buffer.from(secret)
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b)
}
