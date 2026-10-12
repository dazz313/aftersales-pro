'use client'

import { useEffect, useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetcher, postJson, formatRupiah, type Sparepart } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Progress } from '@/components/ui/progress'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useToast } from '@/hooks/use-toast'
import { useAppStore } from '@/lib/store'
import CsvImportDialog from '@/components/csv-import-dialog'
import { Package, PackagePlus, PackageX, TriangleAlert, ShoppingCart, Boxes, Plus, Send, Upload, X, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

export default function InventoryView() {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const { role, navIntent, clearNavIntent } = useAppStore()
  const [restockTarget, setRestockTarget] = useState<Sparepart | null>(null)
  const [restockQty, setRestockQty] = useState('10')
  const [roFormOpen, setRoFormOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  // Filter drill-down dari Dashboard (KPI "Stok Kritis (ROP)")
  const [stokFilter, setStokFilter] = useState<'SEMUA' | 'KRITIS' | 'KOSONG'>('SEMUA')
  const [cari, setCari] = useState('')
  const [restockJenis, setRestockJenis] = useState<'JUAL' | 'GARANSI'>('JUAL')

  // Konsumsi navIntent dari Dashboard → terapkan filter stok
  // (dijalankan di callback async agar tidak setState sinkron di effect body)
  useEffect(() => {
    if (!navIntent) return
    const t = setTimeout(() => {
      if (navIntent.inventoryFilter === 'kritis') setStokFilter('KRITIS')
      if (navIntent.inventoryFilter === 'kosong') setStokFilter('KOSONG')
      clearNavIntent()
    }, 0)
    return () => clearTimeout(t)
  }, [navIntent, clearNavIntent])

  const { data: parts, isLoading } = useQuery<Sparepart[]>({
    queryKey: ['spareparts'],
    queryFn: () => fetcher<Sparepart[]>('/api/sparepart'),
  })

  const restockMutation = useMutation({
    mutationFn: ({ id, qty, jenis }: { id: number; qty: number; jenis: 'JUAL' | 'GARANSI' }) =>
      postJson(`/api/sparepart/${id}`, jenis === 'GARANSI' ? { tambahStokGaransi: qty, aktor: role } : { tambahStok: qty, aktor: role }, 'PATCH'),
    onSuccess: (_d, v) => {
      queryClient.invalidateQueries({ queryKey: ['spareparts'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      queryClient.invalidateQueries({ queryKey: ['alerts'] })
      queryClient.invalidateQueries({ queryKey: ['audit'] })
      setRestockTarget(null)
      toast({ title: 'Restock dicatat', description: `Stok ${v.jenis === 'GARANSI' ? 'garansi' : 'bisa jual'} bertambah ${v.qty} unit (kiriman dari produsen).` })
    },
    onError: (e: Error) => toast({ title: 'Restock gagal', description: e.message, variant: 'destructive' }),
  })

  const [newPart, setNewPart] = useState({ kodePart: '', namaPart: '', brandKompatibel: '', supplier: '', stokJual: '0', stokGaransi: '0', reorderLimit: '5', hargaKlaim: '0' })
  const addMutation = useMutation({
    mutationFn: () =>
      postJson('/api/sparepart', {
        ...newPart,
        stokJual: Number(newPart.stokJual),
        stokGaransi: Number(newPart.stokGaransi),
        reorderLimit: Number(newPart.reorderLimit),
        hargaKlaim: Number(newPart.hargaKlaim),
        aktor: role,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['spareparts'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      setAddOpen(false)
      setNewPart({ kodePart: '', namaPart: '', brandKompatibel: '', supplier: '', stokJual: '0', stokGaransi: '0', reorderLimit: '5', hargaKlaim: '0' })
      toast({ title: 'Sparepart terdaftar', description: 'Item baru masuk katalog inventory.' })
    },
    onError: (e: Error) => toast({ title: 'Gagal menambah sparepart', description: e.message, variant: 'destructive' }),
  })

  const kritis = (parts ?? []).filter((p) => p.ropAlert)
  const kosong = (parts ?? []).filter((p) => p.kosong)
  const tampilParts = useMemo(() => {
    let list = parts ?? []
    if (stokFilter === 'KRITIS') list = list.filter((p) => p.ropAlert)
    if (stokFilter === 'KOSONG') list = list.filter((p) => p.kosong)
    const q = cari.trim().toLowerCase()
    if (q) {
      list = list.filter((p) =>
        [p.kodePart, p.namaPart, p.brandKompatibel ?? '', p.supplier ?? '']
          .join(' ')
          .toLowerCase()
          .includes(q)
      )
    }
    return list
  }, [parts, stokFilter, cari])
  const nilaiTotal = (parts ?? []).reduce((a, p) => a + p.stokInventory * p.hargaKlaim, 0)
  const reorderDraft = kritis.map((p) => ({
    kodePart: p.kodePart,
    namaPart: p.namaPart,
    stok: p.stokInventory,
    limit: p.reorderLimit,
    usulanQty: Math.max(p.reorderLimit * 2 - p.stokInventory, 5),
    nilai: Math.max(p.reorderLimit * 2 - p.stokInventory, 5) * p.hargaKlaim,
  }))
  // Draft re-order disembunyikan dalam dropdown agar halaman tidak kepanjangan
  const [roOpen, setRoOpen] = useState(true)

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-teal-100 text-teal-700"><Boxes className="h-5 w-5" /></div>
            <div>
              <p className="text-xs text-slate-500">Item Katalog</p>
              <p className="text-xl font-bold text-slate-900">{parts?.length ?? '—'}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-100 text-amber-700"><TriangleAlert className="h-5 w-5" /></div>
            <div>
              <p className="text-xs text-slate-500">Di Bawah ROP</p>
              <p className="text-xl font-bold text-amber-700">{kritis.length}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-rose-100 text-rose-700"><PackageX className="h-5 w-5" /></div>
            <div>
              <p className="text-xs text-slate-500">Stok Kosong</p>
              <p className="text-xl font-bold text-rose-700">{kosong.length}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 text-emerald-700"><Package className="h-5 w-5" /></div>
            <div>
              <p className="text-xs text-slate-500">Nilai Stok Titipan</p>
              <p className="text-lg font-bold text-slate-900">{formatRupiah(nilaiTotal)}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Tabel stok */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle className="text-base">Stok Sparepart Inventory</CardTitle>
              <CardDescription>5 komponen: kode · nama · brand kompatibel · stok jual/garansi · supplier — reserve otomatis saat tiket dibuat · {tampilParts.length} item</CardDescription>
            </div>
            <div className="flex shrink-0 flex-wrap justify-end gap-2">
              <Button size="sm" variant="outline" onClick={() => setImportOpen(true)}>
                <Upload className="mr-1 h-4 w-4" /> Import CSV
              </Button>
              <Button size="sm" variant="outline" onClick={() => setAddOpen(true)}>
                <Plus className="mr-1 h-4 w-4" /> Item Baru
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Input
                value={cari}
                onChange={(e) => setCari(e.target.value)}
                placeholder="Cari kode / nama / brand / supplier…"
                className="h-8 max-w-xs text-xs"
                aria-label="Cari sparepart"
              />
            </div>
            {stokFilter !== 'SEMUA' && (
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <span className="text-xs text-slate-500">Filter dari Dashboard:</span>
                <Badge variant="outline" className="gap-1 border-amber-300 bg-amber-50 text-amber-800">
                  {stokFilter === 'KRITIS' ? 'Di Bawah ROP (Kritis)' : 'Stok Kosong'} · {tampilParts.length} item
                  <button
                    type="button"
                    aria-label="Hapus filter stok, tampilkan semua"
                    onClick={() => setStokFilter('SEMUA')}
                    className="ml-0.5 rounded-full p-0.5 hover:bg-amber-100"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              </div>
            )}
            {isLoading ? (
              <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
            ) : (
              <div className="max-h-[60vh] overflow-auto rounded-md border [&_thead]:sticky [&_thead]:top-0 [&_thead]:z-10 [&_thead]:bg-white [&_thead]:shadow-[0_1px_0_rgb(0_0_0/0.08)]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Kode Sparepart</TableHead>
                      <TableHead>Nama Sparepart</TableHead>
                      <TableHead className="hidden md:table-cell">Brand Kompatibel</TableHead>
                      <TableHead className="hidden md:table-cell">Supplier</TableHead>
                      <TableHead>Jual / Garansi (Total)</TableHead>
                      <TableHead className="hidden sm:table-cell">Nilai Klaim/unit</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Aksi</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {tampilParts.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={8} className="py-8 text-center text-sm text-slate-500">
                          Tidak ada item yang cocok dengan filter aktif.
                        </TableCell>
                      </TableRow>
                    ) : tampilParts.map((p) => {
                      const pct = Math.min((p.stokInventory / Math.max(p.reorderLimit * 3, 1)) * 100, 100)
                      return (
                        <TableRow key={p.id} className={cn(p.kosong && 'bg-rose-50/60', p.ropAlert && !p.kosong && 'bg-amber-50/50')}>
                          <TableCell>
                            <p className="font-mono text-[11px] font-semibold text-slate-800">{p.kodePart}</p>
                          </TableCell>
                          <TableCell>
                            <p className="text-xs font-semibold text-slate-800">{p.namaPart}</p>
                          </TableCell>
                          <TableCell className="hidden max-w-36 truncate text-xs text-slate-600 md:table-cell" title={p.brandKompatibel || ''}>
                            {p.brandKompatibel?.trim() || '—'}
                          </TableCell>
                          <TableCell className="hidden max-w-36 truncate text-xs text-slate-600 md:table-cell" title={p.supplier || ''}>
                            {p.supplier?.trim() || '—'}
                          </TableCell>
                          <TableCell className="w-44">
                            <div className="flex items-baseline gap-1">
                              <span className={cn('text-lg font-bold', p.kosong ? 'text-rose-600' : p.ropAlert ? 'text-amber-600' : 'text-slate-800')}>{p.stokJual}/{p.stokGaransi}</span>
                              <span className="text-[10px] text-slate-400">({p.stokInventory} total / ROP {p.reorderLimit})</span>
                            </div>
                            <Progress value={pct} className="mt-1 h-1.5" aria-label={`Stok ${p.stokInventory} dari limit ${p.reorderLimit}`} />
                          </TableCell>
                          <TableCell className="hidden text-xs text-slate-600 sm:table-cell">{formatRupiah(p.hargaKlaim)}</TableCell>
                          <TableCell>
                            {p.kosong ? (
                              <Badge variant="destructive" className="gap-1 text-[10px]"><PackageX className="h-2.5 w-2.5" /> KOSONG</Badge>
                            ) : p.ropAlert ? (
                              <Badge className="gap-1 bg-amber-100 text-[10px] text-amber-800 hover:bg-amber-100"><TriangleAlert className="h-2.5 w-2.5" /> ROP</Badge>
                            ) : (
                              <Badge variant="outline" className="border-emerald-300 text-[10px] text-emerald-700">AMAN</Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" onClick={() => { setRestockTarget(p); setRestockJenis('JUAL'); setRestockQty(String(Math.max(p.reorderLimit * 2, 5))) }}>
                              <PackagePlus className="mr-1 h-3 w-3" /> Restock
                            </Button>
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

        {/* Draft Re-Order (ALT-03) — dropdown agar halaman tidak kepanjangan */}
        <Collapsible open={roOpen} onOpenChange={setRoOpen}>
          <Card>
            <CollapsibleTrigger asChild>
              <div className="cursor-pointer select-none" role="button" tabIndex={0} aria-expanded={roOpen} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setRoOpen(!roOpen) } }}>
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <ShoppingCart className="h-4 w-4 text-amber-600" /> Draft Re-Order Sparepart
                      {reorderDraft.length > 0 && <Badge className="bg-amber-500 text-[10px] text-white hover:bg-amber-500">{reorderDraft.length} item</Badge>}
                    </CardTitle>
                    <CardDescription>ALT-03 — auto-generated dari item di bawah reorder point · klik untuk buka/tutup</CardDescription>
                  </div>
                  <ChevronDown className={cn('h-4 w-4 shrink-0 text-slate-400 transition-transform', roOpen && 'rotate-180')} />
                </div>
              </CardHeader>
              </div>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CardContent className="space-y-2">
                {reorderDraft.length === 0 ? (
                  <p className="rounded-lg border border-dashed p-6 text-center text-xs text-slate-500">Semua stok aman. Tidak ada draft re-order.</p>
                ) : (
                  <>
                    {reorderDraft.map((r, i) => (
                      <div key={i} className="rounded-lg border border-amber-200 bg-amber-50/60 p-3">
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-xs font-semibold text-slate-800">{r.namaPart}</p>
                            <p className="font-mono text-[10px] text-slate-500">{r.kodePart} · stok {r.stok} / limit {r.limit}</p>
                          </div>
                          <Badge className="shrink-0 bg-amber-500 text-[10px] text-white hover:bg-amber-500">+{r.usulanQty} pcs</Badge>
                        </div>
                        <p className="mt-1 text-[10px] text-slate-500">Estimasi nilai reorder: <span className="font-semibold">{formatRupiah(r.nilai)}</span></p>
                      </div>
                    ))}
                    <Button className="w-full bg-amber-600 hover:bg-amber-700" onClick={() => setRoFormOpen(true)}>
                      <PackagePlus className="mr-1.5 h-4 w-4" /> Kirim Permintaan ke Produsen
                    </Button>
                  </>
                )}
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>
      </div>

      {/* Dialog restock */}
      <Dialog open={!!restockTarget} onOpenChange={(o) => !o && setRestockTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          {restockTarget && (
            <>
              <DialogHeader>
                <DialogTitle>Restock {restockTarget.kodePart}</DialogTitle>
                <DialogDescription>Catat kiriman sparepart dari produsen masuk gudang inventory.</DialogDescription>
              </DialogHeader>
              <div className="space-y-2">
                <p className="text-sm text-slate-700">{restockTarget.namaPart}</p>
                <p className="text-xs text-slate-500">Jual: <span className="font-bold text-slate-800">{restockTarget.stokJual}</span> · Garansi: <span className="font-bold text-slate-800">{restockTarget.stokGaransi}</span> · Total: <span className="font-bold text-slate-800">{restockTarget.stokInventory}</span> · ROP: {restockTarget.reorderLimit}</p>
                <div className="space-y-1.5">
                  <Label>Jenis stok masuk</Label>
                  <div className="flex gap-2">
                    <Button type="button" size="sm" variant={restockJenis === 'JUAL' ? 'default' : 'outline'} className={restockJenis === 'JUAL' ? 'bg-emerald-600 hover:bg-emerald-700' : ''} onClick={() => setRestockJenis('JUAL')}>Bisa Jual</Button>
                    <Button type="button" size="sm" variant={restockJenis === 'GARANSI' ? 'default' : 'outline'} className={restockJenis === 'GARANSI' ? 'bg-amber-600 hover:bg-amber-700' : ''} onClick={() => setRestockJenis('GARANSI')}>Stok Garansi</Button>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Jumlah kiriman (pcs)</Label>
                  <Input type="number" min="1" value={restockQty} onChange={(e) => setRestockQty(e.target.value)} />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setRestockTarget(null)}>Batal</Button>
                <Button className="bg-emerald-600 hover:bg-emerald-700" disabled={Number(restockQty) <= 0 || restockMutation.isPending} onClick={() => restockMutation.mutate({ id: restockTarget.id, qty: Number(restockQty), jenis: restockJenis })}>
                  <PackagePlus className="mr-1 h-4 w-4" /> Simpan Restock
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Dialog item baru */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Tambah Sparepart Inventory</DialogTitle>
            <DialogDescription>Daftarkan item baru ke katalog stok titipan produsen.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Kode Sparepart</Label>
              <Input value={newPart.kodePart} onChange={(e) => setNewPart({ ...newPart, kodePart: e.target.value.toUpperCase() })} placeholder="PRT-XXX-00" className="font-mono" />
            </div>
            <div className="space-y-1.5">
              <Label>Nama Sparepart</Label>
              <Input value={newPart.namaPart} onChange={(e) => setNewPart({ ...newPart, namaPart: e.target.value })} placeholder="cth: Kompresor 3/4 PK" />
            </div>
            <div className="space-y-1.5">
              <Label>Brand Kompatibel</Label>
              <Input value={newPart.brandKompatibel} onChange={(e) => setNewPart({ ...newPart, brandKompatibel: e.target.value })} placeholder="cth: Samsung, LG" />
            </div>
            <div className="space-y-1.5">
              <Label>Supplier</Label>
              <Input value={newPart.supplier} onChange={(e) => setNewPart({ ...newPart, supplier: e.target.value })} placeholder="cth: PT Sinar Elektronik" />
            </div>
            <div className="space-y-1.5">
              <Label>Stok Bisa Jual</Label>
              <Input type="number" min="0" value={newPart.stokJual} onChange={(e) => setNewPart({ ...newPart, stokJual: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Stok Garansi</Label>
              <Input type="number" min="0" value={newPart.stokGaransi} onChange={(e) => setNewPart({ ...newPart, stokGaransi: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Reorder Limit (ROP)</Label>
              <Input type="number" value={newPart.reorderLimit} onChange={(e) => setNewPart({ ...newPart, reorderLimit: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Harga Klaim per Unit (Rp)</Label>
              <Input type="number" value={newPart.hargaKlaim} onChange={(e) => setNewPart({ ...newPart, hargaKlaim: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Batal</Button>
            <Button className="bg-emerald-600 hover:bg-emerald-700" disabled={!newPart.kodePart || !newPart.namaPart || addMutation.isPending} onClick={() => addMutation.mutate()}>
              <Plus className="mr-1 h-4 w-4" /> Daftarkan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog import massal sparepart via CSV */}
      <CsvImportDialog
        kind="sparepart"
        open={importOpen}
        onOpenChange={setImportOpen}
        existingCodes={(parts ?? []).map((p) => p.kodePart)}
        onSuccess={(r) => {
          queryClient.invalidateQueries({ queryKey: ['spareparts'] })
          queryClient.invalidateQueries({ queryKey: ['dashboard'] })
          queryClient.invalidateQueries({ queryKey: ['alerts'] })
          queryClient.invalidateQueries({ queryKey: ['audit'] })
          toast({
            title: 'Import sparepart selesai',
            description: `${r.inserted} item ditambahkan, ${r.updated} diperbarui, ${r.skipped} dilewati, ${r.failed} gagal.`,
          })
        }}
      />

      {/* Dialog kirim reorder */}
      <Dialog open={roFormOpen} onOpenChange={setRoFormOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Permintaan Re-Order ke Produsen</DialogTitle>
            <DialogDescription>Formulir ini otomatis digenerate oleh Alert Engine ALT-03 dan dikirim ke kontak produsen.</DialogDescription>
          </DialogHeader>
          <div className="rounded-lg bg-emerald-50 p-3 text-xs text-emerald-900">
            <p className="mb-1 font-semibold">To: PT. Sinar Elektronik Mandiri (Produsen)</p>
            <p>Permohonan pengiriman sparepart inventory untuk {reorderDraft.length} item, total estimasi nilai {formatRupiah(reorderDraft.reduce((a, r) => a + r.nilai, 0))}. Rincian: {reorderDraft.map((r) => `${r.kodePart} (+${r.usulanQty})`).join(', ')}.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRoFormOpen(false)}>Tutup</Button>
            <Button className="bg-amber-600 hover:bg-amber-700" onClick={() => { setRoFormOpen(false); toast({ title: 'Permintaan terkirim (simulasi)', description: 'Notifikasi re-order dikirim ke produsen via WhatsApp.' }) }}>
              <Send className="mr-1 h-4 w-4" /> Kirim via WhatsApp
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
