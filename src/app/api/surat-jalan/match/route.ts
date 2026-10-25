import { NextResponse } from 'next/server'
import { requireActiveSession } from '@/lib/auth-server'
import { ambilKandidat, parseTabsheet, cocokkan, type HasilBaris, type Kandidat } from '@/lib/surat-jalan'
import { teksDariPdf, uraikanTeksSuratJalan } from '@/lib/surat-jalan-teks'
import { ocrImage } from '@/lib/vision'
import { resolveAiConfig, chatCompletion, extractJson } from '@/lib/ai'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// POST /api/surat-jalan/match — EMPAT FORMAT MASUKAN:
// - file Excel/CSV        (FormData  `file`) → SheetJS
// - file PDF lapisan-teks (FormData  `file`) → pdfjs (tanpa OCR, paling akurat)
// - file PDF hasil scan   (FormData  `file`) → 422 PDF_HASIL_SCAN → KLIEN
//   meraster halaman (pdfjs browser) lalu merepost mode `teks` setelah OCR
// - gambar faktur (JPG/PNG/...) (FormData `file`) → tesseract OCR
// - Teks siap pakai       (FormData  `teks`) → hasil OCR klien (raster per halaman)
// Cocokkan tiap baris ke part diorder (SV-EM / ORDER_PRODUSEN) & unit asset
// via aturan kode/nama/SN + bantuan AI opsional. TIDAK menulis database.
const BTCU = (s: string) => s.replace(/\s/g, '')
export async function POST(request: Request) {
  const { denied } = await requireActiveSession(request)
  if (denied) return denied
  try {
    const form = await request.formData()
    const teksSiap = form.get('teks')
    let namaFile = 'hasil-scan-faktur'
    let parsed: { rows: Parameters<typeof cocokkan>[0]; noSuratJalan?: string; tglSurat: Date | null; produsen: string | null; terlewati: number }

    if (typeof teksSiap === 'string' && BTCU(teksSiap)) {
      parsed = uraikanTeksSuratJalan(teksSiap)
      const f = form.get('namaFile')
      if (typeof f === 'string' && f.trim()) namaFile = f.trim()
    } else {
      const file = form.get('file')
      if (!(file instanceof File) || file.size === 0) {
        return NextResponse.json({ error: 'File surat jalan (Excel/CSV/PDF/gambar) tidak terbaca' }, { status: 400 })
      }
      if (file.size > 8 * 1024 * 1024) {
        return NextResponse.json({ error: 'Ukuran file maksimal 8 MB' }, { status: 400 })
      }
      namaFile = file.name
      const useAi = form.get('useAi') !== 'false'
      const buffer = Buffer.from(await file.arrayBuffer())
      const nama = (file.name || '').toLowerCase()
      const mime = file.type || ''
      const isPdf = mime.includes('pdf') || nama.endsWith('.pdf')
      const isGambar = mime.startsWith('image/') || /\.(png|jpe?g|webp|bmp)$/i.test(nama)

      if (isPdf) {
        // Jalur 1: lapisan teks PDF — tanpa OCR (paling akurat). Bila lapisan
        // teksnya kosong (PDF hasil scan), lempar kode khusus → KLIEN yang
        // meraster halaman + OCR per halaman lalu menombok `teks` kembali.
        const teks = await teksDariPdf(buffer)
        if (BTCU(teks).length < 120) {
          const jumlahHalaman = await jumlahHalamanPdf(buffer).catch(() => 0)
          return NextResponse.json(
            {
              error: 'PDF_HASIL_SCAN',
              jumlahHalaman,
              pesan: 'PDF ini hasil scan (tanpa lapisan teks) — aplikasi akan meraster halamannya lalu OCR otomatis.',
            },
            { status: 422 }
          )
        }
        parsed = uraikanTeksSuratJalan(teks)
      } else if (isGambar) {
        // Jalur 2: foto/scan faktur — OCR tesseract langsung dari gambar.
        const ocr = await ocrImage(buffer)
        if (!BTCU(ocr.text)) {
          return NextResponse.json({ error: 'Gambar tidak berisi teks yang terbaca (OCR kosong) — pastikan foto cukup terang & tajam.' }, { status: 400 })
        }
        parsed = uraikanTeksSuratJalan(ocr.text)
      } else {
        // Jalur 3: Excel/CSV (alur asli).
        parsed = parseTabsheet(buffer)
      }
    }

    const useAi = form.get('useAi') !== 'false'
    const kandidat = await ambilKandidat()
    let hasil = cocokkan(parsed.rows, kandidat)
    let dibantuAi = 0
    let aiCatatan: string | null = null
    let aiModel: string | null = null
    if (useAi) {
      const bantu = await perbaikiDenganAi(hasil, kandidat)
      dibantuAi = bantu.dibantu
      aiCatatan = bantu.catatan
      aiModel = bantu.model
    }
    const cocokCount = hasil.filter((h) => h.statusMatch === 'COCOK').length
    const ringkas = (c: Kandidat) => ({
      key: c.key,
      serviceRequestId: c.serviceRequestId,
      noTiket: c.noTiket,
      statusTiket: c.statusTiket,
      unitId: c.unitId,
      serial: c.serial,
      model: c.model,
      tokoNama: c.tokoNama,
      kodePart: c.kodePart,
      namaPart: c.namaPart,
      qty: c.qty,
      sudahReady: c.sudahReady,
    })
    return NextResponse.json({
      noSuratJalan: parsed.noSuratJalan,
      tglSurat: parsed.tglSurat ? parsed.tglSurat.toISOString() : null,
      produsen: parsed.produsen,
      namaFile,
      terlewati: parsed.terlewati,
      dibantuAi,
      aiCatatan,
      aiModel,
      cocokCount,
      items: hasil.map((h) => ({
        kodePart: h.kodePart,
        namaPart: h.namaPart,
        qty: h.qty,
        serialNumber: h.serialNumber,
        statusMatch: h.statusMatch,
        cocokKey: h.cocokKandidat?.key,
        cocokCand: h.cocokKandidat ? ringkas(h.cocokKandidat) : undefined,
        opsi: h.opsi.map(ringkas),
        keterangan: h.keterangan,
        yakin: h.yakin,
      })),
    })
  } catch (error) {
    console.error('Surat jalan match error:', error)
    const pesan = error instanceof Error ? error.message : 'Gagal mengurai file surat jalan'
    return NextResponse.json({ error: pesan }, { status: 400 })
  }
}

