import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSession } from '@/lib/auth'

export const BACKUP_TABLES = [
  'pengguna',
  'pengaturan',
  'masterToko',
  'masterCustomer',
  'masterSparepart',
  'unitAsset',
  'serviceRequest',
  'serviceRequestPart',
  'kunjungan',
  'permintaanOrder',
  'waMessage',
  'visionScan',
  'inboxItem',
  'auditLog',
  'backupLog',
] as const

async function requireAdmin(request: Request) {
  const session = await getSession(request)
  if (!session || !['ADMIN_WORKSHOP', 'MANAGER'].includes(session.role)) {
    return NextResponse.json({ error: 'Akses ditolak: hanya Admin Workshop/Manager' }, { status: 403 })
  }
  return null
}

/**
 * GET /api/backup/db — unduh backup penuh database (JSON).
 * Berisi semua tabel apa adanya (termasuk akun, agar restore utuh).
 * Simpan file ini baik-baik — siapa pun yang memegangnya bisa me-restore.
 */
export async function GET(request: Request) {
  try {
    const denied = await requireAdmin(request)
    if (denied) return denied
    const data: Record<string, unknown> = {}
    for (const t of BACKUP_TABLES) {
      data[t] = await (db[t] as { findMany: () => Promise<unknown[]> }).findMany()
    }
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')
    return new NextResponse(
      JSON.stringify({ app: 'aftersales-pro', version: 1, generatedAt: new Date().toISOString(), data }),
      {
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Disposition': `attachment; filename="backup-aspro-${stamp}.json"`,
          'Cache-Control': 'no-store',
        },
      }
    )
  } catch (error) {
    console.error('Backup DB error:', error)
    return NextResponse.json({ error: 'Gagal membuat backup database' }, { status: 500 })
  }
}
