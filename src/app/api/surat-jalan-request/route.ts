import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { autoGitBackup } from '@/lib/git-backup'
import { requireActiveSession } from '@/lib/auth-server'
// Builder dokumen dipindah ke lib agar dipakai bersama route cetak-ulang
// (GET /api/surat-jalan-request/[id]) — dokumen reprint identik dengan aslinya.
import { buatPdf, buatXlsx, type ItemBaris } from '@/lib/surat-jalan-dokumen'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Satu route, dua peran:
 * - POST — Surat Jalan REQUEST part ke Produsen (keluar). Dipanggil dialog
 *   cetak "Surat Jalan" di Proses Service. Setiap unduhan: (1) data request
 *   DISIMPAN sebagai dokumen SJR-YYYYMMDD-NNNN (snapshot tiket + part + qty
 *   + toko + serial/model); (2) tiket ditandai `tglRequestPart` (request
 *   pertama yang menang) → tampil di bawah badge REQUEST; (3) dokumen
 *   PDF/Excel dibuat dengan baris "Tanggal Request :" tepat di bawah judul.
 *   Body: { noTiket: string[], format?: 'pdf' | 'xlsx' } — tanpa format → JSON.
 * - GET — riwayat 10 dokumen request terakhir PLUS cross-check ke surat
 *   jalan masuk: diterima (pasangan kode|tiket ada di SJ DITERAPKAN),
 *   dicatat (di DRAF/DIPERIKSA), belum (tak ada jejakkiriman).
 * Cetak-ulang dokumen lama (nomor sama, tidak membuat record baru) tersedia
 * di route /api/surat-jalan-request/[id].
 */

