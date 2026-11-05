'use client'

import { postJson } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useAppStore } from '@/lib/store'
import { Sparkles, Loader2, X, FileText } from 'lucide-react'
import { useAiJobs } from '@/lib/ai-jobs'
import AiChat from '@/components/ai-chat'
import { cn } from '@/lib/utils'

interface PendingLama {
  noTiket: string
  umurHari: number
  serial: string
  model: string
  toko: string
  adaPart: boolean
}

interface RingkasanHasil {
  teks: string
  model: string
  pendingLama: PendingLama[]
  pendingLamaTotal: number
}

/**
 * Fitur Analisa AI yang tersisa: Ringkasan Operasional AI + Chat AI interaktif.
 * Fitur analisa lainnya (jadwal kunjungan, rekomendasi sparepart, tren, analisa
 * file) kini digantikan oleh Chat AI dua arah yang bisa membaca konteks aplikasi.
 */
export default function AnalisaAiView() {
  const { navigateTo } = useAppStore()
  const runJob = useAiJobs((s) => s.runJob)
  const resetJob = useAiJobs((s) => s.resetJob)
  const jobs = useAiJobs((s) => s.jobs)

  // ===== Ringkasan operasional =====
  // Status/hasil disimpan di store ai-jobs (level modul) → request tetap jalan
  // walau user pindah ke fitur lain dan hasilnya langsung tampil saat kembali.
  const ringkasanJob = jobs.ringkasan
  const ringkasan = ringkasanJob.hasil as RingkasanHasil | null
  const ringkasanRunning = ringkasanJob.status === 'running'
  const buatRingkasan = () =>
    void runJob<RingkasanHasil>(
      'ringkasan',
      'Ringkasan operasional',
      async () => {
        const r = await postJson<{ ringkasan: string; model: string; pendingLama: PendingLama[]; pendingLamaTotal: number }>('/api/ai/ringkasan', {})
        return { teks: r.ringkasan, model: r.model, pendingLama: r.pendingLama ?? [], pendingLamaTotal: r.pendingLamaTotal ?? 0 }
      },
      { judulGagal: 'Ringkasan AI gagal' },
    )

  return (
    <div className="space-y-4">
      {/* ===== Header hero ===== */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-violet-600 via-indigo-600 to-teal-600 px-5 py-4 text-white shadow-md shadow-indigo-200/70">
        <Sparkles className="pointer-events-none absolute -right-6 -top-8 h-28 w-28 opacity-20" />
        <div className="relative flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/30">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-lg font-bold leading-tight">Analisa AI</h1>
              <p className="max-w-2xl text-xs leading-snug text-white/85">
                Ringkasan operasional usaha hari ini + chat interaktif dua arah dengan AI yang membaca konteks aplikasi (tiket, stok, toko, klaim, dll.).
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <span className="rounded-full bg-white/15 px-2.5 py-1 text-[10px] font-bold tracking-wide ring-1 ring-white/30">2 FITUR</span>
            <span className="rounded-full bg-white/15 px-2.5 py-1 text-[10px] font-bold tracking-wide ring-1 ring-white/30">DITENAGAI 9ROUTER</span>
          </div>
        </div>
      </div>

      {/* ===== Dua kolom: Ringkasan AI (kiri) + Chat AI (kanan) di desktop ===== */}
      <div className="grid gap-4 lg:grid-cols-2">
      {/* ===== Ringkasan operasional ===== */}
      <Card className="overflow-hidden border-slate-200/80 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg">
        <div className="h-1 bg-gradient-to-r from-violet-500 via-fuchsia-400 to-violet-300" />
        <CardHeader className="flex-row items-start justify-between gap-2 space-y-0 pb-2">
          <div className="flex items-start gap-2.5">
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-violet-700 shadow-sm">
              <FileText className="h-4 w-4 text-white" />
            </div>
            <div>
              <CardTitle className="text-sm font-bold tracking-tight text-slate-900">Ringkasan Operasional AI</CardTitle>
              <CardDescription className="text-[11px] leading-snug">Kondisi usaha hari ini + 3 prioritas tindakan, ditulis AI dari data sistem.</CardDescription>
            </div>
          </div>
          <Button
            size="sm" className="h-7 shrink-0 bg-violet-600 px-2 text-[11px] hover:bg-violet-700"
            disabled={ringkasanRunning} onClick={buatRingkasan}
          >
            {ringkasanRunning ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Sparkles className="mr-1 h-3 w-3" />}
            {ringkasanRunning ? 'Menganalisa…' : 'Buat Ringkasan'}
          </Button>
        </CardHeader>
        <CardContent>
          {ringkasanRunning ? (
            <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-8" />)}</div>
          ) : ringkasan ? (
            <div className="rounded-xl border border-violet-200 bg-violet-50/50 p-3">
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <Badge variant="outline" className="border-violet-300 text-[10px] text-violet-700">AI · {ringkasan.model}</Badge>
                <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-slate-400 hover:text-slate-700" onClick={() => resetJob('ringkasan')} aria-label="Tutup ringkasan">
                  <X className="h-3 w-3" />
                </Button>
              </div>
              <p className="whitespace-pre-wrap text-xs leading-relaxed text-slate-700">{ringkasan.teks}</p>
              {/* Unit pending >5 hari tanpa kode+nama — dianalisa & ditampilkan AI */}
              <div className="mt-3 border-t border-dashed border-violet-200 pt-2.5">
                <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[11px] font-bold text-slate-800">
                    Unit pending &gt;5 hari tanpa kode+nama part ({ringkasan.pendingLamaTotal})
                  </p>
                  {ringkasan.pendingLamaTotal > 0 && (
                    <Button
                      size="sm" variant="outline" className="h-6 border-violet-300 px-2 text-[10px] text-violet-700 hover:bg-violet-50"
                      onClick={() => navigateTo('service', { serviceStatus: 'REQUEST' })}
                    >
                      Buka di Service
                    </Button>
                  )}
                </div>
                {ringkasan.pendingLamaTotal === 0 ? (
                  <p className="text-[11px] text-emerald-700">Bersih — tidak ada unit yang tertahan lebih dari 5 hari tanpa kode+nama part.</p>
                ) : (
                  <div className="max-h-56 space-y-1.5 overflow-y-auto pr-0.5">
                    {ringkasan.pendingLama.map((p) => (
                      <div key={p.noTiket} className="flex items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50/70 px-2.5 py-1.5">
                        <div className="min-w-0">
                          <p className="truncate font-mono text-[11px] font-bold text-slate-800" title={`${p.noTiket} · SN ${p.serial}`}>{p.noTiket}</p>
                          <p className="truncate text-[10px] text-slate-500" title={`${p.model} · ${p.toko}`}>{p.model} · {p.toko} · {p.adaPart ? 'menunggu READY' : 'belum input part'}</p>
                        </div>
                        <Badge variant="outline" className={cn('shrink-0 text-[10px]', p.umurHari >= 10 ? 'border-rose-300 text-rose-700' : 'border-amber-300 text-amber-700')}>
                          {p.umurHari} hari
                        </Badge>
                      </div>
                    ))}
                    {ringkasan.pendingLamaTotal > ringkasan.pendingLama.length && (
                      <p className="text-[10px] text-slate-500">+ {ringkasan.pendingLamaTotal - ringkasan.pendingLama.length} lainnya — buka di Service untuk daftar penuh.</p>
                    )}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 p-4 text-center text-xs text-slate-400">Klik “Buat Ringkasan” — AI membaca tiket, stok, toko, dan klaim lalu menulis intisarinya.</p>
          )}
        </CardContent>
      </Card>

      {/* ===== Chat AI interaktif ===== */}
      <AiChat />
      </div>

      <p className="text-center text-[11px] text-slate-400">
        Ditenagai 9router di mesin ini · atur model & kunci di Pengaturan → AI Suggest · data yang dikirim hanya ringkasan operasional.
      </p>
    </div>
  )
}
