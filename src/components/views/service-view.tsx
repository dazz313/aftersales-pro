'use client'

import { useEffect, useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetcher, postJson, authHeaders, formatRupiah, formatTanggal, formatWaktu, bukaLinkEksternal, type ServiceTicket, type Sparepart } from '@/lib/api'
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
import { daftarPartBelumDatang, labelPartTunggu } from '@/lib/part-tunggu'
import QuickSearch, { matchQuery } from '@/components/quick-search'
import HistoryInput from '@/components/history-input'
import LoadMore from '@/components/load-more'
import { useBertahap } from '@/hooks/use-bertahap'
import {
  Plus, CheckCircle2, PlayCircle, Send, Ban, AlertOctagon,
  PackageCheck, Eye, Wrench, Camera, DollarSign, RotateCcw, X, Truck, Pencil, Trash2, Minus, ClipboardList, Loader2, MailPlus, ChevronDown,
  MessageCircle, PackageOpen, Hand, Clock, Store, History, Printer,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { alurSjState, ALUR_SJ_STYLES, tglPendek, type AlurSj } from '@/lib/alur-sj'
import { durasiUnitWorkshop } from '@/lib/alur-tanggal'
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

/** Nilai input datetime-local (format lokal — bukan UTC), pola sama dgn field-ops-view. */
const dtLocalFrom = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}
const dtLocalNow = () => dtLocalFrom(new Date())

/** Tanggal selesai dikerjakan (FINISH) — pendek utk kolom tabel & kartu HP. */
const tglFinishPendek = (tgl: string | null) =>
  tgl ? new Date(tgl).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) : null

/** Tanggal pemasangan part TERAKHIR (paling baru) dari baris part tiket —
 *  baris "Part terpasang" di kolom Tgl Finish (menggantikan chip alur SJ). */
function tglPasangTerakhir(t: ServiceTicket): string | null {
  const ms = t.parts
    .map((p) => (p.tglPasang ? new Date(p.tglPasang).getTime() : null))
    .filter((x): x is number => x !== null)
  return ms.length ? new Date(Math.max(...ms)).toISOString() : null
}

// ===== Alur Surat Jalan per tiket (DETETEKSI UNIT SUDAH/BELUM KE PRODUSEN) =====
// Logika, warna & label chip dipusatkan di src/lib/alur-sj.ts supaya dialog
// Surat Jalan (guard dokumen dobel) memakai definisi yang sama persis.

/** Chip alur surat jalan pada baris tiket — sekilas tahu unit sudah/belum ke produsen.
 *  Tiket FINISH otomatis tidak dirender (keluar alur SJ — lihat alurSjState). */
