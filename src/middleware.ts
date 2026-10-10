import { NextResponse, type NextRequest } from 'next/server'
import { SESSION_COOKIE, verifySessionToken } from '@/lib/auth'

/**
 * Middleware proteksi Log In:
 * - Halaman non-/login tanpa sesi → redirect /login
 * - /login saat sudah login → redirect /
 * - API non-publik tanpa sesi → 401 JSON
 * Publik (tanpa login): /login, /api/auth/*, webhook gateway (dipanggil bot eksternal),
 * /api/backup/sheets (dipicu MCP AI / watcher backup).
 * Catatan: aplikasi single-route — semua view di "/" dengan navigasi internal.
 */
const PUBLIC_API = ['/api/auth/login', '/api/auth/logout', '/api/auth/me', '/api/wa/webhook', '/api/backup/sheets']

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  const token = request.cookies.get(SESSION_COOKIE)?.value
  const session = token ? await verifySessionToken(token) : null

  if (pathname === '/login') {
    if (session) return NextResponse.redirect(new URL('/', request.url))
    return NextResponse.next()
  }

  if (pathname.startsWith('/api')) {
    if (PUBLIC_API.some((p) => pathname === p || pathname.startsWith(p + '/'))) {
      return NextResponse.next()
    }
    if (!session) {
      return NextResponse.json({ error: 'Tidak terautentikasi. Silakan login.' }, { status: 401 })
    }
    return NextResponse.next()
  }

  if (!session) {
    return NextResponse.redirect(new URL('/login', request.url))
  }
  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|logo.svg|robots.txt).*)'],
}
