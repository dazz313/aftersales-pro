/**
 * Menentukan IP klien asli saat aplikasi berjalan di belakang reverse proxy
 * atau tunnel (mis. Cloudflare Tunnel / Caddy).
 *
 * Prioritas:
 *  1. `CF-Connecting-IP` — diisi Cloudflare dengan IP klien asli.
 *  2. `X-Forwarded-For`  — ambil entri PALING KIRI (klien asli).
 *  3. `X-Real-IP`.
 *  4. 'unknown'.
 *
 * Catatan keamanan: header ini hanya dapat dipercaya bila origin TIDAK dapat
 * diakses langsung (di belakang Cloudflare Tunnel / firewall) sehingga klien
 * tidak bisa memalsukan nilainya.
 */
export function ipClient(request: Request): string {
  const cf = request.headers.get('cf-connecting-ip')?.trim()
  if (cf) return cf

  const fwd = request.headers.get('x-forwarded-for')
  if (fwd) {
    const first = fwd.split(',')[0]?.trim()
    if (first) return first
  }

  const real = request.headers.get('x-real-ip')?.trim()
  if (real) return real

  return 'unknown'
}

/** True bila request datang melewati Cloudflare (adanya header cf-ray/cf-connecting-ip). */
export function lewatCloudflare(request: Request): boolean {
  return Boolean(request.headers.get('cf-ray') || request.headers.get('cf-connecting-ip'))
}
