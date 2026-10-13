import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getActiveSession } from '@/lib/auth-server'
import { autoGitBackup } from '@/lib/git-backup'
import { moveInboxFile, type InboxKind } from '@/lib/telegram-files'
import { prosesLaporanTeks } from '@/lib/laporan'

async function getRole(request: Request): Promise<string | null> {
  // Sesi fresh dari DB: akun nonaktif / demosi langsung kehilangan akses kelola inbox
  const session = await getActiveSession(request) // cookie ATAU Authorization: Bearer
  return session?.role ?? null
}

// GET /api/inbox?status=PENDING&folder=KUNJUNGAN
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams
  const where: Record<string, string> = {}
  if (q.get('status')) where.status = q.get('status')!
  if (q.get('folder')) where.folder = q.get('folder')!
  const items = await db.inboxItem.findMany({ where, orderBy: { createdAt: 'desc' }, take: 100 })
  const pending = await db.inboxItem.count({ where: { status: 'PENDING' } })
  return NextResponse.json({ items, pending })
}

// POST /api/inbox { aksi, id, ... } — hanya ADMIN_WORKSHOP / MANAGER
export async function POST(request: Request) {
  const role = await getRole(request)
  if (role !== 'ADMIN_WORKSHOP' && role !== 'MANAGER') {
    return NextResponse.json({ error: 'Hanya Admin / Manager yang boleh memproses inbox.' }, { status: 403 })
  }
  const body = await request.json()
  const { aksi, id } = body as { aksi: string; id: number }
  const item = await db.inboxItem.findUnique({ where: { id } })
  if (!item) return NextResponse.json({ error: 'Item inbox tidak ditemukan.' }, { status: 404 })
  if (item.status !== 'PENDING') return NextResponse.json({ error: `Item sudah diproses (${item.status}).` }, { status: 409 })
  const aktor = body.aktor || role
  const folder = item.folder as InboxKind

  if (aksi === 'TOLAK') {
    const done = await db.inboxItem.update({
      where: { id }, data: { status: 'REJECTED', alasanTolak: String(body.alasan || 'Ditolak admin'), direviewOleh: aktor, direviewAt: new Date() },
    })
    const { logAudit } = await import('@/lib/audit')
    await logAudit({ aksi: 'INBOX_REJECT', entitas: 'inbox_item', entitasId: String(id), deskripsi: `Inbox #${id} [${folder}] ditolak: ${done.alasanTolak}`, aktor })
    await autoGitBackup('UPDATE', 'inbox_item', `#${id}`, aktor)
    return NextResponse.json({ ok: true, item: done })
  }

  if (aksi === 'PINDAH') {
    const tujuan = body.folder === 'KUNJUNGAN' ? 'KUNJUNGAN' : 'SERVICE'
    if (tujuan === folder) return NextResponse.json({ error: 'Item sudah di folder tersebut.' }, { status: 400 })
    const pathBaru = item.fileName ? await moveInboxFile(folder, tujuan as InboxKind, item.fileName) : item.filePath
    const done = await db.inboxItem.update({ where: { id }, data: { folder: tujuan, filePath: pathBaru } })
    const { logAudit } = await import('@/lib/audit')
    await logAudit({ aksi: 'INBOX_PINDAH', entitas: 'inbox_item', entitasId: String(id), deskripsi: `Inbox #${id} dipindah ${folder} → ${tujuan} (file ikut pindah)`, aktor })
    await autoGitBackup('UPDATE', 'inbox_item', `#${id}`, aktor)
    return NextResponse.json({ ok: true, item: done })
  }

  if (aksi === 'ARSIP') {
    if (folder !== 'SERVICE') return NextResponse.json({ error: 'Arsip hanya untuk folder Service. Pindahkan dulu bila perlu.' }, { status: 400 })
    const done = await db.inboxItem.update({ where: { id }, data: { status: 'ARCHIVED', tujuan: 'ARSIP', direviewOleh: aktor, direviewAt: new Date() } })
    const { logAudit } = await import('@/lib/audit')
    await logAudit({ aksi: 'INBOX_ARCHIVE', entitas: 'inbox_item', entitasId: String(id), deskripsi: `Inbox #${id} diarsipkan tanpa diteruskan`, aktor })
    await autoGitBackup('UPDATE', 'inbox_item', `#${id}`, aktor)
    return NextResponse.json({ ok: true, item: done })
  }

  if (aksi === 'APPROVE_SERVICE') {
    if (folder !== 'SERVICE') return NextResponse.json({ error: 'Item folder Kunjungan tidak bisa jadi tiket. Pindahkan dulu ke folder Service.' }, { status: 400 })
    const teks = String(body.teksTerusan || item.caption || item.barcode || '').trim()
    if (!/#LAPOR/i.test(teks)) {
      return NextResponse.json({ error: 'Teks terusan harus format #LAPOR [Seri] [Part] [Deskripsi]. Edit dulu sebelum disetujui.' }, { status: 400 })
    }
    const hasil = await prosesLaporanTeks({ pesan: teks, pengirim: item.pengirim, channel: 'TELEGRAM', foto: item.filePath })
    const done = await db.inboxItem.update({
      where: { id }, data: { status: 'APPROVED', tujuan: 'SERVICE', teksTerusan: teks, hasilRef: (hasil as { noTiket?: string }).noTiket ?? null, direviewOleh: aktor, direviewAt: new Date() },
    })
    await autoGitBackup('APPROVE', 'inbox_item', `#${id}`, aktor)
    return NextResponse.json({ ok: true, item: done, tiket: hasil })
  }

  if (aksi === 'APPROVE_KUNJUNGAN') {
    if (folder !== 'KUNJUNGAN') return NextResponse.json({ error: 'Item folder Service tidak bisa jadi kunjungan. Pindahkan dulu ke folder Kunjungan.' }, { status: 400 })
    const { tokoId, teknisiId, catatan } = body as { tokoId: number; teknisiId: number; catatan?: string }
    if (!tokoId || !teknisiId) return NextResponse.json({ error: 'Pilih toko dan teknisi terlebih dahulu.' }, { status: 400 })
    const kunj = await db.kunjungan.create({
      data: {
        tokoId: Number(tokoId), teknisiId: Number(teknisiId), metodeCheckin: 'MANUAL',
        barcodeTerscan: item.barcode, fotoOnsite: item.fileName,
        catatanStokRusak: String(catatan || item.caption || '') || null,
      },
    })
    await db.masterToko.update({ where: { id: Number(tokoId) }, data: { tglVisitTerakhir: new Date() } })
    const done = await db.inboxItem.update({
      where: { id }, data: { status: 'APPROVED', tujuan: 'KUNJUNGAN', hasilRef: `KJ-${kunj.id}`, direviewOleh: aktor, direviewAt: new Date() },
    })
    const { logAudit } = await import('@/lib/audit')
    await logAudit({ aksi: 'INBOX_APPROVE_KUNJUNGAN', entitas: 'inbox_item', entitasId: String(id), deskripsi: `Inbox #${id} diteruskan → kunjungan #${kunj.id} (konfirmasi dari Telegram)`, aktor })
    await autoGitBackup('APPROVE', 'kunjungan', `#${kunj.id}`, aktor)
    return NextResponse.json({ ok: true, item: done, kunjunganId: kunj.id })
  }

  return NextResponse.json({ error: 'Aksi tidak dikenal.' }, { status: 400 })
}
