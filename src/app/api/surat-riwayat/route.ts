import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireActiveSession } from '@/lib/auth-server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * GET /api/surat-riwayat?noTiket=A,B,C — RIWAYAT PERSURATAN TERPADU.
 * Satu titik untuk mencari SEMUA bundel dokumen yang menyentuh tiket
 * terpilih: SJR (request part), SJ masuk (produsen), STTB (tarik unit),
 * STTBK (kolektif pick up), SKTB (pengembalian). Setiap entri menyertakan
 * `link` cetak ulang — dokumen lama regenerate dengan NOMOR SAMA, sehingga
 * tidak ada nomor ganda dan user tidak perlu mencari satu per satu lagi.
 * Tanpa ?noTiket → ringkasan 40 pembukuan persuratan terakhir.
 */

export async function GET(request: Request) {
  try {
    const { session, denied } = await requireActiveSession(request)
    if (denied) return denied

    const { searchParams } = new URL(request.url)
    const noTiketRaw = (searchParams.get('noTiket') || '').trim()
    const daftar = noTiketRaw
      ? noTiketRaw.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 100)
      : []
    const tanpaDaftar = daftar.length === 0

    // Tiket dasar — daftar terbatas atau (tanpa ?noTiket) 100 tiket terbaru
    // sebagai ringkasan persuratan terkini.
    const tiket = await db.serviceRequest.findMany({
      where: tanpaDaftar ? {} : { noTiket: { in: daftar } },
      include: { unitAsset: { include: { toko: true } } },
      orderBy: { tglTiket: 'desc' },
      take: tanpaDaftar ? 40 : 100,
    })
    if (!tanpaDaftar && tiket.length === 0) {
      return NextResponse.json({ error: 'Tiket tidak ditemukan' }, { status: 404 })
    }

    // ===== 1) Surat Jalan REQUEST (SJR) — snapshot tersimpan lengkap =====
    const sjr = await db.suratJalanRequest.findMany({
      where: tanpaDaftar
        ? {}
        : { items: { some: { noTiket: { in: daftar } } } },
      orderBy: { tglRequest: 'desc' },
      take: 50,
      include: { items: { select: { serviceRequestId: true, noTiket: true, kodePart: true, namaPart: true, qty: true, toko: true } } },
    })

    // ===== 2) Cross-check surat jalan MASUK (produsen) =====
    const masuk = tanpaDaftar
      ? []
      : await db.suratJalanMasuk.findMany({
          orderBy: { createdAt: 'desc' },
          take: 60,
          select: {
            id: true,
            noSuratJalan: true,
            refSjrNo: true,
            tglSurat: true,
            produsen: true,
            status: true,
            totalItem: true,
            cocokCount: true,
            createdAt: true,
            createdBy: true,
          },
        })

    // ===== 3) STTB (tarik unit), STTBK (kolektif), SKTB (kembali) =====
    // Nomor tersimpan di tiket — bundel = tiket yang membawa nomor sama.

    const sttbNo = tiket.filter((t) => t.noSttb).map((t) => ({ noTiket: t.noTiket, noSttb: t.noSttb! }))
    const sttbAudit = await db.auditLog.findMany({
      where: { aksi: 'MULAI_PROSES_SERVICE', entitas: 'service_request', entitasId: { in: sttbNo.map((s) => s.noTiket) } },
      select: { entitasId: true, createdAt: true, aktor: true },
      orderBy: { createdAt: 'asc' },
    })
    const sttbAuditMap = new Map(sttbAudit.map((a) => [a.entitasId ?? '', a]))

    const sttbkNo = tiket.filter((t) => t.noSttbKolektif).map((t) => t.noSttbKolektif!)
    const sttbkAudit = await db.auditLog.findMany({
      where: { aksi: 'CETAK_STTB_KOLEKTIF', entitasId: { in: sttbkNo } },
      select: { entitasId: true, createdAt: true, aktor: true },
      orderBy: { createdAt: 'asc' },
    })
    const sttbkAuditMap = new Map(sttbkAudit.map((a) => [a.entitasId ?? '', a]))

    const sktbNo = tiket.filter((t) => t.noSuratKembali).map((t) => t.noSuratKembali!)
    const sktbAudit = await db.auditLog.findMany({
      where: { aksi: 'CETAK_KEMBALI_TOKO', entitasId: { in: sktbNo } },
      select: { entitasId: true, createdAt: true, aktor: true },
      orderBy: { createdAt: 'asc' },
    })
    const sktbAuditMap = new Map(sktbAudit.map((a) => [a.entitasId ?? '', a]))

    // Semua dokumen jadi satu daftar bundel — pencarian cukup di sini.
    interface EntriRiwayat {
      tipe: string
      nomor: string
      tgl: Date | string | null
      oleh: string | null
      link: string
      tiket: string[]
      toko?: string | null
      info?: string
    }
    const riwayat: EntriRiwayat[] = []

    // SJR — tanggal request = tglRequest, penyusun = dibuatOleh
    for (const d of sjr) {
      riwayat.push({
        tipe: 'SJR',
        nomor: d.noSurat,
        tgl: d.tglRequest,
        oleh: d.dibuatOleh,
        link: `/api/surat-jalan-request/${d.id}?format=pdf`,
        tiket: d.items.map((i) => i.noTiket),
        info: `Request ${d.totalItem} item · ${d.totalQty} pcs${d.produsenTujuan ? ` · kepada ${d.produsenTujuan}` : ''}`,
      })
    }

    // SJ masuk — tiket spesifik tidak diketahui (pencocokan sudah diterapkan),
    // simplifikasi: kosong; info status & produsen cukup untuk pencarian.
    for (const d of masuk) {
      riwayat.push({
        tipe: 'SJ-MASUK',
        nomor: d.noSuratJalan,
        tgl: d.tglSurat ?? d.createdAt,
        oleh: d.createdBy,
        link: '',
        tiket: [],
        toko: d.produsen,
        info: `${d.cocokCount}/${d.totalItem} cocok · ${d.status}`,
      })
    }

    // STTB per tiket — tanggal pakai audit terbit; fallback updatedAt tiket
    // (STTB bisa terbit lewat beberapa jalur alur, nomor noSttb sudah cukup).
    for (const s of sttbNo) {
      const a = sttbAuditMap.get(s.noTiket)
      const tiketTs = tiket.find((t) => t.noTiket === s.noTiket)?.updatedAt ?? null
      riwayat.push({
        tipe: 'STTB',
        nomor: s.noSttb,
        tgl: a?.createdAt ?? tiketTs,
        oleh: a?.aktor ?? null,
        link: `/api/sttb/${s.noTiket}`,
        tiket: [s.noTiket],
      })
    }

    // STTBK kolektif
    for (const n of sttbkNo) {
      const a = sttbkAuditMap.get(n)
      const tiketNo = tiket.filter((t) => t.noSttbKolektif === n).map((t) => t.noTiket)
      const tokoNama = tiket.find((t) => t.noSttbKolektif === n)?.unitAsset.toko?.namaToko ?? null
      riwayat.push({
        tipe: 'STTBK',
        nomor: n,
        tgl: a?.createdAt ?? null,
        oleh: a?.aktor ?? null,
        link: `/api/sttb/kolektif?noDokumen=${n}&format=pdf`,
        tiket: tiketNo,
        toko: tokoNama,
      })
    }

    // SKTB pengembalian
    for (const n of sktbNo) {
      const a = sktbAuditMap.get(n)
      const tiketNo = tiket.filter((t) => t.noSuratKembali === n).map((t) => t.noTiket)
      const tokoNama = tiket.find((t) => t.noSuratKembali === n)?.unitAsset.toko?.namaToko ?? null
      riwayat.push({
        tipe: 'SKTB',
        nomor: n,
        tgl: a?.createdAt ?? null,
        oleh: a?.aktor ?? null,
        link: `/api/sttb/kembali?noDokumen=${n}&format=pdf`,
        tiket: tiketNo,
        toko: tokoNama,
      })
    }

    // Urut terbaru dulu (tanggal terekam bisa saja ada yang kosong)
    riwayat.sort((x, y) => {
      const tx = x.tgl ? new Date(x.tgl).getTime() : 0
      const ty = y.tgl ? new Date(y.tgl).getTime() : 0
      return ty - tx
    })

    return NextResponse.json({ tiket: tiket.map((t) => ({ noTiket: t.noTiket, unit: `${t.unitAsset.modelUnit ?? '-'} · ${t.unitAsset.serialNumber}` })), riwayat })
  } catch (error) {
    console.error('Surat riwayat error:', error)
    return NextResponse.json({ error: 'Gagal memuat riwayat persuratan' }, { status: 500 })
  }
}
