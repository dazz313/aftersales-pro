import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { requireActiveSession } from '@/lib/auth-server'
import { aksiTersedia, hitungTahap, labelTahap } from '@/lib/mobile-tahap'

/**
 * GET /api/mobile/scan?kode=...
 *
 * SATU pintu masuk untuk aplikasi mobile (Kotlin) saat memindai stiker:
 * - QR/barcode TOKO (berisi NAMA TOKO, kompatibel kode lama BC-TOK-xxx) →
 *   `tipe: "TOKO"` + ringkasan kunjungan + aksi CHECKIN.
 * - QR/barcode UNIT (nomor seri) → `tipe: "UNIT"` + tiket aktif + tahap +
 *   aksi lanjutan (KERJAKAN_DI_TOKO / TARIK_WORKSHOP / FINISH / KEMBALI_KE_TOKO).
 * - Nomor tiket (SV-... / SVC-...) → `tipe: "TIKET"`.
 *
 * Endpoint ini READ-ONLY (tidak mencatat apa pun). Penulisan tetap memakai
 * endpoint yang sudah ada:
 * - check-in kunjungan : POST /api/kunjungan
 * - ubah tahap tiket   : PATCH /api/service/{id}  { aksi }
 *
 * Dilindungi sesi aktif (Bearer token hasil /api/auth/login).
 */

const INCLUDE_UNIT = Prisma.validator<Prisma.UnitAssetInclude>()({
  toko: { select: { id: true, kodeToko: true, namaToko: true } },
  customer: { select: { id: true, nama: true } },
  serviceRequests: {
    orderBy: { createdAt: 'desc' },
    include: { parts: { include: { sparepart: { select: { kodePart: true, namaPart: true } } } } },
  },
})

const INCLUDE_TIKET = Prisma.validator<Prisma.ServiceRequestInclude>()({
  unitAsset: {
    include: {
      toko: { select: { id: true, kodeToko: true, namaToko: true } },
      customer: { select: { id: true, nama: true } },
    },
  },
  parts: { include: { sparepart: { select: { kodePart: true, namaPart: true } } } },
})

type UnitLengkap = Prisma.UnitAssetGetPayload<{ include: typeof INCLUDE_UNIT }>
type TiketUnit = UnitLengkap['serviceRequests'][number]
type TiketLengkap = Prisma.ServiceRequestGetPayload<{ include: typeof INCLUDE_TIKET }>

/** Field unit yang cukup untuk ringkasan di HP (dipakai unit & tiket). */
interface UnitRingkasSumber {
  id: number
  serialNumber: string
  modelUnit: string
  merk: string
  nama: string
  statusGaransi: string
  kerusakanAwal: string | null
  toko?: { id: number; kodeToko: string; namaToko: string } | null
  customer?: { id: number; nama: string } | null
}

