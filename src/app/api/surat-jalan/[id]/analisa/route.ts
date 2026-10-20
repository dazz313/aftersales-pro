import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { requireActiveSession } from '@/lib/auth-server'
import { ambilKandidat, similarity, type Kandidat } from '@/lib/surat-jalan'
import { resolveAiConfig, chatCompletion, extractJson } from '@/lib/ai'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * POST /api/surat-jalan/[id]/analisa — ANALISA AI KIRIM vs TERIMA.
 * ---------------------------------------------------------------
 * Dicetuskan manual lewat tombol "Analisa AI" (hemat — bukan otomatis).
 * Pembanding:
 *   KIRIM  : dokumen Surat Jalan REQUEST (SJR-…) yang memuat part/unit yang
 *            pernah dikirim ke produsen — utamakan doc yang dirujuk draft
 *            (refSjrNo); bila kosong, SJR yang berisi tiket-tiket draft ini.
 *   TERIMA : baris draft surat jalan masuk ini (Excel hasil OCR).
 * Hasilnya: pasangan SAMA/BEDA_QTY/KIRIM_TANPA_TERIMA/TERIMA_TANPA_KIRIM +
 * SARAN penautan untuk baris yang belum tertaut — dgn skor keyakinan.
 * TIDAK menulis database apa pun — saran diterima manual per baris lewat
 * POST /api/surat-jalan/[id]/item (asalSaran: 'AI'), tercatat di Audit Log.
 */

