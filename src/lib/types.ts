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
  createdAt: string
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

export interface Sparepart {
  id: number
  kodePart: string
  namaPart: string
  brandKompatibel: string
  supplier: string
  stokJual: number
  stokGaransi: number
  stokInventory: number
  reorderLimit: number
  hargaKlaim: number
  createdAt: string
  ropAlert: boolean
  kosong: boolean
}

export interface UnitAsset {
  id: number
  serialNumber: string
  modelUnit: string
  tokoId: number | null
  customerId: number | null
  statusGaransi: 'GARANSI' | 'NON_GARANSI'
  tglPembelian: string | null
  createdAt: string
  toko?: { id: number; kodeToko: string; namaToko: string } | null
  customer?: { id: number; nama: string; noWa: string | null } | null
  serviceRequests?: { id: number; noTiket: string; status: string }[]
  barcodeData?: string
}

export interface Pengguna {
  id: number
  nama: string
  email: string
  username?: string | null
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
  sparepart?: Sparepart & { reorderLimit?: number }
}

export type SumberLaporan = 'KUNJUNGAN' | 'LAPORAN_TOKO' | 'LAPORAN_CUSTOMER' | 'WA_BOT' | 'MANUAL'
export type LokasiUnit = 'TOKO' | 'WORKSHOP'
export type Penanganan = 'BELUM' | 'TUNGGU_PART_TOKO' | 'DI_TOKO' | 'TARIK_WORKSHOP'

export interface ServiceTicket {
  id: number
  noTiket: string
  unitAssetId: number
  status: 'REQUEST' | 'PROSES' | 'FINISH'
  noSttb: string | null
  sumberLaporan: SumberLaporan
  lokasiUnit: LokasiUnit
  penanganan: Penanganan
  noSuratJalan: string | null
  sttbDicabut: boolean
  tglKembaliKeToko: string | null
  deskripsiKerusakan: string | null
  fotoKerusakanWa: string | null
  fotoNotaStempel: string | null
  slaFlag: boolean
  statusKlaimProdusen: 'DRAFT' | 'SUBMITTED' | 'PAID'
  tglKlaim: string | null
  biayaJasa: number
  tglFinish: string | null
  createdAt: string
  updatedAt: string
  unitAsset: UnitAsset & {
    toko?: Toko | null
    customer?: Customer | null
  }
  parts: ServicePart[]
  umurTiketJam?: number
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
  config: { autoAktif: boolean; intervalJam: number; spreadsheetId: string; serviceEmail: string; terkonfigurasi: boolean }
  dueNow: boolean
  lastBackupAt: string | null
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
  klaim: { pendingCount: number; pendingValue: number; submitted: number }
  stok: { totalItem: number; kritis: number; kosong: number; nilaiTotal: number }
  operasional: { totalToko: number; tokoTerlambatVisit: number; kunjungan7hari: number }
  trenKerusakan: { model: string; jumlah: number }[]
  garansiCount: { GARANSI: number; NON_GARANSI: number }
  tren14hari: { tanggal: string; tiket: number }[]
}
