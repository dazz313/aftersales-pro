import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireActiveSession } from '@/lib/auth-server'
import { resolveAiConfig, chatCompletion } from '@/lib/ai'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// POST /api/ai/test - uji koneksi ke 9router (prompt super kecil)
export async function POST(request: Request) {
  try {
    const { denied } = await requireActiveSession(request)
    if (denied) return denied
    const rows = await db.pengaturan.findMany({ select: { kunci: true, nilai: true } })
    const map: Record<string, string> = {}
    for (const r of rows) map[r.kunci] = r.nilai
    const cfg = resolveAiConfig(map)
    const t0 = Date.now()
    const teks = await chatCompletion(
      cfg,
      [{ role: 'user', content: 'Balas hanya dengan kata: OK' }],
      { temperature: 0, maxTokens: 20 }
    )
    return NextResponse.json({
      ok: true,
      model: cfg.model,
      keySource: cfg.keySource,
      ms: Date.now() - t0,
      reply: teks.slice(0, 200),
    })
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 502 })
  }
}