const NORM = (s: string | null | undefined) => (s || '').toString().toUpperCase().replace(/[^A-Z0-9#]/g, '')

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { session, denied } = await requireActiveSession(request)
    if (denied) return denied
    const { id } = await ctx.params
    const sjId = Number(id)

    const sj = await db.suratJalanMasuk.findUnique({
      where: { id: sjId },
      include: { items: { orderBy: { id: 'asc' } } },
    })
    if (!sj) return NextResponse.json({ error: 'Draft surat jalan tidak ditemukan' }, { status: 404 })

    // ===== Sumber sisi KIRIM =====
    // 1) doc yang dirujuk draft (refSjrNo) bila diisi; 2) bila kosong: SJR yang
    // memuat tiket-tiket yang dilink draft ini; 3) tidak ada sekali → TIDAK_ADA.
    const tiketIds = [...new Set(sj.items.filter((i) => i.cocokTiketId != null).map((i) => i.cocokTiketId as number))]
    let docs: { noSurat: string; tglRequest: Date; items: { serviceRequestId: number | null; noTiket: string; kodePart: string; namaPart: string | null; qty: number; serialNumber: string | null }[] }[] = []
    let sumber: 'REF_SJR' | 'SJR_TIKET' | 'TIDAK_ADA' = 'TIDAK_ADA'
    if (sj.refSjrNo) {
      const ref = await db.suratJalanRequest.findUnique({
        where: { noSurat: sj.refSjrNo },
        select: { noSurat: true, tglRequest: true, items: { select: { serviceRequestId: true, noTiket: true, kodePart: true, namaPart: true, qty: true, serialNumber: true } } },
      })
      if (ref) {
        docs = [ref]
        sumber = 'REF_SJR'
      }
    }
    if (docs.length === 0 && tiketIds.length > 0) {
      const sjrs = await db.suratJalanRequest.findMany({
        where: { items: { some: { serviceRequestId: { in: tiketIds } } } },
        orderBy: { tglRequest: 'desc' },
        take: 10,
        select: { noSurat: true, tglRequest: true, items: { select: { serviceRequestId: true, noTiket: true, kodePart: true, namaPart: true, qty: true, serialNumber: true } } },
      })
      if (sjrs.length > 0) {
        docs = sjrs
        sumber = 'SJR_TIKET'
      }
    }

    // ===== KIRIM terpetakan: kunci = serviceRequestId|kodeN → agregat qty =====
    interface KirimMap { qty: number; docs: Set<string>; tgl: Date | null; noTiket: string; kode: string; nama: string | null; sn: string | null }
    const kirimMap = new Map<string, KirimMap>()
    for (const d of docs) {
      for (const it of d.items) {
        if (it.serviceRequestId == null) continue
        const kunci = `${it.serviceRequestId}|${NORM(it.kodePart)}`
        const k = kirimMap.get(kunci) ?? { qty: 0, docs: new Set<string>(), tgl: null, noTiket: it.noTiket, kode: it.kodePart, nama: it.namaPart, sn: it.serialNumber }
        k.qty += it.qty
        k.docs.add(d.noSurat)
        if (!k.tgl || d.tglRequest > k.tgl) k.tgl = d.tglRequest
        if (!k.sn && it.serialNumber) k.sn = it.serialNumber
        kirimMap.set(kunci, k)
      }
    }

    // ===== TERIMA tertaut: kunci = tiket|kodeN → agregat =====
    const terimaMap = new Map<string, { qty: number; itemIds: number[]; sn: string | null; kode: string }>()
    for (const it of sj.items) {
      if (it.cocokTiketId == null || it.qty <= 0) continue
      const kunci = `${it.cocokTiketId}|${NORM(it.kodePart)}`
      const t = terimaMap.get(kunci) ?? { qty: 0, itemIds: [], sn: null, kode: it.kodePart }
      t.qty += it.qty
      t.itemIds.push(it.id)
      if (!t.sn && it.serialNumber) t.sn = it.serialNumber
      terimaMap.set(kunci, t)
    }

    // ===== Diterima di dokumen lain (informasi, khusus KIRIM_TANPA_TERIMA) =====
    const sjsLain = await db.suratJalanMasuk.findMany({
      where: { id: { not: sjId }, status: { in: ['DRAFT', 'DIPERIKSA', 'DITERAPKAN'] } },
      select: { noSuratJalan: true, status: true, items: { select: { cocokTiketId: true, kodePart: true } } },
    })
    const diterimaLain = new Map<string, string[]>() // tiket|kodeN → daftar no doc
    for (const s of sjsLain) {
      for (const li of s.items) {
        if (li.cocokTiketId == null) continue
        const kunci = `${li.cocokTiketId}|${NORM(li.kodePart)}`
        const arr = diterimaLain.get(kunci) ?? []
        arr.push(s.noSuratJalan)
        diterimaLain.set(kunci, arr)
      }
    }

    // ===== Pasangan deterministik =====
    const pasangan: {
      jenis: 'SAMA' | 'BEDA_QTY' | 'KIRIM_TANPA_TERIMA' | 'TERIMA_TANPA_KIRIM'
      kode: string
      nama?: string | null
      sn?: string | null
      kirim?: { noSjr: string; tgl: string | null; qty: number; noTiket: string } | null
      terima?: { itemId: number; kodeAsli: string; qty: number; tiket?: string | null } | null
      catatan?: string
    }[] = []
    const kunciTerpakai = new Set<string>() // kunci kirim yg sudah berpasangan
    for (const [kunci, k] of kirimMap) {
      const t = terimaMap.get(kunci)
      if (!t) continue
      kunciTerpakai.add(kunci)
      pasangan.push({
        jenis: k.qty === t.qty ? 'SAMA' : 'BEDA_QTY',
        kode: t.kode,
        nama: k.nama,
        sn: t.sn ?? k.sn,
        kirim: { noSjr: [...k.docs].join(', '), tgl: k.tgl ? k.tgl.toISOString() : null, qty: k.qty, noTiket: k.noTiket },
        terima: { itemId: t.itemIds[0], kodeAsli: t.kode, qty: t.qty, tiket: null },
        catatan: k.qty === t.qty ? undefined : `Kirim ${k.qty} vs terima ${t.qty} — hitung ulang qty.`,
      })
    }
    // KIRIM tanpa terima — produsen belum kirim / datang via doc lain
    for (const [kunci, k] of kirimMap) {
      if (kunciTerpakai.has(kunci)) continue
      const lain = diterimaLain.get(kunci) ?? []
      pasangan.push({
        jenis: 'KIRIM_TANPA_TERIMA',
        kode: k.kode,
        nama: k.nama,
        sn: k.sn,
        kirim: { noSjr: [...k.docs].join(', '), tgl: k.tgl ? k.tgl.toISOString() : null, qty: k.qty, noTiket: k.noTiket },
        terima: null,
        catatan: lain.length > 0 ? `Tercatat diterima via ${ lain.join(', ') } (doc lain)` : 'Belum ada kiriman masuk yang mencatat part ini',
      })
    }

    // ===== Baris TERIMA yang belum tertaut → saran penautan =====
    const perluKandidat = tiketIds.length > 0 || sj.items.some((i) => i.cocokTiketId == null)
    const kandidat = perluKandidat ? await ambilKandidat() : []
    const belumTaut = sj.items.filter((i) => i.cocokTiketId == null && i.qty > 0)
    const saran: {
      terimaId: number
      kodeAsli: string
      kodeSaran: string | null
      noTiket: string
      noSjr?: string | null
      saranKey: string
      alasan: string
      yakin: number
    }[] = []

    // Deterministik: SN unit sama + nama mirip / kirim doc jadi jembatan
    const sisaUntukAi: { idx: number; item: (typeof belumTaut)[number] }[] = []
    for (const it of belumTaut) {
      let terbaik: { cand: Kandidat; skor: number; alasan: string } | null = null
      for (const c of kandidat) {
        let skor = 0
        let alasan = ''
        const snSama = it.serialNumber && c.serial && NORM(it.serialNumber) === NORM(c.serial)
        if (snSama) { skor += 60; alasan = `SN unit ${c.serial} sama` }
        // Jembatan kirim: part SN ini & kode kandidat persis ada di doc kirim (SJR)
        const k = kirimMap.get(`${c.serviceRequestId}|${NORM(c.kodePart)}`)
        const kirimRef = it.serialNumber && k?.sn && NORM(k.sn) === NORM(it.serialNumber) ? k : undefined
        if (kirimRef) { skor += 25; alasan = alasan ? `${alasan} + kirim doc ${[...kirimRef.docs].join(',')}` : `cocok kirim doc ${[...kirimRef.docs].join(',')}` }
        const namaLike = Math.round((similarity(it.namaPart ?? '', c.namaPart) || similarity(it.kodePart, c.kodePart) * 0.8) * 15)
        if (namaLike > 0) { skor += namaLike; if (!alasan) alasan = `nama/kode mirip (${namaLike * 6}%)` }
        if (!terbaik || skor > terbaik.skor) terbaik = { cand: c, skor: Math.min(100, skor), alasan: alasan || 'kemiripan terbatas' }
      }
      if (terbaik && terbaik.skor >= 75) {
        const kunciKirim = `${terbaik.cand.serviceRequestId}|${NORM(terbaik.cand.kodePart)}`
        const k = kirimMap.get(kunciKirim)
        saran.push({
          terimaId: it.id,
          kodeAsli: it.kodePart,
          kodeSaran: NORM(terbaik.cand.kodePart) !== NORM(it.kodePart) ? terbaik.cand.kodePart : null,
          noTiket: terbaik.cand.noTiket,
          noSjr: k ? [...k.docs].join(', ') : null,
          saranKey: terbaik.cand.key,
          alasan: terbaik.alasan,
          yakin: terbaik.skor,
        })
      } else {
        sisaUntukAi.push({ idx: sisaUntukAi.length, item: it })
      }
    }

    // ===== AI pass — baris tersisa (maks 40), kandidat dibatasi 120 baris =====
    let model: string | null = null
    if (sisaUntukAi.length > 0 && kandidat.length > 0) {
      try {
        const rowsSet = await db.pengaturan.findMany({ select: { kunci: true, nilai: true } })
        const mapSet: Record<string, string> = {}
        for (const r of rowsSet) mapSet[r.kunci] = r.nilai
        const cfg = resolveAiConfig(mapSet)
        if (cfg.apiKey) {
          model = cfg.model
          const kirimCtx = [...kirimMap.values()]
            .slice(0, 60)
            .map((k) => `${[...k.docs].join(',')}|${k.noTiket}|${k.kode}|${k.nama ?? '-'}|qty ${k.qty}|SN ${k.sn ?? '-'}`)
            .join('\n')
          const deretTiket = kandidat.slice(0, 120)
            .map((c) => `${c.key}|${c.noTiket}|${c.serial || c.model}|${c.kodePart}|${c.namaPart}|qty ${c.qty}`)
            .join('\n')
          const deretBaris = sisaUntukAi
            .map((x) => `i=${x.idx}|kode=${x.item.kodePart}|nama=${x.item.namaPart ?? '-'}|qty=${x.item.qty}|SN=${x.item.serialNumber ?? '-'}`)
            .join('\n')
          const jawab = await chatCompletion(cfg, [
            { role: 'system', content: 'Kamu asisten pemeriksa barang datangan sparepart. Jawab HANYA JSON valid tanpa teks lain, tanpa code fence.' },
            {
              role: 'user',
              content:
                `Surat jalan REQUEST yang KITA KIRIM ke produsen (konteks, format k|SJR|tiket|kode|nama|qty|SN):\n${kirimCtx || '(tidak ada)'}\n\n` +
                `Part yang diorder & menunggu diterima (kandidat, format key|tiket|unit|kode|nama|qty):\n${deretTiket}\n\n` +
                `Baris surat jalan masuk (hasil OCR, sering salah ketik) yang belum tertaut (format i|kode|nama|qty|SN):\n${deretBaris}\n\n` +
                `Tautkan tiap baris i ke key kandidat yang PALING mungkin — pertimbangkan konteks kirim doc (SJR), kemiripan nama/kode (OCR: 0↔O, 1↔I, 5↔S), qty, dan SN. ` +
                `Bila tidak yakin, key = null. Jawab HANYA JSON: {"items":[{"i":0,"key":"p123","alasan":"singkat","yakin":85}]}`,
            },
          ])
          const hasilJawab = extractJson<{ items?: { i?: number; key?: string | null; alasan?: string; yakin?: number }[] }>(jawab)
          for (const it of hasilJawab.items ?? []) {
            if (typeof it.i !== 'number' || !sisaUntukAi[it.i] || !it.key) continue
            const cand = kandidat.find((c) => c.key === it.key)
            if (!cand) continue
            const yakin = Math.max(0, Math.min(100, Math.round(Number(it.yakin) || 0)))
            const kunciKirim = `${cand.serviceRequestId}|${NORM(cand.kodePart)}`
            const k = kirimMap.get(kunciKirim)
            saran.push({
              terimaId: sisaUntukAi[it.i].item.id,
              kodeAsli: sisaUntukAi[it.i].item.kodePart,
              kodeSaran: NORM(cand.kodePart) !== NORM(sisaUntukAi[it.i].item.kodePart) ? cand.kodePart : null,
              noTiket: cand.noTiket,
              noSjr: k ? [...k.docs].join(', ') : null,
              saranKey: cand.key,
              alasan: it.alasan || 'dicocokkan AI berdasarkan kemiripan',
              yakin,
            })
          }
        }
      } catch (error) {
        console.error('Analisa SJ AI error:', error)
        // AI gagal → saran deterministik saja (tanpa galat keras)
      }
    }

    // Baris terima yang tetap tak kapan pun terhubung — catat sebagai TERIMA_TANPA_KIRIM
    const sudahDisarankan = new Set(saran.map((s) => s.terimaId))
    for (const it of belumTaut) {
      if (sudahDisarankan.has(it.id)) continue
      pasangan.push({
        jenis: 'TERIMA_TANPA_KIRIM',
        kode: it.kodePart,
        nama: it.namaPart,
        sn: it.serialNumber,
        kirim: null,
        terima: { itemId: it.id, kodeAsli: it.kodePart, qty: it.qty },
        catatan: sumber === 'TIDAK_ADA' ? 'Tidak ada dokumen kirim (SJR) sebagai pembanding' : 'Tidak ada pasangan di dokumen kirim',
      })
    }

    const ringkasan = {
      sama: pasangan.filter((p) => p.jenis === 'SAMA').length,
      bedaQty: pasangan.filter((p) => p.jenis === 'BEDA_QTY').length,
      belumDiterima: pasangan.filter((p) => p.jenis === 'KIRIM_TANPA_TERIMA').length,
      tanpaKirim: pasangan.filter((p) => p.jenis === 'TERIMA_TANPA_KIRIM').length,
      saran: saran.length,
      saranYakin: saran.filter((s) => s.yakin >= 90).length,
    }

    await logAudit({
      aksi: 'ANALISA_SJ',
      entitas: 'surat_jalan_masuk',
      entitasId: sj.noSuratJalan,
      deskripsi: `Analisa Kirim vs Terima (${sumber}): ${pasangan.length} pasangan · ${saran.length} saran AI — tanpa perubahan data`,
      aktor: session?.nama ?? 'SYSTEM',
    })

    return NextResponse.json({
      model,
      sumber,
      refSjr: sj.refSjrNo,
      dipakaiSjr: docs.map((d) => d.noSurat),
      ringkasan,
      pasangan,
      saran,
    })
  } catch (error) {
    console.error('Analisa SJ error:', error)
    return NextResponse.json({ error: 'Gagal menjalankan analisa kirim vs terima' }, { status: 500 })
  }
}
