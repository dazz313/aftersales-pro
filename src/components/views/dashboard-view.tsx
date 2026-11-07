'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetcher, postJson, authHeaders, formatRupiah, formatWaktu, type DashboardData, type AlertsResponse, type AlertItem, type ChatData, type ChatPesanItem } from '@/lib/api'
import { useToast } from '@/hooks/use-toast'
import { useAppStore, type NavIntent, type ViewKey } from '@/lib/store'
import { cn } from '@/lib/utils'
import { formatUmur } from '@/lib/umur'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  LineChart, Line, PieChart, Pie, Cell, Legend,
} from 'recharts'
import {
  FileClock, Loader, CheckCircle2, Wallet, PackageX, MapPinOff, AlertTriangle,
  RefreshCw, TrendingUp, Store, ClipboardList, ChevronRight, ChevronDown, Hourglass,
  FileDown, FileSpreadsheet, Send, QrCode, Mail, MessageSquare,
} from 'lucide-react'
import { KpiGrid, type KpiDef } from '@/components/kpi-card'
import { ambilReadMap, threadDariPesan, totalUnread, unreadPerThread } from '@/lib/chat'

const MODEL_SHORT = (m: string) => (m.length > 22 ? m.slice(0, 20) + '…' : m)

/** Peta drill-down alert → view sumber (klik baris alert di dashboard). */
const ALERT_DRILLDOWN: Record<string, { view: ViewKey; label: string; intent: Omit<NavIntent, 'ts'> }> = {
  'ALT-01': { view: 'field-ops', label: 'Manajemen Visit', intent: { fieldOpsFilter: 'terlambat' } },
  'ALT-02': { view: 'service', label: 'Proses Service', intent: { serviceStatus: 'REQUEST' } },
  'ALT-03': { view: 'inventory', label: 'Inventory', intent: { inventoryFilter: 'kritis' } },
  'ALT-04': { view: 'claim', label: 'Klaim & Rekap', intent: { klaimTab: 'DRAFT' } },
  'ALT-05': { view: 'service', label: 'Proses Service', intent: { serviceStatus: 'REQUEST' } },
}

