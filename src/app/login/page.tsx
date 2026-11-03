'use client'

import { Suspense, useEffect, useState } from 'react'
import { Eye, EyeOff, Loader2, LogIn, Info } from 'lucide-react'
import CompanyLogo from '@/components/company-logo'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { authHeaders, saveSessionToken } from '@/lib/api'

function LoginForm() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  // Sudah login (cookie / token Bearer tersimpan)? Langsung masuk ke app.
  // Penting untuk mode Bearer-only (cookie diblokir iframe): tanpa cek ini
  // user yang sudah login tetap melihat halaman login.
  useEffect(() => {
    let cancelled = false
    fetch('/api/auth/me', { headers: authHeaders() })
      .then((r) => {
        if (!r.ok) throw new Error('unauthenticated')
        if (!cancelled) window.location.replace('/')
      })
      .catch(() => {
        // belum login — tetap di halaman login
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (loading) return
    setError(null)
    setLoading(true)
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data?.error || 'Login gagal, periksa kembali data Anda')
        setLoading(false)
        return
      }
      // Simpan token sebagai fallback Bearer (untuk konteks yang memblokir cookie)
      saveSessionToken(data?.token)
      // Aplikasi single-route: semua view berada di "/" (navigasi internal)
      window.location.replace('/')
    } catch {
      setError('Tidak dapat menghubungi server, coba lagi')
      setLoading(false)
    }
  }

  function fillDemo(u: string, p: string) {
    setEmail(u)
    setPassword(p)
    setError(null)
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-900 p-4">
      <div className="w-full max-w-md">
        {/* Brand */}
        <div className="mb-6 flex flex-col items-center text-center">
          <CompanyLogo className="h-14 w-14 shadow-lg shadow-emerald-500/25" />
          <h1 className="mt-4 text-2xl font-bold text-white">AfterSales Pro</h1>
          <p className="mt-1 text-sm text-slate-400">
            Sistem Otomasi After-Sales Operations &amp; Inventory Management
          </p>
        </div>

        <Card className="border-slate-800 bg-slate-800/60 shadow-xl backdrop-blur">
          <CardContent className="p-6 sm:p-8">
            <h2 className="text-lg font-semibold text-white">Masuk ke Akun Anda</h2>
            <p className="mt-1 text-xs text-slate-400">Gunakan email atau username karyawan terdaftar</p>

            <form onSubmit={handleSubmit} className="mt-6 space-y-4" noValidate>
              <div className="space-y-2">
                <Label htmlFor="email" className="text-slate-300">
                  Email atau Username
                </Label>
                <Input
                  id="email"
                  name="email"
                  type="text"
                  autoComplete="username"
                  placeholder="contoh: budi@teknikjaya.co.id"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="border-slate-700 bg-slate-900/70 text-white placeholder:text-slate-600"
                  required
                  autoFocus
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password" className="text-slate-300">
                  Password
                </Label>
                <div className="relative">
                  <Input
                    id="password"
                    name="password"
                    type={showPw ? 'text' : 'password'}
                    autoComplete="current-password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="border-slate-700 bg-slate-900/70 pr-10 text-white placeholder:text-slate-600"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                    aria-label={showPw ? 'Sembunyikan password' : 'Tampilkan password'}
                    tabIndex={0}
                  >
                    {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {error && (
                <div role="alert" className="rounded-lg border border-red-900/60 bg-red-950/50 px-3 py-2.5 text-sm text-red-300">
                  {error}
                </div>
              )}

              <Button
                type="submit"
                disabled={loading || !email || !password}
                className="w-full bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-50"
              >
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Memproses…
                  </>
                ) : (
                  <>
                    <LogIn className="h-4 w-4" /> Masuk
                  </>
                )}
              </Button>
            </form>

            {/* Akun demo — hanya tampil di mode pengembangan, tidak di produksi */}
            {process.env.NODE_ENV !== 'production' && (
            <div className="mt-6 rounded-lg border border-slate-700/70 bg-slate-900/60 p-3.5">
              <p className="flex items-center gap-1.5 text-xs font-medium text-slate-300">
                <Info className="h-3.5 w-3.5 text-emerald-400" /> Akun demo:
              </p>
              <div className="mt-2 grid gap-1.5">
                <button
                  type="button"
                  onClick={() => fillDemo('budi@teknikjaya.co.id', 'admin123')}
                  className="flex items-center justify-between rounded-md px-2 py-1.5 text-left text-xs text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200"
                  aria-label="Isi kredensial admin demo"
                >
                  <span className="font-mono">budi@teknikjaya.co.id</span>
                  <span className="font-mono text-emerald-400">admin123</span>
                </button>
                <button
                  type="button"
                  onClick={() => fillDemo('ahmad@teknikjaya.co.id', 'aftersales123')}
                  className="flex items-center justify-between rounded-md px-2 py-1.5 text-left text-xs text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200"
                  aria-label="Isi kredensial teknisi demo"
                >
                  <span className="font-mono">ahmad@teknikjaya.co.id</span>
                  <span className="font-mono text-emerald-400">aftersales123</span>
                </button>
                <p className="px-2 text-[10px] leading-relaxed text-slate-600">
                  Klik untuk mengisi otomatis · login juga bisa pakai username (mis. <span className="font-mono">budi</span>)
                </p>
              </div>
            </div>
            )}
          </CardContent>
        </Card>

        <p className="mt-6 text-center text-xs text-slate-600">
          Workshop × Produsen (Inventory) · Sesi aktif 7 hari
        </p>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  )
}
