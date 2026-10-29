// ============ Tipe data aplikasi After-Sales System ============

export interface Toko {
  id: number
  kodeToko: string
  namaToko: string
  alamat: string | null
  kontak: string | null
  frekuensiVisit: number
  tglVisitTerakhir: string | null
  barcodeToko: string
  /** Jarak toko dari workshop (km) — null = belum diketahui (terisi saat maps terintegrasi). */
  jarakKm: number | null
  /** Koordinat posisi toko (WGS-84) — terisi otomatis via OpenStreetMap/Nominatim atau pin manual. */
  latitude: number | null
  longitude: number | null
  createdAt: string
  /** Toko masih beroperasi — false = dicentang "Tidak Aktif" (dikucilkan dari siklus visit). */
  aktif: boolean
  /** Mode siklus kunjungan: REGULER (otomatis per frekuensiVisit) | BY_REQUEST (hanya saat toko request). */
  modeSiklus: 'REGULER' | 'BY_REQUEST'
  jumlahUnit: number
  visitTerlambat: boolean
  hariSejakVisit: number | null
}

export interface Customer {
  id: number
  nama: string
  noWa: string | null
  alamat: string | null
  createdAt: string
  unitAssets: { id: number; modelUnit: string }[]
}

// ===== Surat Jalan Masuk dari Produsen (penerimaan part + pencocokan AI) =====
/** Kandidat part yang diorder (SV-EM / ORDER_PRODUSEN) untuk pencocokan surat jalan. */
export interface SJKandidat {
  key: string // p{id} = baris part tiket · e{id} = item email SV-EM
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
  sudahReady: boolean
}

/** Satu baris hasil pencocokan surat jalan (kebal dibacaubah di preview). */
export interface SJBaris {
  kodePart: string
  namaPart?: string
  qty: number
  serialNumber?: string
  statusMatch: 'COCOK' | 'TANPA_TIKET'
  cocokKey?: string
  cocokCand?: SJKandidat
  opsi: SJKandidat[]
  keterangan: string
  /** Keyakinan AI (0-100) bila baris ini dibantu AI — null untuk aturan murni. */
  yakin?: number
}

/** Hasil /api/surat-jalan/match — preview sebelum disimpan. */
export interface SJPreview {
  noSuratJalan?: string
  tglSurat: string | null
  produsen: string | null
  namaFile?: string
  terlewati: number
  dibantuAi: number
  /** Catatan kegagalan AI (fallback semua model mati) — null bila AI sehat/tak perlu. */
  aiCatatan?: string | null
  /** Model yang benar-benar dipakai untuk pencocokan AI. */
  aiModel?: string | null
  cocokCount: number
  items: SJBaris[]
}

/** Ringkasan commit /api/surat-jalan. */
export interface SJRingkasan {
  ok: boolean
  noSuratJalan: string
  totalItem: number
  cocokCount: number
  tanpaTiket: number
  naikProses: number
}

/** Hasil cek berlapis satu aspek (OK / INFO / PERINGATAN / BLOKIR). */
export interface SJCek {
  tingkat: 'OK' | 'INFO' | 'PERINGATAN' | 'BLOKIR'
  itemId?: number
  kode?: string
  pesan: string
}

/** Hasil POST /api/surat-jalan/[id]/periksa — cek otomatis + validasi silang. */
export interface SJCekHasil {
  items: SJCek[]
  header: SJCek[]
  blokir: number
  peringatan: number
  info: number
  bisaTerapkan: boolean
}

/** Detail draft surat jalan (GET /api/surat-jalan/[id]). */
export interface SJDraftDetail {
  id: number
  noSuratJalan: string
  tglSurat: string | null
  produsen: string | null
  namaFile: string | null
  createdAt: string
  createdBy: string | null
  status: string
  cekManual: boolean
  diperiksaAt: string | null
  diperiksaOleh: string | null
  diterapkanAt: string | null
  diterapkanOleh: string | null
  totalItem: number
  cocokCount: number
  tanpaTiket: number
  items: {
    id: number
    kodePart: string
    namaPart: string | null
    qty: number
    serialNumber: string | null
    statusMatch: string
    cocokTipe: string | null
    tiket: { id: number; noTiket: string; status: string; serial: string; model: string } | null
    alasan: string | null
  }[]
  kandidat: SJKandidat[]
}

