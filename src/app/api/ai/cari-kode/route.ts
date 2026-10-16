import { NextResponse } from 'next/server'
import { requireActiveSession } from '@/lib/auth-server'
import { resolveAiConfig, chatCompletion, extractJson } from '@/lib/ai'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface Kandidat {
  kode: string
  nama: string
  brand: string
  produsen: string
}

interface Rekomendasi {
  kode: string
  alasan: string
}

// POST /api/ai/cari-kode — "Powered AI" untuk Bank Kode produsen.
// body: { butuh: string, kandidat?: Kandidat[] }
// Bila kandidat tidak dikirim, server mengambil 15 kode teratas dari bank.
// Kode hasil SELALU dari kandidat/bank (divalidasi) — AI tidak boleh mengarang kode.
export async function POST(request: Request) {
  try {
    const { denied } = await requireActiveSession(request)
    if (denied) return denied
    const body = (await request.json()) as { butuh?: string; kandidat?: Kandidat[] }
    const butuh = String(body.butuh ?? '').trim()
    if (!butuh) {
      return NextResponse.json({ error: 'Ceritakan dulu kebutuhan kode yang dicari.' }, { status: 400 })
    }
    let kandidat = (Array.isArray(body.kandidat) ? body.kandidat : [])
      .filter((k) => k && typeof k.kode === 'string' && k.kode.trim())
      .slice(0, 15)
    if (kandidat.length === 0) {
      const bank = await db.bankKode.findMany({ orderBy: { kode: 'asc' }, take: 15 })
      kandidat = bank.map((b) => ({ kode: b.kode, nama: b.namaPart, brand: b.brandKompatibel, produsen: b.produsen }))
    }
    if (kandidat.length === 0) {
      return NextResponse.json({ error: 'Bank Kode masih kosong — sinkronkan atau import CSV dulu.' }, { status: 400 })
    }
    const dikenal = new Set(kandidat.map((k) => k.kode.trim().toUpperCase()))

    const rows = await db.pengaturan.findMany({ select: { kunci: true, nilai: true } })
    const map: Record<string, string> = {}
    for (const r of rows) map[r.kunci] = r.nilai
    const cfg = resolveAiConfig(map)

    const daftar = kandidat
      .map((k) => `${k.kode}|${k.nama || '-'}|brand ${k.brand || '-'}|produsen ${k.produsen || '-'}`)
      .join('\n')
    const teks = await chatCompletion(
      cfg,
      [
        {
          role: 'system',
          content: 'Kamu ahli katalog sparepart elektronik. Jawab HANYA berupa JSON valid tanpa teks lain dan tanpa code fence.',
        },
        {
          role: 'user',
          content:
            `Kebutuhan teknisi: "${butuh}". ` +
            `Pilih MAKSIMAL 3 kode paling sesuai dari bank kode berikut (kode harus sama persis, cocokkan nama/brand/produsen dengan kebutuhan). ` +
            `Jelaskan alasan tiap pilihan dalam 1 kalimat Bahasa Indonesia.\n` +
            `Bank (kode|nama|brand|produsen):\n${daftar}\n` +
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
