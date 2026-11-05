import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireActiveSession } from '@/lib/auth-server'
import { resolveAiConfig } from '@/lib/ai'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * GET /api/ai/models — daftar model yang tersedia di gateway 9router
 * (OpenAI-compatible: GET {baseUrl}/models). Diproxy server-side agar
 * sesi dan API key (termasuk yang dibaca otomatis dari DB 9router)
 * tidak pernah terekspos ke browser.
 *
 * Selalu balik HTTP 200 dengan { ok, models, error } — kegagalan gateway
 * TIDAK jadi 5xx supaya UI tetap bisa menampilkan input manual model
 * sebagai fallback (9router bisa hang, mis. OAuth provider kadaluarsa).
 */
export async function GET(request: Request) {
  const { denied } = await requireActiveSession(request)
  if (denied) return denied
  const rows = await db.pengaturan.findMany({ select: { kunci: true, nilai: true } })
  const map: Record<string, string> = {}
  for (const r of rows) map[r.kunci] = r.nilai
  const cfg = resolveAiConfig(map)
  if (!cfg.apiKey) {
    return NextResponse.json({
      ok: false,
      models: [],
      error:
        'Kunci API 9router tidak ditemukan — salin API key dari dashboard 9router ke Pengaturan → AI Suggest, lalu muat ulang daftar.',
    })
  }
  let res: Response
  try {
    res = await fetch(`${cfg.baseUrl}/models`, {
      headers: { Authorization: `Bearer ${cfg.apiKey}` },
      signal: AbortSignal.timeout(40000),
    })
  } catch {
    return NextResponse.json({
      ok: false,
      models: [],
      error:
        'Gateway AI tidak merespons dalam 40 detik — 9router sedang sibuk/bermasalah (cek OAuth provider di dashboardnya). Isi nama model secara manual.',
    })
  }
  const j = (await res.json().catch(() => null)) as {
    data?: { id?: string }[]
    models?: unknown[]
  } | null
  if (!res.ok || !j) {
    return NextResponse.json({
      ok: false,
      models: [],
      error: `9router menolak permintaan daftar model (HTTP ${res.status}) — isi nama model secara manual.`,
    })
  }
  const mentah: unknown[] = Array.isArray(j.data) ? j.data.map((m) => m?.id) : Array.isArray(j.models) ? j.models : []
  const models = mentah.filter((m): m is string => typeof m === 'string' && m.length > 0).sort()
  if (!models.length) {
    return NextResponse.json({
      ok: false,
      models: [],
      error: '9router tidak mengembalikan model apa pun — isi nama model secara manual.',
    })
  }
  return NextResponse.json({ ok: true, models })
}
