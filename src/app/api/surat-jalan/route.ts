import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { autoGitBackup } from '@/lib/git-backup'
import { requireActiveSession } from '@/lib/auth-server'
import { ambilKandidat, cocokkan, type BarisSuratJalan, type Kandidat } from '@/lib/surat-jalan'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// GET /api/surat-jalan — riwayat surat jalan masuk (8 terakhir, termasuk DRAFT)
export async function GET() {
  try {
    const list = await db.suratJalanMasuk.findMany({
      orderBy: { createdAt: 'desc' },
      take: 8,
      include: { items: { orderBy: { id: 'asc' } } },
    })
    const tiketIds = [...new Set(list.flatMap((s) => s.items.map((i) => i.cocokTiketId)).filter((x): x is number => x != null))]
    const tiketMap = new Map<number, { noTiket: string; unit: string }>()
    if (tiketIds.length) {
      const ts = await db.serviceRequest.findMany({
        where: { id: { in: tiketIds } },
        select: { id: true, noTiket: true, unitAsset: { select: { serialNumber: true, modelUnit: true } } },
      })
      for (const t of ts) {
        tiketMap.set(t.id, { noTiket: t.noTiket, unit: `${t.unitAsset.modelUnit ?? '-'} · ${t.unitAsset.serialNumber || '-'}` })
      }
    }
    return NextResponse.json(
      list.map((s) => ({
        id: s.id,
        noSuratJalan: s.noSuratJalan,
        tglSurat: s.tglSurat,
        produsen: s.produsen,
        namaFile: s.namaFile,
        totalItem: s.totalItem,
        cocokCount: s.cocokCount,
        tanpaTiket: s.tanpaTiket,
        status: s.status,
        cekManual: s.cekManual,
        diperiksaAt: s.diperiksaAt,
        diperiksaOleh: s.diperiksaOleh,
        diterapkanAt: s.diterapkanAt,
        diterapkanOleh: s.diterapkanOleh,
        createdAt: s.createdAt,
        createdBy: s.createdBy,
        items: s.items.map((i) => ({
          id: i.id,
          kodePart: i.kodePart,
          namaPart: i.namaPart,
          qty: i.qty,
          serialNumber: i.serialNumber,
          statusMatch: i.statusMatch,
          tiket: i.cocokTiketId != null ? (tiketMap.get(i.cocokTiketId)?.noTiket ?? null) : null,
          unit: i.cocokTiketId != null ? (tiketMap.get(i.cocokTiketId)?.unit ?? null) : null,
          alasan: i.alasan,
        })),
      }))
    )
  } catch (error) {
    console.error('Surat jalan GET error:', error)
    return NextResponse.json({ error: 'Gagal memuat riwayat surat jalan masuk' }, { status: 500 })
  }
}

// POST /api/surat-jalan — SIMPAN DRAFT (belum ada efek apa pun ke tiket/unit).
// items: hasil parse Excel dari /match; pilihKey per baris = pilihan user
// (baris ambigu). Status awal DRAFT → lalu /periksa → /terapkan.
export async function POST(request: Request) {
  try {
    const { denied } = await requireActiveSession(request)
    if (denied) return denied
    const body = (await request.json()) as {
      noSuratJalan?: string
      tglSurat?: string | null
      produsen?: string | null
      namaFile?: string
      aktor?: string
      rows?: (BarisSuratJalan & { pilihKey?: string })[]
    }
    const noSuratJalan = (body.noSuratJalan ?? '').trim()
    if (!noSuratJalan) return NextResponse.json({ error: 'Nomor surat jalan wajib diisi' }, { status: 400 })
    const kembar = await db.suratJalanMasuk.findFirst({ where: { noSuratJalan, status: 'DITERAPKAN' }, select: { id: true } })
    if (kembar) return NextResponse.json({ error: `Nomor surat jalan sudah dipakai (diterapkan)` }, { status: 409 })
    const rows = Array.isArray(body.rows) ? body.rows.filter((r) => r && typeof r.kodePart === 'string' && r.kodePart.trim()) : []
    if (!rows.length) return NextResponse.json({ error: 'Tidak ada baris part untuk diproses' }, { status: 400 })
    if (rows.length > 200) return NextResponse.json({ error: 'Maksimal 200 baris per surat jalan' }, { status: 400 })
    const aktor = body.aktor || 'SYSTEM'
    const tglSurat = body.tglSurat ? new Date(body.tglSurat) : null

    // Cocokkan sisi server (kebal klien); pilihKey preview dihormati bila valid.
    const kandidat = await ambilKandidat()
    const kandidatByKey = new Map<string, Kandidat>(kandidat.map((c) => [c.key, c]))
    let hasil = cocokkan(
      rows.map((r) => ({ kodePart: r.kodePart, namaPart: r.namaPart, qty: r.qty, serialNumber: r.serialNumber })),
      kandidat
    )
    hasil = hasil.map((h, i) => {
      const pilih = rows[i]?.pilihKey
      if (pilih) {
        const cand = kandidatByKey.get(pilih)
        if (cand && NORM(cand.kodePart) === NORM(h.kodePart)) {
          return { ...h, statusMatch: 'COCOK' as const, cocokKandidat: cand, keterangan: `Dipilih manual — tiket ${cand.noTiket}` }
        }
      }
      return h
    })

    const cocok = hasil.filter((h) => h.statusMatch === 'COCOK').length
    const sj = await db.suratJalanMasuk.create({
      data: {
        noSuratJalan,
        tglSurat: tglSurat && !Number.isNaN(tglSurat.getTime()) ? tglSurat : null,
        produsen: (body.produsen ?? '').trim() || null,
        namaFile: (body.namaFile ?? '').slice(0, 200) || undefined,
        totalItem: hasil.length,
        cocokCount: cocok,
        tanpaTiket: hasil.length - cocok,
        status: 'DRAFT',
        createdBy: aktor,
        items: {
          create: hasil.map((h) => ({
            kodePart: h.kodePart,
            namaPart: h.namaPart ?? null,
            qty: h.qty,
            serialNumber: h.serialNumber ?? null,
            statusMatch: h.statusMatch,
            cocokTipe: h.cocokKandidat?.emailPartId ? 'TIKET_EMAIL' : h.cocokKandidat ? 'TIKET_PART' : h.serialNumber ? 'UNIT_TANPA_PART' : null,
            cocokTiketId: h.cocokKandidat?.serviceRequestId ?? null,
            cocokUnitId: h.cocokKandidat?.unitId ?? null,
            cocokPartId: h.cocokKandidat?.partId ?? null,
            alasan: h.keterangan,
          })),
        },
      },
    })
    await logAudit({ aksi: 'SURAT_JALAN_DRAFT', entitas: 'surat_jalan_masuk', entitasId: noSuratJalan, deskripsi: `Draft surat jalan masuk disimpan: ${hasil.length} baris · ${cocok} cocok (belum diterapkan)`, aktor })
    await autoGitBackup('CREATE', 'surat_jalan_masuk_draft', noSuratJalan, aktor)
    return NextResponse.json({ ok: true, id: sj.id, status: 'DRAFT', totalItem: hasil.length, cocokCount: cocok, tanpaTiket: hasil.length - cocok })
  } catch (error) {
    console.error('Surat jalan DRAFT error:', error)
    return NextResponse.json({ error: 'Gagal menyimpan draft surat jalan' }, { status: 500 })
  }
}

const NORM = (s: string) => (s || '').toUpperCase().replace(/[^A-Z0-9#]/g, '')
