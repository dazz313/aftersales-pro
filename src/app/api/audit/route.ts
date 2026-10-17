import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireActiveSession, requireManagerSession } from '@/lib/auth-server'

// GET /api/audit - riwayat audit activity logs (Modul 6 PRD) — khusus Admin Workshop/Manager
export async function GET(request: Request) {
  try {
    const { session, denied } = await requireActiveSession(request)
    if (denied) return denied
    const roleDenied = requireManagerSession(session)
    if (roleDenied) return roleDenied
    const { searchParams } = new URL(request.url)
    const limit = Math.min(Number(searchParams.get('limit')) || 100, 300)
    const logs = await db.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: limit })
    return NextResponse.json(logs)
  } catch (error) {
    console.error('Audit GET error:', error)
    return NextResponse.json({ error: 'Gagal memuat audit log' }, { status: 500 })
  }
}
