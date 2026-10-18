import { NextResponse } from 'next/server'
import { logAudit } from '@/lib/audit'
import { autoGitBackup } from '@/lib/git-backup'
import { getActiveSession } from '@/lib/auth-server'
import { prosesKirimOrderEmail } from '@/lib/order-email'

// POST /api/order-email/kirim — kirim email order ke produsen lewat SMTP.
// Body: { ids?: number[] } — tanpa ids berarti semua item berstatus PENDING.
// Bila SMTP belum diset kembalikan draf mailto (mode MAILTO) yang dibuka di aplikasi
// email pengguna; status item tetap PENDING sampai dikonfirmasi manual.
export async function POST(request: Request) {
  try {
    const session = await getActiveSession(request)
    if (!session) {
      return NextResponse.json({ error: 'Sesi berakhir atau akun nonaktif. Silakan login ulang.' }, { status: 401 })
    }
    const body = await request.json().catch(() => ({}))
    const aktor = (typeof body.aktor === 'string' && body.aktor.trim()) ? body.aktor : session.nama
    const ids: number[] = Array.isArray(body.ids) ? body.ids.map((n: unknown) => Number(n)).filter(Number.isFinite) : []

    const hasil = await prosesKirimOrderEmail(ids.length > 0 ? ids : null, aktor)
    if (hasil.mode === 'SMTP') {
      await logAudit({
        aksi: 'KIRIM_EMAIL_PRODUSEN',
        entitas: 'order_email_part',
        entitasId: ids.length > 0 ? ids.join(',') : 'SEMUA_PENDING',
        deskripsi: `Email order terkirim ke ${hasil.ke} (${hasil.terkirim} item)`,
        aktor,
      })
      await autoGitBackup('UPDATE', 'order_email_part', 'terkirim', aktor)
    }
    return NextResponse.json(hasil)
  } catch (error) {
    console.error('OrderEmail kirim error:', error)
    return NextResponse.json({ error: 'Gagal mengirim email order' }, { status: 500 })
  }
}
