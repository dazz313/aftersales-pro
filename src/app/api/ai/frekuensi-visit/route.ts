import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireActiveSession } from '@/lib/auth-server'
import { resolveAiConfig, chatCompletion, extractJson } from '@/lib/ai'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// ===== Kriteria kategori toko (terbaca di UI sebagai legenda) =====
export const FREQ_WINDOW_HARI = 90
export const FREQ_MINGGU = 12
export const FREQ_AMBANG = {
  /** Kategori A (banyak laporan): tiket90 >= 5 ATAU tiketAll >= 10 → repeat singkat 7 hari */
  aTiket90: 5,
  aTiketAll: 10,
  /** Kategori B (konsisten): minggu aktif >= 6 dari 12 + tiket90 >= 2 → 14 hari */
  bMinggu: 6,
  bTiket90: 2,
} as const
export const SIKLUS_BOLEH = [4, 7, 10] as const
export type KategoriToko = 'A' | 'B' | 'C' | 'D'

export function kategoriBaseline(tiket90: number, tiketAll: number, mingguAktif: number): { kategori: KategoriToko; siklus: number } {
  if (tiket90 >= FREQ_AMBANG.aTiket90 || tiketAll >= FREQ_AMBANG.aTiketAll) return { kategori: 'A', siklus: 4 }
  if (mingguAktif >= FREQ_AMBANG.bMinggu && tiket90 >= FREQ_AMBANG.bTiket90) return { kategori: 'B', siklus: 7 }
  if (tiketAll >= 1) return { kategori: 'C', siklus: 10 }
  return { kategori: 'D', siklus: 10 }
}

interface SaranAI {
  kode: string
  kategori: string
  siklus: number
  alasan: string
}

