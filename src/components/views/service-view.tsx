'use client'

import { useEffect, useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetcher, postJson, formatRupiah, formatTanggal, formatWaktu, type ServiceTicket, type UnitAsset, type Sparepart } from '@/lib/api'
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
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useToast } from '@/hooks/use-toast'
import { useAppStore } from '@/lib/store'
import { ServiceFlowStepper, ServiceFlowActions, SUMBER_LABEL } from '@/components/service-flow'
import {
  Plus, FileDown, CheckCircle2, PlayCircle, Send, Ban, AlertOctagon,
  PackageCheck, Eye, Wrench, Camera, DollarSign, RotateCcw, X,
} from 'lucide-react'
import { cn } from '@/lib/utils'

const STATUS_STYLES: Record<string, { label: string; cls: string }> = {
  REQUEST: { label: 'REQUEST', cls: 'bg-amber-100 text-amber-800 border-amber-300' },
  PROSES: { label: 'PROSES', cls: 'bg-violet-100 text-violet-800 border-violet-300' },
  FINISH: { label: 'FINISH', cls: 'bg-emerald-100 text-emerald-800 border-emerald-300' },
}

const KLAIM_STYLES: Record<string, { label: string; cls: string }> = {
  DRAFT: { label: 'DRAFT', cls: 'bg-slate-100 text-slate-600 border-slate-300' },
  SUBMITTED: { label: 'SUBMITTED', cls: 'bg-amber-100 text-amber-800 border-amber-300' },
  PAID: { label: 'PAID', cls: 'bg-emerald-100 text-emerald-800 border-emerald-300' },
}

