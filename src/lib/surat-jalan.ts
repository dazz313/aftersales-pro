import * as XLSX from 'xlsx'
import { db } from '@/lib/db'

/**
 * Modul Surat Jalan Masuk dari Produsen.
 * ---------------------------------------------------------------
 * Sumber data: file Excel/CSV hasil scan manual user. Tiap baris item
 * (kode part, nama, qty, SN unit) dicocokkan ke:
 *  1. Part yang DIORDER VIA EMAIL — tiket REQUEST_EMAIL (SV-EM), item
 *     ServiceRequestPart ORDER_PRODUSEN + baris OrderEmailPart-nya.
 *  2. Part ready dari produsen pada tiket aktif (REQUEST/PROSES) —
 *     ServiceRequestPart ORDER_PRODUSEN apa pun statusKonfirmasi-nya
 *     (READY = sudah dikonfirmasi via balasan WA produsen).
 *  3. SN unit di surat jalan → Unit Asset (pembobot kandidat).
 * Aturan pertama deterministik; baris yang gagal dibantu AI (opsional).
 * Semua hasil matcher KEBALIKAN ke UI untuk dikonfirmasi — tidak pernah
 * menulis data langsung.
 */

export interface BarisSuratJalan {
  kodePart: string
  namaPart?: string
  qty: number
  serialNumber?: string
}

export interface Kandidat {
  key: string // p{id} = ServiceRequestPart · e{id} = OrderEmailPart
  serviceRequestId: number
  noTiket: string
  statusTiket: string
  unitId: number
  serial: string
  model: string
  tokoNama?: string
  kodePart: string
  namaPart: string
  qty: number
  partId?: number // MasterSparepart.id (dari ServiceRequestPart)
  unitPartId?: number
  emailPartId?: number
  sudahReady: boolean // statusKonfirmasi READY dari produsen
}

export interface HasilBaris extends BarisSuratJalan {
  statusMatch: 'COCOK' | 'TANPA_TIKET'
  cocokKandidat?: Kandidat
  opsi: Kandidat[] // kandidat utk baris ambigu (UI berupa pilihan)
  keterangan: string
}

export interface RingkasanSuratJalan {
  noSuratJalan: string
  tglSurat: Date | null
  produsen: string | null
  totalItem: number
  cocokCount: number
  tanpaTiket: number
  naikProses: number
}

const NORM = (s: string) => (s || '').toString().toUpperCase().replace(/[^A-Z0-9#]/g, '')

/** Jarak mirip 0..1 ringan (containment token + Levenshtein ratio). */
function similarity(a: string, b: string): number {
  const A = NORM(a)
  const B = NORM(b)
  if (!A || !B) return 0
  if (A === B) return 1
  if (A.includes(B) || B.includes(A)) return 0.85
  // Levenshtein ratio
  const m = A.length
  const n = B.length
  if (Math.abs(m - n) > Math.max(m, n)) return 0
  let prev = Array.from({ length: n + 1 }, (_, i) => i)
  for (let i = 1; i <= m; i++) {
    const cur = [i]
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (A[i - 1] === B[j - 1] ? 0 : 1))
    }
    prev = cur
  }
  return (1 - prev[n] / Math.max(m, n)) * 0.7 // containment lebih dipercaya
}

