import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireActiveSession } from '@/lib/auth-server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * GET /api/sparepart/datang?q=&take=
 *
 * Pencarian kiriman part yang datang dari produsen (Surat Jalan Masuk):
 * satu kotak bebas mencari di seluruh isu yang dipakai workshop harian —
 * tgl datang, tgl surat, no. surat jalan, kode, nama part, no tiket,
 * toko, serial/model, kerusakan, status tiket & status part.
 * - tgl datang = tglPartDatang tiket (diisi saat surat jalan diterapkan);
 *   baris belum diterapkan tetap tampil dengan tgl kosong (status suratnya
 *   ikut ditampilkan: DRAFT / DIPERIKSA) supaya tidak ada kiriman yang lolos.
 */

const NORM = (s: string | null | undefined): string => (s ?? '').trim().toUpperCase()
const tglCari = (d: Date | null | undefined): string =>
  d ? new Date(d).toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit', year: '2-digit' }) : ''

export async function GET(request: Request) {
  try {
    const { denied } = await requireActiveSession(request)
    if (denied) return denied

    const url = new URL(request.url)
    const q = (url.searchParams.get('q') ?? '').trim()
    const takeParam = Number(url.searchParams.get('take') ?? '200')
    const take = Math.min(Math.max(Number.isFinite(takeParam) ? takeParam : 200, 1), 500)

    // Ambil 60 surat jalan terakhir — cukup menjangkau berbulan-bulan
    // kiriman untuk workshop satu cabang tanpa membongkar seluruh tabel.
    const sjs = await db.suratJalanMasuk.findMany({
      orderBy: { createdAt: 'desc' },
      take: 60,
      include: { items: { orderBy: { id: 'asc' } } },
    })

    const tiketIds = [
      ...new Set(sjs.flatMap((s) => s.items.map((i) => i.cocokTiketId)).filter((x): x is number => x != null)),
    ]
    const tiketMap = new Map<
      number,
      {
        noTiket: string
        status: string
        deskripsiKerusakan: string | null
        tglPartDatang: Date | null
        serial: string
        model: string
        toko: string
        statusPartReady: boolean
      }
    >()
    if (tiketIds.length) {
      const tiket = await db.serviceRequest.findMany({
        where: { id: { in: tiketIds } },
        include: {
          unitAsset: { select: { serialNumber: true, modelUnit: true, toko: { select: { namaToko: true } } } },
          parts: { select: { statusPart: true } },
        },
      })
      for (const t of tiket) {
        tiketMap.set(t.id, {
          noTiket: t.noTiket,
          status: t.status,
          deskripsiKerusakan: t.deskripsiKerusakan,
          tglPartDatang: t.tglPartDatang,
          serial: t.unitAsset.serialNumber || '',
          model: t.unitAsset.modelUnit || '',
          toko: t.unitAsset.toko?.namaToko ?? '',
          statusPartReady: t.parts.some((p) => p.statusPart === 'READY'),
        })
      }
    }

    interface Baris {
      id: number
      noSuratJalan: string
      sjStatus: string
      tglSurat: Date | null
      tglDatang: Date | null
      kodePart: string
      namaPart: string
      qty: number
      serialNumber: string | null
      noTiket: string | null
      toko: string
      serial: string
      model: string
      kerusakan: string
      status: string
      statusPart: string // READY | ORDER | '-'
    }

    const rows: Baris[] = sjs.flatMap((s) =>
      s.items.map((i) => {
        const t = i.cocokTiketId != null ? tiketMap.get(i.cocokTiketId) : undefined
        return {
          id: i.id,
          noSuratJalan: s.noSuratJalan,
          sjStatus: s.status,
          tglSurat: s.tglSurat ?? s.createdAt,
          // tgl datang = saat surat jalan diterapkan ke tiket (part resmi masuk pemakaian)
          tglDatang: t?.tglPartDatang ?? (s.status === 'DITERAPKAN' ? (s.diterapkanAt ?? s.createdAt) : null),
          kodePart: i.kodePart,
          namaPart: i.namaPart ?? '',
          qty: i.qty,
          serialNumber: i.serialNumber,
          noTiket: t?.noTiket ?? null,
          toko: t?.toko ?? '',
          serial: t?.serial || i.serialNumber || '',
          model: t?.model ?? '',
          kerusakan: t?.deskripsiKerusakan ?? '',
          status: t?.status ?? '',
          statusPart: t ? (t.statusPartReady ? 'READY' : 'ORDER') : '-',
        }
      })
    )

    // Urut: tgl datang terbaru dulu; yang belum datang (tgl kosong) menyusul.
    const waktunya = (r: Baris): number => (r.tglDatang ? new Date(r.tglDatang).getTime() : 0)
    rows.sort((a, b) => waktunya(b) - waktunya(a) || new Date(b.tglSurat ?? 0).getTime() - new Date(a.tglSurat ?? 0).getTime())

    // Multi-kata kunci: semua token harus nempel di satu baris (AND).
    const tokens = q.split(/\s+/).filter(Boolean).map(NORM)
    const hasil = (tokens.length
      ? rows.filter((r) => {
          const hay = NORM(
            [
              r.kodePart,
              r.namaPart,
              r.noTiket,
              r.toko,
              r.serial,
              r.model,
              r.kerusakan,
              r.status,
              r.statusPart,
              r.noSuratJalan,
              r.sjStatus,
              tglCari(r.tglDatang),
              tglCari(r.tglSurat),
            ].join(' ')
          )
          return tokens.every((t) => hay.includes(t))
        })
      : rows
    ).slice(0, take)

    return NextResponse.json(
      hasil.map((r) => ({
        ...r,
        tglDatang: r.tglDatang,
        tglSurat: r.tglSurat,
      }))
    )
  } catch (error) {
    console.error('Sparepart datang GET error:', error)
    return NextResponse.json({ error: 'Gagal memuat daftar part datang' }, { status: 500 })
  }
}
