import type { ServiceTicket, WaMessage, AlertsResponse, DashboardData } from '@/lib/types'

export async function fetcher<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as { error?: string }).error || `Request gagal (${res.status})`)
  }
  return res.json() as Promise<T>
}

export async function postJson<T>(url: string, body: unknown, method = 'POST'): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
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

export function waSimulate(pesan: string, pengirim: string): Promise<{ ok: boolean; reply: string; aksi: string; noTiket?: string }> {
  return postJson('/api/wa/webhook', { pesan, pengirim })
}

export type { ServiceTicket, WaMessage, AlertsResponse, DashboardData }