// ===== Ambil kandidat part di-order / ready produsen utk semua tiket aktif =====
export async function ambilKandidat(): Promise<Kandidat[]> {
  const tiketList = await db.serviceRequest.findMany({
    where: { status: { in: ['REQUEST', 'PROSES', 'REQUEST_EMAIL'] } },
    select: {
      id: true,
      noTiket: true,
      status: true,
      unitAsset: { select: { id: true, serialNumber: true, modelUnit: true, toko: { select: { namaToko: true } } } },
      parts: {
        where: { statusPart: 'ORDER_PRODUSEN' },
        select: {
          id: true,
          qty: true,
          statusKonfirmasi: true,
          sparepart: { select: { id: true, kodePart: true, namaPart: true } },
        },
      },
    },
  })
  const emailParts = await db.orderEmailPart.findMany({
    where: { serviceRequestId: { not: null }, status: { in: ['PENDING', 'TERKIRIM'] } },
    select: { id: true, kodePart: true, namaPart: true, qty: true, serviceRequestId: true },
  })
  const emailByTiket = new Map<number, typeof emailParts>()
  for (const e of emailParts) {
    if (e.serviceRequestId == null) continue
    const arr = emailByTiket.get(e.serviceRequestId) ?? []
    arr.push(e)
    emailByTiket.set(e.serviceRequestId, arr)
  }

  const kandidat: Kandidat[] = []
  for (const t of tiketList) {
    const suratEmail = emailByTiket.get(t.id) ?? []
    for (const p of t.parts) {
      // Pasangkan baris OrderEmailPart dgn kode sama — bila cocok, satu kandidat
      // membawa dua identitas (tiket part + item email) agar efek committing keduanya.
      const emailPasang = suratEmail.find((e) => NORM(e.kodePart) === NORM(p.sparepart.kodePart))
      kandidat.push({
        key: `p${p.id}`,
        serviceRequestId: t.id,
        noTiket: t.noTiket,
        statusTiket: t.status,
        unitId: t.unitAsset.id,
        serial: (t.unitAsset.serialNumber ?? '').trim(),
        model: t.unitAsset.modelUnit ?? '-',
        tokoNama: t.unitAsset.toko?.namaToko ?? undefined,
        kodePart: p.sparepart.kodePart,
        namaPart: p.sparepart.namaPart,
        qty: p.qty,
        partId: p.sparepart.id,
        unitPartId: p.id,
        emailPartId: emailPasang?.id,
        sudahReady: p.statusKonfirmasi === 'READY',
      })
    }
    // Baris email yang belum punya ServiceRequestPart dgn kode sama (mis. part
    // belum diinput manual) tetap kandidat — dicocokkan via item email-nya.
    const kodeTiket = new Set(t.parts.map((p) => NORM(p.sparepart.kodePart)))
    for (const e of suratEmail) {
      if (kodeTiket.has(NORM(e.kodePart))) continue
      kandidat.push({
        key: `e${e.id}`,
        serviceRequestId: t.id,
        noTiket: t.noTiket,
        statusTiket: t.status,
        unitId: t.unitAsset.id,
        serial: (t.unitAsset.serialNumber ?? '').trim(),
        model: t.unitAsset.modelUnit ?? '-',
        tokoNama: t.unitAsset.toko?.namaToko ?? undefined,
        kodePart: e.kodePart,
        namaPart: e.namaPart,
        qty: e.qty,
        emailPartId: e.id,
        sudahReady: false,
      })
    }
  }
  return kandidat
}

// ===== Aturan deterministik → satu baris surat jalan =====
function cocokkanBaris(row: BarisSuratJalan, kandidat: Kandidat[]): HasilBaris {
  const kodeN = NORM(row.kodePart)
  const snN = row.serialNumber ? NORM(row.serialNumber).replace(/^0+/, '') || NORM(row.serialNumber) : ''
  let usul: { cand: Kandidat; skor: number }[] = []
  for (const c of kandidat) {
    let skor = 0
    if (kodeN && NORM(c.kodePart) === kodeN) skor += 60
    if (snN && c.serial && (NORM(c.serial) === NORM(row.serialNumber ?? '') || NORM(c.serial).replace(/^0+/, '') === snN)) skor += 30
    if (row.namaPart) skor += Math.round(similarity(row.namaPart, c.namaPart) * 10)
    if (skor > 0) usul.push({ cand: c, skor })
  }
  usul = usul.sort((a, b) => b.skor - a.skor)
  const puncak = usul[0]
  if (puncak && puncak.skor >= 60) {
    const seri = usul.filter((u) => u.skor === puncak.skor)
    if (seri.length === 1) {
      return { ...row, statusMatch: 'COCOK', cocokKandidat: puncak.cand, opsi: [], keterangan: `Cocok dengan tiket ${puncak.cand.noTiket} (unit ${puncak.cand.serial || puncak.cand.model})` }
    }
    return { ...row, statusMatch: 'TANPA_TIKET', opsi: seri.map((u) => u.cand), keterangan: `${seri.length} tiket sama-sama cocok — pilih salah satu` }
  }
  // Tanpa kesamaan kode: bila SN persis mengarah ke 1 unit & nama mirip → kandidat lemah
  if (puncak && snN && puncak.skor >= 80) {
    return { ...row, statusMatch: 'COCOK', cocokKandidat: puncak.cand, opsi: [], keterangan: `SN unit cocok — part ${puncak.cand.kodePart} di ${puncak.cand.noTiket}` }
  }
  return {
    ...row,
    statusMatch: 'TANPA_TIKET',
    opsi: usul.slice(0, 5).map((u) => u.cand),
    keterangan: 'Tidak ada part diorder produsen yang cocok (kode/nama/SN)',
  }
}

