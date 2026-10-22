import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getActiveSession } from '@/lib/auth-server'

/**
 * API Notifikasi In-App (lonceng header)
 * --------------------------------------
 * GET  → daftar notifikasi + jumlah belum dibaca (untuk sesi ini)
 * POST → tandai sudah dibaca (satu id / beberapa id / semua)
 *
 * Notifikasi disimpan di server sehingga teknisi, admin, dan manager melihat
 * daftar yang sama; status baca dicatat per pengguna (bukan per browser).
 */

const MAKS_TAMPIL = 50

// GET /api/notifikasi
export async function GET(request: Request) {
  try {
    const session = await getActiveSession(request)
    if (!session) {
      return NextResponse.json({ error: 'Sesi berakhir atau akun nonaktif. Silakan login ulang.' }, { status: 401 })
    }
    const penggunaId = Number(session.sub)
    const role = session.role

    // Notifikasi yang boleh dilihat role ini: untukRole null (semua) atau memuat role ini.
    const daftar = await db.notifikasi.findMany({
      where: {
        OR: [{ untukRole: null }, { untukRole: { contains: role } }],
      },
      orderBy: { createdAt: 'desc' },
      take: MAKS_TAMPIL,
    })
    const ids = daftar.map((n) => n.id)
    const dibaca = ids.length
      ? await db.notifikasiBaca.findMany({ where: { penggunaId, notifikasiId: { in: ids } }, select: { notifikasiId: true } })
      : []
    const sudahDibaca = new Set(dibaca.map((b) => b.notifikasiId))

    const items = daftar.map((n) => ({
      id: n.id,
      tipe: n.tipe,
      judul: n.judul,
      pesan: n.pesan,
      refType: n.refType,
      refId: n.refId,
      refLabel: n.refLabel,
      dibuatOleh: n.dibuatOleh,
      createdAt: n.createdAt.toISOString(),
      dibaca: sudahDibaca.has(n.id),
    }))

    return NextResponse.json({
      items,
      belumDibaca: items.filter((i) => !i.dibaca).length,
      total: items.length,
    })
  } catch (error) {
    console.error('Notifikasi GET error:', error)
    return NextResponse.json({ error: 'Gagal memuat notifikasi' }, { status: 500 })
  }
}

// POST /api/notifikasi — tandai terbaca
// body: { ids?: number[], semua?: boolean }
export async function POST(request: Request) {
  try {
    const session = await getActiveSession(request)
    if (!session) {
      return NextResponse.json({ error: 'Sesi berakhir atau akun nonaktif. Silakan login ulang.' }, { status: 401 })
    }
    const penggunaId = Number(session.sub)
    const role = session.role
    const body = await request.json().catch(() => ({} as { ids?: unknown; semua?: unknown }))
    const semua = body.semua === true
    const ids = Array.isArray(body.ids) ? body.ids.map((x) => Number(x)).filter((n) => Number.isFinite(n)) : []

    if (!semua && !ids.length) {
      return NextResponse.json({ error: 'Tidak ada notifikasi yang ditandai' }, { status: 400 })
    }

    // Hanya notifikasi yang boleh dilihat role ini yang boleh ditandai terbaca.
    const bolehDibaca = semua
      ? await db.notifikasi.findMany({
          where: { OR: [{ untukRole: null }, { untukRole: { contains: role } }] },
          select: { id: true },
        })
      : await db.notifikasi.findMany({
          where: {
            id: { in: ids },
            OR: [{ untukRole: null }, { untukRole: { contains: role } }],
          },
          select: { id: true },
        })
    const target = bolehDibaca.map((n) => n.id)
    if (target.length) {
      for (const id of target) {
        await db.notifikasiBaca.upsert({
          where: { notifikasiId_penggunaId: { notifikasiId: id, penggunaId } },
          create: { notifikasiId: id, penggunaId },
          update: { dibacaAt: new Date() },
        })
      }
    }

    const belumDibaca = await db.notifikasiBaca.count({
      where: {
        penggunaId,
        notifikasi: {
          OR: [{ untukRole: null }, { untukRole: { contains: role } }],
          dibaca: { none: { penggunaId } },
        },
      },
    })

    return NextResponse.json({ ok: true, ditandai: target.length, belumDibaca })
  } catch (error) {
    console.error('Notifikasi POST error:', error)
    return NextResponse.json({ error: 'Gagal menandai notifikasi terbaca' }, { status: 500 })
  }
}
