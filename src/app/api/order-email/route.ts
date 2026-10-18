import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { autoGitBackup } from '@/lib/git-backup'
import { getActiveSession } from '@/lib/auth-server'
import { prosesKirimOrderEmail } from '@/lib/order-email'
import type { HasilKirimEmail } from '@/lib/types'

// GET /api/order-email — daftar khusus kekurangan sparepart yang akan/sudah diemail ke produsen
export async function GET(request: Request) {
  try {
    const session = await getActiveSession(request)
    if (!session) {
      return NextResponse.json({ error: 'Sesi berakhir atau akun nonaktif. Silakan login ulang.' }, { status: 401 })
    }
    const items = await db.orderEmailPart.findMany({ orderBy: { createdAt: 'desc' } })
    return NextResponse.json(items)
  } catch (error) {
    console.error('OrderEmail GET error:', error)
    return NextResponse.json({ error: 'Gagal memuat daftar order email' }, { status: 500 })
  }
}

// POST /api/order-email — simpan baris Kekurangan Sparepart dari form Input Part unit
// lalu otomatis mencoba pengiriman email ke produsen (SMTP; bila belum diset → draf mailto).
export async function POST(request: Request) {
  try {
    const session = await getActiveSession(request)
    if (!session) {
      return NextResponse.json({ error: 'Sesi berakhir atau akun nonaktif. Silakan login ulang.' }, { status: 401 })
    }
    const body = await request.json()
    const aktor = (typeof body.aktor === 'string' && body.aktor.trim()) ? body.aktor : session.nama
    const unitAssetId = Number(body.unitAssetId) || null
    const catatan = typeof body.catatan === 'string' ? body.catatan.trim() : ''
    const rowsInput: unknown[] = Array.isArray(body.rows) ? body.rows : []

    // Validasi: tiap baris wajib kode+nama (qty≥1)
    const rows = rowsInput
      .map((r) => {
        const o = (r ?? {}) as { kodePart?: unknown; namaPart?: unknown; qty?: unknown }
        return {
          kodePart: String(o.kodePart ?? '').trim().toUpperCase(),
          namaPart: String(o.namaPart ?? '').trim(),
          qty: Math.max(1, Math.min(9999, Math.floor(Number(o.qty) || 1))),
        }
      })
      .filter((r) => r.kodePart && r.namaPart)
    if (rows.length === 0) {
      return NextResponse.json({ error: 'Minimal satu baris kekurangan part dengan kode & nama terisi' }, { status: 400 })
    }
    // Anti-pengulangan dalam satu pengiriman: kode sama ditolak
    const dups = rows.filter((r, i) => rows.findIndex((x) => x.kodePart === r.kodePart) !== i)
    if (dups.length > 0) {
      return NextResponse.json({ error: `Kode ganda dalam satu pengiriman: ${[...new Set(dups.map((d) => d.kodePart))].join(', ')}` }, { status: 409 })
    }

    // Konteks unit (snapshot agar email tak bergantung pada data yang bisa berubah)
    let unitCtx: {
      serialNumber: string
      modelUnit: string
      tokoKode: string | null
      tokoNama: string | null
    } | null = null
    if (unitAssetId) {
      const u = await db.unitAsset.findUnique({
        where: { id: unitAssetId },
        include: { toko: { select: { kodeToko: true, namaToko: true } } },
      })
      if (u) {
        unitCtx = {
          serialNumber: u.serialNumber,
          modelUnit: u.modelUnit,
          tokoKode: u.toko?.kodeToko ?? null,
          tokoNama: u.toko?.namaToko ?? null,
        }
      }
    }

    const created = await db.$transaction(
      rows.map((r) =>
        db.orderEmailPart.create({
          data: {
            kodePart: r.kodePart,
            namaPart: r.namaPart,
            qty: r.qty,
            unitAssetId: unitCtx ? unitAssetId : null,
            serialNumber: unitCtx?.serialNumber ?? null,
            modelUnit: unitCtx?.modelUnit ?? null,
            tokoKode: unitCtx?.tokoKode ?? null,
            tokoNama: unitCtx?.tokoNama ?? null,
            catatan: catatan || null,
            diinputOleh: aktor,
          },
        })
      )
    )
    await logAudit({
      aksi: 'CREATE_ORDER_EMAIL',
      entitas: 'order_email_part',
      entitasId: created.map((c) => c.kodePart).join(','),
      deskripsi: `Kekurangan sparepart unit ${unitCtx?.serialNumber ?? '-'} dicatat & mengantre email ke produsen (${created.length} item)`,
      aktor,
    })
    await autoGitBackup('CREATE', 'order_email_part', created.map((c) => c.kodePart).slice(0, 3).join(','), aktor)

    // Otomatis kirim email berisi baris-baris yang baru dibuat
    const kirim = await prosesKirimOrderEmail(created.map((c) => c.id), aktor)
    if (kirim.mode === 'SMTP') {
      await logAudit({
        aksi: 'KIRIM_EMAIL_PRODUSEN',
        entitas: 'order_email_part',
        entitasId: created.map((c) => c.kodePart).join(','),
        deskripsi: `Email order otomatis terkirim ke ${kirim.ke} (${kirim.terkirim} item)`,
        aktor,
      })
      await autoGitBackup('UPDATE', 'order_email_part', 'terkirim', aktor)
    }
    return NextResponse.json({ items: created, kirim: kirim satisfies HasilKirimEmail })
  } catch (error) {
    console.error('OrderEmail POST error:', error)
    return NextResponse.json({ error: 'Gagal menyimpan order kekurangan sparepart' }, { status: 500 })
  }
}
