'use client'

import { useQuery } from '@tanstack/react-query'
import { fetcher, formatRupiah, type DashboardData, type AlertsResponse } from '@/lib/api'
import { useAppStore, type NavIntent, type ViewKey } from '@/lib/store'
import { cn } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
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
  RefreshCw, TrendingUp, Store, ClipboardList, ArrowUpRight, ChevronRight,
} from 'lucide-react'

const MODEL_SHORT = (m: string) => (m.length > 22 ? m.slice(0, 20) + '…' : m)

/** Peta drill-down alert → view sumber (klik baris alert di dashboard). */
const ALERT_DRILLDOWN: Record<string, { view: ViewKey; label: string; intent: Omit<NavIntent, 'ts'> }> = {
  'ALT-01': { view: 'field-ops', label: 'Field Ops', intent: { fieldOpsFilter: 'terlambat' } },
  'ALT-02': { view: 'service', label: 'Service Tiket', intent: { serviceStatus: 'REQUEST' } },
  'ALT-03': { view: 'inventory', label: 'Stok Konsinyasi', intent: { inventoryFilter: 'kritis' } },
  'ALT-04': { view: 'claim', label: 'Klaim & Rekap', intent: { klaimTab: 'DRAFT' } },
}

function KpiCard({
  title, value, sub, icon: Icon, tone, onClick,
}: {
  title: string; value: string; sub?: string; icon: React.ComponentType<{ className?: string }>; tone: string; onClick?: () => void
}) {
  const clickable = Boolean(onClick)
  return (
    <Card
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      aria-label={clickable ? `Buka data sumber: ${title}` : undefined}
      onClick={clickable ? onClick : undefined}
      onKeyDown={clickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick?.() } } : undefined}
      className={cn(
        'group relative overflow-hidden',
        clickable && 'cursor-pointer transition-all hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500'
      )}
    >
      <div className={`absolute inset-x-0 top-0 h-1 ${tone}`} />
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-slate-500">{title}</CardTitle>
        <Icon className="h-5 w-5 text-slate-400 transition-colors group-hover:text-emerald-500" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold text-slate-900">{value}</div>
        {sub && (
          <p className="mt-1 text-xs text-slate-500">
            {sub}
            {clickable && (
              <span className="ml-1.5 inline-flex translate-y-px items-center gap-0.5 whitespace-nowrap text-[10px] font-semibold text-emerald-600 transition-colors group-hover:text-emerald-700 group-hover:underline">
                Lihat sumber <ArrowUpRight className="h-3 w-3" />
              </span>
            )}
          </p>
        )}
      </CardContent>
    </Card>
  )
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

  const refreshAll = () => {
    refetchDash()
    refetchAlerts()
  }

  if (isLoading || !dash) {
    return (
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-32" />)}
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

  return (
    <div className="space-y-6">
      {/* Baris KPI utama — semuanya bisa diklik menuju data sumber */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard title="Tiket REQUEST" value={String(dash.tiket.request)} sub={`${dash.tiket.slaTerlambat} melewati SLA 24 jam`} icon={FileClock} tone="bg-amber-400" onClick={() => navigateTo('service', { serviceStatus: 'REQUEST' })} />
        <KpiCard title="Tiket PROSES" value={String(dash.tiket.proses)} sub="Sedang dikerjakan di workshop" icon={Loader} tone="bg-violet-400" onClick={() => navigateTo('service', { serviceStatus: 'PROSES' })} />
        <KpiCard title="Tiket FINISH" value={String(dash.tiket.finish)} sub="Siap diklaim ke produsen" icon={CheckCircle2} tone="bg-emerald-400" onClick={() => navigateTo('service', { serviceStatus: 'FINISH' })} />
        <KpiCard title="Klaim Tertahan" value={formatRupiah(dash.klaim.pendingValue)} sub={`${dash.klaim.pendingCount} tiket FINISH status DRAFT (ALT-04)`} icon={Wallet} tone="bg-rose-400" onClick={() => navigateTo('claim', { klaimTab: 'DRAFT' })} />
      </div>

      {/* KPI sekunder — semuanya bisa diklik menuju data sumber */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard title="Stok Kritis (ROP)" value={`${dash.stok.kritis} / ${dash.stok.totalItem}`} sub={`${dash.stok.kosong} part kosong total · nilai stok ${formatRupiah(dash.stok.nilaiTotal)}`} icon={PackageX} tone="bg-amber-400" onClick={() => navigateTo('inventory', { inventoryFilter: 'kritis' })} />
        <KpiCard title="Toko Telat Visit" value={String(dash.operasional.tokoTerlambatVisit)} sub={`dari ${dash.operasional.totalToko} toko terdaftar (ALT-01)`} icon={MapPinOff} tone="bg-rose-400" onClick={() => navigateTo('field-ops', { fieldOpsFilter: 'terlambat' })} />
        <KpiCard title="Kunjungan 7 Hari" value={String(dash.operasional.kunjungan7hari)} sub="Check-in onsite teknisi" icon={Store} tone="bg-emerald-400" onClick={() => navigateTo('field-ops', { fieldOpsFilter: 'kunjungan' })} />
        <KpiCard title="Total Tiket" value={String(dash.tiket.total)} sub={`${dash.klaim.submitted} klaim SUBMITTED menunggu pembayaran`} icon={ClipboardList} tone="bg-teal-400" onClick={() => navigateTo('service', { serviceStatus: 'SEMUA' })} />
      </div>

      {/* Grafik */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
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
          <CardContent className="h-72">
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
            <CardTitle className="text-base">Distribusi Garansi Unit</CardTitle>
            <CardDescription>Klik irisan/legenda untuk membuka tiket per garansi</CardDescription>
          </CardHeader>
          <CardContent className="h-72">
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
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Tren Kerusakan per Model Unit</CardTitle>
          <CardDescription>Model dengan frekuensi kerusakan tertinggi — klik batang untuk membuka tiket model tersebut</CardDescription>
        </CardHeader>
        <CardContent className="h-64">
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

      {/* Alert Engine */}
      <Card>
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
              Aturan otomatis ALT-01 s/d ALT-04 · {alerts ? `evaluasi terakhir ${new Date(alerts.generatedAt).toLocaleTimeString('id-ID')}` : 'memuat…'}
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={refreshAll} disabled={isRefetching || alertRefetching}>
            <RefreshCw className={`mr-2 h-4 w-4 ${(isRefetching || alertRefetching) ? 'animate-spin' : ''}`} />
            Jalankan Cron
          </Button>
        </CardHeader>
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
      </Card>
    </div>
  )
}