export function cocokkan(rows: BarisSuratJalan[], kandidat: Kandidat[]): HasilBaris[] {
  return rows.map((r) => cocokkanBaris(r, kandidat))
}

// ===== Parser Excel/CSV (SheetJS) — kolom via alias fleksibel =====
const DAFTAR_ALIAS = {
  kodePart: ['kodepart', 'kode', 'partno', 'nomorpart', 'partnumber', 'kodebarang', 'kodesparepart', 'kdpart'],
  namaPart: ['namapart', 'nama', 'namaproduk', 'deskripsi', 'item', 'produk', 'namabarang', 'partname'],
  qty: ['qty', 'jumlah', 'pcs', 'roll', 'quantity'],
  serialNumber: ['sn', 'serialnumber', 'serial', 'nomorseri', 'noseri', 'barcode', 'barcodeunit', 'unit'],
  noSuratJalan: ['nosuratjalan', 'nosj', 'no sj'.replace(/\s/g, ''), 'suratjalan', 'nosurat'],
  tanggalSurat: ['tglsurat', 'tanggal', 'tgl', 'tanggaljalan', 'date'],
  produsen: ['produsen', 'supplier', 'pengirim', 'brand'],
}

function mapDariHeader(keys: string[]): Record<string, string> {
  const out: Record<string, string> = {}
  keys.forEach((k, idx) => {
    const kn = NORM(String(k))
    if (!kn) return
    for (const [field, alias] of Object.entries(DAFTAR_ALIAS)) {
      const daftar = (alias as string[]).map(NORM)
      // simpan NAMA HEADER asli (sheet_to_json memakai header sbg key baris)
      if (daftar.includes(kn)) { out[field] = out[field] || String(keys[idx]); break }
    }
  })
  return out
}

export interface HasilTabsheet {
  rows: BarisSuratJalan[]
  noSuratJalan?: string
  tglSurat: Date | null
  produsen: string | null
  terlewati: number
}

export function parseTabsheet(buffer: Buffer): HasilTabsheet {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true })
  if (!wb.SheetNames.length) throw new Error('File Excel/CSV tidak memiliki sheet')
  // Cari sheet pertama yang berisi data part (≥1 baris dgn kolom kode)
  let rowsRaw: Record<string, unknown>[] = []
  let map: Record<string, string> = {}
  for (const nama of wb.SheetNames) {
    const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[nama], { defval: '' })
    map = mapDariHeader(json.length ? Object.keys(json[0]) : [])
    if (map.kodePart) { rowsRaw = json; break }
  }
  if (!rowsRaw.length) {
    throw new Error('Kolom kode part tidak terbaca — pastikan header Excel berisi "kode" (dan "nama"/"qty"/"sn" bila ada)')
  }

  const rows: BarisSuratJalan[] = []
  let terlewati = 0
  let noSuratJalan: string | undefined
  let tglSurat: Date | null = null
  let produsen: string | null = null

  const ambilTanggal = (v: unknown): Date | null => {
    if (v instanceof Date && !Number.isNaN(v.getTime())) return v
    if (typeof v === 'string') {
      const s = v.trim().replace(/(\d{1,2})[/.](\d{1,2})[/.](\d{4})/, '$3-$2-$1')
      const d = new Date(s)
      return Number.isNaN(d.getTime()) ? null : d
    }
    return null
  }

  for (const r of rowsRaw) {
    const get = (field: string) => (map[field] !== undefined ? r[map[field]] : undefined)
    const kode = String(get('kodePart') ?? '').trim()
    if (!kode) { terlewati++; continue }
    const qtyN = Number(get('qty'))
    rows.push({
      kodePart: kode,
      namaPart: String(get('namaPart') ?? '').trim() || undefined,
      qty: Number.isFinite(qtyN) && qtyN > 0 ? Math.floor(qtyN) : 1,
      serialNumber: String(get('serialNumber') ?? '').trim() || undefined,
    })
    if (!noSuratJalan) {
      const nsj = String(get('noSuratJalan') ?? '').trim()
      if (nsj) noSuratJalan = nsj
    }
    if (!tglSurat) tglSurat = ambilTanggal(get('tanggalSurat'))
    if (!produsen) {
      const prd = String(get('produsen') ?? '').trim()
      if (prd) produsen = prd
    }
  }
  if (!rows.length) throw new Error('Tidak ada baris part ditemukan di file (kolom "kode" kosong semua)')
  return { rows, noSuratJalan, tglSurat, produsen, terlewati }
}

