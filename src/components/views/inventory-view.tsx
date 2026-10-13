'use client'

import { useEffect, useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetcher, postJson, formatRupiah, type Sparepart, type Toko, type Customer, type PermintaanOrder } from '@/lib/api'
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
import QuickSearch, { matchQuery } from '@/components/quick-search'
import SearchSelect from '@/components/search-select'
import HistoryInput from '@/components/history-input'
import { Package, PackagePlus, PackageX, TriangleAlert, ShoppingCart, Boxes, Plus, Send, Upload, X, ChevronDown, Pencil, Trash2, ClipboardList, Truck } from 'lucide-react'
import { cn } from '@/lib/utils'

export default function InventoryView() {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const { role, navIntent, clearNavIntent } = useAppStore()
  const [restockTarget, setRestockTarget] = useState<Sparepart | null>(null)
  const [restockQty, setRestockQty] = useState('10')
  const [editTarget, setEditTarget] = useState<Sparepart | null>(null)
  const [editForm, setEditForm] = useState({ namaPart: '', brandKompatibel: '', supplier: '', stokJual: '0', stokGaransi: '0', reorderLimit: '5', hargaKlaim: '0' })
  const [deleteTarget, setDeleteTarget] = useState<Sparepart | null>(null)
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
  const { data: orders } = useQuery<PermintaanOrder[]>({
    queryKey: ['orders'],
    queryFn: () => fetcher<PermintaanOrder[]>('/api/order'),
  })
  const { data: tokoList } = useQuery<Toko[]>({
    queryKey: ['toko'],
    queryFn: () => fetcher<Toko[]>('/api/toko'),
  })
  const { data: customerList } = useQuery<Customer[]>({
    queryKey: ['customers'],
    queryFn: () => fetcher<Customer[]>('/api/customer'),
  })

  // Form order customer
  const [orderOpen, setOrderOpen] = useState(false)
  const [cariOrder, setCariOrder] = useState('')
  const [orderForm, setOrderForm] = useState({ tipe: 'TOKO' as 'TOKO' | 'PERORANGAN', pemilikId: '', namaPemesan: '', sparepartId: '', qty: '1', catatan: '' })
  const openOrder = (sparepartId?: number) => {
    setOrderForm({ tipe: 'TOKO', pemilikId: '', namaPemesan: '', sparepartId: sparepartId ? String(sparepartId) : '', qty: '1', catatan: '' })
    setOrderOpen(true)
  }

  const invalidateOrder = () => {
    queryClient.invalidateQueries({ queryKey: ['orders'] })
    queryClient.invalidateQueries({ queryKey: ['spareparts'] })
    queryClient.invalidateQueries({ queryKey: ['dashboard'] })
    queryClient.invalidateQueries({ queryKey: ['alerts'] })
    queryClient.invalidateQueries({ queryKey: ['audit'] })
  }

  const createOrder = useMutation({
    mutationFn: () =>
      postJson('/api/order', {
        tipeCustomer: orderForm.tipe,
        tokoId: orderForm.tipe === 'TOKO' && orderForm.pemilikId ? Number(orderForm.pemilikId) : undefined,
        customerId: orderForm.tipe === 'PERORANGAN' && orderForm.pemilikId ? Number(orderForm.pemilikId) : undefined,
        namaPemesan: orderForm.namaPemesan.trim() || undefined,
        sparepartId: Number(orderForm.sparepartId),
        qty: Number(orderForm.qty) || 1,
        catatan: orderForm.catatan.trim() || undefined,
        aktor: role,
      }),
    onSuccess: (o: unknown) => {
      invalidateOrder()
      setOrderOpen(false)
      const no = (o as { noOrder?: string })?.noOrder ?? ''
      toast({ title: 'Order tercatat', description: `Permintaan ${no} tersimpan sebagai BARU.` })
    },
    onError: (e: Error) => toast({ title: 'Gagal mencatat order', description: e.message, variant: 'destructive' }),
  })

  const orderAksi = useMutation({
    mutationFn: ({ id, aksi }: { id: number; aksi: string }) =>
      postJson(`/api/order/${id}`, { aksi, aktor: role }, 'PATCH'),
    onSuccess: (_d, v) => {
      invalidateOrder()
      const label: Record<string, string> = { TERUSKAN: 'diteruskan ke produsen', DATANG: 'tiba — stok bertambah', SELESAI: 'selesai & diserahkan', BATAL: 'dibatalkan', UPDATE_DATA: 'dikoreksi' }
      toast({ title: 'Order diperbarui', description: `Order ${label[v.aksi] ?? v.aksi}.` })
    },
    onError: (e: Error) => toast({ title: 'Aksi order ditolak', description: e.message, variant: 'destructive' }),
  })

  // Koreksi order (qty/catatan) — hanya saat BARU
  const [editOrder, setEditOrder] = useState<PermintaanOrder | null>(null)
  const [editOrderForm, setEditOrderForm] = useState({ qty: '1', catatan: '' })
  const updateOrder = useMutation({
    mutationFn: () =>
      postJson(`/api/order/${editOrder!.id}`, { aksi: 'UPDATE_DATA', qty: Number(editOrderForm.qty) || 1, catatan: editOrderForm.catatan.trim() || null, aktor: role }, 'PATCH'),
    onSuccess: () => {
      invalidateOrder()
      setEditOrder(null)
      toast({ title: 'Order dikoreksi', description: 'Qty & catatan tersimpan.' })
    },
    onError: (e: Error) => toast({ title: 'Gagal mengoreksi order', description: e.message, variant: 'destructive' }),
  })

  // Stok titipan yang kosong, dikelompokkan per brand
  const kosongPerBrand = useMemo(() => {
    const map = new Map<string, Sparepart[]>()
    for (const p of parts ?? []) {
      if (!p.kosong) continue
      const brands = (p.brandKompatibel ?? '').split(',').map((b) => b.trim()).filter(Boolean)
      if (brands.length === 0) {
        const arr = map.get('Tanpa brand') ?? []
        arr.push(p)
        map.set('Tanpa brand', arr)
      } else {
        for (const b of brands) {
          const arr = map.get(b) ?? []
          arr.push(p)
          map.set(b, arr)
        }
      }
    }
    return [...map.entries()].sort((a, b) => b[1].length - a[1].length)
  }, [parts])

  const orderTampil = useMemo(() => {
    const q = cariOrder.trim()
    if (!q) return orders ?? []
    return (orders ?? []).filter((o) => matchQuery([o.noOrder, o.namaPemesan, o.kodePart, o.namaPart, o.brand, o.status, o.catatan], q))
  }, [orders, cariOrder])

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

  const openEdit = (p: Sparepart) => {
    setEditTarget(p)
    setEditForm({
      namaPart: p.namaPart,
      brandKompatibel: p.brandKompatibel ?? '',
      supplier: p.supplier ?? '',
      stokJual: String(p.stokJual ?? 0),
      stokGaransi: String(p.stokGaransi ?? 0),
      reorderLimit: String(p.reorderLimit),
      hargaKlaim: String(p.hargaKlaim),
    })
  }

  const updateMutation = useMutation({
    mutationFn: () =>
      postJson(`/api/sparepart/${editTarget!.id}`, {
        namaPart: editForm.namaPart.trim(),
        brandKompatibel: editForm.brandKompatibel.trim(),
        supplier: editForm.supplier.trim(),
        stokJual: Math.max(0, Math.trunc(Number(editForm.stokJual) || 0)),
        stokGaransi: Math.max(0, Math.trunc(Number(editForm.stokGaransi) || 0)),
        reorderLimit: Math.max(0, Math.trunc(Number(editForm.reorderLimit) || 0)),
        hargaKlaim: Math.max(0, Number(editForm.hargaKlaim) || 0),
        aktor: role,
      }, 'PATCH'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['spareparts'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      queryClient.invalidateQueries({ queryKey: ['alerts'] })
      queryClient.invalidateQueries({ queryKey: ['audit'] })
      queryClient.invalidateQueries({ queryKey: ['service-tickets'] })
      setEditTarget(null)
      toast({ title: 'Sparepart diperbarui', description: 'Perubahan data tersimpan & stok tersinkron.' })
    },
    onError: (e: Error) => toast({ title: 'Gagal memperbarui sparepart', description: e.message, variant: 'destructive' }),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => postJson(`/api/sparepart/${id}`, {}, 'DELETE'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['spareparts'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      queryClient.invalidateQueries({ queryKey: ['alerts'] })
      queryClient.invalidateQueries({ queryKey: ['audit'] })
      setDeleteTarget(null)
      toast({ title: 'Sparepart dihapus', description: 'Item keluar dari katalog inventory.' })
    },
    onError: (e: Error) => toast({ title: 'Tidak dapat menghapus', description: e.message, variant: 'destructive' }),
  })

  const kritis = (parts ?? []).filter((p) => p.ropAlert)
  const kosong = (parts ?? []).filter((p) => p.kosong)
  const tampilParts = useMemo(() => {
    let list = parts ?? []
    if (stokFilter === 'KRITIS') list = list.filter((p) => p.ropAlert)
    if (stokFilter === 'KOSONG') list = list.filter((p) => p.kosong)
    const q = cari.trim().toLowerCase()
    if (q) {
      list = list.filter((p) => matchQuery([p.kodePart, p.namaPart, p.brandKompatibel, p.supplier], q))
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

      {/* Urutan tampil: order customer + stok kosong di atas (portable), tabel scroll terbatas seperti Master Toko */}
      <div className="flex flex-col gap-4">
        {/* Tabel stok */}
        <Card className="order-3">
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle className="text-base">Stok Sparepart Inventory</CardTitle>
              <CardDescription>2 kelompok kolom terpisah: Stok Brand (jual/garansi — reserve otomatis saat tiket) · Part per Unit (terpakai &amp; dipesan ORDER_PRODUSEN — tidak menambah stok) · {tampilParts.length} item</CardDescription>
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
              <QuickSearch
                value={cari}
                onChange={setCari}
                placeholder="Cari kode / nama / brand / supplier…"
                className="max-w-xs flex-1"
                resultCount={tampilParts.length}
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
                      <TableHead>Brand Kompatibel</TableHead>
                      <TableHead>Supplier</TableHead>
                      <TableHead>Stok Brand (Jual/Garansi)</TableHead>
                      <TableHead>Part per Unit</TableHead>
                      <TableHead>Nilai Klaim/unit</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Aksi</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {tampilParts.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={9} className="py-8 text-center text-sm text-slate-500">
                          Tidak ada item yang cocok dengan filter aktif.
                        </TableCell>
                      </TableRow>
                    ) : tampilParts.map((p) => {
                      const pct = Math.min((p.stokInventory / Math.max(p.reorderLimit * 3, 1)) * 100, 100)
                      return (
                        <TableRow key={p.id} className={cn(p.kosong && 'bg-rose-50/60', p.ropAlert && !p.kosong && 'bg-amber-50/50')}>
                          <TableCell>
                            <p className="font-mono text-[11px] font-semibold text-slate-800">{p.kodePart}</p>
                            {(p.dipakai ?? 0) > 0 && (
                              <p className="text-[10px] text-slate-500" title="Part ini dipakai di tiket — tidak dapat dihapus">Dipakai {p.dipakai} tiket</p>
                            )}
                          </TableCell>
                          <TableCell>
                            <p className="text-xs font-semibold text-slate-800">{p.namaPart}</p>
                          </TableCell>
                          <TableCell className="max-w-36 truncate text-xs text-slate-600" title={p.brandKompatibel || ''}>
                            {p.brandKompatibel?.trim() || '—'}
                          </TableCell>
                          <TableCell className="max-w-36 truncate text-xs text-slate-600" title={p.supplier || ''}>
                            {p.supplier?.trim() || '—'}
                          </TableCell>
                          <TableCell className="w-44">
                            <div className="flex items-baseline gap-1">
                              <span className={cn('text-lg font-bold', p.kosong ? 'text-rose-600' : p.ropAlert ? 'text-amber-600' : 'text-slate-800')}>{p.stokJual}/{p.stokGaransi}</span>
                              <span className="text-[10px] text-slate-400">({p.stokInventory} total / ROP {p.reorderLimit})</span>
                            </div>
                            <Progress value={pct} className="mt-1 h-1.5" aria-label={`Stok ${p.stokInventory} dari limit ${p.reorderLimit}`} />
                          </TableCell>
                          <TableCell className="w-40 whitespace-nowrap">
                            <div className="flex items-baseline gap-1" title="Kumulatif part terpakai di tiket service — tidak mengurangi stok brand">
                              <span className="text-[10px] text-slate-500">Terpakai</span>
                              <span className="text-sm font-semibold text-slate-800">{p.totalTerpakai ?? 0}</span>
                            </div>
                            <div className="flex items-baseline gap-1" title={p.menungguDi?.length ? `Menunggu di tiket: ${p.menungguDi.join(', ')}` : 'Part dipesan khusus untuk unit (ORDER_PRODUSEN) — tidak menambah stok brand'}>
                              <span className="text-[10px] text-slate-500">Dipesan</span>
                              <span className={cn('text-sm font-semibold', (p.dipesanPerUnit ?? 0) > 0 ? 'text-rose-600' : 'text-slate-400')}>{p.dipesanPerUnit ?? 0}</span>
                              {(p.dipesanPerUnit ?? 0) > 0 && <span className="text-[9px] text-rose-500">ORDER</span>}
                            </div>
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-xs text-slate-600">{formatRupiah(p.hargaKlaim)}</TableCell>
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
                            <div className="flex items-center justify-end gap-1">
                              <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" onClick={() => { setRestockTarget(p); setRestockJenis('JUAL'); setRestockQty(String(Math.max(p.reorderLimit * 2, 5))) }}>
                                <PackagePlus className="mr-1 h-3 w-3" /> Restock
                              </Button>
                              <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px] text-slate-600 hover:text-emerald-700" onClick={() => openEdit(p)} aria-label={`Edit ${p.kodePart}`} title="Edit sparepart">
                                <Pencil className="h-3 w-3" />
                              </Button>
                              <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px] text-slate-400 hover:text-rose-600" onClick={() => setDeleteTarget(p)} aria-label={`Hapus ${p.kodePart}`} title="Hapus sparepart">
                                <Trash2 className="h-3 w-3" />
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

        {/* Draft Re-Order (ALT-03) — selalu terlihat di halaman yang sama */}
        <Collapsible open={roOpen} onOpenChange={setRoOpen} className="order-4">
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
              <CardContent className="space-y-3">
                {reorderDraft.length === 0 ? (
                  <p className="rounded-lg border border-dashed p-6 text-center text-xs text-slate-500">Semua stok aman. Tidak ada draft re-order.</p>
                ) : (
                  <>
                    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
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
                    </div>
                    <Button className="w-full bg-amber-600 hover:bg-amber-700" onClick={() => setRoFormOpen(true)}>
                      <PackagePlus className="mr-1.5 h-4 w-4" /> Kirim Permintaan ke Produsen
                    </Button>
                  </>
                )}
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>
      {/* Stok titipan kosong per brand — calon order customer */}
      <Card className="order-1 border-rose-200">
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <PackageX className="h-4 w-4 text-rose-600" /> Stok Titipan Kosong per Brand
              {(parts ?? []).filter((p) => p.kosong).length > 0 && (
                <Badge variant="destructive" className="text-[10px]">{(parts ?? []).filter((p) => p.kosong).length} item</Badge>
              )}
            </CardTitle>
            <CardDescription>Stok konsinyasi yang habis — cepat catat order bila ada customer memesan</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {kosongPerBrand.length === 0 ? (
            <p className="rounded-lg border border-dashed p-6 text-center text-xs text-slate-500">Tidak ada stok kosong. Semua titipan tersedia.</p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {kosongPerBrand.map(([brand, items]) => (
                <div key={brand} className="rounded-lg border border-rose-200 bg-rose-50/50 p-3">
                  <p className="mb-1.5 flex items-center justify-between text-xs font-semibold text-slate-800">
                    {brand}
                    <Badge variant="outline" className="border-rose-300 text-[10px] text-rose-700">{items.length} kosong</Badge>
                  </p>
                  <div className="space-y-1">
                    {items.map((p) => (
                      <div key={p.id} className="flex items-center justify-between gap-2 rounded-md bg-white px-2 py-1.5">
                        <div className="min-w-0">
                          <p className="truncate text-[11px] font-medium text-slate-700">{p.namaPart}</p>
                          <p className="font-mono text-[10px] text-slate-400">{p.kodePart}</p>
                        </div>
                        <Button size="sm" variant="outline" className="h-6 shrink-0 px-2 text-[10px]" onClick={() => openOrder(p.id)}>
                          Order
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Permintaan order customer */}
      <Card className="order-2">
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <ClipboardList className="h-4 w-4 text-teal-700" /> Permintaan Order Customer
              {(orders ?? []).filter((o) => o.status === 'BARU' || o.status === 'DITERUSKAN').length > 0 && (
                <Badge className="bg-teal-600 text-[10px] text-white hover:bg-teal-600">
                  {(orders ?? []).filter((o) => o.status === 'BARU' || o.status === 'DITERUSKAN').length} aktif
                </Badge>
              )}
            </CardTitle>
            <CardDescription>Pesanan sparepart dari toko / perorangan · BARU → diteruskan → datang (stok+) → selesai</CardDescription>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button size="sm" className="bg-teal-700 hover:bg-teal-800" onClick={() => openOrder()}>
              <Plus className="mr-1 h-4 w-4" /> Catat Order
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="mb-3">
            <QuickSearch value={cariOrder} onChange={setCariOrder} placeholder="Cari no. order / pemesan / part…" className="max-w-xs" resultCount={orderTampil.length} />
          </div>
          {orderTampil.length === 0 ? (
            <p className="rounded-lg border border-dashed p-6 text-center text-xs text-slate-500">
              {(orders ?? []).length === 0 ? 'Belum ada permintaan order. Catat saat customer memesan part.' : 'Tidak ada order yang cocok dengan pencarian.'}
            </p>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>No. Order</TableHead>
                    <TableHead>Pemesan</TableHead>
                    <TableHead>Part × Qty</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Aksi</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orderTampil.map((o) => (
                    <TableRow key={o.id}>
                      <TableCell>
                        <p className="font-mono text-[11px] font-semibold text-slate-800">{o.noOrder}</p>
                        <p className="text-[10px] text-slate-400">{new Date(o.createdAt).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
                      </TableCell>
                      <TableCell>
                        <p className="text-xs font-medium text-slate-800">{o.namaPemesan}</p>
                        <p className="text-[10px] text-slate-400">{o.tipeCustomer === 'TOKO' ? 'Toko' : 'Perorangan'}{o.catatan ? ` · ${o.catatan}` : ''}</p>
                      </TableCell>
                      <TableCell>
                        <p className="text-xs text-slate-800">{o.namaPart} <span className="font-bold">×{o.qty}</span></p>
                        <p className="font-mono text-[10px] text-slate-400">{o.kodePart}{o.brand ? ` · ${o.brand}` : ''}</p>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={cn(
                            'text-[10px]',
                            o.status === 'BARU' && 'border-amber-300 text-amber-700',
                            o.status === 'DITERUSKAN' && 'border-sky-300 text-sky-700',
                            o.status === 'DATANG' && 'border-violet-300 text-violet-700',
                            o.status === 'SELESAI' && 'border-emerald-300 text-emerald-700',
                            o.status === 'BATAL' && 'border-slate-300 text-slate-400'
                          )}
                        >
                          {o.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          {o.status === 'BARU' && (
                            <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px] text-slate-500 hover:text-emerald-700" onClick={() => { setEditOrder(o); setEditOrderForm({ qty: String(o.qty), catatan: o.catatan ?? '' }) }} aria-label={`Koreksi order ${o.noOrder}`} title="Koreksi qty/catatan">
                              <Pencil className="h-3 w-3" />
                            </Button>
                          )}
                          {o.status === 'BARU' && (
                            <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" disabled={orderAksi.isPending} onClick={() => orderAksi.mutate({ id: o.id, aksi: 'TERUSKAN' })}>
                              <Send className="mr-1 h-3 w-3" /> Teruskan
                            </Button>
                          )}
                          {(o.status === 'BARU' || o.status === 'DITERUSKAN') && (
                            <Button size="sm" variant="outline" className="h-7 border-violet-300 px-2 text-[11px] text-violet-700" disabled={orderAksi.isPending} onClick={() => orderAksi.mutate({ id: o.id, aksi: 'DATANG' })}>
                              <Truck className="mr-1 h-3 w-3" /> Datang
                            </Button>
                          )}
                          {o.status === 'DATANG' && (
                            <Button size="sm" variant="outline" className="h-7 border-emerald-300 px-2 text-[11px] text-emerald-700" disabled={orderAksi.isPending} onClick={() => orderAksi.mutate({ id: o.id, aksi: 'SELESAI' })}>
                              Selesai
                            </Button>
                          )}
                          {(o.status === 'BARU' || o.status === 'DITERUSKAN') && (
                            <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px] text-slate-400 hover:text-rose-600" disabled={orderAksi.isPending} onClick={() => orderAksi.mutate({ id: o.id, aksi: 'BATAL' })}>
                              <X className="h-3 w-3" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Order Part per Unit — terpisah dari order customer (stok) */}
      <Card className="order-2 border-rose-200">
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Truck className="h-4 w-4 text-rose-600" /> Order Part per Unit (ORDER_PRODUSEN)
              {(parts ?? []).filter((p) => (p.dipesanPerUnit ?? 0) > 0).length > 0 && (
                <Badge variant="destructive" className="text-[10px]">{(parts ?? []).filter((p) => (p.dipesanPerUnit ?? 0) > 0).length} part</Badge>
              )}
            </CardTitle>
            <CardDescription>Part yang dipesan khusus dari tiket service — menambah stok brand saat “Terima Part Produsen”, bukan bagian order customer</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {(() => {
            const perUnit = (parts ?? []).filter((p) => (p.dipesanPerUnit ?? 0) > 0)
            if (perUnit.length === 0) {
              return <p className="rounded-lg border border-dashed p-6 text-center text-xs text-slate-500">Tidak ada part per unit yang sedang dipesan. Semua part di tiket ready dari stok.</p>
            }
            return (
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {perUnit.map((p) => (
                  <div key={p.id} className="rounded-lg border border-rose-200 bg-rose-50/60 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-xs font-semibold text-slate-800">{p.namaPart}</p>
                        <p className="font-mono text-[10px] text-slate-500">{p.kodePart}</p>
                      </div>
                      <Badge className="shrink-0 bg-rose-600 text-[10px] text-white hover:bg-rose-600">×{p.dipesanPerUnit ?? 0}</Badge>
                    </div>
                    {p.menungguDi && p.menungguDi.length > 0 && (
                      <p className="mt-1 truncate text-[10px] text-slate-600" title={p.menungguDi.join(', ')}>
                        Tiket: {p.menungguDi.join(', ')}
                      </p>
                    )}
                    <p className="mt-1 text-[10px] text-slate-500">Terpakai total: <span className="font-semibold text-slate-700">{p.totalTerpakai ?? 0}</span> · Stok brand: <span className="font-semibold text-slate-700">{p.stokInventory}</span></p>
                  </div>
                ))}
              </div>
            )
          })()}
        </CardContent>
      </Card>
      </div>

      {/* Dialog catat order customer */}
      <Dialog open={orderOpen} onOpenChange={setOrderOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Catat Permintaan Order</DialogTitle>
            <DialogDescription>Pesanan sparepart dari customer — tercatat BARU, teruskan ke produsen saat dipesan.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Pemesan — Toko atau Perorangan</Label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={orderForm.tipe === 'TOKO' ? 'default' : 'outline'}
                  className={orderForm.tipe === 'TOKO' ? 'bg-teal-700 hover:bg-teal-800' : ''}
                  onClick={() => setOrderForm({ ...orderForm, tipe: 'TOKO', pemilikId: '', namaPemesan: '' })}
                >
                  Toko
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={orderForm.tipe === 'PERORANGAN' ? 'default' : 'outline'}
                  className={orderForm.tipe === 'PERORANGAN' ? 'bg-teal-700 hover:bg-teal-800' : ''}
                  onClick={() => setOrderForm({ ...orderForm, tipe: 'PERORANGAN', pemilikId: '', namaPemesan: '' })}
                >
                  Perorangan
                </Button>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>{orderForm.tipe === 'TOKO' ? 'Pilih Toko (otomatis dari data toko)' : 'Pilih Customer (opsional — otomatis dari data customer)'}</Label>
              <SearchSelect
                value={orderForm.pemilikId}
                onChange={(v) => {
                  const list = orderForm.tipe === 'TOKO' ? (tokoList ?? []) : (customerList ?? [])
                  const found = list.find((p) => String(p.id) === v)
                  const nama = orderForm.tipe === 'TOKO'
                    ? (found as Toko | undefined)?.namaToko ?? ''
                    : (found as Customer | undefined)?.nama ?? ''
                  setOrderForm({ ...orderForm, pemilikId: v, namaPemesan: orderForm.tipe === 'TOKO' ? nama : orderForm.namaPemesan })
                }}
                options={(orderForm.tipe === 'TOKO' ? (tokoList ?? []) : (customerList ?? [])).map((p) => (
                  orderForm.tipe === 'TOKO'
                    ? { value: String(p.id), label: `${(p as Toko).kodeToko} — ${(p as Toko).namaToko}` }
                    : { value: String(p.id), label: (p as Customer).nama }
                ))}
                placeholder={orderForm.tipe === 'TOKO' ? '— Ketik kode/nama toko —' : '— Ketik nama customer —'}
                ariaLabel="Pilih pemesan"
              />
            </div>
            {orderForm.tipe === 'PERORANGAN' && (
              <div className="space-y-1.5">
                <Label>Nama Pemesan</Label>
                <HistoryInput historyKey="order-pemesan" value={orderForm.namaPemesan} onChange={(e) => setOrderForm({ ...orderForm, namaPemesan: e.target.value })} placeholder="Nama perorangan / isi otomatis dari customer" />
              </div>
            )}
            <div className="space-y-1.5">
              <Label>Sparepart Dipesan</Label>
              <SearchSelect
                value={orderForm.sparepartId}
                onChange={(v) => setOrderForm({ ...orderForm, sparepartId: v })}
                options={(parts ?? []).map((p) => ({
                  value: String(p.id),
                  label: `${p.kodePart} · ${p.namaPart}`,
                  sub: p.kosong ? 'KOSONG' : `stok ${p.stokInventory}`,
                }))}
                placeholder="— Ketik kode/nama part —"
                ariaLabel="Pilih sparepart"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Qty</Label>
                <Input type="number" min="1" value={orderForm.qty} onChange={(e) => setOrderForm({ ...orderForm, qty: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Catatan (opsional)</Label>
                <HistoryInput historyKey="order-catatan" value={orderForm.catatan} onChange={(e) => setOrderForm({ ...orderForm, catatan: e.target.value })} placeholder="cth: ditunggu Senin" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOrderOpen(false)}>Batal</Button>
            <Button
              className="bg-teal-700 hover:bg-teal-800"
              disabled={
                !orderForm.sparepartId ||
                Number(orderForm.qty) < 1 ||
                (orderForm.tipe === 'TOKO' && !orderForm.pemilikId) ||
                (orderForm.tipe === 'PERORANGAN' && !orderForm.pemilikId && !orderForm.namaPemesan.trim()) ||
                createOrder.isPending
              }
              onClick={() => createOrder.mutate()}
            >
              <Plus className="mr-1 h-4 w-4" /> Simpan Order
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog koreksi order (qty/catatan, hanya saat BARU) */}
      <Dialog open={!!editOrder} onOpenChange={(o) => !o && setEditOrder(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Koreksi Order {editOrder && <span className="font-mono text-sm text-slate-500">{editOrder.noOrder}</span>}</DialogTitle>
            <DialogDescription>
              {editOrder && <span>{editOrder.namaPart} · {editOrder.namaPemesan}</span>}
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Qty</Label>
              <Input type="number" min="1" value={editOrderForm.qty} onChange={(e) => setEditOrderForm({ ...editOrderForm, qty: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Catatan</Label>
              <HistoryInput historyKey="order-catatan" value={editOrderForm.catatan} onChange={(e) => setEditOrderForm({ ...editOrderForm, catatan: e.target.value })} placeholder="—" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOrder(null)}>Batal</Button>
            <Button
              className="bg-emerald-600 hover:bg-emerald-700"
              disabled={!editOrder || Number(editOrderForm.qty) < 1 || updateOrder.isPending}
              onClick={() => updateOrder.mutate()}
            >
              <Pencil className="mr-1 h-4 w-4" /> Simpan Koreksi
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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

      {/* Dialog edit sparepart */}
      <Dialog open={!!editTarget} onOpenChange={(o) => !o && setEditTarget(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Sparepart {editTarget && <span className="font-mono text-sm text-slate-500">{editTarget.kodePart}</span>}</DialogTitle>
            <DialogDescription>Kode tidak dapat diubah karena dipakai di tiket &amp; riwayat. Total stok = jual + garansi (otomatis).</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Nama Sparepart</Label>
              <HistoryInput historyKey="part-nama" value={editForm.namaPart} onChange={(e) => setEditForm({ ...editForm, namaPart: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Brand Kompatibel</Label>
              <HistoryInput historyKey="part-brand" value={editForm.brandKompatibel} onChange={(e) => setEditForm({ ...editForm, brandKompatibel: e.target.value })} placeholder="cth: Samsung, LG" />
            </div>
            <div className="space-y-1.5">
              <Label>Supplier</Label>
              <HistoryInput historyKey="part-supplier" value={editForm.supplier} onChange={(e) => setEditForm({ ...editForm, supplier: e.target.value })} placeholder="cth: PT Sinar Elektronik" />
            </div>
            <div className="space-y-1.5">
              <Label>Stok Bisa Jual</Label>
              <Input type="number" min="0" value={editForm.stokJual} onChange={(e) => setEditForm({ ...editForm, stokJual: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Stok Garansi</Label>
              <Input type="number" min="0" value={editForm.stokGaransi} onChange={(e) => setEditForm({ ...editForm, stokGaransi: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Reorder Limit (ROP)</Label>
              <Input type="number" min="0" value={editForm.reorderLimit} onChange={(e) => setEditForm({ ...editForm, reorderLimit: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Harga Klaim (Rp)</Label>
              <Input type="number" min="0" value={editForm.hargaKlaim} onChange={(e) => setEditForm({ ...editForm, hargaKlaim: e.target.value })} />
            </div>
          </div>
          <p className="text-[11px] text-slate-500">
            Total stok menjadi {(Number(editForm.stokJual) || 0) + (Number(editForm.stokGaransi) || 0)} unit.
          </p>
          <p className="rounded-md bg-slate-50 p-2 text-[11px] text-slate-600">
            Total terpakai di tiket: <span className="font-semibold text-slate-800">{editTarget?.totalTerpakai ?? 0}</span> —
            tercatat otomatis, tidak memengaruhi stok brand & tidak bisa diedit manual.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditTarget(null)}>Batal</Button>
            <Button
              className="bg-emerald-600 hover:bg-emerald-700"
              disabled={!editTarget || !editForm.namaPart.trim() || updateMutation.isPending}
              onClick={() => updateMutation.mutate()}
            >
              <Pencil className="mr-1 h-4 w-4" /> Simpan Perubahan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog konfirmasi hapus sparepart */}
      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Hapus Sparepart?</DialogTitle>
            <DialogDescription>
              {deleteTarget && (
                <span><span className="font-mono font-semibold">{deleteTarget.kodePart}</span> — {deleteTarget.namaPart} akan keluar dari katalog. Tindakan ini tidak dapat dibatalkan.</span>
              )}
            </DialogDescription>
          </DialogHeader>
          {(deleteTarget?.dipakai ?? 0) > 0 ? (
            <p className="rounded-md border border-rose-200 bg-rose-50 p-2.5 text-xs text-rose-800">
              Terkunci: part ini dipakai di <span className="font-bold">{deleteTarget!.dipakai} tiket service</span> —
              riwayat tiket harus utuh sehingga tidak dapat dihapus. Hapus/selesaikan tiket terkait dulu bila memang perlu.
            </p>
          ) : (
            <p className="rounded-md bg-amber-50 p-2.5 text-xs text-amber-800">
              Part ini belum dipakai di tiket mana pun — aman dihapus.
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Batal</Button>
            <Button
              variant="destructive"
              disabled={!deleteTarget || (deleteTarget.dipakai ?? 0) > 0 || deleteMutation.isPending}
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
            >
              <Trash2 className="mr-1 h-4 w-4" /> Ya, Hapus
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog item baru */}      <Dialog open={addOpen} onOpenChange={setAddOpen}>
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
              <HistoryInput historyKey="part-nama" value={newPart.namaPart} onChange={(e) => setNewPart({ ...newPart, namaPart: e.target.value })} placeholder="cth: Kompresor 3/4 PK" />
            </div>
            <div className="space-y-1.5">
              <Label>Brand Kompatibel</Label>
              <HistoryInput historyKey="part-brand" value={newPart.brandKompatibel} onChange={(e) => setNewPart({ ...newPart, brandKompatibel: e.target.value })} placeholder="cth: Samsung, LG" />
            </div>
            <div className="space-y-1.5">
              <Label>Supplier</Label>
              <HistoryInput historyKey="part-supplier" value={newPart.supplier} onChange={(e) => setNewPart({ ...newPart, supplier: e.target.value })} placeholder="cth: PT Sinar Elektronik" />
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
