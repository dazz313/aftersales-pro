// ============ Tipe data aplikasi After-Sales System ============

export interface Toko {
  id: number
  kodeToko: string
  namaToko: string
  alamat: string | null
  kontak: string | null
  frekuensiVisit: number
  tglVisitTerakhir: string | null
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
  stokKonsinyasi: number
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
  sparepart?: Sparepart & { reorderLimit?: number }
}

export interface ServiceTicket {
  id: number
  noTiket: string
  unitAssetId: number
  status: 'REQUEST' | 'PROSES' | 'FINISH'
  noSttb: string | null
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
  fotoOnsite: string | null
  catatanStokRusak: string | null
  toko: { id: number; kodeToko: string; namaToko: string; alamat: string | null }
  teknisi: { id: number; nama: string; wilayahKerja: string | null }
}

export interface WaMessage {
  id: number
  pengirim: string
  grup: string
  tipe: 'IN' | 'OUT'
  pesan: string
  meta: string | null
  createdAt: string
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
