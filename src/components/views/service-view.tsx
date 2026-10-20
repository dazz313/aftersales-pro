'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetcher, postJson, authHeaders, formatRupiah, formatTanggal, formatWaktu, bukaLinkEksternal, type ServiceTicket, type UnitAsset, type Sparepart, type Toko, type Customer } from '@/lib/api'
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
import KodeSparepart from '@/components/kode-sparepart'
import { useToast } from '@/hooks/use-toast'
import { useAppStore } from '@/lib/store'
import { ServiceFlowStepper, ServiceFlowActions, SUMBER_LABEL } from '@/components/service-flow'
import QuickSearch, { matchQuery } from '@/components/quick-search'
import SearchSelect from '@/components/search-select'
import HistoryInput from '@/components/history-input'
import {
  Plus, CheckCircle2, PlayCircle, Send, Ban, AlertOctagon,
  PackageCheck, Eye, Wrench, Camera, DollarSign, RotateCcw, X, Truck, Pencil, Trash2, Minus, ClipboardList, Loader2, MailPlus, ChevronDown,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { formatUmur } from '@/lib/umur'

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

/** Normalisasi kode part — sama dgn server utk mencocokkan baris part → item order-email. */
const KODE_NORM = (s?: string | null) => (s ?? '').toUpperCase().replace(/[^A-Z0-9#]/g, '')

/** Item order-email AKTIF (PENDING/TERKIRIM) untuk satu kode part pada tiket — null bila belum diorder. */
const emailAktifUntuk = (
  list: ServiceTicket['orderEmailParts'],
  kode?: string | null
): NonNullable<ServiceTicket['orderEmailParts']>[number] | null =>
  list?.find((e) => KODE_NORM(e.kodePart) === KODE_NORM(kode) && (e.status === 'PENDING' || e.status === 'TERKIRIM')) ?? null

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

  // ===== Email order part ke produsen (Kekurangan Part) =====
  // SMTP tersedia → kirim sungguhan (+ lampiran bila sudah diunggah via modul email)
  // & item jadi TERKIRIM; SMTP belum diset → draf mailto dibuka di aplikasi email
  // (item tetap PENDING). Upload lampiran memakai antre modul email — bukan dari tabel.
  // Dipakai 2 mutation: tiket REQUEST_EMAIL (Kirim Email), dan Reorder part inden
  // (Email Order → daftarkan baris ORDER_PRODUSEN dulu, lalu langsung kirim).
  const kirimEmailOrder = (id: number) =>
    postJson<{ ok: true; mode: 'SMTP' | 'MAILTO'; terkirim?: number; ke?: string; mailto?: string; noTiket: string }>(
      `/api/service/${id}`,
      { aksi: 'KIRIM_EMAIL_PRODUSEN', aktor: role === 'TEKNISI' ? 'Teknisi Lapangan' : 'Admin Workshop' },
      'PATCH'
    )
  const notifikasiEmailOrder = (r: { ok: true; mode: 'SMTP' | 'MAILTO'; terkirim?: number; ke?: string; mailto?: string; noTiket: string }) => {
    invalidateAll()
    if (r.mode === 'SMTP') {
      toast({ title: `Email order terkirim (${r.terkirim} part)`, description: `Tiket ${r.noTiket} → ${r.ke}. Part inden ditandai TERKIRIM — tunggu barang masuk, lalu klik Part Datang.` })
    } else {
      if (r.mailto) bukaLinkEksternal(r.mailto)
      toast({
        title: 'Draf email dibuka',
        description: `Tiket ${r.noTiket} — SMTP belum dikonfigurasi; lampirkan PDF Detail Unit manual di aplikasi email, atau set SMTP di Pengaturan → Email Produsen.`,
      })
    }
  }
  const kirimEmailTiket = useMutation({
    mutationFn: kirimEmailOrder,
    onSuccess: (r) => notifikasiEmailOrder(r),
    onError: (e: Error) => toast({ title: 'Gagal mengirim email', description: e.message, variant: 'destructive' }),
  })

  // ===== Reorder part inden dari tiket biasa (REQUEST/PROSES) =====
  // Satu klik: daftarkan baris part ORDER_PRODUSEN yang belum diorder jadi item
  // email (server idempoten — baris yang sudah ada dilewati), lalu langsung
  // kirim email order ke produsen. Identifikasi READY vs INDEN per baris tetap
  // terlihat dari chip/marker per part.
  const orderEmailTiket = useMutation({
    mutationFn: async (id: number) => {
      await postJson(`/api/service/${id}`, { aksi: 'ORDER_EMAIL_REORDER', aktor: role === 'TEKNISI' ? 'Teknisi Lapangan' : 'Admin Workshop' }, 'PATCH')
      return kirimEmailOrder(id)
    },
    onSuccess: (r) => notifikasiEmailOrder(r),
    onError: (e: Error) => toast({ title: 'Gagal reorder part inden', description: e.message, variant: 'destructive' }),
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
  // ===== Pemasangan Part (per Toko): centang item siap dipasang → sahkan =====
  // Part tiba (Surat Jalan Masuk) membuat statusPart READY — panel ini menyaring
  // yang BELUM dipasang, dikelompokkan per toko; sahkan mencatat tglPasang +
  // pasangOleh dan bisa mengunduh Dokumen Pemasangan (PDF per toko).
  interface PasangRow {
    id: number
    noTiket: string
    statusTiket: string
    lokasiUnit: string
    kodeToko: string
    toko: string
    serial: string
    model: string
    kodePart: string
    namaPart: string
    qty: number
    tglPasang: string | null
    pasangOleh: string | null
    docNo: string | null
  }
  const [pasangOpen, setPasangOpen] = useState(false)
  const [pasangData, setPasangData] = useState<{ siap: PasangRow[]; riwayat: PasangRow[] } | null>(null)
  const [pasangLoading, setPasangLoading] = useState(false)
  const [pasangSel, setPasangSel] = useState<Set<number>>(new Set())
  const [pasangBusy, setPasangBusy] = useState(false)
  const [pasangRiwayatOpen, setPasangRiwayatOpen] = useState(false)
  async function muatPasang() {
    setPasangLoading(true)
    try {
      setPasangData(await fetcher<{ siap: PasangRow[]; riwayat: PasangRow[] }>('/api/pemasangan'))
    } catch (e) {
      toast({ title: 'Panel Pemasangan gagal dimuat', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setPasangLoading(false)
    }
  }
  function bukaPanelPasang() {
    const buka = !pasangOpen
    setPasangOpen(buka)
    if (buka && pasangData === null) void muatPasang()
  }
  const pasangToko = useMemo(() => {
    const m = new Map<string, PasangRow[]>()
    for (const r of pasangData?.siap ?? []) {
      const arr = m.get(r.toko) ?? []
      arr.push(r)
      m.set(r.toko, arr)
    }
    return [...m.entries()]
  }, [pasangData])
  async function sahkanPasang(denganDokumen: boolean) {
    if (pasangSel.size === 0 || pasangBusy) return
    const n = pasangSel.size
    setPasangBusy(true)
    try {
      const res = await fetch('/api/pemasangan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ itemIds: [...pasangSel], format: denganDokumen ? 'pdf' : undefined }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error((err as { error?: string }).error || `Gagal menyahkan pemasangan (${res.status})`)
      }
      let filename = ''
      if (denganDokumen) {
        const cd = res.headers.get('content-disposition') ?? ''
        const m = cd.match(/filename="([^"]+)"/)
        filename = m?.[1] ?? `Dokumen-Pemasangan-${new Date().toISOString().slice(0, 10)}.pdf`
        const blob = await res.blob()
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = filename
        document.body.appendChild(a)
        a.click()
        a.remove()
        URL.revokeObjectURL(url)
      }
      void queryClient.invalidateQueries({ queryKey: ['service-tickets'] })
      setPasangSel(new Set())
      await muatPasang()
      toast({
        title: `${n} part dinyatakan dipasang`,
        description: denganDokumen ? `${filename} terunduh · waktu pasang tercatat per toko.` : 'Waktu pasang tercatat per toko (lihat Riwayat).',
      })
    } catch (e) {
      toast({ title: 'Gagal menyahkan pemasangan', description: e instanceof Error ? e.message : 'Coba lagi', variant: 'destructive' })
    } finally {
      setPasangBusy(false)
    }
  }
  // Riwayat dikelompokkan per dokumen pemasangan (nomor PMS) sehingga satu
  // dokumen fisik (yang bisa rusak/tercecer) bisa dicetak ulang utuh.
  const riwayatDokumen = useMemo(() => {
    const m = new Map<string, PasangRow[]>()
    for (const r of pasangData?.riwayat ?? []) {
      const kunci = r.docNo ?? `${r.tglPasang ?? ''}|${r.pasangOleh ?? '-'}`
      const arr = m.get(kunci) ?? []
      arr.push(r)
      m.set(kunci, arr)
    }
    return [...m.entries()]
  }, [pasangData])
  async function cetakUlangPasang(rows: PasangRow[]) {
    if (rows.length === 0 || pasangBusy) return
    const docNo = rows[0].docNo ?? rows[0].tglPasang ?? 'dokumen'
    setPasangBusy(true)
    try {
      const res = await fetch('/api/pemasangan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ itemIds: rows.map((r) => r.id), cetakUlang: true, format: 'pdf' }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error((err as { error?: string }).error || `Gagal cetak ulang (${res.status})`)
      }
      const cd = res.headers.get('content-disposition') ?? ''
      const m = cd.match(/filename="([^"]+)"/)
      const filename = m?.[1] ?? `Dokumen-Pemasangan-Ulang-${docNo}.pdf`
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      toast({ title: `${filename} terunduh`, description: `Cetakan ulang ${docNo} — nomor & waktu pasang asli tetap tertulis.` })
    } catch (e) {
      toast({ title: 'Gagal cetak ulang', description: e instanceof Error ? e.message : 'Coba lagi', variant: 'destructive' })
    } finally {
      setPasangBusy(false)
    }
  }

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
          </CardContent>
        </Card>
      </div>

      {/* ===== Panel Pemasangan Part (per Toko) ===== */}
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="flex flex-wrap items-center gap-2 text-base">
              <Wrench className="h-4 w-4 text-teal-700" /> Pemasangan Part (per Toko)
              {pasangData && pasangData.siap.length > 0 && (
                <Badge variant="outline" className="border-teal-300 text-[10px] text-teal-700">
                  {pasangData.siap.length} part menunggu · {[...new Set(pasangData.siap.map((r) => r.toko))].length} toko
                </Badge>
              )}
            </CardTitle>
            <CardDescription>
              Hanya tiket PROSES (unit ditarik) dengan part READY/diterima yang lolos: centang per toko → Sahkan → waktu pasang tercatat + Dokumen Pemasangan
            </CardDescription>
          </div>
          <Button variant="ghost" size="sm" onClick={bukaPanelPasang}>
            {pasangOpen ? <ChevronDown className="mr-1 h-3.5 w-3.5" /> : <Wrench className="mr-1 h-3.5 w-3.5" />}
            {pasangOpen ? 'Tutup' : 'Buka'}
          </Button>
        </CardHeader>
        {pasangOpen && (
          <CardContent className="space-y-3">
            {pasangData === null ? (
              <p className="rounded-lg border border-dashed p-4 text-center text-xs text-slate-500">{pasangLoading ? 'Memuat…' : '—'}</p>
            ) : pasangData.siap.length === 0 ? (
              <p className="rounded-lg border border-dashed p-4 text-center text-xs text-slate-500">
                Tidak ada part menunggu pemasangan — part READY sudah tercatat dipasang, atau kiriman belum diterapkan.
              </p>
            ) : (
              <>
                {pasangToko.map(([toko, rows]) => {
                  const semuaCeklis = rows.every((r) => pasangSel.has(r.id))
                  return (
                    <div key={toko} className="overflow-hidden rounded-lg border">
                      <div className="flex items-center justify-between gap-2 bg-slate-50 px-3 py-1.5">
                        <p className="text-xs font-bold text-slate-700">
                          {toko} <span className="font-normal text-slate-400">· {rows.length} part</span>
                        </p>
                        <button
                          type="button"
                          className="text-[10px] text-teal-700 hover:underline"
                          onClick={() => {
                            const ids = rows.map((r) => r.id)
                            setPasangSel((prev) => {
                              const next = new Set(prev)
                              for (const id of ids) if (semuaCeklis) next.delete(id); else next.add(id)
                              return next
                            })
                          }}
                        >
                          {semuaCeklis ? 'Lepas semua' : 'Pilih semua'}
                        </button>
                      </div>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-8" />
                            <TableHead className="text-[10px]">No. Tiket</TableHead>
                            <TableHead className="text-[10px]">Serial / Model</TableHead>
                            <TableHead className="text-[10px]">Kode Part</TableHead>
                            <TableHead className="text-[10px]">Nama Part</TableHead>
                            <TableHead className="text-right text-[10px]">Qty</TableHead>
                            <TableHead className="text-[10px]">Status</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {rows.map((r) => (
                            <TableRow key={r.id} className={cn(pasangSel.has(r.id) && 'bg-teal-50/60')}>
                              <TableCell>
                                <Checkbox
                                  aria-label={`Pilih part ${r.kodePart} — tiket ${r.noTiket}`}
                                  checked={pasangSel.has(r.id)}
                                  onCheckedChange={() =>
                                    setPasangSel((prev) => {
                                      const next = new Set(prev)
                                      if (next.has(r.id)) next.delete(r.id); else next.add(r.id)
                                      return next
                                    })
                                  }
                                />
                              </TableCell>
                              <TableCell>
                                <p className="font-mono text-[11px] font-semibold text-emerald-700">{r.noTiket}</p>
                                <p className="text-[9px] text-slate-400">{r.lokasiUnit === 'TOKO' ? 'unit di toko' : 'unit di workshop'}</p>
                              </TableCell>
                              <TableCell>
                                <p className="font-mono text-[10px] text-slate-500">{r.serial || '—'}</p>
                                <p className="max-w-32 truncate text-[10px] text-slate-400" title={r.model || undefined}>{r.model || '—'}</p>
                              </TableCell>
                              <TableCell>
                                <KodeSparepart kode={r.kodePart} nama={r.namaPart} className="text-[11px] text-slate-800" />
                              </TableCell>
                              <TableCell>
                                <p className="max-w-40 truncate text-xs text-slate-700" title={r.namaPart}>{r.namaPart}</p>
                              </TableCell>
                              <TableCell className="text-right text-xs font-bold">{r.qty}</TableCell>
                              <TableCell>
                                <Badge variant="outline" className="text-[9px]">{r.statusTiket}</Badge>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )
                })}
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="border-teal-300 text-[10px] text-teal-700">
                    {pasangSel.size} item dipilih
                  </Badge>
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-teal-700 text-teal-700 hover:bg-teal-50"
                    disabled={pasangSel.size === 0 || pasangBusy}
                    onClick={() => void sahkanPasang(true)}
                    title="Tandai dipasang + unduh Dokumen Pemasangan (PDF, seksi per toko)"
                  >
                    {pasangBusy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <ClipboardList className="mr-1 h-3.5 w-3.5" />}
                    Sahkan &amp; Cetak Dokumen
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pasangSel.size === 0 || pasangBusy}
                    onClick={() => void sahkanPasang(false)}
                  >
                    <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Sahkan Saja
                  </Button>
                </div>
                {/* Riwayat pemasangan 7 hari — deteksi per toko & waktu pasang */}
                <div className="border-t border-slate-200 pt-2">
                  <button
                    type="button"
                    className="flex w-full items-center justify-between text-[11px] font-semibold text-slate-600 hover:text-teal-700"
                    onClick={() => setPasangRiwayatOpen((v) => !v)}
                  >
                    <span>Riwayat Pemasangan 7 hari ({pasangData.riwayat.length} part)</span>
                    <span className="text-[10px] font-normal text-slate-400">{pasangRiwayatOpen ? 'tutup ▲' : 'buka ▼'}</span>
                  </button>
                  {pasangRiwayatOpen &&
                    (pasangData.riwayat.length === 0 ? (
                      <p className="mt-2 rounded-lg border border-dashed p-3 text-center text-[10px] text-slate-500">
                        Belum ada pemasangan dalam 7 hari terakhir.
                      </p>
                    ) : (
                      <div className="mt-2 max-h-96 space-y-2 overflow-auto rounded-md border p-2">
                        {riwayatDokumen.map(([docNo, rows]) => (
                          <div key={docNo} className="overflow-hidden rounded border">
                            <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-50 px-2.5 py-1.5">
                              <p className="font-mono text-[10px] font-bold text-slate-700">
                                {docNo ?? 'tanpa nomor'}
                                <span className="ml-2 font-sans font-normal text-slate-400">
                                  {rows.length} part · oleh {rows[0].pasangOleh ?? '—'} · {formatWaktu(rows[0].tglPasang)}
                                </span>
                              </p>
                              <button
                                type="button"
                                className="text-[10px] text-teal-700 hover:underline disabled:opacity-40"
                                disabled={pasangBusy}
                                onClick={() => void cetakUlangPasang(rows)}
                                title="Cetak ulang dokumen dengan nomor & waktu asli — untuk dokumen rusak/tercecer"
                              >
                                🖨 Cetak Ulang
                              </button>
                            </div>
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead className="text-[10px]">Waktu Pasang</TableHead>
                                  <TableHead className="text-[10px]">Toko</TableHead>
                                  <TableHead className="text-[10px]">No. Tiket</TableHead>
                                  <TableHead className="text-[10px]">Kode Part</TableHead>
                                  <TableHead className="text-[10px]">Nama Part</TableHead>
                                  <TableHead className="text-right text-[10px]">Qty</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {rows.map((r) => (
                                  <TableRow key={r.id}>
                                    <TableCell className="whitespace-nowrap text-[10px] font-bold text-emerald-700">{formatWaktu(r.tglPasang)}</TableCell>
                                    <TableCell className="max-w-32 truncate text-[10px]" title={r.toko}>{r.toko}</TableCell>
                                    <TableCell className="font-mono text-[10px] text-emerald-700">{r.noTiket}</TableCell>
                                    <TableCell className="font-mono text-[10px] text-slate-700">{r.kodePart}</TableCell>
                                    <TableCell className="max-w-36 truncate text-[10px]" title={r.namaPart}>{r.namaPart}</TableCell>
                                    <TableCell className="text-right text-[10px]">{r.qty}</TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </div>
                        ))}
                      </div>
                    ))}
                </div>
              </>
            )}
          </CardContent>
        )}
      </Card>

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
                    <TableHead className="hidden sm:table-cell">Umur</TableHead>
                    <TableHead className="max-w-44">Kerusakan</TableHead>
                    <TableHead className="text-right">Aksi</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((t) => {
                    const st = STATUS_STYLES[t.status]
                    const kl = KLAIM_STYLES[t.statusKlaimProdusen]
                    const hasOrderPart = t.parts.some((p) => p.statusPart === 'ORDER_PRODUSEN')
                    // Identifikasi Ready vs Inden per part + status item order-email
                    const readyCnt = t.parts.filter((p) => p.statusPart === 'READY').length
                    const indenCnt = t.parts.length - readyCnt
                    // Part inden belum dipesan via email → perlu aksi "Email Order"
                    const butuhOrderEmail =
                      hasOrderPart &&
                      (t.parts.some(
                        (p) =>
                          p.statusPart === 'ORDER_PRODUSEN' &&
                          !emailAktifUntuk(t.orderEmailParts, p.sparepart?.kodePart)
                      ) || !t.orderEmailParts)
                    // Email jadi tombol ikon; aksi lain dipadatkan ke dropdown agar kolom Aksi hemat ruang
                    const emailAktif =
                      t.status === 'REQUEST_EMAIL' || (hasOrderPart && (t.status === 'REQUEST' || t.status === 'PROSES'))
                    const adaAksiLain =
                      t.status === 'REQUEST' ||
                      t.status === 'PROSES' ||
                      (t.status === 'FINISH' && (t.statusKlaimProdusen === 'DRAFT' || t.statusKlaimProdusen === 'SUBMITTED'))
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
                            <div className="flex flex-col items-start">
                              <Badge variant="outline" className={st.cls}>{st.label}</Badge>
                              {/* Tgl request part (kecepatan "Surat Jalan" ditekan) tampil */}
                              {/* di bawah badge REQUEST — pembanding saat part datang tidak serentak */}
                              {t.status === 'REQUEST' && t.tglRequestPart && (
                                <span
                                  className="mt-0.5 font-mono text-[9px] text-slate-500"
                                  title={`Request part ke produsen: ${new Date(t.tglRequestPart).toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit', year: '2-digit' })}`}
                                >
                                  Req: {new Date(t.tglRequestPart).toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit' })}
                                </span>
                              )}
                            </div>
                            {/* Ringkasan part: ✔ READY vs ● INDEN — identifikasi sekilas tanpa buka detail */}
                            {t.parts.length > 0 && (
                              <Badge
                                variant="outline"
                                className={cn(
                                  'text-[9px]',
                                  indenCnt > 0 ? 'border-rose-200 bg-rose-50/50 text-rose-700' : 'border-emerald-200 bg-emerald-50/50 text-emerald-700'
                                )}
                                title={`Part READY: ${readyCnt} · Part inden (order produsen): ${indenCnt}`}
                              >
                                {readyCnt} ready · {indenCnt} inden
                              </Badge>
                            )}
                            {t.slaFlag && <Badge variant="destructive" className="gap-0.5 text-[9px]"><AlertOctagon className="h-2.5 w-2.5" /> SLA</Badge>}
                            {t.status === 'FINISH' && t.statusKlaimProdusen !== 'DRAFT' && <Badge variant="outline" className={kl.cls}>{kl.label}</Badge>}
                            {t.editedAt && <BadgeEdited waktu={t.editedAt} oleh={t.editedBy} />}
                          </div>
                        </TableCell>
                        <TableCell>
                          {t.parts.length === 0 ? (
                            <span className="text-xs text-slate-400">—</span>
                          ) : (
                            <div className="flex flex-col gap-1">
                              {t.parts.map((p) => (
                                <span key={p.id} className="flex min-w-0 items-center gap-0.5 whitespace-nowrap">
                                  <KodeSparepart
                                    kode={p.sparepart?.kodePart ?? ''}
                                    nama={p.sparepart?.namaPart}
                                    cek
                                    className={p.statusPart === 'READY' ? 'text-[10px] text-emerald-700' : 'text-[10px] text-rose-600'}
                                  />
                                  <span className="font-mono text-[10px] font-normal text-slate-400">×{p.qty}</span>
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
                              <p className="text-xs text-slate-500">{formatUmur(t.umurTiketJam)}</p>
                              <p className="text-[10px] text-slate-400">{formatWaktu(t.tglTiket)}</p>
                            </>
                          )}
                        </TableCell>
                        <TableCell className="max-w-44">
                          {/* Diagnosa kerusakan unit — utamakan diagnosa awal (sama dgn Master Barcode), fallback deskripsi tiket */}
                          {t.unitAsset.kerusakanAwal?.trim() ? (
                            <p className="line-clamp-2 text-[11px] text-slate-700" title={`Diagnosa awal unit (bahasa awam): ${t.unitAsset.kerusakanAwal}`}>{t.unitAsset.kerusakanAwal}</p>
                          ) : t.deskripsiKerusakan?.trim() ? (
                            <p className="line-clamp-2 text-[11px] text-slate-500" title={`Deskripsi kerusakan tiket: ${t.deskripsiKerusakan}`}>{t.deskripsiKerusakan}</p>
                          ) : (
                            <span className="text-[11px] text-slate-400">–</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {emailAktif && (
                              butuhOrderEmail ? (
                                <Button size="sm" variant="outline" className="h-7 w-7 p-0 text-violet-700"
                                  disabled={orderEmailTiket.isPending}
                                  title="Email Order — reorder part inden (ORDER) ke produsen; part READY tidak ikut"
                                  onClick={() => orderEmailTiket.mutate(t.id)}>
                                  <MailPlus className="h-3 w-3" />
                                  <span className="sr-only">Email Order</span>
                                </Button>
                              ) : (
                                <Button size="sm" variant="outline" className="h-7 w-7 p-0 text-violet-700"
                                  disabled={kirimEmailTiket.isPending}
                                  title={t.status === 'REQUEST_EMAIL'
                                    ? 'Kirim email order part ke produsen (butuh SMTP di Pengaturan → Email Produsen)'
                                    : 'Kirim email order part inden yang belum terkirim'}
                                  onClick={() => kirimEmailTiket.mutate(t.id)}>
                                  <Send className="h-3 w-3" />
                                  <span className="sr-only">Kirim Email</span>
                                </Button>
                              )
                            )}
                            {adaAksiLain && (
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" title="Aksi lainnya">
                                    Aksi <ChevronDown className="ml-0.5 h-3 w-3" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-56">
                                  {t.status === 'REQUEST' && (
                                    <DropdownMenuItem
                                      className="gap-1.5 text-[11px] text-violet-700"
                                      disabled={!t.parts.some((p) => p.statusPart === 'READY')}
                                      title={t.parts.some((p) => p.statusPart === 'READY') ? 'Tarik + terbitkan STTB' : 'Input kode + nama part dulu (panel Belum Terproses)'}
                                      onClick={() => aksiMutation.mutate({ id: t.id, body: { aksi: 'MULAI_PROSES' } })}>
                                      <PlayCircle className="h-3 w-3" /> Proses + STTB
                                    </DropdownMenuItem>
                                  )}
                                  {hasOrderPart && (t.status === 'REQUEST' || t.status === 'PROSES') && (
                                    <DropdownMenuItem
                                      className="gap-1.5 text-[11px] text-teal-700"
                                      title="Part tunggungan dari produsen sudah datang — tandai READY"
                                      onClick={() => aksiMutation.mutate({ id: t.id, body: { aksi: 'TERIMA_PART_PRODUSEN' } })}>
                                      <PackageCheck className="h-3 w-3" /> Part Datang
                                    </DropdownMenuItem>
                                  )}
                                  {t.status === 'PROSES' && (
                                    <DropdownMenuItem
                                      className="gap-1.5 text-[11px] text-emerald-700"
                                      onClick={() => { setFinishTarget(t); setNotaFile(`nota-stempel-${t.noTiket}.jpg`) }}>
                                      <Camera className="h-3 w-3" /> Selesaikan
                                    </DropdownMenuItem>
                                  )}
                                  {t.status === 'FINISH' && t.statusKlaimProdusen === 'DRAFT' && (
                                    <DropdownMenuItem
                                      className="gap-1.5 text-[11px] text-amber-700"
                                      onClick={() => aksiMutation.mutate({ id: t.id, body: { aksi: 'SUBMIT_CLAIM' } })}>
                                      <Send className="h-3 w-3" /> Ajukan Klaim
                                    </DropdownMenuItem>
                                  )}
                                  {t.status === 'FINISH' && t.statusKlaimProdusen === 'SUBMITTED' && (
                                    <DropdownMenuItem
                                      className="gap-1.5 text-[11px] text-emerald-700"
                                      onClick={() => aksiMutation.mutate({ id: t.id, body: { aksi: 'MARK_PAID' } })}>
                                      <DollarSign className="h-3 w-3" /> Tandai Lunas
                                    </DropdownMenuItem>
                                  )}
                                </DropdownMenuContent>
                              </DropdownMenu>
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
                  {detail.parts.length > 0 && (() => {
                    const r = detail.parts.filter((p) => p.statusPart === 'READY').length
                    const o = detail.parts.length - r
                    return (
                      <Badge
                        variant="outline"
                        className={cn('text-[10px]', o > 0 ? 'border-rose-200 bg-rose-50/50 text-rose-700' : 'border-emerald-200 bg-emerald-50/50 text-emerald-700')}
                        title={`Part READY: ${r} · Part inden (order produsen): ${o}`}
                      >
                        {r} ready · {o} inden
                      </Badge>
                    )
                  })()}
                  {detail.editedAt && <BadgeEdited waktu={detail.editedAt} oleh={detail.editedBy} />}
                  {detail.slaFlag && <Badge variant="destructive">SLA TERLAMBAT</Badge>}
                </DialogTitle>
                <DialogDescription>
                  Tgl kejadian {formatWaktu(detail.tglTiket)} · Diupload {formatWaktu(detail.createdAt)}
                  {detail.statusKlaimProdusen !== 'DRAFT' && <> · Klaim {detail.statusKlaimProdusen}</>}
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
                  {detail.parts.length > 0 && (() => {
                    const r = detail.parts.filter((p) => p.statusPart === 'READY').length
                    const o = detail.parts.length - r
                    const em = detail.orderEmailParts?.filter((e) => e.status === 'PENDING' || e.status === 'TERKIRIM').length ?? 0
                    return (
                      <p className="mb-2 text-[11px] text-slate-600">
                        <span className="font-semibold text-emerald-700">{r} part ready (stok direserve)</span>
                        {' · '}
                        <span className={cn('font-semibold', o > 0 ? 'text-rose-600' : 'text-slate-400')}>{o} inden (ORDER PRODUSEN)</span>
                        {em > 0 && (
                          <> · <span className="font-semibold text-indigo-600">{em} diorder via email</span></>
                        )}
                      </p>
                    )
                  })()}
                  {detail.parts.length === 0 ? (
                    <p className="text-xs text-slate-400">Tidak ada part tercatat.</p>
                  ) : (
                    <div className="space-y-1.5">
                      {detail.parts.map((p) => (
                        <div key={p.id} className="rounded-md border px-3 py-2">
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-xs font-medium text-slate-800">{p.sparepart?.namaPart}</p>
                              <p className="flex items-center gap-1 font-mono text-[10px] text-slate-400">
                                <KodeSparepart kode={p.sparepart?.kodePart ?? ''} nama={p.sparepart?.namaPart} cek />
                                <span>· qty {p.qty}</span>
                              </p>
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
                              {p.statusPart === 'ORDER_PRODUSEN' && (() => {
                                const em = emailAktifUntuk(detail.orderEmailParts, p.sparepart?.kodePart)
                                return em ? (
                                  <Badge
                                    variant="outline"
                                    className="border-indigo-300 bg-indigo-50 text-[9px] text-indigo-700"
                                    title={`Item order email aktif (${em.qty} pcs, ${em.status}) — part datang ditandai lewat "Part Datang" / Surat Jalan Masuk`}
                                  >
                                    Email: {em.status}
                                  </Badge>
                                ) : null
                              })()}
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
                                  {p.statusPart === 'ORDER_PRODUSEN' && detail.status !== 'FINISH' && !emailAktifUntuk(detail.orderEmailParts, p.sparepart?.kodePart) && (
                                    <Button
                                      size="sm" variant="outline" className="h-6 px-1.5 text-[10px] text-violet-700"
                                      title="Reorder part inden ini: daftarkan ke order email & kirim ke produsen (SMTP aktif → kirim; belum → draf mailto)"
                                      disabled={orderEmailTiket.isPending}
                                      onClick={() => orderEmailTiket.mutate(detail.id)}
                                    >
                                      <MailPlus className="mr-0.5 h-3 w-3" /> Email Order
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
