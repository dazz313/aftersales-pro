import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireActiveSession } from '@/lib/auth-server'
import { resolveAiConfig, chatCompletion } from '@/lib/ai'
import * as XLSX from 'xlsx'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// POST /api/ai/analisa-upload — ungah Excel/CSV → tulis isi file ke AI
// bersama RINGKASAN data aplikasi (toko, part, tiket, klaim) → AI membandingkan.
// TIDAK menulis ke database — hasil hanya analisa + perbandingan (pratinjau).

const MAKS_UKURAN = 8 * 1024 * 1024
const MAKS_BARIS = 5000
const SAMPEL_BARIS = 60
const MAKS_KOLOM = 15
const POTONG_SEL = 60

const potong = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)
const normAngka = (s: string) => {
  // Teks berkarakter huruf (kode toko/part "DK-01") BUKAN angka — jangan
  // diperlakukan numerik hanya karena punya tanda minus dari pemisah kode.
  if (/[A-Za-z]/.test(s)) return null
  const x = s.replace(/[^\d.,-]/g, '').replace(/,/g, '.')
  const v = Number(x)
  return Number.isFinite(v) && x !== '' ? v : null
}

export async function POST(request: Request) {
  const { denied } = await requireActiveSession(request)
  if (denied) return denied
  try {
    const form = await request.formData()
    const file = form.get('file')
    const pertanyaan = (form.get('pertanyaan') || '').toString().trim()
    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json({ error: 'File Excel/CSV tidak terbaca' }, { status: 400 })
    }
    if (file.size > MAKS_UKURAN) return NextResponse.json({ error: 'Ukuran file maksimal 8 MB' }, { status: 400 })

    // ── Parse file (Excel/CSV apa pun, pilih sheet dengan data terbanyak)
    const buffer = Buffer.from(await file.arrayBuffer())
    let wb: XLSX.WorkBook
    try {
      wb = XLSX.read(buffer, { type: 'buffer', cellDates: true })
    } catch {
      return NextResponse.json({ error: 'File bukan Excel/CSV yang valid (.xlsx/.xls/.csv)' }, { status: 400 })
    }
    let matriks: unknown[][] = []
    let namaSheet = ''
    for (const nama of wb.SheetNames) {
      const raw = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[nama], { header: 1, defval: '' })
      if (raw.length > matriks.length) { matriks = raw; namaSheet = nama }
    }
    if (!matriks.length) return NextResponse.json({ error: 'File kosong — tidak ada sheet berisi data' }, { status: 400 })

    // Baris header: baris pertama (≤10) paling banyak berisi teks non-angka
    let headerIdx = 0
    let skorTerbaik = -1
    for (let i = 0; i < Math.min(matriks.length, 10); i++) {
      const teks = (matriks[i] ?? []).map((v) => String(v ?? ''))
      const skor = teks.filter((c) => c.trim() && normAngka(c) === null).length
      if (skor > skorTerbaik) { skorTerbaik = skor; headerIdx = i }
    }
    const kolomMentah = (matriks[headerIdx] ?? []).map((v) => potong(String(v ?? '').trim() || 'Kolom', 40)).slice(0, MAKS_KOLOM)
    const barisMentah = matriks.slice(headerIdx + 1).filter((r) => (r as unknown[]).some((c) => String(c ?? '').trim() !== ''))
    const jumlahBaris = barisMentah.length
    if (!jumlahBaris) return NextResponse.json({ error: 'File tidak punya baris data setelah baris judul' }, { status: 400 })

    // Statistik sederhana per kolom angka (min/max/rata-rata)
    const statistik = kolomMentah.map((nama, kol) => {
      const angka = barisMentah
        .map((r) => normAngka(String((r as unknown[])[kol] ?? '')))
        .filter((v): v is number => v !== null)
      if (angka.length < Math.max(3, Math.floor(jumlahBaris * 0.5))) return null
      return {
        kolom: nama,
        terisiAngka: angka.length,
        minimum: Math.min(...angka),
        maksimum: Math.max(...angka),
        rataRata: Math.round((angka.reduce((a, b) => a + b, 0) / angka.length) * 100) / 100,
      }
    }).filter(Boolean)

    // Sampel baris utk AI (sel berpencar dari kolom angka-ganda? cukup teks)
    const sampel = barisMentah.slice(0, SAMPEL_BARIS).map((r) =>
      (r as unknown[]).slice(0, MAKS_KOLOM).map((v) => potong(String(v ?? ''), POTONG_SEL))
    )

    // ── Ringkasan data aplikasi (bahan perbandingan)
    const [statusGroup, klaimGroup, tokos, parts, unitPerToko] = await Promise.all([
      db.serviceRequest.groupBy({ by: ['status'], _count: { _all: true } }),
      db.serviceRequest.groupBy({ by: ['statusKlaimProdusen'], _count: { _all: true } }),
      db.masterToko.findMany({ select: { id: true, kodeToko: true, namaToko: true }, orderBy: { namaToko: 'asc' }, take: 60 }),
      db.masterSparepart.findMany({ select: { kodePart: true, namaPart: true, stokJual: true, stokGaransi: true }, orderBy: { stokJual: 'desc' }, take: 80 }),
      // Jumlah unit per toko (buangan jumlahUnit bukan kolom DB — dihitung).
      db.unitAsset.groupBy({ by: ['tokoId'], _count: { _all: true } }),
    ])
    const unitPerTokoMap = new Map(unitPerToko.map((u) => [u.tokoId, u._count._all]))
    const [totalToko, totalPart] = await Promise.all([db.masterToko.count(), db.masterSparepart.count()])
    const digestApp =
      `Data aplikasi (AfterSales Pro):\n` +
      `- Tiket status: ${statusGroup.map((s) => `${s.status} ${s._count._all}`).join(', ') || '-'}\n` +
      `- Klaim produsen: ${klaimGroup.map((s) => `${s.statusKlaimProdusen} ${s._count._all}`).join(', ') || '-'}\n` +
      `- Master toko ${totalToko} (60 pertama): ${tokos.map((t) => `${t.kodeToko}=${t.namaToko}(${unitPerTokoMap.get(t.id) ?? 0} unit)`).join('; ') || '-'}\n` +
      `- Master part ${totalPart} (80 stok-jual terbesar): ${parts.map((p) => `${p.kodePart} ${p.namaPart} [jual ${p.stokJual}/garansi ${p.stokGaransi}]`).join('; ') || '-'}\n`

    // ── Perbandingan DETERMINISTIK (tanpa AI — selalu tersedia)
    // Baris file dicocokkan versus master toko & part aplikasi via normalisasi
    // teks (huruf besar / tanpa tanda baca). Hasilnya dikembalikan APA PUN
    // nasib AI: angka pasti lebih penting daripada narasi.
    const NORMX = (s: string) => (s || '').toString().toUpperCase().replace(/[^A-Z0-9#]/g, '')
    const [tokoSemua, partSemua] = await Promise.all([
      db.masterToko.findMany({ select: { kodeToko: true, namaToko: true } }),
      db.masterSparepart.findMany({ select: { kodePart: true, namaPart: true, stokJual: true, stokGaransi: true } }),
    ])
    const tokoKey = new Set<string>()
    for (const t of tokoSemua) { tokoKey.add(NORMX(t.kodeToko)); tokoKey.add(NORMX(t.namaToko)) }
    const partKey = new Map<string, { namaPart: string; stokJual: number; stokGaransi: number }>()
    for (const p of partSemua) partKey.set(NORMX(p.kodePart), p)
    const tokoCocok = new Set<string>()
    const tokoTidak = new Set<string>()
    const partCocok = new Set<string>()
    const partTidak = new Set<string>()
    for (const baris of barisMentah) {
      for (const sel of baris as unknown[]) {
        const teks = String(sel ?? '').trim()
        const k = NORMX(teks)
        if (k.length < 2) continue
        if (tokoKey.has(k)) {
          if (tokoCocok.size < 40 || tokoCocok.has(teks)) tokoCocok.add(teks)
        } else if (partKey.has(k)) {
          if (partCocok.size < 40 || partCocok.has(teks)) partCocok.add(teks)
        } else {
          // Kandidat kode part (ada huruf + angka) mana yang tak dikenal katalog;
          // teks bebas lain dihitung sebagai identitas toko yang tak terdaftar.
          if (/^[A-Z0-9][A-Z0-9\-\/\.]{2,24}$/.test(k) && /[A-Z]/.test(k) && /\d/.test(k)) partTidak.add(teks)
          else if (teks.length >= 3) tokoTidak.add(teks)
        }
      }
    }
    const bandingkan = {
      tokoCocok: [...tokoCocok].slice(0, 10),
      tokoTidak: [...tokoTidak].slice(0, 10),
      partCocok: [...partCocok].slice(0, 10),
      partTidak: [...partTidak].slice(0, 10),
    }

    // ── Analisa via AI (OPSIONAL — gagal tidak menggugurkan hasil bandingkan)
    const pengaturan = await db.pengaturan.findMany({ select: { kunci: true, nilai: true } })
    const map: Record<string, string> = {}
    for (const r of pengaturan) map[r.kunci] = r.nilai
    const cfg = resolveAiConfig(map)
    const fileDeskripsi =
      `FILE: ${file.name} (sheet '${namaSheet || '-'}', ${jumlahBaris} baris data, ${kolomMentah.length} kolom).\n` +
      (statistik.length ? `Statistik kolom angka: ${statistik.map((s) => `${(s as { kolom: string }).kolom} [min ${(s as { minimum: number }).minimum} · max ${(s as { maksimum: number }).maksimum} · avg ${(s as { rataRata: number }).rataRata}]`).join('; ')}\n` : '') +
      `JUDUL KOLOM: ${kolomMentah.map((k, i) => `${i}: ${k}`).join(' | ')}\n` +
      `SAMPEL ${sampel.length}/${jumlahBaris} baris (dipisah |):\n` +
      sampel.map((r) => r.join(' | ')).join('\n')

    let analisa: string | null = null
    let catatan: string | null = null
    try {
      analisa = await chatCompletion(
        cfg,
        [
          {
            role: 'system',
            content:
              'Kamu analis data after-sales. Bandingkan file unggahan dengan data aplikasi. ' +
              'Jawab Bahasa Indonesia dengan format TEPAT: bagian 1–4, tiap bagian bullet: ' +
              '1) Struktur file & statistik ringkas, 2) Pemetaan ke data aplikasi (toko/part yang cocok vs tak dikenal, tulis only unmatched), ' +
              '3) Perbandingan & anomali (duplikat, selisih angka, format tidak konsisten), 4) Saran tindakan. Maksimum 300 kata.',
          },
          {
            role: 'user',
            content:
              `${fileDeskripsi}\n\n${digestApp}\n` +
              (pertanyaan ? `Pertanyaan spesifik pengguna: "${pertanyaan}"\nJawab terutama pertanyaan ini.\n\n` : '') +
              'Tugas: analisa file tersebut dan BANDINGKAN dengan data aplikasi di atas — mana yang sudah ada, mana yang belum terdaftar, selisih angka yang mencolok, dan rekomendasi.',
          },
        ],
        { temperature: 0.3, maxTokens: 1600, timeoutMs: 60000 }
      )
    } catch (e) {
      catatan = `Narasi AI tidak tersedia (${(e as Error).message}). Hasil perbandingan tetap tersedia di bawah — dibuat mesin, bukan AI.`
    }

    return NextResponse.json({
      analisa,
      catatan,
      model: cfg.model,
      fileMeta: { namaFile: file.name, sheet: namaSheet, jumlahBaris, kolom: kolomMentah },
      statistik,
      bandingkan,
    })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 })
  }
}
