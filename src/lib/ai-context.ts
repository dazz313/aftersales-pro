/**
 * Konteks dinamis untuk AI (modul Analisa AI) — membungkus ringkasan
 * pergerakan kondisi aplikasi dari database supaya AI (chat & analisa) bisa
 * "melihat" situasi operasional sebelum memberi saran/jawaban.
 *
 * - operasional: ringkasan KPI tiket/klaim/stok/kunjungan + tiket belum
 *   diproses terbanyak (sudah divalidasi di /api/dashboard + analisa AI).
 * - audit: riwayat audit terbaru (untuk troubleshooting perubahan data).
 *
 * Semua best-effort: bila query gagal, nilainya null dan AI tetap bisa
 * berbicara (tanpa konteks) — tidak menggugurkan fitur chat/analisa.
 */
import { db } from '@/lib/db'

/**
 * Pengetahuan sistem (statis) — deskripsi cara kerja aplikasi, modul, alur,
 * status, tabel database, dan kode produk/sparepart. Dikirim ke AI di setiap
 * chat agar AI memahami sistem & bisa menjelaskan cara kerja aplikasi.
 */
export const PENGETAHUAN_SISTEM = `PENGETAHUAN SISTEM AFTERSALES PRO (baca sebelum menjawab):

Aplikasi web AfterSales Pro — otomasi after-sales & inventory sparepart antara Workshop dan Produsen. Single-route (semua view di "/"), navigasi internal. Database SQLite (Prisma). Multi-user dengan role: ADMIN_WORKSHOP, TEKNISI, MANAGER, PRODUSEN.

MODUL/VIEW:
- Dashboard KPI: monitoring, alert engine, akses cepat.
- Master Data: Toko (MasterToko), Customer (MasterCustomer), Unit Asset (UnitAsset), Karyawan (Pengguna).
- Proses Service: tiket service (ServiceRequest) + part (ServiceRequestPart). Workflow REQUEST → PROSES → FINISH.
- Field Ops: kunjungan toko, scan barcode toko/unit.
- Stok Inventory: sparepart titipan produsen (MasterSparepart) dengan stok jual/garansi/total.
- Klaim & Rekap: klaim produsen (DRAFT/SUBMITTED/PAID), export Excel.
- Nota Servis BASS: nota service center.
- Lacak Sparepart: cari part dari riwayat kerusakan + AI.
- Komunikasi: MiniChat & Notes antar akun.
- Analisa AI: ringkasan operasional + chat AI.
- Inbox: penampungan data Telegram.
- Pengaturan: profil, gateway WA/Telegram, AI (9router), backup Google Sheets, audit log.

ALUR SERVICE:
- ServiceRequest.status: REQUEST (baru) → PROSES (sedang dikerjakan) → FINISH (selesai).
- sumberLaporan: KUNJUNGAN | LAPORAN_TOKO | LAPORAN_CUSTOMER | WA_BOT | MANUAL.
- tipeCustomer: TOKO (stok toko → otomatis garansi) | PERORANGAN.
- lokasiUnit: TOKO (unit di toko) | WORKSHOP (ditarik via STTB).
- penanganan: BELUM | TUNGGU_PART_TOKO | DI_TOKO | TARIK_WORKSHOP.
- statusKlaimProdusen: DRAFT | SUBMITTED | PAID.
- slaFlag: true bila melewati SLA 24 jam (REQUEST).
- ServiceRequestPart.statusPart: READY (part ada di gudang) | ORDER_PRODUSEN (harus dipesan ke produsen).
- ServiceRequestPart.statusKonfirmasi: MENUNGGU | READY | TIDAK_READY (jawaban produsen via WA).
- sumberPart: KATALOG | PRODUSEN.

STOK SPAREPART:
- MasterSparepart: stokJual (bisa dijual) + stokGaransi (stok garansi/klaim) = stokInventory (total). totalTerpakai (pemakaian per unit, tidak menyentuh stok brand). reorderLimit (ROP). hargaKlaim (nilai klaim per unit ke produsen). brandKompatibel (brand kompatibel, koma). supplier.
- Stok brand hanya bergerak saat stok masuk/keluar gudang. Part ORDER khusus unit dicatat di totalTerpakai.

UNIT ASSET:
- UnitAsset: serialNumber, modelUnit, merk, nama, kerusakanAwal, tokoId/customerId, statusGaransi (STOK_TOKO/GARANSI/NON_GARANSI), tglPembelian.
- QR stiker: SN:[serial]|MOD:[model]|TOK:[toko/customer]|NAMA:[nama produk].

TOKO:
- MasterToko: kodeToko (TOK-xxx), namaToko, alamat, kontak, frekuensiVisit, modeSiklus (REGULER/BY_REQUEST), tglVisitTerakhir, aktif, barcodeToko, latitude/longitude, jarakKm.
- Kunjungan: teknisi check-in ke toko (SCAN_BARCODE/MANUAL), fotoOnsite, catatanStokRusak.

KLAIM:
- Tiket FINISH dengan statusKlaimProdusen DRAFT → klaim produsen pending. Nilai = biayaJasa + sum(part.qty * hargaKlaim). Status SUBMITTED (diajukan) → PAID (dibayar).

AUDIT & BACKUP:
- AuditLog: aksi, entitas, entitasId, deskripsi, aktor, createdAt.
- BackupLog: status (SUCCESS/LOCAL/FAILED), trigger (MANUAL/AUTO), sheetsWritten, rowsTotal, tabel, message.
- Backup otomatis ke Google Spreadsheet (tanpa Nextcloud). Watcher jalan di background.

INBOX TELEGRAM:
- InboxItem: penampungan data/foto Telegram sebelum diteruskan. status PENDING/APPROVED/REJECTED/ARCHIVED. folder KUNJUNGAN/SERVICE.

NOTIFIKASI:
- Notifikasi: REGISTRASI_UNIT / TIKET_BARU, untukRole (null=semua). NotifikasiBaca per pengguna.

NOTA BASS:
- Nota service center dengan item (kode, nama, harga, qty), biaya service/transportasi, PPN, tanda tangan.

KODE PRODUK / SPAREPART:
- MasterSparepart.kodePart (unique) — kode sparepart utama.
- BankKode — registry semua kode part yang pernah masuk (katalog, balasan produsen, order customer, CSV). sumber: KATALOG/PRODUSEN/WORKSHOP/CSV/MANUAL/SINKRON. Berisi kode, namaPart, brandKompatibel, modelTipe, produsen, catatan.
- PermintaanOrder: order sparepart dari customer (BARU/DITERUSKAN/DATANG/SELESAI/BATAL).

SURAT JALAN:
- SuratJalanMasuk: penerimaan part dari produsen (DRAFT→DIPERIKSA→DITERAPKAN). Cocokkan kode/nama/SN ke tiket & unit.
- SuratJalanRequest: request part ke produsen (SJR-YYYYMMDD-NNNN), snapshot tiket+part.

AI & 9ROUTER:
- AI gateway: 9router di mesin ini (port 20128). Providers aktif: kiro + openrouter. App AI config dari Pengaturan (ai_base_url, ai_model, ai_api_key). Default base URL http://127.0.0.1:20128/v1. Model utama openrouter/openai/gpt-4o-mini, fallback kr/claude-haiku-4.5.
- AI membaca konteks operasional + audit + on-demand lookup (toko/unit/tiket/stok/sparepart/kode).

DATABASE: SQLite (Prisma). Tabel utama: Pengguna, MasterToko, MasterCustomer, MasterSparepart, UnitAsset, Kunjungan, ServiceRequest, ServiceRequestPart, PermintaanOrder, AuditLog, BackupLog, Pengaturan, BankKode, VisionScan, InboxItem, SuratJalanMasuk(+Item), SuratJalanRequest(+Item), Notifikasi(+Baca), Nota(+Item), ChatPesan, Catatan(+Balasan), WaMessage, OrderEmailPart.

ATURAN JAWAB:
- Gunakan data konteks yang diberikan (KONDISI APLIKASI / DATA RELEVAN). Sebutkan kode toko, nomor tiket, SN, model, jumlah, status part. Jangan katakan "tidak ada informasi" bila datanya ada di konteks; baru katakan tidak ditemukan bila memang tidak tercantum.
- Jika ditanya cara kerja fitur/modul, jelaskan berdasarkan PENGETAHUAN SISTEM di atas.
- Jika ditanya kode produk/sparepart, cari di DATA RELEVAN (MasterSparepart/BankKode) dan sebutkan kode, nama, brand, stok, supplier, model tipe, produsen.`

