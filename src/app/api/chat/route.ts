import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireActiveSession } from '@/lib/auth-server'

// GET /api/chat — data MiniChat untuk sesi aktif:
//  - users : semua akun aktif (penerima/pengirim tujuan DM & broadcast)
//  - pesan : pesan yang TERLIHAT oleh saya (terbaru dulu, maks 500):
//      • pasanganku: (pengirim=saya & (penerima=dua arah DM)) atau (penerima=saya)
//      • broadcast : penerima null (papan umum, semua akun)
// Respons ringan; widget & view Komunikasi memilah thread di sisi klien.
export async function GET(request: Request) {
  try {
    const { session, denied } = await requireActiveSession(request)
    if (denied) return denied
    const meId = Number(session!.sub)

    const [users, pesan] = await Promise.all([
      db.pengguna.findMany({
        where: { aktif: true },
        select: { id: true, nama: true, email: true, username: true, role: true },
        orderBy: { nama: 'asc' },
      }),
      db.chatPesan.findMany({
        where: {
          OR: [
            { pengirimId: meId },
            { penerimaId: meId },
            { penerimaId: null },
          ],
        },
        orderBy: { id: 'desc' },
        take: 500,
      }),
    ])
    return NextResponse.json({ users, pesan, meId })
  } catch (error) {
    console.error('Chat GET error:', error)
    return NextResponse.json({ error: 'Gagal memuat chat' }, { status: 500 })
  }
}

// POST /api/chat — kirim pesan MiniChat (DM antar akun atau broadcast).
// Body: { penerimaId?: number|null, isi: string }
//  - penerimaId null → broadcast ke papan umum semua akun.
//  - DM ke diri sendiri ditolak — tidak ada gunanya & membingungkan pager.
export async function POST(request: Request) {
  try {
    const { session, denied } = await requireActiveSession(request)
    if (denied) return denied
    const meId = Number(session!.sub)

    const body = (await request.json().catch(() => null)) as { penerimaId?: number | null; isi?: string } | null
    const isi = (body?.isi ?? '').trim()
    if (!isi) return NextResponse.json({ error: 'Pesan tidak boleh kosong' }, { status: 400 })
    if (isi.length > 2000) return NextResponse.json({ error: 'Pesan terlalu panjang (maks 2000 karakter)' }, { status: 400 })

    let penerimaId: number | null = null
    if (body?.penerimaId != null && Number.isFinite(Number(body.penerimaId))) {
      penerimaId = Number(body.penerimaId)
      if (penerimaId === meId) {
        return NextResponse.json({ error: 'Tidak bisa DM diri sendiri' }, { status: 400 })
      }
      const penerima = await db.pengguna.findUnique({ where: { id: penerimaId }, select: { aktif: true } })
      if (!penerima?.aktif) return NextResponse.json({ error: 'Akun tujuan tidak ditemukan/nonaktif' }, { status: 404 })
    }

    const pesan = await db.chatPesan.create({
      data: { pengirimId: meId, penerimaId, isi },
    })
    return NextResponse.json({ ok: true, pesan }, { status: 201 })
  } catch (error) {
    console.error('Chat POST error:', error)
    return NextResponse.json({ error: 'Gagal mengirim pesan' }, { status: 500 })
  }
}
