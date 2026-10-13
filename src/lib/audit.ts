import { db } from '@/lib/db'

/**
 * Helper Audit Activity Log (Modul 6 PRD)
 * Mencatat setiap perubahan status data
 */
export async function logAudit(params: {
  aksi: string
  entitas: string
  entitasId?: string
  deskripsi: string
  aktor?: string
}) {
  try {
    await db.auditLog.create({
      data: {
        aksi: params.aksi,
        entitas: params.entitas,
        entitasId: params.entitasId ?? null,
        deskripsi: params.deskripsi,
        aktor: params.aktor ?? 'SYSTEM',
      },
    })
  } catch (e) {
    console.error('Audit log gagal:', e)
  }
}

/**
 * Generator nomor tiket service: SV-YYYYMMDD-XXXX
 * Berbasis nomor TERBESAR hari itu (bukan count) agar nomor terhapus
 * tidak dipakai ulang dan tidak bentrok.
 */
export async function generateNoTiket(): Promise<string> {
  const now = new Date()
  const ymd = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
  const last = await db.serviceRequest.findFirst({
    where: { noTiket: { startsWith: `SV-${ymd}` } },
    orderBy: { noTiket: 'desc' },
    select: { noTiket: true },
  })
  const seq = last ? parseInt(last.noTiket.slice(-4), 10) + 1 : 1
  return `SV-${ymd}-${String(Number.isFinite(seq) ? seq : 1).padStart(4, '0')}`
}

/**
 * Generator nomor STTB: STTB-YYYYMMDD-XXXX
 */
export function generateNoSttb(noTiket: string): string {
  // SV-20261008-0001 -> STTB-20261008-0001
  return noTiket.replace(/^SV-/, 'STTB-')
}

/**
 * Format Rupiah
 */
export function formatRupiah(n: number): string {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(n)
}
