import { NextResponse } from 'next/server'
import { requireActiveSession } from '@/lib/auth-server'
import { cariKodeDariNama } from '@/lib/bank-kode'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// GET /api/bank-kode/cari-nama?nama=impeller%20pompa — kandidat kode dari
// riwayat input part (Bank Kode) berdasarkan nama part. Dipakai pengisian
// kode otomatis di form tambah part service: pemilik menulis nama, sistem
// mencari kode yang pernah terdaftar untuk nama itu. Read-only.
export async function GET(request: Request) {
  const { denied } = await requireActiveSession(request)
  if (denied) return denied
  try {
    const nama = new URL(request.url).searchParams.get('nama') ?? ''
    const items = await cariKodeDariNama(nama)
    return NextResponse.json({ items })
  } catch (error) {
    console.error('BankKode cari-nama error:', error)
    return NextResponse.json({ error: 'Gagal mencari kode dari nama part' }, { status: 500 })
  }
}
