'use client'

import { useEffect, useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetcher, postJson, formatRupiah, formatTanggal, type ServiceTicket } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { useToast } from '@/hooks/use-toast'
import { useAppStore } from '@/lib/store'
import { FileSpreadsheet, Send, DollarSign, FileCheck2, Wallet, CircleCheck, Wand2 } from 'lucide-react'
import SuratJalanDialog from '@/components/surat-jalan-dialog'
import KodeSparepart from '@/components/kode-sparepart'
import QuickSearch, { matchQuery } from '@/components/quick-search'
import { cn } from '@/lib/utils'

const KLAIM_TABS = ['DRAFT', 'SUBMITTED', 'PAID'] as const

const TAB_STYLES: Record<string, string> = {
  DRAFT: 'bg-slate-100 text-slate-700 border-slate-300',
  SUBMITTED: 'bg-amber-100 text-amber-800 border-amber-300',
  PAID: 'bg-emerald-100 text-emerald-800 border-emerald-300',
}

export default function ClaimView() {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const { role, navIntent, clearNavIntent } = useAppStore()
  const [exporting, setExporting] = useState(false)
  // Draft surat jalan terisi otomatis (unit berkode+nama part) — tanpa centang manual
  const [sjTickets, setSjTickets] = useState<ServiceTicket[]>([])
  const [sjOpen, setSjOpen] = useState(false)
  // Tab klaim dikontrol agar bisa diarahkan dari Dashboard (KPI "Klaim Tertahan")
  const [klaimTab, setKlaimTab] = useState<'DRAFT' | 'SUBMITTED' | 'PAID'>('DRAFT')
  const [cariKlaim, setCariKlaim] = useState('')

  // Konsumsi navIntent dari Dashboard → buka tab klaim yang diminta
  // (dijalankan di callback async agar tidak setState sinkron di effect body)
  useEffect(() => {
    if (!navIntent) return
    const t = setTimeout(() => {
      if (navIntent.klaimTab) setKlaimTab(navIntent.klaimTab)
      clearNavIntent()
    }, 0)
    return () => clearTimeout(t)
  }, [navIntent, clearNavIntent])

  const { data: tickets, isLoading } = useQuery<ServiceTicket[]>({
    queryKey: ['service-tickets'],
    queryFn: () => fetcher<ServiceTicket[]>('/api/service'),
  })

  const finishTickets = useMemo(() => (tickets ?? []).filter((t) => t.status === 'FINISH'), [tickets])

  const klaimTampil = useMemo(() => {
    const q = cariKlaim.trim()
    if (!q) return finishTickets
    return finishTickets.filter((t) => matchQuery([
      t.noTiket,
      t.unitAsset.toko?.kodeToko,
      t.unitAsset.toko?.namaToko,
      t.unitAsset.modelUnit,
      t.unitAsset.serialNumber,
      t.unitAsset.customer?.nama,
      t.noSttb,
      t.noSuratJalan,
      ...t.parts.map((p) => `${p.sparepart?.kodePart ?? ''} ${p.sparepart?.namaPart ?? ''}`),
    ], q))
  }, [finishTickets, cariKlaim])

  const totals = useMemo(() => {
    const t = { DRAFT: 0, SUBMITTED: 0, PAID: 0 }
    const v = { DRAFT: 0, SUBMITTED: 0, PAID: 0 }
    for (const tk of finishTickets) {
      t[tk.statusKlaimProdusen]++
      v[tk.statusKlaimProdusen] += tk.nilaiKlaim ?? 0
    }
    return { count: t, value: v }
  }, [finishTickets])

  const aksiMutation = useMutation({
    mutationFn: ({ id, aksi }: { id: number; aksi: string }) =>
      postJson(`/api/service/${id}`, { aksi, aktor: role === 'TEKNISI' ? 'Teknisi Lapangan' : 'Admin Workshop' }, 'PATCH'),
    onSuccess: (_d, vars) => {
      queryClient.invalidateQueries({ queryKey: ['service-tickets'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      queryClient.invalidateQueries({ queryKey: ['alerts'] })
      queryClient.invalidateQueries({ queryKey: ['audit'] })
      toast({
        title: vars.aksi === 'SUBMIT_CLAIM' ? 'Klaim diajukan ke produsen' : 'Klaim ditandai LUNAS',
        description: vars.aksi === 'SUBMIT_CLAIM' ? 'Status klaim: DRAFT → SUBMITTED.' : 'Status klaim: SUBMITTED → PAID.',
      })
    },
    onError: (e: Error) => toast({ title: 'Aksi gagal', description: e.message, variant: 'destructive' }),
  })

  const exportExcel = () => {
    setExporting(true)
    // Trigger download via hidden anchor
    const a = document.createElement('a')
    a.href = '/api/claim/export'
    a.download = ''
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => setExporting(false), 1500)
    toast({ title: 'Export Excel dimulai', description: 'File .xlsx rekap klaim sesuai templat produsen sedang diunduh.' })
  }

  // ===== Draft otomatis: unit yang sudah input kode+nama part & belum terkirim =====
  // langsung terlist di draft surat jalan — tanpa centang satu per satu.
  const adaKodeNama = (t: ServiceTicket) => t.parts.some((p) => p.sparepart?.kodePart && p.sparepart?.namaPart)
  const draftSiap = useMemo(
    () => finishTickets.filter((t) => adaKodeNama(t) && !t.noSuratJalan),
    [finishTickets]
  )
  const draftOtomatis = () => {
    if (draftSiap.length === 0) {
      const tanpaPart = finishTickets.filter((t) => !adaKodeNama(t)).length
      toast({
        title: 'Tidak ada draft baru',
        description: tanpaPart > 0
          ? `${tanpaPart} tiket belum ada kode+nama part; sisanya sudah pernah dikirim.`
          : 'Semua tiket berpart sudah pernah dikirim.',
      })
      return
    }
    setSjTickets(draftSiap)
    setSjOpen(true)
    toast({
      title: 'Draft otomatis terisi',
      description: `${draftSiap.length} tiket (kode+nama part sudah lengkap, belum terkirim) masuk draft surat jalan.`,
    })
  }

  const renderTable = (list: ServiceTicket[], tab: string) => {
    if (isLoading) {
      return <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
    }
    if (list.length === 0) {
      return (
        <div className="flex flex-col items-center gap-2 py-10 text-center">
          <FileCheck2 className="h-8 w-8 text-slate-300" />
          <p className="text-sm text-slate-500">Tidak ada klaim pada status {tab}.</p>
        </div>
      )
    }
    return (
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>No. Tiket</TableHead>
              <TableHead className="hidden md:table-cell">Toko</TableHead>
              <TableHead>Unit</TableHead>
              <TableHead className="hidden sm:table-cell">Nota Stempel</TableHead>
              <TableHead>Rincian</TableHead>
              <TableHead>Total Klaim</TableHead>
              <TableHead className="text-right">Aksi</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.map((t) => (
              <TableRow key={t.id}>
                <TableCell>
                  <p className="font-mono text-xs font-semibold text-slate-800">{t.noTiket}</p>
                  <p className="text-[10px] text-slate-400">Selesai {formatTanggal(t.tglFinish)}</p>
                  {t.hariSejakFinish != null && t.hariSejakFinish > 7 && t.statusKlaimProdusen === 'DRAFT' && (
                    <Badge variant="destructive" className="mt-1 text-[9px]">ALT-04: {t.hariSejakFinish} hari</Badge>
                  )}
                </TableCell>
                <TableCell className="hidden text-xs text-slate-600 md:table-cell">
                  {t.unitAsset.toko?.namaToko}
                  <p className="font-mono text-[10px] text-slate-400">{t.unitAsset.toko?.kodeToko}</p>
                </TableCell>
                <TableCell className="max-w-44">
                  <p className="truncate text-xs text-slate-700">{t.unitAsset.modelUnit}</p>
                  <p className="truncate font-mono text-[10px] text-slate-400">{t.unitAsset.serialNumber}</p>
                </TableCell>
                <TableCell className="hidden sm:table-cell">
                  {t.fotoNotaStempel ? (
                    <Badge variant="outline" className="gap-1 border-emerald-300 text-[10px] text-emerald-700"><CircleCheck className="h-2.5 w-2.5" /> Terverifikasi</Badge>
                  ) : (
                    <Badge variant="outline" className="border-rose-300 text-[10px] text-rose-600">Belum ada</Badge>
                  )}
                </TableCell>
                <TableCell className="text-xs">
                  <p>Jasa: {formatRupiah(t.biayaJasa)}</p>
                  {t.parts.length > 0 && (
                    <p className="flex flex-wrap items-center gap-x-1 text-[10px] text-slate-500">
                      Part:
                      {t.parts.map((p) => (
                        <span key={p.id} className="inline-flex items-center gap-0.5">
                          <KodeSparepart kode={p.sparepart?.kodePart ?? ''} nama={p.sparepart?.namaPart} cek className="text-[10px]" />
                          <span>×{p.qty}</span>
                        </span>
                      ))}
                    </p>
                  )}
                </TableCell>
                <TableCell className="whitespace-nowrap text-sm font-bold text-emerald-700">{formatRupiah(t.nilaiKlaim ?? 0)}</TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1.5">
                    {t.statusKlaimProdusen === 'DRAFT' && (
                      <Button size="sm" className="h-7 bg-amber-600 px-2 text-[11px] hover:bg-amber-700"
                        onClick={() => aksiMutation.mutate({ id: t.id, aksi: 'SUBMIT_CLAIM' })}>
                        <Send className="mr-1 h-3 w-3" /> Ajukan
                      </Button>
                    )}
                    {t.statusKlaimProdusen === 'SUBMITTED' && (
                      <Button size="sm" className="h-7 bg-emerald-700 px-2 text-[11px] hover:bg-emerald-800"
                        onClick={() => aksiMutation.mutate({ id: t.id, aksi: 'MARK_PAID' })}>
                        <DollarSign className="mr-1 h-3 w-3" /> Lunas
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Summary kartu */}
      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-600"><FileCheck2 className="h-5 w-5" /></div>
            <div>
              <p className="text-xs text-slate-500">Klaim DRAFT (belum diajukan)</p>
              <p className="text-lg font-bold text-slate-900">{totals.count.DRAFT} tiket · {formatRupiah(totals.value.DRAFT)}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-100 text-amber-700"><Wallet className="h-5 w-5" /></div>
            <div>
              <p className="text-xs text-slate-500">SUBMITTED (menunggu bayar)</p>
              <p className="text-lg font-bold text-amber-700">{totals.count.SUBMITTED} tiket · {formatRupiah(totals.value.SUBMITTED)}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 text-emerald-700"><DollarSign className="h-5 w-5" /></div>
            <div>
              <p className="text-xs text-slate-500">PAID (diterima dari produsen)</p>
              <p className="text-lg font-bold text-emerald-700">{totals.count.PAID} tiket · {formatRupiah(totals.value.PAID)}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Toolbar export */}
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-base">Rekap Klaim Bulanan — Produsen</CardTitle>
            <CardDescription>
              Modul 4 PRD: verifikasi tiket FINISH berbukti stempel, lalu ekspor batch ke Excel (.xlsx) sesuai templat produsen.
              Draft surat jalan terisi otomatis dari unit yang kode+nama part-nya sudah lengkap.
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              className="border-violet-600 text-violet-700 hover:bg-violet-50"
              onClick={draftOtomatis}
              disabled={draftSiap.length === 0}
              title="Otomatis: tiket yang kode+nama part-nya sudah lengkap & belum terkirim langsung masuk draft"
            >
              <Wand2 className="mr-2 h-4 w-4" />
              Draft Surat Jalan ({draftSiap.length})
            </Button>
            <Button className="bg-emerald-700 hover:bg-emerald-800" onClick={exportExcel} disabled={exporting}>
              <FileSpreadsheet className="mr-2 h-4 w-4" />
              Export Excel (.xlsx)
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="mb-3">
            <QuickSearch
              value={cariKlaim}
              onChange={setCariKlaim}
              placeholder="Cari tiket / toko / unit / part…"
              className="max-w-sm"
              resultCount={klaimTampil.length}
            />
          </div>
          <Tabs value={klaimTab} onValueChange={(v) => setKlaimTab(v as 'DRAFT' | 'SUBMITTED' | 'PAID')}>
            <TabsList>
              {KLAIM_TABS.map((t) => (
                <TabsTrigger key={t} value={t} className={cn('data-[state=active]:bg-white')}>
                  {t} ({totals.count[t]})
                </TabsTrigger>
              ))}
            </TabsList>
            {KLAIM_TABS.map((t) => (
              <TabsContent key={t} value={t}>
                <div className="mb-3 flex items-center gap-2">
                  <Badge variant="outline" className={TAB_STYLES[t]}>{t}</Badge>
                  <span className="text-xs text-slate-500">
                    Total nilai: <span className="font-bold text-slate-700">{formatRupiah(totals.value[t])}</span>
                  </span>
                </div>
                {renderTable(klaimTampil.filter((tk) => tk.statusKlaimProdusen === t), t)}
              </TabsContent>
            ))}
          </Tabs>
        </CardContent>
      </Card>

      <SuratJalanDialog open={sjOpen} onOpenChange={setSjOpen} tickets={sjTickets} />
    </div>
  )
}
