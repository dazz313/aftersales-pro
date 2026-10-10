import { NextResponse } from 'next/server'
import { runBackup, getBackupStatus } from '@/lib/gsheets'

/**
 * GET /api/backup/sheets — status backup terakhir + riwayat + konfigurasi + dueNow (auto)
 */
export async function GET() {
  try {
    const status = await getBackupStatus()
    return NextResponse.json(status)
  } catch (error) {
    console.error('Backup GET error:', error)
    return NextResponse.json({ error: 'Gagal memuat status backup' }, { status: 500 })
  }
}

/**
 * POST /api/backup/sheets — jalankan backup data bersama ke Google Spreadsheet
 * body: { trigger?: 'MANUAL' | 'AUTO', aktor?: string }
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}))
    const trigger = body.trigger === 'AUTO' ? 'AUTO' : 'MANUAL'
    const outcome = await runBackup(trigger, body.aktor)
    return NextResponse.json(outcome, { status: outcome.status === 'FAILED' ? 502 : 200 })
  } catch (error) {
    console.error('Backup POST error:', error)
    return NextResponse.json({ error: 'Proses backup gagal' }, { status: 500 })
  }
}
