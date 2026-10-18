'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetcher, postJson, authHeaders, formatRupiah, formatTanggal, formatWaktu, bukaLinkEksternal, type ServiceTicket, type UnitAsset, type Sparepart, type Toko, type Customer, type SJKandidat, type SJPreview, type SJRingkasan, type SJRiwayat, type SJCek, type SJCekHasil, type SJDraftDetail } from '@/lib/api'
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
  Plus, CheckCircle2, PlayCircle, Send, Ban, AlertOctagon,
  PackageCheck, Eye, Wrench, Camera, DollarSign, RotateCcw, X, Truck, Pencil, Trash2, Minus, ClipboardList, Loader2, Search,
} from 'lucide-react'
import { cn } from '@/lib/utils'

const STATUS_STYLES: Record<string, { label: string; cls: string }> = {
  REQUEST: { label: 'REQUEST', cls: 'bg-amber-100 text-amber-800 border-amber-300' },
  REQUEST_EMAIL: { label: 'REQUEST EMAIL', cls: 'bg-indigo-50 text-indigo-800 border-indigo-300' },
  PROSES: { label: 'PROSES', cls: 'bg-violet-100 text-violet-800 border-violet-300' },
  FINISH: { label: 'FINISH', cls: 'bg-emerald-100 text-emerald-800 border-emerald-300' },
}

const KLAIM_STYLES: Record<string, { label: string; cls: string }> = {
  DRAFT: { label: 'DRAFT', cls: 'bg-slate-100 text-slate-600 border-slate-300' },
  SUBMITTED: { label: 'SUBMITTED', cls: 'bg-amber-100 text-amber-800 border-amber-300' },
  PAID: { label: 'PAID', cls: 'bg-emerald-100 text-emerald-800 border-emerald-300' },
}