function BadgeAlurSj({ t }: { t: ServiceTicket }) {
  const st = alurSjState(t)
  if (st === 'TAK_PERLU_SJ') return null
  const s = ALUR_SJ_STYLES[st]
  const label =
    st === 'BELUM_SJ' ? s.label
    : st === 'SJR_TANPA_KIRIM' ? `${s.label} ${tglPendek(t.tglRequestPart as string)}`
    : st === 'BEKAS_TERKIRIM' ? `${s.label} · ${t.noSuratJalan}`
    : `${s.label} ${tglPendek(t.tglPartDatang as string)}`
  const detail =
    st === 'BELUM_SJ' ? 'Ada part inden ke produsen tapi belum pernah dibuatkan surat jalan — alat bekas masih di sini.'
    : st === 'SJR_TANPA_KIRIM' ? `Surat jalan dibuat ${tglPendek(t.tglRequestPart as string)} — alat bekas BELUM terkirim ke produsen (bisa beda hari dengan cetak SJ).`
    : st === 'BEKAS_TERKIRIM' ? `Alat bekas terkirim via surat jalan ${t.noSuratJalan} — menunggu part pengganti datang.`
    : `Part pengganti datang ${tglPendek(t.tglPartDatang as string)}${t.noSuratJalanProdusen ? ` via surat jalan produsen ${t.noSuratJalanProdusen}` : ''} — alur selesai.`
  return (
    <Badge variant="outline" className={cn('text-[9px]', s.cls)} title={detail}>
      {label}
    </Badge>
  )
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
  const { role, user, navIntent, clearNavIntent } = useAppStore()
  const [tab, setTab] = useState('SEMUA')
  // Filter drill-down dari Dashboard (KPI garansi / klik batang tren model)
  const [garansiFilter, setGaransiFilter] = useState<'SEMUA' | 'GARANSI' | 'NON_GARANSI'>('SEMUA')
  const [modelFilter, setModelFilter] = useState<string | null>(null)
  const [tokoFilter, setTokoFilter] = useState<string | null>(null)
  const [brandFilter, setBrandFilter] = useState<string | null>(null)
  // Filter alur surat jalan — jawab "unit mana yang belum dikirim alat bekasnya
  // ke produsen" tanpa membuka tiket satu per satu.
  const [alurFilter, setAlurFilter] = useState<AlurSj | 'SEMUA'>('SEMUA')
  const [cariTiket, setCariTiket] = useState('')
  // Pilih tiket untuk surat jalan kolektif (part rusak dikirim bersama ke produsen)
  // Pilihan tersimpan di server (shared_selection) agar dilihat semua user,
  // bukan hanya localStorage per-browser. Menggunakan queryClient.setQueryData
  // untuk optimistic update agar tidak butuh useState + useEffect.
  const selSelectedIdsQuery = useQuery<{ type: string; itemIds: number[] }>({
    queryKey: ['shared-selection', 'SELECTED_IDS'],
    queryFn: () => fetcher<{ type: string; itemIds: number[] }>('/api/user-selection?type=SELECTED_IDS'),
    enabled: !!user?.id,
  })
  const selectedIds: number[] = selSelectedIdsQuery.data?.itemIds ?? []
  const saveSelectionMutation = useMutation({
    mutationFn: (itemIds: number[]) => postJson('/api/user-selection', { type: 'SELECTED_IDS', itemIds }),
    onMutate: async (newItemIds) => {
      await queryClient.cancelQueries({ queryKey: ['shared-selection', 'SELECTED_IDS'] })
      const previous = queryClient.getQueryData<{ type: string; itemIds: number[] }>(['shared-selection', 'SELECTED_IDS'])
      queryClient.setQueryData(['shared-selection', 'SELECTED_IDS'], { type: 'SELECTED_IDS', itemIds: newItemIds })
      return { previous }
    },
    onError: (_err, _newItemIds, context) => {
      queryClient.setQueryData(['shared-selection', 'SELECTED_IDS'], context?.previous)
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['shared-selection', 'SELECTED_IDS'] })
    },
  })
  const toggleSelectedId = (id: number) => {
    const next = selectedIds.includes(id)
      ? selectedIds.filter((i) => i !== id)
      : [...selectedIds, id].sort((a, b) => a - b)
    saveSelectionMutation.mutate(next)
  }
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
  // Tanggal FINISH di dialog Selesaikan — default waktu sekarang, bisa diubah
  // manual utk menyesuaikan data lama (unit dinyatakan selesai belakangan).
  const [finishTgl, setFinishTgl] = useState('')
  // Koreksi tanggal FINISH tiket yang sudah selesai (Admin Workshop/Manager) —
  // inline di detail tiket, tersimpan dengan tanda "(edited)" di sistem & Audit Log.
  const [tglFinishEdit, setTglFinishEdit] = useState<string | null>(null)
  // Koreksi tanggal PART DATANG (data lama) — null = mode koreksi tutup
  const [tglPartEdit, setTglPartEdit] = useState<string | null>(null)

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
    setTglFinishEdit(null)
    setTglPartEdit(null)
    setDetail(t)
  }

  const { data: tickets, isLoading } = useQuery<ServiceTicket[]>({
    queryKey: ['service-tickets'],
    queryFn: () => fetcher<ServiceTicket[]>('/api/service'),
  })
  // Katalog sparepart untuk tambah/ubah part di dialog detail tiket
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
      setFinishTgl('')
      setTglFinishEdit(null)
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

  // ===== Kirim WA order part ke produsen (opsi kanal kedua selain email) =====
  // REAL: gateway WA terkonfigurasi → item langsung TERKIRIM (mode 'WA').
  // WAME: draf wa.me dibuka di WA — item tetap PENDING sampai dikirim.
  // TEKS: pesan disalin ke clipboard — kirim manual ke WA (item tetap PENDING).
  type HasilWaOrder = { ok: true; mode: 'REAL' | 'WAME' | 'TEKS'; terkirim?: number; waLink?: string; pesan?: string; noTiket: string }
  const kirimWaOrder = (id: number) =>
    postJson<HasilWaOrder>(
      `/api/service/${id}`,
      { aksi: 'KIRIM_WA_ORDER', aktor: role === 'TEKNISI' ? 'Teknisi Lapangan' : 'Admin Workshop' },
      'PATCH'
    )
  const notifikasiWaOrder = (r: HasilWaOrder) => {
    invalidateAll()
    if (r.mode === 'REAL') {
      toast({ title: `Order WA terkirim (${r.terkirim} part)`, description: `Tiket ${r.noTiket} — pesan masuk log gateway. Part inden ditandai TERKIRIM; tunggu barang masuk, lalu klik Part Datang.` })
    } else if (r.mode === 'WAME' && r.waLink) {
      bukaLinkEksternal(r.waLink)
      toast({ title: 'Draf WA dibuka', description: `Tiket ${r.noTiket} — pesan terisi otomatis di WhatsApp; klik kirim di WA, order tercatat setelah itu (item tetap PENDING). Set gateway WA di Pengaturan → Gateway agar kirim otomatis.` })
    } else {
      void navigator.clipboard?.writeText(r.pesan ?? '').catch(() => {})
      toast({ title: 'Pesan order disalin', description: `Tiket ${r.noTiket} — nomor produsen belum diisi; tempelkan pesan ke WhatsApp. Set nomor di Pengaturan → Email Produsen (Nomor WA Produsen).` })
    }
  }
  const kirimWaTiket = useMutation({
    mutationFn: kirimWaOrder,
    onSuccess: (r) => notifikasiWaOrder(r),
    onError: (e: Error) => toast({ title: 'Gagal mengirim WA', description: e.message, variant: 'destructive' }),
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
  // Reorder part inden via WA: daftarkan baris inden → langsung kirim WA (KIRIM_WA_ORDER).
  const orderWaTiket = useMutation({
    mutationFn: async (id: number) => {
      await postJson(`/api/service/${id}`, { aksi: 'ORDER_EMAIL_REORDER', aktor: role === 'TEKNISI' ? 'Teknisi Lapangan' : 'Admin Workshop' }, 'PATCH')
      return kirimWaOrder(id)
    },
    onSuccess: (r) => notifikasiWaOrder(r),
    onError: (e: Error) => toast({ title: 'Gagal reorder part inden (WA)', description: e.message, variant: 'destructive' }),
  })

  const filtered = useMemo(() => {
    if (!tickets) return []
    let list = tab === 'SEMUA' ? tickets : tickets.filter((t) => t.status === tab)
    if (garansiFilter !== 'SEMUA') list = list.filter((t) => garansiFilter === 'GARANSI' ? t.unitAsset.statusGaransi !== 'NON_GARANSI' : t.unitAsset.statusGaransi === 'NON_GARANSI')
    if (alurFilter !== 'SEMUA') list = list.filter((t) => alurSjState(t) === alurFilter)
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
  }, [tickets, tab, garansiFilter, alurFilter, modelFilter, tokoFilter, brandFilter, cariTiket])

  // Render bertahap: batas otomatis kembali ke awal saat filter/pencarian berubah.
  const tiketBertahap = useBertahap(
    filtered,
    `${tab}|${garansiFilter}|${alurFilter}|${modelFilter ?? ''}|${tokoFilter ?? ''}|${brandFilter ?? ''}|${cariTiket}`,
  )

  const hasDrilldown = garansiFilter !== 'SEMUA' || modelFilter !== null || tokoFilter !== null || brandFilter !== null

  // Hitungan tiap tahap alur (utk label dropdown filter — tetap tampil walau
  // tab/status lain aktif agar pilihan tidak "menipu" saat kosong).
  const alurCount = useMemo(() => {
    const c: Record<AlurSj, number> = { BELUM_SJ: 0, SJR_TANPA_KIRIM: 0, BEKAS_TERKIRIM: 0, PART_DATANG: 0, TAK_PERLU_SJ: 0 }
    for (const t of tickets ?? []) c[alurSjState(t)]++
    return c
  }, [tickets])

  const toggleSelect = (id: number) => {
    const current = [...selectedIds]
    const next = current.includes(id) ? current.filter((i) => i !== id) : [...current, id].sort((a, b) => a - b)
    saveSelectionMutation.mutate(next)
  }

  const toggleAll = (list: { id: number }[]) => {
    const allSelected = list.length > 0 && list.every((t) => selectedIds.includes(t.id))
    const next = allSelected
      ? list.filter((t) => !selectedIds.includes(t.id)).map((t) => t.id).sort((a, b) => a - b)
      : [...new Set([...selectedIds, ...list.map((t) => t.id)])].sort((a, b) => a - b)
    saveSelectionMutation.mutate(next)
  }

  const sjTickets = useMemo(() => (tickets ?? []).filter((t) => selectedIds.includes(t.id)), [tickets, selectedIds])

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
  // Centangan panel Pemasangan Part — tersimpan di server (shared_selection)
  // agar dilihat semua user, tidak hilang saat berpindah mode.
  const selPasangSelQuery = useQuery<{ type: string; itemIds: number[] }>({
    queryKey: ['shared-selection', 'PASANG_SEL'],
    queryFn: () => fetcher<{ type: string; itemIds: number[] }>('/api/user-selection?type=PASANG_SEL'),
    enabled: !!user?.id,
  })
  const pasangSel: number[] = selPasangSelQuery.data?.itemIds ?? []
  const savePasangSelectionMutation = useMutation({
    mutationFn: (itemIds: number[]) => postJson('/api/user-selection', { type: 'PASANG_SEL', itemIds }),
    onMutate: async (newItemIds) => {
      await queryClient.cancelQueries({ queryKey: ['shared-selection', 'PASANG_SEL'] })
      const previous = queryClient.getQueryData<{ type: string; itemIds: number[] }>(['shared-selection', 'PASANG_SEL'])
      queryClient.setQueryData(['shared-selection', 'PASANG_SEL'], { type: 'PASANG_SEL', itemIds: newItemIds })
      return { previous }
    },
    onError: (_err, _newItemIds, context) => {
      queryClient.setQueryData(['shared-selection', 'PASANG_SEL'], context?.previous)
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['shared-selection', 'PASANG_SEL'] })
    },
  })
  const togglePasangId = (id: number) => {
    const next = pasangSel.includes(id)
      ? pasangSel.filter((i) => i !== id)
      : [...pasangSel, id].sort((a, b) => a - b)
    savePasangSelectionMutation.mutate(next)
  }
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
    if (pasangSel.length === 0 || pasangBusy) return
    const n = pasangSel.length
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
      savePasangSelectionMutation.mutate([])
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

  async function unduhSttbKolektif(tandaiDitarik: boolean) {
    const list = sjTickets
    if (list.length === 0 || sttbBusy) return
    const tokoSet = new Set(list.map((t) => t.unitAsset.toko?.kodeToko ?? '-'))
    if (tokoSet.size !== 1) {
      toast({ title: 'Pilih 1 toko', description: 'STTB kolektif merangkum 1 toko — centang tiket dari toko yang sama.', variant: 'destructive' })
      return
    }
    if (tandaiDitarik && !window.confirm(`Sahkan ${list.length} unit tercentang sebagai BENAR-BENAR DITARIK ke workshop? Yang dicetak = yang dipindahkan.`)) return
    setSttbBusy(true)
    try {
      const res = await fetch('/api/sttb/kolektif', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ noTiket: list.map((t) => t.noTiket), tandaiDitarik }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error((err as { error?: string }).error || `Gagal membuat STTB kolektif (${res.status})`)
      }
      const marked = Number(res.headers.get('X-Sttb-Marked') ?? 0)
      const skipped = Number(res.headers.get('X-Sttb-Skipped') ?? 0)
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
      if (tandaiDitarik) invalidateAll()
      toast({
        title: marked > 0 ? `${filename} terunduh — ${marked} tiket disahkan DITARIK` : `${filename} terunduh`,
        description:
          marked > 0
            ? `${marked} unit diteruskan → WORKSHOP (alur STTBK-${marked}) · ${skipped} dilewati (part belum READY dsb. — tetap tercetak di daftar).`
            : `${list.length} unit siap pick up${marked === 0 && skipped > 0 ? ' — semua dilewati sahkan (part belum READY dsb.)' : ''}.`,
      })
    } catch (e) {
      toast({ title: 'Gagal mencetak STTB kolektif', description: e instanceof Error ? e.message : 'Coba lagi', variant: 'destructive' })
    } finally {
      setSttbBusy(false)
    }
  }

  // ===== Surat Pengembalian Barang ke Toko =====
  // Bukti unit selesai service kembali ke tokonya (kebalikan STTB pick up).
  // 1 tiket tercentang → per toko (dokumen satu unit); beberapa tiket 1 toko
  // yang sama → kolektif. Terbit SAAT FINISH walau unit masih di workshop —
  // baris belaya kembali mencetak "—" (surat = surat jalan pengiriman).
  const [kembaliBusy, setKembaliBusy] = useState(false)
  async function unduhSuratKembali(noTiket?: string[]) {
    if (kembaliBusy) return
    const list = (noTiket ?? sjTickets.map((t) => t.noTiket)).filter(Boolean)
    if (list.length === 0) {
      toast({ title: 'Pilih tiket dulu', description: 'Centang tiket FINISH (terbit walau unit masih di workshop) atau yang sudah terekam kembali.', variant: 'destructive' })
      return
    }
    const dipilih = (tickets ?? []).filter((t) => list.includes(t.noTiket))
    const tokoSet = new Set(dipilih.map((t) => t.unitAsset.toko?.kodeToko ?? '-'))
    if (tokoSet.size !== 1) {
      toast({ title: 'Pilih 1 toko', description: 'Surat pengembalian merangkum 1 toko — centang tiket dari toko yang sama.', variant: 'destructive' })
      return
    }
    setKembaliBusy(true)
    try {
      const res = await fetch('/api/sttb/kembali', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ noTiket: list }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error((err as { error?: string }).error || `Gagal membuat surat pengembalian (${res.status})`)
      }
      const cd = res.headers.get('content-disposition') ?? ''
      const m = cd.match(/filename="([^"]+)"/)
      const filename = m?.[1] ?? `Surat-Pengembalian-Barang-${new Date().toISOString().slice(0, 10)}.pdf`
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      toast({ title: 'Surat pengembalian terunduh', description: `${filename} · ${list.length} unit — tanggal kembali tercetak per tiket.` })
    } catch (e) {
      toast({ title: 'Gagal mencetak surat pengembalian', description: e instanceof Error ? e.message : 'Coba lagi', variant: 'destructive' })
    } finally {
      setKembaliBusy(false)
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

  // ===== RIWAYAT PERSURATAN (bundel) — cetak ulang tanpa cari satu per satu =====
  // Minta daftar SJR/STTB/STTBK/SKTB yang menyentuh tiket tercentang lewat
  // /api/surat-riwayat; tiap entri punya link cetak-ulang nomor SAMA.
  interface EntriRiwayat {
    tipe: string
    nomor: string
    tgl: string | null
    oleh: string | null
    link: string
    tiket: string[]
    toko?: string | null
    info?: string
  }
  const [riwayatOpen, setRiwayatOpen] = useState(false)
  const [riwayatList, setRiwayatList] = useState<EntriRiwayat[] | null>(null)
  const [riwayatLoading, setRiwayatLoading] = useState(false)
  const [riwayatBusy, setRiwayatBusy] = useState<string | null>(null)
  const daftarNoTiketTerpilih = useMemo(
    () => (tickets ?? []).filter((t) => selectedIds.includes(t.id)).map((t) => t.noTiket),
    [tickets, selectedIds]
  )

  async function muatRiwayatTerpilih() {
    if (riwayatLoading) return
    setRiwayatLoading(true)
    try {
      const url = daftarNoTiketTerpilih.length > 0
        ? `/api/surat-riwayat?noTiket=${encodeURIComponent(daftarNoTiketTerpilih.join(','))}`
        : '/api/surat-riwayat'
      const res = await fetch(url, {
        headers: authHeaders(),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error((err as { error?: string }).error || 'Gagal memuat riwayat')
      }
      const data = (await res.json()) as { riwayat?: EntriRiwayat[] }
      setRiwayatList(data.riwayat ?? [])
    } catch (e) {
      toast({ title: 'Gagal memuat riwayat persuratan', description: e instanceof Error ? e.message : 'Coba lagi', variant: 'destructive' })
      setRiwayatList(null)
    } finally {
      setRiwayatLoading(false)
    }
  }

  async function unduhUlangDokumen(e: EntriRiwayat) {
    if (!e.link || riwayatBusy) return
    setRiwayatBusy(e.nomor)
    try {
      const res = await fetch(e.link, { headers: authHeaders() })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error((err as { error?: string }).error || `Gagal cetak ulang (${res.status})`)
      }
      const cd = res.headers.get('content-disposition') ?? ''
      const m = cd.match(/filename="([^"]+)"/)
      const filename = m?.[1] ?? `${e.tipe}-${e.nomor}.pdf`
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      toast({
        title: `Cetak ulang ${e.tipe} ${e.nomor}`,
        description: `${filename} — nomor sama dengan dokumen asli, tidak menambah nomor baru.`,
      })
    } catch (err) {
      toast({ title: 'Gagal mencetak ulang', description: err instanceof Error ? err.message : 'Coba lagi', variant: 'destructive' })
    } finally {
      setRiwayatBusy(null)
    }
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

  // ── Tombol aksi tiket ─────────────────────────────────────────────────
  // Dipakai bersama oleh tabel (desktop) dan kartu (HP) supaya aksinya
  // identik tanpa menduplikasi logika email/order/klaim di dua tempat.
  const renderAksiTiket = (t: ServiceTicket) => {
    const partsAksi = t.parts.filter((p) => p.qty > 0)
    const hasOrderPart = partsAksi.some((p) => p.statusPart === 'ORDER_PRODUSEN')
    // Part yang masih ditunggu (belum datang) — FINISH ditahan sampai semua READY.
    const partTunggu = daftarPartBelumDatang(partsAksi)
    // Part inden belum dipesan via email → perlu aksi "Email Order"
    const butuhOrderEmail =
      hasOrderPart &&
      (t.parts.some(
        (p) => p.statusPart === 'ORDER_PRODUSEN' && !emailAktifUntuk(t.orderEmailParts, p.sparepart?.kodePart)
      ) || !t.orderEmailParts)
    const emailAktif =
      t.status === 'REQUEST_EMAIL' || (hasOrderPart && (t.status === 'REQUEST' || t.status === 'PROSES'))
    const adaAksiLain =
      t.status === 'REQUEST' ||
      t.status === 'PROSES' ||
      (t.status === 'FINISH' && (t.statusKlaimProdusen === 'DRAFT' || t.statusKlaimProdusen === 'SUBMITTED' || !t.tglKembaliKeToko))
    return (
      <>
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
        {emailAktif && (
          butuhOrderEmail ? (
            <Button size="sm" variant="outline" className="h-7 w-7 p-0 text-emerald-700"
              disabled={orderWaTiket.isPending}
              title="WA Order — reorder part inden (ORDER) ke produsen via WhatsApp; part READY tidak ikut"
              onClick={() => orderWaTiket.mutate(t.id)}>
              <MessageCircle className="h-3 w-3" />
              <span className="sr-only">WA Order</span>
            </Button>
          ) : (
            <Button size="sm" variant="outline" className="h-7 w-7 p-0 text-emerald-700"
              disabled={kirimWaTiket.isPending}
              title={t.status === 'REQUEST_EMAIL'
                ? 'Kirim order part ke produsen via WhatsApp (gateway/pengaturan Nomor WA Produsen)'
                : 'Kirim order part inden via WhatsApp yang belum terkirim'}
              onClick={() => kirimWaTiket.mutate(t.id)}>
              <MessageCircle className="h-3 w-3" />
              <span className="sr-only">WA Order</span>
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
                  disabled={partTunggu.length > 0}
                  title={partTunggu.length > 0
                    ? `Masih menunggu ${partTunggu.length} part (${partTunggu.map(labelPartTunggu).join(', ')}) — tambah part bila ada temuan baru; Selesaikan setelah semua part datang & dipasang.`
                    : 'Selesaikan pekerjaan (nota stempel + TTD)'}
                  onClick={() => { setFinishTarget(t); setNotaFile(''); setFinishTgl(dtLocalNow()) }}>
                  <Camera className="h-3 w-3" /> Selesaikan
                </DropdownMenuItem>
              )}
              {t.status === 'FINISH' && !t.tglKembaliKeToko && (
                <DropdownMenuItem
                  className="gap-1.5 text-[11px] text-amber-700"
                  title="Unit sudah sampai di toko — catat tanggal kembali & cabut STTB"
                  onClick={() => {
                    if (!window.confirm(`Konfirmasi unit ${t.unitAsset.modelUnit} sudah diterima kembali di ${t.unitAsset.toko?.namaToko ?? 'toko'}? Tanggal hari ini akan terekam sebagai tanggal kembali.`)) return
                    aksiMutation.mutate({ id: t.id, body: { aksi: 'KEMBALI_KE_TOKO', aktor: role === 'TEKNISI' ? 'Teknisi Lapangan' : 'Admin Workshop' } })
                  }}>
                  <Store className="h-3 w-3" /> Konfirmasi Kembali ke Toko
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
      </>
    )
  }

  return (
    <div className="space-y-4">
      {/* Summary strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
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
                  const semuaCeklis = rows.every((r) => pasangSel.includes(r.id))
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
                            const ids = rows.map((r) => r.id).sort((a, b) => a - b)
                            const semuaCeklis = rows.every((r) => pasangSel.includes(r.id))
                            const next = semuaCeklis
                              ? ids.filter((id) => !pasangSel.includes(id))
                              : [...new Set([...pasangSel, ...ids])].sort((a, b) => a - b)
                            savePasangSelectionMutation.mutate(next)
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
                            <TableRow key={r.id} className={cn(pasangSel.includes(r.id) && 'bg-teal-50/60')}>
                              <TableCell>
                                <Checkbox
                                  aria-label={`Pilih part ${r.kodePart} — tiket ${r.noTiket}`}
                                  checked={pasangSel.includes(r.id)}
                                  onCheckedChange={() => togglePasangId(r.id)}
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
                    {pasangSel.length} item dipilih
                  </Badge>
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-teal-700 text-teal-700 hover:bg-teal-50"
                    disabled={pasangSel.length === 0 || pasangBusy}
                    onClick={() => void sahkanPasang(true)}
                    title="Tandai dipasang + unduh Dokumen Pemasangan (PDF, seksi per toko)"
                  >
                    {pasangBusy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <ClipboardList className="mr-1 h-3.5 w-3.5" />}
                    Sahkan &amp; Cetak Dokumen
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pasangSel.length === 0 || pasangBusy}
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
            <CardTitle className="text-base">Daftar Tiket</CardTitle>
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
            {/* Filter alur surat jalan: deteksi unit sudah/belum dikirim alat bekasnya */}
            <Select value={alurFilter} onValueChange={(v) => setAlurFilter(v as AlurSj | 'SEMUA')}>
              <SelectTrigger className="h-9 w-[240px] text-xs" aria-label="Filter alur surat jalan">
                <SelectValue placeholder="Alur surat jalan" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="SEMUA">Semua alur ({tickets?.length ?? 0})</SelectItem>
                <SelectItem value="BELUM_SJ">Belum dibuatkan SJ ({alurCount.BELUM_SJ})</SelectItem>
                <SelectItem value="SJR_TANPA_KIRIM">SJ dibuat, bekas belum kirim ({alurCount.SJR_TANPA_KIRIM})</SelectItem>
                <SelectItem value="BEKAS_TERKIRIM">Bekas terkirim, tunggu datang ({alurCount.BEKAS_TERKIRIM})</SelectItem>
                <SelectItem value="PART_DATANG">Part datang ({alurCount.PART_DATANG})</SelectItem>
              </SelectContent>
            </Select>
            {alurFilter !== 'SEMUA' && (
              <Button
                variant="ghost"
                size="sm"
                className="text-slate-500 hover:text-slate-700"
                onClick={() => setAlurFilter('SEMUA')}
              >
                <X className="mr-1 h-3.5 w-3.5" /> Bersihkan alur
              </Button>
            )}
            {selectedIds.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="text-slate-500 hover:text-slate-700"
                onClick={() => saveSelectionMutation.mutate([])}
              >
                <X className="mr-1 h-3.5 w-3.5" /> Reset ({selectedIds.length})
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              className="border-teal-700 text-teal-700 hover:bg-teal-50"
              onClick={() => setSjOpen(true)}
              disabled={selectedIds.length === 0}
              title="Cetak surat jalan kolektif — part rusak dikirim bersama ke produsen"
            >
              <Truck className="mr-1 h-3.5 w-3.5" />
              Surat Jalan{selectedIds.length > 0 ? ` (${selectedIds.length})` : ''}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="border-slate-700 text-slate-700 hover:bg-slate-50"
              onClick={() => void unduhSttbKolektif(false)}
              disabled={selectedIds.length === 0 || sttbBusy}
              title="Cetak STTB kolektif — daftar unit siap pick up dari 1 toko (wajib centang 1 toko yang sama)"
            >
              {sttbBusy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <ClipboardList className="mr-1 h-3.5 w-3.5" />}
              STTB Toko{selectedIds.length > 0 ? ` (${selectedIds.length})` : ''}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="border-violet-600 text-violet-700 hover:bg-violet-50"
              onClick={() => void unduhSttbKolektif(true)}
              disabled={selectedIds.length === 0 || sttbBusy}
              title="Cetak STTB kolektif SEKALIGUS sahkan unit tercentang benar-benar DITARIK (tarik parsial — yang dicetak = yang dipindahkan ke workshop; part belum READY tidak ikut ditandai)"
            >
              {sttbBusy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Hand className="mr-1 h-3.5 w-3.5" />}
              STTB + Sahkan Ditarik{selectedIds.length > 0 ? ` (${selectedIds.length})` : ''}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="border-emerald-700 text-emerald-700 hover:bg-emerald-50"
              onClick={() => void unduhSuratKembali()}
              disabled={selectedIds.length === 0 || kembaliBusy}
              title="Cetak Surat Pengembalian Barang (SKTB) — 1 tiket tercentang = per toko, beberapa tiket 1 toko = kolektif. Tiket FINISH boleh dicetak walau unit masih di workshop (baris tgl kembali mencetak —)."
            >
              {kembaliBusy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <PackageOpen className="mr-1 h-3.5 w-3.5" />}
              Kembali Toko{selectedIds.length > 0 ? ` (${selectedIds.length})` : ''}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="border-sky-700 text-sky-700 hover:bg-sky-50"
              onClick={() => {
                const akanBuka = !riwayatOpen
                setRiwayatOpen(akanBuka)
                if (akanBuka) void muatRiwayatTerpilih()
              }}
              title="Buka riwayat persuratan — SJR, STTB, STTBK, SKTB. Cetak ulang pakai nomor asli, tidak buat nomor baru. Tanpa centang = 40 dokumen terakhir."
            >
              {riwayatLoading ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <History className="mr-1 h-3.5 w-3.5" />}
              Riwayat
            </Button>
          </div>
          {riwayatOpen && (
            <div className="mb-3 rounded-lg border border-sky-200 bg-sky-50/60 px-3 py-2.5">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-sky-900">
                <History className="h-3.5 w-3.5 shrink-0" />
                Riwayat Persuratan
                {daftarNoTiketTerpilih.length > 0
                  ? ` — ${daftarNoTiketTerpilih.length} tiket tercentang`
                  : ' — 40 dokumen terakhir'}
              </p>
              {riwayatList === null ? (
                <p className="mt-1 text-[11px] text-sky-700">Klik Riwayat untuk memuat daftar dokumen.</p>
              ) : riwayatList.length === 0 ? (
                <p className="mt-1 text-[11px] text-sky-700">Belum ada dokumen (SJR/STTB/STTBK/SKTB) yang mencakup tiket tercentang.</p>
              ) : (
                <div className="mt-1.5 max-h-52 space-y-1 overflow-y-auto pr-1">
                  {riwayatList.map((e) => (
                    <div key={`${e.tipe}-${e.nomor}`} className="flex min-w-0 flex-wrap items-center gap-1.5 text-[11px] leading-snug">
                      <Badge variant="outline" className="shrink-0 border-sky-300 bg-white text-[9px] text-sky-800">{e.tipe}</Badge>
                      <span className="shrink-0 font-mono font-semibold text-slate-700">{e.nomor}</span>
                      <Badge variant="outline" className="shrink-0 border-slate-200 bg-white text-[9px] text-slate-600">
                        {e.tiket.length} tiket
                      </Badge>
                      <span className="text-slate-500">
                        {e.tgl ? formatTanggal(e.tgl) : '—'}
                        {e.oleh ? ` · ${e.oleh}` : ''}
                        {e.toko ? ` · ${e.toko}` : ''}
                      </span>
                      {e.info && <span className="min-w-0 truncate text-slate-400" title={e.info}>{e.info}</span>}
                      {e.link && (
                        <button
                          type="button"
                          disabled={riwayatBusy !== null}
                          onClick={() => void unduhUlangDokumen(e)}
                          className="ml-auto inline-flex shrink-0 items-center gap-1 rounded border border-sky-300 bg-white px-1.5 py-0.5 text-[10px] font-semibold text-sky-800 hover:bg-sky-100 disabled:opacity-50"
                          title="Cetak ulang — nomor sama dengan dokumen asli"
                        >
                          {riwayatBusy === e.nomor ? <Loader2 className="h-3 w-3 animate-spin" /> : <Printer className="h-3 w-3" />}
                          Cetak ulang
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
              <p className="mt-1.5 text-[10px] leading-relaxed text-sky-700">
                Cetak ulang memakai NOMOR DOKUMEN ASLI — tidak ada nomor ganda; tidak perlu cari satu per satu lagi.
              </p>
            </div>
          )}
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
            <>
              {/* Desktop: tabel penuh (padat, ada centang massal & sortir) */}
              <div data-testid="tiket-tabel" className="hidden overflow-x-auto md:block">
                <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-9 pr-0">
                      <Checkbox
                        aria-label="Pilih semua tiket tampil untuk surat jalan"
                        checked={filtered.length > 0 && filtered.every((t) => selectedIds.includes(t.id))}
                        onCheckedChange={() => toggleAll(filtered)}
                      />
                    </TableHead>
                    <TableHead>No. Tiket</TableHead>
                    <TableHead>Unit (Serial · Model)</TableHead>
                    <TableHead className="hidden md:table-cell">Toko</TableHead>
                    <TableHead className="max-w-44">Kerusakan</TableHead>
                    <TableHead>Nama Sparepart</TableHead>
                    <TableHead>Kode Sparepart</TableHead>
                    <TableHead className="w-32">Status Sparepart</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Aksi</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tiketBertahap.tampil.map((t) => {
                    const st = STATUS_STYLES[t.status]
                    const kl = KLAIM_STYLES[t.statusKlaimProdusen]
                    // Baris part kembar yg di-nolkan saat gabung FINISH disembunyikan
                    // dari daftar — datanya tetap tersimpan utk statistik pemasangan.
                    const partsTampil = t.parts.filter((p) => p.qty > 0)
                    // Identifikasi Ready vs Inden per part + status item order-email
                    const readyCnt = partsTampil.filter((p) => p.statusPart === 'READY').length
                    const indenCnt = partsTampil.length - readyCnt
                    // Tgl finish kini ditulis di bawah badge FINISH (kolom Tgl Finish digabung ke Status)
                    const pasangTerakhir = tglPasangTerakhir(t)
                    const durasiWorkshop = durasiUnitWorkshop(t)
                    return (
                      <TableRow key={t.id} className={cn(t.slaFlag && 'bg-rose-50/60', selectedIds.includes(t.id) && 'bg-teal-50/60')}>
                        <TableCell className="pr-0">
                          <Checkbox
                            aria-label={`Pilih tiket ${t.noTiket} untuk surat jalan`}
                            checked={selectedIds.includes(t.id)}
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
                        <TableCell className="max-w-44">
                          {partsTampil.length === 0 ? (
                            <span className="text-xs text-slate-400">—</span>
                          ) : (
                            <div className="flex flex-col gap-1">
                              {partsTampil.map((p) => (
                                <span
                                  key={p.id}
                                  title={
                                    t.status === 'FINISH'
                                      ? p.sparepart?.kodePart ?? ''
                                      : `${p.sparepart?.kodePart ?? ''} · ${p.statusPart === 'READY' ? 'READY' : 'ORDER PRODUSEN'}`
                                  }
                                  className={cn(
                                    'truncate text-[11px]',
                                    t.status === 'FINISH' ? 'text-slate-500' : p.statusPart === 'READY' ? 'text-slate-700' : 'text-slate-400'
                                  )}
                                >
                                  {p.sparepart?.namaPart ?? '?'}
                                  {t.status !== 'FINISH' && p.statusPart !== 'READY' && <span className="ml-1 rounded bg-rose-50 px-1 text-[9px] font-semibold text-rose-600">ORDER</span>}
                                </span>
                              ))}
                            </div>
                          )}
                        </TableCell>
                        <TableCell>
                          {partsTampil.length === 0 ? (
                            <span className="text-xs text-slate-400">—</span>
                          ) : (
                            <div className="flex flex-col gap-1">
                              {partsTampil.map((p) => (
                                /* Tiket FINISH: alur ready/order sudah tamat — part
                                   ditulis polos, tgl finish tampil di kolom Status. */
                                <span key={p.id} className="flex min-w-0 items-center gap-0.5 whitespace-nowrap">
                                  <KodeSparepart
                                    kode={p.sparepart?.kodePart ?? ''}
                                    nama={p.sparepart?.namaPart}
                                    cek
                                    className={t.status === 'FINISH' ? 'text-[10px] text-slate-600' : p.statusPart === 'READY' ? 'text-[10px] text-emerald-700' : 'text-[10px] text-rose-600'}
                                  />
                                  <span className="font-mono text-[10px] font-normal text-slate-400">×{p.qty}</span>
                                </span>
                              ))}
                            </div>
                          )}
                        </TableCell>
                        <TableCell>
                          {(() => {
                            if (t.status === 'FINISH') return <Badge variant="outline" className="border-slate-300 bg-slate-100 text-[9px] text-slate-700">Finished</Badge>
                            const partsTampil = t.parts.filter((p) => p.qty > 0)
                            if (partsTampil.length === 0) return <span className="text-[11px] text-slate-400">—</span>
                            // SJ dibuat ≤7 hari → otomatis Ready Produsen (tunggu part lain).
                            const sjUmur = t.tglRequestPart ? (Date.now() - new Date(t.tglRequestPart).getTime()) / 86400000 : Infinity
                            const dalamWindowSJ = !!t.tglRequestPart && sjUmur <= 7
                            const hasOrder = partsTampil.some((p) => p.statusPart === 'ORDER_PRODUSEN')
                            const hasReadyProd = partsTampil.some((p) => p.statusPart === 'READY' && p.sumberPart === 'PRODUSEN')
                            const hasReadyStok = partsTampil.some((p) => p.statusPart === 'READY' && p.sumberPart !== 'PRODUSEN')
                            if (dalamWindowSJ) return <Badge variant="outline" className="border-teal-300 bg-teal-50 text-[9px] text-teal-700">Ready Produsen</Badge>
                            if (hasOrder) return <Badge variant="outline" className="border-rose-300 bg-rose-50 text-[9px] text-rose-700">Tidak Ready</Badge>
                            if (hasReadyProd) return <Badge variant="outline" className="border-teal-300 bg-teal-50 text-[9px] text-teal-700">Ready Produsen</Badge>
                            if (hasReadyStok) return <Badge variant="outline" className="border-emerald-300 bg-emerald-50 text-[9px] text-emerald-700">Ready Stok Part</Badge>
                            return <span className="text-[11px] text-slate-400">—</span>
                          })()}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap items-center gap-1">
                            <div className="flex flex-col items-start">
                              <Badge variant="outline" className={st.cls}>{st.label}</Badge>
                              {/* Chip alur surat jalan — DETEKSI PER UNIT: */}
                              {/* belum dibuatkan SJ → SJ dibuat bekas belum kirim → */}
                              {/* bekas terkirim (SJ #) → part datang. Menggantikan */}
                              {/* teks "Req:" lama (tanggal kini ada di chip + hover). */}
                              <BadgeAlurSj t={t} />
                            </div>
                            {/* Ringkasan part: ✔ READY vs ● INDEN — identifikasi sekilas tanpa buka detail.
                                Tiket FINISH tidak pakai — alur part sudah tamat, yang tampil hanya tgl finish. */}
                            {t.status !== 'FINISH' && partsTampil.length > 0 && (
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
                            {/* Indikator FINISH × lokasi: selesai dikerjakan tapi unit */}
                            {/* masih di workshop (belum kembalikan) ATAU sudah kembali */}
                            {t.status === 'FINISH' && !t.tglKembaliKeToko && (
                              <Badge variant="outline" className="gap-0.5 border-amber-300 bg-amber-50 text-[10px] text-amber-800" title="Pengerjaan selesai, unit masih di workshop — isi Surat Pengembalian lalu Konfirmasi Kembali ke Toko saat unit sampai">
                                <Clock className="h-2.5 w-2.5" /> MASIH DI WORKSHOP
                              </Badge>
                            )}
                            {t.status === 'FINISH' && t.tglKembaliKeToko && t.lokasiUnit === 'TOKO' && (
                              <Badge variant="outline" className="gap-0.5 border-emerald-300 bg-emerald-50 text-[10px] text-emerald-700" title={`Dikembalikan ke toko ${formatWaktu(t.tglKembaliKeToko)} — STTB dicabut`}>
                                <Store className="h-2.5 w-2.5" /> {tglPendek(t.tglKembaliKeToko)}
                              </Badge>
                            )}
                            {t.status === 'FINISH' && t.statusKlaimProdusen !== 'DRAFT' && <Badge variant="outline" className={kl.cls}>{kl.label}</Badge>}
                            {t.editedAt && <BadgeEdited waktu={t.editedAt} oleh={t.editedBy} />}
                            {/* Tgl Finish langsung ditulis di bawah badge FINISH — kolom Tgl Finish digabung ke Status */}
                            {t.status === 'FINISH' && (
                              <div className="flex w-full flex-col items-start text-left text-[10px] leading-tight">
                                <p className="font-medium text-slate-700">{tglFinishPendek(t.tglFinish) ?? <span className="text-slate-400">—</span>}</p>
                                {pasangTerakhir && (
                                  <p className="text-teal-700" title={formatWaktu(pasangTerakhir)}>Part terpasang {tglPendek(pasangTerakhir)}</p>
                                )}
                                {t.tglKembaliKeToko ? (
                                  <p className="text-emerald-600" title={formatWaktu(t.tglKembaliKeToko)}>Kembali {tglPendek(t.tglKembaliKeToko)}</p>
                                ) : t.lokasiUnit === 'WORKSHOP' ? (
                                  <p className="text-amber-600" title={durasiWorkshop ? `Dihitung sejak ${tglPendek(durasiWorkshop.mulai)} — sinyal kerja unit di workshop paling awal` : undefined}>
                                    Masih di workshop{durasiWorkshop ? ` · ${formatUmur(durasiWorkshop.jam)}` : ''}
                                  </p>
                                ) : null}
                              </div>
                            )}
                            {t.status !== 'FINISH' && t.lokasiUnit === 'WORKSHOP' && durasiWorkshop && (
                              <p className="w-full text-left text-[10px] text-amber-600" title={durasiWorkshop ? `Dihitung sejak ${tglPendek(durasiWorkshop.mulai)} — sinyal kerja unit di workshop paling awal` : undefined}>
                                Unit di workshop · {formatUmur(durasiWorkshop.jam)}
                              </p>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1.5">{renderAksiTiket(t)}</div>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
              </div>

              {/* HP: kartu ringkas — aksi tetap sama, tanpa geser horizontal */}
              <div data-testid="tiket-cards" className="flex flex-col gap-2.5 md:hidden">
                {tiketBertahap.tampil.map((t) => {
                  const st = STATUS_STYLES[t.status]
                  const kl = KLAIM_STYLES[t.statusKlaimProdusen]
                  const partsTampil = t.parts.filter((p) => p.qty > 0)
                  const readyCnt = partsTampil.filter((p) => p.statusPart === 'READY').length
                  const indenCnt = partsTampil.length - readyCnt
                  const kerusakan = t.unitAsset.kerusakanAwal?.trim() || t.deskripsiKerusakan?.trim()
                  // Kolom Tgl Finish: tgl pemasangan part terakhir + lama unit di workshop
                  const pasangTerakhir = tglPasangTerakhir(t)
                  const durasiWorkshop = durasiUnitWorkshop(t)
                  return (
                    <div
                      key={t.id}
                      className={cn(
                        'rounded-xl border bg-card p-3 shadow-sm',
                        t.slaFlag && 'border-rose-200 bg-rose-50/40',
                        selectedIds.includes(t.id) && 'ring-1 ring-teal-300'
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <button onClick={() => openDetail(t)} className="min-w-0 text-left">
                          <span className="block font-mono text-sm font-semibold text-emerald-700">{t.noTiket}</span>
                          {t.noSttb && <span className="block font-mono text-[10px] text-slate-400">{t.noSttb}</span>}
                        </button>
                        <div className="flex flex-wrap items-center justify-end gap-1">
                          <Badge variant="outline" className={st.cls}>{st.label}</Badge>
                          {t.slaFlag && <Badge variant="destructive" className="gap-0.5 text-[9px]"><AlertOctagon className="h-2.5 w-2.5" /> SLA</Badge>}
                          {/* Indikator FINISH × lokasi — selesai dikerjakan tapi masih
                              di workshop ATAU sudah dikembalikan ke toko */}
                          {t.status === 'FINISH' && !t.tglKembaliKeToko && (
                            <Badge variant="outline" className="gap-0.5 border-amber-300 bg-amber-50 text-[9px] text-amber-800">
                              <Clock className="h-2.5 w-2.5" /> di workshop
                            </Badge>
                          )}
                          {t.status === 'FINISH' && t.tglKembaliKeToko && t.lokasiUnit === 'TOKO' && (
                            <Badge variant="outline" className="gap-0.5 border-emerald-300 bg-emerald-50 text-[9px] text-emerald-700">
                              <Store className="h-2.5 w-2.5" /> {tglPendek(t.tglKembaliKeToko)}
                            </Badge>
                          )}
                          {t.status === 'FINISH' && t.statusKlaimProdusen !== 'DRAFT' && <Badge variant="outline" className={kl.cls}>{kl.label}</Badge>}
                          {t.editedAt && <BadgeEdited waktu={t.editedAt} oleh={t.editedBy} />}
                        </div>
                      </div>

                      <dl className="mt-2.5 grid grid-cols-[76px_1fr] gap-x-2.5 gap-y-1 text-xs">
                        <dt className="text-slate-500">Unit</dt>
                        <dd className="font-medium text-slate-800">
                          <span className="block truncate">{t.unitAsset.modelUnit}</span>
                          <span className="block truncate font-mono text-[10px] font-normal text-slate-400">{t.unitAsset.serialNumber}</span>
                        </dd>
                        <dt className="text-slate-500">Toko</dt>
                        <dd className="truncate text-slate-700">{t.unitAsset.toko?.namaToko ?? '—'}</dd>
                        <dt className="text-slate-500">Part</dt>
                        <dd className="min-w-0">
                          {partsTampil.length === 0 ? (
                            <span className="text-slate-400">—</span>
                          ) : (
                            <span className="flex flex-wrap items-center gap-1">
                              <span className="truncate font-mono text-[11px] text-slate-700">
                                {partsTampil.map((p) => p.sparepart?.kodePart).filter(Boolean).join(', ')}
                              </span>
                              {/* Chip ready/inden tidak untuk tiket FINISH — alur part tamat, cukup tgl finish */}
                              {t.status !== 'FINISH' && (
                                <span className={cn('rounded px-1 py-0.5 text-[10px] font-semibold', indenCnt > 0 ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700')}>
                                  {readyCnt} ready · {indenCnt} inden
                                </span>
                              )}
                            </span>
                          )}
                        </dd>
                        <dt className="text-slate-500">Tgl Finish</dt>
                        <dd className="text-slate-600">
                          {t.status === 'FINISH' ? (
                            <div className="flex flex-col gap-0.5">
                              <span>{tglFinishPendek(t.tglFinish) ?? '—'}</span>
                              {pasangTerakhir && (
                                <span className="text-[11px] text-teal-700" title={formatWaktu(pasangTerakhir)}>Part terpasang {tglPendek(pasangTerakhir)}</span>
                              )}
                              {t.tglKembaliKeToko ? (
                                <span className="text-[11px] text-emerald-600" title={formatWaktu(t.tglKembaliKeToko)}>Kembali {tglPendek(t.tglKembaliKeToko)}</span>
                              ) : t.lokasiUnit === 'WORKSHOP' ? (
                                <span className="text-[11px] text-amber-600">Masih di workshop{durasiWorkshop ? ` · ${formatUmur(durasiWorkshop.jam)}` : ''}</span>
                              ) : null}
                            </div>
                          ) : (
                            <div className="flex flex-col gap-0.5">
                              <span className="text-slate-400">—</span>
                              {t.lokasiUnit === 'WORKSHOP' && durasiWorkshop && (
                                <span className="text-[11px] text-amber-600">Unit di workshop · {formatUmur(durasiWorkshop.jam)}</span>
                              )}
                            </div>
                          )}
                        </dd>
                        {kerusakan && (
                          <>
                            <dt className="text-slate-500">Kerusakan</dt>
                            <dd className="line-clamp-2 text-slate-600">{kerusakan}</dd>
                          </>
                        )}
                      </dl>

                      <div className="mt-3 flex flex-wrap items-center justify-end gap-1.5 border-t border-slate-100 pt-2.5">
                        {renderAksiTiket(t)}
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          )}
          <LoadMore
            tampil={tiketBertahap.tampil.length}
            total={tiketBertahap.total}
            onMore={tiketBertahap.tambah}
            satuan="tiket"
          />
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
                  {/* Chip ready/inden tidak untuk tiket FINISH — alur part tamat, cukup tgl selesai */}
                  {detail.status !== 'FINISH' && detail.parts.length > 0 && (() => {
                    const tampil = detail.parts.filter((p) => p.qty > 0)
                    const r = tampil.filter((p) => p.statusPart === 'READY').length
                    const o = tampil.length - r
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
                  {detail.status === 'FINISH' && <> · <span className="font-medium text-emerald-800">Selesai {tglFinishPendek(detail.tglFinish) ?? '(belum terekam)'}</span></>}
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
                  bisaBukaUlang={bisaKoreksiPart}
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
                    const tampil = detail.parts.filter((p) => p.qty > 0)
                    const r = tampil.filter((p) => p.statusPart === 'READY').length
                    const o = tampil.length - r
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
                      {detail.parts.filter((p) => p.qty > 0).map((p) => (
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
                              <Badge
                                variant="outline"
                                className={p.statusPart === 'READY' || p.tglPasang ? 'border-emerald-300 text-emerald-700' : 'border-rose-300 text-rose-700'}
                                title={p.tglPasang ? `Terpasang ${formatTanggal(p.tglPasang)} oleh ${p.pasangOleh ?? '-'}` : undefined}
                              >
                                {p.tglPasang ? 'TERPASANG' : p.statusPart === 'READY' ? 'READY' : 'ORDER PRODUSEN'}
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
                                    className={cn('text-[9px]', em.emailMode === 'WA' ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-indigo-300 bg-indigo-50 text-indigo-700')}
                                    title={`Item order ${em.emailMode === 'WA' ? 'WA' : 'email'} aktif (${em.qty} pcs, ${em.status}) — part datang ditandai lewat "Part Datang" / Surat Jalan Masuk`}
                                  >
                                    {em.emailMode === 'WA' ? 'WA' : 'Email'}: {em.status}
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
                                    <DropdownMenu>
                                       <DropdownMenuTrigger asChild>
                                         <Button
                                           size="sm" variant="outline" className="h-6 px-1.5 text-[10px] text-slate-700"
                                           title="Reorder part inden ini: kirim ke produsen via Email atau WhatsApp"
                                           disabled={orderEmailTiket.isPending || orderWaTiket.isPending}
                                         >
                                           {(orderEmailTiket.isPending || orderWaTiket.isPending) ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                                           Order
                                         </Button>
                                       </DropdownMenuTrigger>
                                       <DropdownMenuContent align="end" className="w-40">
                                         <DropdownMenuItem
                                           onClick={() => orderEmailTiket.mutate(detail.id)}
                                           disabled={orderEmailTiket.isPending}
                                         >
                                           <MailPlus className="mr-2 h-3.5 w-3.5 text-violet-700" /> Email Order
                                         </DropdownMenuItem>
                                         <DropdownMenuItem
                                           onClick={() => orderWaTiket.mutate(detail.id)}
                                           disabled={orderWaTiket.isPending}
                                         >
                                           <MessageCircle className="mr-2 h-3.5 w-3.5 text-emerald-700" /> WA Order
                                         </DropdownMenuItem>
                                       </DropdownMenuContent>
                                     </DropdownMenu>
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
                                    size="sm"
                                    variant="outline"
                                    className={cn('h-6 w-6 p-0', p.tglPasang ? 'text-slate-300 hover:bg-slate-50' : 'text-rose-600 hover:bg-rose-50')}
                                    title={
                                      p.tglPasang
                                        ? `Sudah terpasang ${formatTanggal(p.tglPasang)} — tidak dapat dihapus (statistik pemasangan bergantung padanya); kurangi qty bila perlu`
                                        : 'Hapus baris part ini (koreksi salah input — stok dikembalikan)'
                                    }
                                    disabled={flowMutation.isPending || !!p.tglPasang}
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
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-slate-500">Selesai pada</p>
                      {detail.status === 'FINISH' && bisaKoreksiPart && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-5 w-5 shrink-0 p-0 text-amber-600 hover:bg-amber-50"
                          title="Koreksi tanggal selesai — tersimpan dengan tanda (edited) di sistem"
                          onClick={() => setTglFinishEdit(dtLocalFrom(new Date(detail.tglFinish ?? Date.now())))}
                        >
                          <Pencil className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                    <p className="font-semibold text-slate-800">{formatTanggal(detail.tglFinish)}</p>
                    {tglFinishEdit && (
                      <div className="mt-2 space-y-1.5 rounded-md border border-amber-200 bg-amber-50 p-2">
                        <p className="text-[11px] font-semibold text-amber-800">
                          Koreksi tanggal selesai — tertanda (edited) di sistem &amp; Audit Log untuk pemeriksaan kelak
                          <br />
                          Tidak boleh lebih awal dari tanggal part datang / part terpasang (minimal sama hari).
                        </p>
                        <Input
                          type="datetime-local"
                          value={tglFinishEdit}
                          onChange={(e) => setTglFinishEdit(e.target.value)}
                          className="h-7 text-[11px]"
                          aria-label="Tanggal selesai koreksi"
                        />
                        <div className="flex justify-end gap-1.5">
                          <Button size="sm" variant="outline" className="h-6 text-[11px]" onClick={() => setTglFinishEdit(null)}>
                            <X className="mr-1 h-3 w-3" /> Batal
                          </Button>
                          <Button
                            size="sm"
                            className="h-6 text-[11px]"
                            disabled={!tglFinishEdit || flowMutation.isPending}
                            onClick={() =>
                              flowMutation.mutate({
                                id: detail.id,
                                body: { aksi: 'KOREKSI_TGL_FINISH', tglFinish: new Date(tglFinishEdit).toISOString(), koreksiSelesai: true },
                              })
                            }
                          >
                            <CheckCircle2 className="mr-1 h-3 w-3" /> Simpan Koreksi
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                  {/* Koreksi data lama: tanggal part datang bisa diubah/kosongkan (Admin/Manager) */}
                  <div className="rounded-md border p-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-slate-500">Part datang dari produsen</p>
                      {bisaKoreksiPart && (detail.status === 'FINISH' || detail.status === 'PROSES') && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-5 w-5 shrink-0 p-0 text-amber-600 hover:bg-amber-50"
                          title="Koreksi tanggal part datang (data lama) — tersimpan dengan tanda (edited) di sistem"
                          onClick={() => setTglPartEdit(detail.tglPartDatang ? dtLocalFrom(new Date(detail.tglPartDatang)) : dtLocalNow())}
                        >
                          <Pencil className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                    <p className="font-semibold text-slate-800">{formatTanggal(detail.tglPartDatang)}</p>
                    {tglPartEdit && (
                      <div className="mt-2 space-y-1.5 rounded-md border border-amber-200 bg-amber-50 p-2">
                        <p className="text-[11px] font-semibold text-amber-800">
                          Koreksi tanggal part datang (data lama) — tertanda (edited) di sistem &amp; Audit Log.
                          <br />
                          Bila tiket sudah FINISH, tidak boleh lebih lambat dari tanggal selesai dikerjakan.
                        </p>
                        <Input
                          type="datetime-local"
                          value={tglPartEdit}
                          onChange={(e) => setTglPartEdit(e.target.value)}
                          className="h-7 text-[11px]"
                          aria-label="Tanggal part datang koreksi"
                        />
                        <div className="flex flex-wrap items-center justify-end gap-1.5">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 text-[11px]"
                            title="Hapus tanggal part datang (kosongkan)"
                            disabled={flowMutation.isPending}
                            onClick={() => {
                              flowMutation.mutate({ id: detail.id, body: { aksi: 'KOREKSI_TGL_PART_DATANG', koreksiSelesai: true } })
                              setTglPartEdit(null)
                            }}
                          >
                            Kosongkan
                          </Button>
                          <Button size="sm" variant="outline" className="h-6 text-[11px]" onClick={() => setTglPartEdit(null)}>
                            <X className="mr-1 h-3 w-3" /> Batal
                          </Button>
                          <Button
                            size="sm"
                            className="h-6 text-[11px]"
                            disabled={!tglPartEdit || flowMutation.isPending}
                            onClick={() => {
                              flowMutation.mutate({
                                id: detail.id,
                                body: { aksi: 'KOREKSI_TGL_PART_DATANG', tglPartDatang: new Date(tglPartEdit).toISOString(), koreksiSelesai: true },
                              })
                              setTglPartEdit(null)
                            }}
                          >
                            <CheckCircle2 className="mr-1 h-3 w-3" /> Simpan Koreksi
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                  {detail.tglKembaliKeToko ? (
                    <div className="rounded-md border border-emerald-200 bg-emerald-50/50 p-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-slate-500">Barang kembali ke toko</p>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-5 shrink-0 border-emerald-300 px-1.5 text-[10px] text-emerald-700 hover:bg-emerald-50"
                          title="Cetak Surat Pengembalian Barang (per toko) — tanggal kembali tercetak di dokumen"
                          onClick={() => void unduhSuratKembali([detail.noTiket])}
                        >
                          <PackageOpen className="mr-1 h-3 w-3" /> Cetak PDF
                        </Button>
                      </div>
                      <p className="font-semibold text-slate-800">{formatTanggal(detail.tglKembaliKeToko)}</p>
                      <p className="mt-0.5 text-[10px] text-slate-500">Tanggal kembali ikut tercetak di Surat Pengembalian Barang (per toko / kolektif).</p>
                    </div>
                  ) : detail.status === 'FINISH' ? (
                    <div className="rounded-md border border-amber-200 bg-amber-50/50 p-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-amber-700">Belum kembali ke toko</p>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-5 shrink-0 border-amber-300 px-1.5 text-[10px] text-amber-700 hover:bg-amber-100"
                          title="Cetak Surat Pengembalian Barang — boleh sekarang walau unit masih di workshop (baris tgl kembali mencetak —)"
                          onClick={() => void unduhSuratKembali([detail.noTiket])}
                        >
                          <PackageOpen className="mr-1 h-3 w-3" /> Cetak SKTB
                        </Button>
                      </div>
                      <p className="font-semibold text-amber-800">Masih di workshop</p>
                      <p className="mt-0.5 text-[10px] text-amber-700">Kirim unit → suratnya tercetak via tombol ini; saat unit sampai toko tekan Aksi → "Konfirmasi Kembali ke Toko" agar tanggalnya terekam.</p>
                    </div>
                  ) : null}
                </div>
                {detail.noSttb && (
                  <p className="rounded-md bg-slate-50 p-2 text-[11px] text-slate-600">
                    No. STTB <span className="font-mono font-semibold text-slate-800">{detail.noSttb}</span>
                    {' '}— cetak via tombol <span className="font-semibold">STTB Toko</span> di daftar Service (centang tiket 1 toko yang sama).
                  </p>
                )}
                {(detail.noSttbKolektif || detail.noSuratKembali) && (
                  <div className="flex flex-wrap gap-1.5 text-[10px]">
                    {detail.noSttbKolektif && (
                      <Badge variant="outline" className="font-mono text-slate-600" title="Unit ini dicakup STTB kolektif yang disahkan ditarik — unitnya sudah dipindahkan ke workshop">
                        STTBK {detail.noSttbKolektif}
                      </Badge>
                    )}
                    {detail.noSuratKembali && (
                      <Badge variant="outline" className="font-mono text-emerald-700" title="Nomor Surat Pengembalian Barang yang mencakup unit ini">
                        SKTB {detail.noSuratKembali}
                      </Badge>
                    )}
                  </div>
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
                  Rekaman pengerjaan selesai. Unit boleh masih di workshop — saat unit dikirim kembali, cetak Surat Pengembalian lalu tekan "Konfirmasi Kembali ke Toko" saat sampai. Foto nota berstempel opsional sekarang (wajib saat ajukan klaim).
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="finish-tgl">Tanggal Selesai</Label>
                  <Input
                    id="finish-tgl"
                    type="datetime-local"
                    value={finishTgl}
                    onChange={(e) => setFinishTgl(e.target.value)}
                    aria-label="Tanggal selesai tiket"
                  />
                  <p className="text-[10px] text-slate-400">Isi otomatis dengan waktu sekarang — ubah sesuai waktu sebenarnya bila ini data lama yang baru diselesaikan.</p>
                </div>
                <div className="rounded-lg border border-dashed bg-slate-50 p-4 text-center">
                  <Camera className="mx-auto mb-2 h-8 w-8 text-slate-400" />
                  <p className="text-xs text-slate-500">Simulasi kamera teknisi: foto nota berstempel (opsional — bisa menyusul)</p>
                  <Input value={notaFile} onChange={(e) => setNotaFile(e.target.value)} className="mt-2 font-mono text-xs" aria-label="Nama file foto nota" placeholder="boleh kosong" />
                </div>
                <p className="text-xs text-slate-500">
                  Setelah FINISH, tiket masuk kandidat klaim bulanan ke produsen. Unit milik <span className="font-medium">{finishTarget.unitAsset.toko?.namaToko}</span> — kembalikan via Surat Pengembalian (tombol "Kembali Toko" atau dari detail tiket).
                </p>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setFinishTarget(null)}><Ban className="mr-1 h-4 w-4" /> Batal</Button>
                <Button
                  className="bg-emerald-600 hover:bg-emerald-700"
                  disabled={aksiMutation.isPending}
                  onClick={() => aksiMutation.mutate({ id: finishTarget.id, body: { aksi: 'FINISH', ...(notaFile.trim() ? { fotoNotaStempel: notaFile.trim() } : {}), ...(finishTgl ? { tglFinish: new Date(finishTgl).toISOString() } : {}) } })}
                >
                  <CheckCircle2 className="mr-1 h-4 w-4" /> Konfirmasi FINISH
                </Button>
              </DialogFooter>
            </>
          )}
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
          }
        }}
        tickets={sjTickets}
        onDownloaded={() => saveSelectionMutation.mutate([])}
      />
    </div>
  )
}
