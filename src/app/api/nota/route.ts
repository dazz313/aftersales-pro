import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { autoGitBackup } from '@/lib/git-backup'
import { requireActiveSession } from '@/lib/auth-server'
import { nomorBassValid } from '@/lib/nota'

// Kolom nota yang boleh diisi dari body — sanitasi eksplisit (security).
const FIELD_STR: (keyof Prisma.NotaUncheckedCreateInput)[] = [
  'nomorBass',
  'lokasi',
  'tanggal',
  'jamMasuk',
  'nama',
  'alamat',
  'telp',
  'hp',
  'merk',
  'lp',
  'model',
  'noSeri',
  'tglBeli',
  'garansi',
  'tglSelesai',
  'jamSelesai',
  'pengaduan',
  'kelengkapan',
  'penyebab',
  'perbaikan',
  'tglAmbil',
  'ttdCustomer1',
  'ttdTeknisi',
  'ttdCustomer2',
  'namaCustomer1',
  'namaTeknisi',
  'namaCustomer2',
  'status',
]
const FIELD_NUM: (keyof Prisma.NotaUncheckedCreateInput)[] = [
  'biayaService',
  'biayaTransportasi',
  'ppnPersen',
  'total',
]

/** Apitkan teks bebas → string | null (lebih dari 60 ribu char dipotong demi memori). */
function str(v: unknown): string | null {
  if (v == null) return null
  const s = String(v).slice(0, 60000)
  return s === '' ? null : s
}
function num(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/**
 * GET /api/nota — daftar nota + pencarian & filter.
 * ?q= (nomor bass / nama / merk / model / no seri) &status= &dari= &sampai= &take=
 */
export async function GET(request: Request) {
  try {
    const sesi = await requireActiveSession(request)
    if (sesi.denied || !sesi.session) return sesi.denied ?? NextResponse.json({ error: 'Sesi aktif dibutuhkan' }, { status: 401 })
    void sesi.session
    const { searchParams } = new URL(request.url)
    const q = (searchParams.get('q') ?? '').trim()
    const status = (searchParams.get('status') ?? '').trim()
    const dari = (searchParams.get('dari') ?? '').trim() // YYYY-MM-DD
    const sampai = (searchParams.get('sampai') ?? '').trim()
    const take = Math.min(Math.max(Number(searchParams.get('take')) || 300, 1), 1000)

    const where: Prisma.NotaWhereInput = {}
    if (q) {
      where.OR = [
        { nomorBass: { contains: q } },
        { nama: { contains: q } },
        { merk: { contains: q } },
        { model: { contains: q } },
        { noSeri: { contains: q } },
      ]
    }
    if (status && status !== 'SEMUA') where.status = status
    if (dari || sampai) where.tanggal = { ...(dari ? { gte: dari } : {}), ...(sampai ? { lte: sampai } : {}) }

    const notas = await db.nota.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take,
      include: { items: true },
    })
    return NextResponse.json(notas)
  } catch (error) {
    console.error('Nota GET error:', error)
    return NextResponse.json({ error: 'Gagal memuat daftar nota' }, { status: 500 })
  }
}

/**
 * POST /api/nota — buat nota baru (dari form / tombol "Buat Baru"/duplikat manual).
 * Body: seluruh field nota + items[] { kode, nama, harga, qty }.
 */
export async function POST(request: Request) {
  try {
    const sesi = await requireActiveSession(request)
    if (sesi.denied || !sesi.session) return sesi.denied ?? NextResponse.json({ error: 'Sesi aktif dibutuhkan' }, { status: 401 })
    const session = sesi.session
    const body = (await request.json()) as Record<string, unknown>

    const nomorBass = str(body.nomorBass) ?? ''
    if (!nomorBassValid(nomorBass)) {
      return NextResponse.json({ error: 'Nomor BASS wajib 6 digit angka' }, { status: 400 })
    }
    const bentrok = await db.nota.findUnique({ where: { nomorBass } })
    if (bentrok) {
      return NextResponse.json({ error: `Nomor BASS ${nomorBass} sudah dipakai nota lain` }, { status: 409 })
    }

    const items = Array.isArray(body.items) ? (body.items as Record<string, unknown>[]) : []
    const data: Prisma.NotaUncheckedCreateInput = {
      nomorBass,
      nama: str(body.nama) ?? '',
      status: str(body.status) === 'selesai' || str(body.status) === 'diambil' ? String(body.status) : 'draft',
    }
    for (const k of FIELD_STR) {
      if (k !== 'nomorBass' && k !== 'nama' && k !== 'status') (data as Record<string, unknown>)[k] = str(body[k])
    }
    for (const k of FIELD_NUM) (data as Record<string, unknown>)[k] = num(body[k])
    if (items.length > 0) {
      data.items = {
        create: items.slice(0, 20).map((it) => ({
          kode: str(it.kode),
          nama: str(it.nama),
          harga: num(it.harga),
          qty: Math.max(Math.trunc(num(it.qty)), 0) || 0,
        })),
      }
    }

    const nota = await db.nota.create({ data, include: { items: true } })
    await logAudit({
      aksi: 'CREATE_NOTA',
      entitas: 'nota',
      entitasId: String(nota.id),
      deskripsi: `Nota BASS ${nota.nomorBass} dibuat${body.dariTiket ? ` (dibuat dari tiket ${String(body.dariTiket)})` : ''} — ${nota.nama}`,
      aktor: session.nama,
    })
    await autoGitBackup('CREATE', 'nota', nota.nomorBass, session.nama)
    return NextResponse.json(nota, { status: 201 })
  } catch (error) {
    console.error('Nota POST error:', error)
    return NextResponse.json({ error: 'Gagal menyimpan nota' }, { status: 500 })
  }
}
