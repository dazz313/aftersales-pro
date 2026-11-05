'use client'

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetcher, postJson, authHeaders } from '@/lib/api'
import type { Toko } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/hooks/use-toast'
import { useAppStore } from '@/lib/store'
import HistoryInput from '@/components/history-input'
import { Sparkles, Loader2, X, CalendarDays, SearchCheck, FileText, Truck, FileSpreadsheet, Layers, PackageCheck, TrendingUp, BarChart3, UploadCloud } from 'lucide-react'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts'
import SuratJalanMasukDialog from '@/components/surat-jalan-masuk-dialog'
import AiChat from '@/components/ai-chat'
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

// ===== 5. Analisa tren multi-periode (MINGGU/BULAN/TAHUN) =====
interface SelTren {
  key: string
  label: string
  tiketMasuk: number
  tiketSelesai: number
  slaLewat: number
  klaimDiajukan: number
  kunjungan: number
  unitBaru: number
}
interface TotalTren {
  tiketMasuk: number
  tiketSelesai: number
  slaLewat: number
  klaimDiajukan: number
  kunjungan: number
  unitBaru: number
}
interface TrenHasil {
  periode: 'MINGGU' | 'BULAN' | 'TAHUN'
  series: SelTren[]
  total: TotalTren
  narasi: string | null
  model: string | null
  catatan: string | null
}

// ===== 6. Analisa file Excel vs data aplikasi =====
interface AnalisaUploadHasil {
  analisa: string | null
  catatan: string | null
  model: string
  fileMeta: { namaFile: string; sheet: string; jumlahBaris: number; kolom: string[] }
  statistik: { kolom: string; terisiAngka: number; minimum: number; maksimum: number; rataRata: number }[]
  bandingkan: { tokoCocok: string[]; tokoTidak: string[]; partCocok: string[]; partTidak: string[] }
}

/**
 * Fitur utama Analisa AI (via 9router): ringkasan operasional, saran jadwal
 * kunjungan, dan rekomendasi sparepart — semua dengan penjelasan Bahasa Indonesia.
 */
