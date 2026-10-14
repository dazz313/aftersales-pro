import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireActiveSession } from '@/lib/auth-server'
import { resolveAiConfig, chatCompletion, extractJson } from '@/lib/ai'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface Kandidat {
  kode: string
  nama: string
  brand: string
  stok: number
  frekuensi: number
}

interface Rekomendasi {
  kode: string
  alasan: string
}

// POST /api/ai/rekomendasi-part - AI meranking kandidat part hasil pelacakan
// body: { model: string, rusak: string, kandidat: Kandidat[] }
// Kode hasil SELALU dari kandidat (divalidasi) — AI tidak boleh mengarang kode.
export async function POST(request: Request) {
  try {
    const { denied } = await requireActiveSession(request)
    if (denied) return denied
    const body = (await request.json()) as { model?: string; rusak?: string; kandidat?: Kandidat[] }
    const model = String(body.model ?? '').trim()
    const rusak = String(body.rusak ?? '').trim()
    const kandidat = (Array.isArray(body.kandidat) ? body.kandidat : [])
      .filter((k) => k && typeof k.kode === 'string' && k.kode.trim())
      .slice(0, 10)
    if (kandidat.length === 0) {
      return NextResponse.json({ error: 'Tidak ada kandidat part untuk dianalisa.' }, { status: 400 })
    }
    const dikenal = new Set(kandidat.map((k) => k.kode.trim().toUpperCase()))

    const rows = await db.pengaturan.findMany({ select: { kunci: true, nilai: true } })
    const map: Record<string, string> = {}
    for (const r of rows) map[r.kunci] = r.nilai
    const cfg = resolveAiConfig(map)

    const daftar = kandidat
      .map((k) => `${k.kode}|${k.nama}|brand ${k.brand || '-'}|stok ${k.stok}|dipakai ${k.frekuensi}x`)
      .join('\n')
    const teks = await chatCompletion(
      cfg,
      [
        {
          role: 'system',
          content: 'Kamu montir senior sparepart elektronik. Jawab HANYA berupa JSON valid tanpa teks lain dan tanpa code fence.',
        },
        {
          role: 'user',
          content:
            `Unit model "${model || '-'}" rusak: "${rusak || '-'}". ` +
            `Pilih MAKSIMAL 3 part paling tepat dari kandidat berikut (kode harus sama persis, utamakan stok tersedia lalu frekuensi). ` +
            `Jelaskan alasan tiap pilihan dalam 1 kalimat Bahasa Indonesia.\n` +
            `Kandidat (kode|nama|brand|stok|dipakai):\n${daftar}\n` +
            `Format: {"rekomendasi":[{"kode":"KODE","alasan":"..."}],"catatan":"..."}`,
        },
      ],
      { temperature: 0.3, maxTokens: 1200 }
    )
    const parsed = extractJson<{ rekomendasi?: Rekomendasi[]; catatan?: string }>(teks)
    const rekomendasi: Rekomendasi[] = []
    for (const r of parsed.rekomendasi ?? []) {
      if (!r || typeof r.kode !== 'string') continue
      const kode = r.kode.trim().toUpperCase()
      if (!dikenal.has(kode) || rekomendasi.some((x) => x.kode === kode)) continue
      rekomendasi.push({ kode, alasan: typeof r.alasan === 'string' ? r.alasan.slice(0, 250) : '' })
      if (rekomendasi.length >= 3) break
    }
    if (rekomendasi.length === 0) {
      return NextResponse.json({ error: 'AI tidak mengembalikan rekomendasi yang valid — coba lagi.' }, { status: 502 })
    }
    return NextResponse.json({
      rekomendasi,
      catatan: typeof parsed.catatan === 'string' ? parsed.catatan.slice(0, 300) : '',
      model: cfg.model,
    })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 })
  }
}