/** Badge kecil "(edited)" — penanda koreksi data untuk kepentingan pemeriksaan kelak. */
function BadgeEdited({ waktu, oleh }: { waktu: string; oleh?: string | null }) {
  return (
    <Badge
      variant="outline"
      className="border-amber-300 bg-amber-50 text-[9px] text-amber-700"
      title={`Pernah dikoreksi oleh ${oleh ?? '-'} · ${formatTanggal(waktu)} — riwayat lengkap di Audit Log`}
    >
      edited
    </Badge>
  )
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
  const [brandFilter, setBrandFilter] = useState<string | null>(null)
  const [cariTiket, setCariTiket] = useState('')
  // Pilih tiket untuk surat jalan kolektif (part rusak dikirim bersama ke produsen)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [sjOpen, setSjOpen] = useState(false)
  // Surat jalan masuk (penerimaan part dari produsen — pencocokan AI)
  const [sjMasukOpen, setSjMasukOpen] = useState(false)
  const [sjFile, setSjFile] = useState<File | null>(null)
  const [sjMeta, setSjMeta] = useState({ noSuratJalan: '', tglSurat: '', produsen: '' })
  const [sjPreview, setSjPreview] = useState<SJPreview | null>(null)
  const [sjPilih, setSjPilih] = useState<Record<number, string>>({}) // baris → key kandidat pilihan user
  const [sjGunakanAi, setSjGunakanAi] = useState(true)
  // Alur cek berlapis: INPUT (uraikan Excel) → DRAFT (simpan → cek otomatis/manual → cek akhir → terapkan)
  const [sjMode, setSjMode] = useState<'INPUT' | 'DRAFT'>('INPUT')
  const [sjDraftId, setSjDraftId] = useState<number | null>(null)
  const [sjCekManual, setSjCekManual] = useState(false)
  const [sjTicks, setSjTicks] = useState<Record<number, boolean>>({})
  const [sjCek, setSjCek] = useState<SJCekHasil | null>(null)
  const [sjCekAkhir, setSjCekAkhir] = useState(false)
  const sjNrm = (s: string) => (s || '').toUpperCase().replace(/[^A-Z0-9#]/g, '')
  const [detail, setDetail] = useState<ServiceTicket | null>(null)
  const [tiketEdit, setTiketEdit] = useState(false)
  const [tiketDesc, setTiketDesc] = useState('')
  const [tiketJasa, setTiketJasa] = useState('0')
  // Koreksi part (kode/nama/qty) oleh Admin Workshop/Manager — tersimpan dengan
  // tanda "(edited)" di baris part & tiket untuk audit pemeriksaan kelak.
  const bisaKoreksiPart = role === 'ADMIN_WORKSHOP' || role === 'MANAGER'
  const [partEdit, setPartEdit] = useState<{ id: number; kode: string; nama: string; qty: string } | null>(null)
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
      if (navIntent.serviceBrand) setBrandFilter(navIntent.serviceBrand)
      clearNavIntent()
    }, 0)
    return () => clearTimeout(t)
  }, [navIntent, clearNavIntent])

  // Ganti tiket di dialog detail → tutup mode koreksi
  const openDetail = (t: ServiceTicket | null) => {
    setTiketEdit(false)
    setPartEdit(null)
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
    queryClient.invalidateQueries({ queryKey: ['surat-jalan'] })
  }

  // ===== Surat Jalan Masuk: uraikan Excel → cocokkan ke tiket SV-EM/part ready → terapkan =====
  const sjMatchMutation = useMutation({
    mutationFn: () => {
      if (!sjFile) throw new Error('Pilih file Excel/CSV surat jalan dulu')
      const fd = new FormData()
      fd.append('file', sjFile)
      fd.append('useAi', String(sjGunakanAi))
      return fetch('/api/surat-jalan/match', { method: 'POST', headers: authHeaders(), body: fd }).then(async (res) => {
        const j = (await res.json().catch(() => ({}))) as (SJPreview & { error?: string })
        if (!res.ok) throw new Error(j.error || `Gagal menguraikan file (${res.status})`)
        return j
      })
    },
    onSuccess: (p) => {
      setSjPreview(p)
      setSjPilih({})
      setSjMeta((m) => ({
        noSuratJalan: p.noSuratJalan || m.noSuratJalan,
        tglSurat: p.tglSurat ? new Date(p.tglSurat).toISOString().slice(0, 10) : m.tglSurat,
        produsen: p.produsen || m.produsen,
      }))
      toast({
        title: `Surat jalan teruraikan — ${p.cocokCount} dari ${p.items.length} baris otomatis cocok`,
        description: p.dibantuAi > 0 ? `${p.dibantuAi} baris dicocokkan AI. Periksa hasil → Simpan Draft → cek berlapis.` : 'Preview hanya baca — Simpan Draft lalu lewati cek berlapis sebelum diterapkan.',
      })
    },
    onError: (e: Error) => toast({ title: 'Gagal menguraikan surat jalan', description: e.message, variant: 'destructive' }),
  })
  const sjApplyMutation = useMutation({
    // SIMPAN DRAFT — tanpa efek ke tiket/unit; lanjut: cek berlapis → cek akhir → terapkan.
    mutationFn: () =>
      postJson<{ ok: boolean; id: number; status: string; totalItem: number; cocokCount: number; tanpaTiket: number }>('/api/surat-jalan', {
        noSuratJalan: sjMeta.noSuratJalan.trim() || new Date().toISOString().slice(0, 10).replace(/-/g, ''),
        tglSurat: sjMeta.tglSurat || null,
        produsen: sjMeta.produsen.trim() || null,
        namaFile: sjPreview?.namaFile,
        aktor: role === 'TEKNISI' ? 'Teknisi Lapangan' : 'Admin Workshop',
        rows: (sjPreview?.items ?? []).map((b, i) => ({
          kodePart: b.kodePart,
          namaPart: b.namaPart,
          qty: b.qty,
          serialNumber: b.serialNumber,
          pilihKey: sjPilih[i] || b.cocokKey || '',
        })),
      }),
    onSuccess: (r) => {
      invalidateAll()
      setSjMode('DRAFT')
      setSjDraftId(r.id)
      setSjCek(null)
      setSjCekAkhir(false)
      setSjCekManual(false)
      setSjTicks({})
      setSjPreview(null)
      setSjFile(null)
      setSjPilih({})
      setSjMeta({ noSuratJalan: '', tglSurat: '', produsen: '' })
      toast({ title: `Draft ${r.totalItem} baris tersimpan (belum berpengaruh)`, description: 'Lanjutkan: Cek Berlapis → Cek Akhir → Terapkan Permanen. Draft tidak mengubah tiket/unit apa pun.' })
    },
    onError: (e: Error) => toast({ title: 'Gagal menyimpan draft surat jalan', description: e.message, variant: 'destructive' }),
  })
  const sjDetailQuery = useQuery<SJDraftDetail>({
    queryKey: ['surat-jalan-detail', sjDraftId],
    queryFn: () => fetcher<SJDraftDetail>(`/api/surat-jalan/${sjDraftId}`),
    enabled: sjMode === 'DRAFT' && sjDraftId != null,
  })
  const sjDraft = sjDetailQuery.data ?? null
  const sjPeriksaMutation = useMutation({
    // Cek berlapis: duplikat nomor + validasi silang tiap baris (tiket aktif,
    // penerimaan ganda, SN unit, katalog) — tidak menulis apa pun ke tiket.
    mutationFn: (params: { cekManual: boolean }) =>
      postJson<SJCekHasil>(`/api/surat-jalan/${sjDraftId}/periksa`, { cekManual: params.cekManual, aktor: role === 'TEKNISI' ? 'Teknisi Lapangan' : 'Admin Workshop' }),
    onSuccess: (h, params) => {
      setSjCek(h)
      setSjCekAkhir(false)
      void queryClient.invalidateQueries({ queryKey: ['surat-jalan-detail', sjDraftId] })
      queryClient.invalidateQueries({ queryKey: ['surat-jalan'] })
      toast({
        title: h.bisaTerapkan ? `Cek ${params.cekManual ? '(manual) ' : ''}selesai — belum ada blokir` : `Cek menemukan ${h.blokir} masalah blokir`,
        description: `${h.blokir} blokir · ${h.peringatan} peringatan · ${h.info} info${h.bisaTerapkan ? '. Lanjut Cek Akhir.' : '. Perbaiki baris bermasalah dulu.'}`,
        variant: h.bisaTerapkan ? 'default' : 'destructive',
      })
    },
    onError: (e: Error) => toast({ title: 'Gagal menjalankan cek', description: e.message, variant: 'destructive' }),
  })
  const sjItemMutation = useMutation({
    // Koreksi/tautan tiket satu baris draft (dipakai saat cek manual/fix blokir)
    mutationFn: (params: { itemId: number; pilihKey: string }) =>
      postJson<{ ok: boolean }>(`/api/surat-jalan/${sjDraftId}/item`, { ...params, aktor: role === 'TEKNISI' ? 'Teknisi Lapangan' : 'Admin Workshop' }),
    onSuccess: () => {
      setSjCek(null) // cek harus diulang setelah koreksi
      setSjCekAkhir(false)
      void queryClient.invalidateQueries({ queryKey: ['surat-jalan-detail', sjDraftId] })
      queryClient.invalidateQueries({ queryKey: ['surat-jalan'] })
    },
    onError: (e: Error) => toast({ title: 'Gagal mengubah baris', description: e.message, variant: 'destructive' }),
  })
  const sjTerapkanMutation = useMutation({
    // CEK AKHIR + TERAPKAN PERMANEN: server menjalankan cek ulang & menolak bila blokir.
    mutationFn: () =>
      postJson<SJRingkasan>(`/api/surat-jalan/${sjDraftId}/terapkan`, {
        aktor: role === 'TEKNISI' ? 'Teknisi Lapangan' : 'Admin Workshop',
        sudahCekManual: sjCekManual && sjDraft?.items.every((i) => sjTicks[i.id]) === true ? true : undefined,
      }),
    onSuccess: (r) => {
      invalidateAll()
      queryClient.invalidateQueries({ queryKey: ['surat-jalan-detail', sjDraftId] })
      queryClient.invalidateQueries({ queryKey: ['surat-jalan'] })
      setSjCek(null)
      setSjCekAkhir(false)
      toast({
        title: `Surat jalan ${r.noSuratJalan} DITERAPKAN PERMANEN`,
        description: `${r.cocokCount} dari ${r.totalItem} baris cocok${r.tanpaTiket ? ` · ${r.tanpaTiket} tanpa tiket (tercatat)` : ''}${r.naikProses ? ` · ${r.naikProses} tiket otomatis naik PROSES` : ''}.`,
      })
    },
    onError: (e: Error) => toast({ title: 'Cek akhir menolak — tidak diterapkan', description: e.message, variant: 'destructive' }),
  })
  const sjHapusMutation = useMutation({
    mutationFn: (id: number) => fetch(`/api/surat-jalan/${id}`, { method: 'DELETE', headers: authHeaders() }).then(async (res) => {
      if (!res.ok) throw new Error(`Gagal menghapus (${res.status})`)
      return res.json()
    }),
    onSuccess: () => {
      if (sjDraftId) { setSjDraftId(null); setSjMode('INPUT') }
      queryClient.invalidateQueries({ queryKey: ['surat-jalan'] })
      toast({ title: 'Draft surat jalan dihapus' })
    },
    onError: (e: Error) => toast({ title: 'Gagal menghapus draft', description: e.message, variant: 'destructive' }),
  })
  // Riwayat surat jalan masuk (diambil hanya saat dialog terbuka)
  const { data: sjRiwayat } = useQuery<SJRiwayat[]>({
    queryKey: ['surat-jalan'],
    queryFn: () => fetcher<SJRiwayat[]>('/api/surat-jalan'),
    enabled: sjMasukOpen,
  })

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

  // ===== Tiket REQUEST EMAIL: kirim email order part ke produsen =====
  // SMTP tersedia → kirim sungguhan (+ lampiran bila sudah diunggah via modul email)
  // & part jadi TERKIRIM; SMTP belum diset → draf mailto dibuka di aplikasi email
  // (item tetap PENDING). Upload lampiran memakai antre modul email — bukan dari tabel.
  const kirimEmailTiket = useMutation({
    mutationFn: (id: number) =>
      postJson<{ ok: true; mode: 'SMTP' | 'MAILTO'; terkirim?: number; ke?: string; mailto?: string; noTiket: string; error?: string }>(
        `/api/service/${id}`,
        { aksi: 'KIRIM_EMAIL_PRODUSEN', aktor: role === 'TEKNISI' ? 'Teknisi Lapangan' : 'Admin Workshop' },
        'PATCH'
      ),
    onSuccess: (r) => {
      invalidateAll()
      if (r.mode === 'SMTP') {
        toast({ title: `Email order terkirim (${r.terkirim} part)`, description: `Tiket ${r.noTiket} → ${r.ke}. Part di tiket ini ditandai TERKIRIM.` })
      } else {
        if (r.mailto) bukaLinkEksternal(r.mailto)
        toast({
          title: 'Draf email dibuka',
          description: `Tiket ${r.noTiket} — SMTP belum dikonfigurasi; lampirkan PDF Detail Unit manual di aplikasi email, atau set SMTP di Pengaturan → Email Produsen.`,
        })
      }
    },
    onError: (e: Error) => toast({ title: 'Gagal mengirim email', description: e.message, variant: 'destructive' }),
  })

  const filtered = useMemo(() => {
    if (!tickets) return []
    let list = tab === 'SEMUA' ? tickets : tickets.filter((t) => t.status === tab)
    if (garansiFilter !== 'SEMUA') list = list.filter((t) => garansiFilter === 'GARANSI' ? t.unitAsset.statusGaransi !== 'NON_GARANSI' : t.unitAsset.statusGaransi === 'NON_GARANSI')
    if (modelFilter) list = list.filter((t) => t.unitAsset.modelUnit === modelFilter)
    if (tokoFilter) list = list.filter((t) => t.unitAsset.toko?.kodeToko === tokoFilter)
    if (brandFilter) list = list.filter((t) => (t.unitAsset.merk?.trim() || '').toLowerCase() === brandFilter.toLowerCase())
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

  const hasDrilldown = garansiFilter !== 'SEMUA' || modelFilter !== null || tokoFilter !== null || brandFilter !== null

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

  // STTB kolektif per toko (pick up): wajib 1 toko yang sama
  const [sttbBusy, setSttbBusy] = useState(false)
  async function unduhSttbKolektif() {
    const list = sjTickets
    if (list.length === 0 || sttbBusy) return
    const tokoSet = new Set(list.map((t) => t.unitAsset.toko?.kodeToko ?? '-'))
    if (tokoSet.size !== 1) {
      toast({ title: 'Pilih 1 toko', description: 'STTB kolektif merangkum 1 toko — centang tiket dari toko yang sama.', variant: 'destructive' })
      return
    }
    setSttbBusy(true)
    try {
      const res = await fetch('/api/sttb/kolektif', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ noTiket: list.map((t) => t.noTiket) }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error((err as { error?: string }).error || `Gagal membuat STTB kolektif (${res.status})`)
      }
      const cd = res.headers.get('content-disposition') ?? ''
      const m = cd.match(/filename="([^"]+)"/)
      const filename = m?.[1] ?? `STTB-Kolektif-${new Date().toISOString().slice(0, 10)}.pdf`
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      toast({ title: 'STTB kolektif terunduh', description: `${filename} · ${list.length} unit siap pick up.` })
    } catch (e) {
      toast({ title: 'Gagal mencetak STTB kolektif', description: e instanceof Error ? e.message : 'Coba lagi', variant: 'destructive' })
    } finally {
      setSttbBusy(false)
    }
  }

  const counts = useMemo(() => {
    const c = { SEMUA: 0, REQUEST: 0, REQUEST_EMAIL: 0, PROSES: 0, FINISH: 0 }
    for (const t of tickets ?? []) {
      c.SEMUA++
      if (t.status in c) c[t.status as keyof typeof c]++
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
          <CardContent className="flex h-full flex-col items-center justify-center gap-1.5 px-4">
            <Button size="sm" onClick={() => setCreateOpen(true)} className="bg-emerald-600 hover:bg-emerald-700">
              <Plus className="mr-1 h-4 w-4" /> Tiket Manual
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="border-indigo-300 text-[11px] text-indigo-700 hover:bg-indigo-50"
              onClick={() => { setSjPreview(null); setSjFile(null); setSjPilih({}); setSjMasukOpen(true) }}
              title="Masukkan surat jalan sparepart dari produsen — dicocokkan otomatis ke tiket SV-EM / part ready produsen & unit asset"
            >
              <Truck className="mr-1 h-3.5 w-3.5" /> Surat Jalan Masuk
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
              <TabsTrigger value="REQUEST_EMAIL">EMAIL ({counts.REQUEST_EMAIL})</TabsTrigger>
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
            <Button
              variant="outline"
              size="sm"
              className="border-slate-700 text-slate-700 hover:bg-slate-50"
              onClick={() => void unduhSttbKolektif()}
              disabled={selectedIds.size === 0 || sttbBusy}
              title="Cetak STTB kolektif — daftar unit siap pick up dari 1 toko (wajib centang 1 toko yang sama)"
            >
              {sttbBusy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <ClipboardList className="mr-1 h-3.5 w-3.5" />}
              STTB Toko{selectedIds.size > 0 ? ` (${selectedIds.size})` : ''}
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
              {brandFilter && (
                <Badge variant="outline" className="max-w-64 gap-1 border-sky-300 bg-sky-50 text-sky-700">
                  <span className="truncate">Brand: {brandFilter}</span>
                  <button
                    type="button"
                    aria-label="Hapus filter brand"
                    onClick={() => setBrandFilter(null)}
                    className="ml-0.5 rounded-full p-0.5 hover:bg-sky-100"
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
                            {t.editedAt && <BadgeEdited waktu={t.editedAt} oleh={t.editedBy} />}
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
                          {t.isDataLama ? (
                            <>
                              <Badge variant="outline" className="border-slate-400 text-[10px] text-slate-600" title={`Data lama: tgl kejadian ${formatWaktu(t.tglTiket)}, diupload ${formatWaktu(t.createdAt)} — umur dinonaktifkan`}>
                                DATA LAMA
                              </Badge>
                              <p className="mt-0.5 text-[10px] text-slate-400">{formatWaktu(t.tglTiket)}</p>
                            </>
                          ) : (
                            <>
                              <p className="text-xs text-slate-500">{t.umurTiketJam ?? 0} jam</p>
                              <p className="text-[10px] text-slate-400">{formatWaktu(t.tglTiket)}</p>
                            </>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex flex-wrap items-center justify-end gap-1.5">
                            {t.status === 'REQUEST_EMAIL' && (
                              <Button
                                size="sm"
                                className="h-7 bg-violet-600 px-2 text-[11px] hover:bg-violet-700"
                                disabled={kirimEmailTiket.isPending}
                                onClick={() => kirimEmailTiket.mutate(t.id)}
                                title="Kirim email order part ke produsen (butuh SMTP di Pengaturan → Email Produsen)"
                              >
                                <Send className="mr-1 h-3 w-3" /> Kirim Email
                              </Button>
                            )}
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

      {/* ===== Dialog Surat Jalan Masuk — DRAFT → CEK BERLAPIS → TERAPKAN PERMANEN ===== */}
      <Dialog
        open={sjMasukOpen}
        onOpenChange={(o) => {
          setSjMasukOpen(o)
          if (!o) {
            setSjPreview(null); setSjFile(null); setSjPilih({}); setSjCek(null); setSjCekAkhir(false); setSjTicks({}); setSjDraftId(null); setSjMode('INPUT')
          }
        }}
      >
        <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Surat Jalan Masuk — Penerimaan Part Produsen</DialogTitle>
            <DialogDescription>
              <b>Cek berlapis</b>: uraikan Excel → <b>Simpan Draft</b> (tidak berpengaruh apa pun) → <b>Cek Otomatis</b>
              {' '}+ opsi <b>Cek Manual per baris</b> → <b>Cek Akhir</b>. Efek ke tiket/unit hanya saat <b>Terapkan Permanen</b>.
            </DialogDescription>
          </DialogHeader>

          {sjMode === 'INPUT' && (
            <div className="space-y-3">
              <div className="grid gap-2 sm:grid-cols-3">
                <div className="space-y-1"><Label>No Surat Jalan</Label><Input value={sjMeta.noSuratJalan} onChange={(e) => setSjMeta({ ...sjMeta, noSuratJalan: e.target.value })} placeholder="mis. SJ-20261018-112" /></div>
                <div className="space-y-1"><Label>Tanggal Surat</Label><Input type="date" value={sjMeta.tglSurat} onChange={(e) => setSjMeta({ ...sjMeta, tglSurat: e.target.value })} /></div>
                <div className="space-y-1"><Label>Produsen</Label><Input value={sjMeta.produsen} onChange={(e) => setSjMeta({ ...sjMeta, produsen: e.target.value })} placeholder="mis. SANY" /></div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={(e) => { setSjFile(e.target.files?.[0] ?? null); setSjPreview(null) }}
                  aria-label="File surat jalan Excel/CSV"
                  className="w-full cursor-pointer rounded-md border border-dashed border-slate-300 p-2 text-xs file:mr-2 file:cursor-pointer file:rounded file:border-0 file:bg-slate-100 file:px-2 file:py-1 file:text-xs sm:flex-1"
                />
                <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-slate-600">
                  <Checkbox className="h-3.5 w-3.5" checked={sjGunakanAi} onCheckedChange={(c) => setSjGunakanAi(c === true)} aria-label="Gunakan AI untuk baris yang belum cocok" />
                  Bantuan AI untuk baris belum cocok
                </label>
                <Button size="sm" className="bg-indigo-600 hover:bg-indigo-700" disabled={!sjFile || sjMatchMutation.isPending} onClick={() => sjMatchMutation.mutate()}>
                  {sjMatchMutation.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Truck className="mr-1 h-4 w-4" />} Uraikan &amp; Cocokkan
                </Button>
              </div>
              {sjPreview && (
                <div className="rounded-lg border">
                  <div className="border-b bg-slate-50 px-3 py-1.5 text-[11px] text-slate-600">
                    {sjPreview.items.length} baris · <b className="text-emerald-700">{sjPreview.cocokCount} cocok</b>
                    {sjPreview.items.length - sjPreview.cocokCount > 0 && <> · <b className="text-amber-700">{sjPreview.items.length - sjPreview.cocokCount} tanpa tiket (tetap tercatat)</b></>}
                    {sjPreview.dibantuAi > 0 && <> · {sjPreview.dibantuAi} dibantu AI</>}
                    {sjPreview.terlewati > 0 && <> · {sjPreview.terlewati} baris dilewati</>}
                  </div>
                  <div className="max-h-60 overflow-y-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-[11px]">Kode</TableHead>
                          <TableHead className="text-[11px]">Nama</TableHead>
                          <TableHead className="text-[11px]">Qty</TableHead>
                          <TableHead className="text-[11px]">SN Unit</TableHead>
                          <TableHead className="text-[11px]">Hasil</TableHead>
                          <TableHead className="text-[11px]">Tiket</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {sjPreview.items.map((b, i) => {
                          const kand: SJKandidat | undefined = [...(b.cocokCand ? [b.cocokCand] : []), ...b.opsi].find((k) => k.key === (sjPilih[i] || b.cocokKey))
                          return (
                            <TableRow key={i}>
                              <TableCell className="font-mono text-[11px]">{b.kodePart}</TableCell>
                              <TableCell className="max-w-40 truncate text-[11px]" title={b.namaPart}>{b.namaPart || '—'}</TableCell>
                              <TableCell className="text-[11px]">{b.qty}</TableCell>
                              <TableCell className="font-mono text-[11px]">{b.serialNumber || '—'}</TableCell>
                              <TableCell>
                                <Badge variant="outline" className={b.statusMatch === 'COCOK' ? 'border-emerald-300 bg-emerald-50 text-[10px] text-emerald-700' : 'border-amber-300 bg-amber-50 text-[10px] text-amber-700'}>
                                  {b.statusMatch === 'COCOK' ? 'COCOK' : 'TANPA TIKET'}
                                </Badge>
                              </TableCell>
                              <TableCell>
                                {kand && b.statusMatch === 'COCOK' ? (
                                  <p className="font-mono text-[10px] text-emerald-700" title={`${kand.model} · ${kand.serial}${kand.sudahReady ? ' · sudah READY' : ''}`}>{kand.noTiket}</p>
                                ) : (
                                  <select
                                    value={sjPilih[i] || ''}
                                    onChange={(e) => setSjPilih({ ...sjPilih, [i]: e.target.value })}
                                    className="w-44 cursor-pointer rounded border border-slate-200 px-1 py-0.5 text-[10px]"
                                    aria-label={`Pilih tiket untuk baris ${b.kodePart}`}
                                  >
                                    <option value="">— biarkan tanpa tiket —</option>
                                    {b.opsi.map((o) => (
                                      <option key={o.key} value={o.key}>{o.noTiket} · {o.serial || o.model} · {o.kodePart}</option>
                                    ))}
                                    {b.cocokCand && !b.opsi.some((o) => o.key === b.cocokCand!.key) && (
                                      <option key={b.cocokCand.key} value={b.cocokCand.key}>{b.cocokCand.noTiket} · {b.cocokCand.serial || b.cocokCand.model} · {b.cocokCand.kodePart}</option>
                                    )}
                                  </select>
                                )}
                              </TableCell>
                            </TableRow>
                          )
                        })}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}
              <p className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[10px] text-slate-500">
                <b>Simpan Draft</b> hanya merekam hasil uraikan &amp; pencocokan. Tidak ada part/tiket/unit yang berubah —
                verifikasi dilakukan di tahap cek berlapis.
              </p>
            </div>
          )}

          {sjMode === 'DRAFT' && sjDraft && (() => {
            const butuhCekManual = sjCekManual || sjDraft.cekManual
            const semuaCekManual = !butuhCekManual || sjDraft.items.every((i) => sjTicks[i.id])
            const cekByItem = new Map((sjCek?.items ?? []).filter((m) => m.itemId != null).map((m) => [m.itemId as number, m]))
            const masalahNonOk = (sjCek?.items ?? []).filter((m) => m.tingkat !== 'OK')
            const warnaStatus = sjDraft.status === 'DITERAPKAN' ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : sjDraft.status === 'DIPERIKSA' ? 'border-sky-300 bg-sky-50 text-sky-700' : 'border-slate-300 bg-slate-100 text-slate-600'
            return (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className={`text-[10px] ${warnaStatus}`}>{sjDraft.status}</Badge>
                    <span className="font-mono font-semibold text-slate-700">{sjDraft.noSuratJalan}</span>
                    {sjDraft.produsen && <span>{sjDraft.produsen}</span>}
                    <span>{sjDraft.cocokCount}/{sjDraft.items.length} cocok</span>
                    {sjDraft.diperiksaOleh && <span className="text-slate-400">· cek: {sjDraft.diperiksaOleh} {sjDraft.diperiksaAt ? formatWaktu(sjDraft.diperiksaAt) : ''}</span>}
                    {sjDraft.diterapkanOleh && <span className="text-emerald-700">· diterapkan {sjDraft.diterapkanOleh} {sjDraft.diterapkanAt ? formatWaktu(sjDraft.diterapkanAt) : ''}</span>}
                  </div>
                  {sjDraft.status !== 'DITERAPKAN' && (
                    <Button size="sm" variant="outline" className="border-rose-200 text-[10px] text-rose-600 hover:bg-rose-50" onClick={() => sjHapusMutation.mutate(sjDraft.id)}>
                      Hapus Draft
                    </Button>
                  )}
                </div>

                <div className="max-h-60 overflow-y-auto rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        {butuhCekManual && <TableHead className="w-8 text-[11px]">✓</TableHead>}
                        <TableHead className="text-[11px]">Kode</TableHead>
                        <TableHead className="text-[11px]">Qty</TableHead>
                        <TableHead className="text-[11px]">SN</TableHead>
                        <TableHead className="text-[11px]">Tiket Tujuan</TableHead>
                        <TableHead className="text-[11px]">Cek</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sjDraft.items.map((item) => {
                        const kandTujuan = item.tiket ? sjDraft.kandidat.find((k) => k.serviceRequestId === item.tiket!.id && sjNrm(k.kodePart) === sjNrm(item.kodePart)) : undefined
                        const cekRow = cekByItem.get(item.id)
                        return (
                          <TableRow key={item.id}>
                            {butuhCekManual && (
                              <TableCell>
                                <Checkbox
                                  className="h-3.5 w-3.5"
                                  checked={sjTicks[item.id] === true}
                                  disabled={sjDraft.status === 'DITERAPKAN'}
                                  onCheckedChange={(c) => { setSjTicks({ ...sjTicks, [item.id]: c === true }); setSjCekAkhir(false) }}
                                  aria-label={`Verifikasi manual baris ${item.kodePart}`}
                                />
                              </TableCell>
                            )}
                            <TableCell className="font-mono text-[11px]" title={item.namaPart ?? undefined}>{item.kodePart}</TableCell>
                            <TableCell className="text-[11px]">{item.qty}</TableCell>
                            <TableCell className="font-mono text-[11px]">{item.serialNumber || '—'}</TableCell>
                            <TableCell>
                              {sjDraft.status === 'DITERAPKAN' ? (
                                <span className="font-mono text-[10px] text-slate-600">{item.tiket?.noTiket ?? '—'}</span>
                              ) : (
                                <select
                                  value={kandTujuan?.key ?? ''}
                                  onChange={(e) => { sjItemMutation.mutate({ itemId: item.id, pilihKey: e.target.value }); setSjTicks({ ...sjTicks, [item.id]: false }) }}
                                  className="w-48 cursor-pointer rounded border border-slate-200 px-1 py-0.5 text-[10px]"
                                  aria-label={`Tiket tujuan baris ${item.kodePart}`}
                                >
                                  <option value="">— tanpa tiket (catatan saja) —</option>
                                  {sjDraft.kandidat
                                    .filter((k) => sjNrm(k.kodePart) === sjNrm(item.kodePart))
                                    .map((o) => (
                                      <option key={o.key} value={o.key}>{o.noTiket} · {o.serial || o.model} · {o.kodePart}{o.sudahReady ? ' · READY' : ''}</option>
                                    ))}
                                </select>
                              )}
                            </TableCell>
                            <TableCell>
                              {cekRow ? (
                                <span
                                  className={`text-[10px] ${cekRow.tingkat === 'BLOKIR' ? 'text-rose-700' : cekRow.tingkat === 'PERINGATAN' ? 'text-amber-700' : cekRow.tingkat === 'INFO' ? 'text-sky-700' : 'text-emerald-700'}`}
                                  title={cekRow.pesan}
                                >
                                  {cekRow.tingkat === 'BLOKIR' ? '⛔ BLOKIR' : cekRow.tingkat === 'PERINGATAN' ? '⚠ PERINGATAN' : cekRow.tingkat === 'INFO' ? 'ⓘ INFO' : '✔ OK'}
                                </span>
                              ) : (
                                <span className="text-[10px] text-slate-300">belum dicek</span>
                              )}
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-slate-600">
                    <Checkbox
                      className="h-3.5 w-3.5"
                      checked={sjCekManual}
                      disabled={sjDraft.status === 'DITERAPKAN'}
                      onCheckedChange={(c) => { setSjCekManual(c === true); setSjCek(null); setSjCekAkhir(false) }}
                      aria-label="Cek manual per baris"
                    />
                    Cek manual per baris {butuhCekManual ? <span className="text-[10px] text-rose-600">(centang semua baris)</span> : ''}
                  </label>
                  <Button size="sm" variant="outline" className="ml-auto" disabled={sjDraft.status === 'DITERAPKAN' || sjPeriksaMutation.isPending || sjDraft.items.length === 0} onClick={() => sjPeriksaMutation.mutate({ cekManual: butuhCekManual })}>
                    {sjPeriksaMutation.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Search className="mr-1 h-4 w-4" />}
                    {sjCek ? 'Cek Ulang' : 'Jalankan Cek Berlapis'}
                  </Button>
                </div>

                {sjCek && (
                  <div className="rounded-lg border p-3 text-[11px]">
                    <div className="mb-1.5 flex flex-wrap items-center gap-2">
                      {sjCek.header.map((h, i) => (
                        <span key={i} className={`rounded px-1.5 py-0.5 ${h.tingkat === 'BLOKIR' ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700'}`}>{h.tingkat}: {h.pesan}</span>
                      ))}
                      <span className="text-slate-500">{sjCek.items.length} baris · {sjCek.blokir} blokir · {sjCek.peringatan} peringatan · {sjCek.info} info</span>
                    </div>
                    {masalahNonOk.length > 0 && (
                      <ul className="max-h-36 space-y-0.5 overflow-y-auto">
                        {masalahNonOk.slice(0, 12).map((m, i) => (
                          <li key={i} className="flex items-start gap-1">
                            <span className={`font-semibold ${m.tingkat === 'BLOKIR' ? 'text-rose-700' : m.tingkat === 'PERINGATAN' ? 'text-amber-700' : 'text-sky-700'}`}>{m.tingkat === 'BLOKIR' ? '⛔' : m.tingkat === 'PERINGATAN' ? '⚠' : 'ⓘ'}</span>
                            <span className="text-slate-600"><span className="font-mono">{m.kode}</span> — {m.pesan}</span>
                          </li>
                        ))}
                        {masalahNonOk.length > 12 && <li className="text-slate-400">… dan {masalahNonOk.length - 12} lainnya</li>}
                      </ul>
                    )}
                  </div>
                )}

                {sjCek && !sjCekAkhir && (
                  <p className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[10px] text-slate-500">
                    Cek berlapis selesai{butuhCekManual && !semuaCekManual ? ' — selesaikan centang verifikasi manual' : ''}. Tekan <b>Cek Akhir</b> untuk verifikasi
                    final; <b>Terapkan Permanen</b> baru tersedia bila cek akhir bersih.
                  </p>
                )}
                {sjCekAkhir && sjCek?.bisaTerapkan && (
                  <p className="rounded-md border border-emerald-300 bg-emerald-50 px-2.5 py-1.5 text-[10px] font-semibold text-emerald-700">
                    ✔ CEK AKHIR BERSIH — siap diterapkan permanen. Konsiliasi server akan mengulang cek sebagai pertahanan akhir.
                  </p>
                )}
              </div>
            )
          })()}

          {sjMode === 'DRAFT' && !sjDraft && (
            <div className="flex items-center gap-2 py-6 text-center text-xs text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Memuat draft…
            </div>
          )}

          {(() => {
            const butuhCekManual = sjCekManual || (sjDraft?.cekManual ?? false)
            const semuaCekManual = !butuhCekManual || sjDraft?.items.every((i) => sjTicks[i.id]) === true
            const siapTerapkan = sjCekAkhir && sjCek?.bisaTerapkan === true && semuaCekManual && sjDraft?.status !== 'DITERAPKAN'
            const riwayat = sjRiwayat ?? []
            const jalankanCekAkhir = async () => {
              try {
                const h = await sjPeriksaMutation.mutateAsync({ cekManual: butuhCekManual })
                if (h.bisaTerapkan) setSjCekAkhir(true)
              } catch {
                // toast kesalahan sudah ditampilkan mutation onError
              }
            }
            return (
              <DialogFooter className="flex-col gap-2 sm:items-end">
                {riwayat.length > 0 && (
                  <div className="w-full space-y-1 text-left">
                    <p className="text-[11px] font-semibold text-slate-600">Riwayat surat jalan masuk (klik Lanjut untuk draft yang belum selesai)</p>
                    {riwayat.slice(0, 5).map((r) => (
                      <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-200 px-2 py-1 text-[10px] text-slate-500">
                        <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                          <Badge variant="outline" className={r.status === 'DITERAPKAN' ? 'border-emerald-300 bg-emerald-50 text-[9px] text-emerald-700' : r.status === 'DIPERIKSA' ? 'border-sky-300 bg-sky-50 text-[9px] text-sky-700' : 'border-slate-300 bg-slate-100 text-[9px] text-slate-600'}>{r.status}</Badge>
                          <span className="font-mono font-semibold text-slate-700">{r.noSuratJalan}{r.produsen ? ` · ${r.produsen}` : ''}</span>
                          <span>{formatTanggal(r.createdAt)} · {r.cocokCount}/{r.totalItem} cocok</span>
                        </span>
                        <span className="flex items-center gap-1">
                          {r.status !== 'DITERAPKAN' ? (
                            <>
                              <button type="button" className="cursor-pointer rounded border border-indigo-200 bg-indigo-50 px-1.5 py-0.5 text-[9px] text-indigo-700 hover:bg-indigo-100" onClick={() => { setSjDraftId(r.id); setSjMode('DRAFT'); setSjCekManual(r.cekManual); setSjCek(null); setSjCekAkhir(false); setSjTicks({}) }}>Lanjut</button>
                              <button type="button" className="cursor-pointer rounded border border-rose-200 bg-rose-50 px-1.5 py-0.5 text-[9px] text-rose-600 hover:bg-rose-100" onClick={() => sjHapusMutation.mutate(r.id)}>Hapus</button>
                            </>
                          ) : (
                            <span className="text-emerald-700">diterapkan {r.diterapkanOleh ?? ''}{r.diterapkanAt ? ` · ${formatWaktu(r.diterapkanAt)}` : ''}</span>
                          )}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                {sjMode === 'INPUT' && (
                  <div className="flex gap-2">
                    <Button variant="outline" disabled={!sjPreview || sjPreview.items.length === 0 || sjApplyMutation.isPending} onClick={() => sjApplyMutation.mutate()}>
                      {sjApplyMutation.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Truck className="mr-1 h-4 w-4" />} Simpan Draft
                    </Button>
                  </div>
                )}
                {sjMode === 'DRAFT' && sjDraft && sjDraft.status !== 'DITERAPKAN' && (
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <Button
                      variant="outline"
                      disabled={!sjCek || !sjCek.bisaTerapkan || !semuaCekManual || sjPeriksaMutation.isPending}
                      onClick={() => void jalankanCekAkhir()}
                      title="Verifikasi final ulang (server menjalankan cek penuh) — syarat sebelum Terapkan Permanen"
                    >
                      {sjPeriksaMutation.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-1 h-4 w-4" />} Cek Akhir
                    </Button>
                    <Button
                      className="bg-emerald-600 hover:bg-emerald-700"
                      disabled={!siapTerapkan || sjTerapkanMutation.isPending}
                      onClick={() => sjTerapkanMutation.mutate()}
                    >
                      {sjTerapkanMutation.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-1 h-4 w-4" />} Terapkan Permanen
                    </Button>
                  </div>
                )}
              </DialogFooter>
            )
          })()}
        </DialogContent>
      </Dialog>

      {/* ===== Dialog Detail Tiket ===== */}
      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
          {detail && (
            <>
              <DialogHeader>
                <DialogTitle className="flex flex-wrap items-center gap-2 font-mono text-base">
                  {detail.noTiket}
                  <Badge variant="outline" className={STATUS_STYLES[detail.status].cls}>{STATUS_STYLES[detail.status].label}</Badge>
                  {detail.editedAt && <BadgeEdited waktu={detail.editedAt} oleh={detail.editedBy} />}
                  {detail.slaFlag && <Badge variant="destructive">SLA TERLAMBAT</Badge>}
                </DialogTitle>
                <DialogDescription>
                  Tgl kejadian {formatWaktu(detail.tglTiket)} · Diupload {formatWaktu(detail.createdAt)} · Klaim {detail.statusKlaimProdusen}
                  {detail.isDataLama && ' · DATA LAMA (umur nonaktif)'}
                </DialogDescription>
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
                        <div key={p.id} className="rounded-md border px-3 py-2">
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0">
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
                              {p.editedAt && <BadgeEdited waktu={p.editedAt} oleh={p.editedBy} />}
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
                              {(detail.status !== 'FINISH' || bisaKoreksiPart) && (
                                <div className="mt-0.5 flex items-center gap-1">
                                  {bisaKoreksiPart && (
                                    <Button
                                      size="sm" variant="outline" className="h-6 w-6 p-0 text-amber-600 hover:bg-amber-50" title="Koreksi kode/nama/qty part — tersimpan dengan tanda (edited) di sistem"
                                      disabled={flowMutation.isPending}
                                      onClick={() => setPartEdit({ id: p.id, kode: p.sparepart?.kodePart ?? '', nama: p.sparepart?.namaPart ?? '', qty: String(p.qty) })}
                                    >
                                      <Pencil className="h-3 w-3" />
                                    </Button>
                                  )}
                                  <Button
                                    size="sm" variant="outline" className="h-6 w-6 p-0" title="Kurangi qty 1"
                                    disabled={flowMutation.isPending || p.qty <= 1}
                                    onClick={() => flowMutation.mutate({ id: detail.id, body: { aksi: 'UBAH_QTY_PART', partId: p.id, qty: p.qty - 1, ...(detail.status === 'FINISH' ? { koreksiSelesai: true } : {}) } })}
                                  >
                                    <Minus className="h-3 w-3" />
                                  </Button>
                                  <Button
                                    size="sm" variant="outline" className="h-6 w-6 p-0" title="Tambah qty 1 (cek stok bila READY)"
                                    disabled={flowMutation.isPending}
                                    onClick={() => flowMutation.mutate({ id: detail.id, body: { aksi: 'UBAH_QTY_PART', partId: p.id, qty: p.qty + 1, ...(detail.status === 'FINISH' ? { koreksiSelesai: true } : {}) } })}
                                  >
                                    <Plus className="h-3 w-3" />
                                  </Button>
                                  <Button
                                    size="sm" variant="outline" className="h-6 w-6 p-0 text-rose-600 hover:bg-rose-50" title="Hapus baris part ini (koreksi salah input — stok dikembalikan)"
                                    disabled={flowMutation.isPending}
                                    onClick={() => {
                                      if (!window.confirm(`Hapus ${p.sparepart?.kodePart} ×${p.qty} dari tiket ${detail.noTiket}? Stok yang direserve akan dikembalikan${detail.status === 'FINISH' ? ' — tiket akan tertanda (edited)' : ''}.`)) return
                                      flowMutation.mutate({ id: detail.id, body: { aksi: 'HAPUS_PART', partId: p.id, ...(detail.status === 'FINISH' ? { koreksiSelesai: true } : {}) } })
                                    }}
                                  >
                                    <Trash2 className="h-3 w-3" />
                                  </Button>
                                </div>
                              )}
                            </div>
                          </div>
                          {partEdit?.id === p.id && (
                            <div className="mt-2 space-y-2 rounded-md border border-amber-200 bg-amber-50 p-2.5">
                              <p className="text-[11px] font-semibold text-amber-800">Koreksi part — perubahan tertanda (edited) di sistem &amp; Audit Log untuk pemeriksaan kelak</p>
                              <div className="grid gap-2 sm:grid-cols-3">
                                <div className="space-y-1">
                                  <Label className="text-[10px] text-slate-500">Kode Part</Label>
                                  <Input value={partEdit.kode} onChange={(e) => setPartEdit({ ...partEdit, kode: e.target.value.toUpperCase() })} className="h-7 font-mono text-[11px]" aria-label="Kode part koreksi" />
                                </div>
                                <div className="space-y-1">
                                  <Label className="text-[10px] text-slate-500">Nama Part</Label>
                                  <Input value={partEdit.nama} onChange={(e) => setPartEdit({ ...partEdit, nama: e.target.value })} className="h-7 text-[11px]" aria-label="Nama part koreksi" />
                                </div>
                                <div className="space-y-1">
                                  <Label className="text-[10px] text-slate-500">Qty</Label>
                                  <Input type="number" min={1} value={partEdit.qty} onChange={(e) => setPartEdit({ ...partEdit, qty: e.target.value })} className="h-7 text-[11px]" aria-label="Qty part koreksi" />
                                </div>
                              </div>
                              {detail.statusKlaimProdusen !== 'DRAFT' && (
                                <p className="text-[10px] text-amber-700">Klaim sudah {detail.statusKlaimProdusen} — nilai klaim akan mengikuti data hasil koreksi.</p>
                              )}
                              <div className="flex items-center justify-end gap-2">
                                <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => setPartEdit(null)}>Batal</Button>
                                <Button
                                  size="sm"
                                  className="h-7 bg-emerald-600 text-[11px] hover:bg-emerald-700"
                                  disabled={!partEdit.kode.trim() || !partEdit.nama.trim() || !(Number(partEdit.qty) >= 1) || flowMutation.isPending}
                                  onClick={() => {
                                    flowMutation.mutate({ id: detail.id, body: { aksi: 'KOREKSI_PART', partId: partEdit.id, kodePart: partEdit.kode.trim().toUpperCase(), namaPart: partEdit.nama.trim(), qty: partEdit.qty } })
                                    setPartEdit(null)
                                  }}
                                >
                                  Simpan Koreksi
                                </Button>
                              </div>
                            </div>
                          )}
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
                  <p className="rounded-md bg-slate-50 p-2 text-[11px] text-slate-600">
                    No. STTB <span className="font-mono font-semibold text-slate-800">{detail.noSttb}</span>
                    {' '}— cetak via tombol <span className="font-semibold">STTB Toko</span> di daftar Service (centang tiket 1 toko yang sama).
                  </p>
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
              <HistoryInput historyKey="service-deskripsi" value={formDesc} onChange={(e) => setFormDesc(e.target.value)} placeholder="Contoh: Kipas tidak berputar, bau gosong..." />
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
