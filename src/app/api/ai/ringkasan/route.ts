import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireActiveSession } from '@/lib/auth-server'
import { resolveAiConfig, chatCompletion } from '@/lib/ai'
import { umurTiketJam, isDataLama } from '@/lib/umur'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// POST /api/ai/ringkasan - narasi eksekutif kondisi operasional via 9router
export async function POST(request: Request) {
  try {
    const { denied } = await requireActiveSession(request)
    if (denied) return denied

    const [cReq, cPros, cFin, cSla, parts, tokos, draft, unitKosong, unitTotal, tiketRequest] = await Promise.all([
      db.serviceRequest.count({ where: { status: 'REQUEST' } }),
      db.serviceRequest.count({ where: { status: 'PROSES' } }),
      db.serviceRequest.count({ where: { status: 'FINISH' } }),
      db.serviceRequest.count({ where: { status: 'REQUEST', slaFlag: true } }),
      db.masterSparepart.findMany({ select: { stokInventory: true, reorderLimit: true } }),
      db.masterToko.findMany({ select: { tglVisitTerakhir: true, frekuensiVisit: true } }),
      db.serviceRequest.findMany({
        where: { status: 'FINISH', statusKlaimProdusen: 'DRAFT' },
        include: { parts: { include: { sparepart: { select: { hargaKlaim: true } } } } },
      }),
      db.unitAsset.count({ where: { serviceRequests: { none: {} } } }),
      db.unitAsset.count(),
      // Kandidat pending lama: REQUEST tanpa part READY (belum ada kode+nama)
      db.serviceRequest.findMany({
        where: { status: 'REQUEST' },
        include: {
          unitAsset: { include: { toko: { select: { kodeToko: true, namaToko: true } } } },
          parts: { select: { id: true, statusPart: true } },
        },
        orderBy: { tglTiket: 'asc' },
      }),
    ])
    const kritis = parts.filter((p) => p.stokInventory <= p.reorderLimit).length
    const kosong = parts.filter((p) => p.stokInventory === 0).length
    const now = Date.now()
    const telat = tokos.filter((t) => {
      if (!t.tglVisitTerakhir) return true
      return (now - new Date(t.tglVisitTerakhir).getTime()) / 86400000 > t.frekuensiVisit
    }).length
    const nilaiKlaim = draft.reduce(
      (a, t) => a + t.biayaJasa + t.parts.reduce((x, p) => x + (p.sparepart?.hargaKlaim ?? 0) * p.qty, 0),
      0
    )

    const rows = await db.pengaturan.findMany({ select: { kunci: true, nilai: true } })
    const map: Record<string, string> = {}
    for (const r of rows) map[r.kunci] = r.nilai
    const cfg = resolveAiConfig(map)

    // Unit pending >5 hari (120 jam) tanpa kode+nama part: basis tglTiket,
    // data lama dikecualikan (umurnya nonaktif, bukan antrean kerja nyata).
    const BATAS_JAM = 5 * 24
    const pendingLamaSemua = tiketRequest
      .filter((t) => !t.parts.some((p) => p.statusPart === 'READY'))
      .filter((t) => !isDataLama(t))
      .map((t) => ({ t, jam: umurTiketJam(t, now) ?? 0 }))
      .filter((x) => x.jam > BATAS_JAM)
    const pendingLama = pendingLamaSemua.slice(0, 50).map((x) => ({
      noTiket: x.t.noTiket,
      umurHari: Math.floor(x.jam / 24),
      serial: x.t.unitAsset.serialNumber,
      model: x.t.unitAsset.modelUnit,
      toko: x.t.unitAsset.toko ? `${x.t.unitAsset.toko.kodeToko} — ${x.t.unitAsset.toko.namaToko}` : '-',
      adaPart: x.t.parts.length > 0,
    }))
    const daftarPending = pendingLama
      .slice(0, 15)
      .map((p) => `${p.noTiket} (${p.umurHari} hari, ${p.model}, ${p.toko}, ${p.adaPart ? 'menunggu READY' : 'belum input part'})`)
      .join('; ')

    const teks = await chatCompletion(
      cfg,
      [
        {
          role: 'system',
          content: 'Kamu analis operasional bengkel after-sales. Jawab Bahasa Indonesia, ringkas, format bullet poin, maksimal 150 kata.',
        },
        {
          role: 'user',
          content:
            `Data hari ini:\n` +
            `- Tiket: ${cReq} REQUEST (${cSla} lewat SLA), ${cPros} PROSES, ${cFin} FINISH\n` +
            `- Sparepart: ${parts.length} item, ${kritis} di bawah ROP, ${kosong} kosong\n` +
            `- Toko: ${tokos.length} terdaftar, ${telat} telat visit\n` +
            `- Klaim tertahan: ${draft.length} tiket DRAFT senilai Rp ${Math.round(nilaiKlaim).toLocaleString('id-ID')}\n` +
            `- Unit terdaftar tanpa tiket: ${unitKosong} dari ${unitTotal}\n` +
            `- Unit pending >5 hari tanpa kode+nama part: ${pendingLamaSemua.length} unit${daftarPending ? ` (${daftarPending})` : ''}\n` +
            `Buat ringkasan kondisi + 3 prioritas tindakan utama hari ini. Bahas khusus unit pending >5 hari bila ada: kenapa menumpuk dan langkah konkret mengurai antreannya.`,
        },
      ],
      { temperature: 0.4, maxTokens: 800 }
    )
    return NextResponse.json({ ringkasan: teks, model: cfg.model, pendingLama, pendingLamaTotal: pendingLamaSemua.length })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 })
  }
}