export default function AnalisaAiView() {
  const { toast } = useToast()
  const { setView, navigateTo } = useAppStore()
  const queryClient = useQueryClient()
  // ===== 4. Surat jalan masuk (dialog mandiri) =====
  const [sjMasukOpen, setSjMasukOpen] = useState(false)

  // ===== 1. Ringkasan operasional =====
  // Disimpan di React Query cache → tidak hilang saat user buka fitur lain (AI jalan di background).
  const ringkasan = (queryClient.getQueryData<RingkasanHasil>(['ai-ringkasan'])) ?? null
  const ringkasMut = useMutation({
    mutationFn: () => postJson<{ ringkasan: string; model: string; pendingLama: PendingLama[]; pendingLamaTotal: number }>('/api/ai/ringkasan', {}),
    onSuccess: (r) => queryClient.setQueryData<RingkasanHasil>(['ai-ringkasan'], { teks: r.ringkasan, model: r.model, pendingLama: r.pendingLama ?? [], pendingLamaTotal: r.pendingLamaTotal ?? 0 }),
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
  const aiJadwal = (queryClient.getQueryData<AiRencana>(['ai-jadwal'])) ?? null
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
      queryClient.setQueryData(['ai-jadwal'], r)
      toast({ title: 'Jadwal AI diterima', description: `${r.rencana.length} hari disusun (${r.model}).` })
    },
    onError: (e: Error) => toast({ title: 'Jadwal AI gagal', description: e.message, variant: 'destructive' }),
  })

  // ===== 3. Rekomendasi sparepart =====
  const [model, setModel] = useState('')
  const [rusak, setRusak] = useState('')
  const aiPart = (queryClient.getQueryData<AiRekomendasi>(['ai-rekomendasi'])) ?? null
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
      queryClient.setQueryData(['ai-rekomendasi'], r)
      toast({ title: 'Rekomendasi AI diterima', description: `${r.rekomendasi.length} part disarankan (${r.model}).` })
    },
    onError: (e: Error) => toast({ title: 'Rekomendasi AI gagal', description: e.message, variant: 'destructive' }),
  })

  // ===== 5. Analisa tren multi-periode (semua data) =====
  const [trenPeriode, setTrenPeriode] = useState<'MINGGU' | 'BULAN' | 'TAHUN'>('TAHUN')
  const tren = (queryClient.getQueryData<TrenHasil>(['ai-tren'])) ?? null
  const trenMut = useMutation({
    mutationFn: () => postJson<TrenHasil>('/api/ai/tren', { periode: trenPeriode }),
    onSuccess: (r) => {
      queryClient.setQueryData(['ai-tren'], r)
    },
    onError: (e: Error) => toast({ title: 'Analisa tren gagal', description: e.message, variant: 'destructive' }),
  })

  // ===== 6. Analisa file Excel vs data aplikasi =====
  const [fileAnalisa, setFileAnalisa] = useState<File | null>(null)
  const [pertanyaanAnalisa, setPertanyaanAnalisa] = useState('')
  const hasilUpload = (queryClient.getQueryData<AnalisaUploadHasil>(['ai-upload'])) ?? null
  const uploadMut = useMutation({
    mutationFn: async () => {
      if (!fileAnalisa) throw new Error('Pilih file Excel/CSV terlebih dahulu.')
      const form = new FormData()
      form.append('file', fileAnalisa)
      form.append('pertanyaan', pertanyaanAnalisa)
      const res = await fetch('/api/ai/analisa-upload', { method: 'POST', headers: authHeaders(), body: form })
      const j = (await res.json().catch(() => ({}))) as AnalisaUploadHasil & { error?: string }
      if (!res.ok) throw new Error(j.error ?? 'Analisa file gagal')
      return j
    },
    onSuccess: (r) => {
      queryClient.setQueryData(['ai-upload'], r)
    },
    onError: (e: Error) => toast({ title: 'Analisa file gagal', description: e.message, variant: 'destructive' }),
  })

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
                Mini-app analis lengkap — ringkasan usaha, jadwal kunjungan, pencarian part, penerimaan barang, tren indikator mingguan/bulanan/tahunan, dan perbandingan file Excel dengan data aplikasi.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <span className="rounded-full bg-white/15 px-2.5 py-1 text-[10px] font-bold tracking-wide ring-1 ring-white/30">6 FITUR</span>
            <span className="rounded-full bg-white/15 px-2.5 py-1 text-[10px] font-bold tracking-wide ring-1 ring-white/30">DITENAGAI 9ROUTER</span>
          </div>
        </div>
      </div>

      {/* ===== Fitur berdampingan: 2 kolom × 2 baris ke bawah ===== */}
      <div className="grid items-stretch gap-4 lg:grid-cols-2">
      {/* ===== 1. Ringkasan operasional ===== */}
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
                <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-slate-400 hover:text-slate-700" onClick={() => queryClient.setQueryData(['ai-ringkasan'], null)} aria-label="Tutup ringkasan">
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

      {/* ===== 2. Saran jadwal kunjungan ===== */}
      <Card className="overflow-hidden border-slate-200/80 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg">
        <div className="h-1 bg-gradient-to-r from-teal-500 via-cyan-400 to-teal-300" />
        <CardHeader className="flex-row items-start justify-between gap-2 space-y-0 pb-2">
          <div className="flex items-start gap-2.5">
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-teal-500 to-teal-700 shadow-sm">
              <CalendarDays className="h-4 w-4 text-white" />
            </div>
            <div>
              <CardTitle className="text-sm font-bold tracking-tight text-slate-900">Saran Jadwal Kunjungan AI</CardTitle>
              <CardDescription className="text-[11px] leading-snug">6 hari kerja ke depan + alasan per hari. Versi interaktif (dengan check-in) ada di Field Ops.</CardDescription>
            </div>
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
                <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px] text-slate-400 hover:text-slate-700" onClick={() => queryClient.setQueryData(['ai-jadwal'], null)}>
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
            <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 p-4 text-center text-xs text-slate-400">Klik “Saran AI” — jadwal 6 hari + alasan disusun dari data toko.</p>
          )}
        </CardContent>
      </Card>

      {/* ===== 3. Rekomendasi sparepart ===== */}
      <Card className="overflow-hidden border-slate-200/80 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg">
        <div className="h-1 bg-gradient-to-r from-amber-500 via-orange-400 to-amber-300" />
        <CardHeader className="flex-row items-start justify-between gap-2 space-y-0 pb-2">
          <div className="flex items-start gap-2.5">
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-amber-500 to-amber-700 shadow-sm">
              <SearchCheck className="h-4 w-4 text-white" />
            </div>
            <div>
              <CardTitle className="text-sm font-bold tracking-tight text-slate-900">Rekomendasi Sparepart AI</CardTitle>
              <CardDescription className="text-[11px] leading-snug">Model + kerusakan → lacak riwayat → AI meranking kandidat + alasan.</CardDescription>
            </div>
          </div>
          <Button
            size="sm" variant="outline" className="h-7 shrink-0 border-amber-300 px-2 text-[11px] text-amber-800 hover:bg-amber-50"
            onClick={() => setView('lacak')}
          >
            Buka Lacak
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Model Unit</Label>
              <HistoryInput historyKey="unit-model" value={model} onChange={(e) => setModel(e.target.value)} placeholder="cth: Kipas Angin 16 inch" />
            </div>
            <div className="space-y-1.5">
              <Label>Jenis Kerusakan</Label>
              <HistoryInput historyKey="service-deskripsi" value={rusak} onChange={(e) => setRusak(e.target.value)} placeholder="cth: tidak berputar" />
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
                <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-slate-400 hover:text-slate-700" onClick={() => queryClient.setQueryData(['ai-rekomendasi'], null)} aria-label="Tutup rekomendasi">
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

      {/* ===== 4. Surat jalan masuk — penerimaan part dari produsen (cek berlapis + pencocokan AI) ===== */}
      <Card className="overflow-hidden border-slate-200/80 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg">
        <div className="h-1 bg-gradient-to-r from-indigo-500 via-blue-400 to-indigo-300" />
        <CardHeader className="flex-row items-start justify-between gap-2 space-y-0 pb-2">
          <div className="flex items-start gap-2.5">
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-indigo-700 shadow-sm">
              <Truck className="h-4 w-4 text-white" />
            </div>
            <div>
              <CardTitle className="text-sm font-bold tracking-tight text-slate-900">Surat Jalan Masuk — Penerimaan Part Produsen</CardTitle>
              <CardDescription className="text-[11px] leading-snug">
                Unggah <b>PDF/foto faktur mutasi</b> atau Excel/CSV hasil scan → pencocokan otomatis (+ bantuan AI) → <b>Simpan Draft → Cek Berlapis (+ Cek Manual per baris) → Cek Akhir → Terapkan Permanen</b>.
              </CardDescription>
            </div>
          </div>
          <Button size="sm" className="h-7 shrink-0 bg-indigo-600 px-2 text-[11px] hover:bg-indigo-700" onClick={() => setSjMasukOpen(true)}>
            <Truck className="mr-1 h-3.5 w-3.5" /> Buka
          </Button>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="rounded-xl border border-indigo-100 bg-indigo-50/60 p-2.5">
              <p className="flex items-center gap-1.5 text-[11px] font-bold text-indigo-800"><FileSpreadsheet className="h-3.5 w-3.5" /> 1 · Unggah Excel/CSV</p>
              <p className="mt-1 text-[10px] leading-snug text-slate-500">Hasil scan manual (kode, nama, qty, SN) dari barang datangan produsen.</p>
            </div>
            <div className="rounded-xl border border-indigo-100 bg-indigo-50/60 p-2.5">
              <p className="flex items-center gap-1.5 text-[11px] font-bold text-indigo-800"><Layers className="h-3.5 w-3.5" /> 2 · Cek Berlapis</p>
              <p className="mt-1 text-[10px] leading-snug text-slate-500">Draft → cek otomatis → cek manual per baris → cek akhir bersih.</p>
            </div>
            <div className="rounded-xl border border-indigo-100 bg-indigo-50/60 p-2.5">
              <p className="flex items-center gap-1.5 text-[11px] font-bold text-indigo-800"><PackageCheck className="h-3.5 w-3.5" /> 3 · Terapkan Permanen</p>
              <p className="mt-1 text-[10px] leading-snug text-slate-500">Baris cocok siap di tiket & tiket part-lengkap naik PROSES; barang tanpa tiket tetap tercatat tanpa masuk stok.</p>
            </div>
          </div>
        </CardContent>
      </Card>
      </div>

      {/* ===== 5 & 6 ditata satu baris penuh: tren multi-periode + analisa file ===== */}
      <div className="grid items-stretch gap-4 lg:grid-cols-2">

      {/* ===== 5. Analisa tren multi-periode (Mingguan / Bulanan / Tahunan) ===== */}
      <Card className="overflow-hidden border-slate-200/80 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg">
        <div className="h-1 bg-gradient-to-r from-rose-500 via-pink-400 to-rose-300" />
        <CardHeader className="flex-row items-start justify-between gap-2 space-y-0 pb-2">
          <div className="flex items-start gap-2.5">
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-rose-500 to-rose-700 shadow-sm">
              <TrendingUp className="h-4 w-4 text-white" />
            </div>
            <div>
              <CardTitle className="text-sm font-bold tracking-tight text-slate-900">Analisa Tren Multi-Periode</CardTitle>
              <CardDescription className="text-[11px] leading-snug">Indikator SEMUA data per minggu / bulan / tahun — tiket, SLA, klaim, kunjungan, unit.</CardDescription>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-1">
            {(['MINGGU', 'BULAN', 'TAHUN'] as const).map((p) => (
              <Button
                key={p}
                size="sm"
                variant={trenPeriode === p ? 'default' : 'outline'}
                className={cn('h-7 px-2 text-[11px]', trenPeriode === p ? 'bg-rose-600 hover:bg-rose-700' : 'border-rose-300 text-rose-700 hover:bg-rose-50')}
                disabled={trenMut.isPending}
                onClick={() => { setTrenPeriode(p); queryClient.setQueryData(['ai-tren'], null) }}
              >
                {p === 'MINGGU' ? 'Mingguan' : p === 'BULAN' ? 'Bulanan' : 'Tahunan'}
              </Button>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          {trenMut.isPending ? (
            <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
          ) : tren ? (
            <div className="space-y-2.5">
              {/* Kartu total semua data */}
              <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
                {([
                  ['Tiket Masuk', tren.total.tiketMasuk], ['Tiket Selesai', tren.total.tiketSelesai], ['SLA Lewat', tren.total.slaLewat],
                  ['Klaim', tren.total.klaimDiajukan], ['Kunjungan', tren.total.kunjungan], ['Unit Baru', tren.total.unitBaru],
                ] as const).map(([label, nilai]) => (
                  <div key={label} className="rounded-lg border border-rose-100 bg-rose-50/50 px-1.5 py-1 text-center">
                    <p className="text-[9px] font-semibold uppercase tracking-wide text-rose-700/80">{label}</p>
                    <p className="text-sm font-bold text-slate-900">{nilai.toLocaleString('id-ID')}</p>
                  </div>
                ))}
              </div>
              {/* Grafik batang per periode */}
              <div className="h-44 rounded-lg border border-slate-100 bg-white p-1">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={tren.series.map((s) => ({ label: s.label, Masuk: s.tiketMasuk, Selesai: s.tiketSelesai, Klaim: s.klaimDiajukan, Kunjungan: s.kunjungan }))}
                    margin={{ top: 4, right: 4, left: -18, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                    <XAxis dataKey="label" tick={{ fontSize: 9 }} interval="preserveStartEnd" angle={tren.series.length > 14 ? -40 : 0} textAnchor={tren.series.length > 14 ? 'end' : 'middle'} height={tren.series.length > 14 ? 34 : 20} />
                    <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                    <Tooltip contentStyle={{ fontSize: 11 }} />
                    <Legend wrapperStyle={{ fontSize: 10 }} />
                    <Bar dataKey="Masuk" fill="#e11d48" radius={[2, 2, 0, 0]} />
                    <Bar dataKey="Selesai" fill="#059669" radius={[2, 2, 0, 0]} />
                    <Bar dataKey="Klaim" fill="#0284c7" radius={[2, 2, 0, 0]} />
                    <Bar dataKey="Kunjungan" fill="#7c3aed" radius={[2, 2, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              {/* Narasi AI (opsional) */}
              {tren.narasi && (
                <div className="rounded-xl border border-rose-200 bg-rose-50/50 p-2.5">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <Badge variant="outline" className="border-rose-300 text-[10px] text-rose-700">AI · {tren.model}</Badge>
                    <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-slate-400 hover:text-slate-700" onClick={() => queryClient.setQueryData(['ai-tren'], { ...tren, narasi: null })} aria-label="Tutup narasi">
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                  <p className="whitespace-pre-wrap text-xs leading-relaxed text-slate-700">{tren.narasi}</p>
                </div>
              )}
              {tren.catatan && <p className="text-[10px] text-amber-700">{tren.catatan}</p>}
              {/* Tabel lengkap semua periode */}
              <div className="max-h-52 overflow-y-auto rounded-lg border border-slate-100">
                <table className="w-full text-[10px]">
                  <thead className="sticky top-0 bg-slate-50 text-slate-500">
                    <tr>
                      {['Periode', 'Masuk', 'Selesai', 'SLA', 'Klaim', 'Kunjungan', 'Unit Baru'].map((h) => (
                        <th key={h} className="px-1.5 py-1 text-left font-semibold">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {tren.series.map((s) => (
                      <tr key={s.key} className="border-t border-slate-50 text-slate-700 odd:bg-white even:bg-slate-50/40">
                        <td className="px-1.5 py-0.5 font-medium">{s.label}</td>
                        <td className="px-1.5 py-0.5">{s.tiketMasuk}</td>
                        <td className="px-1.5 py-0.5">{s.tiketSelesai}</td>
                        <td className={cn('px-1.5 py-0.5', s.slaLewat > 0 && 'font-semibold text-rose-600')}>{s.slaLewat}</td>
                        <td className="px-1.5 py-0.5">{s.klaimDiajukan}</td>
                        <td className="px-1.5 py-0.5">{s.kunjungan}</td>
                        <td className="px-1.5 py-0.5">{s.unitBaru}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 p-4 text-center text-xs text-slate-400">
              Pilih Mingguan / Bulanan / Tahunan lalu data seluruh riwayat disajikan sebagai indikator + grafik (+ narasi AI bila tersedia).
            </p>
          )}
          {!tren && !trenMut.isPending && (
            <div className="mt-2 text-center">
              <Button size="sm" className="h-7 bg-rose-600 px-3 text-[11px] hover:bg-rose-700" onClick={() => trenMut.mutate()}>
                {trenMut.isPending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <BarChart3 className="mr-1 h-3 w-3" />} Tampilkan Indikator
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ===== 6. Analisa file Excel vs data aplikasi ===== */}
      <Card className="overflow-hidden border-slate-200/80 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg">
        <div className="h-1 bg-gradient-to-r from-sky-500 via-blue-400 to-sky-300" />
        <CardHeader className="flex-row items-start justify-between gap-2 space-y-0 pb-2">
          <div className="flex items-start gap-2.5">
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-sky-500 to-sky-700 shadow-sm">
              <UploadCloud className="h-4 w-4 text-white" />
            </div>
            <div>
              <CardTitle className="text-sm font-bold tracking-tight text-slate-900">Analisa File Excel vs Data Aplikasi</CardTitle>
              <CardDescription className="text-[11px] leading-snug">Unggah Excel/CSV apa pun — AI membandingkan dengan master toko, part, tiket & klaim.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-2.5">
          <div className="space-y-1.5">
            <Label>File Excel/CSV (.xlsx · .xls · .csv, maks 8 MB)</Label>
            <Input
              type="file"
              accept=".xlsx,.xls,.csv"
              className="h-9 text-[11px] file:mr-2 file:h-7 file:rounded-md file:border-0 file:bg-sky-100 file:px-2 file:text-[11px] file:text-sky-800"
              onChange={(e) => { setFileAnalisa(e.target.files?.[0] ?? null); queryClient.setQueryData(['ai-upload'], null) }}
            />
            {fileAnalisa && <p className="font-mono text-[10px] text-slate-500">{fileAnalisa.name} · {(fileAnalisa.size / 1024).toFixed(0)} KB</p>}
          </div>
          <div className="space-y-1.5">
            <Label>Pertanyaan spesifik (opsional)</Label>
            <HistoryInput historyKey="ai-analisa-upload" value={pertanyaanAnalisa} onChange={(e) => setPertanyaanAnalisa(e.target.value)} placeholder="cth: toko mana yang belum terdaftar? selisih stok mana?" />
          </div>
          <Button
            size="sm" className="bg-sky-600 hover:bg-sky-700"
            disabled={uploadMut.isPending || !fileAnalisa}
            onClick={() => uploadMut.mutate()}
          >
            {uploadMut.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Sparkles className="mr-1 h-4 w-4" />}
            {uploadMut.isPending ? 'Menganalisa…' : 'Analisa & Bandingkan AI'}
          </Button>
          {hasilUpload && (
            <div className="rounded-xl border border-sky-200 bg-sky-50/50 p-2.5">
              <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                {hasilUpload.analisa ? (
                  <Badge variant="outline" className="border-sky-300 text-[10px] text-sky-700">AI · {hasilUpload.model}</Badge>
                ) : (
                  <Badge variant="outline" className="border-slate-300 bg-white text-[10px] text-slate-600">Perbandingan mesin (AI tidak tersedia)</Badge>
                )}
                <div className="flex items-center gap-1">
                  <Badge variant="outline" className="text-[10px]">{hasilUpload.fileMeta.jumlahBaris} baris</Badge>
                  <Badge variant="outline" className="text-[10px]">{hasilUpload.fileMeta.kolom.length} kolom</Badge>
                  <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-slate-400 hover:text-slate-700" onClick={() => queryClient.setQueryData(['ai-upload'], null)} aria-label="Tutup hasil analisa">
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              </div>
              <p className="mb-1.5 font-mono text-[10px] text-slate-500">{hasilUpload.fileMeta.namaFile} · sheet “{hasilUpload.fileMeta.sheet}” · {hasilUpload.fileMeta.kolom.join(' · ')}</p>
              {hasilUpload.statistik.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-1">
                  {hasilUpload.statistik.map((s) => (
                    <Badge key={s.kolom} variant="outline" className="text-[9px]" title={`${s.terisiAngka} angka · min ${s.minimum} · max ${s.maksimum}`}>
                      {s.kolom}: avg {s.rataRata.toLocaleString('id-ID')}
                    </Badge>
                  ))}
                </div>
              )}
              {/* Bandingkan deterministik — tampil selalu, AI atau bukan */}
              <div className="mb-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {([
                  ['Toko', hasilUpload.bandingkan.tokoCocok, hasilUpload.bandingkan.tokoTidak],
                  ['Part', hasilUpload.bandingkan.partCocok, hasilUpload.bandingkan.partTidak],
                ] as const).map(([judul, cocok, tidak]) => (
                  <div key={judul} className="rounded-lg border border-sky-100 bg-white p-2">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-sky-800">{judul}</p>
                    <p className="mt-0.5 text-[10px] text-slate-600">
                      <span className="font-semibold text-emerald-700">{cocok.length} terdaftar</span>
                      {' · '}
                      <span className="font-semibold text-rose-600">{tidak.length} tak dikenal</span>
                    </p>
                    <div className="mt-1 flex flex-wrap gap-0.5">
                      {cocok.slice(0, 6).map((v) => (
                        <span key={`c-${v}`} className="rounded bg-emerald-50 px-1 py-0.5 font-mono text-[9px] text-emerald-700">{v}</span>
                      ))}
                      {tidak.slice(0, 6).map((v) => (
                        <span key={`t-${v}`} className="rounded bg-rose-50 px-1 py-0.5 font-mono text-[9px] text-rose-700">{v}</span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              {hasilUpload.catatan && <p className="mb-1.5 text-[10px] text-amber-700">{hasilUpload.catatan}</p>}
              {hasilUpload.analisa && <p className="whitespace-pre-wrap text-xs leading-relaxed text-slate-700">{hasilUpload.analisa}</p>}
            </div>
          )}
        </CardContent>
      </Card>
      </div>

      {/* ===== 7. Chat AI interaktif dua arah (dengan konteks pergerakan aplikasi) ===== */}
      <AiChat />

      <SuratJalanMasukDialog open={sjMasukOpen} onOpenChange={setSjMasukOpen} />

      <p className="text-center text-[11px] text-slate-400">
        Ditenagai 9router di mesin ini · atur model & kunci di Pengaturan → AI Suggest · data yang dikirim hanya ringkasan operasional.
      </p>
    </div>
  )
}