export interface KonteksAi {
  dibangunPada: string
  operasional: string | null
  audit: string | null
  sistem: string
}

export async function kumpulkanKonteksAudit(max = 20): Promise<string | null> {
  try {
    const rows = await db.auditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: max,
      select: { aksi: true, entitas: true, deskripsi: true, aktor: true, createdAt: true },
    })
    if (rows.length === 0) return null
    const baris = rows
      .map((r) => `- [${new Date(r.createdAt).toLocaleString('id-ID')}] ${r.aksi} — ${r.deskripsi} (aktor: ${r.aktor ?? '-'})`)
      .join('\n')
    return `RIWAYAT AUDIT TERBARU (${rows.length} entri):\n${baris}`
  } catch (e) {
    console.error('AI context audit gagal:', e)
    return null
  }
}

export async function kumpulkanKonteksOperasional(): Promise<string | null> {
  try {
    const [cReq, cPro, cFin, sla, claims, spareparts, tiketAktif, daftarToko, kunjungan7] = await Promise.all([
      db.serviceRequest.count({ where: { status: 'REQUEST' } }),
      db.serviceRequest.count({ where: { status: 'PROSES' } }),
      db.serviceRequest.count({ where: { status: 'FINISH' } }),
      db.serviceRequest.count({ where: { status: 'REQUEST', slaFlag: true } }),
      db.serviceRequest.findMany({
        where: { status: 'FINISH', statusKlaimProdusen: 'DRAFT' },
        include: { parts: { include: { sparepart: true } }, unitAsset: true },
        orderBy: { tglFinish: 'desc' },
        take: 10,
      }),
      db.masterSparepart.findMany(),
      db.serviceRequest.findMany({
        where: { status: 'REQUEST' },
        include: {
          parts: { include: { sparepart: true } },
          unitAsset: { include: { toko: true } },
        },
      }),
      db.masterToko.findMany({
        where: { aktif: true },
        select: { kodeToko: true, namaToko: true, modeSiklus: true, tglVisitTerakhir: true, frekuensiVisit: true },
      }),
      db.kunjungan.count({ where: { tglKunjungan: { gte: new Date(Date.now() - 7 * 24 * 3600 * 1000) } } }),
    ])

    // Total estimasi dana klaim tertahan (jasa + part)
    const totalKlaimPending = claims.reduce((acc, t) => {
      const partValue = t.parts.reduce((a, p) => a + (p.sparepart?.hargaKlaim ?? 0) * p.qty, 0)
      return acc + t.biayaJasa + partValue
    }, 0)

    // Belum diproses: tiket REQUEST tanpa part READY — urut tertua dulu.
    const belumProsesSemua = tiketAktif
      .filter((t) => !t.parts.some((p) => p.statusPart === 'READY'))
      .sort((a, b) => new Date(a.tglTiket).getTime() - new Date(b.tglTiket).getTime())
    const belumProses = belumProsesSemua.slice(0, 3).map(
      (t) =>
        `${t.noTiket} | SN ${t.unitAsset?.serialNumber ?? '-'} | ${t.unitAsset?.modelUnit ?? '-'} | ${t.unitAsset?.toko ? `${t.unitAsset.toko.kodeToko} — ${t.unitAsset.toko.namaToko}` : 'Perorangan'} | part: ${t.parts.length} item`
    )

    const stokKritis = spareparts.filter((s) => s.stokInventory <= s.reorderLimit)
    const stokKosong = spareparts.filter((s) => s.stokInventory === 0)

    const [unitTotal, unitStatus] = await Promise.all([
      db.unitAsset.count(),
      db.unitAsset.groupBy({ by: ['statusGaransi'], _count: { _all: true } }),
    ])
    const unitPerStatus = unitStatus
      .map((g) => `${g.statusGaransi}=${g._count._all}`)
      .join(', ')

    const daftarTerlambat = daftarToko
      .filter((t) => t.modeSiklus !== 'BY_REQUEST')
      .filter((t) => !t.tglVisitTerakhir || (Date.now() - new Date(t.tglVisitTerakhir).getTime()) / (24 * 3600 * 1000) > t.frekuensiVisit)
      .slice(0, 5)

    const total = cReq + cPro + cFin
    const barisBelumProses = belumProsesSemua.length
      ? `- Belum diproses (REQUEST tanpa part READY): ${belumProsesSemua.length} — ${belumProses.join(' ;; ')}.`
      : '- Belum diproses (REQUEST tanpa part READY): 0.'
    const lines = [
      `KONDISI APLIKASI (dibangun ${new Date().toLocaleString('id-ID')}):`,
      `- Tiket service: REQUEST=${cReq}, PROSES=${cPro}, FINISH=${cFin} (total ${total}). SLA lewat: ${sla}.`,
      barisBelumProses,
      `- Klaim produsen pending (DRAFT dari FINISH): ${claims.length} buah, nilai ±Rp ${Math.round(totalKlaimPending).toLocaleString('id-ID')}.`,
      `- Stok sparepart: total item ${spareparts.length}, kritis (stok<=reorder) ${stokKritis.length}, kosong ${stokKosong.length}.`,
      `- Unit asset: total ${unitTotal}${unitPerStatus ? ` (${unitPerStatus})` : ''}; toko aktif: ${daftarToko.length}.`,
      `- Kunjungan toko: ${daftarTerlambat.length} toko aktif terlambat visit (kunjungan 7 hari terakhir = ${kunjungan7}).`,
    ]
    return lines.join('\n')
  } catch (e) {
    console.error('AI context operasional gagal:', e)
    return null
  }
}

