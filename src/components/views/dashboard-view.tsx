'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetcher, postJson, authHeaders, formatRupiah, type DashboardData, type AlertsResponse } from '@/lib/api'
import { useToast } from '@/hooks/use-toast'
import { useAppStore, type NavIntent, type ViewKey } from '@/lib/store'
import { cn } from '@/lib/utils'
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
  FileDown, FileSpreadsheet, Send, QrCode,
} from 'lucide-react'
import { KpiGrid, type KpiDef } from '@/components/kpi-card'

const MODEL_SHORT = (m: string) => (m.length > 22 ? m.slice(0, 20) + '…' : m)

/** Peta drill-down alert → view sumber (klik baris alert di dashboard). */
const ALERT_DRILLDOWN: Record<string, { view: ViewKey; label: string; intent: Omit<NavIntent, 'ts'> }> = {
  'ALT-01': { view: 'field-ops', label: 'Field Ops', intent: { fieldOpsFilter: 'terlambat' } },
  'ALT-02': { view: 'service', label: 'Service Tiket', intent: { serviceStatus: 'REQUEST' } },
  'ALT-03': { view: 'inventory', label: 'Stok Inventory', intent: { inventoryFilter: 'kritis' } },
  'ALT-04': { view: 'claim', label: 'Klaim & Rekap', intent: { klaimTab: 'DRAFT' } },
  'ALT-05': { view: 'service', label: 'Service Tiket', intent: { serviceStatus: 'REQUEST' } },
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

  const { navigateTo } = useAppStore()
  const { toast } = useToast()
  const queryClient = useQueryClient()
  // Alert Engine berupa dropdown — diklik baru muncul
  const [alertOpen, setAlertOpen] = useState(false)

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
      const baris = list.map((t, i) => `${i + 1}. ${t.noTiket} — ${t.model} (${t.toko}) — pending ${t.umurJam >= 24 ? `${Math.floor(t.umurJam / 24)} hari` : `${t.umurJam} jam`} — ${t.adaPart ? 'menunggu READY' : 'belum input part'}`)
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

  if (isLoading || !dash) {
    return (
      <div className="h-[calc(100dvh-9rem)] space-y-4 overflow-y-auto pr-1">
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
  ]

  return (
    <div className="h-[calc(100dvh-9rem)] space-y-4 overflow-y-auto pr-1">
      {/* Panel indikator — ringkas 9 kartu dalam 2 baris agar terpantau di halaman pertama */}
      <KpiGrid items={[...kpiUtama, ...kpiSekunder]} compact />

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
                <p className="text-xs text-slate-400">Isi kolom merk saat registrasi unit.</p>
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
                    <Badge variant="outline" className={cn('text-[9px]', t.umurJam >= 72 ? 'border-rose-300 text-rose-700' : 'border-amber-300 text-amber-700')}>
                      {t.umurJam >= 24 ? `${Math.floor(t.umurJam / 24)} hari` : `${t.umurJam} jam`}
                    </Badge>
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
                      <Badge variant="destructive" className="ml-1">{alerts.total} aktif</Badge>
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
            <ScrollArea className="max-h-96 pr-3">
              <div className="space-y-2">
                {alerts.alerts.map((a, i) => {
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
                      key={i}
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
                    <div key={i} className={baseCls}>{content}</div>
                  )
                })}
              </div>
            </ScrollArea>
          )}
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>
    </div>
  )
}
