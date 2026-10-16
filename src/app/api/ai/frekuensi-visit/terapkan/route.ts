import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { requireActiveSession, requireManagerSession } from '@/lib/auth-server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// POST /api/ai/frekuensi-visit/terapkan — menerapkan saran siklus hasil analisa
// HANYA atas persetujuan eksplisit user (daftar perubahan dikirim dari client
// setelah dicentang + dikonfirmasi di dialog). Khusus Manager/Admin.
export async function POST(request: Request) {
  try {
    const { session, denied } = await requireActiveSession(request)
    if (denied) return denied
    const roleDenied = requireManagerSession(session)
    if (roleDenied) return roleDenied

    const body = (await request.json()) as { perubahan?: { id?: number; siklus?: number }[]; aktor?: string }
    const perubahan = (Array.isArray(body.perubahan) ? body.perubahan : [])
      .filter((p) => Number(p.id) > 0 && Number.isInteger(Number(p.siklus)) && Number(p.siklus) >= 1 && Number(p.siklus) <= 60)
      .slice(0, 100)
    if (perubahan.length === 0) {
      return NextResponse.json({ error: 'Tidak ada perubahan siklus yang disetujui.' }, { status: 400 })
    }
    const aktor = String(body.aktor ?? session?.nama ?? 'SYSTEM')

    const hasil: { kode: string; dari: number; ke: number }[] = []
    for (const p of perubahan) {
      const sebelum = await db.masterToko.findUnique({ where: { id: Number(p.id) }, select: { id: true, kodeToko: true, frekuensiVisit: true } })
      if (!sebelum || sebelum.frekuensiVisit === Number(p.siklus)) continue
      await db.masterToko.update({ where: { id: sebelum.id }, data: { frekuensiVisit: Number(p.siklus) } })
      hasil.push({ kode: sebelum.kodeToko, dari: sebelum.frekuensiVisit, ke: Number(p.siklus) })
    }

    if (hasil.length > 0) {
      await logAudit({
        aksi: 'FREKUENSI_VISIT_AI',
        entitas: 'master_toko',
        deskripsi: `Saran AI frekuensi kunjungan disetujui ${aktor}: ${hasil.map((h) => `${h.kode} ${h.dari}→${h.ke}h`).join(', ')}`,
        aktor,
      })
    }

    return NextResponse.json({ diterapkan: hasil.length, rincian: hasil })
  } catch (error) {
    console.error('Frekuensi-visit terapkan error:', error)
    return NextResponse.json({ error: 'Gagal menerapkan saran frekuensi' }, { status: 500 })
  }
}
