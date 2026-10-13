import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

// Kata yang diabaikan saat mencocokkan jenis kerusakan
const STOPWORDS = new Set([
  'yang', 'dan', 'di', 'ke', 'dari', 'tidak', 'tak', 'ada', 'dengan', 'untuk',
  'pada', 'adalah', 'ini', 'itu', 'atau', 'juga', 'sudah', 'telah', 'akan',
  'bisa', 'dapat', 'karena', 'saat', 'ketika', 'oleh', 'sebagai', 'agar',
  'supaya', 'nya', 'lah', 'kah', 'pun', 'saja', 'sangat', 'kurang', 'lebih',
])

function tokenize(s: string): string[] {
  return (
    s
      .toLowerCase()
      .split(/[^a-z0-9]+/i)
      .filter((t) => t.length >= 2 && !STOPWORDS.has(t))
  )
}

/**
 * GET /api/sparepart/cari?model=&rusak=
 * Pelacakan sparepart dari KUMPULAN DATA RIWAYAT di database:
 * cocokkan model unit + kata kunci jenis kerusakan terhadap tiket-tiket
 * lama, lalu ranking kode+nama part yang pernah dipakai.
 */
export async function GET(request: Request) {
  try {
    const q = new URL(request.url).searchParams
    const modelQ = (q.get('model') ?? '').trim().toLowerCase()
    const tokens = tokenize(q.get('rusak') ?? '')
    if (!modelQ && tokens.length === 0) {
      return NextResponse.json(
        { error: 'Masukkan model unit dan/atau jenis kerusakan untuk melacak' },
        { status: 400 }
      )
    }

    const tickets = await db.serviceRequest.findMany({
      include: {
        unitAsset: { select: { modelUnit: true, merk: true } },
        parts: { include: { sparepart: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 2000,
    })

    interface Agg {
      sparepartId: number
      kodePart: string
      namaPart: string
      brandKompatibel: string
      supplier: string
      stokJual: number
      stokGaransi: number
      stokInventory: number
      skor: number
      frekuensi: number
      contoh: { noTiket: string; model: string; deskripsi: string }[]
    }
    const agg = new Map<number, Agg>()

    for (const t of tickets) {
      const model = (t.unitAsset?.modelUnit ?? '').toLowerCase()
      const deskripsi = (t.deskripsiKerusakan ?? '').toLowerCase()
      let skor = 0
      if (modelQ && model.includes(modelQ)) skor += 20
      for (const tok of tokens) {
        if (deskripsi.includes(tok)) skor += 5
        else if (model.includes(tok)) skor += 2
      }
      if (skor === 0) continue
      for (const p of t.parts) {
        if (!p.sparepart) continue
        const cur = agg.get(p.sparepartId) ?? {
          sparepartId: p.sparepartId,
          kodePart: p.sparepart.kodePart,
          namaPart: p.sparepart.namaPart,
          brandKompatibel: p.sparepart.brandKompatibel ?? '',
          supplier: p.sparepart.supplier ?? '',
          stokJual: p.sparepart.stokJual ?? 0,
          stokGaransi: p.sparepart.stokGaransi ?? 0,
          stokInventory: p.sparepart.stokInventory ?? 0,
          skor: 0,
          frekuensi: 0,
          contoh: [],
        }
        cur.skor = Math.max(cur.skor, skor)
        cur.frekuensi += p.qty
        if (cur.contoh.length < 3) {
          cur.contoh.push({
            noTiket: t.noTiket,
            model: t.unitAsset?.modelUnit ?? '-',
            deskripsi: (t.deskripsiKerusakan ?? '-').slice(0, 80),
          })
        }
        agg.set(p.sparepartId, cur)
      }
    }

    const hasil = [...agg.values()]
      .sort((a, b) => b.skor - a.skor || b.frekuensi - a.frekuensi)
      .slice(0, 20)

    return NextResponse.json({
      query: { model: q.get('model') ?? '', rusak: q.get('rusak') ?? '' },
      totalTiketDipindai: tickets.length,
      totalCocok: hasil.length,
      hasil,
    })
  } catch (error) {
    console.error('Sparepart cari error:', error)
    return NextResponse.json({ error: 'Gagal melacak sparepart' }, { status: 500 })
  }
}
