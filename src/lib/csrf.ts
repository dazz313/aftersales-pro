/**
 * Pertahanan CSRF berbasis Origin/Referer/Sec-Fetch-Site (edge-safe, murni).
 * ---------------------------------------------------------------------------
 * Tidak perlu token di klien: browser SELALU menyertakan `Origin` pada request
 * lintas situs (termasuk form POST), dan `Sec-Fetch-Site: cross-site` pada
 * browser modern. Jadi permintaan mutasi yang di-forge dari situs lain akan
 * memiliki asal (host) yang TIDAK cocok dengan host aplikasi → ditolak.
 *
 * Dipakai middleware (src/proxy.ts) untuk request mutasi berbasis cookie.
 * Request dengan `Authorization: Bearer` diabaikan karena tidak dapat di-forge
 * browser lintas situs (header kustom memicu preflight/CORS).
 */

/** Metode yang mengubah data (perlu proteksi CSRF). */
export const METODE_MUTASI = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

export function isMutasi(method: string): boolean {
  return METODE_MUTASI.has(method.toUpperCase())
}

/** Host (tanpa port) yang dituju request, menghormati reverse proxy/Cloudflare. */
export function hostPermintaan(request: Request): string | null {
  const xfh = request.headers.get('x-forwarded-host')
  const raw = (xfh ? xfh.split(',')[0] : request.headers.get('host'))?.trim().toLowerCase()
  if (!raw) return null
  // Buang port; dukung bentuk IPv6 [::1]:3000.
  if (raw.startsWith('[')) {
    const end = raw.indexOf(']')
    return end > 0 ? raw.slice(1, end) : raw
  }
  return raw.split(':')[0]
}

function hostDariUrl(value: string | null): string | null {
  if (!value || value === 'null') return null
  try {
    return new URL(value).hostname.toLowerCase()
  } catch {
    return null
  }
}

/**
 * True bila permintaan dianggap berasal dari aplikasi sendiri (bukan CSRF).
 * - `Sec-Fetch-Site: cross-site` → selalu ditolak.
 * - Ada `Origin` → host WAJIB cocok; `Origin: null` ditolak.
 * - Tanpa `Origin` tapi ada `Referer` → host WAJIB cocok.
 * - Tanpa indikator apa pun → bukan permintaan browser (webhook / curl /
 *   service-to-service) → bukan vektor CSRF, diloloskan.
 */
export function permintaanSamaAsal(request: Request): boolean {
  if ((request.headers.get('sec-fetch-site') ?? '').toLowerCase() === 'cross-site') return false

  const host = hostPermintaan(request)
  if (!host) return false

  const origin = request.headers.get('origin')
  if (origin !== null) return hostDariUrl(origin) === host

  const referer = request.headers.get('referer')
  if (referer !== null) return hostDariUrl(referer) === host

  return true
}
