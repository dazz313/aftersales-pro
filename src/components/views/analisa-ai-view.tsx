'use client'

import { useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { fetcher, postJson } from '@/lib/api'
import type { Toko } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/hooks/use-toast'
import { useAppStore } from '@/lib/store'
import HistoryInput from '@/components/history-input'
import { Sparkles, Loader2, X, CalendarDays, SearchCheck, FileText } from 'lucide-react'
import { cn } from '@/lib/utils'

interface AiRencana {
  rencana: { hari: string; kode: string[]; alasan: string }[]
  catatan: string
  model: string
  takTerjadwal: string[]
}

interface AiRekomendasi {
  rekomendasi: { kode: string; alasan: string }[]
  catatan: string
  model: string
}

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
 * Fitur utama Analisa AI (via 9router): ringkasan operasional, saran jadwal
 * kunjungan, dan rekomendasi sparepart — semua dengan penjelasan Bahasa Indonesia.
 */
export default function AnalisaAiView() {
  const { toast } = useToast()
  const { setView, navigateTo } = useAppStore()

  // ===== 1. Ringkasan operasional =====
  const [ringkasan, setRingkasan] = useState<RingkasanHasil | null>(null)
  const ringkasMut = useMutation({
    mutationFn: () => postJson<{ ringkasan: string; model: string; pendingLama: PendingLama[]; pendingLamaTotal: number }>('/api/ai/ringkasan', {}),
    onSuccess: (r) => setRingkasan({ teks: r.ringkasan, model: r.model, pendingLama: r.pendingLama ?? [], pendingLamaTotal: r.pendingLamaTotal ?? 0 }),
    onError: (e: Error) => toast({ title: 'Ringkasan AI gagal', description: e.message, variant: 'destructive' }),
  })

  // ===== 2. Saran jadwal kunjungan =====
  const { data: tokoList, isLoading: tokoLoading } = useQuery<Toko[]>({
    queryKey: ['toko'],
    queryFn: () => fetcher<Toko[]>('/api/toko'),
  })
  const skorToko = (t: Toko) => (t.visitTerlambat ? 1000 + (t.hariSejakVisit ?? t.frekuensiVisit) : 0) * 100 + t.jumlahUnit
  const isoLokal = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const hariKerja = useMemo(() => {
    const hari: Date[] = []
    const d = new Date()
    while (hari.length < 6) {
      if (d.getDay() !== 0) hari.push(new Date(d))
      d.setDate(d.getDate() + 1)
    }
    return hari
  }, [])
  const namaTokoMap = useMemo(() => new Map((tokoList ?? []).map((t) => [t.kodeToko.toUpperCase(), t.namaToko])), [tokoList])
  const [aiJadwal, setAiJadwal] = useState<AiRencana | null>(null)
  const jadwalMut = useMutation({
    mutationFn: () => {
      const prioritas = [...(tokoList ?? [])].sort((a, b) => skorToko(b) - skorToko(a)).slice(0, 30)
      return postJson<AiRencana>('/api/ai/suggest', {
        stores: prioritas.map((t) => ({
          kode: t.kodeToko, nama: t.namaToko, siklus: t.frekuensiVisit,
          sejakHari: t.hariSejakVisit, unit: t.jumlahUnit, terlambat: t.visitTerlambat,
        })),
        hari: hariKerja.map(isoLokal),
      })
    },
    onSuccess: (r) => {
      setAiJadwal(r)
      toast({ title: 'Jadwal AI diterima', description: `${r.rencana.length} hari disusun (${r.model}).` })
    },
    onError: (e: Error) => toast({ title: 'Jadwal AI gagal', description: e.message, variant: 'destructive' }),
  })

  // ===== 3. Rekomendasi sparepart =====
  const [model, setModel] = useState('')
  const [rusak, setRusak] = useState('')
  const [aiPart, setAiPart] = useState<AiRekomendasi | null>(null)
  const partMut = useMutation({
    mutationFn: async () => {
      if (!model.trim() && !rusak.trim()) throw new Error('Isi model unit dan/atau jenis kerusakan dulu.')
      const cari = await fetcher<{
        hasil: { kodePart: string; namaPart: string; brandKompatibel: string; stokInventory: number; frekuensi: number }[]
      }>(`/api/sparepart/cari?model=${encodeURIComponent(model.trim())}&rusak=${encodeURIComponent(rusak.trim())}`)
      if (cari.hasil.length === 0) throw new Error('Tidak ada kandidat part di riwayat untuk kasus ini.')
      return postJson<AiRekomendasi>('/api/ai/rekomendasi-part', {
        model: model.trim(),
        rusak: rusak.trim(),
        kandidat: cari.hasil.slice(0, 10).map((h) => ({
          kode: h.kodePart, nama: h.namaPart, brand: h.brandKompatibel ?? '',
          stok: h.stokInventory, frekuensi: h.frekuensi,
        })),
      })
    },
    onSuccess: (r) => {
      setAiPart(r)
      toast({ title: 'Rekomendasi AI diterima', description: `${r.rekomendasi.length} part disarankan (${r.model}).` })
    },
    onError: (e: Error) => toast({ title: 'Rekomendasi AI gagal', description: e.message, variant: 'destructive' }),
  })

  return (
    <div className="space-y-4">
      {/* ===== 1. Ringkasan operasional ===== */}
      <Card className="border-violet-200">
        <CardHeader className="flex-row items-start justify-between gap-2 space-y-0 pb-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <FileText className="h-4 w-4 text-violet-700" /> Ringkasan Operasional AI
            </CardTitle>
            <CardDescription className="text-xs">Kondisi usaha hari ini + 3 prioritas tindakan, ditulis AI dari data sistem.</CardDescription>
          </div>
          <Button
            size="sm" className="h-7 shrink-0 bg-violet-600 px-2 text-[11px] hover:bg-violet-700"
            disabled={ringkasMut.isPending} onClick={() => ringkasMut.mutate()}
          >
            {ringkasMut.isPending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Sparkles className="mr-1 h-3 w-3" />}
            {ringkasMut.isPending ? 'Menganalisa…' : 'Buat Ringkasan'}
          </Button>
        </CardHeader>
        <CardContent>
          {ringkasMut.isPending ? (
            <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-8" />)}</div>
          ) : ringkasan ? (
            <div className="rounded-xl border border-violet-200 bg-violet-50/50 p-3">
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <Badge variant="outline" className="border-violet-300 text-[10px] text-violet-700">AI · {ringkasan.model}</Badge>
                <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-slate-400 hover:text-slate-700" onClick={() => setRingkasan(null)} aria-label="Tutup ringkasan">
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
            <p className="rounded-lg border border-dashed p-4 text-center text-xs text-slate-400">Klik “Buat Ringkasan” — AI membaca tiket, stok, toko, dan klaim lalu menulis intisarinya.</p>
          )}
        </CardContent>
      </Card>

      {/* ===== 2. Saran jadwal kunjungan ===== */}
      <Card className="border-teal-200">
        <CardHeader className="flex-row items-start justify-between gap-2 space-y-0 pb-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarDays className="h-4 w-4 text-teal-700" /> Saran Jadwal Kunjungan AI
            </CardTitle>
            <CardDescription className="text-xs">6 hari kerja ke depan + alasan per hari. Versi interaktif (dengan check-in) ada di Field Ops.</CardDescription>
          </div>
          <div className="flex shrink-0 gap-1.5">
            <Button
              size="sm" variant="outline" className="h-7 border-teal-300 px-2 text-[11px] text-teal-700 hover:bg-teal-50"
              onClick={() => setView('field-ops')}
            >
              Buka Field Ops
            </Button>
            <Button
              size="sm" className="h-7 bg-violet-600 px-2 text-[11px] hover:bg-violet-700"
              disabled={jadwalMut.isPending || tokoLoading || (tokoList ?? []).length === 0}
              onClick={() => jadwalMut.mutate()}
            >
              {jadwalMut.isPending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Sparkles className="mr-1 h-3 w-3" />}
              {jadwalMut.isPending ? 'Meminta…' : 'Saran AI'}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {jadwalMut.isPending ? (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-32" />)}
            </div>
          ) : aiJadwal ? (
            <div>
              <div className="mb-2 flex items-center justify-between gap-2">
                <Badge variant="outline" className="border-violet-300 text-[10px] text-violet-700">AI · {aiJadwal.model}</Badge>
                <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px] text-slate-400 hover:text-slate-700" onClick={() => setAiJadwal(null)}>
                  <X className="mr-1 h-3 w-3" /> Tutup
                </Button>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
                {aiJadwal.rencana.map((r, i) => {
                  const tgl = hariKerja.find((d) => isoLokal(d) === r.hari)
                  return (
                    <div key={i} className="rounded-lg border border-violet-200 bg-white p-2">
                      <p className="text-[11px] font-bold text-slate-800">
                        {tgl ? tgl.toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short' }) : r.hari}
                      </p>
                      <div className="mt-1 space-y-1">
                        {r.kode.map((k) => (
                          <p key={k} className="truncate font-mono text-[10px] text-slate-700" title={`${k} — ${namaTokoMap.get(k.toUpperCase()) ?? ''}`}>
                            {k} <span className="font-sans text-slate-400">· {namaTokoMap.get(k.toUpperCase()) ?? ''}</span>
                          </p>
                        ))}
                      </div>
                      {r.alasan && <p className="mt-1.5 border-t border-dashed border-violet-200 pt-1 text-[10px] italic leading-snug text-violet-800">{r.alasan}</p>}
                    </div>
                  )
                })}
              </div>
              {(aiJadwal.catatan || aiJadwal.takTerjadwal.length > 0) && (
                <p className={cn('mt-2 text-[11px] text-violet-800')}>
                  {aiJadwal.catatan}
                  {aiJadwal.takTerjadwal.length > 0 && <span className="text-slate-500"> Tak terjadwal: {aiJadwal.takTerjadwal.join(', ')}.</span>}
                </p>
              )}
            </div>
          ) : (
            <p className="rounded-lg border border-dashed p-4 text-center text-xs text-slate-400">Klik “Saran AI” — jadwal 6 hari + alasan disusun dari data toko.</p>
          )}
        </CardContent>
      </Card>

      {/* ===== 3. Rekomendasi sparepart ===== */}
      <Card className="border-teal-200">
        <CardHeader className="flex-row items-start justify-between gap-2 space-y-0 pb-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <SearchCheck className="h-4 w-4 text-teal-700" /> Rekomendasi Sparepart AI
            </CardTitle>
            <CardDescription className="text-xs">Model + kerusakan → lacak riwayat → AI meranking kandidat + alasan.</CardDescription>
          </div>
          <Button
            size="sm" variant="outline" className="h-7 shrink-0 border-teal-300 px-2 text-[11px] text-teal-700 hover:bg-teal-50"
            onClick={() => setView('lacak')}
          >
            Buka Lacak
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Model Unit</Label>
              <HistoryInput historyKey="unit-model" value={model} onChange={(e) => setModel(e.target.value)} placeholder="cth: AC Split 1 PK" />
            </div>
            <div className="space-y-1.5">
              <Label>Jenis Kerusakan</Label>
              <HistoryInput historyKey="service-deskripsi" value={rusak} onChange={(e) => setRusak(e.target.value)} placeholder="cth: tidak dingin" />
            </div>
          </div>
          <Button
            size="sm" className="bg-violet-600 hover:bg-violet-700"
            disabled={partMut.isPending} onClick={() => partMut.mutate()}
          >
            {partMut.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Sparkles className="mr-1 h-4 w-4" />}
            {partMut.isPending ? 'Menganalisa…' : 'Lacak & Analisa AI'}
          </Button>
          {aiPart && (
            <div className="rounded-xl border border-violet-300 bg-violet-50/50 p-2.5">
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <Badge variant="outline" className="border-violet-300 text-[10px] text-violet-700">AI · {aiPart.model}</Badge>
                <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-slate-400 hover:text-slate-700" onClick={() => setAiPart(null)} aria-label="Tutup rekomendasi">
                  <X className="h-3 w-3" />
                </Button>
              </div>
              <div className="space-y-1.5">
                {aiPart.rekomendasi.map((r, i) => (
                  <div key={r.kode} className="flex items-start gap-2 rounded-lg border border-violet-200 bg-white px-2.5 py-1.5">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-violet-600 text-[10px] font-bold text-white">{i + 1}</span>
                    <div className="min-w-0">
                      <p className="font-mono text-[11px] font-bold text-slate-900">{r.kode}</p>
                      {r.alasan && <p className="mt-0.5 text-[11px] italic leading-snug text-violet-800">{r.alasan}</p>}
                    </div>
                  </div>
                ))}
              </div>
              {aiPart.catatan && <p className="mt-1.5 text-[11px] text-violet-800">{aiPart.catatan}</p>}
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-center text-[11px] text-slate-400">
        Ditenagai 9router di mesin ini · atur model & kunci di Pengaturan → AI Suggest · data yang dikirim hanya ringkasan operasional.
      </p>
    </div>
  )
}
