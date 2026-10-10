'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetcher, postJson, formatTanggal, type Toko, type Customer, type UnitAsset, type Pengguna } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useToast } from '@/hooks/use-toast'
import { useAppStore } from '@/lib/store'
import { Store, Users, QrCode, UserCog, Plus, MapPinOff, MapPinCheck, Barcode } from 'lucide-react'
import { cn } from '@/lib/utils'

export default function MasterDataView() {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const { role } = useAppStore()

  const { data: tokoList, isLoading: tokoLoading } = useQuery<Toko[]>({ queryKey: ['toko'], queryFn: () => fetcher<Toko[]>('/api/toko') })
  const { data: customerList, isLoading: customerLoading } = useQuery<Customer[]>({ queryKey: ['customers'], queryFn: () => fetcher<Customer[]>('/api/customer') })
  const { data: unitList, isLoading: unitLoading } = useQuery<UnitAsset[]>({ queryKey: ['units'], queryFn: () => fetcher<UnitAsset[]>('/api/unit') })
  const { data: userList } = useQuery<Pengguna[]>({ queryKey: ['pengguna'], queryFn: () => fetcher<Pengguna[]>('/api/pengguna') })

  // ===== Form states =====
  const [tokoOpen, setTokoOpen] = useState(false)
  const [newToko, setNewToko] = useState({ kodeToko: '', namaToko: '', alamat: '', kontak: '', frekuensiVisit: '14' })
  const [custOpen, setCustOpen] = useState(false)
  const [newCust, setNewCust] = useState({ nama: '', noWa: '', alamat: '' })
  const [unitOpen, setUnitOpen] = useState(false)
  const [newUnit, setNewUnit] = useState({ serialNumber: '', modelUnit: '', tokoId: '', customerId: '', statusGaransi: 'GARANSI', tglPembelian: '' })
  const [qrUnit, setQrUnit] = useState<UnitAsset | null>(null)
  const [userOpen, setUserOpen] = useState(false)
  const [newUser, setNewUser] = useState({ nama: '', email: '', role: 'TEKNISI', noWa: '', wilayahKerja: '' })

  const invalidate = (keys: string[]) => {
    keys.forEach((k) => queryClient.invalidateQueries({ queryKey: [k] }))
    queryClient.invalidateQueries({ queryKey: ['audit'] })
  }

  const addToko = useMutation({
    mutationFn: () => postJson('/api/toko', { ...newToko, frekuensiVisit: Number(newToko.frekuensiVisit), aktor: role }),
    onSuccess: () => { invalidate(['toko', 'dashboard']); setTokoOpen(false); setNewToko({ kodeToko: '', namaToko: '', alamat: '', kontak: '', frekuensiVisit: '14' }); toast({ title: 'Toko teregistrasi' }) },
    onError: (e: Error) => toast({ title: 'Gagal', description: e.message, variant: 'destructive' }),
  })
  const addCust = useMutation({
    mutationFn: () => postJson('/api/customer', { ...newCust, aktor: role }),
    onSuccess: () => { invalidate(['customers']); setCustOpen(false); setNewCust({ nama: '', noWa: '', alamat: '' }); toast({ title: 'Customer teregistrasi' }) },
    onError: (e: Error) => toast({ title: 'Gagal', description: e.message, variant: 'destructive' }),
  })
  const addUnit = useMutation({
    mutationFn: () => postJson('/api/unit', { ...newUnit, tokoId: newUnit.tokoId ? Number(newUnit.tokoId) : null, customerId: newUnit.customerId ? Number(newUnit.customerId) : null, aktor: role }),
    onSuccess: () => { invalidate(['units', 'toko', 'dashboard']); setUnitOpen(false); setNewUnit({ serialNumber: '', modelUnit: '', tokoId: '', customerId: '', statusGaransi: 'GARANSI', tglPembelian: '' }); toast({ title: 'Unit asset teregistrasi', description: 'Stiker barcode/QR dapat dicetak.' }) },
    onError: (e: Error) => toast({ title: 'Gagal', description: e.message, variant: 'destructive' }),
  })
  const addUser = useMutation({
    mutationFn: () => postJson('/api/pengguna', { ...newUser, aktor: role }),
    onSuccess: () => { invalidate(['pengguna']); setUserOpen(false); setNewUser({ nama: '', email: '', role: 'TEKNISI', noWa: '', wilayahKerja: '' }); toast({ title: 'Karyawan ditambahkan' }) },
    onError: (e: Error) => toast({ title: 'Gagal', description: e.message, variant: 'destructive' }),
  })

  const barcodeData = (u: UnitAsset) => `SN:${u.serialNumber}|MOD:${u.modelUnit}|TOK:${u.toko?.kodeToko ?? '-'}`

  return (
    <Tabs defaultValue="toko" className="space-y-4">
      <TabsList className="flex-wrap">
        <TabsTrigger value="toko"><Store className="mr-1 h-3.5 w-3.5" /> Toko</TabsTrigger>
        <TabsTrigger value="customer"><Users className="mr-1 h-3.5 w-3.5" /> Customer</TabsTrigger>
        <TabsTrigger value="unit"><QrCode className="mr-1 h-3.5 w-3.5" /> Unit Asset</TabsTrigger>
        <TabsTrigger value="karyawan"><UserCog className="mr-1 h-3.5 w-3.5" /> Karyawan</TabsTrigger>
      </TabsList>

      {/* ===== TOKO ===== */}
      <TabsContent value="toko">
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle className="text-base">Master Toko Mitra</CardTitle>
              <CardDescription>Profil toko, siklus kunjungan rutin, dan status kepatuhan (ALT-01)</CardDescription>
            </div>
            <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={() => setTokoOpen(true)}><Plus className="mr-1 h-4 w-4" /> Toko Baru</Button>
          </CardHeader>
          <CardContent>
            {tokoLoading ? (
              <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Kode · Nama</TableHead>
                      <TableHead className="hidden md:table-cell">Alamat</TableHead>
                      <TableHead className="hidden sm:table-cell">Kontak</TableHead>
                      <TableHead>Siklus</TableHead>
                      <TableHead>Visit Terakhir</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(tokoList ?? []).map((t) => (
                      <TableRow key={t.id}>
                        <TableCell>
                          <p className="text-xs font-semibold text-slate-800">{t.namaToko}</p>
                          <p className="font-mono text-[10px] text-slate-400">{t.kodeToko} · {t.jumlahUnit} unit</p>
                        </TableCell>
                        <TableCell className="hidden max-w-52 md:table-cell"><p className="truncate text-xs text-slate-600">{t.alamat}</p></TableCell>
                        <TableCell className="hidden text-xs text-slate-600 sm:table-cell">{t.kontak}</TableCell>
                        <TableCell className="text-xs text-slate-700">{t.frekuensiVisit} hari</TableCell>
                        <TableCell className="text-xs text-slate-600">{formatTanggal(t.tglVisitTerakhir)}</TableCell>
                        <TableCell>
                          {t.visitTerlambat ? (
                            <Badge variant="destructive" className="gap-1 text-[10px]"><MapPinOff className="h-2.5 w-2.5" /> TERLAMBAT</Badge>
                          ) : (
                            <Badge variant="outline" className="gap-1 border-emerald-300 text-[10px] text-emerald-700"><MapPinCheck className="h-2.5 w-2.5" /> ON TRACK</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </TabsContent>

      {/* ===== CUSTOMER ===== */}
      <TabsContent value="customer">
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle className="text-base">Master Customer (Pemilik Unit)</CardTitle>
              <CardDescription>Data pemilik unit end-user untuk notifikasi &amp; pelacakan garansi</CardDescription>
            </div>
            <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={() => setCustOpen(true)}><Plus className="mr-1 h-4 w-4" /> Customer Baru</Button>
          </CardHeader>
          <CardContent>
            {customerLoading ? (
              <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {(customerList ?? []).map((c) => (
                  <div key={c.id} className="rounded-xl border p-4">
                    <p className="text-sm font-semibold text-slate-800">{c.nama}</p>
                    <p className="text-xs text-slate-500">{c.noWa ?? '-'}</p>
                    <p className="mt-1 line-clamp-2 text-xs text-slate-500">{c.alamat}</p>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {c.unitAssets.map((u) => (
                        <Badge key={u.id} variant="outline" className="text-[9px]">{u.modelUnit}</Badge>
                      ))}
                      {c.unitAssets.length === 0 && <span className="text-[10px] text-slate-400">Belum ada unit terdaftar</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </TabsContent>

      {/* ===== UNIT ASSET ===== */}
      <TabsContent value="unit">
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle className="text-base">Master Barcode / Unit Asset</CardTitle>
              <CardDescription>Format barcode: SN:[serial]|MOD:[model]|TOK:[kode_toko] — cetak stiker &amp; scan dengan kamera HP</CardDescription>
            </div>
            <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={() => setUnitOpen(true)}><Plus className="mr-1 h-4 w-4" /> Registrasi Unit</Button>
          </CardHeader>
          <CardContent>
            {unitLoading ? (
              <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Serial · Model</TableHead>
                      <TableHead className="hidden md:table-cell">Toko</TableHead>
                      <TableHead className="hidden lg:table-cell">Pemilik</TableHead>
                      <TableHead>Garansi</TableHead>
                      <TableHead className="hidden sm:table-cell">Belinya</TableHead>
                      <TableHead className="text-right">Barcode</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(unitList ?? []).map((u) => (
                      <TableRow key={u.id}>
                        <TableCell>
                          <p className="text-xs font-semibold text-slate-800">{u.modelUnit}</p>
                          <p className="font-mono text-[10px] text-slate-400">{u.serialNumber}</p>
                        </TableCell>
                        <TableCell className="hidden text-xs text-slate-600 md:table-cell">{u.toko ? `${u.toko.kodeToko} — ${u.toko.namaToko}` : '-'}</TableCell>
                        <TableCell className="hidden text-xs text-slate-600 lg:table-cell">{u.customer?.nama ?? '-'}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={cn('text-[10px]', u.statusGaransi === 'GARANSI' ? 'border-emerald-300 text-emerald-700' : 'border-amber-300 text-amber-700')}>
                            {u.statusGaransi.replace('_', '-')}
                          </Badge>
                        </TableCell>
                        <TableCell className="hidden text-xs text-slate-600 sm:table-cell">{formatTanggal(u.tglPembelian)}</TableCell>
                        <TableCell className="text-right">
                          <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" onClick={() => setQrUnit(u)}>
                            <Barcode className="mr-1 h-3 w-3" /> Stiker
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </TabsContent>

      {/* ===== KARYAWAN ===== */}
      <TabsContent value="karyawan">
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle className="text-base">Master Karyawan &amp; Peran</CardTitle>
              <CardDescription>Manajemen peran Admin, Teknisi, Manager, dan kontak Produsen — pemetaan wilayah teknisi</CardDescription>
            </div>
            <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={() => setUserOpen(true)}><Plus className="mr-1 h-4 w-4" /> Karyawan Baru</Button>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {(userList ?? []).map((u) => (
                <div key={u.id} className="flex items-start gap-3 rounded-xl border p-4">
                  <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white',
                    u.role === 'ADMIN_WORKSHOP' ? 'bg-emerald-600' : u.role === 'TEKNISI' ? 'bg-amber-500' : u.role === 'MANAGER' ? 'bg-violet-600' : 'bg-teal-600')}>
                    {u.nama.slice(0, 1).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-800">{u.nama}</p>
                    <p className="truncate text-xs text-slate-500">{u.email}</p>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      <Badge variant="outline" className="text-[9px]">{u.role.replace('_', ' ')}</Badge>
                      {u.wilayahKerja && <Badge variant="outline" className="text-[9px]">Wil. {u.wilayahKerja}</Badge>}
                      {u.jumlahKunjungan != null && u.role === 'TEKNISI' && <Badge variant="outline" className="text-[9px]">{u.jumlahKunjungan} kunjungan</Badge>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </TabsContent>

      {/* ===== Dialogs ===== */}
      <Dialog open={tokoOpen} onOpenChange={setTokoOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Tambah Toko Mitra</DialogTitle><DialogDescription>Registrasi toko baru untuk jaringan after-sales.</DialogDescription></DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5"><Label>Kode Toko</Label><Input value={newToko.kodeToko} onChange={(e) => setNewToko({ ...newToko, kodeToko: e.target.value.toUpperCase() })} placeholder="TOK-007" className="font-mono" /></div>
            <div className="space-y-1.5"><Label>Nama Toko</Label><Input value={newToko.namaToko} onChange={(e) => setNewToko({ ...newToko, namaToko: e.target.value })} placeholder="cth: Elektronik Sejahtera" /></div>
            <div className="space-y-1.5 sm:col-span-2"><Label>Alamat</Label><Input value={newToko.alamat} onChange={(e) => setNewToko({ ...newToko, alamat: e.target.value })} /></div>
            <div className="space-y-1.5"><Label>Kontak</Label><Input value={newToko.kontak} onChange={(e) => setNewToko({ ...newToko, kontak: e.target.value })} placeholder="021-xxx / 08xx" /></div>
            <div className="space-y-1.5"><Label>Siklus Visit (hari)</Label><Input type="number" value={newToko.frekuensiVisit} onChange={(e) => setNewToko({ ...newToko, frekuensiVisit: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTokoOpen(false)}>Batal</Button>
            <Button className="bg-emerald-600 hover:bg-emerald-700" disabled={!newToko.kodeToko || !newToko.namaToko || addToko.isPending} onClick={() => addToko.mutate()}><Plus className="mr-1 h-4 w-4" /> Simpan</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={custOpen} onOpenChange={setCustOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Tambah Customer</DialogTitle><DialogDescription>Data pemilik unit (end-user).</DialogDescription></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5"><Label>Nama</Label><Input value={newCust.nama} onChange={(e) => setNewCust({ ...newCust, nama: e.target.value })} /></div>
            <div className="space-y-1.5"><Label>No. WhatsApp</Label><Input value={newCust.noWa} onChange={(e) => setNewCust({ ...newCust, noWa: e.target.value })} placeholder="628xxx" /></div>
            <div className="space-y-1.5"><Label>Alamat</Label><Input value={newCust.alamat} onChange={(e) => setNewCust({ ...newCust, alamat: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCustOpen(false)}>Batal</Button>
            <Button className="bg-emerald-600 hover:bg-emerald-700" disabled={!newCust.nama || addCust.isPending} onClick={() => addCust.mutate()}><Plus className="mr-1 h-4 w-4" /> Simpan</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={unitOpen} onOpenChange={setUnitOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>Registrasi Unit Asset</DialogTitle><DialogDescription>Unit baru akan mendapat serial number unik untuk stiker barcode/QR.</DialogDescription></DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5"><Label>Serial Number</Label><Input value={newUnit.serialNumber} onChange={(e) => setNewUnit({ ...newUnit, serialNumber: e.target.value.toUpperCase() })} placeholder="SN-ACSP-2026-XXXXX" className="font-mono" /></div>
            <div className="space-y-1.5"><Label>Model Unit</Label><Input value={newUnit.modelUnit} onChange={(e) => setNewUnit({ ...newUnit, modelUnit: e.target.value })} placeholder="AC Split 1 PK ..." /></div>
            <div className="space-y-1.5">
              <Label>Toko Mitra</Label>
              <Select value={newUnit.tokoId} onValueChange={(v) => setNewUnit({ ...newUnit, tokoId: v })}>
                <SelectTrigger><SelectValue placeholder="— Pilih toko —" /></SelectTrigger>
                <SelectContent>{(tokoList ?? []).map((t) => <SelectItem key={t.id} value={String(t.id)}>{t.kodeToko} — {t.namaToko}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Customer</Label>
              <Select value={newUnit.customerId} onValueChange={(v) => setNewUnit({ ...newUnit, customerId: v })}>
                <SelectTrigger><SelectValue placeholder="— Pilih —" /></SelectTrigger>
                <SelectContent>{(customerList ?? []).map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.nama}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Status Garansi</Label>
              <Select value={newUnit.statusGaransi} onValueChange={(v) => setNewUnit({ ...newUnit, statusGaransi: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="GARANSI">GARANSI</SelectItem>
                  <SelectItem value="NON_GARANSI">NON-GARANSI</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5"><Label>Tgl Pembelian</Label><Input type="date" value={newUnit.tglPembelian} onChange={(e) => setNewUnit({ ...newUnit, tglPembelian: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUnitOpen(false)}>Batal</Button>
            <Button className="bg-emerald-600 hover:bg-emerald-700" disabled={!newUnit.serialNumber || !newUnit.modelUnit || addUnit.isPending} onClick={() => addUnit.mutate()}><Plus className="mr-1 h-4 w-4" /> Registrasi</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={userOpen} onOpenChange={setUserOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Tambah Karyawan</DialogTitle><DialogDescription>Manajemen peran pengelola sistem.</DialogDescription></DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5"><Label>Nama</Label><Input value={newUser.nama} onChange={(e) => setNewUser({ ...newUser, nama: e.target.value })} /></div>
            <div className="space-y-1.5"><Label>Email</Label><Input type="email" value={newUser.email} onChange={(e) => setNewUser({ ...newUser, email: e.target.value })} /></div>
            <div className="space-y-1.5">
              <Label>Peran</Label>
              <Select value={newUser.role} onValueChange={(v) => setNewUser({ ...newUser, role: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ADMIN_WORKSHOP">Admin Workshop</SelectItem>
                  <SelectItem value="TEKNISI">Teknisi Lapangan</SelectItem>
                  <SelectItem value="MANAGER">Manager</SelectItem>
                  <SelectItem value="PRODUSEN">Produsen</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5"><Label>No. WhatsApp</Label><Input value={newUser.noWa} onChange={(e) => setNewUser({ ...newUser, noWa: e.target.value })} placeholder="628xxx" /></div>
            <div className="space-y-1.5 sm:col-span-2"><Label>Wilayah Kerja (untuk teknisi)</Label><Input value={newUser.wilayahKerja} onChange={(e) => setNewUser({ ...newUser, wilayahKerja: e.target.value })} placeholder="cth: Jakarta Timur" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUserOpen(false)}>Batal</Button>
            <Button className="bg-emerald-600 hover:bg-emerald-700" disabled={!newUser.nama || !newUser.email || addUser.isPending} onClick={() => addUser.mutate()}><Plus className="mr-1 h-4 w-4" /> Simpan</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog stiker barcode */}
      <Dialog open={!!qrUnit} onOpenChange={(o) => !o && setQrUnit(null)}>
        <DialogContent className="sm:max-w-sm">
          {qrUnit && (
            <>
              <DialogHeader><DialogTitle>Stiker Barcode Unit</DialogTitle><DialogDescription>Format sesuai PRD Modul 1.2 — tempel di unit untuk dipindai teknisi onsite.</DialogDescription></DialogHeader>
              <div className="mx-auto w-full max-w-xs rounded-xl border-2 border-slate-200 bg-white p-4 text-center shadow-sm">
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Unit Asset Sticker</p>
                <p className="mt-1 font-mono text-sm font-bold text-slate-900">{qrUnit.serialNumber}</p>
                <p className="text-xs text-slate-600">{qrUnit.modelUnit}</p>
                {/* Barcode visual (Code-128 style dekoratif) */}
                <div className="mt-3 flex h-14 items-end justify-center gap-[2px] overflow-hidden" aria-hidden>
                  {barcodeData(qrUnit).split('').map((ch, i) => (
                    <div key={i} style={{ width: ((ch.charCodeAt(0) % 3) + 1), height: '100%', background: i % 2 ? '#fff' : '#1e293b' }} />
                  ))}
                </div>
                <p className="mt-1 break-all font-mono text-[9px] text-slate-500">{barcodeData(qrUnit)}</p>
                <div className="mt-2 flex justify-center gap-1">
                  <Badge variant="outline" className="text-[9px]">{qrUnit.statusGaransi.replace('_', '-')}</Badge>
                  <Badge variant="outline" className="text-[9px]">{qrUnit.toko?.kodeToko}</Badge>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setQrUnit(null)}>Tutup</Button>
                <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={() => { window.print() }}><Barcode className="mr-1 h-4 w-4" /> Cetak Stiker</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </Tabs>
  )
}
