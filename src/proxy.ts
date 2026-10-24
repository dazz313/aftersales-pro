import { NextResponse, type NextRequest } from 'next/server'
import { SESSION_COOKIE, verifySessionToken, type SessionPayload } from '@/lib/auth'

/**
 * Middleware proteksi Log In:
 * - API non-publik tanpa sesi (cookie ATAU Authorization: Bearer) → 401 JSON
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