/** Hitung jumlah halaman PDF (untuk info progres raster di klien). */
async function jumlahHalamanPdf(buffer: Buffer): Promise<number> {
  const pdfjs = await import(/* turbopackIgnore: true */ 'pdfjs-dist/legacy/build/pdf.mjs')
  const doc = await (pdfjs as unknown as { getDocument: (o: Record<string, unknown>) => { promise: Promise<{ numPages: number }> } }).getDocument({
    data: new Uint8Array(buffer),
    useWorkerFetch: false,
    isEvalSupported: false,
  }).promise as unknown as { numPages: number }
  return doc.numPages
}

// Bantu AI utk baris yang tak cocok aturan kode/nama/SN — maks 60 baris.
// AI HANYA memilih di antara kandidat yang benar-benar ada (tidak bisa mengarang).
// Model cadangan bila model utama (Pengaturan → AI Suggest) mati/timeout —
// urutan benchmark 9router 2026-10: kr/glm-5 & kr/claude-sonnet-4.5 hidup;
// jalur gemini/glm resmi masih blokir di level akun (403/401).
const AI_MODEL_CADANGAN = ['kr/glm-5', 'kr/claude-sonnet-4.5']

async function perbaikiDenganAi(
  hasil: HasilBaris[],
  kandidat: Kandidat[]
): Promise<{ dibantu: number; catatan: string | null; model: string | null }> {
  const kandidatSet = new Set(kandidat.map((c) => c.key))
  const barisBantu = hasil
    .map((h, i) => ({ h, i }))
    .filter((x) => x.h.statusMatch !== 'COCOK')
    .slice(0, 60)
  if (!barisBantu.length || !kandidat.length) return { dibantu: 0, catatan: null, model: null }
  try {
    const rows = await db.pengaturan.findMany({ select: { kunci: true, nilai: true } })
    const map: Record<string, string> = {}
    for (const r of rows) map[r.kunci] = r.nilai
    const cfg = resolveAiConfig(map)

    const deretTiket = kandidat
      .slice(0, 120)
      .map((c) => `${c.key}|${c.noTiket}|${c.serial || c.model}|${c.kodePart}|${c.namaPart}|qty ${c.qty}${c.sudahReady ? '|READY' : ''}`)
      .join('\n')
    const deretBaris = barisBantu
      .map((x) => `i=${x.i}|kode=${x.h.kodePart}|nama=${x.h.namaPart ?? '-'}|qty=${x.h.qty}|sn=${x.h.serialNumber ?? '-'}`)
      .join('\n')

    const pesan = [
      { role: 'system' as const, content: 'Kamu asisten pencocokan surat jalan sparepart bengkel. Jawab HANYA JSON valid tanpa teks lain, tanpa code fence.' },
      {
        role: 'user' as const,
        content:
          `Daftar part yang DIORDER ke produsen (kandidat, format key|nomorTiket|unit|kodePart|namaPart|qty):\n${deretTiket}\n\n` +
          `Baris surat jalan masuk yang BELUM cocok (format i|kode|nama|qty|sn):\n${deretBaris}\n\n` +
          `Susun pasangan baris surat jalan i → key kandidat yang PALING sesuai — pertimbangkan kemiripan nama part, kode, qty, dan SN unit. ` +
          `File surat jalan ini hasil OCR sehingga kode/nama bisa salah ketik — cocokkan yang benar-benar sama, bukan sekadar mirip. ` +
          `Bila tidak yakin, key = null. Jawab HANYA JSON: {"items":[{"i":0,"key":"p123","alasan":"singkat","yakin":85}]}`,
      },
    ]

    // Coba model utama lalu cadangan berurutan. Jawaban kosong/timeout = gagal
    // → lanjut model berikut. Latensi 9router bisa 45–100 detik per panggilan,
    // jadi timeout per model 180 detik.
    let jawab: string | null = null
    let modelPakai: string | null = null
    const gagal: string[] = []
    for (const m of [cfg.model, ...AI_MODEL_CADANGAN.filter((x) => x !== cfg.model)]) {
      try {
        jawab = await chatCompletion({ ...cfg, model: m }, pesan, { timeoutMs: 180000, maxTokens: 4000 })
        modelPakai = m
        break
      } catch (e) {
        gagal.push(`${m}: ${(e as Error).message.replace(/\s+/g, ' ').slice(0, 110)}`)
      }
    }
    if (!jawab || !modelPakai) {
      // Semua model gagal — jangan diam: laporkan ke UI agar pengguna tahu
      // hasilnya murni aturan tanpa koreksi AI.
      return { dibantu: 0, catatan: gagal.join(' • '), model: null }
    }

    let dibantuAi = 0
    const hasilJawab = extractJson<{ items?: { i?: number; key?: string | null; alasan?: string; yakin?: number }[] }>(jawab)
    for (const it of hasilJawab.items ?? []) {
      if (typeof it.i !== 'number' || !hasil[it.i] || !it.key) continue
      if (!kandidatSet.has(it.key)) continue
      const cand = kandidat.find((c) => c.key === it.key)
      const yakin = Math.max(0, Math.min(100, Math.round(Number(it.yakin) || 0)))
      hasil[it.i] = { ...hasil[it.i], statusMatch: 'COCOK', cocokKandidat: cand, yakin, keterangan: `AI ${yakin}%: ${it.alasan || 'dicocokkan berdasarkan kemiripan'}` }
      dibantuAi++
    }
    return { dibantu: dibantuAi, catatan: null, model: modelPakai }
  } catch (error) {
    console.error('Surat jalan AI error:', error)
    // AI gagal → kembalikan hasil aturan saja (tanpa galat keras).
    return { dibantu: 0, catatan: `kesalahan internal: ${(error as Error).message.slice(0, 110)}`, model: null }
  }
}