const NORM = (s: string) => (s || '').toUpperCase().replace(/[^A-Z0-9#]/g, '')

export async function POST(request: Request) {
  try {
    const { session, denied } = await requireActiveSession(request)
    if (denied) return denied
    const aktor = session?.nama ?? 'SYSTEM'

    const body = (await request.json().catch(() => null)) as
      | { noTiket?: unknown[]; format?: unknown; produsen?: unknown }
      | null
    const noTiketList: string[] = Array.isArray(body?.noTiket)
      ? [...new Set(body.noTiket.map((s: unknown) => String(s).trim()).filter(Boolean))]
      : []
    if (noTiketList.length === 0) {
      return NextResponse.json({ error: 'Pilih minimal 1 tiket untuk surat jalan request' }, { status: 400 })
    }
    if (noTiketList.length > 100) {
      return NextResponse.json({ error: 'Maksimal 100 tiket per surat jalan request' }, { status: 400 })
    }
    // Produsen tujuan surat ("Kepada: PT ...") — input dialog, atau saran merk
    // unit dari klien bila kosong; hanya dicatat, tidak divalidasi ke master.
    const produsenTujuan =
      typeof body?.produsen === 'string' ? body.produsen.trim().slice(0, 120) : ''
    const format = body?.format === 'xlsx' ? 'xlsx' : body?.format === 'pdf' ? 'pdf' : null

    const tickets = await db.serviceRequest.findMany({
      where: { noTiket: { in: noTiketList } },
      include: {
        unitAsset: { include: { toko: true } },
        parts: { include: { sparepart: true } },
      },
      orderBy: { noTiket: 'asc' },
    })
    const foundSet = new Set(tickets.map((t) => t.noTiket))
    const missing = noTiketList.filter((n) => !foundSet.has(n))
    if (missing.length > 0) {
      return NextResponse.json(
        { error: `Tiket tidak ditemukan: ${missing.slice(0, 5).join(', ')}` },
        { status: 404 }
      )
    }

    // Snapshot item — hanya part dengan kode+nama lengkap (yang belum keisi
    // komunikasi part dilewatkan; angka lewatnya ikut dilaporkan di dokumen).
    const items: ItemBaris[] = []
    let lewatTanpaKode = 0
    for (const t of tickets) {
      for (const p of t.parts) {
        const kode = (p.sparepart?.kodePart ?? '').trim()
        const nama = (p.sparepart?.namaPart ?? '').trim()
        if (!kode || !nama) {
          lewatTanpaKode++
          continue
        }
        items.push({
          serviceRequestId: t.id,
          noTiket: t.noTiket,
          kodePart: kode,
          namaPart: nama,
          qty: p.qty,
          toko: t.unitAsset.toko?.namaToko ?? '-',
          serialNumber: t.unitAsset.serialNumber || '-',
          modelUnit: t.unitAsset.modelUnit || '-',
        })
      }
    }
    if (items.length === 0) {
      return NextResponse.json(
        { error: 'Tiket terpilih belum punya part dengan kode+nama. Lengkapi part di tiket dulu.' },
        { status: 400 }
      )
    }

    // Nomor dokumen harian: SJR-YYYYMMDD-NNNN (tiap unduhan = 1 dokumen baru —
    // riwayat lengkap, tgl request tiket tidak diubah ulang setelah terisi).
    const now = new Date()
    const ymd = now.toISOString().slice(0, 10).replace(/-/g, '')
    const startOfDay = new Date(now)
    startOfDay.setHours(0, 0, 0, 0)
    const usedToday = await db.suratJalanRequest.count({
      where: { tglRequest: { gte: startOfDay } },
    })
    const noSurat = `SJR-${ymd}-${String(usedToday + 1).padStart(4, '0')}`
    const totalQty = items.reduce((a, i) => a + (i.qty || 1), 0)

    const sjr = await db.suratJalanRequest.create({
      data: {
        noSurat,
        tglRequest: now,
        produsenTujuan: produsenTujuan || null,
        dibuatOleh: aktor,
        totalTiket: tickets.length,
        totalItem: items.length,
        totalQty,
        lewatTanpaKode,
        items: {
          create: items.map((i) => ({
            serviceRequestId: i.serviceRequestId,
            noTiket: i.noTiket,
            kodePart: i.kodePart,
            namaPart: i.namaPart,
            qty: i.qty,
            toko: i.toko,
            serialNumber: i.serialNumber,
            modelUnit: i.modelUnit,
          })),
        },
      },
    })

    // Tandai tiket — tgl request ditampilkan di bawah badge REQUEST.
    await db.serviceRequest.updateMany({
      where: { noTiket: { in: noTiketList }, tglRequestPart: null },
      data: { tglRequestPart: now },
    })

    await logAudit({
      aksi: 'CETAK_SJ_REQUEST',
      entitas: 'surat_jalan_request',
      entitasId: noSurat,
      deskripsi: `Surat jalan request part: ${tickets.length} tiket · ${items.length} item · ${totalQty} pcs${lewatTanpaKode ? ` · ${lewatTanpaKode} part lewat (kode/nama kurang)` : ''}`,
      aktor,
    })
    await autoGitBackup('CREATE', 'surat_jalan_request', noSurat, aktor)

    if (!format) {
      return NextResponse.json({
        ok: true,
        id: sjr.id,
        noSurat,
        tglRequest: now,
        totalItem: items.length,
        totalQty,
        lewatTanpaKode,
      })
    }

    const settings = await db.pengaturan.findMany()
    const s: Record<string, string> = {}
    for (const row of settings) s[row.kunci] = row.nilai
    const infoToko = {
      nama: s['nama_perusahaan'] ?? 'Workshop',
      alamat: s['alamat_perusahaan'] ?? '-',
      email: (s['email_perusahaan'] ?? '').trim(),
    }

    if (format === 'pdf') {
      const pdf = await buatPdf({ noSurat, tglRequest: now, items, infoToko, totalQty, produsenTujuan, dibuatOleh: aktor })
      return new NextResponse(pdf, {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="Surat-Jalan-Request-${noSurat}.pdf"`,
        },
      })
    }
    const xlsx = buatXlsx({ noSurat, tglRequest: now, items, totalQty, lewatTanpaKode, produsenTujuan })
    return new NextResponse(xlsx, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="Surat-Jalan-Request-${noSurat}.xlsx"`,
      },
    })
  } catch (error) {
    console.error('Surat jalan REQUEST error:', error)
    return NextResponse.json({ error: 'Gagal membuat surat jalan request' }, { status: 500 })
  }
}

// ===== GET — riwayat 10 dokumen request + cross-check ke surat jalan masuk =====
// diterima = pasangan kode|tiket ada di SJ DITERAPKAN (resmi, tglPartDatang terisi)
// dicatat  = pasangan ada di SJ DRAF/DIPERIKSA (produsen tandai kirim, menunggu cek → terapkan)
// belum    = tak ada jejak kiriman
export async function GET(request: Request) {
  try {
    const { denied } = await requireActiveSession(request)
    if (denied) return denied

    const [sjs, masuk] = await Promise.all([
      db.suratJalanRequest.findMany({
        orderBy: { tglRequest: 'desc' },
        take: 10,
        include: { items: { orderBy: { id: 'asc' } } },
      }),
      db.suratJalanMasuk.findMany({
        orderBy: { createdAt: 'desc' },
        take: 60,
        select: {
          noSuratJalan: true,
          status: true,
          refSjrNo: true,
          items: { select: { kodePart: true, cocokTiketId: true } },
        },
      }),
    ])

    // Dua keranjang pencocokan: resmi diterima (DITERAPKAN) vs baru dicatat
    // (DRAF/DIPERIKSA) — tiap keranjang memuat pasangan kode|tiket + daftar kode.
    const diterima = { pair: new Set<string>(), kode: new Set<string>() }
    const dicatat = { pair: new Set<string>(), kode: new Set<string>() }
    for (const s of masuk) {
      const target = s.status === 'DITERAPKAN' ? diterima : dicatat
      for (const it of s.items) {
        const kode = NORM(it.kodePart)
        target.kode.add(kode)
        target.pair.add(`${kode}|${it.cocokTiketId ?? 'x'}`)
      }
    }
    const cocok = (serviceRequestId: number | null, kodePart: string, b: typeof diterima): boolean => {
      const kode = NORM(kodePart)
      return b.pair.has(`${kode}|${serviceRequestId ?? 'x'}`) || (serviceRequestId == null && b.kode.has(kode))
    }

    const hasil = sjs.map((s) => {
      let nDiterima = 0
      let nDicatat = 0
      const belum: { noTiket: string; kodePart: string; namaPart: string }[] = []
      for (const it of s.items) {
        if (cocok(it.serviceRequestId, it.kodePart, diterima)) nDiterima++
        else if (cocok(it.serviceRequestId, it.kodePart, dicatat)) nDicatat++
        else belum.push({ noTiket: it.noTiket, kodePart: it.kodePart, namaPart: it.namaPart ?? '' })
      }
      return {
        noSurat: s.noSurat,
        tglRequest: s.tglRequest,
        dibuatOleh: s.dibuatOleh,
        totalTiket: s.totalTiket,
        totalItem: s.totalItem,
        totalQty: s.totalQty,
        lewatTanpaKode: s.lewatTanpaKode,
        diterima: nDiterima,
        dicatat: nDicatat,
        belum: belum.length,
        contohBelum: belum.slice(0, 8),
      }
    })

    return NextResponse.json(hasil)
  } catch (error) {
    console.error('Surat jalan REQUEST GET error:', error)
    return NextResponse.json({ error: 'Gagal memuat riwayat request surat jalan' }, { status: 500 })
  }
}