export default function DashboardView() {
  const { data: dash, isLoading, refetch: refetchDash, isRefetching } = useQuery<DashboardData>({
    queryKey: ['dashboard'],
    queryFn: () => fetcher<DashboardData>('/api/dashboard'),
  })
  const { data: alerts, isLoading: alertsLoading, refetch: refetchAlerts, isRefetching: alertRefetching } = useQuery<AlertsResponse>({
    queryKey: ['alerts'],
    queryFn: () => fetcher<AlertsResponse>('/api/alerts'),
    refetchInterval: 60_000,
  })

  const { navigateTo, user } = useAppStore()
  const { toast } = useToast()
  const queryClient = useQueryClient()
  // Alert Engine berupa dropdown — diklik baru muncul
  const [alertOpen, setAlertOpen] = useState(false)

  // ===== CHAT-01 — pesan chat internal yang belum dibaca =====
  // Query ['chat'] dibagi dengan widget MiniChat; status baca dibaca dari
  // cache modul (lib/chat) sehingga kartu ini muncul/bebas terus segar tanpa
  // membuka fitur MiniChat.
  const { data: chat } = useQuery<ChatData>({
    queryKey: ['chat'],
    queryFn: () => fetcher<ChatData>('/api/chat'),
    refetchInterval: 15_000,
    enabled: !!user,
    retry: false,
  })

  const unduhPending = async (format: 'pdf' | 'xlsx') => {
    try {
      const res = await fetch(`/api/pending/export?format=${format}`, { headers: authHeaders() })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error((err as { error?: string }).error || `Gagal mengunduh (${res.status})`)
      }
      const cd = res.headers.get('content-disposition') ?? ''
      const m = cd.match(/filename="([^"]+)"/)
      const filename = m?.[1] ?? `Unit-Pending.${format}`
      const blob = await res.blob()
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(a.href), 5000)
      toast({ title: 'Laporan pending diunduh', description: `File ${filename} siap diemailkan / dikirim ke grup.` })
    } catch (e) {
      toast({ title: 'Unduhan gagal', description: (e as Error).message, variant: 'destructive' })
    }
  }

  const kirimGrup = useMutation({
    mutationFn: () => {
      const list = dash!.belumProses.items.slice(0, 10)
      const baris = list.map((t, i) => `${i + 1}. ${t.noTiket} — ${t.model} (${t.toko}) — ${t.isDataLama ? 'DATA LAMA' : `pending ${formatUmur(t.umurJam)}`} — ${t.adaPart ? 'menunggu READY' : 'belum input part'}`)
      const pesan =
        `*UNIT PENDING* (${dash!.belumProses.count} unit >24 jam belum ada kode+nama part)\n` +
        baris.join('\n') +
        (dash!.belumProses.count > list.length ? `\n…dan ${dash!.belumProses.count - list.length} lainnya.` : '')
      return postJson<{ ok: boolean; mode: string; detail: string }>('/api/gateway/kirim', { pesan })
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['audit'] })
      toast({ title: res.ok ? `Ringkasan terkirim (${res.mode})` : 'Pengiriman gagal', description: res.detail, variant: res.ok ? 'default' : 'destructive' })
    },
    onError: (e: Error) => toast({ title: 'Gagal mengirim ke grup', description: e.message, variant: 'destructive' }),
  })

  const refreshAll = () => {
    refetchDash()
    refetchAlerts()
  }

  // ===== Alert Engine dua kolom berdampingan (tanpa scroll jauh) =====
  // Kiri: SLA & Sparepart (ALT-02, ALT-03, ALT-05) · Kanan: Toko & Klaim (ALT-01, ALT-04).
  const SPAREPART_KODES = ['ALT-02', 'ALT-03', 'ALT-05']
  const TOKO_KODES = ['ALT-01', 'ALT-04']

  /** Satu baris alert (klik → view sumber). Dipakai kedua kolom grup. */
  const barisAlert = (a: AlertItem, key: string | number) => {
    const drill = ALERT_DRILLDOWN[a.kode]
    const baseCls = `flex items-start gap-3 rounded-lg border p-3 ${
      a.severity === 'critical' ? 'border-rose-200 bg-rose-50' : 'border-amber-200 bg-amber-50'
    }`
    const content = (
      <>
        <AlertTriangle className={`mt-0.5 h-4 w-4 shrink-0 ${a.severity === 'critical' ? 'text-rose-600' : 'text-amber-600'}`} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="font-mono text-[10px]">{a.kode}</Badge>
            <span className="text-sm font-semibold text-slate-800">{a.nama}</span>
            {a.severity === 'critical' && <Badge variant="destructive" className="text-[10px]">KRITIS</Badge>}
          </div>
          <p className="mt-0.5 text-xs text-slate-600">
            <span className="font-medium">{a.entitas}</span> — {a.detail}
          </p>
        </div>
        {drill && <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-slate-400" />}
      </>
    )
    return drill ? (
      <button
        key={key}
        type="button"
        onClick={() => navigateTo(drill.view, drill.intent)}
        className={cn(
          baseCls,
          'w-full cursor-pointer text-left transition-all hover:-translate-y-px hover:border-slate-300 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500'
        )}
        aria-label={`Buka sumber alert ${a.kode} di menu ${drill.label}`}
      >
        {content}
      </button>
    ) : (
      <div key={key} className={baseCls}>{content}</div>
    )
  }

  /** Satu kolom grup alert dengan scroll internal sendiri. */
  const panelAlert = (judul: string, ikon: React.ReactNode, daftar: AlertItem[], kosong: string) => {
    const kritis = daftar.filter((a) => a.severity === 'critical').length
    return (
      <div className="flex min-h-0 flex-col rounded-xl border border-slate-200 bg-slate-50/50">
        <div className="flex items-center gap-2 border-b border-slate-200 px-3 py-2">
          {ikon}
          <p className="text-xs font-bold text-slate-800">{judul}</p>
          {daftar.length > 0 ? (
            <Badge variant="outline" className="ml-auto text-[10px] text-slate-600">
              {daftar.length} aktif{kritis > 0 && <span className="ml-1 font-bold text-rose-600">· {kritis} kritis</span>}
            </Badge>
          ) : (
            <Badge variant="outline" className="ml-auto border-emerald-300 bg-emerald-50 text-[10px] text-emerald-700">Aman</Badge>
          )}
        </div>
        {daftar.length === 0 ? (
          <p className="px-3 py-4 text-center text-[11px] text-slate-500">{kosong}</p>
        ) : (
          <ScrollArea className="max-h-80 pr-3">
            <div className="space-y-2 p-2.5">{daftar.map((a, i) => barisAlert(a, `${judul}-${i}`))}</div>
          </ScrollArea>
        )}
      </div>
    )
  }

  if (isLoading || !dash) {
    return (
      <div className="space-y-4 overflow-y-auto pr-1 md:h-[calc(100dvh-9rem)]">
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-5">
          {Array.from({ length: 9 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          <Skeleton className="h-80 lg:col-span-2" />
          <Skeleton className="h-80" />
        </div>
      </div>
    )
  }

  const pieData = [
    { name: 'Garansi', value: dash.garansiCount.GARANSI, color: '#10b981' },
    { name: 'Non-Garansi', value: dash.garansiCount.NON_GARANSI, color: '#f59e0b' },
  ]

  // Peringkat toko: unit rusak terbanyak → paling kurang (pie)
  const RANK_COLORS = ['#10b981', '#14b8a6', '#0ea5e9', '#6366f1', '#8b5cf6', '#d946ef', '#f59e0b', '#f97316']
  const spiralData = dash.rusakPerToko.slice(0, 8).map((d, i) => ({ ...d, name: d.kode, fill: RANK_COLORS[i % RANK_COLORS.length] }))
  // Top 3 brand unit rusak (batang horizontal)
  const BRAND_COLORS = ['#f59e0b', '#0ea5e9', '#10b981']
  const brandData = dash.rusakPerBrand.slice(0, 3).map((d, i) => ({ ...d, fill: BRAND_COLORS[i % BRAND_COLORS.length] }))

  // ===== CHAT-01 — thread dengan pesan chat belum dibaca (kartu "Chat Baru") =====
  // pesan dari API terurut terbaru dulu (id desc) → kemunculan pertama per
  // thread = pesan terbaru thread itu. Status baca dari cache modul lib/chat.
  const chatReadMap = chat ? ambilReadMap(chat.meId) : {}
  const chatUnreadPer = chat ? unreadPerThread(chat.pesan, chat.meId, chatReadMap) : {}
  const chatBaruTotal = chat ? totalUnread(chat.pesan, chat.meId, chatReadMap) : 0
  interface ChatBaruBaris { thread: string; nama: string; pengirim: string; pesan: string; waktu: string; jumlah: number }
  const chatBaruRows: ChatBaruBaris[] = []
  if (chat) {
    const terproses = new Set<string>()
    for (const p of chat.pesan) {
      if (p.pengirimId === chat.meId) continue
      const th = threadDariPesan(p, chat.meId)
      const jumlah = chatUnreadPer[th] ?? 0
      if (jumlah === 0 || terproses.has(th)) continue
      terproses.add(th)
      const pengirim = chat.users.find((u) => u.id === p.pengirimId)
      chatBaruRows.push({
        thread: th,
        nama: th === 'SEMUA' ? 'Semua Akun' : pengirim?.nama ?? `DM #${p.pengirimId}`,
        pengirim: pengirim?.nama ?? 'Akun',
        pesan: p.isi.length > 72 ? `${p.isi.slice(0, 71)}…` : p.isi,
        waktu: formatWaktu(p.createdAt),
        jumlah,
      })
    }
  }

  // Indikator portable — tambah/pindah/kurangi cukup edit array ini
  const kpiUtama: KpiDef[] = [
    { title: 'Tiket REQUEST', value: String(dash.tiket.request), sub: `${dash.tiket.slaTerlambat} melewati SLA 24 jam`, icon: FileClock, tone: 'bg-amber-400', onClick: () => navigateTo('service', { serviceStatus: 'REQUEST' }) },
    { title: 'Tiket PROSES', value: String(dash.tiket.proses), sub: 'Sedang dikerjakan di workshop', icon: Loader, tone: 'bg-violet-400', onClick: () => navigateTo('service', { serviceStatus: 'PROSES' }) },
    { title: 'Tiket FINISH', value: String(dash.tiket.finish), sub: 'Siap diklaim ke produsen', icon: CheckCircle2, tone: 'bg-emerald-400', onClick: () => navigateTo('service', { serviceStatus: 'FINISH' }) },
    { title: 'Klaim Tertahan', value: formatRupiah(dash.klaim.pendingValue), sub: `${dash.klaim.pendingCount} tiket FINISH status DRAFT (ALT-04)`, icon: Wallet, tone: 'bg-rose-400', onClick: () => navigateTo('claim', { klaimTab: 'DRAFT' }) },
  ]
  const kpiSekunder: KpiDef[] = [
    { title: 'Unit Belum Diproses', value: String(dash.unitBelumDiproses.count), sub: `terdaftar tanpa tiket service · dari ${dash.unitBelumDiproses.total} unit`, icon: QrCode, tone: 'bg-sky-400', onClick: () => navigateTo('master', { masterTab: 'unit' }) },
    { title: 'Stok Kritis (ROP)', value: `${dash.stok.kritis} / ${dash.stok.totalItem}`, sub: `${dash.stok.kosong} part kosong total · nilai stok ${formatRupiah(dash.stok.nilaiTotal)}`, icon: PackageX, tone: 'bg-amber-400', onClick: () => navigateTo('inventory', { inventoryFilter: 'kritis' }) },
    { title: 'Toko Telat Visit', value: String(dash.operasional.tokoTerlambatVisit), sub: `dari ${dash.operasional.totalToko} toko terdaftar (ALT-01)`, icon: MapPinOff, tone: 'bg-rose-400', onClick: () => navigateTo('field-ops', { fieldOpsFilter: 'terlambat' }) },
    { title: 'Kunjungan 7 Hari', value: String(dash.operasional.kunjungan7hari), sub: 'Check-in onsite teknisi', icon: Store, tone: 'bg-emerald-400', onClick: () => navigateTo('field-ops', { fieldOpsFilter: 'kunjungan' }) },
    { title: 'Total Tiket', value: String(dash.tiket.total), sub: `${dash.klaim.submitted} klaim SUBMITTED menunggu pembayaran`, icon: ClipboardList, tone: 'bg-teal-400', onClick: () => navigateTo('service', { serviceStatus: 'SEMUA' }) },
    { title: 'Waiting Part', value: String(dash.tiket.menungguPart), sub: `unit terdaftar menunggu sparepart · ${dash.tiket.menungguPartQty} part di-order ke produsen`, icon: Hourglass, tone: 'bg-orange-400', onClick: () => navigateTo('service', { serviceStatus: 'SEMUA' }) },
  ]

  // ===== Ringkasan progres & tren (semua dihitung dari data /api/dashboard) =====
  const totalTiket = dash.tiket.total
  const pctFinish = totalTiket > 0 ? Math.round((dash.tiket.finish / totalTiket) * 100) : 0
  const segmenProgres = [
    { key: 'finish', label: 'Finish', jumlah: dash.tiket.finish, warna: 'bg-emerald-500', onClick: () => navigateTo('service', { serviceStatus: 'FINISH' }) },
    { key: 'proses', label: 'Proses', jumlah: dash.tiket.proses, warna: 'bg-violet-500', onClick: () => navigateTo('service', { serviceStatus: 'PROSES' }) },
    { key: 'request', label: 'Request', jumlah: dash.tiket.request, warna: 'bg-amber-500', onClick: () => navigateTo('service', { serviceStatus: 'REQUEST' }) },
  ].map((s) => ({ ...s, persen: totalTiket > 0 ? (s.jumlah / totalTiket) * 100 : 0 }))

  // Denyut tiket masuk: bandingkan 7 hari terakhir dengan 7 hari sebelumnya
  const tren = dash.tren14hari ?? []
  const pekanIni = tren.slice(-7).reduce((a, d) => a + d.tiket, 0)
  const pekanLalu = tren.slice(0, Math.max(0, tren.length - 7)).reduce((a, d) => a + d.tiket, 0)
  const deltaPct = pekanLalu > 0 ? Math.round(((pekanIni - pekanLalu) / pekanLalu) * 100) : null
  const maxTiket = Math.max(1, ...tren.map((d) => d.tiket))
  const alertKritis = alerts?.alerts.filter((a) => a.severity === 'critical').length ?? 0

  return (
    <div className="h-[calc(100dvh-9rem)] space-y-4 overflow-y-auto pr-1">
      {/* Panel indikator — ringkas 9 kartu dalam 2 baris agar terpantau di halaman pertama */}
      <KpiGrid items={[...kpiUtama, ...kpiSekunder]} compact />

      {/* CHAT-01 — pesan chat antar akun yang belum dibaca (tanpa membuka MiniChat) */}
      {chatBaruTotal > 0 && (
        <Card className="border-emerald-200 bg-emerald-50/40">
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <MessageSquare className="h-4 w-4 text-emerald-600" /> Chat Baru antar Akun
              <Badge variant="outline" className="font-mono text-[10px]">CHAT-01</Badge>
            </CardTitle>
            <div className="flex items-center gap-2">
              <Badge className="bg-rose-600 text-white hover:bg-rose-600" title="Total pesan belum dibaca">
                {chatBaruTotal > 99 ? '99+' : chatBaruTotal}
              </Badge>
              <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => navigateTo('komunikasi')}>
                Buka Komunikasi
              </Button>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <p className="pb-1.5 text-[11px] text-slate-500">Pesan MiniChat antar akun yang belum dibaca — klik baris untuk langsung membuka thread-nya:</p>
            <div className="space-y-1.5">
              {chatBaruRows.slice(0, 6).map((r) => (
                <button
                  key={r.thread}
                  type="button"
                  onClick={() => navigateTo('komunikasi', { komunikasiThread: r.thread })}
                  className="flex w-full items-center gap-3 rounded-lg border border-emerald-200 bg-white p-2.5 text-left transition-all hover:-translate-y-px hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
                  aria-label={`Buka chat dari ${r.nama}`}
                >
                  <span className="mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-500" aria-hidden />
                  <span className="w-24 shrink-0 line-clamp-2 break-words text-xs font-semibold leading-tight text-slate-800 sm:w-28">{r.nama}</span>
                  <span className="min-w-0 flex-1 truncate text-xs text-slate-600">
                    <span className="font-medium text-slate-500">{r.pengirim}:</span> {r.pesan}
                  </span>
                  <span className="shrink-0 text-[10px] text-slate-400">{r.waktu}</span>
                  <Badge variant="outline" className="shrink-0 border-rose-300 bg-rose-50 text-[10px] text-rose-700">
                    {r.jumlah > 99 ? '99+' : r.jumlah}
                  </Badge>
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                </button>
              ))}
            </div>
            {chatBaruRows.length > 6 && (
              <button
                type="button"
                onClick={() => navigateTo('komunikasi')}
                className="w-full pt-2 text-center text-[11px] font-semibold text-emerald-700 hover:underline"
              >
                …dan {chatBaruRows.length - 6} thread lainnya — buka semua di Komunikasi
              </button>
            )}
          </CardContent>
        </Card>
      )}

      {/* Ringkasan progres + denyut tiket masuk — satu pandangan sebelum grafik detail */}
      <Card>
        <CardHeader className="flex-row items-start justify-between space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <ClipboardList className="h-4 w-4 text-emerald-600" /> Ringkasan Progres &amp; Tren
            </CardTitle>
            <CardDescription>Proporsi tiket selesai vs berjalan, dan denyut tiket masuk 14 hari terakhir — klik untuk membuka sumbernya</CardDescription>
          </div>
          {deltaPct !== null && (
            <Badge
              variant="outline"
              className={cn('shrink-0 text-[10px]', deltaPct >= 0 ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-rose-300 bg-rose-50 text-rose-700')}
              title={`Tiket masuk 7 hari terakhir: ${pekanIni} · 7 hari sebelumnya: ${pekanLalu}`}
            >
              {deltaPct > 0 ? '+' : ''}{deltaPct}% vs pekan lalu
            </Badge>
          )}
        </CardHeader>
        <CardContent className="grid gap-5 lg:grid-cols-2">
          {/* Progres penyelesaian tiket */}
          <div>
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="text-3xl font-extrabold tracking-tight text-slate-900">{pctFinish}%</span>
              <span className="text-xs text-slate-500">tiket FINISH dari {totalTiket} tiket</span>
            </div>
            <div
              className="mt-3 flex h-3 w-full overflow-hidden rounded-full bg-slate-100"
              role="group"
              aria-label={`Progres tiket: ${dash.tiket.finish} finish, ${dash.tiket.proses} proses, ${dash.tiket.request} request`}
            >
              {segmenProgres.filter((s) => s.jumlah > 0).map((s) => (
                <button
                  key={s.key}
                  type="button"
                  onClick={s.onClick}
                  style={{ width: `${s.persen}%` }}
                  title={`${s.label}: ${s.jumlah} tiket (${Math.round(s.persen)}%)`}
                  aria-label={`Buka tiket ${s.label}: ${s.jumlah}`}
                  className={cn('h-full transition-all hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500', s.warna)}
                />
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs">
              {segmenProgres.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  onClick={s.onClick}
                  className="flex items-center gap-1.5 rounded text-slate-600 transition-colors hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
                >
                  <span className={cn('h-2.5 w-2.5 rounded-sm', s.warna)} />
                  {s.label} <span className="font-bold text-slate-900">{s.jumlah}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Denyut tiket masuk 14 hari (batang mini) */}
          <div>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Tiket masuk 14 hari</span>
              <span className="text-xs text-slate-500"><span className="font-bold text-slate-900">{pekanIni}</span> dalam 7 hari terakhir</span>
            </div>
            <div className="mt-3 flex h-20 items-end gap-1">
              {tren.map((d, i) => (
                <div key={`${d.tanggal}-${i}`} className="group flex h-full flex-1 flex-col items-center justify-end gap-1" title={`${d.tanggal}: ${d.tiket} tiket`}>
                  <span className="text-[10px] font-semibold text-slate-400 opacity-0 transition-opacity group-hover:opacity-100">{d.tiket}</span>
                  <div
                    className={cn('w-full rounded-t', i >= tren.length - 7 ? 'bg-emerald-500' : 'bg-emerald-200')}
                    style={{ height: `${Math.max(5, Math.round((d.tiket / maxTiket) * 100))}%` }}
                  />
                </div>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-slate-400">Batang hijau tua = 7 hari terakhir · sorot batang untuk melihat jumlah per hari</p>
          </div>
        </CardContent>
      </Card>

      {/* Grafik: 3 sejajar (Tren + Toko + Garansi) / Tren Model (2) + Brand */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader className="flex-row items-start justify-between space-y-0">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <TrendingUp className="h-4 w-4 text-emerald-600" /> Tren Tiket Masuk — 14 Hari Terakhir
              </CardTitle>
              <CardDescription>Jumlah laporan kerusakan yang diterima sistem per hari</CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="shrink-0 border-emerald-200 text-emerald-700 hover:bg-emerald-50"
              onClick={() => navigateTo('service', { serviceStatus: 'SEMUA' })}
              aria-label="Buka daftar tiket service"
            >
              Lihat Tiket <ChevronRight className="ml-1 h-3.5 w-3.5" />
            </Button>
          </CardHeader>
          <CardContent className="h-60">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={dash.tren14hari} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="tanggal" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v) => [`${v} tiket`, 'Tiket masuk']} />
                <Line type="monotone" dataKey="tiket" stroke="#10b981" strokeWidth={2.5} dot={{ r: 3, fill: '#10b981' }} activeDot={{ r: 5 }} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Peringkat Toko — Unit Rusak</CardTitle>
            <CardDescription>Terbanyak → paling kurang · klik spiral untuk buka tiket toko</CardDescription>
          </CardHeader>
          <CardContent className="h-60">
            {spiralData.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-6 text-center">
                <p className="text-sm text-slate-500">Belum ada tiket dari toko.</p>
                <p className="text-xs text-slate-400">Unit perorangan (tanpa toko) tidak masuk peringkat ini.</p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={spiralData} dataKey="jumlah" nameKey="name" cx="50%" cy="42%" innerRadius={45} outerRadius={75} paddingAngle={3}
                    style={{ cursor: 'pointer' }}
                    onClick={(entry: { name?: string }) => {
                      if (entry?.name) navigateTo('service', { serviceToko: entry.name })
                    }}
                  >
                    {spiralData.map((d, i) => <Cell key={i} fill={d.fill} />)}
                  </Pie>
                  <Legend
                    verticalAlign="bottom"
                    iconType="circle"
                    wrapperStyle={{ cursor: 'pointer', fontSize: 11 }}
                    formatter={(v) => <span className="text-xs text-slate-600">{v}</span>}
                  />
                  <Tooltip formatter={(v, name) => [`${v} unit rusak`, name]} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Distribusi Garansi Unit</CardTitle>
            <CardDescription>Klik irisan/legenda untuk membuka tiket per garansi</CardDescription>
          </CardHeader>
          <CardContent className="h-60">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={pieData} dataKey="value" nameKey="name" cx="50%" cy="45%" innerRadius={50} outerRadius={80} paddingAngle={4} label
                  style={{ cursor: 'pointer' }}
                  onClick={(entry: { name?: string }) => {
                    if (entry?.name === 'Garansi') navigateTo('service', { serviceGaransi: 'GARANSI' })
                    else if (entry?.name === 'Non-Garansi') navigateTo('service', { serviceGaransi: 'NON_GARANSI' })
                  }}
                >
                  {pieData.map((d, i) => <Cell key={i} fill={d.color} />)}
                </Pie>
                <Legend
                  verticalAlign="bottom"
                  iconType="circle"
                  wrapperStyle={{ cursor: 'pointer' }}
                  formatter={(v) => <span className="text-xs text-slate-600">{v}</span>}
                  onClick={(d: unknown) => {
                    const name = typeof d === 'string' ? d : (d as { value?: string } | null)?.value
                    if (name === 'Garansi') navigateTo('service', { serviceGaransi: 'GARANSI' })
                    else if (name === 'Non-Garansi') navigateTo('service', { serviceGaransi: 'NON_GARANSI' })
                  }}
                />
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Tren Kerusakan per Model Unit</CardTitle>
          <CardDescription>Model dengan frekuensi kerusakan tertinggi — klik batang untuk membuka tiket model tersebut</CardDescription>
        </CardHeader>
        <CardContent className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dash.trenKerusakan.slice(0, 8).map((d) => ({ ...d, short: MODEL_SHORT(d.model) }))} layout="vertical" margin={{ top: 0, right: 20, left: 10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
              <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="short" width={150} tick={{ fontSize: 10 }} />
              <Tooltip formatter={(v) => [`${v} tiket`, 'Kerusakan']} />
              <Bar
                dataKey="jumlah" fill="#10b981" radius={[0, 6, 6, 0]} barSize={16}
                style={{ cursor: 'pointer' }}
                onClick={(entry: { payload?: { model?: string } }) => {
                  const model = entry?.payload?.model
                  if (model) navigateTo('service', { serviceModel: model })
                }}
              />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Top 3 Brand — Unit Rusak</CardTitle>
            <CardDescription>Klik batang untuk buka tiket brand</CardDescription>
          </CardHeader>
          <CardContent className="h-56">
            {brandData.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-6 text-center">
                <p className="text-sm text-slate-500">Belum ada data merk unit.</p>
                <p className="text-xs text-slate-400">Isi kolom merk saat registrasi service.</p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={brandData} layout="vertical" margin={{ top: 0, right: 20, left: 10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                  <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="brand" width={90} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v) => [`${v} unit rusak`, 'Rusak']} />
                  <Bar
                    dataKey="jumlah" radius={[0, 6, 6, 0]} barSize={22}
                    style={{ cursor: 'pointer' }}
                    onClick={(entry: { payload?: { brand?: string } }) => {
                      const brand = entry?.payload?.brand
                      if (brand) navigateTo('service', { serviceBrand: brand })
                    }}
                  >
                    {brandData.map((d, i) => <Cell key={i} fill={d.fill} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Unit belum terproses — di bawah grafik */}
      {dash.belumProses.count > 0 && (
        <Card className="border-amber-300">
          <CardHeader className="flex-row items-start justify-between space-y-0">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <Hourglass className="h-4 w-4 text-amber-600" />
                Unit Belum Terproses
                <Badge className="bg-amber-500 text-[10px] text-white hover:bg-amber-500">{dash.belumProses.count} pending</Badge>
              </CardTitle>
              <CardDescription>Belum ada kode + nama sparepart yang READY — input dari Master Data (tombol Part) atau detail tiket agar tidak dilupakan</CardDescription>
            </div>
            <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
              <Button variant="outline" size="sm" className="h-7 px-2 text-[11px]" onClick={() => void unduhPending('pdf')}>
                <FileDown className="mr-1 h-3 w-3" /> PDF
              </Button>
              <Button variant="outline" size="sm" className="h-7 px-2 text-[11px]" onClick={() => void unduhPending('xlsx')}>
                <FileSpreadsheet className="mr-1 h-3 w-3" /> Excel
              </Button>
              <Button variant="outline" size="sm" className="h-7 border-teal-600 px-2 text-[11px] text-teal-700 hover:bg-teal-50" disabled={kirimGrup.isPending} onClick={() => kirimGrup.mutate()} title="Kirim ringkasan ke grup WA/Telegram">
                <Send className="mr-1 h-3 w-3" /> Grup
              </Button>
              <Button variant="outline" size="sm" onClick={() => navigateTo('service', { serviceStatus: 'REQUEST' })} aria-label="Buka tiket REQUEST">
                Buka Service <ChevronRight className="ml-1 h-3.5 w-3.5" />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              {dash.belumProses.items.map((t) => (
                  <div key={t.noTiket} className="rounded-lg border border-amber-200 bg-amber-50/60 p-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-mono text-xs font-semibold text-slate-800">{t.noTiket}</p>
                      {t.isDataLama ? (
                        <Badge variant="outline" className="border-slate-400 text-[9px] text-slate-600" title="Data lama (upload belakangan) — umur dinonaktifkan">
                          DATA LAMA
                        </Badge>
                      ) : (
                        <Badge variant="outline" className={cn('text-[9px]', (t.umurJam ?? 0) >= 72 ? 'border-rose-300 text-rose-700' : 'border-amber-300 text-amber-700')}>
                          {formatUmur(t.umurJam)}
                        </Badge>
                      )}
                    </div>
                  <p className="mt-0.5 truncate text-[11px] text-slate-600">{t.model} · {t.serial}</p>
                  <p className="truncate text-[10px] text-slate-400">{t.toko} · {t.adaPart ? 'menunggu part READY' : 'belum input part'}</p>
                </div>
              ))}
            </div>
            {dash.belumProses.count > dash.belumProses.items.length && (
              <p className="mt-2 text-[11px] text-slate-500">+ {dash.belumProses.count - dash.belumProses.items.length} lainnya — buka Service untuk daftar penuh.</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Part Request by Email — pantau order kekurangan sparepart via email produsen (tiket SV-EM) */}
      <Card className="border-indigo-200">
        <CardHeader className="flex-row items-start justify-between space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Mail className="h-4 w-4 text-indigo-600" />
              Part Request by Email
              {dash.partEmail.countTiket > 0 && (
                <Badge className="bg-indigo-600 text-[10px] text-white hover:bg-indigo-600">{dash.partEmail.countTiket} tiket</Badge>
              )}
            </CardTitle>
            <CardDescription>
              Kekurangan sparepart diorder ke produsen via email — Klik &quot;Kirim Email&quot; di tiket SV-EM; part datang diinput lewat tombol Part di Master Data
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="shrink-0 border-indigo-200 text-indigo-700 hover:bg-indigo-50"
            onClick={() => navigateTo('service', { serviceStatus: 'REQUEST_EMAIL' })}
            aria-label="Buka tiket REQUEST EMAIL di panel Service"
          >
            Buka Tiket <ChevronRight className="ml-1 h-3.5 w-3.5" />
          </Button>
        </CardHeader>
        <CardContent>
          {dash.partEmail.items.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-200 p-4 text-center text-xs text-slate-400">
              Belum ada part request via email — simpan <b>Input Part Kurang</b> (tombol Aksi ▾ di Master Barcode) untuk menerbitkan tiket <span className="font-mono">SV-EM-…</span>
            </p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              {dash.partEmail.items.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => navigateTo('service', { serviceStatus: 'REQUEST_EMAIL' })}
                  className="rounded-lg border border-indigo-200 bg-indigo-50/50 p-2.5 text-left transition-colors hover:border-indigo-300 hover:bg-indigo-50"
                  title={`Buka tiket ${t.noTiket} di panel Service`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-mono text-xs font-semibold text-indigo-800">{t.noTiket}</p>
                    {t.pending > 0 ? (
                      <Badge variant="outline" className="border-indigo-300 text-[9px] text-indigo-700" title="Part belum di-email ke produsen">
                        {t.pending} menunggu
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="border-emerald-300 text-[9px] text-emerald-700" title="Semua part sudah di-email ke produsen">
                        terkirim
                      </Badge>
                    )}
                  </div>
                  <p className="mt-0.5 truncate text-[11px] text-slate-600">{t.model} · {t.serial}</p>
                  <p className="truncate text-[10px] text-slate-400">{t.toko}</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {t.parts.map((p, i) => (
                      <span key={i} className="rounded border border-teal-200 bg-white px-1 font-mono text-[9px] text-teal-700" title={p.nama}>
                        {p.kode} ×{p.qty}
                      </span>
                    ))}
                  </div>
                </button>
              ))}
            </div>
          )}
          {dash.partEmail.countTiket > dash.partEmail.items.length && (
            <p className="mt-2 text-[11px] text-slate-500">+ {dash.partEmail.countTiket - dash.partEmail.items.length} tiket lainnya — buka tiket untuk daftar penuh.</p>
          )}
          {dash.partEmail.countTiket > 0 && (
            <p className="mt-2 text-[11px] text-slate-500">
              {dash.partEmail.countPending} part menunggu email ke produsen · {dash.partEmail.countTerkirim} part sudah terkirim.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Alert Engine — dropdown, diklik baru muncul */}
      <Collapsible open={alertOpen} onOpenChange={setAlertOpen}>
        <Card>
          <CollapsibleTrigger asChild>
            <div className="cursor-pointer select-none" role="button" tabIndex={0} aria-expanded={alertOpen}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setAlertOpen(!alertOpen) } }}>
              <CardHeader className="flex-row items-start justify-between space-y-0">
                <div>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <AlertTriangle className="h-4 w-4 text-amber-500" />
                    System Alert Engine
                    {alerts && alerts.total > 0 && (
                      <Badge variant="destructive" className="ml-1">
                        {alerts.total} aktif{alertKritis > 0 ? ` · ${alertKritis} kritis` : ''}
                      </Badge>
                    )}
                  </CardTitle>
                  <CardDescription>
                    Aturan otomatis ALT-01 s/d ALT-05 · {alerts ? `evaluasi terakhir ${new Date(alerts.generatedAt).toLocaleTimeString('id-ID')}` : 'memuat…'}
                  </CardDescription>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span onClick={(e) => e.stopPropagation()}>
                    <Button variant="outline" size="sm" onClick={refreshAll} disabled={isRefetching || alertRefetching}>
                      <RefreshCw className={`mr-2 h-4 w-4 ${(isRefetching || alertRefetching) ? 'animate-spin' : ''}`} />
                      Jalankan Cron
                    </Button>
                  </span>
                  <ChevronDown className={cn('h-4 w-4 shrink-0 text-slate-400 transition-transform', alertOpen && 'rotate-180')} />
                </div>
              </CardHeader>
            </div>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent>
          {alertsLoading || !alerts ? (
            <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14" />)}</div>
          ) : alerts.alerts.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-10 text-center">
              <CheckCircle2 className="h-8 w-8 text-emerald-500" />
              <p className="text-sm font-medium text-slate-700">Semua indikator normal</p>
              <p className="text-xs text-slate-500">Tidak ada SLA terlambat, toko telat kunjungan, stok kritis, atau klaim tertahan.</p>
            </div>
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              {panelAlert(
                'SLA & Sparepart',
                <PackageX className="h-3.5 w-3.5 text-amber-600" />,
                alerts.alerts.filter((a) => SPAREPART_KODES.includes(a.kode) || !TOKO_KODES.includes(a.kode)),
                'Tidak ada SLA terlambat / stok kritis / unit belum terproses.'
              )}
              {panelAlert(
                'Toko & Klaim',
                <Store className="h-3.5 w-3.5 text-teal-700" />,
                alerts.alerts.filter((a) => TOKO_KODES.includes(a.kode)),
                'Tidak ada toko telat kunjungan / klaim tertahan.'
              )}
            </div>
          )}
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>
    </div>
  )
}