/** Gabungan konteks operasional + audit untuk satu penyusunan konteks AI. */
export async function kumpulkanKonteks(): Promise<KonteksAi> {
  const [operasional, audit] = await Promise.all([kumpulkanKonteksOperasional(), kumpulkanKonteksAudit()])
  return { dibangunPada: new Date().toISOString(), operasional, audit, sistem: PENGETAHUAN_SISTEM }
}

/**
 * Status tiket service + part-nya — untuk akses AI cek detail:
 *  - tiket tertentu (noTiket) → status tiket + daftar part (READY / ORDER_PRODUSEN / TIDAK_READY).
 *  - tanpa argumen → tiket berstatus PROSES (siap final assembly / butuh penanganan lanjut).
 * Mengembalikan teks ringkas untuk konteks AI. Best-effort.
 */
export async function statusTiket(noTiket?: string): Promise<string | null> {
  try {
    if (noTiket) {
      const t = await db.serviceRequest.findUnique({
        where: { noTiket },
        include: { parts: { include: { sparepart: true } }, unitAsset: true },
      })
      if (!t) return `TIKET ${noTiket} TIDAK DITEMUKAN.`
      const bagian = t.parts
        .map((p) => `part=${p.sparepart?.kodePart ?? '?'} nama=${p.sparepart?.namaPart ?? '?'} qty=${p.qty} statusPart=${p.statusPart} statusKonfirmasi=${p.statusKonfirmasi ?? '-'}`)
        .join(' | ')
      return `TIKET ${t.noTiket}: status=${t.status} lokasiUnit=${t.lokasiUnit} penanganan=${t.penanganan} unitSN=${t.unitAsset?.serialNumber ?? '-'} model=${t.unitAsset?.modelUnit ?? '-'}\nPARTS: ${bagian || 'tanpa part'}`
    }
    const daftar = await db.serviceRequest.findMany({
      where: { status: 'PROSES' },
      include: { parts: { include: { sparepart: true } } },
      orderBy: { tglTiket: 'desc' },
      take: 30,
    })
    if (daftar.length === 0) return null
    const blok = daftar
      .map((t) => `TIKET ${t.noTiket}: status=${t.status} PARTS: ${t.parts.map((p) => `part=${p.sparepart?.kodePart ?? '?'} statusPart=${p.statusPart} statusKonfirmasi=${p.statusKonfirmasi ?? '-'} qty=${p.qty}`).join(' | ') || 'tanpa part'}`)
      .join('\n')
    return `STATUS TIKET PROSES (final assembly / butuh penanganan):\n${blok}`
  } catch (e) {
    console.error('AI statusTiket gagal:', e)
    return null
  }
}