export async function GET(request: Request) {
  try {
    const { denied } = await requireActiveSession(request)
    if (denied) return denied

    const { searchParams } = new URL(request.url)
    const kode = (searchParams.get('kode') ?? '').trim()
    if (!kode) {
      return NextResponse.json({ error: 'Parameter kode wajib diisi' }, { status: 400 })
    }

    // QR lama unit bisa berbentuk "SN:xxx|MOD:yyy|TOK:zzz" — ambil bagian SN.
    const kodeNormal = /^SN:/i.test(kode)
      ? (kode.split('|').find((b) => /^SN:/i.test(b)) ?? '').slice(3).trim()
      : kode

    // ===== 1. Coba sebagai TOKO =====
    const toko = await cariToko(kodeNormal)
    if (toko) {
      const hariSejak = toko.tglVisitTerakhir
        ? Math.floor((Date.now() - new Date(toko.tglVisitTerakhir).getTime()) / (24 * 3600 * 1000))
        : null
      return NextResponse.json({
        ok: true,
        tipe: 'TOKO',
        kode,
        toko: {
          id: toko.id,
          kodeToko: toko.kodeToko,
          namaToko: toko.namaToko,
          alamat: toko.alamat,
          kontak: toko.kontak,
          latitude: toko.latitude,
          longitude: toko.longitude,
          frekuensiVisit: toko.frekuensiVisit,
          tglVisitTerakhir: toko.tglVisitTerakhir,
          barcodeToko: toko.barcodeToko,
          aktif: toko.aktif,
          modeSiklus: toko.modeSiklus,
        },
        jumlahUnit: toko._count.unitAssets,
        totalKunjungan: toko._count.kunjungan,
        hariSejakVisit: hariSejak,
        visitTerlambat:
          !toko.aktif || toko.modeSiklus === 'BY_REQUEST'
            ? false
            : hariSejak === null || hariSejak > toko.frekuensiVisit,
        kunjunganTerakhir: toko.kunjungan[0]
          ? {
              waktu: toko.kunjungan[0].tglKunjungan,
              teknisi: toko.kunjungan[0].teknisi.nama,
              metode: toko.kunjungan[0].metodeCheckin,
            }
          : null,
        aksiTersedia: [
          {
            aksi: 'CHECKIN',
            label: 'Catat Kunjungan',
            endpoint: 'POST /api/kunjungan',
            body: ['barcode', 'teknisiId', 'catatanStokRusak?', 'fotoOnsite?'],
          },
        ],
      })
    }

    // ===== 2. Coba sebagai UNIT (nomor seri) =====
    const unitList = await cariUnit(kodeNormal)
    if (unitList.length > 1) {
      return NextResponse.json({
        ok: true,
        tipe: 'UNIT_GANDA',
        kode,
        pesan: `${unitList.length} unit memakai nomor seri yang sama — pilih salah satu`,
        kandidat: unitList.map((u) => ({
          id: u.id,
          serialNumber: u.serialNumber,
          modelUnit: u.modelUnit,
          merk: u.merk,
          nama: u.nama,
          toko: u.toko ? { id: u.toko.id, kodeToko: u.toko.kodeToko, namaToko: u.toko.namaToko } : null,
          customer: u.customer ? { id: u.customer.id, nama: u.customer.nama } : null,
        })),
        aksiTersedia: [],
      })
    }
    if (unitList.length === 1) {
      return NextResponse.json(bangunHasilUnit(unitList[0], kode))
    }

    // ===== 3. Coba sebagai NOMOR TIKET =====
    const tiket = await db.serviceRequest.findFirst({
      where: { noTiket: kodeNormal.toUpperCase() },
      include: INCLUDE_TIKET,
    })
    if (tiket) {
      return NextResponse.json(bangunHasilTiket(tiket, kode))
    }

    return NextResponse.json(
      {
        ok: false,
        tipe: 'TIDAK_DIKENAL',
        kode,
        error: `Kode "${kode}" tidak dikenali sebagai QR toko, nomor seri unit, atau nomor tiket.`,
      },
      { status: 404 }
    )
  } catch (error) {
    console.error('Mobile scan error:', error)
    return NextResponse.json({ error: 'Gagal memproses hasil scan' }, { status: 500 })
  }
}

/* ================================ helper ================================= */

async function cariToko(kode: string) {
  const norm = kode.toUpperCase().replace(/^BC-/, '')
  const langsung = await db.masterToko.findFirst({
    where: { OR: [{ barcodeToko: kode }, { barcodeToko: `BC-${norm}` }, { kodeToko: norm }] },
    include: {
      _count: { select: { unitAssets: true, kunjungan: true } },
      kunjungan: { orderBy: { tglKunjungan: 'desc' }, take: 1, include: { teknisi: { select: { nama: true } } } },
    },
  })
  if (langsung) return langsung

  // SQLite tidak case-insensitive — cocokkan nama toko di sisi aplikasi.
  const semua = await db.masterToko.findMany({
    include: {
      _count: { select: { unitAssets: true, kunjungan: true } },
      kunjungan: { orderBy: { tglKunjungan: 'desc' }, take: 1, include: { teknisi: { select: { nama: true } } } },
    },
  })
  const lower = kode.trim().toLowerCase()
  return (
    semua.find(
      (t) =>
        (t.barcodeToko ?? '').trim().toLowerCase() === lower ||
        (t.namaToko ?? '').trim().toLowerCase() === lower ||
        (t.barcodeToko ?? '').toUpperCase().replace(/^BC-/, '') === norm ||
        (t.kodeToko ?? '').toUpperCase() === norm
    ) ?? null
  )
}

