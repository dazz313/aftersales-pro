import { NextResponse, type NextRequest } from 'next/server'
import { SESSION_COOKIE, verifySessionToken, type SessionPayload } from '@/lib/auth'
import { isMutasi, permintaanSamaAsal } from '@/lib/csrf'

/**
 * Middleware proteksi Log In:
 * - API non-publik tanpa sesi (cookie ATAU Authorization: Bearer) → 401 JSON
 * - Proteksi CSRF: request MUTASI (POST/PUT/PATCH/DELETE) lintas situs ditolak
 *   403 berdasarkan Origin/Referer/Sec-Fetch-Site (lihat src/lib/csrf.ts).
 *   Request dengan Bearer diabaikan; webhook eksternal dikecualikan.
 * - Halaman TIDAK diblokir server-side: diserahkan ke client gate di "/"
 *   (fetch /api/auth/me → redirect /login bila 401). Ini WAJIB agar mode
 *   fallback Bearer (localStorage, dipakai saat cookie diblokir iframe)
 *   tidak mengalami redirect loop — request navigasi halaman tidak bisa
 *   membawa header Authorization.
 * - /login saat sudah login (via cookie) → redirect /
 * Publik (tanpa login): /login, /api/auth/*, /api/logo (logo tampil di halaman
 * login), webhook gateway (dipanggil bot eksternal — amankan via WEBHOOK_SECRET
 * di produksi). /api/backup/sheets SENGAJA tidak publik: watcher & MCP lewat
 * jalur terautentikasi / langsung via lib.
 * Catatan: aplikasi single-route — semua view di "/" dengan navigasi internal.
 */
const PUBLIC_API = ['/api/auth/login', '/api/auth/logout', '/api/auth/me', '/api/logo', '/api/health', '/api/wa/webhook', '/api/telegram/webhook']

// Webhook dipanggil layanan eksternal (bisa menyertakan Origin domain sendiri) —
// dikecualikan dari cek CSRF; pengamannya WEBHOOK_SECRET + Cloudflare Access.
const WEBHOOK_API = ['/api/wa/webhook', '/api/telegram/webhook']

/**
 * Proteksi CSRF: tolak request MUTASI lintas situs yang tidak memakai Bearer.
 * Browser selalu mengirim Origin (atau Sec-Fetch-Site: cross-site) pada
 * permintaan lintas situs, jadi asal yang asing = percobaan forge.
 */
function ditolakCsrf(request: NextRequest): boolean {
  const method = request.method
  if (!isMutasi(method)) return false
  const pakaiBearer = (request.headers.get('authorization') ?? '').toLowerCase().startsWith('bearer ')
  if (pakaiBearer) return false
  const { pathname } = request.nextUrl
  if (WEBHOOK_API.some((p) => pathname === p || pathname.startsWith(p + '/'))) return false
  return !permintaanSamaAsal(request)
}

async function getSessionFrom(request: NextRequest): Promise<SessionPayload | null> {
  const authz = request.headers.get('authorization')
  if (authz?.toLowerCase().startsWith('bearer ')) {
    const fromBearer = await verifySessionToken(authz.slice(7).trim())
    if (fromBearer) return fromBearer
  }
  const token = request.cookies.get(SESSION_COOKIE)?.value
  return token ? verifySessionToken(token) : null
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (pathname === '/login') {
    // Redirect server-side hanya bila sesi cookie valid; mode Bearer-only
    // ditangani client-side oleh halaman login (cek /api/auth/me).
    const token = request.cookies.get(SESSION_COOKIE)?.value
    if (token && (await verifySessionToken(token))) {
      return NextResponse.redirect(new URL('/', request.url))
    }
    return NextResponse.next()
  }

  if (pathname.startsWith('/api')) {
    // CSRF lebih dulu: tolak mutasi lintas situs sebelum apa pun.
    if (ditolakCsrf(request)) {
      return NextResponse.json(
        { error: 'Permintaan ditolak: asal permintaan tidak dikenal (proteksi CSRF).' },
        { status: 403 }
      )
    }
    if (PUBLIC_API.some((p) => pathname === p || pathname.startsWith(p + '/'))) {
      return NextResponse.next()
    }
    const session = await getSessionFrom(request)
    if (!session) {
      return NextResponse.json({ error: 'Tidak terautentikasi. Silakan login.' }, { status: 401 })
    }
    return NextResponse.next()
  }

  // Halaman: selalu lolos — client gate di page.tsx yang memvalidasi sesi
  // (mendukung cookie maupun fallback Bearer tanpa redirect loop).
  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|logo.svg|robots.txt).*)'],
}
