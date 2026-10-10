import type {
  ServiceTicket, WaMessage, AlertsResponse, DashboardData,
  GatewayStatus, GatewayTestResult, BackupStatus, BackupOutcome,
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

export type { ServiceTicket, WaMessage, AlertsResponse, DashboardData, GatewayStatus, GatewayTestResult, BackupStatus, BackupLogItem, BackupOutcome }

