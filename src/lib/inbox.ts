import { db } from '@/lib/db'

export type InboxStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'ARCHIVED'
export type InboxTujuan = 'SERVICE' | 'KUNJUNGAN' | 'ARSIP'

/** Mode penampungan dari Pengaturan: TAHAN (default) | OTOMATIS */
export async function getInboxMode(): Promise<'TAHAN' | 'OTOMATIS'> {
  const row = await db.pengaturan.findUnique({ where: { kunci: 'inbox_mode' } }).catch(() => null)
  return row?.nilai === 'OTOMATIS' ? 'OTOMATIS' : 'TAHAN'
}

export async function countPending(): Promise<number> {
  return db.inboxItem.count({ where: { status: 'PENDING' } })
}