// POST /api/ai/frekuensi-visit — analisa frekuensi kunjungan per toko.
// Menghitung statistik laporan kerusakan per toko (90 hari + konsistensi 12 minggu),
// memberi kategori A/B/C/D + siklus baseline, lalu AI mempertimbangkan jarak
// workshop, kepatuhan, dan jumlah unit untuk saran akhir. AI boleh menggeser
// kategori maksimal 1 tingkat bila beralasan. Tanpa AI (gangguan 9router),
// baseline tetap dikembalikan agar fitur tetap berguna.
export async function POST(request: Request) {
  try {
    const { denied } = await requireActiveSession(request)
    if (denied) return denied

    const now = Date.now()
    const batas90 = new Date(now - FREQ_WINDOW_HARI * 24 * 3600 * 1000)

    const [tokoList, tickets, kunjungan] = await Promise.all([
      db.masterToko.findMany({
        include: { unitAssets: { select: { id: true } } },
        orderBy: { kodeToko: 'asc' },
      }),
      db.serviceRequest.findMany({
        select: { tglTiket: true, unitAsset: { select: { tokoId: true } } },
        orderBy: { tglTiket: 'desc' },
        take: 5000,
      }),
      db.kunjungan.findMany({
        where: { tglKunjungan: { gte: batas90 } },
        select: { tokoId: true },
      }),
    ])

    interface Stat {
      id: number
      kode: string
      nama: string
      siklusAktif: number
      kategori: KategoriToko
      siklusBaseline: number
      tiket90: number
      tiketAll: number
      mingguAktif: number
      kunjungan90: number
      terakhirLaporan: string | null
      terlambat: boolean
      hariSejakVisit: number | null
      unit: number
      jarakKm: number | null
    }

    const stats: Stat[] = tokoList
      // Toko tidak aktif (dicentang) & siklus BY REQUEST bukan kandidat
      // penjadwalan otomatis — dikecualikan dari analisa frekuensi visit.
      .filter((t) => t.aktif && t.modeSiklus !== 'BY_REQUEST')
      .map((t) => {
      const milik = tickets.filter((tk) => tk.unitAsset?.tokoId === t.id)
      const t90 = milik.filter((tk) => new Date(tk.tglTiket).getTime() >= batas90.getTime())
      // Konsistensi: jumlah minggu berbeda (dari 12 minggu terakhir) yang ada laporan
      const minggu = new Set<string>()
      for (const tk of milik) {
        const d = new Date(tk.tglTiket).getTime()
        const mingguLalu = Math.floor((now - d) / (7 * 24 * 3600 * 1000))
        if (mingguLalu >= 0 && mingguLalu < FREQ_MINGGU) minggu.add(`m${mingguLalu}`)
      }
      const terakhir = milik.length ? new Date(milik[0].tglTiket).toISOString() : null
      const hariSejak = t.tglVisitTerakhir
        ? Math.floor((now - new Date(t.tglVisitTerakhir).getTime()) / (24 * 3600 * 1000))
        : null
      const { kategori, siklus } = kategoriBaseline(t90.length, milik.length, minggu.size)
      return {
        id: t.id,
        kode: t.kodeToko,
        nama: t.namaToko,
        siklusAktif: t.frekuensiVisit,
        kategori,
        siklusBaseline: siklus,
        tiket90: t90.length,
        tiketAll: milik.length,
        mingguAktif: minggu.size,
        kunjungan90: kunjungan.filter((k) => k.tokoId === t.id).length,
        terakhirLaporan: terakhir,
        terlambat: hariSejak === null || hariSejak > t.frekuensiVisit,
        hariSejakVisit: hariSejak,
        unit: t.unitAssets.length,
        jarakKm: t.jarakKm ?? null,
      }
    })

    const dikenal = new Map(stats.map((s) => [s.kode.trim().toUpperCase(), s]))
    const jarakTerisi = stats.filter((s) => s.jarakKm !== null).length

    // ===== Minta AI mempertimbangkan semua kriteria =====
    let ai: { saran: { kode: string; kategori: KategoriToko; siklus: number; alasan: string }[]; catatan: string; model: string } | null = null
    let aiError: string | null = null
    try {
      const rows = await db.pengaturan.findMany({ select: { kunci: true, nilai: true } })
      const map: Record<string, string> = {}
      for (const r of rows) map[r.kunci] = r.nilai
      const cfg = resolveAiConfig(map)

      const daftar = stats
        .map(
          (s) =>
            `${s.kode}|${s.nama}|siklus-aktif ${s.siklusAktif}h|kategori-aturan ${s.kategori}|tiket90 ${s.tiket90}|tiket-all ${s.tiketAll}|` +
            `minggu-aktif ${s.mingguAktif}/12|kunjungan90 ${s.kunjungan90}|terakhir-lapor ${s.terakhirLaporan ? s.terakhirLaporan.slice(0, 10) : 'belum-pernah'}|` +
            `${s.terlambat ? 'TERLAMBAT' : 'rutin'}|${s.unit}u|jarak ${s.jarakKm !== null ? `${s.jarakKm}km` : 'tak-diketahui'}`
        )
        .join('\n')
      const teks = await chatCompletion(
        cfg,
        [
          {
            role: 'system',
            content: 'Kamu analis operasional bengkel sparepart. Jawab HANYA berupa JSON valid tanpa teks lain dan tanpa code fence.',
          },
          {
            role: 'user',
            content:
              `Tentukan siklus kunjungan ideal tiap toko (pilihan HANYA: 4, 7, atau 10 hari — jangan lebih dari 10 hari) dengan mempertimbangkan:\n` +
              `1) Kategori A = banyak laporan kerusakan (repeat kunjungan lebih singkat); ` +
              `2) Kategori B = laporan tidak terlalu banyak tapi konsisten selalu ada; ` +
              `3) Kategori C = jarang ada laporan; 4) Kategori D = belum pernah ada laporan.\n` +
              `5) Jarak toko dari workshop: toko JAUH berkategori C/D sebaiknya siklus panjang (hemat biaya jalan), ` +
              `toko DEKAT berkategori A/B boleh siklus singkat; bila jarak tak-diketahui, abaikan jarak.\n` +
              `6) Kepatuhan (yang TERLAMBAT harus diprioritaskan) dan jumlah unit.\n` +
              `Kategori-aturan sudah dihitung sistem — pertahankan, kecuali ada alasan kuat (boleh geser maks 1 tingkat, mis. B→A bila TERLAMBAT parah).\n` +
              `Toko (kode|nama|siklus|saran-aturan|tiket90|tiket-all|minggu|kunjungan|terakhir|status|unit|jarak):\n${daftar}\n` +
              `Format: {"saran":[{"kode":"KODE","kategori":"A","siklus":7,"alasan":"<1 kalimat>"}],"catatan":"<1 kalimat>"}`,
          },
        ],
        { temperature: 0.2, maxTokens: 3000 }
      )
      const parsed = extractJson<{ saran?: SaranAI[]; catatan?: string }>(teks)
      const saran: { kode: string; kategori: KategoriToko; siklus: number; alasan: string }[] = []
      for (const r of parsed.saran ?? []) {
        if (!r || typeof r.kode !== 'string') continue
        const kode = r.kode.trim().toUpperCase()
        const ref = dikenal.get(kode)
        if (!ref || saran.some((x) => x.kode === kode)) continue
        const kategori = (['A', 'B', 'C', 'D'] as const).includes(r.kategori as KategoriToko)
          ? (r.kategori as KategoriToko)
          : ref.kategori
        const siklus = SIKLUS_BOLEH.includes(r.siklus as (typeof SIKLUS_BOLEH)[number]) ? r.siklus : ref.siklusBaseline
        saran.push({ kode, kategori, siklus, alasan: typeof r.alasan === 'string' ? r.alasan.slice(0, 250) : '' })
      }
      if (saran.length === 0) throw new Error('AI tidak mengembalikan saran yang valid')
      ai = {
        saran,
        catatan: typeof parsed.catatan === 'string' ? parsed.catatan.slice(0, 300) : '',
        model: cfg.model,
      }
    } catch (e) {
      aiError = (e as Error).message
    }

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      windowHari: FREQ_WINDOW_HARI,
      mingguKonsistensi: FREQ_MINGGU,
      ambang: FREQ_AMBANG,
      jarakTerisi,
      jarakTotal: stats.length,
      toko: stats,
      ai,
      aiError,
    })
  } catch (error) {
    console.error('Frekuensi-visit error:', error)
    return NextResponse.json({ error: 'Gagal menganalisa frekuensi kunjungan' }, { status: 500 })
  }
}
