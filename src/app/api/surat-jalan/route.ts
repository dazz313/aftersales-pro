import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { autoGitBackup } from '@/lib/git-backup'
import { requireActiveSession } from '@/lib/auth-server'
import { ambilKandidat, cocokkan, terapkanCocok, type BarisSuratJalan, type HasilBaris } from '@/lib/surat-jalan'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// GET /api/surat-jalan — riwayat surat jalan masuk terakhir (8) + item-nya
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

// POST /api/surat-jalan — TERAPKAN surat jalan (commit) + efek otomatis:
// part tiket → READY · item email SV-EM → DATANG · no/tgl surat jalan tercatat
// · tiket yang part-nya lengkap otomatis naik ke PROSES. Per row client dapat
// memilih key kandidat (pilihKey) utk baris yang di-preview tadi ambigu.
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
    const rows = Array.isArray(body.rows) ? body.rows.filter((r) => r && typeof r.kodePart === 'string' && r.kodePart.trim()) : []
    if (!rows.length) return NextResponse.json({ error: 'Tidak ada baris part untuk diproses' }, { status: 400 })
    if (rows.length > 200) return NextResponse.json({ error: 'Maksimal 200 baris per surat jalan' }, { status: 400 })
    const aktor = body.aktor || 'SYSTEM'
    const tglSurat = body.tglSurat ? new Date(body.tglSurat) : null
    const meta = {
      noSuratJalan,
      tglSurat: tglSurat && !Number.isNaN(tglSurat.getTime()) ? tglSurat : null,
      produsen: (body.produsen ?? '').trim() || null,
      namaFile: (body.namaFile ?? '').slice(0, 200) || undefined,
      aktor,
    }

    // Cocokkan ulang sisi server (kebal keutamaan data); pilihKey client dihormati.
    const kandidat = await ambilKandidat()
    const kandidatByKey = new Map(kandidat.map((c) => [c.key, c]))
    let hasil: HasilBaris[] = cocokkan(
      rows.map((r) => ({ kodePart: r.kodePart, namaPart: r.namaPart, qty: r.qty, serialNumber: r.serialNumber })),
      kandidat
    )
    hasil = hasil.map((h, i) => {
      const pilih = rows[i]?.pilihKey
      if (pilih) {
        const cand = kandidatByKey.get(pilih)
        if (cand && NORM(cand.kodePart) === NORM(h.kodePart)) {
          return { ...h, statusMatch: 'COCOK' as const, cocokKandidat: cand, keterangan: `Dipilih manual oleh ${aktor} — tiket ${cand.noTiket}` }
        }
      }
      return h
    })

    const terapis = await terapkanCocok(hasil, meta)
    await logAudit({
      aksi: 'SURAT_JALAN_MASUK',
      entitas: 'surat_jalan_masuk',
      entitasId: noSuratJalan,
      deskripsi: `Surat jalan produsen diterapkan: ${terapis.cocokCount} item cocok · ${terapis.tanpaTiket} tanpa tiket · ${terapis.naikProses} tiket naik PROSES· file: ${meta.namaFile ?? 'manual'}`,
      aktor,
    })
    await autoGitBackup('CREATE', 'surat_jalan_masuk', noSuratJalan, aktor)

    return NextResponse.json({
      ok: true,
      noSuratJalan,
      totalItem: terapis.totalItem,
      cocokCount: terapis.cocokCount,
      tanpaTiket: terapis.tanpaTiket,
      naikProses: terapis.naikProses,
    })
  } catch (error) {
    console.error('Surat jalan POST error:', error)
    return NextResponse.json({ error: 'Gagal menerapkan surat jalan' }, { status: 500 })
  }
}

const NORM = (s: string) => (s || '').toUpperCase().replace(/[^A-Z0-9#]/g, '')
