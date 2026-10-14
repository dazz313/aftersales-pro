'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetcher, postJson, formatWaktu, type Toko, type Pengguna, type Kunjungan } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useToast } from '@/hooks/use-toast'
import { useAppStore } from '@/lib/store'
import { MapPin, ScanLine, Camera, CheckCircle2, Clock, Navigation, Users, QrCode, Barcode, XCircle, Video, VideoOff, Zap, X, Pencil, CalendarDays } from 'lucide-react'
import { cn } from '@/lib/utils'
import VisionScanner from '@/components/vision-scanner'
import QuickSearch, { matchQuery } from '@/components/quick-search'
import SearchSelect from '@/components/search-select'
import HistoryInput from '@/components/history-input'

interface LookupResult {
  toko: Toko
  jumlahUnit: number
  totalKunjungan: number
  hariSejakVisit: number | null
  visitTerlambat: boolean
  kunjunganTerakhir: { waktu: string; teknisi: string; metode: string } | null
}

export default function FieldOpsView() {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const { role, navIntent, clearNavIntent } = useAppStore()

  // ===== State scan kunjungan otomatis (barcode per toko) =====
  const [teknisiScanId, setTeknisiScanId] = useState('')
  const [manualBarcode, setManualBarcode] = useState('')
  const [cameraActive, setCameraActive] = useState(false)
  const [scanResult, setScanResult] = useState<{ ok: boolean; barcode: string; toko?: Toko; lookup?: LookupResult; error?: string } | null>(null)
  const [catatanOpen, setCatatanOpen] = useState(false)
  const [catatan, setCatatan] = useState('')
  const lastScanRef = useRef<HTMLDivElement>(null)
  const html5qrRef = useRef<{ stop: () => Promise<void>; clear: () => void } | null>(null)
  const processingRef = useRef(false)

  // ===== State check-in manual =====
  const [checkinOpen, setCheckinOpen] = useState(false)
  const [selectedToko, setSelectedToko] = useState<Toko | null>(null)
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
  const tokoTampil = useMemo(
    () => (onlyLate ? (tokoList ?? []).filter((t) => t.visitTerlambat) : tokoList ?? []),
    [tokoList, onlyLate]
  )
  const [cariKunjungan, setCariKunjungan] = useState('')
  const kunjunganTampil = useMemo(
    () => (kunjunganList ?? []).filter((k) => matchQuery([k.toko.kodeToko, k.toko.namaToko, k.teknisi.nama, k.teknisi.wilayahKerja, k.catatanStokRusak, k.barcodeTerscan, k.metodeCheckin], cariKunjungan)),
    [kunjunganList, cariKunjungan]
  )

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['kunjungan'] })
    queryClient.invalidateQueries({ queryKey: ['toko'] })
    queryClient.invalidateQueries({ queryKey: ['dashboard'] })
    queryClient.invalidateQueries({ queryKey: ['alerts'] })
    queryClient.invalidateQueries({ queryKey: ['audit'] })
  }

  // ===== Scan → lookup → auto check-in =====
  const checkinMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => postJson<Kunjungan>('/api/kunjungan', body),
    onSuccess: () => invalidateAll(),
  })

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

  const prosesBarcode = async (raw: string) => {
    const barcode = raw.trim()
    if (!barcode || processingRef.current) return
    processingRef.current = true
    setScanResult(null)

    try {
      // 1. Lookup toko dari barcode (per TOKO, bukan per unit)
      const lookup = await fetcher<LookupResult>(
        `/api/kunjungan/lookup?barcode=${encodeURIComponent(barcode)}`
      )

      // 2. Tentukan teknisi (pilihan user atau default teknisi pertama)
      const tId = teknisiScanId || (teknisiOnly[0] ? String(teknisiOnly[0].id) : '')
      if (!tId) {
        setScanResult({ ok: false, barcode, error: 'Teknisi belum tersedia — tambahkan karyawan peran Teknisi terlebih dahulu.' })
        return
      }

      // 3. Check-in OTOMATIS — kunjungan langsung tercatat di sistem
      const saved = await postJson<Kunjungan>('/api/kunjungan', {
        barcode,
        teknisiId: Number(tId),
        metodeCheckin: 'SCAN_BARCODE',
      })

      setScanResult({ ok: true, barcode, toko: saved.toko as unknown as Toko, lookup })
      invalidateAll()
      toast({
        title: 'Kunjungan tercatat otomatis',
        description: `${lookup.toko.namaToko} (${lookup.toko.kodeToko}) — check-in via scan barcode toko.`,
      })
    } catch (e) {
      setScanResult({ ok: false, barcode, error: (e as Error).message })
    } finally {
      processingRef.current = false
      setTimeout(() => lastScanRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 100)
    }
  }

  const stopCamera = async () => {
    if (html5qrRef.current) {
      try {
        await html5qrRef.current.stop()
        html5qrRef.current.clear()
      } catch {
        // kamera sudah berhenti
      }
      html5qrRef.current = null
    }
    setCameraActive(false)
  }

  const startCamera = async () => {
    if (cameraActive) return
    try {
      const { Html5Qrcode } = await import('html5-qrcode')
      const scanner = new Html5Qrcode('scan-toko-region')
      html5qrRef.current = scanner as unknown as { stop: () => Promise<void>; clear: () => void }
      await scanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 260, height: 160 } },
        (decoded: string) => {
          void stopCamera().then(() => prosesBarcode(decoded))
        },
        () => {
          // error per-frame (tidak ada barcode terlihat) — abaikan
        }
      )
      setCameraActive(true)
    } catch {
      void stopCamera()
      toast({
        title: 'Kamera tidak dapat diakses',
        description: 'Izin kamera ditolak atau perangkat tidak tersedia. Gunakan input manual di bawah kamera.',
        variant: 'destructive',
      })
    }
  }

  const bukaCatatan = () => {
    if (!scanResult?.toko) return
    setCatatan('')
    setCatatanOpen(true)
  }

  const simpanCatatan = useMutation({
    mutationFn: () =>
      postJson('/api/kunjungan', {
        tokoId: scanResult?.toko?.id,
        teknisiId: Number(teknisiScanId || (teknisiOnly[0]?.id ?? 0)),
        metodeCheckin: 'MANUAL',
        catatanStokRusak: catatan || null,
        fotoOnsite: `onsite-${(scanResult?.toko?.kodeToko ?? 'toko').toLowerCase()}-${Date.now()}.jpg`,
      }),
    onSuccess: () => {
      invalidateAll()
      setCatatanOpen(false)
      setCatatan('')
      toast({ title: 'Catatan kunjungan tersimpan', description: 'Check-in tambahan dengan catatan stok rusak dicatat.' })
    },
    onError: (e: Error) => toast({ title: 'Gagal menyimpan catatan', description: e.message, variant: 'destructive' }),
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
      {/* ===== Scan + Foto berdampingan: barcode toko & pembaca foto ===== */}
      <div className="grid items-start gap-4 xl:grid-cols-2">
        {/* Scan Kunjungan Otomatis (barcode per toko) — minimalis */}
        <Card className="border-emerald-200">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <ScanLine className="h-4 w-4 text-emerald-600" /> Scan Kunjungan — Barcode Toko
            </CardTitle>
            <CardDescription className="text-xs">
              Scan stiker <span className="font-mono">BC-[KODETOKO]</span> — check-in tercatat otomatis.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2.5">
            <SearchSelect
              value={teknisiScanId}
              onChange={setTeknisiScanId}
              options={teknisiOnly.map((t) => ({ value: String(t.id), label: t.nama, sub: t.wilayahKerja ?? undefined }))}
              placeholder="— Teknisi berkunjung —"
              ariaLabel="Pilih teknisi untuk scan"
            />

            {/* Area kamera */}
            <div className="overflow-hidden rounded-xl border-2 border-dashed border-emerald-300 bg-emerald-50/40">
              <div id="scan-toko-region" className={cn('min-h-[140px]', cameraActive ? '' : 'hidden')} />
              {!cameraActive && (
                <div className="flex items-center justify-center gap-2 p-4 text-center">
                  <Camera className="h-5 w-5 shrink-0 text-emerald-400" />
                  <p className="text-xs text-slate-500">Arahkan ke stiker barcode toko</p>
                </div>
              )}
              <div className="flex gap-2 border-t bg-white p-2">
                {!cameraActive ? (
                  <Button size="sm" className="h-8 flex-1 bg-emerald-600 hover:bg-emerald-700" onClick={startCamera}>
                    <Video className="mr-1.5 h-4 w-4" /> Buka Kamera
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" className="h-8 flex-1 border-rose-300 text-rose-600 hover:bg-rose-50" onClick={stopCamera}>
                    <VideoOff className="mr-1.5 h-4 w-4" /> Tutup Kamera
                  </Button>
                )}
              </div>
            </div>

            {/* Input manual fallback */}
            <div className="flex gap-2">
              <Input
                value={manualBarcode}
                onChange={(e) => setManualBarcode(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === 'Enter' && prosesBarcode(manualBarcode)}
                placeholder="BC-TOK-001 / TOK-001"
                className="h-8 bg-white font-mono text-xs"
                aria-label="Input barcode toko manual"
              />
              <Button size="sm" variant="outline" className="h-8 shrink-0" disabled={!manualBarcode.trim()} onClick={() => prosesBarcode(manualBarcode)}>
                <Barcode className="mr-1 h-3.5 w-3.5" /> Proses
              </Button>
            </div>

            {/* Hasil scan */}
            <div ref={lastScanRef}>
              {!scanResult ? (
                <div className="flex min-h-[80px] items-center justify-center gap-2 rounded-lg border border-dashed p-3 text-center">
                  <QrCode className="h-5 w-5 shrink-0 text-slate-300" />
                  <p className="text-xs text-slate-400">Hasil scan muncul di sini — identitas toko + bukti check-in.</p>
                </div>
              ) : scanResult.ok && scanResult.lookup ? (
                <div className="space-y-1.5 rounded-lg border border-emerald-300 bg-emerald-50/50 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-xs font-bold text-slate-900">{scanResult.lookup.toko.namaToko}</p>
                    <Badge className="shrink-0 gap-1 bg-emerald-600 text-[10px] text-white"><CheckCircle2 className="h-3 w-3" /> TERCATAT</Badge>
                  </div>
                  <p className="truncate font-mono text-[10px] text-slate-500">
                    {scanResult.lookup.toko.kodeToko} · {scanResult.lookup.jumlahUnit}u · sejak {scanResult.lookup.hariSejakVisit ?? '∞'}h · {scanResult.lookup.totalKunjungan} visit
                  </p>
                  <p className="flex items-center gap-1 text-[11px] font-medium text-emerald-700">
                    <Zap className="h-3 w-3 shrink-0" /> Tercatat {formatWaktu(new Date().toISOString())}
                    {scanResult.lookup.kunjunganTerakhir && (
                      <span className="truncate font-normal text-slate-500"> · sblm: {scanResult.lookup.kunjunganTerakhir.teknisi}</span>
                    )}
                  </p>
                  <Button size="sm" variant="outline" className="h-7 border-emerald-400 text-[11px] hover:bg-emerald-100" onClick={bukaCatatan}>
                    + Catatan Stok Rusak
                  </Button>
                </div>
              ) : (
                <div className="flex items-center justify-center gap-2 rounded-lg border border-rose-300 bg-rose-50/50 p-3 text-center">
                  <XCircle className="h-5 w-5 shrink-0 text-rose-500" />
                  <div className="min-w-0 text-left">
                    <p className="text-xs font-semibold text-rose-700">Barcode tidak dikenali</p>
                    <p className="truncate font-mono text-[10px] text-slate-500" title={scanResult.error}>{scanResult.barcode}{scanResult.error ? ` · ${scanResult.error}` : ''}</p>
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Pembaca foto & barcode — berdampingan dengan scan */}
        <VisionScanner channel="TELEGRAM" pengirimDefault="FIELD-OPS" compact />
      </div>

      {/* Dialog catatan pasca-scan */}
      <Dialog open={catatanOpen} onOpenChange={setCatatanOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Camera className="h-4 w-4 text-emerald-600" /> Catatan Stok Rusak</DialogTitle>
            <DialogDescription>
              {scanResult?.toko ? `${scanResult.toko.namaToko} (${scanResult.toko.kodeToko})` : ''} — kunjungan sudah tercatat otomatis via scan.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Catatan kondisi di toko</Label>
              <HistoryInput historyKey="kunjungan-catatan" value={catatan} onChange={(e) => setCatatan(e.target.value)} placeholder="Contoh: 2 unit AC display kipas berbunyi, 1 freezer suhu tidak stabil..." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCatatanOpen(false)}>Batal</Button>
            <Button className="bg-emerald-600 hover:bg-emerald-700" disabled={simpanCatatan.isPending} onClick={() => simpanCatatan.mutate()}>
              <CheckCircle2 className="mr-1 h-4 w-4" /> Simpan Catatan
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
          {tokoLoading ? (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-14" />)}
            </div>
          ) : tokoTampil.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <CheckCircle2 className="h-8 w-8 text-emerald-500" />
              <p className="text-sm font-medium text-slate-700">Tidak ada toko yang terlambat visit</p>
              <p className="text-xs text-slate-500">{onlyLate ? 'Semua toko ON TRACK — hapus filter untuk melihat seluruh toko.' : 'Belum ada data toko terdaftar.'}</p>
            </div>
          ) : (
            <div className="grid max-h-[560px] gap-2 overflow-y-auto pr-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
              {tokoTampil.map((t) => {
                const late = t.visitTerlambat
                return (
                  <div key={t.id} className={cn('flex items-center gap-2 rounded-lg border px-2.5 py-2 transition hover:shadow-sm', late ? 'border-rose-200 bg-rose-50/50' : 'bg-white')}>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-semibold text-slate-800" title={t.alamat ? `${t.namaToko} — ${t.alamat}` : t.namaToko}>{t.namaToko}</p>
                      <p className="truncate font-mono text-[10px] text-slate-400" title={`${t.kodeToko} · ${t.barcodeToko}`}>
                        {t.kodeToko} · siklus {t.frekuensiVisit}h · sejak {t.hariSejakVisit ?? '∞'}h · {t.jumlahUnit}u
                      </p>
                    </div>
                    <Badge variant="outline" className={cn('shrink-0 text-[9px]', late ? 'border-rose-300 bg-rose-100 text-rose-700' : 'border-emerald-300 bg-emerald-50 text-emerald-700')}>
                      {late ? 'TERLAMBAT' : 'ON TRACK'}
                    </Badge>
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
            <HistoryInput historyKey="kunjungan-catatan" value={editCatatan} onChange={(e) => setEditCatatan(e.target.value)} placeholder="cth: 2 unit AC display kipas berbunyi…" />
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
              <HistoryInput historyKey="kunjungan-catatan" value={catatanManual} onChange={(e) => setCatatanManual(e.target.value)} placeholder="Contoh: 2 unit AC display kipas berbunyi, 1 freezer suhu tidak stabil..." />
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
    </div>
  )
}