// ============================================================================
// Pencarian konteks sesuai pertanyaan pengguna
// ----------------------------------------------------------------------------
// Konteks operasional saja hanya berisi ANGKA AGREGAT (jumlah tiket, stok,
// dsb). Tanpa bagian ini, AI tidak pernah melihat daftar toko, unit asset,
// atau detail per toko — sehingga pertanyaan seperti "unit Toko Semeru Ahmad
// Yani apa saja?" dijawab "tidak ada informasi" padahal datanya ada.
// ============================================================================

/** Kata yang terlalu umum — tidak dipakai sebagai kata kunci pencarian. */
const KATA_UMUM = new Set([
  'toko', 'unit', 'units', 'dari', 'yang', 'apa', 'saja', 'ada', 'adalah', 'untuk',
  'dengan', 'dan', 'di', 'ke', 'ini', 'itu', 'tolong', 'coba', 'lihat', 'cek',
  'carikan', 'berikan', 'info', 'informasi', 'data', 'detail', 'rincian',
  'bagaimana', 'berapa', 'siapa', 'kapan', 'status', 'terakhir', 'semua', 'saat',
  'sekarang', 'mau', 'ingin', 'bisa', 'kah', 'nya', 'aku', 'saya', 'sedang',
  'punya', 'milik', 'tersebut', 'tentang', 'pada', 'dalam', 'atau', 'juga',
])

