import { NextResponse } from 'next/server'
import { runBackup, getBackupStatus } from '@/lib/gsheets'
import { autoGitBackup } from '@/lib/git-backup'
import { requireActiveSession } from '@/lib/auth-server'

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
    const { session, denied } = await requireActiveSession(request)
    if (denied) return denied
    void session
    const body = await request.json().catch(() => ({}))
    const trigger = body.trigger === 'AUTO' ? 'AUTO' : 'MANUAL'
    const outcome = await runBackup(trigger, body.aktor)
    await autoGitBackup('BACKUP', 'backup_google_sheets', outcome.status, body.aktor)
    // Selalu 200 bila proses backup selesai (berhasil ATAU gagal): status
    // sebenarnya ada di body.status. HTTP 502 membuat Cloudflare mengganti
    // body dengan halaman error-nya sendiri, sehingga pesan penyebab gagal
    // (mis. spreadsheet belum dibagikan) tidak sampai ke UI.
    return NextResponse.json(outcome)
  } catch (error) {
    console.error('Backup POST error:', error)
    return NextResponse.json({ error: 'Proses backup gagal' }, { status: 500 })
  }
}
