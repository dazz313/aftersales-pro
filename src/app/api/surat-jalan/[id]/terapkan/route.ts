import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { autoGitBackup } from '@/lib/git-backup'
import { requireActiveSession } from '@/lib/auth-server'
import { terapkanDariDb } from '@/lib/surat-jalan'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// POST /api/surat-jalan/[id]/terapkan — TERAPKAN PERMANEN (efek ke tiket/unit).
// Syarat lapis akhir:
//  1. Server menjalankan CEK AKHIR ulang — menolak jika ada BLOKIR.
//  2. Bila draft memakai cekManual, client wajib mengirim sudahCekManual=true
//     (semua baris sudah dicentang hasil verifikasi manual di UI).
// body: { aktor?: string, sudahCekManual?: boolean }
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { session, denied } = await requireActiveSession(request)
    if (denied) return denied
    const { id } = await ctx.params
    const sjId = Number(id)
    const body = (await request.json().catch(() => ({}))) as { aktor?: string; sudahCekManual?: boolean }
    const aktor = (body.aktor || session?.nama || 'SYSTEM').slice(0, 60)
    const sj = await db.suratJalanMasuk.findUnique({ where: { id: sjId }, select: { status: true, noSuratJalan: true, cekManual: true } })
    if (!sj) return NextResponse.json({ error: 'Draft surat jalan tidak ditemukan' }, { status: 404 })
    if (sj.status === 'DITERAPKAN') return NextResponse.json({ error: 'Surat jalan sudah diterapkan' }, { status: 409 })
    if (sj.cekManual && body.sudahCekManual !== true) {
      return NextResponse.json({ error: 'Verifikasi manual per baris belum selesai — centang semua baris dulu' }, { status: 400 })
    }

    const ringkasan = await terapkanDariDb(sjId, aktor)
    await logAudit({
      aksi: 'SURAT_JALAN_TERAPKAN',
      entitas: 'surat_jalan_masuk',
      entitasId: sj.noSuratJalan,
      deskripsi: `Surat jalan DITERAPKAN setelah cek akhir bersih: ${ringkasan.cocokCount} item cocok · ${ringkasan.tanpaTiket} tanpa tiket · ${ringkasan.naikProses} tiket naik PROSES${sj.cekManual ? ' (verifikasi manual selesai)' : ''}`,
      aktor,
    })
    await autoGitBackup('APPLY', 'surat_jalan_masuk', sj.noSuratJalan, aktor)
    return NextResponse.json({ ok: true, ...ringkasan })
  } catch (error) {
    console.error('Surat jalan terapkan error:', error)
    const pesan = error instanceof Error ? error.message : 'Gagal menerapkan surat jalan'
    return NextResponse.json({ error: pesan }, { status: 400 })
  }
}
