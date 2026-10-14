'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetcher, postJson, formatRupiah, formatTanggal, formatWaktu, type ServiceTicket, type UnitAsset, type Sparepart, type Toko, type Customer } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Checkbox } from '@/components/ui/checkbox'
import SuratJalanDialog from '@/components/surat-jalan-dialog'
import { useToast } from '@/hooks/use-toast'
import { useAppStore } from '@/lib/store'
import { ServiceFlowStepper, ServiceFlowActions, SUMBER_LABEL } from '@/components/service-flow'
import QuickSearch, { matchQuery } from '@/components/quick-search'
import SearchSelect from '@/components/search-select'
import HistoryInput from '@/components/history-input'
import {
  Plus, FileDown, CheckCircle2, PlayCircle, Send, Ban, AlertOctagon,
  PackageCheck, Eye, Wrench, Camera, DollarSign, RotateCcw, X, Truck, Pencil,
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
  const [tokoFilter, setTokoFilter] = useState<string | null>(null)
  const [cariTiket, setCariTiket] = useState('')
  // Pilih tiket untuk surat jalan kolektif (part rusak dikirim bersama ke produsen)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [sjOpen, setSjOpen] = useState(false)
  const [detail, setDetail] = useState<ServiceTicket | null>(null)
  const [tiketEdit, setTiketEdit] = useState(false)
  const [tiketDesc, setTiketDesc] = useState('')
  const [tiketJasa, setTiketJasa] = useState('0')
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
      if (navIntent.serviceToko) setTokoFilter(navIntent.serviceToko)
      clearNavIntent()
    }, 0)
    return () => clearTimeout(t)
  }, [navIntent, clearNavIntent])

  // Ganti tiket di dialog detail → tutup mode koreksi
  const openDetail = (t: ServiceTicket | null) => {
    setTiketEdit(false)
    setDetail(t)
  }

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
  const { data: tokoList } = useQuery<Toko[]>({
    queryKey: ['toko'],
    queryFn: () => fetcher<Toko[]>('/api/toko'),
  })
  const { data: customerList } = useQuery<Customer[]>({
    queryKey: ['customers'],
    queryFn: () => fetcher<Customer[]>('/api/customer'),
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
    if (garansiFilter !== 'SEMUA') list = list.filter((t) => garansiFilter === 'GARANSI' ? t.unitAsset.statusGaransi !== 'NON_GARANSI' : t.unitAsset.statusGaransi === 'NON_GARANSI')
    if (modelFilter) list = list.filter((t) => t.unitAsset.modelUnit === modelFilter)
    if (tokoFilter) list = list.filter((t) => t.unitAsset.toko?.kodeToko === tokoFilter)
    if (cariTiket.trim()) {
      list = list.filter((t) => matchQuery([
        t.noTiket,
        t.unitAsset.serialNumber,
        t.unitAsset.modelUnit,
        t.deskripsiKerusakan,
        t.unitAsset.toko?.kodeToko,
        t.unitAsset.toko?.namaToko,
        t.unitAsset.customer?.nama,
        t.noSttb,
        t.noSuratJalan,
        ...t.parts.map((p) => `${p.sparepart?.kodePart ?? ''} ${p.sparepart?.namaPart ?? ''}`),
      ], cariTiket))
    }
    return list
  }, [tickets, tab, garansiFilter, modelFilter, cariTiket])

  const hasDrilldown = garansiFilter !== 'SEMUA' || modelFilter !== null || tokoFilter !== null

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleAll = (list: { id: number }[]) => {
    const allSelected = list.length > 0 && list.every((t) => selectedIds.has(t.id))
    setSelectedIds((prev) => {
      const next = new Set(prev)
      for (const t of list) {
        if (allSelected) next.delete(t.id)
        else next.add(t.id)
      }
      return next
    })
  }

  const sjTickets = useMemo(() => (tickets ?? []).filter((t) => selectedIds.has(t.id)), [tickets, selectedIds])

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
  const [formSumber, setFormSumber] = useState('MANUAL')
  // Multi-part: 1 unit bisa butuh >1 kode sparepart — tiap baris pilih dari
  // katalog ATAU tulis kode+nama manual (part baru otomatis terdaftar).
  type PartRow = { key: number; mode: 'katalog' | 'manual'; sparepartId: string; kode: string; nama: string; qty: string }
  const [formParts, setFormParts] = useState<PartRow[]>([
    { key: 0, mode: 'katalog', sparepartId: '', kode: '', nama: '', qty: '1' },
  ])
  const nextPartKey = useRef(1)
  // Klasifikasi customer: TOKO (stok toko → otomatis garansi) atau PERORANGAN
  const [formTipe, setFormTipe] = useState<'TOKO' | 'PERORANGAN'>('TOKO')
  const [formPemilik, setFormPemilik] = useState('')
  const [formKlasifikasi, setFormKlasifikasi] = useState<'GARANSI' | 'NON_GARANSI' | ''>('')
  const [formTgl, setFormTgl] = useState(() => {
    const d = new Date()
    const p = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
  })

  const garansiOtomatis = formTipe === 'TOKO'
  const klasifikasiFinal = garansiOtomatis ? 'GARANSI' : formKlasifikasi
  const jasaDisabled = klasifikasiFinal === 'GARANSI'

  // Unit otomatis mengikuti pemilik yang dipilih (data toko / customer)
  const unitPilihan = useMemo(() => {
    if (!formPemilik) return []
    const pid = Number(formPemilik)
    return (units ?? []).filter((u) => (formTipe === 'TOKO' ? u.tokoId === pid : u.customerId === pid))
  }, [units, formTipe, formPemilik])

  // ===== Validasi baris part: anti-pengulangan (kode sama tidak boleh 2x) =====
  const updatePartRow = (key: number, patch: Partial<PartRow>) =>
    setFormParts((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  const tambahPartRow = () =>
    setFormParts((rows) => [...rows, { key: nextPartKey.current++, mode: 'katalog', sparepartId: '', kode: '', nama: '', qty: '1' }])
  const hapusPartRow = (key: number) => setFormParts((rows) => rows.filter((r) => r.key !== key))

  const partKodePerRow = useMemo(
    () =>
      formParts.map((r) => {
        if (r.mode === 'katalog') {
          if (!r.sparepartId) return ''
          return (parts ?? []).find((p) => p.id === Number(r.sparepartId))?.kodePart ?? ''
        }
        return r.kode.trim().toUpperCase()
      }),
    [formParts, parts]
  )
  const dupPartKode = useMemo(() => {
    const count = new Map<string, number>()
    for (const k of partKodePerRow) if (k) count.set(k, (count.get(k) ?? 0) + 1)
    return new Set(partKodePerRow.filter((k) => k && (count.get(k) ?? 0) > 1))
  }, [partKodePerRow])
  const partRowInvalid = formParts.some((r) =>
    r.mode === 'manual' ? (!r.kode.trim() && r.nama.trim()) || (r.kode.trim() && !r.nama.trim()) : false
  )
  const partsPayload = formParts
    .map((r) => {
      if (r.mode === 'katalog') {
        return r.sparepartId
          ? { sparepartId: Number(r.sparepartId), qty: Math.max(1, Number(r.qty) || 1) }
          : null
      }
      const kode = r.kode.trim().toUpperCase()
      const nama = r.nama.trim()
      return kode && nama ? { kodePart: kode, namaPart: nama, qty: Math.max(1, Number(r.qty) || 1) } : null
    })
    .filter((p): p is NonNullable<typeof p> => p !== null)

  const resetFormTiket = () => {
    setFormUnit('')
    setFormDesc('')
    setFormJasa('100000')
    setFormParts([{ key: nextPartKey.current++, mode: 'katalog', sparepartId: '', kode: '', nama: '', qty: '1' }])
    setFormSumber('MANUAL')
    setFormTipe('TOKO')
    setFormPemilik('')
    setFormKlasifikasi('')
    const d = new Date()
    const p = (n: number) => String(n).padStart(2, '0')
    setFormTgl(`${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`)
  }

  // Aksi alur di dalam dialog detail — dialog tetap terbuka & menampilkan status baru
  const flowMutation = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Record<string, unknown> }) =>
      postJson<ServiceTicket>(`/api/service/${id}`, { ...body, aktor: role === 'TEKNISI' ? 'Teknisi Lapangan' : 'Admin Workshop' }, 'PATCH'),
    onSuccess: (t) => {
      invalidateAll()
      openDetail(t)
      toast({ title: 'Alur diperbarui', description: `Tiket ${t.noTiket} — tahap alur tercatat.` })
    },
    onError: (e: Error) => toast({ title: 'Aksi ditolak', description: e.message, variant: 'destructive' }),
  })

  // Kirim WA ke produsen — buka wa.me yang sudah terisi otomatis
  const waMutation = useMutation({
    mutationFn: (id: number) =>
      postJson<ServiceTicket & { waUrl?: string }>(`/api/service/${id}`, { aksi: 'KIRIM_PRODUSEN_WA', aktor: role === 'TEKNISI' ? 'Teknisi Lapangan' : 'Admin Workshop' }, 'PATCH'),
    onSuccess: (t) => {
      invalidateAll()
      if (t.waUrl) window.open(t.waUrl, '_blank', 'noopener')
      toast({ title: 'WA produsen disiapkan', description: 'Pesan otomatis terisi — tinggal klik kirim di WhatsApp.' })
    },
    onError: (e: Error) => toast({ title: 'Gagal menyiapkan WA', description: e.message, variant: 'destructive' }),
  })

  // Saran part dari riwayat: part yang pernah dipakai untuk model unit yang sama
  const saranParts = useMemo(() => {
    if (!detail) return []
    const hitung = new Map<string, { kodePart: string; namaPart: string; count: number }>()
    for (const t of tickets ?? []) {
      if (t.id === detail.id || t.unitAsset.modelUnit !== detail.unitAsset.modelUnit) continue
      for (const p of t.parts) {
        const kode = p.sparepart?.kodePart
        if (!kode) continue
        const e = hitung.get(kode) ?? { kodePart: kode, namaPart: p.sparepart?.namaPart ?? '', count: 0 }
        e.count += p.qty
        hitung.set(kode, e)
      }
    }
    const dipakai = new Set(detail.parts.map((p) => p.sparepart?.kodePart))
    return [...hitung.values()].filter((s) => !dipakai.has(s.kodePart)).sort((a, b) => b.count - a.count).slice(0, 4)
  }, [tickets, detail])

  const createMutation = useMutation({
    mutationFn: () =>
      postJson('/api/service', {
        unitAssetId: Number(formUnit),
        deskripsiKerusakan: formDesc,
        biayaJasa: jasaDisabled ? 0 : Number(formJasa) || 0,
        sumberLaporan: formSumber,
        customerType: formTipe,
        klasifikasiGaransi: klasifikasiFinal,
        tglTiket: formTgl ? new Date(formTgl).toISOString() : undefined,
        parts: partsPayload,
      }),
    onSuccess: () => {
      invalidateAll()
      setCreateOpen(false)
      resetFormTiket()
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
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <QuickSearch
              value={cariTiket}
              onChange={setCariTiket}
              placeholder="Cari no. tiket / serial / model / toko / part…"
              className="max-w-sm flex-1"
              resultCount={filtered.length}
            />
            {selectedIds.size > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="text-slate-500 hover:text-slate-700"
                onClick={() => setSelectedIds(new Set())}
              >
                <X className="mr-1 h-3.5 w-3.5" /> Reset ({selectedIds.size})
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              className="border-teal-700 text-teal-700 hover:bg-teal-50"
              onClick={() => setSjOpen(true)}
              disabled={selectedIds.size === 0}
              title="Cetak surat jalan kolektif — part rusak dikirim bersama ke produsen"
            >
              <Truck className="mr-1 h-3.5 w-3.5" />
              Surat Jalan{selectedIds.size > 0 ? ` (${selectedIds.size})` : ''}
            </Button>
          </div>
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
              {tokoFilter && (
                <Badge variant="outline" className="max-w-64 gap-1 border-emerald-300 bg-emerald-50 text-emerald-700">
                  <span className="truncate">Toko: {tokoFilter}</span>
                  <button
                    type="button"
                    aria-label="Hapus filter toko"
                    onClick={() => setTokoFilter(null)}
                    className="ml-0.5 rounded-full p-0.5 hover:bg-emerald-100"
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
                    <TableHead className="w-9 pr-0">
                      <Checkbox
                        aria-label="Pilih semua tiket tampil untuk surat jalan"
                        checked={filtered.length > 0 && filtered.every((t) => selectedIds.has(t.id))}
                        onCheckedChange={() => toggleAll(filtered)}
                      />
                    </TableHead>
                    <TableHead>No. Tiket</TableHead>
                    <TableHead>Unit (Serial · Model)</TableHead>
                    <TableHead className="hidden md:table-cell">Toko</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Kode Sparepart</TableHead>
                    <TableHead>Nama Sparepart</TableHead>
                    {(tab === 'REQUEST' || tab === 'PROSES') && <TableHead>Kerusakan</TableHead>}
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
                      <TableRow key={t.id} className={cn(t.slaFlag && 'bg-rose-50/60', selectedIds.has(t.id) && 'bg-teal-50/60')}>
                        <TableCell className="pr-0">
                          <Checkbox
                            aria-label={`Pilih tiket ${t.noTiket} untuk surat jalan`}
                            checked={selectedIds.has(t.id)}
                            onCheckedChange={() => toggleSelect(t.id)}
                          />
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col">
                            <button onClick={() => openDetail(t)} className="text-left font-mono text-xs font-semibold text-emerald-700 hover:underline">
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
                        <TableCell>
                          {t.parts.length === 0 ? (
                            <span className="text-xs text-slate-400">—</span>
                          ) : (
                            <div className="flex flex-col gap-1">
                              {t.parts.map((p) => (
                                <span
                                  key={p.id}
                                  title={`${p.sparepart?.namaPart ?? ''} · qty ${p.qty} · ${p.statusPart === 'READY' ? 'READY' : 'ORDER PRODUSEN'}`}
                                  className={cn(
                                    'whitespace-nowrap font-mono text-[10px] font-semibold',
                                    p.statusPart === 'READY' ? 'text-emerald-700' : 'text-rose-600'
                                  )}
                                >
                                  {p.sparepart?.kodePart ?? '?'} <span className="font-normal text-slate-400">×{p.qty}</span>
                                </span>
                              ))}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="max-w-44">
                          {t.parts.length === 0 ? (
                            <span className="text-xs text-slate-400">—</span>
                          ) : (
                            <div className="flex flex-col gap-1">
                              {t.parts.map((p) => (
                                <span
                                  key={p.id}
                                  title={`${p.sparepart?.kodePart ?? ''} · ${p.statusPart === 'READY' ? 'READY' : 'ORDER PRODUSEN'}`}
                                  className={cn(
                                    'truncate text-[11px]',
                                    p.statusPart === 'READY' ? 'text-slate-700' : 'text-slate-400'
                                  )}
                                >
                                  {p.sparepart?.namaPart ?? '?'}
                                  {p.statusPart !== 'READY' && <span className="ml-1 rounded bg-rose-50 px-1 text-[9px] font-semibold text-rose-600">ORDER</span>}
                                </span>
                              ))}
                            </div>
                          )}
                        </TableCell>
                        {(tab === 'REQUEST' || tab === 'PROSES') && (
                          <TableCell className="max-w-48">
                            <p className="truncate text-xs text-slate-700" title={t.deskripsiKerusakan ?? ''}>
                              {t.deskripsiKerusakan?.trim() || <span className="text-slate-400">—</span>}
                            </p>
                          </TableCell>
                        )}
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
                              <Button size="sm" className="h-7 bg-violet-600 px-2 text-[11px] hover:bg-violet-700 disabled:opacity-40"
                                disabled={!t.parts.some((p) => p.statusPart === 'READY')}
                                title={t.parts.some((p) => p.statusPart === 'READY') ? 'Tarik + terbitkan STTB' : 'Input kode + nama part dulu (panel Belum Terproses)'}
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
                            <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px]" onClick={() => openDetail(t)}>
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
                  spareparts={parts}
                  saran={saranParts}
                  waPending={waMutation.isPending}
                  onKirimWa={() => waMutation.mutate(detail.id)}
                  onAction={(body) => flowMutation.mutate({ id: detail.id, body })}
                />
                <div className="rounded-lg bg-slate-50 p-3">
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Unit</p>
                  <p className="font-medium text-slate-800">{detail.unitAsset.modelUnit}</p>
                  <p className="font-mono text-xs text-slate-500">{detail.unitAsset.serialNumber}</p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    <Badge variant="outline" className={detail.unitAsset.statusGaransi === 'NON_GARANSI' ? 'border-amber-300 text-amber-700' : detail.unitAsset.statusGaransi === 'STOK_TOKO' ? 'border-teal-300 text-teal-700' : 'border-emerald-300 text-emerald-700'}>
                      {detail.unitAsset.statusGaransi.replace('_', '-')}
                    </Badge>
                    <Badge variant="outline">{detail.unitAsset.toko?.kodeToko} — {detail.unitAsset.toko?.namaToko}</Badge>
                  </div>
                </div>
                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Deskripsi Kerusakan</p>
                    {detail.status !== 'FINISH' && !tiketEdit && (
                      <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[11px] text-slate-500 hover:text-emerald-700" onClick={() => { setTiketDesc(detail.deskripsiKerusakan ?? ''); setTiketJasa(String(detail.biayaJasa)); setTiketEdit(true) }}>
                        <Pencil className="mr-1 h-3 w-3" /> Koreksi
                      </Button>
                    )}
                  </div>
                  {tiketEdit ? (
                    <div className="space-y-2 rounded-lg border p-2.5">
                      <HistoryInput historyKey="service-deskripsi" value={tiketDesc} onChange={(e) => setTiketDesc(e.target.value)} placeholder="Deskripsi kerusakan…" aria-label="Koreksi deskripsi" />
                      <div className="flex items-center gap-2">
                        <Label className="text-xs text-slate-500">Jasa Rp</Label>
                        <Input type="number" min={0} value={tiketJasa} onChange={(e) => setTiketJasa(e.target.value)} className="h-7 text-xs" aria-label="Koreksi biaya jasa" />
                        <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => setTiketEdit(false)}>Batal</Button>
                        <Button
                          size="sm"
                          className="h-7 bg-emerald-600 text-[11px] hover:bg-emerald-700"
                          disabled={flowMutation.isPending}
                          onClick={() => { flowMutation.mutate({ id: detail.id, body: { aksi: 'UPDATE_JASA', deskripsiKerusakan: tiketDesc, biayaJasa: Number(tiketJasa) || 0 } }); setTiketEdit(false) }}
                        >
                          Simpan
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-slate-700">{detail.deskripsiKerusakan ?? '-'}</p>
                  )}
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
                            {p.sumberPart === 'PRODUSEN' && (
                              <Badge variant="outline" className="border-teal-300 text-[9px] text-teal-700" title="Kode dari balasan produsen — tampil di surat jalan">
                                dari Produsen
                              </Badge>
                            )}
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
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Buat Tiket Service Manual</DialogTitle>
            <DialogDescription>Pilih customer (toko / perorangan) dari data master, klasifikasikan garansi, lalu simpan tiket.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Customer — Toko atau Perorangan</Label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={formTipe === 'TOKO' ? 'default' : 'outline'}
                  className={formTipe === 'TOKO' ? 'bg-emerald-600 hover:bg-emerald-700' : ''}
                  onClick={() => { setFormTipe('TOKO'); setFormPemilik(''); setFormUnit(''); setFormKlasifikasi('') }}
                >
                  Toko (Stok Toko)
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={formTipe === 'PERORANGAN' ? 'default' : 'outline'}
                  className={formTipe === 'PERORANGAN' ? 'bg-emerald-600 hover:bg-emerald-700' : ''}
                  onClick={() => { setFormTipe('PERORANGAN'); setFormPemilik(''); setFormUnit(''); setFormKlasifikasi('') }}
                >
                  Perorangan
                </Button>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>{formTipe === 'TOKO' ? 'Pilih Toko (otomatis dari data toko)' : 'Pilih Customer (otomatis dari data customer)'}</Label>
              <SearchSelect
                value={formPemilik}
                onChange={(v) => { setFormPemilik(v); setFormUnit('') }}
                options={(formTipe === 'TOKO' ? (tokoList ?? []) : (customerList ?? [])).map((p) => (
                  formTipe === 'TOKO'
                    ? { value: String(p.id), label: `${(p as Toko).kodeToko} — ${(p as Toko).namaToko}` }
                    : { value: String(p.id), label: (p as Customer).nama }
                ))}
                placeholder={formTipe === 'TOKO' ? '— Ketik kode/nama toko —' : '— Ketik nama customer —'}
                ariaLabel="Pilih pemilik unit"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Pilih Unit Milik {formTipe === 'TOKO' ? 'Toko' : 'Customer'} Tersebut</Label>
              <SearchSelect
                value={formUnit}
                onChange={setFormUnit}
                disabled={!formPemilik}
                options={unitPilihan.map((u) => ({
                  value: String(u.id),
                  label: `${u.serialNumber} · ${u.modelUnit}`,
                  sub: `${u.merk?.trim() ? `${u.merk.trim()} · ` : ''}${u.statusGaransi.replace('_', '-')}`,
                }))}
                placeholder={formPemilik ? '— Ketik serial/model —' : '— Pilih pemilik dulu —'}
                ariaLabel="Pilih unit"
              />
              {formPemilik && unitPilihan.length === 0 && (
                <p className="text-[11px] text-amber-700">Belum ada unit terdaftar untuk pemilik ini — registrasikan dulu di Master Data → Unit Asset.</p>
              )}
            </div>
            {/* Klasifikasi 3 golongan */}
            {garansiOtomatis ? (
              <div className="rounded-md border border-emerald-300 bg-emerald-50 p-2.5 text-xs text-emerald-800">
                <p className="font-semibold">Golongan: STOK TOKO — otomatis GARANSI</p>
                <p className="mt-0.5">Unit milik toko mendapat garansi otomatis. Biaya repair dinonaktifkan (Rp 0).</p>
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label>Klasifikasi Garansi</Label>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant={formKlasifikasi === 'GARANSI' ? 'default' : 'outline'}
                    className={formKlasifikasi === 'GARANSI' ? 'bg-emerald-600 hover:bg-emerald-700' : ''}
                    onClick={() => setFormKlasifikasi('GARANSI')}
                  >
                    Garansi Customer
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={formKlasifikasi === 'NON_GARANSI' ? 'default' : 'outline'}
                    className={formKlasifikasi === 'NON_GARANSI' ? 'bg-slate-700 hover:bg-slate-800' : ''}
                    onClick={() => setFormKlasifikasi('NON_GARANSI')}
                  >
                    Non Garansi
                  </Button>
                </div>
                {formKlasifikasi === 'GARANSI' && (
                  <p className="text-[11px] text-emerald-700">Garansi aktif — biaya repair dinonaktifkan (Rp 0).</p>
                )}
              </div>
            )}
            <div className="space-y-1.5">
              <Label>Deskripsi Kerusakan</Label>
              <HistoryInput historyKey="service-deskripsi" value={formDesc} onChange={(e) => setFormDesc(e.target.value)} placeholder="Contoh: AC tidak dingin, indikator berkedip..." />
            </div>
            <div className="grid grid-cols-3 gap-3">
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
                <Label>Tanggal Kejadian</Label>
                <Input type="date" value={formTgl} onChange={(e) => setFormTgl(e.target.value)} aria-label="Tanggal kejadian tiket" />
              </div>
              <div className="space-y-1.5">
                <Label>Biaya Repair (Rp){jasaDisabled && ' — nonaktif (garansi)'}</Label>
                <Input type="number" value={jasaDisabled ? '0' : formJasa} onChange={(e) => setFormJasa(e.target.value)} disabled={jasaDisabled} />
              </div>
            </div>
            <p className="text-[11px] text-slate-500">Tanggal kejadian boleh diisi lama (data historis) — nomor tiket &amp; urutan daftar otomatis menyesuaikan tanggal ini.</p>
            <div className="space-y-2">
              <Label>Part untuk Unit Ini — boleh lebih dari satu kode</Label>
              {formParts.map((row, i) => {
                const kodeRow = partKodePerRow[i]
                const dup = kodeRow !== '' && dupPartKode.has(kodeRow)
                const setengah = row.mode === 'manual' && ((!row.kode.trim() && row.nama.trim()) || (row.kode.trim() && !row.nama.trim()))
                return (
                  <div key={row.key} className="space-y-1.5 rounded-md border border-slate-200 bg-slate-50 p-2">
                    <div className="flex items-start gap-1.5">
                      <div className="min-w-0 flex-1">
                        {row.mode === 'katalog' ? (
                          <SearchSelect
                            value={row.sparepartId}
                            onChange={(v) => updatePartRow(row.key, { sparepartId: v })}
                            options={(parts ?? []).map((p) => ({
                              value: String(p.id),
                              label: `${p.kodePart} · ${p.namaPart}`,
                              sub: `${p.brandKompatibel?.trim() ?? ''}${p.brandKompatibel?.trim() ? ' · ' : ''}stok ${p.stokInventory}`.replace(/^ · /, ''),
                            }))}
                            placeholder="— Ketik kode/nama part —"
                            ariaLabel={`Pilih part baris ${i + 1}`}
                          />
                        ) : (
                          <div className="grid grid-cols-2 gap-1.5">
                            <Input
                              value={row.kode}
                              onChange={(e) => updatePartRow(row.key, { kode: e.target.value.toUpperCase() })}
                              placeholder="Kode part"
                              className="h-9 font-mono text-xs"
                              aria-label={`Kode part baris ${i + 1}`}
                            />
                            <Input
                              value={row.nama}
                              onChange={(e) => updatePartRow(row.key, { nama: e.target.value })}
                              placeholder="Nama sparepart"
                              className="h-9 text-xs"
                              aria-label={`Nama sparepart baris ${i + 1}`}
                            />
                          </div>
                        )}
                      </div>
                      <Input
                        type="number"
                        min={1}
                        value={row.qty}
                        onChange={(e) => updatePartRow(row.key, { qty: e.target.value })}
                        className="h-9 w-14 shrink-0 text-center text-xs"
                        aria-label={`Jumlah part baris ${i + 1}`}
                      />
                      {formParts.length > 1 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-9 w-8 shrink-0 text-slate-400 hover:text-red-600"
                          onClick={() => hapusPartRow(row.key)}
                          aria-label={`Hapus part baris ${i + 1}`}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                    <button
                      type="button"
                      className="text-[11px] text-slate-500 underline-offset-2 hover:text-slate-700 hover:underline"
                      onClick={() =>
                        updatePartRow(row.key, row.mode === 'katalog' ? { mode: 'manual', kode: '', nama: '' } : { mode: 'katalog', kode: '', nama: '' })
                      }
                    >
                      {row.mode === 'katalog' ? '＋ belum ada di katalog? tulis kode & nama manual' : 'pilih dari katalog'}
                    </button>
                    {dup && (
                      <p className="text-[11px] font-medium text-red-600">
                        Kode {kodeRow} sudah dipilih di baris lain — gabungkan jumlahnya jadi satu baris (pengulangan tidak diizinkan).
                      </p>
                    )}
                    {setengah && (
                      <p className="text-[11px] font-medium text-red-600">Kode dan nama wajib diisi bersamaan.</p>
                    )}
                  </div>
                )
              })}
              <Button type="button" variant="outline" size="sm" className="w-full border-dashed" onClick={tambahPartRow}>
                <Plus className="mr-1 h-3.5 w-3.5" /> Tambah Part
              </Button>
            </div>
            <p className="flex items-start gap-1.5 rounded-md bg-emerald-50 p-2.5 text-xs text-emerald-800">
              <RotateCcw className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Stok tersinkron otomatis: jika part tersedia, stok bisa-jual (lalu garansi) direserve &amp; inventory berkurang. Jika kosong, part berstatus ORDER_PRODUSEN &amp; produsen dinotifikasi.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Batal</Button>
            <Button
              className="bg-emerald-600 hover:bg-emerald-700"
              disabled={!formPemilik || !formUnit || !formDesc.trim() || (!garansiOtomatis && !formKlasifikasi) || partRowInvalid || dupPartKode.size > 0 || createMutation.isPending}
              onClick={() => createMutation.mutate()}
            >
              <Plus className="mr-1 h-4 w-4" /> Simpan Tiket
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Surat jalan kolektif — part rusak dikirim bersama ke produsen */}
      <SuratJalanDialog
        open={sjOpen}
        onOpenChange={(v) => {
          setSjOpen(v)
          if (!v) {
            // Nomor SJ otomatis tercap ke tiket saat cetak — segarkan daftar
            invalidateAll()
            setSelectedIds(new Set())
          }
        }}
        tickets={sjTickets}
      />
    </div>
  )
}
