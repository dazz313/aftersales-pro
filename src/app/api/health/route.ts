import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

/**
 * GET /api/health — health/readiness check untuk monitoring (PM2, Caddy, uptime
 * checker). SENGAJA publik (tanpa sesi) karena dipanggil tool monitoring, dan
 * hanya mengembalikan status ringkas — tidak ada data bisnis di dalamnya.
 *
 * 200 = sehat (database terjangkau) · 503 = degraded (database tidak terjangkau).
 */
export const dynamic = 'force-dynamic'

export async function GET() {
  const mulai = Date.now()
  const dasar = {
    app: 'AfterSales Pro',
    waktu: new Date().toISOString(),
    uptimeDetik: Math.round(process.uptime()),
    node: process.version,
  }
  try {
    await db.$queryRawUnsafe('SELECT 1')
    return NextResponse.json({
      status: 'ok',
      database: 'up',
      latencyMs: Date.now() - mulai,
      ...dasar,
    })
  } catch (error) {
    console.error('Health check gagal:', error)
    return NextResponse.json(
      {
        status: 'degraded',
        database: 'down',
        latencyMs: Date.now() - mulai,
        ...dasar,
      },
      { status: 503 }
    )
  }
}