/** Ambil kata kunci penting (huruf kecil, tanpa tanda baca, tanpa kata umum). */
function tokenPenting(teks: string): string[] {
  return teks
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/[\s-]+/)
    .filter((t) => t.length >= 3 && !KATA_UMUM.has(t))
}

/** Normalisasi teks untuk pencocokan nama toko. */
function normal(teks: string): string {
  return teks.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

interface TokoRingkas {
  id: number
  kodeToko: string
  namaToko: string
  alamat: string | null
  frekuensiVisit: number
  modeSiklus: string
  tglVisitTerakhir: Date | null
  jumlahUnit: number
}

/** Semua toko aktif + jumlah unitnya (ringkas). */
async function ambilTokoRingkas(): Promise<TokoRingkas[]> {
  const rows = await db.masterToko.findMany({
    where: { aktif: true },
    select: {
      id: true,
      kodeToko: true,
      namaToko: true,
      alamat: true,
      frekuensiVisit: true,
      modeSiklus: true,
      tglVisitTerakhir: true,
      _count: { select: { unitAssets: true } },
    },
    orderBy: { namaToko: 'asc' },
  })
  return rows.map((r) => ({
    id: r.id,
    kodeToko: r.kodeToko,
    namaToko: r.namaToko,
    alamat: r.alamat,
    frekuensiVisit: r.frekuensiVisit,
    modeSiklus: r.modeSiklus,
    tglVisitTerakhir: r.tglVisitTerakhir,
    jumlahUnit: r._count.unitAssets,
  }))
}

/** Jumlah tiket aktif (REQUEST/PROSES) per toko. */
async function tiketAktifPerToko(): Promise<Map<number, number>> {
  const rows = await db.serviceRequest.findMany({
    where: { status: { in: ['REQUEST', 'PROSES'] } },
    select: { unitAsset: { select: { tokoId: true } } },
  })
  const map = new Map<number, number>()
  for (const r of rows) {
    const id = r.unitAsset?.tokoId
    if (id) map.set(id, (map.get(id) ?? 0) + 1)
  }
  return map
}

/** Detail satu toko: info, daftar unit, tiket terakhir, kunjungan terakhir. */
async function detailToko(toko: TokoRingkas): Promise<string> {
  const [units, tiket, kunjungan] = await Promise.all([
    db.unitAsset.findMany({
      where: { tokoId: toko.id },
      orderBy: { createdAt: 'desc' },
      take: 60,
      select: { serialNumber: true, modelUnit: true, merk: true, nama: true, statusGaransi: true },
    }),
    db.serviceRequest.findMany({
      where: { unitAsset: { tokoId: toko.id } },
      orderBy: { tglTiket: 'desc' },
      take: 8,
      select: {
        noTiket: true,
        status: true,
        tglTiket: true,
        penanganan: true,
        unitAsset: { select: { serialNumber: true, modelUnit: true } },
        parts: {
          select: {
            qty: true,
            statusPart: true,
            statusKonfirmasi: true,
            sparepart: { select: { kodePart: true, namaPart: true } },
          },
        },
      },
    }),
    db.kunjungan.findMany({
      where: { tokoId: toko.id },
      orderBy: { tglKunjungan: 'desc' },
      take: 3,
      select: { tglKunjungan: true, metodeCheckin: true },
    }),
  ])

  const unitBaris = units.length
    ? units
        .map(
          (u) =>
            `  - ${u.merk || '-'} ${u.modelUnit} | SN ${u.serialNumber || '-'} | ${u.statusGaransi}${u.nama ? ` | ${u.nama}` : ''}`
        )
        .join('\n')
    : '  (tidak ada unit terdaftar)'

  const tiketBaris = tiket.length
    ? tiket
        .map((t) => {
          const parts =
            t.parts
              .map(
                (p) =>
                  `${p.sparepart?.kodePart ?? '?'} (${p.sparepart?.namaPart ?? '?'}) x${p.qty} → ${p.statusPart}${p.statusKonfirmasi ? `/${p.statusKonfirmasi}` : ''}`
              )
              .join(', ') || 'tanpa part'
          return `  - ${t.noTiket} | ${t.status} | ${new Date(t.tglTiket).toLocaleDateString('id-ID')} | ${t.unitAsset?.modelUnit ?? '-'} SN ${t.unitAsset?.serialNumber ?? '-'} | penanganan ${t.penanganan} | part: ${parts}`
        })
        .join('\n')
    : '  (belum ada tiket)'

  const kunjBaris = kunjungan.length
    ? kunjungan.map((k) => `  - ${new Date(k.tglKunjungan).toLocaleDateString('id-ID')} (${k.metodeCheckin})`).join('\n')
    : '  (belum ada kunjungan)'

  return [
    `DETAIL TOKO ${toko.kodeToko} — ${toko.namaToko}`,
    `- Alamat: ${toko.alamat || '-'} | Siklus: ${toko.modeSiklus} tiap ${toko.frekuensiVisit} hari | Kunjungan terakhir: ${toko.tglVisitTerakhir ? new Date(toko.tglVisitTerakhir).toLocaleDateString('id-ID') : '-'}`,
    `- Jumlah unit: ${toko.jumlahUnit}${units.length < toko.jumlahUnit ? ` (ditampilkan ${units.length} terbaru)` : ''}`,
    `- Daftar unit:\n${unitBaris}`,
    `- Tiket terakhir (maks 8):\n${tiketBaris}`,
    `- Kunjungan terakhir:\n${kunjBaris}`,
  ].join('\n')
}

/** Cari toko yang paling cocok dengan pertanyaan (nama atau kode). */
function cariTokoCocok(pertanyaan: string, daftar: TokoRingkas[]): TokoRingkas[] {
  const qNorm = normal(pertanyaan)
  const tokenQ = new Set(tokenPenting(pertanyaan))
  const kode = pertanyaan.match(/tok-\d{3,}/i)?.[0]?.toUpperCase()
  return daftar
    .map((t) => {
      const tokenToko = tokenPenting(t.namaToko)
      const cocok = tokenToko.filter((x) => tokenQ.has(x)).length
      const cakupan = tokenToko.length ? cocok / tokenToko.length : 0
      let nilai = cocok * 2 + cakupan
      if (kode && t.kodeToko.toUpperCase() === kode) nilai += 10
      if (qNorm.includes(normal(t.namaToko))) nilai += 10
      return { t, nilai, cocok }
    })
    .filter((s) => s.nilai >= 2 && s.cocok >= 1)
    .sort((a, b) => b.nilai - a.nilai)
    .map((s) => s.t)
}

/**
 * Konteks tambahan yang diambil dari database sesuai isi pertanyaan pengguna:
 * daftar toko, detail toko yang disebut (unit + tiket + kunjungan), tiket
 * tertentu, dan stok sparepart. Best-effort (null bila tidak ada yang relevan).
 */
export async function cariKonteksPertanyaan(pertanyaan: string): Promise<string | null> {
  const q = (pertanyaan || '').trim()
  if (!q) return null
  try {
    const [daftarToko, tiketAktif] = await Promise.all([ambilTokoRingkas(), tiketAktifPerToko()])
    const blok: string[] = []

    // 1) Daftar semua toko aktif — supaya AI tahu toko mana saja yang ada.
    if (daftarToko.length) {
      blok.push(
        `DAFTAR TOKO AKTIF (${daftarToko.length}):\n` +
          daftarToko
            .map((t) => `- ${t.kodeToko} — ${t.namaToko} | ${t.jumlahUnit} unit | tiket aktif ${tiketAktif.get(t.id) ?? 0}`)
            .join('\n')
      )
    }

    // 2) Nomor tiket spesifik.
    const noTiket = q.match(/SVC-\d{4}-\d{4}/i)?.[0]?.toUpperCase()
    if (noTiket) {
      const st = await statusTiket(noTiket)
      if (st) blok.push(st)
    }

    // 3) Detail toko yang namanya/kodenya disebut.
    const cocok = cariTokoCocok(q, daftarToko)
    if (cocok.length) blok.push(await detailToko(cocok[0]))

    // 4) Stok sparepart bila ditanya.
    if (/stok|sparepart|spare\s*part|\bpart\b|kosong|kritis|reorder/i.test(q)) {
      const parts = await db.masterSparepart.findMany({
        orderBy: { stokInventory: 'asc' },
        take: 60,
        select: {
          kodePart: true,
          namaPart: true,
          stokInventory: true,
          stokJual: true,
          stokGaransi: true,
          reorderLimit: true,
          supplier: true,
        },
      })
      const tokenQ = tokenPenting(q)
      const relevan = parts.filter((p) =>
        tokenQ.some((t) => p.namaPart.toLowerCase().includes(t) || p.kodePart.toLowerCase().includes(t))
      )
      const tampil = (relevan.length ? relevan : parts).slice(0, 15)
      if (tampil.length) {
        blok.push(
          `STOK SPAREPART${relevan.length ? ' (paling relevan)' : ' TERENDAH (15)'}:\n` +
            tampil
              .map(
                (p) =>
                  `- ${p.kodePart} — ${p.namaPart} | stok ${p.stokInventory} (jual ${p.stokJual}, garansi ${p.stokGaransi}) | ROP ${p.reorderLimit} | ${p.supplier || '-'}`
              )
              .join('\n')
        )
      }
    }

    // 5) Ringkasan unit per merk/status bila pertanyaan soal unit tapi tanpa toko spesifik.
    if (/unit|\bsn\b|serial|garansi/i.test(q) && cocok.length === 0) {
      const perMerk = await db.unitAsset.groupBy({
        by: ['merk', 'statusGaransi'],
        _count: { _all: true },
        orderBy: { merk: 'asc' },
      })
      if (perMerk.length) {
        blok.push(
          `RINGKASAN UNIT PER MERK/STATUS:\n` +
            perMerk.map((g) => `- ${g.merk || '(tanpa merk)'} | ${g.statusGaransi} = ${g._count._all}`).join('\n')
        )
      }
    }

    // 6) Kode produk / sparepart detail (MasterSparepart + BankKode).
    if (/kode|part|sparepart|spare\\s*part|produk|bank\\s*kod|katalog/i.test(q)) {
      const kodeCand = (q.match(/[A-Za-z0-9][A-Za-z0-9._-]{2,}/g) ?? [])
        .map((s) => s.toUpperCase())
        .filter((s) => !/^(TOKO|UNIT|SVC|SN|TOK)$/i.test(s))
      const tokenQ = tokenPenting(q)
      const [parts, bank] = await Promise.all([
        db.masterSparepart.findMany({
          take: 500,
          select: {
            kodePart: true, namaPart: true, brandKompatibel: true, supplier: true,
            stokInventory: true, stokJual: true, stokGaransi: true, totalTerpakai: true,
            reorderLimit: true, hargaKlaim: true,
          },
        }),
        db.bankKode.findMany({
          take: 500,
          select: { kode: true, namaPart: true, brandKompatibel: true, modelTipe: true, produsen: true, sumber: true, catatan: true },
        }),
      ])
      const partMatch = parts.filter((p) =>
        kodeCand.some((k) => p.kodePart.toUpperCase().includes(k)) ||
        tokenQ.some((t) => p.namaPart.toLowerCase().includes(t) || p.kodePart.toLowerCase().includes(t))
      )
      const bankMatch = bank.filter((b) =>
        kodeCand.some((k) => b.kode.toUpperCase().includes(k)) ||
        tokenQ.some((t) => b.namaPart.toLowerCase().includes(t) || b.kode.toLowerCase().includes(t) || (b.modelTipe || '').toLowerCase().includes(t))
      )
      const tampilPart = (partMatch.length ? partMatch : parts).slice(0, 20)
      const tampilBank = (bankMatch.length ? bankMatch : bank).slice(0, 20)
      if (tampilPart.length || tampilBank.length) {
        const blokPart = tampilPart.length
          ? `MASTER SPAREPART${partMatch.length ? ' (cocok)' : ' (contoh)'}:\\n` +
            tampilPart.map((p) =>
              `- ${p.kodePart} — ${p.namaPart} | brand ${p.brandKompatibel || '-'} | stok ${p.stokInventory} (jual ${p.stokJual}, garansi ${p.stokGaransi}, terpakai ${p.totalTerpakai}) | ROP ${p.reorderLimit} | hargaKlaim Rp ${Math.round(p.hargaKlaim).toLocaleString('id-ID')} | supplier ${p.supplier || '-'}`
            ).join('\\n')
          : ''
        const blokBank = tampilBank.length
          ? `BANK KODE PRODUK${bankMatch.length ? ' (cocok)' : ' (contoh)'}:\\n` +
            tampilBank.map((b) =>
              `- ${b.kode} — ${b.namaPart || '-'} | brand ${b.brandKompatibel || '-'} | model/tipe ${b.modelTipe || '-'} | produsen ${b.produsen || '-'} | sumber ${b.sumber}${b.catatan ? ` | catatan: ${b.catatan}` : ''}`
            ).join('\\n')
          : ''
        blok.push([blokPart, blokBank].filter(Boolean).join('\\n\\n'))
      }
    }

    // 7) Detail unit asset bila pertanyaan menyebut SN/serial/model unit spesifik.
    if (/\\bsn\\b|serial|unit asset|model unit/i.test(q) && cocok.length === 0) {
      const snCand = q.match(/[A-Za-z0-9][A-Za-z0-9._-]{4,}/g) ?? []
      const units = await db.unitAsset.findMany({
        where: snCand.length
          ? { OR: snCand.map((s) => ({ serialNumber: { contains: s } })) }
          : undefined,
        take: 15,
        select: {
          serialNumber: true, modelUnit: true, merk: true, nama: true, statusGaransi: true,
          kerusakanAwal: true, toko: { select: { kodeToko: true, namaToko: true } },
          customer: { select: { nama: true } },
          serviceRequests: { select: { noTiket: true, status: true, tglTiket: true }, orderBy: { tglTiket: 'desc' }, take: 5 },
        },
      })
      if (units.length) {
        blok.push(
          `DETAIL UNIT (cocok ${units.length}):\\n` +
            units.map((u) =>
              `- ${u.merk || '-'} ${u.modelUnit}${u.nama ? ` (${u.nama})` : ''} | SN ${u.serialNumber || '-'} | ${u.statusGaransi} | toko ${u.toko ? `${u.toko.kodeToko} ${u.toko.namaToko}` : (u.customer?.nama ?? 'perorangan')} | kerusakan awal: ${u.kerusakanAwal || '-'} | tiket: ${u.serviceRequests.map((t) => `${t.noTiket}(${t.status})`).join(', ') || 'belum ada'}`
            ).join('\\n')
        )
      }
    }

    // 9) Daftar tiket/unit berdasarkan STATUS (REQUEST/PROSES/FINISH) bila ditanya.
    //    Sebelumnya AI hanya punya angka agregat → sering mencampur status (mis.
    //    "unit proses" ikut menampilkan unit finish). Sekarang daftar eksplisit
    //    per status dikirim supaya jawaban akurat.
    const statusDiminta = /\\bfinish\\b|\\bselesai\\b/i.test(q)
      ? 'FINISH'
      : /\\bproses\\b/i.test(q)
        ? 'PROSES'
        : /\\brequest\\b/i.test(q)
          ? 'REQUEST'
          : null
    if (statusDiminta && /unit|tiket|service/i.test(q)) {
      const daftar = await db.serviceRequest.findMany({
        where: { status: statusDiminta },
        include: { unitAsset: { include: { toko: { select: { kodeToko: true, namaToko: true } } } }, parts: { include: { sparepart: { select: { kodePart: true, namaPart: true } } } } },
        orderBy: { tglTiket: 'desc' },
        take: 40,
      })
      if (daftar.length) {
        blok.push(
          `TIKET BERSTATUS ${statusDiminta} (${daftar.length}${daftar.length === 40 ? '+' : ''}):\\n` +
            daftar.map((t) =>
              `- ${t.noTiket} | ${t.status} | ${new Date(t.tglTiket).toLocaleDateString('id-ID')} | ${t.unitAsset?.merk || '-'} ${t.unitAsset?.modelUnit ?? '-'} | SN ${t.unitAsset?.serialNumber ?? '-'} | toko ${t.unitAsset?.toko ? `${t.unitAsset.toko.kodeToko} ${t.unitAsset.toko.namaToko}` : 'perorangan'} | penanganan ${t.penanganan} | part: ${t.parts.map((p) => `${p.sparepart?.kodePart ?? '?'}(${p.statusPart})`).join(', ') || 'tanpa part'}`
            ).join('\\n')
        )
      } else {
        blok.push(`TIKET BERSTATUS ${statusDiminta}: 0 (tidak ada).`)
      }
    }

    // 8) Customer bila ditanya.
    if (/customer|pelanggan|pemesan/i.test(q)) {
      const tokenQ = tokenPenting(q)
      const custs = await db.masterCustomer.findMany({
        take: 200,
        select: { id: true, nama: true, noWa: true, alamat: true, _count: { select: { unitAssets: true, orders: true } } },
      })
      const cocokCust = custs.filter((c) => tokenQ.some((t) => c.nama.toLowerCase().includes(t)))
      const tampil = (cocokCust.length ? cocokCust : custs).slice(0, 15)
      if (tampil.length) {
        blok.push(
          `CUSTOMER${cocokCust.length ? ' (cocok)' : ''}:\\n` +
            tampil.map((c) => `- ${c.nama} | WA ${c.noWa || '-'} | ${c.alamat || '-'} | ${c._count.unitAssets} unit | ${c._count.orders} order`).join('\\n')
        )
      }
    }

    return blok.length ? blok.join('\\n\\n') : null
  } catch (e) {
    console.error('AI konteks pertanyaan gagal:', e)
    return null
  }
}
