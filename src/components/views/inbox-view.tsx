'use client'

import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchInbox, prosesInbox, inboxFileUrl, fetcher, formatWaktu, type InboxItem } from '@/lib/api'
import type { Toko, Pengguna } from '@/lib/types'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/hooks/use-toast'
import { Inbox, MapPin, Wrench, Archive, XCircle, ArrowRightLeft, Barcode, ScanText, User } from 'lucide-react'
import { cn } from '@/lib/utils'

type Folder = 'KUNJUNGAN' | 'SERVICE'

function StatusBadge({ item }: { item: InboxItem }) {
  if (item.status === 'PENDING') return <Badge className="bg-amber-500 text-white">PENDING</Badge>
  if (item.status === 'APPROVED') return <Badge className="bg-emerald-600 text-white">SETUJU → {item.tujuan} {item.hasilRef ? `· ${item.hasilRef}` : ''}</Badge>
  if (item.status === 'REJECTED') return <Badge variant="outline" className="border-rose-300 text-rose-600">DITOLAK</Badge>
  return <Badge variant="outline" className="text-slate-500">ARSIP</Badge>
}

export default function InboxView() {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [folder, setFolder] = useState<Folder>('KUNJUNGAN')
  const [tab, setTab] = useState<'PENDING' | 'SEMUA'>('PENDING')
  const [expand, setExpand] = useState<number | null>(null)
  const [teks, setTeks] = useState<Record<number, string>>({})
  const [tokoId, setTokoId] = useState<Record<number, string>>({})
  const [teknisiId, setTeknisiId] = useState<Record<number, string>>({})
  const [alasan, setAlasan] = useState<Record<number, string>>({})

  const { data, isLoading } = useQuery({
    queryKey: ['inbox', folder, tab],
    queryFn: () => fetchInbox(tab === 'SEMUA' ? undefined : 'PENDING', folder),
    refetchInterval: 30_000,
  })
  const { data: tokoList } = useQuery<Toko[]>({ queryKey: ['toko'], queryFn: () => fetcher<Toko[]>('/api/toko') })
  const { data: teknisiList } = useQuery<Pengguna[]>({ queryKey: ['pengguna'], queryFn: () => fetcher<Pengguna[]>('/api/pengguna') })
  const teknisiOnly = useMemo(() => (teknisiList ?? []).filter((t) => t.role === 'TEKNISI'), [teknisiList])

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['inbox'] })
    queryClient.invalidateQueries({ queryKey: ['inbox-pending-count'] })
    queryClient.invalidateQueries({ queryKey: ['service-tickets'] })
    queryClient.invalidateQueries({ queryKey: ['kunjungan'] })
    queryClient.invalidateQueries({ queryKey: ['toko'] })
    queryClient.invalidateQueries({ queryKey: ['wa-messages'] })
  }

  const mut = useMutation({
    mutationFn: prosesInbox,
    onSuccess: (res, vars) => {
      invalidate()
      toast({ title: 'Inbox diproses', description: `Aksi ${String(vars.aksi)} pada #${String(vars.id)} berhasil.` })
    },
    onError: (e: Error) => toast({ title: 'Gagal memproses', description: e.message, variant: 'destructive' }),
  })

  const defaultTeks = (it: InboxItem) => teks[it.id] ?? [it.caption, it.barcode, it.ocrText].find((s) => s && /#LAPOR/i.test(s)) ?? it.caption ?? it.barcode ?? it.ocrText ?? ''
  const tokoOtomatis = (it: InboxItem) => it.hasilRef?.startsWith('TOKO:')
    ? (tokoList ?? []).find((t) => t.kodeToko === it.hasilRef!.slice(5))?.id
    : undefined

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Inbox className="h-4 w-4 text-sky-600" /> Inbox Penampungan Telegram
          </CardTitle>
          <CardDescription>
            Data/foto dari grup Telegram ditahan di sini sebelum diteruskan.
            Folder <span className="font-semibold">Kunjungan</span> → konfirmasi kunjungan toko.
            Folder <span className="font-semibold">Service</span> → tiket service otomatis.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Tabs value={folder} onValueChange={(v) => setFolder(v as Folder)}>
            <TabsList>
              <TabsTrigger value="KUNJUNGAN" className="gap-1.5 text-xs"><MapPin className="h-3.5 w-3.5" /> Kunjungan</TabsTrigger>
              <TabsTrigger value="SERVICE" className="gap-1.5 text-xs"><Wrench className="h-3.5 w-3.5" /> Service</TabsTrigger>
            </TabsList>
          </Tabs>
          <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
            <TabsList>
              <TabsTrigger value="PENDING" className="text-xs">Pending{data && data.pending > 0 ? ` (${data.pending})` : ''}</TabsTrigger>
              <TabsTrigger value="SEMUA" className="text-xs">Semua</TabsTrigger>
            </TabsList>
          </Tabs>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-40" />)}</div>
      ) : (data?.items ?? []).length === 0 ? (
        <Card><CardContent className="py-10 text-center text-sm text-slate-500">Tidak ada item. Inbox kosong — semua data Telegram sudah terkontrol.</CardContent></Card>
      ) : (
        <div className="grid gap-3 xl:grid-cols-2">
          {(data?.items ?? []).map((it) => {
            const url = inboxFileUrl(it)
            const open = expand === it.id
            const pending = it.status === 'PENDING'
            return (
              <Card key={it.id} className={cn(pending && 'border-amber-300')}>
                <CardContent className="space-y-3 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-800">
                        <User className="h-3 w-3 text-slate-400" /> {it.pengirim}
                        <span className="font-normal text-slate-400">{formatWaktu(it.createdAt)}</span>
                      </p>
                      <p className="mt-0.5 truncate font-mono text-[10px] text-slate-400">#{it.id} · {it.fileName ?? 'teks saja'} · {it.filePath}</p>
                    </div>
                    <StatusBadge item={it} />
                  </div>

                  <div className="flex gap-3">
                    {url ? (
                      <img src={url} alt={`Lampiran inbox ${it.id}`} className="h-28 w-28 shrink-0 rounded-lg border object-cover" />
                    ) : (
                      <div className="flex h-28 w-28 shrink-0 items-center justify-center rounded-lg border border-dashed text-[10px] text-slate-400">tanpa foto</div>
                    )}
                    <div className="min-w-0 flex-1 space-y-1.5 text-xs">
                      {it.caption && <p className="line-clamp-2 text-slate-700"><span className="font-semibold">Caption:</span> {it.caption}</p>}
                      {it.barcode ? (
                        <p className="flex items-start gap-1 font-mono text-[11px] text-slate-800"><Barcode className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" /> {it.barcode}{it.barcodeFormat ? ` (${it.barcodeFormat})` : ''}</p>
                      ) : (
                        <p className="text-[11px] text-slate-400">Barcode: tidak terdeteksi</p>
                      )}
                      {it.ocrText ? (
                        <p className="flex items-start gap-1 text-[11px] text-slate-600"><ScanText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sky-600" /> <span className="line-clamp-3 whitespace-pre-wrap">{it.ocrText}</span></p>
                      ) : (
                        <p className="text-[11px] text-slate-400">Teks OCR: tidak terbaca</p>
                      )}
                      {it.hasilRef?.startsWith('TOKO:') && <Badge variant="outline" className="border-emerald-300 text-[10px] text-emerald-700">Toko terdeteksi: {it.hasilRef.slice(5)}</Badge>}
                      {it.status === 'REJECTED' && it.alasanTolak && <p className="text-[11px] text-rose-600">Alasan tolak: {it.alasanTolak}</p>}
                      {it.direviewOleh && <p className="text-[10px] text-slate-400">Direview {it.direviewOleh} · {formatWaktu(it.direviewAt)}</p>}
                    </div>
                  </div>

                  {pending && (
                    <>
                      <Button size="sm" variant="outline" className="w-full" onClick={() => setExpand(open ? null : it.id)}>
                        {open ? 'Tutup panel aksi' : 'Review & proses'}
                      </Button>
                      {open && (
                        <div className="space-y-3 rounded-lg border bg-slate-50 p-3">
                          {folder === 'SERVICE' ? (
                            <div className="space-y-1.5">
                              <Label className="text-xs">Teks laporan #LAPOR (bisa diedit)</Label>
                              <Textarea rows={3} value={defaultTeks(it)} onChange={(e) => setTeks({ ...teks, [it.id]: e.target.value })} className="font-mono text-xs" />
                              <Button size="sm" className="w-full bg-emerald-600 hover:bg-emerald-700" disabled={mut.isPending}
                                onClick={() => mut.mutate({ aksi: 'APPROVE_SERVICE', id: it.id, teksTerusan: defaultTeks(it) })}>
                                <Wrench className="mr-1 h-3.5 w-3.5" /> Setujui → Buat Tiket Service
                              </Button>
                            </div>
                          ) : (
                            <div className="grid gap-2 sm:grid-cols-2">
                              <div className="space-y-1.5">
                                <Label className="text-xs">Toko</Label>
                                <Select value={tokoId[it.id] ?? String(tokoOtomatis(it) ?? '')} onValueChange={(v) => setTokoId({ ...tokoId, [it.id]: v })}>
                                  <SelectTrigger><SelectValue placeholder="— Pilih toko —" /></SelectTrigger>
                                  <SelectContent>{(tokoList ?? []).map((t) => <SelectItem key={t.id} value={String(t.id)}>{t.namaToko} ({t.kodeToko})</SelectItem>)}</SelectContent>
                                </Select>
                              </div>
                              <div className="space-y-1.5">
                                <Label className="text-xs">Teknisi</Label>
                                <Select value={teknisiId[it.id] ?? ''} onValueChange={(v) => setTeknisiId({ ...teknisiId, [it.id]: v })}>
                                  <SelectTrigger><SelectValue placeholder="— Pilih —" /></SelectTrigger>
                                  <SelectContent>{teknisiOnly.map((t) => <SelectItem key={t.id} value={String(t.id)}>{t.nama}</SelectItem>)}</SelectContent>
                                </Select>
                              </div>
                              <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 sm:col-span-2" disabled={mut.isPending}
                                onClick={() => mut.mutate({ aksi: 'APPROVE_KUNJUNGAN', id: it.id, tokoId: Number(tokoId[it.id] ?? tokoOtomatis(it)), teknisiId: Number(teknisiId[it.id]), catatan: it.caption })}>
                                <MapPin className="mr-1 h-3.5 w-3.5" /> Konfirmasi Kunjungan
                              </Button>
                            </div>
                          )}
                          <div className="flex gap-2">
                            <Button size="sm" variant="outline" className="flex-1" disabled={mut.isPending}
                              onClick={() => mut.mutate({ aksi: 'PINDAH', id: it.id, folder: folder === 'KUNJUNGAN' ? 'SERVICE' : 'KUNJUNGAN' })}>
                              <ArrowRightLeft className="mr-1 h-3.5 w-3.5" /> Pindah ke {folder === 'KUNJUNGAN' ? 'Service' : 'Kunjungan'}
                            </Button>
                            {folder === 'SERVICE' && (
                              <Button size="sm" variant="outline" className="flex-1" disabled={mut.isPending}
                                onClick={() => mut.mutate({ aksi: 'ARSIP', id: it.id })}>
                                <Archive className="mr-1 h-3.5 w-3.5" /> Arsipkan
                              </Button>
                            )}
                          </div>
                          <div className="flex gap-2">
                            <Input value={alasan[it.id] ?? ''} onChange={(e) => setAlasan({ ...alasan, [it.id]: e.target.value })} placeholder="Alasan penolakan…" className="text-xs" />
                            <Button size="sm" variant="outline" className="shrink-0 border-rose-300 text-rose-600 hover:bg-rose-50" disabled={mut.isPending}
                              onClick={() => mut.mutate({ aksi: 'TOLAK', id: it.id, alasan: alasan[it.id] || 'Ditolak admin' })}>
                              <XCircle className="mr-1 h-3.5 w-3.5" /> Tolak
                            </Button>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
