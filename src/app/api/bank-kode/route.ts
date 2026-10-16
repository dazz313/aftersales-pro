import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { requireActiveSession } from '@/lib/auth-server'
import { normalisasiKode } from '@/lib/bank-kode'

// GET /api/bank-kode?q=&sumber=&take= — cari kode produsen (siap dipanggil kapan pun)
// q dicocokkan ke kode / nama / brand / model / produsen (case-insensitive ganda).
export async function GET(request: Request) {
  try {
    const { denied } = await requireActiveSession(request)
    if (denied) return denied
    const q = new URL(request.url).searchParams
    const keyword = q.get('q')?.trim() ?? ''
    const sumber = q.get('sumber')?.trim().toUpperCase() ?? ''
    const take = Math.min(200, Math.max(1, Number(q.get('take')) || 50))

    const where: Record<string, unknown> = {}
    if (sumber) where.sumber = sumber
    if (keyword) {
      const variants = [...new Set([keyword, keyword.toUpperCase(), keyword.toLowerCase()])]
      const or: Record<string, unknown>[] = []
      for (const v of variants) {
        or.push({ kode: { contains: v } }, { namaPart: { contains: v } }, { brandKompatibel: { contains: v } }, { modelTipe: { contains: v } }, { produsen: { contains: v } })
      }
      where.OR = or
    }

    const [items, totalBank] = await Promise.all([
      db.bankKode.findMany({ where, orderBy: { kode: 'asc' }, take }),
      db.bankKode.count(),
    ])
    return NextResponse.json({ total: items.length, totalBank, items })
  } catch (error) {
    console.error('BankKode GET error:', error)
    return NextResponse.json({ error: 'Gagal memuat bank kode' }, { status: 500 })
  }
}

// POST /api/bank-kode — tambah satu kode manual (mis. kode baru dari chat produsen)
export async function POST(request: Request) {
  try {
    const { denied } = await requireActiveSession(request)
    if (denied) return denied
    const body = await request.json()
    const kode = normalisasiKode(body.kode)
    if (!kode) {
      return NextResponse.json({ error: 'Kode wajib diisi' }, { status: 400 })
    }
    const exists = await db.bankKode.findUnique({ where: { kode } })
    if (exists) {
      return NextResponse.json({ error: `Kode ${kode} sudah terdaftar di Bank Kode` }, { status: 409 })
    }
    const row = await db.bankKode.create({
      data: {
        kode,
        namaPart: String(body.namaPart ?? '').trim(),
        brandKompatibel: String(body.brandKompatibel ?? '').trim(),
        produsen: String(body.produsen ?? '').trim(),
        sumber: 'MANUAL',
        catatan: String(body.catatan ?? '').trim() || null,
      },
    })
    await logAudit({
      aksi: 'BANK_KODE_TAMBAH',
      entitas: 'bank_kode',
      entitasId: row.kode,
      deskripsi: `Kode produsen baru dicatat manual: ${row.kode}${row.namaPart ? ` — ${row.namaPart}` : ''}${row.produsen ? ` (${row.produsen})` : ''}`,
      aktor: body.aktor,
    })
    return NextResponse.json(row, { status: 201 })
  } catch (error) {
    console.error('BankKode POST error:', error)
    return NextResponse.json({ error: 'Gagal menambah kode' }, { status: 500 })
  }
}
