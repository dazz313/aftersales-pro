'use client'

import { useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { fetcher, postJson, formatWaktu, type Toko, type Kunjungan } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { useToast } from '@/hooks/use-toast'
import SearchSelect from '@/components/search-select'
import HistoryInput from '@/components/history-input'
import { ScanLine, Camera, CheckCircle2, QrCode, Barcode, XCircle, Video, VideoOff, Zap } from 'lucide-react'
import { cn } from '@/lib/utils'

interface LookupResult {
  toko: Toko
  jumlahUnit: number
  totalKunjungan: number
  hariSejakVisit: number | null
  visitTerlambat: boolean
  kunjunganTerakhir: { waktu: string; teknisi: string; metode: string } | null
}

interface ScanTokoProps {
  teknisiOnly: { id: number; nama: string; wilayahKerja: string | null }[]
  /** Dipanggil setelah check-in / catatan tersimpan agar data induk disegarkan. */
  onChanged: () => void
}

/**
 * Scan Kunjungan portable — barcode per toko (minimalis).
 * Scan / ketik barcode → lookup → check-in OTOMATIS tercatat.
 * Berdampingan sejajar dengan Pembaca Foto (VisionScanner) di Field Ops.
 */
export default function ScanToko({ teknisiOnly, onChanged }: ScanTokoProps) {
  const { toast } = useToast()
  const [teknisiScanId, setTeknisiScanId] = useState('')
  const [manualBarcode, setManualBarcode] = useState('')
  const [cameraActive, setCameraActive] = useState(false)
  const [scanResult, setScanResult] = useState<{ ok: boolean; barcode: string; toko?: Toko; lookup?: LookupResult; error?: string } | null>(null)
  const [catatanOpen, setCatatanOpen] = useState(false)
  const [catatan, setCatatan] = useState('')
  const lastScanRef = useRef<HTMLDivElement>(null)
  const html5qrRef = useRef<{ stop: () => Promise<void>; clear: () => void } | null>(null)
  const processingRef = useRef(false)

  // ===== Scan → lookup → auto check-in =====
  const checkinMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => postJson<Kunjungan>('/api/kunjungan', body),
    onSuccess: () => onChanged(),
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
      const saved = await checkinMutation.mutateAsync({
        barcode,
        teknisiId: Number(tId),
        metodeCheckin: 'SCAN_BARCODE',
      })

      setScanResult({ ok: true, barcode, toko: saved.toko as unknown as Toko, lookup })
      toast({
        title: 'Kunjungan tercatat otomatis',
        description: `${lookup.toko.namaToko} — check-in via scan QR toko.`,
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
      onChanged()
      setCatatanOpen(false)
      setCatatan('')
      toast({ title: 'Catatan kunjungan tersimpan', description: 'Check-in tambahan dengan catatan stok rusak dicatat.' })
    },
    onError: (e: Error) => toast({ title: 'Gagal menyimpan catatan', description: e.message, variant: 'destructive' }),
  })

  return (
    <>
      {/* Scan Kunjungan Otomatis (barcode per toko) — minimalis tipis */}
      <Card className="h-full border-emerald-200">
        <CardHeader className="px-3 pb-2 pt-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <ScanLine className="h-3.5 w-3.5 text-emerald-600" /> Scan Kunjungan — QR Toko
          </CardTitle>
          <CardDescription className="text-[11px]">
            Scan stiker QR toko (isi QR = nama toko) — check-in tercatat otomatis.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 px-3 pb-3">
          <SearchSelect
            value={teknisiScanId}
            onChange={setTeknisiScanId}
            options={teknisiOnly.map((t) => ({ value: String(t.id), label: t.nama, sub: t.wilayahKerja ?? undefined }))}
            placeholder="— Teknisi berkunjung —"
            ariaLabel="Pilih teknisi untuk scan"
          />

          {/* Area kamera */}
          <div className="overflow-hidden rounded-xl border-2 border-dashed border-emerald-300 bg-emerald-50/40">
            <div id="scan-toko-region" className={cn('min-h-[110px]', cameraActive ? '' : 'hidden')} />
            {!cameraActive && (
              <div className="flex items-center justify-center gap-2 p-3 text-center">
                <Camera className="h-4 w-4 shrink-0 text-emerald-400" />
                <p className="text-[11px] text-slate-500">Arahkan ke stiker QR toko</p>
              </div>
            )}
            <div className="flex gap-2 border-t bg-white p-1.5">
              {!cameraActive ? (
                <Button size="sm" className="h-7 flex-1 bg-emerald-600 text-[11px] hover:bg-emerald-700" onClick={startCamera}>
                  <Video className="mr-1.5 h-3.5 w-3.5" /> Buka Kamera
                </Button>
              ) : (
                <Button size="sm" variant="outline" className="h-7 flex-1 border-rose-300 text-[11px] text-rose-600 hover:bg-rose-50" onClick={stopCamera}>
                  <VideoOff className="mr-1.5 h-3.5 w-3.5" /> Tutup Kamera
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
              placeholder="nama toko (atau kode toko)"
              className="h-7 bg-white font-mono text-[11px]"
              aria-label="Input nama atau kode toko manual"
            />
            <Button size="sm" variant="outline" className="h-7 shrink-0 text-[11px]" disabled={!manualBarcode.trim()} onClick={() => prosesBarcode(manualBarcode)}>
              <Barcode className="mr-1 h-3 w-3" /> Proses
            </Button>
          </div>

          {/* Hasil scan */}
          <div ref={lastScanRef}>
            {!scanResult ? (
              <div className="flex min-h-[64px] items-center justify-center gap-2 rounded-lg border border-dashed p-2.5 text-center">
                <QrCode className="h-4 w-4 shrink-0 text-slate-300" />
                <p className="text-[11px] text-slate-400">Hasil scan muncul di sini — identitas toko + bukti check-in.</p>
              </div>
            ) : scanResult.ok && scanResult.lookup ? (
              <div className="space-y-1.5 rounded-lg border border-emerald-300 bg-emerald-50/50 p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-xs font-bold text-slate-900">{scanResult.lookup.toko.namaToko}</p>
                  <Badge className="shrink-0 gap-1 bg-emerald-600 text-[10px] text-white"><CheckCircle2 className="h-3 w-3" /> TERCATAT</Badge>
                </div>
                {scanResult.lookup.toko.alamat && (
                  <p className="truncate text-[11px] text-slate-600">📍 {scanResult.lookup.toko.alamat}</p>
                )}
                <p className="text-[11px] text-slate-600">
                  🗺️ Koordinat:{' '}
                  {scanResult.lookup.toko.latitude != null && scanResult.lookup.toko.longitude != null
                    ? `${scanResult.lookup.toko.latitude.toFixed(6)}, ${scanResult.lookup.toko.longitude.toFixed(6)}`
                    : 'belum diisi'}
                </p>
                <p className="truncate font-mono text-[10px] text-slate-500">
                  {scanResult.lookup.jumlahUnit}u · sejak {scanResult.lookup.hariSejakVisit ?? '∞'}h · {scanResult.lookup.totalKunjungan} visit
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
              <div className="flex items-center justify-center gap-2 rounded-lg border border-rose-300 bg-rose-50/50 p-2.5 text-center">
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
              <HistoryInput historyKey="kunjungan-catatan" value={catatan} onChange={(e) => setCatatan(e.target.value)} placeholder="Contoh: 2 unit kipas display berderit, 1 pompa air tidak menyedot..." />
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
    </>
  )
}