/** Riwayat surat jalan masuk (GET /api/surat-jalan). */
/** Riwayat surat jalan masuk (GET /api/surat-jalan). */
export interface SJRiwayat {
  id: number
  noSuratJalan: string
  tglSurat: string | null
  produsen: string | null
  namaFile: string | null
  totalItem: number
  cocokCount: number
  tanpaTiket: number
  status: string
  cekManual: boolean
  diperiksaAt: string | null
  diperiksaOleh: string | null
  diterapkanAt: string | null
  diterapkanOleh: string | null
  createdAt: string
  createdBy: string | null
  items: { id: number; kodePart: string; namaPart: string | null; qty: number; serialNumber: string | null; statusMatch: string; tiket: string | null; unit: string | null; alasan: string | null }[]
}

/** Sisi kirim pada pasangan analisa (dari dokumen SJR yang dikirim ke produsen). */
export interface SJPasanganKirim {
  noSjr: string
  tgl: string | null
  qty: number
  noTiket: string
}

/** Satu pasangan Kirim-vs-Terima pada analisa — display saja, tidak menulis DB. */
export interface SJPasangan {
  jenis: 'SAMA' | 'BEDA_QTY' | 'KIRIM_TANPA_TERIMA' | 'TERIMA_TANPA_KIRIM'
  kode: string
  nama?: string | null
  sn?: string | null
  kirim?: SJPasanganKirim | null
  terima?: { itemId: number; kodeAsli: string; qty: number; tiket?: string | null } | null
  catatan?: string
}

/** Saran AI utk baris surat jalan yg belum tertaut — diterima MANUAL per baris. */
export interface SJSaran {
  terimaId: number
  kodeAsli: string
  kodeSaran: string | null
  noTiket: string
  noSjr?: string | null
  saranKey: string
  alasan: string
  yakin: number
}

/** Hasil POST /api/surat-jalan/[id]/analisa — Kirim vs Terima + saran AI. */
export interface SJAnalisaHasil {
  model: string | null
  sumber: 'REF_SJR' | 'SJR_TIKET' | 'TIDAK_ADA'
  refSjr: string | null
  dipakaiSjr: string[]
  ringkasan: { sama: number; bedaQty: number; belumDiterima: number; tanpaKirim: number; saran: number; saranYakin: number }
  pasangan: SJPasangan[]
  saran: SJSaran[]
}

export interface Sparepart {
  id: number
  kodePart: string
  namaPart: string
  brandKompatibel: string
  supplier: string
  stokJual: number
  stokGaransi: number
  stokInventory: number
  /** Kumulatif part terpakai di tiket — tidak memengaruhi stok brand. */
  totalTerpakai?: number
  /** Qty ORDER_PRODUSEN (dipesan khusus per unit, menunggu kiriman) — bukan stok brand. */
  dipesanPerUnit?: number
  /** No. tiket yang menunggu part ini (saat dipesanPerUnit > 0). */
  menungguDi?: string[]
  reorderLimit: number
  hargaKlaim: number
  createdAt: string
  ropAlert: boolean
  kosong: boolean
  /** Jumlah tiket yang memakai part ini (0 = aman dihapus). */
  dipakai?: number
}

/** Satu entri Bank Kode produsen — registry kode sparepart rumit. */
export interface BankKode {
  id: number
  kode: string
  namaPart: string
  brandKompatibel: string
  /** Model/tipe unit yang cocok — indikator pelacakan cepat. */
  modelTipe: string
  produsen: string
  sumber: string
  catatan: string | null
  createdAt: string
  updatedAt: string
}

export type StatusGaransi = 'STOK_TOKO' | 'GARANSI' | 'NON_GARANSI'

/** STOK_TOKO otomatis dihitung garansi. */
export const isGaransi = (s: string | null | undefined): boolean => s === 'GARANSI' || s === 'STOK_TOKO'

export const GARANSI_LABEL: Record<string, string> = {
  STOK_TOKO: 'STOK-TOKO',
  GARANSI: 'GARANSI',
  NON_GARANSI: 'NON-GARANSI',
}

export interface UnitAsset {
  id: number
  serialNumber: string
  modelUnit: string
  merk: string
  nama: string
  /** Kerusakan unit — diagnosa awal bahasa awam, dicatat saat registrasi sebelum kode part terbit. */
  kerusakanAwal: string | null
  tokoId: number | null
  customerId: number | null
  statusGaransi: StatusGaransi
  tglPembelian: string | null
  createdAt: string
  toko?: { id: number; kodeToko: string; namaToko: string } | null
  customer?: { id: number; nama: string; noWa: string | null } | null
  serviceRequests?: { id: number; noTiket: string; status: string; parts?: { qty: number; sparepart?: { kodePart: string } | null }[] }[]
  barcodeData?: string
}