export default function ServiceView() {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const { role, navIntent, clearNavIntent } = useAppStore()
  const [tab, setTab] = useState('SEMUA')
  // Filter drill-down dari Dashboard (KPI garansi / klik batang tren model)
  const [garansiFilter, setGaransiFilter] = useState<'SEMUA' | 'GARANSI' | 'NON_GARANSI'>('SEMUA')
  const [modelFilter, setModelFilter] = useState<string | null>(null)
  const [detail, setDetail] = useState<ServiceTicket | null>(null)
  const [finishTarget, setFinishTarget] = useState<ServiceTicket | null>(null)
  const [notaFile, setNotaFile] = useState('')
  const [createOpen, setCreateOpen] = useState(false)

  // Konsumsi navIntent dari Dashboard → terapkan filter lalu bersihkan
  // (dijalankan di callback async agar tidak setState sinkron di effect body)
  useEffect(() => {
    if (!navIntent) return
    const t = setTimeout(() => {
      if (navIntent.serviceStatus) setTab(navIntent.serviceStatus)
      if (navIntent.serviceGaransi) setGaransiFilter(navIntent.serviceGaransi)
      if (navIntent.serviceModel) setModelFilter(navIntent.serviceModel)
      clearNavIntent()
    }, 0)
    return () => clearTimeout(t)
  }, [navIntent, clearNavIntent])

  const { data: tickets, isLoading } = useQuery<ServiceTicket[]>({
    queryKey: ['service-tickets'],
    queryFn: () => fetcher<ServiceTicket[]>('/api/service'),
  })
  const { data: units } = useQuery<UnitAsset[]>({
    queryKey: ['units'],
    queryFn: () => fetcher<UnitAsset[]>('/api/unit'),
  })
  const { data: parts } = useQuery<Sparepart[]>({
    queryKey: ['spareparts'],
    queryFn: () => fetcher<Sparepart[]>('/api/sparepart'),
  })

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['service-tickets'] })
    queryClient.invalidateQueries({ queryKey: ['spareparts'] })
    queryClient.invalidateQueries({ queryKey: ['dashboard'] })
    queryClient.invalidateQueries({ queryKey: ['alerts'] })
    queryClient.invalidateQueries({ queryKey: ['audit'] })
    queryClient.invalidateQueries({ queryKey: ['claims'] })
  }

  const aksiMutation = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Record<string, unknown> }) =>
      postJson<ServiceTicket>(`/api/service/${id}`, { ...body, aktor: role === 'TEKNISI' ? 'Teknisi Lapangan' : 'Admin Workshop' }, 'PATCH'),
    onSuccess: (_data, vars) => {
      invalidateAll()
      setDetail(null)
      setFinishTarget(null)
      setNotaFile('')
      toast({ title: 'Aksi berhasil diproses', description: `Workflow tiket diperbarui oleh sistem. (${vars.body.aksi})` })
    },
    onError: (e: Error) => toast({ title: 'Aksi ditolak', description: e.message, variant: 'destructive' }),
  })

  const filtered = useMemo(() => {
    if (!tickets) return []
    let list = tab === 'SEMUA' ? tickets : tickets.filter((t) => t.status === tab)
    if (garansiFilter !== 'SEMUA') list = list.filter((t) => t.unitAsset.statusGaransi === garansiFilter)
    if (modelFilter) list = list.filter((t) => t.unitAsset.modelUnit === modelFilter)
    return list
  }, [tickets, tab, garansiFilter, modelFilter])

  const hasDrilldown = garansiFilter !== 'SEMUA' || modelFilter !== null

  const counts = useMemo(() => {
    const c = { SEMUA: 0, REQUEST: 0, PROSES: 0, FINISH: 0 }
    for (const t of tickets ?? []) {
      c.SEMUA++
      c[t.status]++
    }
    return c
  }, [tickets])

  // ===== Form buat tiket manual =====
  const [formUnit, setFormUnit] = useState('')
  const [formDesc, setFormDesc] = useState('')
  const [formJasa, setFormJasa] = useState('100000')
  const [formParts, setFormParts] = useState<string[]>([])
  const [formSumber, setFormSumber] = useState('MANUAL')

  // Aksi alur di dalam dialog detail — dialog tetap terbuka & menampilkan status baru
  const flowMutation = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Record<string, unknown> }) =>
      postJson<ServiceTicket>(`/api/service/${id}`, { ...body, aktor: role === 'TEKNISI' ? 'Teknisi Lapangan' : 'Admin Workshop' }, 'PATCH'),
    onSuccess: (t) => {
      invalidateAll()
      setDetail(t)
      toast({ title: 'Alur diperbarui', description: `Tiket ${t.noTiket} — tahap alur tercatat.` })
    },
    onError: (e: Error) => toast({ title: 'Aksi ditolak', description: e.message, variant: 'destructive' }),
  })

  const createMutation = useMutation({
    mutationFn: () =>
      postJson('/api/service', {
        unitAssetId: Number(formUnit),
        deskripsiKerusakan: formDesc,
        biayaJasa: Number(formJasa) || 0,
        sumberLaporan: formSumber,
        parts: formParts.map((id) => ({ sparepartId: Number(id), qty: 1 })),
      }),
    onSuccess: () => {
      invalidateAll()
      setCreateOpen(false)
      setFormUnit('')
      setFormDesc('')
      setFormParts([])
      setFormSumber('MANUAL')
      toast({ title: 'Tiket manual dibuat', description: 'Nomor tiket digenerate otomatis oleh sistem.' })
    },
    onError: (e: Error) => toast({ title: 'Gagal membuat tiket', description: e.message, variant: 'destructive' }),
  })

  return (
    <div className="space-y-4">
      {/* Summary strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {(['REQUEST', 'PROSES', 'FINISH'] as const).map((s) => (
          <Card key={s} className="py-3">
            <CardContent className="flex items-center gap-3 px-4">
              <div className={cn('flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold',
                s === 'REQUEST' ? 'bg-amber-100 text-amber-700' : s === 'PROSES' ? 'bg-violet-100 text-violet-700' : 'bg-emerald-100 text-emerald-700')}>
                {counts[s]}
              </div>
              <div>
                <p className="text-xs text-slate-500">Status {s}</p>
                <p className="text-sm font-semibold text-slate-800">{s === 'REQUEST' ? 'Menunggu konfirmasi' : s === 'PROSES' ? 'Dikerjakan' : 'Selesai'}</p>
              </div>
            </CardContent>
          </Card>
        ))}
        <Card className="py-3 border-dashed">
          <CardContent className="flex h-full items-center justify-center px-4">
            <Button size="sm" onClick={() => setCreateOpen(true)} className="bg-emerald-600 hover:bg-emerald-700">
              <Plus className="mr-1 h-4 w-4" /> Tiket Manual
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-base">Daftar Tiket Service</CardTitle>
            <CardDescription>Alur otomatis: WA Bot buat tiket → Admin proses (STTB) → teknisi selesaikan (nota stempel) → klaim</CardDescription>
          </div>
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList>
              <TabsTrigger value="SEMUA">Semua ({counts.SEMUA})</TabsTrigger>
              <TabsTrigger value="REQUEST">REQ ({counts.REQUEST})</TabsTrigger>
              <TabsTrigger value="PROSES">PROSES ({counts.PROSES})</TabsTrigger>
              <TabsTrigger value="FINISH">FINISH ({counts.FINISH})</TabsTrigger>
            </TabsList>
          </Tabs>
        </CardHeader>
        <CardContent>
          {hasDrilldown && (
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="text-xs text-slate-500">Filter dari Dashboard:</span>
              {garansiFilter !== 'SEMUA' && (
                <Badge variant="outline" className="gap-1 border-emerald-300 bg-emerald-50 text-emerald-700">
                  Garansi: {garansiFilter === 'GARANSI' ? 'Ya' : 'Tidak'}
                  <button
                    type="button"
                    aria-label="Hapus filter garansi"
                    onClick={() => setGaransiFilter('SEMUA')}
                    className="ml-0.5 rounded-full p-0.5 hover:bg-emerald-100"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              )}
              {modelFilter && (
                <Badge variant="outline" className="max-w-64 gap-1 border-teal-300 bg-teal-50 text-teal-700">
                  <span className="truncate">Model: {modelFilter}</span>
                  <button
                    type="button"
                    aria-label="Hapus filter model"
                    onClick={() => setModelFilter(null)}
                    className="ml-0.5 rounded-full p-0.5 hover:bg-teal-100"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              )}
            </div>
          )}
          {isLoading ? (
            <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <Wrench className="h-8 w-8 text-slate-300" />
              <p className="text-sm text-slate-500">
                {hasDrilldown ? 'Tidak ada tiket yang cocok dengan filter aktif.' : 'Tidak ada tiket pada status ini.'}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>No. Tiket</TableHead>
                    <TableHead>Unit (Serial · Model)</TableHead>
                    <TableHead className="hidden md:table-cell">Toko</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="hidden lg:table-cell">Part</TableHead>
                    <TableHead className="hidden sm:table-cell">Umur</TableHead>
                    <TableHead className="text-right">Aksi</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((t) => {
                    const st = STATUS_STYLES[t.status]
                    const kl = KLAIM_STYLES[t.statusKlaimProdusen]
                    const hasOrderPart = t.parts.some((p) => p.statusPart === 'ORDER_PRODUSEN')
                    return (
                      <TableRow key={t.id} className={cn(t.slaFlag && 'bg-rose-50/60')}>
                        <TableCell>
                          <div className="flex flex-col">
                            <button onClick={() => setDetail(t)} className="text-left font-mono text-xs font-semibold text-emerald-700 hover:underline">
                              {t.noTiket}
                            </button>
                            {t.noSttb && <span className="font-mono text-[10px] text-slate-400">{t.noSttb}</span>}
                          </div>
                        </TableCell>
                        <TableCell className="max-w-48">
                          <p className="truncate text-xs font-medium text-slate-800">{t.unitAsset.modelUnit}</p>
                          <p className="truncate font-mono text-[10px] text-slate-400">{t.unitAsset.serialNumber}</p>
                        </TableCell>
                        <TableCell className="hidden md:table-cell">
                          <p className="text-xs text-slate-700">{t.unitAsset.toko?.namaToko ?? '-'}</p>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap items-center gap-1">
                            <Badge variant="outline" className={st.cls}>{st.label}</Badge>
                            {t.slaFlag && <Badge variant="destructive" className="gap-0.5 text-[9px]"><AlertOctagon className="h-2.5 w-2.5" /> SLA</Badge>}
                            {t.status === 'FINISH' && <Badge variant="outline" className={kl.cls}>{kl.label}</Badge>}
                          </div>
                        </TableCell>
                        <TableCell className="hidden lg:table-cell">
                          {t.parts.length === 0 ? (
                            <span className="text-xs text-slate-400">—</span>
                          ) : (
                            <div className="flex flex-wrap gap-1">
                              {t.parts.map((p) => (
                                <Badge key={p.id} variant="outline" className={cn('text-[9px]', p.statusPart === 'READY' ? 'border-emerald-300 text-emerald-700' : 'border-rose-300 text-rose-700')} title={`${p.sparepart?.namaPart ?? ''}${p.sparepart?.brandKompatibel ? ` · ${p.sparepart.brandKompatibel}` : ''}${p.sparepart?.supplier ? ` · ${p.sparepart.supplier}` : ''} · qty ${p.qty}`}>
                                  {p.sparepart?.kodePart} · {p.statusPart === 'READY' ? 'READY' : 'ORDER'}
                                </Badge>
                              ))}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="hidden sm:table-cell">
                          <p className="text-xs text-slate-500">{t.umurTiketJam ?? 0} jam</p>
                          <p className="text-[10px] text-slate-400">{formatWaktu(t.createdAt)}</p>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex flex-wrap items-center justify-end gap-1.5">
                            {hasOrderPart && (t.status === 'REQUEST' || t.status === 'PROSES') && (
                              <Button size="sm" variant="outline" className="h-7 px-2 text-[11px] text-teal-700"
                                onClick={() => aksiMutation.mutate({ id: t.id, body: { aksi: 'TERIMA_PART_PRODUSEN' } })}>
                                <PackageCheck className="mr-1 h-3 w-3" /> Part Datang
                              </Button>
                            )}
                            {t.status === 'REQUEST' && (
                              <Button size="sm" className="h-7 bg-violet-600 px-2 text-[11px] hover:bg-violet-700"
                                onClick={() => aksiMutation.mutate({ id: t.id, body: { aksi: 'MULAI_PROSES' } })}>
                                <PlayCircle className="mr-1 h-3 w-3" /> Proses + STTB
                              </Button>
                            )}
                            {t.status === 'PROSES' && (
                              <Button size="sm" className="h-7 bg-emerald-600 px-2 text-[11px] hover:bg-emerald-700"
                                onClick={() => { setFinishTarget(t); setNotaFile(`nota-stempel-${t.noTiket}.jpg`) }}>
                                <Camera className="mr-1 h-3 w-3" /> Selesaikan
                              </Button>
                            )}
                            {t.status === 'FINISH' && t.statusKlaimProdusen === 'DRAFT' && (
                              <Button size="sm" className="h-7 bg-amber-600 px-2 text-[11px] hover:bg-amber-700"
                                onClick={() => aksiMutation.mutate({ id: t.id, body: { aksi: 'SUBMIT_CLAIM' } })}>
                                <Send className="mr-1 h-3 w-3" /> Ajukan Klaim
                              </Button>
                            )}
                            {t.status === 'FINISH' && t.statusKlaimProdusen === 'SUBMITTED' && (
                              <Button size="sm" className="h-7 bg-emerald-700 px-2 text-[11px] hover:bg-emerald-800"
                                onClick={() => aksiMutation.mutate({ id: t.id, body: { aksi: 'MARK_PAID' } })}>
                                <DollarSign className="mr-1 h-3 w-3" /> Tandai Lunas
                              </Button>
                            )}
                            {t.noSttb && (
                              <a href={`/api/sttb/${t.noTiket}`} target="_blank" rel="noreferrer">
                                <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]">
                                  <FileDown className="mr-1 h-3 w-3" /> STTB
                                </Button>
                              </a>
                            )}
                            <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px]" onClick={() => setDetail(t)}>
                              <Eye className="h-3 w-3" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ===== Dialog Detail Tiket ===== */}
      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
          {detail && (
            <>
              <DialogHeader>
                <DialogTitle className="flex flex-wrap items-center gap-2 font-mono text-base">
                  {detail.noTiket}
                  <Badge variant="outline" className={STATUS_STYLES[detail.status].cls}>{STATUS_STYLES[detail.status].label}</Badge>
                  {detail.slaFlag && <Badge variant="destructive">SLA TERLAMBAT</Badge>}
                </DialogTitle>
                <DialogDescription>Dibuat {formatWaktu(detail.createdAt)} · Klaim {detail.statusKlaimProdusen}</DialogDescription>
              </DialogHeader>
              <div className="space-y-4 text-sm">
                <ServiceFlowStepper ticket={detail} />
                <ServiceFlowActions
                  ticket={detail}
                  pending={flowMutation.isPending}
                  onAction={(body) => flowMutation.mutate({ id: detail.id, body })}
                />
                <div className="rounded-lg bg-slate-50 p-3">
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Unit</p>
                  <p className="font-medium text-slate-800">{detail.unitAsset.modelUnit}</p>
                  <p className="font-mono text-xs text-slate-500">{detail.unitAsset.serialNumber}</p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    <Badge variant="outline" className={detail.unitAsset.statusGaransi === 'GARANSI' ? 'border-emerald-300 text-emerald-700' : 'border-amber-300 text-amber-700'}>
                      {detail.unitAsset.statusGaransi.replace('_', '-')}
                    </Badge>
                    <Badge variant="outline">{detail.unitAsset.toko?.kodeToko} — {detail.unitAsset.toko?.namaToko}</Badge>
                  </div>
                </div>
                <div>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Deskripsi Kerusakan</p>
                  <p className="text-slate-700">{detail.deskripsiKerusakan ?? '-'}</p>
                </div>
                <div>
                  <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Sparepart</p>
                  {detail.parts.length === 0 ? (
                    <p className="text-xs text-slate-400">Tidak ada part tercatat.</p>
                  ) : (
                    <div className="space-y-1.5">
                      {detail.parts.map((p) => (
                        <div key={p.id} className="flex items-center justify-between rounded-md border px-3 py-2">
                          <div>
                            <p className="text-xs font-medium text-slate-800">{p.sparepart?.namaPart}</p>
                            <p className="font-mono text-[10px] text-slate-400">{p.sparepart?.kodePart} · qty {p.qty}</p>
                            {((p.sparepart?.brandKompatibel?.trim() || p.sparepart?.supplier?.trim())) && (
                              <p className="text-[10px] text-slate-500">
                                {[p.sparepart?.brandKompatibel?.trim(), p.sparepart?.supplier?.trim()].filter(Boolean).join(' · ')}
                              </p>
                            )}
                          </div>
                          <div className="flex shrink-0 flex-col items-end gap-1">
                            <Badge variant="outline" className={p.statusPart === 'READY' ? 'border-emerald-300 text-emerald-700' : 'border-rose-300 text-rose-700'}>
                              {p.statusPart === 'READY' ? 'READY' : 'ORDER PRODUSEN'}
                            </Badge>
                            {p.statusKonfirmasi !== 'MENUNGGU' && (
                              <Badge variant="outline" className={cn('text-[9px]', p.statusKonfirmasi === 'READY' ? 'border-teal-300 text-teal-700' : 'border-rose-300 text-rose-700')}>
                                Produsen: {p.statusKonfirmasi === 'READY' ? 'READY' : 'TIDAK READY'}
                              </Badge>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div className="rounded-md border p-2.5">
                    <p className="text-slate-500">Biaya Jasa</p>
                    <p className="font-semibold text-slate-800">{formatRupiah(detail.biayaJasa)}</p>
                  </div>
                  <div className="rounded-md border p-2.5">
                    <p className="text-slate-500">Total Nilai Klaim</p>
                    <p className="font-semibold text-emerald-700">{formatRupiah(detail.nilaiKlaim ?? 0)}</p>
                  </div>
                  <div className="rounded-md border p-2.5">
                    <p className="text-slate-500">Nota Berstempel</p>
                    <p className="font-semibold text-slate-800">{detail.fotoNotaStempel ?? 'Belum diunggah'}</p>
                  </div>
                  <div className="rounded-md border p-2.5">
                    <p className="text-slate-500">Selesai pada</p>
                    <p className="font-semibold text-slate-800">{formatTanggal(detail.tglFinish)}</p>
                  </div>
                </div>
                {detail.noSttb && (
                  <a href={`/api/sttb/${detail.noTiket}`} target="_blank" rel="noreferrer" className="block">
                    <Button variant="outline" className="w-full">
                      <FileDown className="mr-2 h-4 w-4" /> Buka Dokumen STTB PDF (QR Code)
                    </Button>
                  </a>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ===== Dialog FINISH (upload nota) ===== */}
      <Dialog open={!!finishTarget} onOpenChange={(o) => !o && setFinishTarget(null)}>
        <DialogContent className="sm:max-w-md">
          {finishTarget && (
            <>
              <DialogHeader>
                <DialogTitle>Selesaikan Tiket {finishTarget.noTiket}</DialogTitle>
                <DialogDescription>
                  Konfirmasi pengembalian unit ke toko. Unggah foto nota service berstempel toko sebagai bukti (Modul 2.3 PRD).
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div className="rounded-lg border border-dashed bg-slate-50 p-4 text-center">
                  <Camera className="mx-auto mb-2 h-8 w-8 text-slate-400" />
                  <p className="text-xs text-slate-500">Simulasi kamera teknisi: foto nota berstempel</p>
                  <Input value={notaFile} onChange={(e) => setNotaFile(e.target.value)} className="mt-2 font-mono text-xs" aria-label="Nama file foto nota" />
                </div>
                <p className="text-xs text-slate-500">
                  Unit akan dikembalikan ke <span className="font-medium">{finishTarget.unitAsset.toko?.namaToko}</span>. Setelah FINISH, tiket masuk kandidat klaim bulanan ke produsen.
                </p>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setFinishTarget(null)}><Ban className="mr-1 h-4 w-4" /> Batal</Button>
                <Button
                  className="bg-emerald-600 hover:bg-emerald-700"
                  disabled={!notaFile.trim() || aksiMutation.isPending}
                  onClick={() => aksiMutation.mutate({ id: finishTarget.id, body: { aksi: 'FINISH', fotoNotaStempel: notaFile.trim() } })}
                >
                  <CheckCircle2 className="mr-1 h-4 w-4" /> Konfirmasi FINISH
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ===== Dialog Buat Tiket Manual ===== */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Buat Tiket Service Manual</DialogTitle>
            <DialogDescription>Admin Workshop dapat membuat tiket langsung tanpa laporan WA (contoh: unit dibawa langsung ke workshop).</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Pilih Unit (Barcode)</Label>
              <Select value={formUnit} onValueChange={setFormUnit}>
                <SelectTrigger aria-label="Pilih unit"><SelectValue placeholder="— Pilih unit asset —" /></SelectTrigger>
                <SelectContent className="max-h-64">
                  {(units ?? []).map((u) => (
                    <SelectItem key={u.id} value={String(u.id)}>
                      {u.serialNumber} · {u.modelUnit} ({u.toko?.kodeToko ?? '-'})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Deskripsi Kerusakan</Label>
              <Textarea value={formDesc} onChange={(e) => setFormDesc(e.target.value)} placeholder="Contoh: AC tidak dingin, indikator berkedip..." rows={2} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Sumber Laporan</Label>
                <Select value={formSumber} onValueChange={setFormSumber}>
                  <SelectTrigger aria-label="Sumber laporan"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(SUMBER_LABEL).filter(([v]) => v !== 'WA_BOT').map(([v, l]) => (
                      <SelectItem key={v} value={v}>{l}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Biaya Jasa (Rp)</Label>
                <Input type="number" value={formJasa} onChange={(e) => setFormJasa(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Reserve Sparepart</Label>
              <Select value={formParts[0] ?? ''} onValueChange={(v) => setFormParts(v ? [v] : [])}>
                <SelectTrigger aria-label="Pilih sparepart"><SelectValue placeholder="— Tanpa part —" /></SelectTrigger>
                <SelectContent className="max-h-64">
                  {parts?.filter((p) => p.stokInventory > 0).map((p) => (
                    <SelectItem key={p.id} value={String(p.id)} textValue={`${p.kodePart} ${p.namaPart}`}>
                      {p.kodePart} · {p.namaPart} — {[p.brandKompatibel?.trim(), p.supplier?.trim()].filter(Boolean).join(' · ') || 'tanpa brand/supplier'} (jual {p.stokJual}/garansi {p.stokGaransi})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <p className="flex items-start gap-1.5 rounded-md bg-emerald-50 p-2.5 text-xs text-emerald-800">
              <RotateCcw className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Stok tersinkron otomatis: jika part tersedia, stok bisa-jual (lalu garansi) direserve &amp; inventory berkurang. Jika kosong, part berstatus ORDER_PRODUSEN &amp; produsen dinotifikasi.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Batal</Button>
            <Button className="bg-emerald-600 hover:bg-emerald-700" disabled={!formUnit || !formDesc.trim() || createMutation.isPending} onClick={() => createMutation.mutate()}>
              <Plus className="mr-1 h-4 w-4" /> Buat Tiket
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