async function cariUnit(kode: string): Promise<UnitLengkap[]> {
  const upper = kode.toUpperCase()
  const langsung = await db.unitAsset.findMany({
    where: { serialNumber: { in: [kode, upper, kode.toLowerCase()] } },
    include: INCLUDE_UNIT,
    orderBy: { createdAt: 'desc' },
  })
  if (langsung.length > 0) return langsung

  const semua = await db.unitAsset.findMany({ include: INCLUDE_UNIT, orderBy: { createdAt: 'desc' } })
  return semua.filter((u) => (u.serialNumber ?? '').trim().toUpperCase() === upper)
}

/** Tiket yang ditampilkan: yang masih aktif dulu, kalau tidak ada pakai terbaru. */
function pilihTiket(tiketList: TiketUnit[]): TiketUnit | null {
  return tiketList.find((t) => ['REQUEST', 'REQUEST_EMAIL', 'PROSES'].includes(t.status)) ?? tiketList[0] ?? null
}

function ringkasTiket(tiket: TiketUnit | TiketLengkap) {
  return {
    id: tiket.id,
    noTiket: tiket.noTiket,
    status: tiket.status,
    penanganan: tiket.penanganan,
    lokasiUnit: tiket.lokasiUnit,
    noSttb: tiket.noSttb,
    tglTiket: tiket.tglTiket,
    tglFinish: tiket.tglFinish,
    tglKembaliKeToko: tiket.tglKembaliKeToko,
    deskripsiKerusakan: tiket.deskripsiKerusakan,
    parts: (tiket.parts ?? []).map((p) => ({
      id: p.id,
      kodePart: p.sparepart?.kodePart ?? p.kodePartCache ?? null,
      namaPart: p.sparepart?.namaPart ?? p.namaPartCache ?? null,
      qty: p.qty,
      statusPart: p.statusPart,
      statusKonfirmasi: p.statusKonfirmasi,
    })),
  }
}

function ringkasUnit(unit: UnitRingkasSumber) {
  return {
    id: unit.id,
    serialNumber: unit.serialNumber,
    modelUnit: unit.modelUnit,
    merk: unit.merk,
    nama: unit.nama,
    statusGaransi: unit.statusGaransi,
    kerusakanAwal: unit.kerusakanAwal,
    toko: unit.toko
      ? { id: unit.toko.id, kodeToko: unit.toko.kodeToko, namaToko: unit.toko.namaToko }
      : null,
    customer: unit.customer ? { id: unit.customer.id, nama: unit.customer.nama } : null,
  }
}

function bangunHasilUnit(unit: UnitLengkap, kode: string) {
  const tiket = pilihTiket(unit.serviceRequests ?? [])
  const tahap = hitungTahap(tiket)
  const ringkas = ringkasUnit(unit)
  return {
    ok: true,
    tipe: 'UNIT',
    kode,
    unit: ringkas,
    // 4 identifikasi utama yang dipakai aplikasi mobile saat scan produk.
    identifikasi: {
      namaProduk: ringkas.nama?.trim() || ringkas.modelUnit,
      model: ringkas.modelUnit,
      nomorSeri: ringkas.serialNumber,
      namaToko: ringkas.toko?.namaToko ?? ringkas.customer?.nama ?? null,
      waktuScan: new Date().toISOString(),
    },
    tiket: tiket ? ringkasTiket(tiket) : null,
    tahap,
    tahapLabel: labelTahap(tahap),
    aksiTersedia: tiket
      ? aksiTersedia(tiket).map((a) => ({ ...a, endpoint: `PATCH /api/service/${tiket.id}` }))
      : [],
  }
}

function bangunHasilTiket(tiket: TiketLengkap, kode: string) {
  const tahap = hitungTahap(tiket)
  const ringkas = ringkasUnit(tiket.unitAsset)
  return {
    ok: true,
    tipe: 'TIKET',
    kode,
    unit: ringkas,
    identifikasi: {
      namaProduk: ringkas.nama?.trim() || ringkas.modelUnit,
      model: ringkas.modelUnit,
      nomorSeri: ringkas.serialNumber,
      namaToko: ringkas.toko?.namaToko ?? ringkas.customer?.nama ?? null,
      waktuScan: new Date().toISOString(),
    },
    tiket: ringkasTiket(tiket),
    tahap,
    tahapLabel: labelTahap(tahap),
    aksiTersedia: aksiTersedia(tiket).map((a) => ({ ...a, endpoint: `PATCH /api/service/${tiket.id}` })),
  }
}