export interface Pengguna {
  id: number
  nama: string
  email: string
  username?: string | null
  kodeTeknisi?: string | null
  role: 'ADMIN_WORKSHOP' | 'TEKNISI' | 'MANAGER' | 'PRODUSEN'
  noWa: string | null
  wilayahKerja: string | null
  aktif: boolean
  createdAt: string
  jumlahKunjungan?: number
}

export interface ServicePart {
  id: number
  serviceRequestId: number
  sparepartId: number
  qty: number
  statusPart: 'READY' | 'ORDER_PRODUSEN'
  statusKonfirmasi: 'MENUNGGU' | 'READY' | 'TIDAK_READY'
  sumberPart: 'KATALOG' | 'PRODUSEN'
  // Stempel pemasangan + cache kode/nama (statistik tetap stabil walau master berubah)
  tglPasang?: string | null
  pasangOleh?: string | null
  kodePartCache?: string | null
  namaPartCache?: string | null
  // Tanda koreksi (badge kecil "(edited)" di UI, untuk pemeriksaan kelak)
  editedAt?: string | null
  editedBy?: string | null
  sparepart?: Sparepart & { reorderLimit?: number }
}

/** Ref kecil: item order-email yang menempel tiket (alur REQUEST_EMAIL / Reorder Email part inden).
 *  emailMode: 'SMTP' email biasa · 'WA' dikirim via WhatsApp gateway/wa.me · 'MANUAL' dilampirkan manual. */
export interface OrderEmailRef {
  id: number
  kodePart: string
  qty: number
  status: string
  emailMode?: string | null
  createdAt: string
}

export type OrderStatus = 'BARU' | 'DITERUSKAN' | 'DATANG' | 'SELESAI' | 'BATAL'

export interface PermintaanOrder {
  id: number
  noOrder: string
  tipeCustomer: 'TOKO' | 'PERORANGAN'
  tokoId: number | null
  customerId: number | null
  namaPemesan: string
  sparepartId: number | null
  kodePart: string
  namaPart: string
  brand: string
  qty: number
  status: OrderStatus
  catatan: string | null
  createdAt: string
  tglSelesai: string | null
  toko?: { id: number; kodeToko: string; namaToko: string } | null
  customer?: { id: number; nama: string } | null
}

export type SumberLaporan = 'KUNJUNGAN' | 'LAPORAN_TOKO' | 'LAPORAN_CUSTOMER' | 'WA_BOT' | 'MANUAL'
export type TipeCustomer = 'TOKO' | 'PERORANGAN'
export type LokasiUnit = 'TOKO' | 'WORKSHOP'
export type Penanganan = 'BELUM' | 'TUNGGU_PART_TOKO' | 'DI_TOKO' | 'TARIK_WORKSHOP'

