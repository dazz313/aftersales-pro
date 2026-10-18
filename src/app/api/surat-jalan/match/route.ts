import { NextResponse } from 'next/server'
import { requireActiveSession } from '@/lib/auth-server'
import { ambilKandidat, parseTabsheet, cocokkan, type HasilBaris, type Kandidat } from '@/lib/surat-jalan'
import { resolveAiConfig, chatCompletion, extractJson } from '@/lib/ai'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// POST /api/surat-jalan/match (FormData: file Excel/CSV + useAi?)
// Mengurai file surat jalan → cocokkan tiap baris ke part diorder (SV-EM /
// ORDER_PRODUSEN) & unit asset via aturan kode/nama/SN + bantuan AI opsional.
// TIDAK menulis database — hasil kembali ke UI untuk diperiksa & disimpan.
export async function POST(request: Request) {
  const { denied } = await requireActiveSession(request)
  if (denied) return denied
  try {
    const form = await request.formData()
    const file = form.get('file')
    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json({ error: 'File surat jalan (Excel/CSV) tidak terbaca' }, { status: 400 })
    }
    if (file.size > 8 * 1024 * 1024) {
      return NextResponse.json({ error: 'Ukuran file maksimal 8 MB' }, { status: 400 })
    }
    const useAi = form.get('useAi') !== 'false'
    const buffer = Buffer.from(await file.arrayBuffer())

    const parsed = parseTabsheet(buffer)
    const kandidat = await ambilKandidat()
    let hasil = cocokkan(parsed.rows, kandidat)
    let dibantuAi = 0
    if (useAi) {
      dibantuAi = await perbaikiDenganAi(hasil, kandidat)
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
      namaFile: file.name,
      terlewati: parsed.terlewati,
      dibantuAi,
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
      })),
    })
  } catch (error) {
    console.error('Surat jalan match error:', error)
    const pesan = error instanceof Error ? error.message : 'Gagal mengurai file surat jalan'
    return NextResponse.json({ error: pesan }, { status: 400 })
  }
}

// Bantu AI utk baris yang tak cocok aturan kode/nama/SN — maks 60 baris.
// AI HANYA memilih di antara kandidat yang benar-benar ada (tidak bisa mengarang).
async function perbaikiDenganAi(hasil: HasilBaris[], kandidat: Kandidat[]): Promise<number> {
  const kandidatSet = new Set(kandidat.map((c) => c.key))
  const barisBantu = hasil
    .map((h, i) => ({ h, i }))
    .filter((x) => x.h.statusMatch !== 'COCOK')
    .slice(0, 60)
  if (!barisBantu.length || !kandidat.length) return 0
  let dibantuAi = 0
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

    const jawab = await chatCompletion(cfg, [
      { role: 'system', content: 'Kamu asisten pencocokan surat jalan sparepart bengkel. Jawab HANYA JSON valid tanpa teks lain.' },
      {
        role: 'user',
        content:
          `Daftar part yang DIORDER ke produsen (kandidat, format key|nomorTiket|unit|kodePart|namaPart|qty):\n${deretTiket}\n\n` +
          `Baris surat jalan masuk yang BELUM cocok (format i|kode|nama|qty|sn):\n${deretBaris}\n\n` +
          `Susun pasangan baris surat jalan i → key kandidat yang PALING sesuai — pertimbangkan kemiripan nama part, kode, qty, dan SN unit. ` +
          `Bila tidak yakin, key = null. Jawab HANYA JSON: {"items":[{"i":0,"key":"p123","alasan":"singkat"}]}`,
      },
    ])
    const hasilJawab = extractJson<{ items?: { i?: number; key?: string | null; alasan?: string }[] }>(jawab)
    for (const it of hasilJawab.items ?? []) {
      if (typeof it.i !== 'number' || !hasil[it.i] || !it.key) continue
      if (!kandidatSet.has(it.key)) continue
      const cand = kandidat.find((c) => c.key === it.key)
      hasil[it.i] = { ...hasil[it.i], statusMatch: 'COCOK', cocokKandidat: cand, keterangan: `AI: ${it.alasan || 'dicocokkan berdasarkan kemiripan'}` }
      dibantuAi++
    }
  } catch (error) {
    console.error('Surat jalan AI error:', error)
    // AI gagal → kembalikan hasil aturan saja (tanpa galat keras).
  }
  return dibantuAi
}
