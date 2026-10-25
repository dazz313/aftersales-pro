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
  yakin?: number // keyakinan AI 0-100 bila dibantu AI
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
export function similarity(a: string, b: string): number {
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
// Kepala tabel dicari di ±30 baris pertama sehingga file surat jalan produsen
// dengan judul/logo di atas tabel tetap terbaca. Nama kolom di-NORM-kan
// (huruf besar, tanpa spasi/tanda baca) lalu dicocokkan ke alias berikut.
// DAFTAR_ALIAS & cariBarisHeader diekspor — dipakai ulang parser teks (PDF/OCR)
// di src/lib/surat-jalan-teks.ts supaya alias kolom selalu seragam.
export const DAFTAR_ALIAS = {
  kodePart: ['kodepart', 'kode', 'partno', 'nomorpart', 'partnumber', 'kodebarang', 'kodesparepart', 'kdpart', 'nopart', 'kodeitem', 'itemcode', 'material'],
  namaPart: ['namapart', 'nama', 'namaproduk', 'deskripsi', 'item', 'produk', 'namabarang', 'partname', 'namasparepart', 'namaitem'],
  qty: ['qty', 'jumlah', 'pcs', 'roll', 'quantity'],
  serialNumber: ['sn', 'serialnumber', 'serial', 'nomorseri', 'noseri', 'barcode', 'barcodeunit', 'unit', 'snunit', 'serialunit', 'nosn'],
  noSuratJalan: ['nosuratjalan', 'nosj', 'no sj'.replace(/\s/g, ''), 'suratjalan', 'nosurat'],
  tanggalSurat: ['tglsurat', 'tanggal', 'tgl', 'tanggaljalan', 'date'],
  produsen: ['produsen', 'supplier', 'pengirim', 'brand'],
}

/**
 * Cari baris kepala tabel (header) di matriks sheet (array-of-array): baris
 * pertama yang salah satu selnya = alias kolom kode part. Kembalikan index
 * baris + pemetaan KOLOM INDEKS → FIELD untuk semua alias di baris itu.
 */
export function cariBarisHeader(matriks: unknown[][]): { idx: number; map: Map<number, string> } | null {
  for (let i = 0; i < Math.min(matriks.length, 30); i++) {
    const baris = matriks[i] ?? []
    const map = new Map<number, string>()
    baris.forEach((sel, kol) => {
      const kn = NORM(String(sel))
      if (!kn) return
      for (const [field, alias] of Object.entries(DAFTAR_ALIAS)) {
        if ((alias as string[]).map(NORM).includes(kn)) { map.set(kol, map.get(kol) ?? field); break }
      }
    })
    if (Array.from(map.values()).includes('kodePart')) return { idx: i, map }
  }
  return null
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
  // Cari sheet pertama yang punya baris kepala tabel berkolom kode part
  // (kepala boleh bukan baris ke-1 — file produsen sering ada judul/logo di atasnya).
  let matriks: unknown[][] = []
  let kepalaIdx = 0
  let map: Map<number, string> = new Map()
  for (const nama of wb.SheetNames) {
    const raw = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[nama], { header: 1, defval: '' })
    const kepala = cariBarisHeader(raw)
    if (kepala) { matriks = raw; kepalaIdx = kepala.idx; map = kepala.map; break }
  }
  if (!matriks.length) {
    throw new Error('Kolom kode part tidak terbaca — pastikan ada baris berisi judul kolom (cth "KODE PART / NAMA PART / QTY / SN UNIT") di ±30 baris pertama, atau unduh Templat Excel di dialog dan isi menurut formatnya')
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

  // Item = baris SETELAH baris kepala tabel (judul/logo/dsb. di atas kepala dilewati).
  for (const r of matriks.slice(kepalaIdx + 1)) {
    const get = (field: string) => {
      for (const [kol, f] of map) if (f === field) return r[kol] ?? undefined
      return undefined
    }
    const kode = String(get('kodePart') ?? '').trim()
    const punyaSerpih = (r as unknown[]).some((s) => String(s ?? '').trim() !== '')
    if (!kode || !punyaSerpih) { if (punyaSerpih) terlewati++; continue }
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

// ===== CEK BERLAPIS — validasi draft (TIDAK menulis efek apa pun) =====
// Lapisan 1: header (duplikat nomor) · Lapisan 2: tiap baris (tiket aktif,
// penerimaan ganda, status email, baris part tiket, SN unit, katalog).
export interface MasalahCek {
  tingkat: 'OK' | 'INFO' | 'PERINGATAN' | 'BLOKIR'
  itemId?: number
  kode?: string
  pesan: string
}
export interface HasilCekDraft {
  items: MasalahCek[]
  header: MasalahCek[]
  blokir: number
  peringatan: number
  info: number
  bisaTerapkan: boolean
}

export async function cekDraft(sjId: number): Promise<HasilCekDraft> {
  const sj = await db.suratJalanMasuk.findUnique({ where: { id: sjId }, include: { items: { orderBy: { id: 'asc' } } } })
  if (!sj) throw new Error('Draft surat jalan tidak ditemukan')
  const header: MasalahCek[] = []
  const hasilItem: MasalahCek[] = []

  // --- Lapisan 1: duplikat nomor surat jalan
  const kembar = await db.suratJalanMasuk.findMany({
    where: { noSuratJalan: sj.noSuratJalan, id: { not: sj.id } },
    select: { id: true, status: true },
  })
  const kembarTerapkan = kembar.filter((k) => k.status === 'DITERAPKAN')
  if (kembarTerapkan.length > 0) header.push({ tingkat: 'BLOKIR', pesan: `Nomor surat jalan sudah dipakai surat jalan yang DITERAPKAN — ganti nomor` })
  else if (kembar.length > 0) header.push({ tingkat: 'PERINGATAN', pesan: `Nomor surat jalan sama dipakai ${kembar.length} draft lain — rawan diterima dua kali` })

  // --- Bahan cek per baris
  const tiketIds = [...new Set(sj.items.filter((i) => i.cocokTiketId != null).map((i) => i.cocokTiketId as number))]
  const tiketList = tiketIds.length
    ? await db.serviceRequest.findMany({
        where: { id: { in: tiketIds } },
        include: {
          parts: { include: { sparepart: { select: { id: true, kodePart: true } } } },
          unitAsset: { select: { id: true, serialNumber: true, modelUnit: true } },
        },
      })
    : []
  const tiketMap = new Map(tiketList.map((t) => [t.id, t]))
  const oepList = tiketIds.length ? await db.orderEmailPart.findMany({ where: { serviceRequestId: { in: tiketIds } } }) : []
  const oepByTiket = new Map<number, typeof oepList>()
  for (const o of oepList) {
    if (o.serviceRequestId == null) continue
    const arr = oepByTiket.get(o.serviceRequestId) ?? []
    arr.push(o)
    oepByTiket.set(o.serviceRequestId, arr)
  }
  const katalog = await db.masterSparepart.findMany({ select: { id: true, kodePart: true } })
  const katalogSet = new Set(katalog.map((k) => NORM(k.kodePart)))
  const unitList = await db.unitAsset.findMany({ select: { id: true, serialNumber: true } })
  const unitMap = new Map(unitList.filter((u) => u.serialNumber).map((u) => [NORM(u.serialNumber as string), u.id]))
  const sjsLain = await db.suratJalanMasuk.findMany({
    where: { id: { not: sj.id }, status: { in: ['DRAFT', 'DIPERIKSA', 'DITERAPKAN'] } },
    select: { noSuratJalan: true, status: true, items: { select: { cocokTiketId: true, kodePart: true } } },
  })

  // Petunjuk cek ulang aturan untuk baris TANPA tiket (kandidat baru bisa muncul kapan pun)
  const fresh = cocokkan(
    sj.items.map((i) => ({ kodePart: i.kodePart, namaPart: i.namaPart ?? undefined, qty: i.qty, serialNumber: i.serialNumber ?? undefined })),
    await ambilKandidat()
  )

  let blokir = 0
  let peringatan = 0
  let info = 0
  sj.items.forEach((it, idx) => {
    const t = it.cocokTiketId != null ? tiketMap.get(it.cocokTiketId) : undefined
    const dorong = (tingkat: MasalahCek['tingkat'], pesan: string) => {
      hasilItem.push({ tingkat, itemId: it.id, kode: it.kodePart, pesan })
      if (tingkat === 'BLOKIR') blokir++
      else if (tingkat === 'PERINGATAN') peringatan++
      else if (tingkat === 'INFO') info++
    }
    if (it.statusMatch === 'COCOK' && t) {
      if (t.status === 'FINISH' || t.status === 'BATAL') { dorong('BLOKIR', `Tiket ${t.noTiket} sudah ${t.status} — lepas baris ini atau pilih tiket lain`); return }
      // Penerimaan ganda via surat jalan lain
      const dobelLain = sjsLain.filter((s) =>
        s.items.some((li) => li.cocokTiketId === t.id && NORM(li.kodePart) === NORM(it.kodePart))
      )
      if (dobelLain.some((s) => s.status === 'DITERAPKAN')) { dorong('BLOKIR', `Part pernah diterima via surat jalan ${dobelLain.find((s) => s.status === 'DITERAPKAN')!.noSuratJalan} — lepaskan baris ini`); return }
      const oep = (oepByTiket.get(t.id) ?? []).find((o) => NORM(o.kodePart) === NORM(it.kodePart))
      if (oep && (oep.status === 'DATANG' || oep.status === 'SELESAI')) { dorong('BLOKIR', 'Item email sudah ditandai DATANG sebelumnya — indikasi diterima dua kali'); return }
      if (dobelLain.length > 0) { dorong('PERINGATAN', `${dobelLain.length} draft lain juga mencatat part ini untuk tiket ${t.noTiket}`) }
      const srp = t.parts.find((p) => NORM(p.sparepart.kodePart) === NORM(it.kodePart) && p.statusPart === 'ORDER_PRODUSEN')
      if (srp?.statusKonfirmasi === 'READY') { dorong('PERINGATAN', `Part di ${t.noTiket} sudah READY (pernah dikonfirmasi) — diterapkan akan mengulang tandai`) }
      else if (!srp) { dorong('PERINGATAN', `Baris part ${it.kodePart} tidak (lagi) ada dlm ORDER_PRODUSEN tiket ${t.noTiket} — bila kode ada di katalog, baris part baru dibuat otomatis`) }
      if (it.serialNumber) {
        const unitId = unitMap.get(NORM(it.serialNumber))
        if (unitId == null) dorong('PERINGATAN', `SN ${it.serialNumber} tidak dikenal di unit asset`)
        else if (t.unitAsset.id !== unitId) dorong('PERINGATAN', `SN ${it.serialNumber} milik unit lain — tiket ${t.noTiket} milik unit ${t.unitAsset.serialNumber || t.unitAsset.modelUnit}`)
      }
      if (!katalogSet.has(NORM(it.kodePart)) && !srp) { dorong('INFO', `Kode ${it.kodePart} tidak ada di katalog — baris part tiket tidak dapat dibuat otomatis`) }
      dorong('OK', `Siap: ${srp ? 'part tiket di-update READY' : 'part dibuat baru'}${oep ? ' + item email DATANG' : ''} di ${t.noTiket}`)
      return
    }
    if (it.statusMatch === 'COCOK') { dorong('PERINGATAN', 'Berlabel COCOK tanpa tiket tujuan — akan diterapkan tanpa efek tiket'); return }
    // TANPA tiket: petunjuk cek ulang
    if (it.serialNumber && !unitMap.has(NORM(it.serialNumber))) dorong('PERINGATAN', `SN ${it.serialNumber} tidak dikenal di unit asset`)
    if (!katalogSet.has(NORM(it.kodePart))) dorong('INFO', `Kode ${it.kodePart} tidak ada di katalog (part tak dikenal)`)
    const pernahTerima = sjsLain.filter((s) => s.status === 'DITERAPKAN' && s.items.some((li) => NORM(li.kodePart) === NORM(it.kodePart)))
    if (pernahTerima.length > 0) {
      dorong('PERINGATAN', `Kode ini pernah diterima lewat ${[...new Set(pernahTerima.map((s) => s.noSuratJalan))].join(', ')} — pastikan bukan dokumen ganda`)
    }
    const f = fresh[idx]
    if (f && f.statusMatch === 'COCOK' && f.cocokKandidat) {
      dorong('INFO', `Cek ulang menemukan kandidat baru: ${f.cocokKandidat.noTiket} (${f.cocokKandidat.serial || f.cocokKandidat.model}) — pilih lewat dropdown`)
    } else if (hasilItem.every((m) => m.itemId !== it.id)) {
      dorong('OK', 'Terpakai sebagai catatan menerima barang (tanpa efek tiket)')
    }
  })

  return { items: hasilItem, header, blokir, peringatan, info, bisaTerapkan: blokir === 0 }
}

// ===== TERAPKAN PERMANEN — dipanggil HANYA setelah cek akhir bersih =====
export interface RingkasanTerapkan {
  noSuratJalan: string
  totalItem: number
  cocokCount: number
  tanpaTiket: number
  naikProses: number
}

export async function terapkanDariDb(sjId: number, aktor: string): Promise<RingkasanTerapkan> {
  const sj = await db.suratJalanMasuk.findUnique({ where: { id: sjId }, include: { items: { orderBy: { id: 'asc' } } } })
  if (!sj) throw new Error('Draft surat jalan tidak ditemukan')
  if (sj.status === 'DITERAPKAN') throw new Error('Surat jalan sudah diterapkan — tidak dapat diulang')
  // Pertahanan terakhir di server: cek ulang wajib bersih.
  const cek = await cekDraft(sjId)
  if (!cek.bisaTerapkan) throw new Error(`Cek akhir menemukan ${cek.blokir} masalah blokir — perbaiki dulu sebelum menerapkan`)

  const gridDate = sj.tglSurat ?? new Date()
  const tiketKena = new Set<number>()
  let naikProses = 0

  for (const it of sj.items.filter((i) => i.statusMatch === 'COCOK' && i.cocokTiketId != null)) {
    const tiketId = it.cocokTiketId as number
    tiketKena.add(tiketId)
    await db.serviceRequest.update({
      where: { id: tiketId },
      data: { noSuratJalanProdusen: sj.noSuratJalan, tglPartDatang: gridDate },
    })
    const tiket = await db.serviceRequest.findUnique({
      where: { id: tiketId },
      include: { parts: { include: { sparepart: { select: { id: true, kodePart: true } } } } },
    })
    const srp = tiket?.parts.find((p) => NORM(p.sparepart.kodePart) === NORM(it.kodePart))
    if (srp) {
      await db.serviceRequestPart.update({
        where: { id: srp.id },
        data: { statusPart: 'READY', statusKonfirmasi: 'READY', sumberPart: 'PRODUSEN' },
      })
      if (!it.cocokPartId) {
        await db.suratJalanMasukItem.update({ where: { id: it.id }, data: { cocokPartId: srp.sparepart.id } })
      }
    } else {
      // Part belum pernah diinput di tiket — buat otomatis bila ada di katalog.
      const katalogPasukan = await db.masterSparepart.findMany({ select: { id: true, kodePart: true } })
      const msNorm = katalogPasukan.find((m) => NORM(m.kodePart) === NORM(it.kodePart))
      if (msNorm) {
        await db.serviceRequestPart.create({
          data: {
            serviceRequestId: tiketId,
            sparepartId: msNorm.id,
            qty: it.qty,
            statusPart: 'READY',
            statusKonfirmasi: 'READY',
            sumberPart: 'PRODUSEN',
          },
        })
        await db.suratJalanMasukItem.update({ where: { id: it.id }, data: { cocokPartId: msNorm.id } })
      }
    }
    const oep = (await db.orderEmailPart.findMany({ where: { serviceRequestId: tiketId } })).find(
      (o) => NORM(o.kodePart) === NORM(it.kodePart)
    )
    if (oep && (oep.status === 'PENDING' || oep.status === 'TERKIRIM')) {
      await db.orderEmailPart.update({ where: { id: oep.id }, data: { status: 'DATANG' } })
    }
  }

  // Tiket yang part-nya seluruh READY naik ke PROSES
  for (const id of tiketKena) {
    const t = await db.serviceRequest.findFirst({
      where: { id, status: { in: ['REQUEST', 'REQUEST_EMAIL'] } },
      select: { id: true, parts: { select: { statusPart: true } } },
    })
    if (!t) continue
    if (t.parts.length > 0 && t.parts.every((p) => p.statusPart === 'READY')) {
      await db.serviceRequest.update({ where: { id: t.id }, data: { status: 'PROSES' } })
      naikProses++
    }
  }

  const cocok = sj.items.filter((i) => i.statusMatch === 'COCOK').length
  await db.suratJalanMasuk.update({
    where: { id: sj.id },
    data: {
      status: 'DITERAPKAN',
      diterapkanAt: new Date(),
      diterapkanOleh: aktor,
      cocokCount: cocok,
      tanpaTiket: sj.items.length - cocok,
      totalItem: sj.items.length,
    },
  })

  return { noSuratJalan: sj.noSuratJalan, totalItem: sj.items.length, cocokCount: cocok, tanpaTiket: sj.items.length - cocok, naikProses }
}
