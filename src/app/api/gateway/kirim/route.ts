import { NextResponse } from 'next/server'
import { logAudit } from '@/lib/audit'
import { sendGatewayMessage, type GatewayChannel } from '@/lib/gateway'
import { requireActiveSession } from '@/lib/auth-server'

/**
 * POST /api/gateway/kirim { pesan, channel? } — kirim teks ke grup/channel
 * gateway yang terkonfigurasi (dipakai tombol "Kirim ke Grup").
 */
export async function POST(request: Request) {
  try {
    const { session, denied } = await requireActiveSession(request)
    if (denied) return denied
    const body = await request.json().catch(() => ({}))
    const pesan = String(body?.pesan ?? '').trim()
    if (!pesan) {
      return NextResponse.json({ error: 'Pesan wajib diisi' }, { status: 400 })
    }
    if (pesan.length > 3000) {
      return NextResponse.json({ error: 'Pesan maksimal 3000 karakter' }, { status: 400 })
    }
    const channel: GatewayChannel = body?.channel === 'TELEGRAM' ? 'TELEGRAM' : 'WHATSAPP'
    const hasil = await sendGatewayMessage(channel, pesan)
    await logAudit({
      aksi: 'KIRIM_GATEWAY',
      entitas: 'gateway_message',
      entitasId: channel,
      deskripsi: `Pesan dikirim ke grup ${channel} (${hasil.mode}): ${pesan.slice(0, 120)}`,
      aktor: session!.nama,
    })
    return NextResponse.json({ ok: hasil.ok, mode: hasil.mode, detail: hasil.detail, channel })
  } catch (error) {
    console.error('Gateway kirim error:', error)
    return NextResponse.json({ error: 'Gagal mengirim pesan' }, { status: 500 })
  }
}