export interface ServiceTicket {
  id: number
  noTiket: string
  unitAssetId: number
  status: 'REQUEST' | 'REQUEST_EMAIL' | 'PROSES' | 'FINISH'
  noSttb: string | null
  sumberLaporan: SumberLaporan
  tipeCustomer: TipeCustomer
  lokasiUnit: LokasiUnit
  penanganan: Penanganan
  noSuratJalan: string | null
  sttbDicabut: boolean
  tglKembaliKeToko: string | null
  // Nomor STTB kolektif (STTBK) yang mencakup unit ini — terisi saat tiket
  // disahkan ditarik via "Cetak + Sahkan Ditarik" (tarik parsial: hanya yang
  // benar-benar diambil yang dibubuhkan nomor dokumen).
  noSttbKolektif?: string | null
  // Nomor Surat Pengembalian Barang (SKTB) terbit — terisi sejak surat
  // pengembalian pertama dicetak (bisa saat unit masih di workshop).
  noSuratKembali?: string | null
  deskripsiKerusakan: string | null
  fotoKerusakanWa: string | null
  fotoNotaStempel: string | null
  // Lampiran tiket REQUEST EMAIL (PDF/foto) — dilampirkan saat Kirim Email
  lampiranEmail?: string | null
  slaFlag: boolean
  statusKlaimProdusen: 'DRAFT' | 'SUBMITTED' | 'PAID'
  tglKlaim: string | null
  // Tanggal klik "Surat Jalan" (request part ke produsen) — stamp otomatis dari
  // dokumen SJR; tampil kecil di bawah badge REQUEST agar jelas kapan diorder.
  tglRequestPart?: string | null
  // Nomor surat jalan produsen & tanggal datangnya part — diisi saat Surat Jalan
  // Masuk (scan faktur) diterapkan ATAU saat "Part Datang" ditekan manual.
  // Keduanya adalah tahap terakhir alur surat jalan unit (deteksi per tiket).
  noSuratJalanProdusen?: string | null
  tglPartDatang?: string | null
  biayaJasa: number
  tglFinish: string | null
  tglTiket: string
  createdAt: string
  updatedAt: string
  // Tanda koreksi tiket (badge kecil "(edited)" di UI, untuk pemeriksaan kelak)
  editedAt?: string | null
  editedBy?: string | null
  unitAsset: UnitAsset & {
    toko?: Toko | null
    customer?: Customer | null
  }
  parts: ServicePart[]
  /** Item order-email pada tiket ini — indikator part inden sudah diorder via email apa belum. */
  orderEmailParts?: OrderEmailRef[]
  umurTiketJam?: number
  /** True bila selisih upload vs tgl kejadian > batas (umur dinonaktifkan di UI). */
  isDataLama?: boolean
  hariSejakFinish?: number | null
  nilaiKlaim?: number
}

export interface Kunjungan {
  id: number
  tokoId: number
  teknisiId: number
  tglKunjungan: string
  metodeCheckin: 'SCAN_BARCODE' | 'MANUAL'
  barcodeTerscan: string | null
  fotoOnsite: string | null
  catatanStokRusak: string | null
  toko: { id: number; kodeToko: string; namaToko: string; alamat: string | null }
  teknisi: { id: number; nama: string; wilayahKerja: string | null }
}

export interface WaMessage {
  id: number
  pengirim: string
  grup: string
  channel: 'WHATSAPP' | 'TELEGRAM'
  tipe: 'IN' | 'OUT'
  pesan: string
  meta: string | null
  createdAt: string
}

/**
 * Notifikasi in-app (lonceng header) — sumbernya server (tabel Notifikasi),
 * sehingga teknisi/admin/manager melihat daftar yang sama. Status "dibaca"
 * dicatat per pengguna.
 */
export interface NotifikasiItem {
  id: number
  tipe: 'REGISTRASI_UNIT' | 'TIKET_BARU' | 'ALERT'
  judul: string
  pesan: string
  refType: string | null
  refId: number | null
  refLabel: string | null
  dibuatOleh: string | null
  createdAt: string
  dibaca: boolean
}

export interface NotifikasiResponse {
  items: NotifikasiItem[]
  belumDibaca: number
  total: number
}

export interface VisionScan {
  id: number
  sumber: string
  pengirim: string
  fileName: string
  filePath: string
  mime: string | null
  caption: string | null
  barcode: string | null
  barcodeFormat: string | null
  ocrText: string | null
  ocrConfidence: number | null
  status: string
  createdAt: string
}

export interface InboxItem {
  id: number
  pengirim: string
  chatId: string
  fileName: string | null
  filePath: string | null
  mime: string | null
  caption: string | null
  barcode: string | null
  barcodeFormat: string | null
  ocrText: string | null
  ocrConfidence: number | null
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'ARCHIVED'
  folder: 'KUNJUNGAN' | 'SERVICE'
  tujuan: string | null
  teksTerusan: string | null
  hasilRef: string | null
  alasanTolak: string | null
  direviewOleh: string | null
  direviewAt: string | null
  createdAt: string
}

export interface GatewayStatus {
  whatsapp: { aktif: boolean; url: string; token: string; terkonfigurasi: boolean }
  telegram: { aktif: boolean; token: string; chatId: string; terkonfigurasi: boolean }
  channelDefault: 'WHATSAPP' | 'TELEGRAM'
}

export interface GatewayTestResult {
  ok: boolean
  mode: 'REAL' | 'SIMULASI'
  detail: string
  channel: 'WHATSAPP' | 'TELEGRAM'
}

export interface BackupLogItem {
  id: number
  status: 'SUCCESS' | 'LOCAL' | 'FAILED'
  trigger: 'MANUAL' | 'AUTO'
  sheetsWritten: number
  rowsTotal: number
  tabel: string | null
  message: string | null
  createdAt: string
}

