import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireActiveSession } from '@/lib/auth-server'
import { resolveAiConfig, chatCompletion, extractJson } from '@/lib/ai'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface TokoAI {
  kode: string
  nama: string
  siklus: number
  sejakHari: number | null
  unit: number
  terlambat: boolean
}

interface RencanaHari {
  hari: string
  kode: string[]
  alasan: string
}

// POST /api/ai/suggest - susun jadwal kunjungan via 9router
// body: { stores: TokoAI[], hari: string[] } (hari = label tanggal, maks 6)
export async function POST(request: Request) {
  try {
    const { denied } = await requireActiveSession(request)
    if (denied) return denied
    const body = (await request.json()) as { stores?: TokoAI[]; hari?: string[] }
    const stores = (Array.isArray(body.stores) ? body.stores : [])
      .filter((s) => s && typeof s.kode === 'string' && s.kode.trim())
      .slice(0, 30)
    const hari = (Array.isArray(body.hari) ? body.hari : []).filter((h) => typeof h === 'string').slice(0, 6)
    if (stores.length === 0 || hari.length === 0) {
      return NextResponse.json({ error: 'Data toko/hari kosong.' }, { status: 400 })
    }
    const dikenal = new Set(stores.map((s) => s.kode.trim().toUpperCase()))

    const rows = await db.pengaturan.findMany({ select: { kunci: true, nilai: true } })
    const map: Record<string, string> = {}
    for (const r of rows) map[r.kunci] = r.nilai
    const cfg = resolveAiConfig(map)

    const daftar = stores
      .map((s) => `${s.kode}|${s.nama}|siklus ${s.siklus}h|sejak ${s.sejakHari ?? 'belum-pernah'}|${s.unit}u|${s.terlambat ? 'TERLAMBAT' : 'rutin'}`)
      .join('\n')
    const teks = await chatCompletion(
      cfg,
      [
        {
          role: 'system',
          content: 'Kamu penjadwal kunjungan teknisi bengkel sparepart. Jawab HANYA berupa JSON valid tanpa teks lain dan tanpa code fence.',
        },
        {
          role: 'user',
          content:
            `Susun ${stores.length} toko ke ${hari.length} hari kerja berikut, beban seimbang, tiap toko tepat 1x. ` +
            `Dahulukan yang TERLAMBAT dan lama tak dikunjungi; sebar toko berunit banyak.\n` +
            `Hari: ${hari.join(' | ')}\n` +
            `Toko (kode|nama|siklus|sejak|unit|status):\n${daftar}\n` +
            `Format: {"rencana":[{"hari":"<label hari sama persis>","kode":["KODE"],"alasan":"<satu kalimat>"}],"catatan":"<satu kalimat>"}`,
        },
      ],
      { temperature: 0.2, maxTokens: 2000 }
    )
    const parsed = extractJson<{ rencana?: RencanaHari[]; catatan?: string }>(teks)
    const rencana: RencanaHari[] = []
    const sudah: string[] = []
    for (const r of parsed.rencana ?? []) {
      if (!r || typeof r.hari !== 'string') continue
      const kode = (Array.isArray(r.kode) ? r.kode : [])
        .map((k) => String(k).trim().toUpperCase())
        .filter((k) => dikenal.has(k) && !sudah.includes(k))
      for (const k of kode) sudah.push(k)
      if (kode.length === 0) continue
      rencana.push({ hari: r.hari, kode, alasan: typeof r.alasan === 'string' ? r.alasan.slice(0, 200) : '' })
    }
    if (rencana.length === 0) {
      return NextResponse.json({ error: 'AI tidak mengembalikan jadwal yang valid — coba lagi.' }, { status: 502 })
    }
    return NextResponse.json({
      rencana,
      catatan: typeof parsed.catatan === 'string' ? parsed.catatan.slice(0, 300) : '',
      model: cfg.model,
      takTerjadwal: stores.map((s) => s.kode).filter((k) => !sudah.includes(k.trim().toUpperCase())),
    })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 })
  }
}
