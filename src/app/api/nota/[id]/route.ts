import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { autoGitBackup } from '@/lib/git-backup'
import { requireActiveSession } from '@/lib/auth-server'
import { nomorBassValid } from '@/lib/nota'

const FIELD_STR = [
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
] as const
const FIELD_NUM = ['biayaService', 'biayaTransportasi', 'ppnPersen', 'total'] as const

function str(v: unknown): string | null {
  if (v == null) return null
  const s = String(v).slice(0, 60000)
  return s === '' ? null : s
}
function num(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/** Validasi wajib untuk status "selesai"/"diambil": Nama, Merk, Model, Pengaduan. */
function cekWajib(d: Prisma.NotaGetPayload<{ include: { items: true } }>): string[] {
  const kurang: string[] = []
  if (!d.nama?.trim()) kurang.push('Nama')
  if (!d.merk?.trim()) kurang.push('Merk')
  if (!d.model?.trim()) kurang.push('Model')
  if (!d.pengaduan?.trim()) kurang.push('Pengaduan')
  return kurang
}

async function muatNota(id: number) {
  return db.nota.findUnique({ where: { id }, include: { items: true } })
}

// GET /api/nota/[id]
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const sesi = await requireActiveSession(request)
    if (sesi.denied || !sesi.session) return sesi.denied ?? NextResponse.json({ error: 'Sesi aktif dibutuhkan' }, { status: 401 })
    void sesi.session
    const { id } = await params
    const nota = await muatNota(Number(id))
    if (!nota) return NextResponse.json({ error: 'Nota tidak ditemukan' }, { status: 404 })
    return NextResponse.json(nota)
  } catch (error) {
    console.error('Nota GET[id] error:', error)
    return NextResponse.json({ error: 'Gagal memuat nota' }, { status: 500 })
  }
}

// PATCH /api/nota/[id] — edit (termasuk autosave draft)
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const sesi = await requireActiveSession(request)
    if (sesi.denied || !sesi.session) return sesi.denied ?? NextResponse.json({ error: 'Sesi aktif dibutuhkan' }, { status: 401 })
    const session = sesi.session
    const { id } = await params
    const notaId = Number(id)
    const lama = await muatNota(notaId)
    if (!lama) return NextResponse.json({ error: 'Nota tidak ditemukan' }, { status: 404 })

    const body = (await request.json()) as Record<string, unknown>
    const data: Prisma.NotaUncheckedUpdateInput = {}
    for (const k of FIELD_STR) {
      if (k in body) (data as Record<string, unknown>)[k] = str(body[k])
    }
    for (const k of FIELD_NUM) {
      if (k in body) (data as Record<string, unknown>)[k] = num(body[k])
    }

    // Nomor BASS: kalau dikirim harus tetap 6 digit & unik
    if ('nomorBass' in data && data.nomorBass != null) {
      const n = String(data.nomorBass)
      if (!nomorBassValid(n)) return NextResponse.json({ error: 'Nomor BASS wajib 6 digit angka' }, { status: 400 })
      if (n !== lama.nomorBass) {
        const bentrok = await db.nota.findUnique({ where: { nomorBass: n } })
        if (bentrok && bentrok.id !== notaId) {
          return NextResponse.json({ error: `Nomor BASS ${n} sudah dipakai nota lain` }, { status: 409 })
        }
      }
    }

    const statusBaru = (data.status ?? lama.status) as string
    // Ganti seluruh items bila dikirim (pola replace, sederhana untuk autosave)
    if (Array.isArray(body.items)) {
      data.items = {
        deleteMany: { notaId },
        create: (body.items as Record<string, unknown>[])
          .slice(0, 20)
          .map((it) => ({
            kode: str(it.kode),
            nama: str(it.nama),
            harga: num(it.harga),
            qty: Math.max(Math.trunc(num(it.qty)), 0),
          })),
      }
    }

    // Validasi status selesai → wajib Nama/Merk/Model/Pengaduan
    if (statusBaru === 'selesai' || statusBaru === 'diambil') {
      const mandat: Record<string, unknown> = { ...lama, ...data }
      const kurang: string[] = []
      if (!String(mandat.nama ?? '').trim()) kurang.push('Nama')
      if (!String(mandat.merk ?? '').trim()) kurang.push('Merk')
      if (!String(mandat.model ?? '').trim()) kurang.push('Model')
      if (!String(mandat.pengaduan ?? '').trim()) kurang.push('Pengaduan')
      if (kurang.length > 0) {
        return NextResponse.json(
          { error: `Status ${statusBaru} butuh data lengkap — kosong: ${kurang.join(', ')}` },
          { status: 400 }
        )
      }
    }

    const nota = await db.nota.update({ where: { id: notaId }, data, include: { items: true } })
    await logAudit({
      aksi: 'UPDATE_NOTA',
      entitas: 'nota',
      entitasId: String(notaId),
      deskripsi: `Nota BASS ${nota.nomorBass}${lama.nomorBass !== nota.nomorBass ? ` (dari ${lama.nomorBass})` : ''} diubah — status ${lama.status} → ${nota.status}`,
      aktor: session.nama,
    })
    await autoGitBackup('UPDATE', 'nota', nota.nomorBass, session.nama)
    return NextResponse.json(nota)
  } catch (error) {
    console.error('Nota PATCH error:', error)
    return NextResponse.json({ error: 'Gagal menyimpan perubahan nota' }, { status: 500 })
  }
}

// DELETE /api/nota/[id]
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const sesi = await requireActiveSession(request)
    if (sesi.denied || !sesi.session) return sesi.denied ?? NextResponse.json({ error: 'Sesi aktif dibutuhkan' }, { status: 401 })
    const session = sesi.session
    const { id } = await params
    const notaId = Number(id)
    const lama = await muatNota(notaId)
    if (!lama) return NextResponse.json({ error: 'Nota tidak ditemukan' }, { status: 404 })
    await db.nota.delete({ where: { id: notaId } })
    await logAudit({
      aksi: 'DELETE_NOTA',
      entitas: 'nota',
      entitasId: String(notaId),
      deskripsi: `Nota BASS ${lama.nomorBass} (${lama.nama}) dihapus`,
      aktor: session.nama,
    })
    await autoGitBackup('DELETE', 'nota', lama.nomorBass, session.nama)
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Nota DELETE error:', error)
    return NextResponse.json({ error: 'Gagal menghapus nota' }, { status: 500 })
  }
}
