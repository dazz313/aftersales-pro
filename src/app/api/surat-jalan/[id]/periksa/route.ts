import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { requireActiveSession } from '@/lib/auth-server'
import { cekDraft } from '@/lib/surat-jalan'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// POST /api/surat-jalan/[id]/periksa — JALANKAN CEK BERLAPIS atas draft.
// body: { cekManual?: boolean, aktor?: string }
//  - Tahap tetap DRAFT/DIPERIKSA — TIDAK ADA efek ke tiket/unit.
//  - cekManual=true → draft menuntut verifikasi manual per baris sebelum terapkan.
//  - Status naik ke DIPERIKSA + jejak pemeriksa dicatat.
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { session, denied } = await requireActiveSession(request)
    if (denied) return denied
    const { id } = await ctx.params
    const sjId = Number(id)
    const body = (await request.json().catch(() => ({}))) as { cekManual?: boolean; aktor?: string }
    const sj = await db.suratJalanMasuk.findUnique({ where: { id: sjId }, select: { status: true, noSuratJalan: true } })
    if (!sj) return NextResponse.json({ error: 'Draft surat jalan tidak ditemukan' }, { status: 404 })
    if (sj.status === 'DITERAPKAN') return NextResponse.json({ error: 'Surat jalan sudah diterapkan — cek tidak lagi diperlukan' }, { status: 409 })

    const aktor = (body.aktor || session?.nama || 'SYSTEM').slice(0, 60)
    const hasil = await cekDraft(sjId)
    await db.suratJalanMasuk.update({
      where: { id: sjId },
      data: {
        status: 'DIPERIKSA',
        cekManual: body.cekManual === true,
        diperiksaAt: new Date(),
        diperiksaOleh: aktor,
      },
    })
    await logAudit({
      aksi: 'SURAT_JALAN_CEK',
      entitas: 'surat_jalan_masuk',
      entitasId: sj.noSuratJalan,
      deskripsi: `Cek berlapis${body.cekManual ? ' + verifikasi manual' : ''}: ${hasil.blokir} blokir · ${hasil.peringatan} peringatan · ${hasil.info} info`,
      aktor,
    })
    return NextResponse.json(hasil)
  } catch (error) {
    console.error('Surat jalan periksa error:', error)
    const pesan = error instanceof Error ? error.message : 'Gagal menjalankan cek'
    return NextResponse.json({ error: pesan }, { status: 400 })
  }
}
