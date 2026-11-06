import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireActiveSession } from '@/lib/auth-server'

/**
 * Shared selection (checkbox tersimpan di server, dilihat semua user).
 * Jenis:
 *  - SELECTED_IDS  → service-view (tiket terpilih untuk SJ/STTB)
 *  - UNIT_DIPLIH   → master-data-view (unit terpilih untuk hapus/kolektif)
 *  - TOKO_DIPLIH   → master-data-view (toko terpilih untuk hapus/kolektif)
 *  - PASANG_SEL    → service-view (part pemasangan terpilih)
 *
 * GET  /api/user-selection?type=SELECTED_IDS   → { itemIds: number[] }
 * POST /api/user-selection                      → body: { type, itemIds: number[] }
 */

export async function GET(request: Request) {
  try {
    const { denied } = await requireActiveSession(request)
    if (denied) return denied

    const { searchParams } = new URL(request.url)
    const type = searchParams.get('type')
    if (!type) {
      return NextResponse.json({ error: 'Parameter type wajib diisi' }, { status: 400 })
    }

    const sel = await db.sharedSelection.findUnique({ where: { type } })
    const itemIds = sel ? (JSON.parse(sel.itemIds) as number[]) : []
    return NextResponse.json({ type, itemIds })
  } catch (error) {
    console.error('Shared selection GET error:', error)
    return NextResponse.json({ error: 'Gagal memuat pilihan centang' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const { session, denied } = await requireActiveSession(request)
    if (denied) return denied
    const aktor = session?.nama ?? 'SYSTEM'

    const body = await request.json()
    const { type, itemIds } = body
    if (!type || !Array.isArray(itemIds)) {
      return NextResponse.json({ error: 'Body harus memiliki type dan itemIds (array)' }, { status: 400 })
    }

    // Normalisasi: urutkan & hilangkan duplikat
    const normalized = [...new Set(itemIds.filter((id) => typeof id === 'number'))].sort((a, b) => a - b)

    const sel = await db.sharedSelection.upsert({
      where: { type },
      update: { itemIds: JSON.stringify(normalized) },
      create: { type, itemIds: JSON.stringify(normalized) },
    })

    await db.auditLog.create({
      data: {
        aksi: 'SHARED_SELECTION_SIMPAN',
        entitas: 'shared_selection',
        entitasId: type,
        deskripsi: `Simpan pilihan centang ${type}: ${normalized.length} item`,
        aktor,
      },
    })

    return NextResponse.json({ ok: true, type, itemIds: normalized })
  } catch (error) {
    console.error('Shared selection POST error:', error)
    return NextResponse.json({ error: 'Gagal menyimpan pilihan centang' }, { status: 500 })
  }
}
