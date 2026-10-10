'use client'

import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetcher, postJson, formatWaktu, type Toko, type Pengguna, type UnitAsset, type Kunjungan } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useToast } from '@/hooks/use-toast'
import { useAppStore } from '@/lib/store'
import { MapPin, ScanLine, Camera, CheckCircle2, Clock, Navigation, Users, QrCode } from 'lucide-react'
import { cn } from '@/lib/utils'

export default function FieldOpsView() {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const { role } = useAppStore()
  const [checkinOpen, setCheckinOpen] = useState(false)
  const [selectedToko, setSelectedToko] = useState<Toko | null>(null)
  const [teknisiId, setTeknisiId] = useState('')
  const [scanSerial, setScanSerial] = useState('')
  const [catatan, setCatatan] = useState('')
  const [fotoFile, setFotoFile] = useState('')

  const { data: tokoList, isLoading: tokoLoading } = useQuery<Toko[]>({
    queryKey: ['toko'],
    queryFn: () => fetcher<Toko[]>('/api/toko'),
  })
  const { data: teknisiList } = useQuery<Pengguna[]>({
    queryKey: ['pengguna'],
    queryFn: () => fetcher<Pengguna[]>('/api/pengguna'),
  })
  const { data: units } = useQuery<UnitAsset[]>({
    queryKey: ['units'],
    queryFn: () => fetcher<UnitAsset[]>('/api/unit'),
  })
  const { data: kunjunganList, isLoading: kunjunganLoading } = useQuery<Kunjungan[]>({
    queryKey: ['kunjungan'],
    queryFn: () => fetcher<Kunjungan[]>('/api/kunjungan'),
  })

  const teknisiOnly = useMemo(() => (teknisiList ?? []).filter((t) => t.role === 'TEKNISI'), [teknisiList])
  const unitDiToko = useMemo(
    () => (units ?? []).filter((u) => selectedToko && u.tokoId === selectedToko.id),
    [units, selectedToko]
  )

  const checkinMutation = useMutation({
    mutationFn: () =>
      postJson('/api/kunjungan', {
        tokoId: selectedToko?.id,
        teknisiId: Number(teknisiId),
        catatanStokRusak: catatan || null,
        fotoOnsite: fotoFile || null,
        serialTerdeteksi: scanSerial || null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['kunjungan'] })
      queryClient.invalidateQueries({ queryKey: ['toko'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      queryClient.invalidateQueries({ queryKey: ['alerts'] })
      queryClient.invalidateQueries({ queryKey: ['audit'] })
      setCheckinOpen(false)
      setSelectedToko(null)
      setScanSerial('')
      setCatatan('')
      setFotoFile('')
      toast({ title: 'Check-in onsite berhasil', description: 'Tanggal kunjungan toko diperbarui — siklus visit direset.' })
    },
    onError: (e: Error) => toast({ title: 'Check-in gagal', description: e.message, variant: 'destructive' }),
  })

  const bukaCheckin = (toko: Toko) => {
    setSelectedToko(toko)
    setCheckinOpen(true)
    setFotoFile(`onsite-${toko.kodeToko.toLowerCase()}-${Date.now()}.jpg`)
    if (!teknisiId && teknisiOnly[0]) setTeknisiId(String(teknisiOnly[0].id))
  }

  return (
    <div className="space-y-4">
      {/* Peta kepatuhan kunjungan */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Navigation className="h-4 w-4 text-emerald-600" /> Kepatuhan Jadwal Kunjungan Toko
          </CardTitle>
          <CardDescription>ALT-01: toko harus dikunjungi sesuai siklus (frekuensi visit). Scan barcode onsite saat check-in (Modul 1.2 PRD).</CardDescription>
        </CardHeader>
        <CardContent>
          {tokoLoading ? (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-36" />)}
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {(tokoList ?? []).map((t) => {
                const late = t.visitTerlambat
                return (
                  <div key={t.id} className={cn('rounded-xl border p-4 transition hover:shadow-sm', late ? 'border-rose-200 bg-rose-50/50' : 'bg-white')}>
                    <div className="mb-2 flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-800">{t.namaToko}</p>
                        <p className="font-mono text-[10px] text-slate-400">{t.kodeToko}</p>
                      </div>
                      <Badge variant="outline" className={cn('shrink-0 text-[10px]', late ? 'border-rose-300 bg-rose-100 text-rose-700' : 'border-emerald-300 bg-emerald-50 text-emerald-700')}>
                        {late ? 'TERLAMBAT' : 'ON TRACK'}
                      </Badge>
                    </div>
                    <p className="mb-2 line-clamp-2 text-xs text-slate-500">{t.alamat}</p>
                    <div className="mb-3 grid grid-cols-3 gap-2 text-center">
                      <div className="rounded-md bg-slate-50 py-1.5">
                        <p className="text-[10px] text-slate-500">Siklus</p>
                        <p className="text-xs font-bold text-slate-800">{t.frekuensiVisit}h</p>
                      </div>
                      <div className="rounded-md bg-slate-50 py-1.5">
                        <p className="text-[10px] text-slate-500">Sejak visit</p>
                        <p className={cn('text-xs font-bold', late ? 'text-rose-600' : 'text-slate-800')}>{t.hariSejakVisit ?? '∞'}h</p>
                      </div>
                      <div className="rounded-md bg-slate-50 py-1.5">
                        <p className="text-[10px] text-slate-500">Unit</p>
                        <p className="text-xs font-bold text-slate-800">{t.jumlahUnit}</p>
                      </div>
                    </div>
                    <Button size="sm" className={cn('w-full', late ? 'bg-rose-600 hover:bg-rose-700' : 'bg-emerald-600 hover:bg-emerald-700')} onClick={() => bukaCheckin(t)}>
                      <MapPin className="mr-1.5 h-3.5 w-3.5" /> Check-in Onsite
                    </Button>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Riwayat kunjungan */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Clock className="h-4 w-4 text-slate-500" /> Riwayat Kunjungan Onsite
          </CardTitle>
          <CardDescription>Bukti kunjungan lapangan dengan catatan kondisi stok rusak di toko</CardDescription>
        </CardHeader>
        <CardContent>
          {kunjunganLoading ? (
            <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
          ) : (kunjunganList ?? []).length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500">Belum ada riwayat kunjungan.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Waktu</TableHead>
                    <TableHead>Toko</TableHead>
                    <TableHead className="hidden sm:table-cell">Teknisi</TableHead>
                    <TableHead className="hidden md:table-cell">Catatan Stok Rusak</TableHead>
                    <TableHead className="hidden lg:table-cell">Foto</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(kunjunganList ?? []).map((k) => (
                    <TableRow key={k.id}>
                      <TableCell className="whitespace-nowrap text-xs text-slate-600">{formatWaktu(k.tglKunjungan)}</TableCell>
                      <TableCell>
                        <p className="text-xs font-medium text-slate-800">{k.toko.namaToko}</p>
                        <p className="font-mono text-[10px] text-slate-400">{k.toko.kodeToko}</p>
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
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Dialog Check-in + Scan */}
      <Dialog open={checkinOpen} onOpenChange={setCheckinOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <QrCode className="h-5 w-5 text-emerald-600" /> Check-in Kunjungan Onsite
            </DialogTitle>
            <DialogDescription>
              {selectedToko ? `${selectedToko.namaToko} (${selectedToko.kodeToko})` : ''} — teknisi melakukan scan barcode unit display sebagai bukti kehadiran.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label><Users className="mr-1 inline h-3 w-3" /> Teknisi</Label>
                <Select value={teknisiId} onValueChange={setTeknisiId}>
                  <SelectTrigger aria-label="Pilih teknisi"><SelectValue placeholder="— Pilih —" /></SelectTrigger>
                  <SelectContent>
                    {teknisiOnly.map((t) => (
                      <SelectItem key={t.id} value={String(t.id)}>{t.nama} ({t.wilayahKerja})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label><Camera className="mr-1 inline h-3 w-3" /> Foto Onsite</Label>
                <Input value={fotoFile} onChange={(e) => setFotoFile(e.target.value)} className="font-mono text-xs" aria-label="Nama file foto onsite" />
              </div>
            </div>

            {/* Simulasi scanner */}
            <div className="rounded-xl border-2 border-dashed border-emerald-300 bg-emerald-50/50 p-4">
              <div className="mb-2 flex items-center gap-2">
                <ScanLine className="h-4 w-4 animate-pulse text-emerald-600" />
                <p className="text-xs font-semibold text-emerald-800">Scanner Barcode/QR (simulasi kamera HP teknisi)</p>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label className="text-xs">Pilih unit di toko (scan)</Label>
                  <Select value={scanSerial} onValueChange={setScanSerial}>
                    <SelectTrigger className="bg-white" aria-label="Scan unit"><SelectValue placeholder="— Hasil scan —" /></SelectTrigger>
                    <SelectContent>
                      {unitDiToko.map((u) => (
                        <SelectItem key={u.id} value={u.serialNumber}>{u.serialNumber}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Atur ketik manual serial</Label>
                  <Input value={scanSerial} onChange={(e) => setScanSerial(e.target.value.toUpperCase())} placeholder="SN-ACSP-..." className="bg-white font-mono text-xs" aria-label="Serial number manual" />
                </div>
              </div>
              {scanSerial && (() => {
                const u = unitDiToko.find((x) => x.serialNumber === scanSerial)
                return u ? (
                  <div className="mt-2 rounded-lg bg-white p-2.5 text-xs">
                    <p className="font-semibold text-slate-800">✓ {u.modelUnit}</p>
                    <p className="text-slate-500">Barcode: <span className="font-mono">SN:{u.serialNumber}|MOD:{u.modelUnit}|TOK:{u.toko?.kodeToko}</span></p>
                    <Badge variant="outline" className={cn('mt-1 text-[10px]', u.statusGaransi === 'GARANSI' ? 'border-emerald-300 text-emerald-700' : 'border-amber-300 text-amber-700')}>
                      {u.statusGaransi.replace('_', '-')}
                    </Badge>
                  </div>
                ) : (
                  <p className="mt-2 rounded-lg bg-white p-2.5 text-xs text-rose-600">✗ Serial tidak terdaftar di toko ini</p>
                )
              })()}
            </div>

            <div className="space-y-1.5">
              <Label>Catatan Stok Rusak / Temuan</Label>
              <Textarea value={catatan} onChange={(e) => setCatatan(e.target.value)} placeholder="Contoh: 2 unit AC display kipas berbunyi, 1 freezer suhu tidak stabil..." rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCheckinOpen(false)}>Batal</Button>
            <Button
              className="bg-emerald-600 hover:bg-emerald-700"
              disabled={!selectedToko || !teknisiId || checkinMutation.isPending}
              onClick={() => checkinMutation.mutate()}
            >
              <CheckCircle2 className="mr-1 h-4 w-4" /> Simpan Check-in
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
