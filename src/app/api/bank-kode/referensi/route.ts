import { NextResponse } from 'next/server'
import { requireActiveSession } from '@/lib/auth-server'
import { cariReferensiPart } from '@/lib/bank-kode'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// GET /api/bank-kode/referensi?kode=&nama= — cek kesamaan saat pengguna
// mengetik kode ATAU nama part yang sudah lengkap. Dipakai form input part
// (balasan produsen, tambah part manual, inventory) untuk menampilkan
// referensi kode/nama yang pernah ada + stok & jumlah pemakaian.
// Read-only; tidak menulis apa pun ke database.
export async function GET(request: Request) {
  const { denied } = await requireActiveSession(request)
  if (denied) return denied
  try {
    const q = new URL(request.url).searchParams
    const kode = q.get('kode')?.trim() ?? ''
    const nama = q.get('nama')?.trim() ?? ''
    const take = Math.min(10, Math.max(1, Number(q.get('take')) || 6))
    const items = await cariReferensiPart({ kode, nama }, take)
    return NextResponse.json({ total: items.length, items })
  } catch (error) {
    console.error('BankKode referensi error:', error)
    return NextResponse.json({ error: 'Gagal mencari referensi part' }, { status: 500 })
  }
}
