'use client'

import { useEffect, useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetcher, postJson, formatWaktu, type Toko, type Pengguna, type Kunjungan } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Checkbox } from '@/components/ui/checkbox'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useToast } from '@/hooks/use-toast'
import { useAppStore } from '@/lib/store'
import { MapPin, ScanLine, Camera, CheckCircle2, Clock, Navigation, Users, QrCode, X, Pencil, CalendarDays, Sparkles, Loader2, Map as MapIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import VisionScanner from '@/components/vision-scanner'
import ScanToko from '@/components/scan-toko'
import TokoMapDialog from '@/components/toko-map-dialog'
import QuickSearch, { matchQuery } from '@/components/quick-search'
import SearchSelect from '@/components/search-select'
import HistoryInput from '@/components/history-input'

export default function FieldOpsView() {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const { role, navIntent, clearNavIntent } = useAppStore()

  // ===== State check-in manual =====
  const [checkinOpen, setCheckinOpen] = useState(false)
  const [selectedToko, setSelectedToko] = useState<Toko | null>(null)
  // Peta posisi toko (OpenStreetMap) — dibuka saat klik nama toko / ikon peta
  const [mapToko, setMapToko] = useState<Toko | null>(null)
  const [teknisiId, setTeknisiId] = useState('')
  const [catatanManual, setCatatanManual] = useState('')
  const [fotoFile, setFotoFile] = useState('')
  const [tglManual, setTglManual] = useState('')
  // Filter drill-down dari Dashboard (KPI "Toko Telat Visit")
  const [onlyLate, setOnlyLate] = useState(false)

  // Konsumsi navIntent dari Dashboard → filter toko terlambat / scroll ke riwayat
  // (dijalankan di callback async agar tidak setState sinkron di effect body)
  useEffect(() => {
    if (!navIntent) return
    const t = setTimeout(() => {
      if (navIntent.fieldOpsFilter === 'terlambat') {
        setOnlyLate(true)
        document.getElementById('kepatuhan-visit')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      } else if (navIntent.fieldOpsFilter === 'kunjungan') {
        document.getElementById('riwayat-kunjungan')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }
      clearNavIntent()
    }, 250)
    return () => clearTimeout(t)
  }, [navIntent, clearNavIntent])

  const { data: tokoList, isLoading: tokoLoading } = useQuery<Toko[]>({
    queryKey: ['toko'],
    queryFn: () => fetcher<Toko[]>('/api/toko'),
  })
  const { data: teknisiList } = useQuery<Pengguna[]>({
    queryKey: ['pengguna'],
    queryFn: () => fetcher<Pengguna[]>('/api/pengguna'),
  })
  const { data: kunjunganList, isLoading: kunjunganLoading } = useQuery<Kunjungan[]>({
    queryKey: ['kunjungan'],
    queryFn: () => fetcher<Kunjungan[]>('/api/kunjungan'),
  })

  const teknisiOnly = useMemo(() => (teknisiList ?? []).filter((t) => t.role === 'TEKNISI'), [teknisiList])
  const [cariToko, setCariToko] = useState('')
  const tokoTampil = useMemo(
    () => (tokoList ?? [])
      .filter((t) => (onlyLate ? t.visitTerlambat : true))
      .filter((t) => matchQuery([t.kodeToko, t.namaToko, t.alamat, t.kontak, t.barcodeToko], cariToko))
      // Sudah dikunjungi otomatis ke kiri; belum pernah visit ke kanan (stabil di tiap kelompok)
      .sort((a, b) => Number(!!b.tglVisitTerakhir) - Number(!!a.tglVisitTerakhir)),
    [tokoList, onlyLate, cariToko]
  )
  const [cariKunjungan, setCariKunjungan] = useState('')
  const kunjunganTampil = useMemo(
    () => (kunjunganList ?? []).filter((k) => matchQuery([k.toko.kodeToko, k.toko.namaToko, k.teknisi.nama, k.teknisi.wilayahKerja, k.catatanStokRusak, k.barcodeTerscan, k.metodeCheckin], cariKunjungan)),
    [kunjunganList, cariKunjungan]
  )

  // ===== Saran jadwal kunjungan 6 hari kerja (analisa data toko) =====
  // Skor: terlambat dulu (makin lama makin atas, tie-break unit terbanyak),
  // lalu bagi rata ke 6 hari kerja ke depan (lewati Minggu). Teknisi tinggal mengikuti.
  const skorToko = (t: Toko) => (t.visitTerlambat ? 1000 + (t.hariSejakVisit ?? t.frekuensiVisit) : 0) * 100 + t.jumlahUnit
  const isoLokal = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const saranJadwal = useMemo(() => {
    const urut = [...(tokoList ?? [])].sort((a, b) => skorToko(b) - skorToko(a))
    const hari: Date[] = []
    const d = new Date()
    while (hari.length < 6) {
      if (d.getDay() !== 0) hari.push(new Date(d))
      d.setDate(d.getDate() + 1)
    }
    const dasar = Math.floor(urut.length / 6)
    let sisa = urut.length % 6
    const rencana: { iso: string; tanggal: Date; toko: Toko[] }[] = []
    let idx = 0
    for (const tanggal of hari) {
      const jml = dasar + (sisa > 0 ? 1 : 0)
      if (sisa > 0) sisa--
      rencana.push({ iso: isoLokal(tanggal), tanggal, toko: urut.slice(idx, idx + jml) })
      idx += jml
    }
    return rencana
  }, [tokoList])
  const totalTerlambat = useMemo(() => (tokoList ?? []).filter((t) => t.visitTerlambat).length, [tokoList])
  const isoKeTanggal = useMemo(() => new Map(saranJadwal.map((h) => [h.iso, h.tanggal])), [saranJadwal])
  const namaTokoMap = useMemo(() => new Map((tokoList ?? []).map((t) => [t.kodeToko.toUpperCase(), t.namaToko])), [tokoList])

  // ===== Saran AI via 9router (jadwal versi AI + alasan per hari) =====
  interface AiRencana {
    rencana: { hari: string; kode: string[]; alasan: string }[]
    catatan: string
    model: string
    takTerjadwal: string[]
  }
  const [aiSaran, setAiSaran] = useState<AiRencana | null>(null)
  const aiMut = useMutation({
    mutationFn: () => {
      const prioritas = [...(tokoList ?? [])].sort((a, b) => skorToko(b) - skorToko(a)).slice(0, 30)
      return postJson<AiRencana>('/api/ai/suggest', {
        stores: prioritas.map((t) => ({
          kode: t.kodeToko,
          nama: t.namaToko,
          siklus: t.frekuensiVisit,
          sejakHari: t.hariSejakVisit,
          unit: t.jumlahUnit,
          terlambat: t.visitTerlambat,
        })),
        hari: saranJadwal.map((h) => h.iso),
      })
    },
    onSuccess: (r) => {
      setAiSaran(r)
      toast({ title: 'Saran AI diterima', description: `${r.rencana.length} hari disusun (${r.model}). Jadwal otomatis tetap ada di bawah sebagai cadangan.` })
    },
    onError: (e: Error) => toast({ title: 'Saran AI gagal', description: e.message, variant: 'destructive' }),
  })

  // ===== Analisa frekuensi kunjungan AI — kategori A/B/C/D + jarak workshop =====
  // Kriteria: A = banyak laporan (repeat singkat 7h) · B = konsisten (14h) ·
  // C = jarang (21h) · D = belum pernah (30h) · jarak ikut dipertimbangkan bila ada.
  // TIDAK ada yang berubah otomatis — siklus baru hanya diterapkan untuk toko
  // yang dicentang + dikonfirmasi (allowed) via dialog, khusus Admin/Manager.
  interface FreqStat {
    id: number
    kode: string
    nama: string
    siklusAktif: number
    kategori: 'A' | 'B' | 'C' | 'D'
    siklusBaseline: number
    tiket90: number
    tiketAll: number
    mingguAktif: number
    kunjungan90: number
    terakhirLaporan: string | null
    terlambat: boolean
    hariSejakVisit: number | null
    unit: number
    jarakKm: number | null
  }
  interface FreqResponse {
    generatedAt: string
    windowHari: number
    mingguKonsistensi: number
    ambang: { aTiket90: number; aTiketAll: number; bMinggu: number; bTiket90: number }
    jarakTerisi: number
    jarakTotal: number
    toko: FreqStat[]
    ai: { saran: { kode: string; kategori: string; siklus: number; alasan: string }[]; catatan: string; model: string } | null
    aiError: string | null
  }
  const KAT_META: Record<string, { label: string; cls: string }> = {
    A: { label: 'A · Banyak laporan', cls: 'border-rose-300 bg-rose-50 text-rose-700' },
    B: { label: 'B · Konsisten', cls: 'border-amber-300 bg-amber-50 text-amber-700' },
    C: { label: 'C · Jarang', cls: 'border-sky-300 bg-sky-50 text-sky-700' },
    D: { label: 'D · Belum pernah', cls: 'border-slate-300 bg-slate-50 text-slate-500' },
  }
  const [freqHasil, setFreqHasil] = useState<FreqResponse | null>(null)
  const [freqCentang, setFreqCentang] = useState<string[]>([])
  const [freqConfirm, setFreqConfirm] = useState(false)
  const bolehUbahSiklus = role === 'ADMIN_WORKSHOP' || role === 'MANAGER'
  const freqMut = useMutation({
    mutationFn: () => postJson<FreqResponse>('/api/ai/frekuensi-visit', {}),
    onSuccess: (r) => {
      setFreqHasil(r)
      // Default dicentang: yang sarannya berubah dari siklus aktif
      const saranSiklus = (kode: string) =>
        r.ai?.saran.find((s) => s.kode.toUpperCase() === kode.toUpperCase())?.siklus ??
        r.toko.find((t) => t.kode.toUpperCase() === kode.toUpperCase())?.siklusBaseline
      setFreqCentang(
        r.toko.filter((t) => saranSiklus(t.kode) !== undefined && saranSiklus(t.kode) !== t.siklusAktif).map((t) => t.kode.toUpperCase())
      )
      toast({
        title: r.ai ? 'Analisa AI diterima' : 'Analisa aturan diterima',
        description: r.ai
          ? `${r.ai.saran.length} toko dinilai (${r.ai.model}). Centang + konfirmasi untuk menerapkan.`
          : `AI tidak tersedia (${r.aiError ?? 'gangguan'}) — memakai aturan baku kategori.`,
      })
    },
    onError: (e: Error) => toast({ title: 'Analisa gagal', description: e.message, variant: 'destructive' }),
  })
  const freqSaran = useMemo(() => {
    const m = new Map<string, { kategori: string; siklus: number; alasan: string }>()
    if (!freqHasil) return m
    for (const t of freqHasil.toko) {
      const s = freqHasil.ai?.saran.find((x) => x.kode.toUpperCase() === t.kode.toUpperCase())
      m.set(t.kode.toUpperCase(), s ?? { kategori: t.kategori, siklus: t.siklusBaseline, alasan: `Aturan baku kategori ${t.kategori} (AI tidak tersedia).` })
    }
    return m
  }, [freqHasil])
  const freqDiubah = useMemo(
    () => (freqHasil?.toko ?? []).filter((t) => freqCentang.includes(t.kode.toUpperCase())),
    [freqHasil, freqCentang]
  )
  const freqTerapkan = useMutation({
    mutationFn: () =>
      postJson<{ diterapkan: number }>('/api/ai/frekuensi-visit/terapkan', {
        perubahan: freqDiubah.map((t) => ({ id: t.id, siklus: freqSaran.get(t.kode.toUpperCase())?.siklus ?? t.siklusAktif })),
        aktor: role,
      }),
    onSuccess: (r) => {
      invalidateAll()
      setFreqConfirm(false)
      setFreqHasil(null)
      setFreqCentang([])
      toast({ title: 'Frekuensi diperbarui', description: `${r.diterapkan} toko mengikuti siklus baru atas persetujuan Anda.` })
    },
    onError: (e: Error) => toast({ title: 'Gagal menerapkan', description: e.message, variant: 'destructive' }),
  })

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['kunjungan'] })
    queryClient.invalidateQueries({ queryKey: ['toko'] })
    queryClient.invalidateQueries({ queryKey: ['dashboard'] })
    queryClient.invalidateQueries({ queryKey: ['alerts'] })
    queryClient.invalidateQueries({ queryKey: ['audit'] })
  }

  // Koreksi catatan kunjungan
  const [editKunj, setEditKunj] = useState<Kunjungan | null>(null)
  const [editCatatan, setEditCatatan] = useState('')
  const updateKunjungan = useMutation({
    mutationFn: () =>
      postJson(`/api/kunjungan/${editKunj!.id}`, { catatanStokRusak: editCatatan.trim() || null, aktor: role === 'TEKNISI' ? 'Teknisi Lapangan' : 'Admin Workshop' }, 'PATCH'),
    onSuccess: () => {
      invalidateAll()
      setEditKunj(null)
      toast({ title: 'Kunjungan diperbarui', description: 'Koreksi catatan tersimpan.' })
    },
    onError: (e: Error) => toast({ title: 'Gagal memperbarui kunjungan', description: e.message, variant: 'destructive' }),
  })

  // Nilai default input datetime-local (format lokal — bukan UTC)
  const dtLocalNow = () => {
    const d = new Date()
    const p = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
  }

  // ===== Check-in manual =====
  const manualCheckin = useMutation({
    mutationFn: () =>
      postJson('/api/kunjungan', {
        tokoId: selectedToko?.id,
        teknisiId: Number(teknisiId),
        metodeCheckin: 'MANUAL',
        tglKunjungan: tglManual ? new Date(tglManual).toISOString() : undefined,
        catatanStokRusak: catatanManual || null,
        fotoOnsite: fotoFile.trim() || null,
      }),
    onSuccess: () => {
      invalidateAll()
      setCheckinOpen(false)
      setSelectedToko(null)
      setCatatanManual('')
      setFotoFile('')
      toast({ title: 'Check-in manual berhasil', description: 'Tanggal kunjungan toko diperbarui — siklus visit direset.' })
    },
    onError: (e: Error) => toast({ title: 'Check-in gagal', description: e.message, variant: 'destructive' }),
  })

  const bukaCheckin = (toko: Toko) => {
    setSelectedToko(toko)
    setCheckinOpen(true)
    setFotoFile('')
    setTglManual(dtLocalNow())
    if (!teknisiId && teknisiOnly[0]) setTeknisiId(String(teknisiOnly[0].id))
  }

  return (
    <div className="space-y-4">
      {/* ===== Scan + Foto: dua kotak portable tipis yang sejajar ===== */}
      <div className="grid gap-3 xl:grid-cols-2">
        <ScanToko teknisiOnly={teknisiOnly} onChanged={invalidateAll} />
        {/* Pembaca foto & barcode — berdampingan sejajar dengan scan */}
        <VisionScanner channel="TELEGRAM" pengirimDefault="FIELD-OPS" compact thin />
      </div>

      {/* ===== Saran jadwal kunjungan 6 hari kerja — teknisi tinggal mengikuti ===== */}
      <Card className="border-teal-200">
        <CardHeader className="flex-row items-start justify-between gap-2 space-y-0 pb-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarDays className="h-4 w-4 text-teal-700" /> Saran Jadwal Kunjungan — 6 Hari Kerja
              {(tokoList ?? []).length > 0 && (
                <Badge variant="outline" className="border-teal-300 text-[10px] text-teal-700">
                  {(tokoList ?? []).length} toko · {totalTerlambat} terlambat
                </Badge>
              )}
            </CardTitle>
            <CardDescription className="text-xs">
              Otomatis dari keterlambatan, siklus, dan unit — mulai hari ini (lewati Minggu). Klik pin untuk check-in langsung.
            </CardDescription>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-7 shrink-0 border-violet-300 px-2 text-[11px] text-violet-700 hover:bg-violet-50"
            disabled={aiMut.isPending || (tokoList ?? []).length === 0}
            onClick={() => aiMut.mutate()}
            title="Minta AI (9router) menyusun ulang jadwal + alasan"
          >
            {aiMut.isPending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Sparkles className="mr-1 h-3 w-3" />}
            {aiMut.isPending ? 'Meminta…' : 'Saran AI'}
          </Button>
        </CardHeader>
        <CardContent>
          {aiSaran && (
            <div className="mb-3 rounded-xl border border-violet-300 bg-violet-50/50 p-2.5">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="flex min-w-0 items-center gap-1.5 text-xs font-bold text-violet-800">
                  <Sparkles className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">Saran AI · {aiSaran.model}</span>
                </p>
                <Button size="sm" variant="ghost" className="h-6 w-6 shrink-0 p-0 text-slate-400 hover:text-slate-700" onClick={() => setAiSaran(null)} aria-label="Tutup saran AI">
                  <X className="h-3 w-3" />
                </Button>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
                {aiSaran.rencana.map((r, i) => {
                  const tgl = isoKeTanggal.get(r.hari)
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
              {(aiSaran.catatan || aiSaran.takTerjadwal.length > 0) && (
                <p className="mt-2 text-[11px] text-violet-800">
                  {aiSaran.catatan}
                  {aiSaran.takTerjadwal.length > 0 && <span className="text-slate-500"> Tak terjadwal: {aiSaran.takTerjadwal.join(', ')}.</span>}
                </p>
              )}
            </div>
          )}
          {tokoLoading ? (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-40" />)}
            </div>
          ) : saranJadwal.every((h) => h.toko.length === 0) ? (
            <p className="rounded-lg border border-dashed p-6 text-center text-xs text-slate-500">Belum ada data toko untuk disusun jadwalnya.</p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
              {saranJadwal.map((h, i) => (
                <div key={i} className="rounded-lg border bg-white">
                  <div className="border-b px-2.5 py-1.5">
                    <p className="text-xs font-bold text-slate-800">{h.tanggal.toLocaleDateString('id-ID', { weekday: 'long' })}</p>
                    <p className="text-[10px] text-slate-400">{h.tanggal.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })} · {h.toko.length} toko</p>
                  </div>
                  <div className="max-h-56 space-y-1 overflow-y-auto p-1.5">
                    {h.toko.length === 0 ? (
                      <p className="py-3 text-center text-[10px] text-slate-400">— kosong —</p>
                    ) : (
                      h.toko.map((t) => (
                        <div key={t.id} className="flex items-center gap-1.5 rounded-md bg-slate-50 px-1.5 py-1">
                          <div className="min-w-0 flex-1">
                            <button
                              type="button"
                              onClick={() => setMapToko(t)}
                              className="block max-w-full truncate text-left text-[11px] font-medium text-slate-800 underline-offset-2 hover:text-teal-700 hover:underline"
                              title={`${t.namaToko} · klik untuk lihat peta`}
                            >
                              {t.namaToko}
                            </button>
                            <p className="font-mono text-[9px] text-slate-400">{t.kodeToko}</p>
                          </div>
                          {t.visitTerlambat && (
                            <Badge variant="outline" className="shrink-0 border-rose-300 px-1 text-[8px] text-rose-700">TERLAMBAT</Badge>
                          )}
                          <Button size="sm" variant="ghost" className="h-6 w-6 shrink-0 p-0 text-slate-400 hover:text-emerald-700" onClick={() => bukaCheckin(t)} aria-label={`Check-in ${t.namaToko}`} title="Check-in langsung">
                            <MapPin className="h-3 w-3" />
                          </Button>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ===== Analisa frekuensi kunjungan AI — saran siklus per toko ===== */}
      <Card className="border-violet-200">
        <CardHeader className="flex-row items-start justify-between gap-2 space-y-0 pb-2">
          <div>
            <CardTitle className="flex flex-wrap items-center gap-2 text-base">
              <Sparkles className="h-4 w-4 text-violet-600" /> Analisa Frekuensi Kunjungan AI
              <Badge variant="outline" className="border-violet-300 text-[10px] text-violet-700">Powered AI</Badge>
            </CardTitle>
            <CardDescription className="text-xs">
              Saran siklus per toko dari laporan kerusakan + konsistensi + jarak — tidak ada yang berubah sebelum Anda mencentang &amp; mengonfirmasi.
            </CardDescription>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-7 shrink-0 border-violet-300 px-2 text-[11px] text-violet-700 hover:bg-violet-50"
            disabled={freqMut.isPending || (tokoList ?? []).length === 0}
            onClick={() => freqMut.mutate()}
            title="AI menilai tiap toko (kategori A/B/C/D + jarak) dan menyarankan siklus"
          >
            {freqMut.isPending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Sparkles className="mr-1 h-3 w-3" />}
            {freqMut.isPending ? 'Menganalisa…' : 'Jalankan Analisa'}
          </Button>
        </CardHeader>
        <CardContent>
          {/* Legenda kriteria yang masuk pertimbangan */}
          <div className="mb-3 grid gap-1.5 text-[11px] sm:grid-cols-2 xl:grid-cols-4">
            <p className="rounded-lg border border-rose-200 bg-rose-50/60 px-2 py-1.5 text-rose-800">
              <span className="font-bold">A · Banyak laporan</span> — ≥{freqHasil?.ambang.aTiket90 ?? 5} tiket/90h atau ≥{freqHasil?.ambang.aTiketAll ?? 10} total → <span className="font-bold">4 hari</span> (repeat singkat)
            </p>
            <p className="rounded-lg border border-amber-200 bg-amber-50/60 px-2 py-1.5 text-amber-800">
              <span className="font-bold">B · Konsisten</span> — aktif ≥{freqHasil?.ambang.bMinggu ?? 6} dari {freqHasil?.mingguKonsistensi ?? 12} minggu + ≥{freqHasil?.ambang.bTiket90 ?? 2} tiket/90h → <span className="font-bold">7 hari</span>
            </p>
            <p className="rounded-lg border border-sky-200 bg-sky-50/60 px-2 py-1.5 text-sky-800">
              <span className="font-bold">C · Jarang</span> — pernah ada laporan tapi tak memenuhi A/B → <span className="font-bold">10 hari</span>
            </p>
            <p className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-slate-600">
              <span className="font-bold">D · Belum pernah</span> — nol laporan kerusakan → <span className="font-bold">10 hari</span> (maksimal)
            </p>
          </div>
          <p className="mb-3 text-[11px] text-slate-500">
            Jarak workshop: {freqHasil ? <span className="font-semibold text-slate-700">{freqHasil.jarakTerisi}/{freqHasil.jarakTotal} toko terisi</span> : `${(tokoList ?? []).filter((t) => t.jarakKm !== null).length}/${(tokoList ?? []).length} toko terisi`} —
            AI mempertimbangkannya bila ada (toko jauh + C/D → siklus panjang hemat biaya). Lengkapi di Master Data / CSV; otomatis penuh saat maps terintegrasi.
          </p>

          {freqHasil ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                {(['A', 'B', 'C', 'D'] as const).map((k) => (
                  <Badge key={k} variant="outline" className={cn('text-[10px]', KAT_META[k].cls)}>
                    {KAT_META[k].label}: {freqHasil.toko.filter((t) => (freqSaran.get(t.kode.toUpperCase())?.kategori ?? t.kategori) === k).length}
                  </Badge>
                ))}
                {freqHasil.ai
                  ? <span className="ml-auto text-slate-400">Model {freqHasil.ai.model}{freqHasil.ai.catatan ? ` · ${freqHasil.ai.catatan}` : ''}</span>
                  : <span className="ml-auto text-amber-600">Mode aturan baku (AI: {freqHasil.aiError ?? 'tidak tersedia'})</span>}
              </div>

              <div className="max-h-80 overflow-auto rounded-md border">
                <Table>
                  <TableHeader className="sticky top-0 z-10 bg-slate-50">
                    <TableRow>
                      <TableHead className="w-8 text-[10px]">OK</TableHead>
                      <TableHead className="text-[10px]">Toko</TableHead>
                      <TableHead className="text-[10px]">Kat</TableHead>
                      <TableHead className="hidden text-[10px] sm:table-cell">Laporan</TableHead>
                      <TableHead className="text-[10px]">Siklus</TableHead>
                      <TableHead className="hidden text-[10px] md:table-cell">Alasan AI</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {freqHasil.toko.map((t) => {
                      const s = freqSaran.get(t.kode.toUpperCase())!
                      const berubah = s.siklus !== t.siklusAktif
                      const kode = t.kode.toUpperCase()
                      return (
                        <TableRow key={t.id} className={cn(berubah && freqCentang.includes(kode) && 'bg-violet-50/50')}>
                          <TableCell>
                            <Checkbox
                              checked={freqCentang.includes(kode)}
                              onCheckedChange={(v) => setFreqCentang((cs) => (v ? [...cs, kode] : cs.filter((c) => c !== kode)))}
                              aria-label={`Setujui perubahan ${t.kode}`}
                              disabled={!berubah}
                            />
                          </TableCell>
                          <TableCell>
                            <p className="text-xs font-medium text-slate-800">{t.nama}</p>
                            <p className="font-mono text-[10px] text-slate-400">
                              {t.kode} · {t.unit}u{t.jarakKm !== null ? ` · ${t.jarakKm}km` : ' · jarak ?'}
                              {t.terlambat ? ' · TERLAMBAT' : ''}
                            </p>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className={cn('text-[10px]', KAT_META[s.kategori]?.cls ?? KAT_META[t.kategori].cls)}>
                              {s.kategori}
                            </Badge>
                          </TableCell>
                          <TableCell className="hidden whitespace-nowrap text-[11px] text-slate-600 sm:table-cell">
                            {t.tiket90}/90h · {t.tiketAll} tot · {t.mingguAktif}/12 mgg
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-[11px]">
                            <span className="text-slate-500">{t.siklusAktif}h</span>
                            <span className="mx-1 text-slate-300">→</span>
                            <span className={cn('font-bold', berubah ? 'text-violet-700' : 'text-slate-400')}>{s.siklus}h</span>
                          </TableCell>
                          <TableCell className="hidden max-w-64 md:table-cell">
                            <p className="truncate text-[11px] italic text-violet-800" title={s.alasan}>{s.alasan || '—'}</p>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <p className="text-xs text-slate-600"><span className="font-bold text-slate-800">{freqDiubah.length}</span> toko dicentang</p>
                {!bolehUbahSiklus && <span className="text-[11px] text-amber-600">Hanya Admin/Manager yang dapat menerapkan (Anda login sebagai {role}).</span>}
                <div className="ml-auto flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => { setFreqHasil(null); setFreqCentang([]) }}>Tutup</Button>
                  <Button
                    size="sm"
                    className="bg-violet-600 hover:bg-violet-700"
                    disabled={freqDiubah.length === 0 || !bolehUbahSiklus || freqTerapkan.isPending}
                    onClick={() => setFreqConfirm(true)}
                    title={bolehUbahSiklus ? 'Minta konfirmasi sebelum mengubah siklus toko' : 'Khusus Admin/Manager'}
                  >
                    {freqTerapkan.isPending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <CheckCircle2 className="mr-1 h-3 w-3" />}
                    Terapkan yang Disetujui ({freqDiubah.length})
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <p className="rounded-lg border border-dashed p-4 text-center text-xs text-slate-500">
              Klik <span className="font-semibold">Jalankan Analisa</span> — AI menilai {((tokoList ?? []).length)} toko dan menyarankan siklus 4/7/10 hari beserta alasannya.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Dialog persetujuan (allowed) sebelum siklus diubah */}
      <Dialog open={freqConfirm} onOpenChange={setFreqConfirm}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Setujui Perubahan Siklus?</DialogTitle>
            <DialogDescription>
              {freqDiubah.length} toko akan diubah frekuensi visit-nya. Tindakan tercatat di Audit Log.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-64 space-y-1.5 overflow-y-auto rounded-lg border bg-slate-50/70 p-2.5">
            {freqDiubah.map((t) => {
              const s = freqSaran.get(t.kode.toUpperCase())!
              return (
                <p key={t.id} className="text-[11px] text-slate-700">
                  <span className="font-mono font-semibold">{t.kode}</span> · {t.nama}:{' '}
                  <span className="text-slate-400">{t.siklusAktif} hari</span> → <span className="font-bold text-violet-700">{s.siklus} hari</span>{' '}
                  <span className="text-slate-400">(kat {s.kategori})</span>
                </p>
              )
            })}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFreqConfirm(false)}>Batal</Button>
            <Button className="bg-violet-600 hover:bg-violet-700" disabled={freqTerapkan.isPending} onClick={() => freqTerapkan.mutate()}>
              {freqTerapkan.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-1 h-4 w-4" />}
              Ya, Terapkan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Peta kepatuhan kunjungan */}
      <Card id="kepatuhan-visit">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Navigation className="h-4 w-4 text-emerald-600" /> Kepatuhan Jadwal Kunjungan Toko
          </CardTitle>
          <CardDescription>ALT-01: toko harus dikunjungi sesuai siklus (frekuensi visit). Gunakan Scan Kunjungan di atas untuk check-in otomatis via barcode toko.</CardDescription>
          {onlyLate && (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <span className="text-xs text-slate-500">Filter dari Dashboard:</span>
              <Badge variant="outline" className="gap-1 border-rose-300 bg-rose-50 text-rose-700">
                Hanya TOKO TERLAMBAT · {tokoTampil.length} toko
                <button
                  type="button"
                  aria-label="Tampilkan semua toko"
                  onClick={() => setOnlyLate(false)}
                  className="ml-0.5 rounded-full p-0.5 hover:bg-rose-100"
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            </div>
          )}
        </CardHeader>
        <CardContent>
          <div className="mb-3">
            <QuickSearch value={cariToko} onChange={setCariToko} placeholder="Cari kode / nama / alamat toko…" className="max-w-xs" resultCount={tokoTampil.length} />
          </div>
          {tokoLoading ? (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-14" />)}
            </div>
          ) : tokoTampil.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <CheckCircle2 className="h-8 w-8 text-emerald-500" />
              <p className="text-sm font-medium text-slate-700">
                {cariToko.trim() ? 'Tidak ada toko yang cocok dengan pencarian' : 'Tidak ada toko yang terlambat visit'}
              </p>
              <p className="text-xs text-slate-500">
                {cariToko.trim()
                  ? 'Ubah kata kunci pencarian atau nonaktifkan filter terlambat.'
                  : onlyLate ? 'Semua toko ON TRACK — hapus filter untuk melihat seluruh toko.' : 'Belum ada data toko terdaftar.'}
              </p>
            </div>
          ) : (
            <div className="grid max-h-[560px] gap-2 overflow-y-auto pr-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
              {tokoTampil.map((t) => {
                const late = t.visitTerlambat
                return (
                  <div key={t.id} className={cn('flex items-center gap-2 rounded-lg border px-2.5 py-2 transition hover:shadow-sm', late ? 'border-rose-200 bg-rose-50/50' : 'bg-white')}>
                    <div className="min-w-0 flex-1">
                      <button
                        type="button"
                        onClick={() => setMapToko(t)}
                        className="block max-w-full truncate text-left text-xs font-semibold text-slate-800 underline-offset-2 hover:text-teal-700 hover:underline"
                        title={t.alamat ? `${t.namaToko} — ${t.alamat} · klik untuk lihat peta` : `${t.namaToko} · klik untuk lihat peta`}
                      >
                        {t.namaToko}
                      </button>
                      <p className="truncate font-mono text-[10px] text-slate-400" title={`${t.kodeToko} · ${t.barcodeToko}`}>
                        {t.kodeToko} · siklus {t.frekuensiVisit}h · sejak {t.hariSejakVisit ?? '∞'}h · {t.jumlahUnit}u
                      </p>
                    </div>
                    <Badge variant="outline" className={cn('shrink-0 text-[9px]', late ? 'border-rose-300 bg-rose-100 text-rose-700' : 'border-emerald-300 bg-emerald-50 text-emerald-700')}>
                      {late ? 'TERLAMBAT' : 'ON TRACK'}
                    </Badge>
                    <Button size="sm" variant="outline" className="h-7 w-7 shrink-0 border-slate-200 p-0 text-slate-400 hover:border-teal-300 hover:text-teal-700" onClick={() => setMapToko(t)} aria-label={`Lihat peta ${t.namaToko}`} title="Lihat peta lokasi toko">
                      <MapIcon className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="sm" className={cn('h-7 w-7 shrink-0 p-0', late ? 'bg-rose-600 hover:bg-rose-700' : 'bg-emerald-600 hover:bg-emerald-700')} onClick={() => bukaCheckin(t)} aria-label={`Check-in manual ${t.namaToko}`} title="Check-in Manual">
                      <MapPin className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Riwayat kunjungan */}
      <Card id="riwayat-kunjungan">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Clock className="h-4 w-4 text-slate-500" /> Riwayat Kunjungan Onsite
          </CardTitle>
          <CardDescription>Bukti kunjungan lapangan — metode check-in: scan barcode toko atau manual · {kunjunganTampil.length} kunjungan, gulir di dalam tabel</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-3">
            <QuickSearch value={cariKunjungan} onChange={setCariKunjungan} placeholder="Cari toko / teknisi / catatan…" className="max-w-xs" resultCount={kunjunganTampil.length} />
          </div>
          {kunjunganLoading ? (
            <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
          ) : kunjunganTampil.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500">{(kunjunganList ?? []).length === 0 ? 'Belum ada riwayat kunjungan.' : 'Tidak ada kunjungan yang cocok dengan pencarian.'}</p>
          ) : (
            <div className="max-h-[60vh] overflow-auto rounded-md border [&_thead]:sticky [&_thead]:top-0 [&_thead]:z-10 [&_thead]:bg-white [&_thead]:shadow-[0_1px_0_rgb(0_0_0/0.08)]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Waktu</TableHead>
                    <TableHead>Toko</TableHead>
                    <TableHead>Metode</TableHead>
                    <TableHead className="hidden sm:table-cell">Teknisi</TableHead>
                      <TableHead className="hidden md:table-cell">Catatan Stok Rusak</TableHead>
                      <TableHead className="hidden lg:table-cell">Foto</TableHead>
                      <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {kunjunganTampil.map((k) => (
                    <TableRow key={k.id}>
                      <TableCell className="whitespace-nowrap text-xs text-slate-600">{formatWaktu(k.tglKunjungan)}</TableCell>
                      <TableCell>
                        <p className="text-xs font-medium text-slate-800">{k.toko.namaToko}</p>
                        <p className="font-mono text-[10px] text-slate-400">{k.toko.kodeToko}</p>
                      </TableCell>
                      <TableCell>
                        {k.metodeCheckin === 'SCAN_BARCODE' ? (
                          <Badge variant="outline" className="gap-1 border-emerald-300 text-[10px] text-emerald-700">
                            <ScanLine className="h-2.5 w-2.5" /> SCAN
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px] text-slate-500">MANUAL</Badge>
                        )}
                        {k.barcodeTerscan && <p className="mt-0.5 font-mono text-[9px] text-slate-400">{k.barcodeTerscan}</p>}
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">
                        <p className="text-xs text-slate-700">{k.teknisi.nama}</p>
                        <p className="text-[10px] text-slate-400">{k.teknisi.wilayahKerja}</p>
                      </TableCell>
                      <TableCell className="hidden max-w-64 md:table-cell">
                        <p className="truncate text-xs text-slate-600">{k.catatanStokRusak ?? '-'}</p>
                      </TableCell>
                      <TableCell className="hidden lg:table-cell">
                        {k.fotoOnsite ? (
                          <Badge variant="outline" className="gap-1 text-[10px]"><Camera className="h-2.5 w-2.5" /> ada</Badge>
                        ) : (
                          <span className="text-xs text-slate-300">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px] text-slate-500 hover:text-emerald-700" onClick={() => { setEditKunj(k); setEditCatatan(k.catatanStokRusak ?? '') }} aria-label="Koreksi catatan kunjungan" title="Koreksi catatan">
                          <Pencil className="h-3 w-3" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Dialog koreksi catatan kunjungan */}
      <Dialog open={!!editKunj} onOpenChange={(o) => !o && setEditKunj(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Koreksi Catatan Kunjungan</DialogTitle>
            <DialogDescription>
              {editKunj && <span>{editKunj.toko.namaToko} ({editKunj.toko.kodeToko}) · {formatWaktu(editKunj.tglKunjungan)}</span>}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label>Catatan Stok Rusak / Kondisi Toko</Label>
            <HistoryInput historyKey="kunjungan-catatan" value={editCatatan} onChange={(e) => setEditCatatan(e.target.value)} placeholder="cth: 2 unit kipas display berderit…" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditKunj(null)}>Batal</Button>
            <Button className="bg-emerald-600 hover:bg-emerald-700" disabled={!editKunj || updateKunjungan.isPending} onClick={() => updateKunjungan.mutate()}>
              <Pencil className="mr-1 h-4 w-4" /> Simpan Koreksi
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog Check-in Manual */}
      <Dialog open={checkinOpen} onOpenChange={setCheckinOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <QrCode className="h-5 w-5 text-emerald-600" /> Check-in Manual
            </DialogTitle>
            <DialogDescription>
              {selectedToko ? `${selectedToko.namaToko} (${selectedToko.kodeToko}) — barcode toko: ${selectedToko.barcodeToko}` : ''} ·
              Untuk otomatis, gunakan Scan Kunjungan dengan barcode toko.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label><Users className="mr-1 inline h-3 w-3" /> Teknisi</Label>
                <SearchSelect
                  value={teknisiId}
                  onChange={setTeknisiId}
                  options={teknisiOnly.map((t) => ({ value: String(t.id), label: t.nama, sub: t.wilayahKerja ?? undefined }))}
                  placeholder="— Ketik nama teknisi —"
                  ariaLabel="Pilih teknisi"
                />
              </div>
              <div className="space-y-1.5">
                <Label><CalendarDays className="mr-1 inline h-3 w-3" /> Tanggal Check-in</Label>
                <Input type="datetime-local" value={tglManual} onChange={(e) => setTglManual(e.target.value)} aria-label="Tanggal check-in" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label><Camera className="mr-1 inline h-3 w-3" /> Foto Onsite <span className="font-normal text-slate-400">(opsional)</span></Label>
              <Input value={fotoFile} onChange={(e) => setFotoFile(e.target.value)} placeholder="Kosongkan bila tidak ada foto — cth: onsite-tok-001.jpg" className="font-mono text-xs" aria-label="Nama file foto onsite (opsional)" />
            </div>
            <div className="space-y-1.5">
              <Label>Catatan Stok Rusak / Temuan</Label>
              <HistoryInput historyKey="kunjungan-catatan" value={catatanManual} onChange={(e) => setCatatanManual(e.target.value)} placeholder="Contoh: 2 unit kipas display berderit, 1 pompa air tidak menyedot..." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCheckinOpen(false)}>Batal</Button>
            <Button
              className="bg-emerald-600 hover:bg-emerald-700"
              disabled={!selectedToko || !teknisiId || manualCheckin.isPending}
              onClick={() => manualCheckin.mutate()}
            >
              <CheckCircle2 className="mr-1 h-4 w-4" /> Simpan Check-in
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Peta posisi toko (OpenStreetMap + Leaflet, gratis) */}
      <TokoMapDialog toko={mapToko} onOpenChange={(o) => { if (!o) setMapToko(null) }} />
    </div>
  )
}