// ===== Efek commit: part → READY dst =====
export async function terapkanCocok(
  hasil: HasilBaris[],
  meta: { noSuratJalan: string; tglSurat: Date | null; produsen: string | null; namaFile?: string; aktor: string }
): Promise<RingkasanSuratJalan> {
  const cocok = hasil.filter((h) => h.statusMatch === 'COCOK' && h.cocokKandidat)
  const tanpaTiket = hasil.length - cocok.length
  const gridDate = meta.tglSurat ?? new Date()

  // 1) Rekam header + item surat jalan
  const sj = await db.suratJalanMasuk.create({
    data: {
      noSuratJalan: meta.noSuratJalan,
      tglSurat: meta.tglSurat,
      produsen: meta.produsen,
      namaFile: meta.namaFile,
      totalItem: hasil.length,
      cocokCount: cocok.length,
      tanpaTiket,
      createdBy: meta.aktor,
      items: {
        create: hasil.map((h) => ({
          kodePart: h.kodePart,
          namaPart: h.namaPart ?? null,
          qty: h.qty,
          serialNumber: h.serialNumber ?? null,
          statusMatch: h.statusMatch,
          cocokTipe: h.cocokKandidat?.emailPartId ? 'TIKET_EMAIL' : h.cocokKandidat ? 'TIKET_PART' : h.serialNumber ? 'UNIT_TANPA_PART' : null,
          cocokTiketId: h.cocokKandidat?.serviceRequestId ?? null,
          cocokUnitId: h.cocokKandidat?.unitId ?? null,
          cocokPartId: h.cocokKandidat?.partId ?? null,
          alasan: h.keterangan,
        })),
      },
    },
  })

  // 2) Efek per kandidat: part tiket → READY, item email → DATANG, tiket di-catat,
  //    dan (bila part belum pernah diinput) baris part DIBUAT langsung di tiket.
  const tiketKena = new Set<number>()
  for (const h of cocok) {
    const c = h.cocokKandidat!
    tiketKena.add(c.serviceRequestId)
    let partId = c.partId
    if (c.unitPartId) {
      await db.serviceRequestPart.update({
        where: { id: c.unitPartId },
        data: { statusPart: 'READY', statusKonfirmasi: 'READY', sumberPart: 'PRODUSEN' },
      })
    } else if (!partId) {
      // Baris email belum pernah diinput manual → cari di katalog & buat baris part.
      const ms = await db.masterSparepart.findFirst({ where: { kodePart: c.kodePart } })
      if (ms) {
        partId = ms.id
        await db.serviceRequestPart.create({
          data: {
            serviceRequestId: c.serviceRequestId,
            sparepartId: ms.id,
            qty: c.qty,
            statusPart: 'READY',
            statusKonfirmasi: 'READY',
            sumberPart: 'PRODUSEN',
          },
        })
      }
    }
    if (c.emailPartId) {
      await db.orderEmailPart.update({ where: { id: c.emailPartId }, data: { status: 'DATANG' } })
    }
    await db.serviceRequest.update({
      where: { id: c.serviceRequestId },
      data: { noSuratJalanProdusen: meta.noSuratJalan, tglPartDatang: gridDate },
    })
  }

  // 3) Tiket yang part-nya lengkap READY otomatis naik ke PROSES (alur tanpa menekan "part datang")
  let naikProses = 0
  for (const id of tiketKena) {
    const t = await db.serviceRequest.findFirst({
      where: { id, status: { in: ['REQUEST', 'REQUEST_EMAIL'] } },
      select: { id: true, noTiket: true, parts: { select: { statusPart: true } } },
    })
    if (!t) continue
    const parts = t.parts
    if (parts.length > 0 && parts.every((p) => p.statusPart === 'READY')) {
      await db.serviceRequest.update({ where: { id: t.id }, data: { status: 'PROSES' } })
      naikProses++
    }
  }

  return { noSuratJalan: meta.noSuratJalan, tglSurat: meta.tglSurat, produsen: meta.produsen, totalItem: hasil.length, cocokCount: cocok.length, tanpaTiket, naikProses }
}
