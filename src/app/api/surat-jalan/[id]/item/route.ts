import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { requireActiveSession } from '@/lib/auth-server'
import { ambilKandidat } from '@/lib/surat-jalan'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// POST /api/surat-jalan/[id]/item — ubah pilihan tiket SATU baris draft
// (fase DRAFT/DIPERIKSA; DITERAPKAN dikunci). Dipakai saat cek manual:
// menautkan kandidat (key p{id}/e{id}) atau melepasnya ('' → TANPA_TIKET).
// body: { itemId: number, pilihKey?: string, asalSaran?: 'AI', alasanSaran?: string, aktor?: string }
//   asalSaran='AI' = menerima SRAN AI (mis. kode OCR salah ketik): kandidat tetap
//   wajib ada, tapi syarat kemiripan kode longgar — kode baris DIBENARKAN ke
//   kode kandidat & kode asli tercatat di alasan + Audit Log. Manual & sadar.
// body: { itemId: number, pilihKey?: string, aktor?: string }
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { session, denied } = await requireActiveSession(request)
    if (denied) return denied
    const { id } = await ctx.params
    const sjId = Number(id)
    const body = (await request.json()) as { itemId?: number; pilihKey?: string; asalSaran?: string; alasanSaran?: string; aktor?: string }
    if (typeof body.itemId !== 'number') return NextResponse.json({ error: 'itemId wajib diisi' }, { status: 400 })
    const sj = await db.suratJalanMasuk.findUnique({ where: { id: sjId }, select: { status: true, noSuratJalan: true } })
    if (!sj) return NextResponse.json({ error: 'Draft surat jalan tidak ditemukan' }, { status: 404 })
    if (sj.status === 'DITERAPKAN') return NextResponse.json({ error: 'Surat jalan sudah diterapkan — baris terkunci' }, { status: 409 })
    const item = await db.suratJalanMasukItem.findFirst({ where: { id: body.itemId, suratJalanMasukId: sjId } })
    if (!item) return NextResponse.json({ error: 'Baris item tidak ditemukan' }, { status: 404 })
    const aktor = (body.aktor || session?.nama || 'SYSTEM').slice(0, 60)
    // Menerima saran AI (`asalSaran='AI'`): syarat kemiripan kode longgar karena
    // file hasil OCR bisa salah ketik — dipakai di cabang taut di bawah.
    const saranAi = body.asalSaran === 'AI'

    if (!body.pilihKey || body.pilihKey === '') {      // Lepas tautan: baris menjadi TANPA_TIKET (hanya catatan penerimaan barang)
      await db.suratJalanMasukItem.update({
        where: { id: item.id },
        data: {
          statusMatch: 'TANPA_TIKET',
          cocokTipe: item.serialNumber ? 'UNIT_TANPA_PART' : null,
          cocokTiketId: null,
          cocokUnitId: null,
          cocokPartId: null,
          alasan: `Lepas tautan manual oleh ${aktor}`,
        },
      })
    } else {
      const kandidat = await ambilKandidat()
      const cand = kandidat.find((c) => c.key === body.pilihKey)
      if (!cand) return NextResponse.json({ error: 'Kandidat tiket tidak ditemukan / sudah tidak tersedia' }, { status: 400 })
      const NORMK = (s: string) => (s || '').toUpperCase().replace(/[^A-Z0-9#]/g, '')
      // Menerima saran AI: syarat kemiripan kode longgar (OCR bisa salah ketik) —
      // kode baris dibereskan ke kode kandidat & kode asli tercatat di alasan.
      if (!saranAi && NORMK(cand.kodePart) !== NORMK(item.kodePart)) {
        return NextResponse.json({ error: `Kode kandidat (${cand.kodePart}) tidak sesuai baris (${item.kodePart})` }, { status: 400 })
      }
      const dataUpdate = saranAi
        ? {
            statusMatch: 'COCOK',
            cocokTipe: cand.emailPartId ? 'TIKET_EMAIL' : 'TIKET_PART',
            cocokTiketId: cand.serviceRequestId,
            cocokUnitId: cand.unitId,
            cocokPartId: cand.partId ?? null,
            kodePart: cand.kodePart,
            alasan: `Saran AI diterima oleh ${aktor} — kode documen '${item.kodePart}' → '${cand.kodePart}' (${(body.alasanSaran || 'kemiripan').slice(0, 120)})`,
          }
        : {
            statusMatch: 'COCOK',
            cocokTipe: cand.emailPartId ? 'TIKET_EMAIL' : 'TIKET_PART',
            cocokTiketId: cand.serviceRequestId,
            cocokUnitId: cand.unitId,
            cocokPartId: cand.partId ?? null,
            alasan: `Ditautkan manual oleh ${aktor} ke ${cand.noTiket}`,
          }
      await db.suratJalanMasukItem.update({
        where: { id: item.id },
        data: dataUpdate,
      })
    }
    // Perbarui hitung-hitungan header
    const items = await db.suratJalanMasukItem.findMany({ where: { suratJalanMasukId: sjId }, select: { statusMatch: true } })
    const cocok = items.filter((i) => i.statusMatch === 'COCOK').length
    await db.suratJalanMasuk.update({ where: { id: sjId }, data: { cocokCount: cocok, tanpaTiket: items.length - cocok } })
    await logAudit({
      aksi: 'EDIT',
      entitas: 'surat_jalan_masuk',
      entitasId: `${sj.noSuratJalan}#item${item.id}`,
      deskripsi: body.pilihKey
        ? saranAi
          ? `Saran AI diterima: baris '${item.kodePart}' diubah ke '${body.pilihKey}' (${(body.alasanSaran || '').slice(0, 120)})`
          : `Taut tiket ke baris surat jalan (${body.pilihKey})`
        : 'Lepas tautan tiket baris surat jalan',
      aktor,
    })
    return NextResponse.json({ ok: true, cocokCount: cocok, tanpaTiket: items.length - cocok })
  } catch (error) {
    console.error('Surat jalan item PATCH error:', error)
    return NextResponse.json({ error: 'Gagal mengubah baris surat jalan' }, { status: 500 })
  }
}