export interface BackupStatus {
  logs: BackupLogItem[]
  last: BackupLogItem | null
  config: { autoAktif: boolean; intervalJam: number; spreadsheetId: string; serviceEmail: string; terisi: { spreadsheetId: boolean; serviceEmail: boolean; privateKey: boolean }; terkonfigurasi: boolean }
  dueNow: boolean
  lastBackupAt: string | null
  jadwal: { aktif: boolean; jam: string; terakhir: string }
}

export interface BackupOutcome {
  status: 'SUCCESS' | 'LOCAL' | 'FAILED'
  sheetsWritten: number
  rowsTotal: number
  tabel: string
  message: string
}

export interface AuditLog {
  id: number
  aksi: string
  entitas: string
  entitasId: string | null
  deskripsi: string
  aktor: string
  createdAt: string
}

export interface AlertItem {
  kode: string
  nama: string
  severity: 'critical' | 'warning'
  entitas: string
  detail: string
  meta: Record<string, unknown>
}

export interface AlertsResponse {
  generatedAt: string
  total: number
  critical: number
  totalUnclaimedRevenue: number
  alerts: AlertItem[]
}

export interface DashboardData {
  tiket: { request: number; proses: number; finish: number; slaTerlambat: number; total: number }
  belumProses: {
    count: number
    items: { noTiket: string; serial: string; model: string; toko: string; umurJam: number | null; adaPart: boolean; isDataLama: boolean }[]
  }
  /** Panel Part Request by Email: tiket REQUEST_EMAIL (kode SV-EM) + agregat item email-nya. */
  partEmail: {
    countTiket: number
    countPending: number
    countTerkirim: number
    items: {
      id: number
      noTiket: string
      tgl: string
      model: string
      serial: string
      toko: string
      parts: { kode: string; nama: string; qty: number }[]
      pending: number
      terkirim: number
    }[]
  }
  /** Unit terdaftar yang belum pernah punya tiket service sama sekali. */
  unitBelumDiproses: { count: number; total: number }
  klaim: { pendingCount: number; pendingValue: number; submitted: number }
  stok: { totalItem: number; kritis: number; kosong: number; nilaiTotal: number }
  operasional: { totalToko: number; tokoTerlambatVisit: number; kunjungan7hari: number }
  trenKerusakan: { model: string; jumlah: number }[]
  /** Unit rusak per toko, terbanyak → paling kurang (panel peringkat, maks 8). */
  rusakPerToko: { kode: string; nama: string; jumlah: number }[]
  /** Top 3 brand dengan unit rusak terbanyak. */
  rusakPerBrand: { brand: string; jumlah: number }[]
  garansiCount: { GARANSI: number; NON_GARANSI: number }
  tren14hari: { tanggal: string; tiket: number }[]
}

// ==========================================
// MODUL 8 - Komunikasi Antar Akun (MiniChat & Notes)
// ==========================================

/** Akun aktif — target DM / peserta broadcast MiniChat. */
export interface ChatUser {
  id: number
  nama: string
  email: string
  username: string | null
  role: 'ADMIN_WORKSHOP' | 'TEKNISI' | 'MANAGER' | 'PRODUSEN'
}

/** Satu pesan MiniChat (DM: penerimaId = id tujuan · broadcast: penerimaId null). */
export interface ChatPesanItem {
  id: number
  pengirimId: number
  penerimaId: number | null
  isi: string
  createdAt: string
}

export interface ChatData {
  users: ChatUser[]
  pesan: ChatPesanItem[]
  meId: number
}

/** Papan catatan bersama — bentuk API GET /api/catatan. */
export interface CatatanItem {
  id: number
  judul: string | null
  isi: string
  untukRole: string | null
  pinned: boolean
  penulisId: number
  editedAt: string | null
  editedBy: string | null
  createdAt: string
  updatedAt: string
  penulis: { nama: string; role: 'ADMIN_WORKSHOP' | 'TEKNISI' | 'MANAGER' | 'PRODUSEN' }
  balasan: CatatanBalasanItem[]
}

export interface CatatanBalasanItem {
  id: number
  catatanId: number
  penulisId: number
  isi: string
  createdAt: string
  penulis: { nama: string; role: 'ADMIN_WORKSHOP' | 'TEKNISI' | 'MANAGER' | 'PRODUSEN' }
}
