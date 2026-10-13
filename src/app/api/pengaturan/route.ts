import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { autoGitBackup } from '@/lib/git-backup'
import { requireActiveSession, requireManagerSession } from '@/lib/auth-server'

// GET /api/pengaturan - profile perusahaan
export async function GET() {
  try {
    const settings = await db.pengaturan.findMany({ orderBy: { kunci: 'asc' } })
    const map: Record<string, string> = {}
    for (const s of settings) map[s.kunci] = s.nilai
    return NextResponse.json({ list: settings, map })
  } catch (error) {
    console.error('Pengaturan GET error:', error)
    return NextResponse.json({ error: 'Gagal memuat pengaturan' }, { status: 500 })
  }
}

// PUT /api/pengaturan - update settings (bulk key-value), hanya Admin/Manager
export async function PUT(request: Request) {
  try {
    const { session, denied } = await requireActiveSession(request)
    if (denied) return denied
    const roleDenied = requireManagerSession(session)
    if (roleDenied) return roleDenied
    const body = await request.json()
    const entries: Record<string, string> = body.settings ?? {}
    const keys = Object.keys(entries)
    for (const k of keys) {
      await db.pengaturan.upsert({
        where: { kunci: k },
        update: { nilai: String(entries[k]) },
        create: { kunci: k, nilai: String(entries[k]) },
      })
    }
    await logAudit({
      aksi: 'UPDATE_PENGATURAN',
      entitas: 'pengaturan',
      deskripsi: `Pengaturan perusahaan diperbarui: ${keys.join(', ')}`,
      aktor: body.aktor,
    })
    await autoGitBackup('UPDATE', 'pengaturan', keys.join(','), body.aktor)
    const settings = await db.pengaturan.findMany({ orderBy: { kunci: 'asc' } })
    return NextResponse.json({ ok: true, list: settings })
  } catch (error) {
    console.error('Pengaturan PUT error:', error)
    return NextResponse.json({ error: 'Gagal menyimpan pengaturan' }, { status: 500 })
  }
}
