import type {
  ServiceTicket, WaMessage, AlertsResponse, DashboardData,
  GatewayStatus, GatewayTestResult, BackupStatus, BackupOutcome,
  VisionScan, InboxItem,
} from '@/lib/types'

/**
 * Fallback sesi via header Authorization (localStorage).
 * Dipakai saat cookie diblokir browser karena app berjalan di iframe
 * lintas situs (mis. preview ter-embed) — Safari ITP & mode ketat Chrome.
 */
const TOKEN_KEY = 'aspro_token'

export function saveSessionToken(token: string | undefined | null) {
  if (!token) return
  try {
    localStorage.setItem(TOKEN_KEY, token)
  } catch {
    // localStorage tidak tersedia — cookie tetap jadi mekanisme utama
  }
}

export function clearSessionToken() {
  try {
    localStorage.removeItem(TOKEN_KEY)
  } catch {
    // abaikan
  }
}

export function authHeaders(): Record<string, string> {
  try {
    const t = localStorage.getItem(TOKEN_KEY)
    if (t) return { Authorization: `Bearer ${t}` }
  } catch {
    // abaikan
  }
  return {}
}

export async function fetcher<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: authHeaders() })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as { error?: string }).error || `Request gagal (${res.status})`)
  }
  return res.json() as Promise<T>
}

export async function postJson<T>(url: string, body: unknown, method = 'POST'): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as { error?: string }).error || `Request gagal (${res.status})`)
  }
  return res.json() as Promise<T>
}

/** Bangun link mailto: dengan subject & body terisi — dipakai sebagai fallback bila SMTP belum diset. */
export function mailtoHref(to: string, subject: string, body: string): string {
  return `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body.replace(/\n/g, '\r\n'))}`
}

/**
 * Buka link eksternal aman di semua lingkungan: <a target="_blank"> → browser membuka browser/mail client,
 * Electron menangkapnya via setWindowOpenHandler (mailto/https → aplikasi default sistem).
 */
export function bukaLinkEksternal(href: string) {
  if (typeof document === 'undefined') return
  const a = document.createElement('a')
  a.href = href
  a.target = '_blank'
  a.rel = 'noreferrer'
  document.body.appendChild(a)
  a.click()
  a.remove()
}

export function formatRupiah(n: number): string {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(n)
}

export function formatTanggal(iso: string | null | undefined): string {
  if (!iso) return '-'
  return new Date(iso).toLocaleDateString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

export function formatWaktu(iso: string | null | undefined): string {
  if (!iso) return '-'
  return new Date(iso).toLocaleString('id-ID', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * Simulasi kirim pesan via Gateway (WhatsApp / Telegram).
 * Channel dipilih di view Gateway; bot engine tetap sama (#LAPOR).
 */
export function gatewaySimulate(
  pesan: string,
  pengirim: string,
  channel: 'WHATSAPP' | 'TELEGRAM'
): Promise<{ ok: boolean; reply: string; aksi: string; noTiket?: string; channel: string; mode: string }> {
  return postJson('/api/wa/webhook', { pesan, pengirim, channel })
}

export function fetchGatewayStatus(): Promise<GatewayStatus> {
  return fetcher<GatewayStatus>('/api/gateway/test')
}

export function testGateway(channel: 'WHATSAPP' | 'TELEGRAM'): Promise<GatewayTestResult> {
  return postJson('/api/gateway/test', { channel })
}

export function fetchBackupStatus(): Promise<BackupStatus> {
  return fetcher<BackupStatus>('/api/backup/sheets')
}

export function runBackupNow(): Promise<BackupOutcome> {
  return postJson<BackupOutcome>('/api/backup/sheets', { trigger: 'MANUAL' })
}

export function fetchVisionScans(): Promise<VisionScan[]> {
  return fetcher<VisionScan[]>('/api/vision/scan')
}

export async function uploadVisionScan(
  file: File, pengirim: string, caption: string, folder: 'KUNJUNGAN' | 'SERVICE' = 'SERVICE'
): Promise<{ ok: boolean; scan: VisionScan }> {
  const form = new FormData()
  form.append('file', file)
  form.append('pengirim', pengirim)
  form.append('caption', caption)
  form.append('folder', folder)
  const res = await fetch('/api/vision/scan', { method: 'POST', headers: authHeaders(), body: form })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as { error?: string }).error || 'Upload gagal')
  }
  return res.json()
}

/** URL thumbnail; folder dibaca dari filePath bila ada. */
export function visionFileUrl(scan: VisionScan): string {
  const p = (scan.filePath || '').toLowerCase()
  const folder = p.includes('kunjungan') ? 'kunjungan' : 'service'
  return `/api/vision/file/${folder}/${encodeURIComponent(scan.fileName)}`
}

export function fetchInbox(status?: string, folder?: string): Promise<{ items: InboxItem[]; pending: number }> {
  const q = new URLSearchParams()
  if (status) q.set('status', status)
  if (folder) q.set('folder', folder)
  const qs = q.toString()
  return fetcher<{ items: InboxItem[]; pending: number }>(`/api/inbox${qs ? `?${qs}` : ''}`)
}

export function prosesInbox(body: Record<string, unknown>): Promise<{ ok: boolean; item: InboxItem; [k: string]: unknown }> {
  return postJson('/api/inbox', body)
}

export function inboxFileUrl(item: InboxItem): string | null {
  if (!item.fileName) return null
  return `/api/vision/file/${item.folder.toLowerCase()}/${encodeURIComponent(item.fileName)}`
}

export type { ServiceTicket, WaMessage, AlertsResponse, DashboardData, GatewayStatus, GatewayTestResult, BackupStatus, BackupLogItem, BackupOutcome, VisionScan, InboxItem } from '@/lib/types'
export type {
  Toko, Customer, Sparepart, UnitAsset, Pengguna, ServicePart,
  Kunjungan, AuditLog, AlertItem, PermintaanOrder, OrderStatus, BankKode,
  SJKandidat, SJBaris, SJPreview, SJRingkasan, SJRiwayat,
} from '@/lib/types'

