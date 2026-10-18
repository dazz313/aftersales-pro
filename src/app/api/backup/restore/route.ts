import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { autoGitBackup } from '@/lib/git-backup'
import { getActiveSession } from '@/lib/auth-server'
import { BACKUP_TABLES } from '@/app/api/backup/db/route'

// Urutan hapus: anak dulu baru induk (aman walau FK tidak dienforce)
const DELETE_ORDER = [
  'serviceRequestPart',
  'orderEmailPart',
  'suratJalanMasukItem',
  'suratJalanMasuk',
  'permintaanOrder',
  'serviceRequest',
  'kunjungan',
  'unitAsset',
  'masterSparepart',
  'masterCustomer',
  'masterToko',
  'inboxItem',
  'visionScan',
  'waMessage',
  'backupLog',
  'auditLog',
  'pengaturan',
  'pengguna',
] as const

// Urutan isi: induk dulu baru anak
const INSERT_ORDER = [...DELETE_ORDER].reverse()

const MAX_FILE_BYTES = 50 * 1024 * 1024

/**
 * POST /api/backup/restore (FormData: file JSON hasil /api/backup/db)
 * Menimpa SELURUH isi database dengan isi file. Hanya Admin/Manager.
 * File pengguna ikut direstore — bila akun berubah, login ulang.
 */
export async function POST(request: Request) {
  try {
    const session = await getActiveSession(request)
    if (!session || !['ADMIN_WORKSHOP', 'MANAGER'].includes(session.role)) {
      return NextResponse.json({ error: 'Akses ditolak: hanya Admin Workshop/Manager' }, { status: 403 })
    }
    const form = await request.formData()
    const file = form.get('file')
    if (!(file instanceof Blob)) {
      return NextResponse.json({ error: 'File backup wajib diunggah' }, { status: 400 })
    }
    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json({ error: 'File maksimal 50 MB' }, { status: 400 })
    }
    let payload: { app?: string; data?: Record<string, unknown[]> }
    try {
      payload = JSON.parse(await file.text())
    } catch {
      return NextResponse.json({ error: 'File bukan JSON valid' }, { status: 400 })
    }
    if (!payload || typeof payload !== 'object' || !payload.data || typeof payload.data !== 'object') {
      return NextResponse.json({ error: 'Format backup tidak dikenali (harus dari menu Backup Database)' }, { status: 400 })
    }
    for (const t of BACKUP_TABLES) {
      const rows = (payload.data as Record<string, unknown>)[t]
      if (rows !== undefined && !Array.isArray(rows)) {
        return NextResponse.json({ error: `Tabel "${t}" rusak di file backup` }, { status: 400 })
      }
    }
    const users = (payload.data.pengguna as unknown[]) ?? []
    if (users.length === 0) {
      return NextResponse.json({ error: 'Backup tidak berisi akun pengguna — restore dibatalkan agar tidak terkunci' }, { status: 400 })
    }

    // 1. Kosongkan semua tabel (anak → induk)
    const anyDb = db as unknown as Record<string, { deleteMany: () => Promise<unknown>; createMany: (a: { data: unknown[] }) => Promise<{ count: number }> }>
    for (const t of DELETE_ORDER) {
      await anyDb[t].deleteMany()
    }
    // 2. Isi dari file (induk → anak), ID asli dipertahankan
    const counts: Record<string, number> = {}
    for (const t of INSERT_ORDER) {
      const rows = ((payload.data as Record<string, unknown[]>)[t] ?? []) as Record<string, unknown>[]
      if (rows.length === 0) {
        counts[t] = 0
        continue
      }
      await anyDb[t].createMany({ data: rows })
      counts[t] = rows.length
    }

    await logAudit({
      aksi: 'RESTORE_DATABASE',
      entitas: 'backup_database',
      deskripsi: `Restore database dari file backup (${Object.values(counts).reduce((a, b) => a + b, 0)} baris)`,
      aktor: session.nama,
    })
    await autoGitBackup('RESTORE', 'database', 'file', session.nama)
    return NextResponse.json({ ok: true, counts })
  } catch (error) {
    console.error('Restore DB error:', error)
    return NextResponse.json({ error: 'Gagal me-restore database' }, { status: 500 })
  }
}
