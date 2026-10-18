import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { autoGitBackup } from '@/lib/git-backup'
import { getActiveSession } from '@/lib/auth-server'

// PATCH /api/order-email/[id] — aksi status manual pada satu item daftar order email:
// - TANDAI_TERKIRIM : catat manual bahwa email sudah dikirim lewat aplikasi email user (draf mailto)
// - TANDAI_SELESAI  : item selesai ditangani (part sudah diorder/didatangkan)
// - HAPUS           : hapus dari daftar (hanya Admin Workshop/Manager)
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getActiveSession(request)
    if (!session) {
      return NextResponse.json({ error: 'Sesi berakhir atau akun nonaktif. Silakan login ulang.' }, { status: 401 })
    }
    const { id } = await params
    const itemId = Number(id)
    const body = await request.json().catch(() => ({}))
    const aktor = (typeof body.aktor === 'string' && body.aktor.trim()) ? body.aktor : session.nama
    const aksi = String(body.aksi ?? '')
    if (!['TANDAI_TERKIRIM', 'TANDAI_SELESAI', 'HAPUS'].includes(aksi)) {
      return NextResponse.json({ error: `Aksi tidak dikenal: ${aksi}` }, { status: 400 })
    }
    const existing = await db.orderEmailPart.findUnique({ where: { id: itemId } })
    if (!existing) return NextResponse.json({ error: 'Item order email tidak ditemukan' }, { status: 404 })

    if (aksi === 'HAPUS') {
      if (!['ADMIN_WORKSHOP', 'MANAGER'].includes(session.role)) {
        return NextResponse.json({ error: 'Akses ditolak: hanya Admin Workshop/Manager yang boleh menghapus item' }, { status: 403 })
      }
      await db.orderEmailPart.delete({ where: { id: itemId } })
      await logAudit({
        aksi: 'DELETE_ORDER_EMAIL',
        entitas: 'order_email_part',
        entitasId: existing.kodePart,
        deskripsi: `Item kekurangan part dihapus dari daftar email produsen (${existing.namaPart})`,
        aktor,
      })
      await autoGitBackup('DELETE', 'order_email_part', existing.kodePart, aktor)
      return NextResponse.json({ ok: true })
    }

    const statusBaru = aksi === 'TANDAI_TERKIRIM' ? 'TERKIRIM' : 'SELESAI'
    const updated = await db.orderEmailPart.update({
      where: { id: itemId },
      data:
        statusBaru === 'TERKIRIM'
          ? {
              status: 'TERKIRIM',
              emailKirimAt: existing.emailKirimAt ?? new Date(),
              emailOleh: existing.emailOleh ?? aktor,
              emailMode: 'MANUAL',
              emailPesanGagal: null,
            }
          : { status: 'SELESAI' },
    })
    await logAudit({
      aksi: statusBaru === 'TERKIRIM' ? 'MARK_EMAIL_TERKIRIM' : 'MARK_EMAIL_SELESAI',
      entitas: 'order_email_part',
      entitasId: existing.kodePart,
      deskripsi: statusBaru === 'TERKIRIM'
        ? `Item ditandai terkirim secara manual (draf email dibuka) — ${existing.namaPart}`
        : `Item kekurangan part selesai ditangani — ${existing.namaPart}`,
      aktor,
    })
    await autoGitBackup('UPDATE', 'order_email_part', existing.kodePart, aktor)
    return NextResponse.json(updated)
  } catch (error) {
    console.error('OrderEmail PATCH error:', error)
    return NextResponse.json({ error: 'Gagal memperbarui item order email' }, { status: 500 })
  }
}
