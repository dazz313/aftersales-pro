'use client'

import { useMemo, useState } from 'react'
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
import CsvImportDialog from '@/components/csv-import-dialog'
import QuickSearch, { matchQuery } from '@/components/quick-search'
import SearchSelect from '@/components/search-select'
import HistoryInput from '@/components/history-input'
import { parseBrandRules, detectGaransi, type BrandRule } from '@/lib/brand'
import { AddTokoDialog, AddCustomerDialog } from '@/components/quick-entry'
import TokoBarcodeSticker from '@/components/toko-barcode-sticker'
import { Store, Users, QrCode, UserCog, Plus, MapPinOff, MapPinCheck, Barcode, Upload, KeyRound, Power, Pencil } from 'lucide-react'
import { cn } from '@/lib/utils'

export default function MasterDataView() {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const { role } = useAppStore()

  const { data: tokoList, isLoading: tokoLoading } = useQuery<Toko[]>({ queryKey: ['toko'], queryFn: () => fetcher<Toko[]>('/api/toko') })
  const { data: customerList, isLoading: customerLoading } = useQuery<Customer[]>({ queryKey: ['customers'], queryFn: () => fetcher<Customer[]>('/api/customer') })
  const { data: unitList, isLoading: unitLoading } = useQuery<UnitAsset[]>({ queryKey: ['units'], queryFn: () => fetcher<UnitAsset[]>('/api/unit') })
  const { data: userList } = useQuery<Pengguna[]>({ queryKey: ['pengguna'], queryFn: () => fetcher<Pengguna[]>('/api/pengguna') })
  const { data: brandSettings } = useQuery<{ map: Record<string, string> }>({
    queryKey: ['pengaturan-brand'],
    queryFn: () => fetcher<{ map: Record<string, string> }>('/api/pengaturan'),
  })
  const brandRules: BrandRule[] = useMemo(() => parseBrandRules(brandSettings?.map['brand_daftar']), [brandSettings])
  // Status garansi otomatis dari merk + tgl pembelian (false = user ubah manual)
  const [unitGaransiAuto, setUnitGaransiAuto] = useState(true)

  const setUnitMerk = (merk: string) => {
    const g = !newUnit.tokoId && merk.trim() && newUnit.tglPembelian ? detectGaransi(merk, new Date(newUnit.tglPembelian), brandRules) : null
    setNewUnit({ ...newUnit, merk, ...(g ? { statusGaransi: g } : {}) })
    if (g) setUnitGaransiAuto(true)
  }
  const setUnitTgl = (tgl: string) => {
    const g = !newUnit.tokoId && newUnit.merk.trim() && tgl ? detectGaransi(newUnit.merk, new Date(tgl), brandRules) : null
    setNewUnit({ ...newUnit, tglPembelian: tgl, ...(g ? { statusGaransi: g } : {}) })
    if (g) setUnitGaransiAuto(true)
  }

  // ===== Form states =====
  const [importTokoOpen, setImportTokoOpen] = useState(false)
  const [importUnitOpen, setImportUnitOpen] = useState(false)
  const [tokoOpen, setTokoOpen] = useState(false)
  const [custOpen, setCustOpen] = useState(false)
  const [stickerToko, setStickerToko] = useState<Toko | null>(null)
  const [unitOpen, setUnitOpen] = useState(false)
  const [newUnit, setNewUnit] = useState({ serialNumber: '', modelUnit: '', merk: '', nama: '', tokoId: '', customerId: '', statusGaransi: 'GARANSI', tglPembelian: '' })
  const [qrUnit, setQrUnit] = useState<UnitAsset | null>(null)
  const [userOpen, setUserOpen] = useState(false)
  const [newUser, setNewUser] = useState({ nama: '', email: '', username: '', kodeTeknisi: '', password: '', role: 'TEKNISI', noWa: '', wilayahKerja: '' })
  const [resetPwUser, setResetPwUser] = useState<Pengguna | null>(null)
  const [resetPwValue, setResetPwValue] = useState('')
  // Edit toko & customer
  const [editToko, setEditToko] = useState<Toko | null>(null)
  const [editTokoForm, setEditTokoForm] = useState({ namaToko: '', alamat: '', kontak: '', frekuensiVisit: '14' })
  const [editCust, setEditCust] = useState<Customer | null>(null)
  const [editCustForm, setEditCustForm] = useState({ nama: '', noWa: '', alamat: '' })
  // Edit unit
  const [editUnit, setEditUnit] = useState<UnitAsset | null>(null)
  const [editUnitForm, setEditUnitForm] = useState({ modelUnit: '', merk: '', nama: '', tokoId: '', customerId: '', statusGaransi: 'GARANSI', tglPembelian: '' })
  // Edit karyawan
  const [editUser, setEditUser] = useState<Pengguna | null>(null)
  const [editUserForm, setEditUserForm] = useState({ nama: '', email: '', username: '', kodeTeknisi: '', role: 'TEKNISI', noWa: '', wilayahKerja: '' })
  // Pencarian cepat per tab
  const [cariToko, setCariToko] = useState('')
  const [cariCust, setCariCust] = useState('')
  const [cariUnit, setCariUnit] = useState('')
  const [cariUser, setCariUser] = useState('')

  const invalidate = (keys: string[]) => {
    keys.forEach((k) => queryClient.invalidateQueries({ queryKey: [k] }))
    queryClient.invalidateQueries({ queryKey: ['audit'] })
  }

  const addUnit = useMutation({
    mutationFn: () => postJson('/api/unit', { ...newUnit, tokoId: newUnit.tokoId ? Number(newUnit.tokoId) : null, customerId: newUnit.customerId ? Number(newUnit.customerId) : null, tglPembelian: newUnit.tokoId ? null : newUnit.tglPembelian || null, aktor: role }),
    onSuccess: () => { invalidate(['units', 'toko', 'dashboard']); setUnitOpen(false); setNewUnit({ serialNumber: '', modelUnit: '', merk: '', nama: '', tokoId: '', customerId: '', statusGaransi: 'GARANSI', tglPembelian: '' }); setUnitGaransiAuto(true); toast({ title: 'Unit asset teregistrasi', description: 'Stiker barcode/QR dapat dicetak.' }) },
    onError: (e: Error) => toast({ title: 'Gagal', description: e.message, variant: 'destructive' }),
  })
  const addUser = useMutation({
    mutationFn: () => postJson('/api/pengguna', { ...newUser, username: newUser.username.trim() || undefined, kodeTeknisi: newUser.kodeTeknisi.trim() || undefined, password: newUser.password.trim() || undefined, aktor: role }),
    onSuccess: () => { invalidate(['pengguna']); setUserOpen(false); setNewUser({ nama: '', email: '', username: '', kodeTeknisi: '', password: '', role: 'TEKNISI', noWa: '', wilayahKerja: '' }); toast({ title: 'Karyawan ditambahkan', description: 'Akun login siap digunakan.' }) },
    onError: (e: Error) => toast({ title: 'Gagal', description: e.message, variant: 'destructive' }),
  })
  const updateUser = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Record<string, unknown> }) => postJson<Pengguna>(`/api/pengguna/${id}`, { ...data, aktor: role }, 'PATCH'),
    onSuccess: (u) => { invalidate(['pengguna']); setEditUser(null); toast({ title: 'Karyawan diperbarui', description: `Data ${u.nama} tersimpan.` }) },
    onError: (e: Error) => toast({ title: 'Gagal memperbarui karyawan', description: e.message, variant: 'destructive' }),
  })
  const updateToko = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Record<string, unknown> }) => postJson<Toko>(`/api/toko/${id}`, { ...data, aktor: role }, 'PATCH'),
    onSuccess: (t) => { invalidate(['toko', 'dashboard', 'alerts', 'kunjungan', 'units']); setEditToko(null); toast({ title: 'Toko diperbarui', description: `Data ${t.namaToko} tersimpan.` }) },
    onError: (e: Error) => toast({ title: 'Gagal memperbarui toko', description: e.message, variant: 'destructive' }),
  })
  const updateCust = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Record<string, unknown> }) => postJson<Customer>(`/api/customer/${id}`, { ...data, aktor: role }, 'PATCH'),
    onSuccess: (c) => { invalidate(['customers', 'units']); setEditCust(null); toast({ title: 'Customer diperbarui', description: `Data ${c.nama} tersimpan.` }) },
    onError: (e: Error) => toast({ title: 'Gagal memperbarui customer', description: e.message, variant: 'destructive' }),
  })
  const openEditUnit = (u: UnitAsset) => {
    setEditUnit(u)
    setEditUnitForm({
      modelUnit: u.modelUnit,
      merk: u.merk ?? '',
      nama: u.nama ?? '',
      tokoId: u.tokoId ? String(u.tokoId) : '',
      customerId: u.customerId ? String(u.customerId) : '',
      statusGaransi: u.statusGaransi,
      tglPembelian: u.tglPembelian ? new Date(u.tglPembelian).toISOString().slice(0, 10) : '',
    })
  }
  const updateUnit = useMutation({
    mutationFn: () =>
      postJson(`/api/unit/${editUnit!.id}`, {
        modelUnit: editUnitForm.modelUnit.trim(),
        merk: editUnitForm.merk.trim(),
        nama: editUnitForm.nama.trim(),
        tokoId: editUnitForm.tokoId ? Number(editUnitForm.tokoId) : null,
        customerId: editUnitForm.customerId ? Number(editUnitForm.customerId) : null,
        statusGaransi: editUnitForm.statusGaransi,
        tglPembelian: editUnitForm.tokoId ? null : editUnitForm.tglPembelian || null,
        aktor: role,
      }, 'PATCH'),
    onSuccess: () => {
      invalidate(['units', 'toko', 'dashboard', 'service-tickets'])
      setEditUnit(null)
      toast({ title: 'Unit diperbarui', description: 'Koreksi data tersimpan.' })
    },
    onError: (e: Error) => toast({ title: 'Gagal memperbarui unit', description: e.message, variant: 'destructive' }),
  })
  const resetPw = useMutation({
    mutationFn: () => postJson(`/api/pengguna/${resetPwUser!.id}`, { password: resetPwValue, aktor: role }, 'PATCH'),
    onSuccess: () => { invalidate(['pengguna']); setResetPwUser(null); setResetPwValue(''); toast({ title: 'Password direset', description: 'Karyawan dapat login dengan password baru.' }) },
    onError: (e: Error) => toast({ title: 'Gagal', description: e.message, variant: 'destructive' }),
  })

  const barcodeData = (u: UnitAsset) => `SN:${u.serialNumber}|MOD:${u.modelUnit}|TOK:${u.toko?.kodeToko ?? '-'}`

  const tokoTampil = useMemo(
    () => (tokoList ?? []).filter((t) => matchQuery([t.kodeToko, t.namaToko, t.alamat, t.kontak, t.barcodeToko], cariToko)),
    [tokoList, cariToko]
  )
  const custTampil = useMemo(
    () => (customerList ?? []).filter((c) => matchQuery([c.nama, c.noWa, c.alamat, ...c.unitAssets.map((u) => u.modelUnit)], cariCust)),
    [customerList, cariCust]
  )
  const unitTampil = useMemo(
    () => (unitList ?? []).filter((u) => matchQuery([u.serialNumber, u.modelUnit, u.merk, u.nama, u.toko?.kodeToko, u.toko?.namaToko, u.customer?.nama, u.statusGaransi], cariUnit)),
    [unitList, cariUnit]
  )
  const userTampil = useMemo(
    () => (userList ?? []).filter((u) => matchQuery([u.nama, u.email, u.username, u.kodeTeknisi, u.noWa, u.wilayahKerja, u.role], cariUser)),
    [userList, cariUser]
  )

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
              <CardDescription>Profil toko, siklus kunjungan, barcode toko untuk scan kunjungan, dan kepatuhan (ALT-01) · {tokoTampil.length} toko, gulir di dalam tabel</CardDescription>
            </div>
            <div className="flex shrink-0 flex-wrap justify-end gap-2">
              <Button size="sm" variant="outline" onClick={() => setImportTokoOpen(true)}>
                <Upload className="mr-1 h-4 w-4" /> Import CSV
              </Button>
              <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={() => setTokoOpen(true)}><Plus className="mr-1 h-4 w-4" /> Toko Baru</Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="mb-3">
              <QuickSearch value={cariToko} onChange={setCariToko} placeholder="Cari kode / nama / alamat / kontak toko…" className="max-w-xs" resultCount={tokoTampil.length} />
            </div>
            {tokoLoading ? (
              <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
            ) : (
              <div className="max-h-[60vh] overflow-auto rounded-md border [&_thead]:sticky [&_thead]:top-0 [&_thead]:z-10 [&_thead]:bg-white [&_thead]:shadow-[0_1px_0_rgb(0_0_0/0.08)]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Kode · Nama</TableHead>
                      <TableHead className="hidden md:table-cell">Alamat</TableHead>
                      <TableHead className="hidden sm:table-cell">Kontak</TableHead>
                      <TableHead>Siklus</TableHead>
                      <TableHead>Visit Terakhir</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Aksi</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {tokoTampil.map((t) => (
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
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" onClick={() => { setEditToko(t); setEditTokoForm({ namaToko: t.namaToko, alamat: t.alamat ?? '', kontak: t.kontak ?? '', frekuensiVisit: String(t.frekuensiVisit) }) }} aria-label={`Edit ${t.namaToko}`}>
                              <Pencil className="mr-1 h-3 w-3" /> Edit
                            </Button>
                            <Button size="sm" variant="outline" className="h-7 px-2 font-mono text-[11px]" onClick={() => setStickerToko(t)}>
                              <Barcode className="mr-1 h-3 w-3" /> {t.barcodeToko}
                            </Button>
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
            <div className="mb-3">
              <QuickSearch value={cariCust} onChange={setCariCust} placeholder="Cari nama / WA / alamat customer…" className="max-w-xs" resultCount={custTampil.length} />
            </div>
            {customerLoading ? (
              <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {custTampil.map((c) => (
                  <div key={c.id} className="rounded-xl border p-4">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-semibold text-slate-800">{c.nama}</p>
                      <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-slate-500 hover:text-emerald-700" onClick={() => { setEditCust(c); setEditCustForm({ nama: c.nama, noWa: c.noWa ?? '', alamat: c.alamat ?? '' }) }} aria-label={`Edit ${c.nama}`} title="Edit customer">
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    </div>
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
                {custTampil.length === 0 && (
                  <p className="py-8 text-center text-sm text-slate-500 sm:col-span-2 xl:col-span-3">Tidak ada customer yang cocok dengan pencarian.</p>
                )}
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
            <div className="flex shrink-0 flex-wrap justify-end gap-2">
              <Button size="sm" variant="outline" onClick={() => setImportUnitOpen(true)}>
                <Upload className="mr-1 h-4 w-4" /> Import CSV
              </Button>
              <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={() => setUnitOpen(true)}><Plus className="mr-1 h-4 w-4" /> Registrasi Unit</Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="mb-3">
              <QuickSearch value={cariUnit} onChange={setCariUnit} placeholder="Cari serial / model / toko / pemilik…" className="max-w-xs" resultCount={unitTampil.length} />
            </div>
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
                    {unitTampil.map((u) => (
                      <TableRow key={u.id}>
                        <TableCell>
                          <p className="text-xs font-semibold text-slate-800">{u.modelUnit}</p>
                          <p className="font-mono text-[10px] text-slate-400">{u.serialNumber}</p>
                          {(u.merk?.trim() || u.nama?.trim()) && (
                            <p className="text-[10px] text-slate-500">{[u.merk?.trim(), u.nama?.trim()].filter(Boolean).join(' · ')}</p>
                          )}
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
                          <div className="flex items-center justify-end gap-1">
                            <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px] text-slate-500 hover:text-emerald-700" onClick={() => openEditUnit(u)} aria-label={`Edit ${u.serialNumber}`} title="Edit unit">
                              <Pencil className="h-3 w-3" />
                            </Button>
                            <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" onClick={() => setQrUnit(u)}>
                              <Barcode className="mr-1 h-3 w-3" /> Stiker
                            </Button>
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
            <div className="mb-3">
              <QuickSearch value={cariUser} onChange={setCariUser} placeholder="Cari nama / email / username / wilayah…" className="max-w-xs" resultCount={userTampil.length} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {userTampil.map((u) => (
                <div key={u.id} className="flex items-start gap-3 rounded-xl border p-4">
                  <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white',
                    !u.aktif ? 'bg-slate-400' : u.role === 'ADMIN_WORKSHOP' ? 'bg-emerald-600' : u.role === 'TEKNISI' ? 'bg-amber-500' : u.role === 'MANAGER' ? 'bg-violet-600' : 'bg-teal-600')}>
                    {u.nama.slice(0, 1).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-800">{u.nama}</p>
                    <p className="truncate text-xs text-slate-500">{u.email}</p>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      <Badge variant="outline" className="text-[9px]">{u.role.replace('_', ' ')}</Badge>
                      {u.username && <Badge variant="outline" className="font-mono text-[9px]">@{u.username}</Badge>}
                      {u.kodeTeknisi && <Badge variant="outline" className="border-teal-300 font-mono text-[9px] text-teal-700">{u.kodeTeknisi}</Badge>}
                      {u.wilayahKerja && <Badge variant="outline" className="text-[9px]">Wil. {u.wilayahKerja}</Badge>}
                      {u.jumlahKunjungan != null && u.role === 'TEKNISI' && <Badge variant="outline" className="text-[9px]">{u.jumlahKunjungan} kunjungan</Badge>}
                      {!u.aktif && <Badge variant="outline" className="border-red-300 bg-red-50 text-[9px] text-red-700">Nonaktif</Badge>}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col gap-1">
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-slate-500 hover:text-emerald-700" onClick={() => { setEditUser(u); setEditUserForm({ nama: u.nama, email: u.email, username: u.username ?? '', kodeTeknisi: u.kodeTeknisi ?? '', role: u.role, noWa: u.noWa ?? '', wilayahKerja: u.wilayahKerja ?? '' }) }} aria-label={`Edit ${u.nama}`} title="Edit data karyawan">
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-slate-500 hover:text-emerald-700" onClick={() => { setResetPwUser(u); setResetPwValue('') }} aria-label={`Reset password ${u.nama}`} title="Reset password login">
                      <KeyRound className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className={cn('h-7 w-7 text-slate-500', u.aktif ? 'hover:text-red-600' : 'hover:text-emerald-600')} onClick={() => updateUser.mutate({ id: u.id, data: { aktif: !u.aktif } })} aria-label={u.aktif ? `Nonaktifkan akun ${u.nama}` : `Aktifkan akun ${u.nama}`} title={u.aktif ? 'Nonaktifkan akun (tidak bisa login)' : 'Aktifkan akun'} disabled={updateUser.isPending}>
                      <Power className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
              {userTampil.length === 0 && (
                <p className="py-8 text-center text-sm text-slate-500 sm:col-span-2 xl:col-span-3">Tidak ada karyawan yang cocok dengan pencarian.</p>
              )}
            </div>
          </CardContent>
        </Card>
      </TabsContent>

      {/* ===== Dialogs ===== */}
      {/* Add Toko & Add Customer — komponen shared (dipakai juga di Akses Cepat Dashboard) */}
      <AddTokoDialog open={tokoOpen} onOpenChange={setTokoOpen} />
      <AddCustomerDialog open={custOpen} onOpenChange={setCustOpen} />

      <Dialog open={unitOpen} onOpenChange={setUnitOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>Registrasi Unit Asset</DialogTitle><DialogDescription>Unit baru akan mendapat serial number unik untuk stiker barcode/QR.</DialogDescription></DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5"><Label>Serial Number</Label><Input value={newUnit.serialNumber} onChange={(e) => setNewUnit({ ...newUnit, serialNumber: e.target.value.toUpperCase() })} placeholder="SN-ACSP-2026-XXXXX" className="font-mono" /></div>
            <div className="space-y-1.5"><Label>Model / Tipe Unit</Label><HistoryInput historyKey="unit-model" value={newUnit.modelUnit} onChange={(e) => setNewUnit({ ...newUnit, modelUnit: e.target.value })} placeholder="AC Split 1 PK ..." /></div>
            <div className="space-y-1.5"><Label>Merk</Label><HistoryInput historyKey="unit-merk" suggestions={brandRules.map((b) => b.nama)} value={newUnit.merk} onChange={(e) => setUnitMerk(e.target.value)} placeholder="cth: Miyako, Rinnai, Shimizu" /></div>
            <div className="space-y-1.5"><Label>Nama Unit (opsional)</Label><HistoryInput historyKey="unit-nama" value={newUnit.nama} onChange={(e) => setNewUnit({ ...newUnit, nama: e.target.value })} placeholder="cth: AC Ruang Tamu" /></div>
            <div className="space-y-1.5">
              <Label>Toko Mitra</Label>
              <SearchSelect
                value={newUnit.tokoId}
                onChange={(v) => setNewUnit({ ...newUnit, tokoId: v, ...(v ? { statusGaransi: 'GARANSI' } : {}) })}
                options={(tokoList ?? []).map((t) => ({ value: String(t.id), label: `${t.kodeToko} — ${t.namaToko}` }))}
                placeholder="— Ketik kode/nama toko —"
                ariaLabel="Pilih toko mitra"
              />
              {newUnit.tokoId && (
                <p className="text-[11px] text-emerald-700">Stok toko — otomatis GARANSI, tgl pembelian dinonaktifkan.</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Customer</Label>
              <SearchSelect
                value={newUnit.customerId}
                onChange={(v) => setNewUnit({ ...newUnit, customerId: v })}
                options={(customerList ?? []).map((c) => ({ value: String(c.id), label: c.nama, sub: c.noWa ?? undefined }))}
                placeholder="— Ketik nama customer —"
                ariaLabel="Pilih customer"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Status Garansi {unitGaransiAuto && newUnit.merk.trim() && newUnit.tglPembelian ? <span className="font-normal text-emerald-700">(otomatis dari masa garansi)</span> : null}</Label>
              <Select value={newUnit.statusGaransi} onValueChange={(v) => { setNewUnit({ ...newUnit, statusGaransi: v }); setUnitGaransiAuto(false) }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="GARANSI">GARANSI</SelectItem>
                  <SelectItem value="NON_GARANSI">NON-GARANSI</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5"><Label>Tgl Pembelian {newUnit.tokoId ? '— nonaktif (stok toko)' : ''}</Label><Input type="date" value={newUnit.tokoId ? '' : newUnit.tglPembelian} onChange={(e) => setUnitTgl(e.target.value)} disabled={!!newUnit.tokoId} /></div>
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
            <div className="space-y-1.5"><Label>Nama</Label><HistoryInput historyKey="user-nama" value={newUser.nama} onChange={(e) => setNewUser({ ...newUser, nama: e.target.value })} /></div>
            <div className="space-y-1.5"><Label>Email</Label><Input type="email" value={newUser.email} onChange={(e) => setNewUser({ ...newUser, email: e.target.value })} /></div>
            <div className="space-y-1.5"><Label>Username (opsional)</Label><Input value={newUser.username} onChange={(e) => setNewUser({ ...newUser, username: e.target.value })} placeholder="otomatis dari email" /></div>
            <div className="space-y-1.5"><Label>Kode Teknisi (opsional)</Label><Input value={newUser.kodeTeknisi} onChange={(e) => setNewUser({ ...newUser, kodeTeknisi: e.target.value.toUpperCase() })} placeholder="cth: TKN-001" className="font-mono" /></div>
            <div className="space-y-1.5"><Label>Password (opsional)</Label><Input type="password" value={newUser.password} onChange={(e) => setNewUser({ ...newUser, password: e.target.value })} placeholder="default: aftersales123" /></div>
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
            <div className="space-y-1.5 sm:col-span-2"><Label>Wilayah Kerja (untuk teknisi)</Label><HistoryInput historyKey="user-wilayah" value={newUser.wilayahKerja} onChange={(e) => setNewUser({ ...newUser, wilayahKerja: e.target.value })} placeholder="cth: Jakarta Timur" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUserOpen(false)}>Batal</Button>
            <Button className="bg-emerald-600 hover:bg-emerald-700" disabled={!newUser.nama || !newUser.email || addUser.isPending} onClick={() => addUser.mutate()}><Plus className="mr-1 h-4 w-4" /> Simpan</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog edit karyawan */}
      <Dialog open={!!editUser} onOpenChange={(o) => !o && setEditUser(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Karyawan</DialogTitle>
            <DialogDescription>Perubahan email/username langsung berlaku untuk login berikutnya.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5"><Label>Nama</Label><HistoryInput historyKey="user-nama" value={editUserForm.nama} onChange={(e) => setEditUserForm({ ...editUserForm, nama: e.target.value })} /></div>
            <div className="space-y-1.5"><Label>Email (login)</Label><Input type="email" value={editUserForm.email} onChange={(e) => setEditUserForm({ ...editUserForm, email: e.target.value })} /></div>
            <div className="space-y-1.5"><Label>Username (opsional)</Label><Input value={editUserForm.username} onChange={(e) => setEditUserForm({ ...editUserForm, username: e.target.value })} placeholder="kosongkan bila tak dipakai" /></div>
            <div className="space-y-1.5"><Label>Kode Teknisi (opsional)</Label><Input value={editUserForm.kodeTeknisi} onChange={(e) => setEditUserForm({ ...editUserForm, kodeTeknisi: e.target.value.toUpperCase() })} placeholder="cth: TKN-001" className="font-mono" /></div>
            <div className="space-y-1.5">
              <Label>Peran</Label>
              <Select value={editUserForm.role} onValueChange={(v) => setEditUserForm({ ...editUserForm, role: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ADMIN_WORKSHOP">Admin Workshop</SelectItem>
                  <SelectItem value="TEKNISI">Teknisi Lapangan</SelectItem>
                  <SelectItem value="MANAGER">Manager</SelectItem>
                  <SelectItem value="PRODUSEN">Produsen</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5"><Label>No. WhatsApp</Label><Input value={editUserForm.noWa} onChange={(e) => setEditUserForm({ ...editUserForm, noWa: e.target.value })} placeholder="628xxx" /></div>
            <div className="space-y-1.5"><Label>Wilayah Kerja</Label><HistoryInput historyKey="user-wilayah" value={editUserForm.wilayahKerja} onChange={(e) => setEditUserForm({ ...editUserForm, wilayahKerja: e.target.value })} placeholder="cth: Jakarta Timur" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditUser(null)}>Batal</Button>
            <Button
              className="bg-emerald-600 hover:bg-emerald-700"
              disabled={!editUser || !editUserForm.nama.trim() || !editUserForm.email.trim() || updateUser.isPending}
              onClick={() => editUser && updateUser.mutate({
                id: editUser.id,
                data: {
                  nama: editUserForm.nama.trim(),
                  email: editUserForm.email.trim(),
                  username: editUserForm.username.trim() || null,
                  kodeTeknisi: editUserForm.kodeTeknisi.trim() || null,
                  role: editUserForm.role,
                  noWa: editUserForm.noWa.trim() || null,
                  wilayahKerja: editUserForm.wilayahKerja.trim() || null,
                },
              })}
            >
              <Pencil className="mr-1 h-4 w-4" /> Simpan Perubahan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog reset password karyawan */}
      <Dialog open={!!resetPwUser} onOpenChange={(o) => { if (!o) setResetPwUser(null) }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Reset Password Login</DialogTitle>
            <DialogDescription>
              Setel password baru untuk <span className="font-medium text-slate-700">{resetPwUser?.nama}</span> ({resetPwUser?.email}).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="reset-password">Password Baru</Label>
            <Input
              id="reset-password"
              type="text"
              value={resetPwValue}
              onChange={(e) => setResetPwValue(e.target.value)}
              placeholder="minimal 6 karakter"
              autoComplete="off"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetPwUser(null)}>Batal</Button>
            <Button className="bg-emerald-600 hover:bg-emerald-700" disabled={resetPwValue.length < 6 || resetPw.isPending} onClick={() => resetPw.mutate()}>
              Simpan Password
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog edit toko */}
      <Dialog open={!!editToko} onOpenChange={(o) => !o && setEditToko(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Toko {editToko && <span className="font-mono text-sm text-slate-500">{editToko.kodeToko}</span>}</DialogTitle>
            <DialogDescription>Kode toko &amp; barcode tidak dapat diubah karena dipakai di unit, kunjungan, dan tiket.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2"><Label>Nama Toko</Label><HistoryInput historyKey="toko-nama" value={editTokoForm.namaToko} onChange={(e) => setEditTokoForm({ ...editTokoForm, namaToko: e.target.value })} /></div>
            <div className="space-y-1.5 sm:col-span-2"><Label>Alamat</Label><HistoryInput historyKey="toko-alamat" value={editTokoForm.alamat} onChange={(e) => setEditTokoForm({ ...editTokoForm, alamat: e.target.value })} placeholder="—" /></div>
            <div className="space-y-1.5"><Label>Kontak</Label><Input value={editTokoForm.kontak} onChange={(e) => setEditTokoForm({ ...editTokoForm, kontak: e.target.value })} placeholder="—" /></div>
            <div className="space-y-1.5"><Label>Siklus Visit (hari)</Label><Input type="number" min="1" value={editTokoForm.frekuensiVisit} onChange={(e) => setEditTokoForm({ ...editTokoForm, frekuensiVisit: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditToko(null)}>Batal</Button>
            <Button
              className="bg-emerald-600 hover:bg-emerald-700"
              disabled={!editToko || !editTokoForm.namaToko.trim() || Number(editTokoForm.frekuensiVisit) < 1 || updateToko.isPending}
              onClick={() => editToko && updateToko.mutate({ id: editToko.id, data: { namaToko: editTokoForm.namaToko.trim(), alamat: editTokoForm.alamat.trim() || null, kontak: editTokoForm.kontak.trim() || null, frekuensiVisit: Number(editTokoForm.frekuensiVisit) } })}
            >
              <Pencil className="mr-1 h-4 w-4" /> Simpan Perubahan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog edit customer */}
      <Dialog open={!!editCust} onOpenChange={(o) => !o && setEditCust(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Customer</DialogTitle>
            <DialogDescription>Perubahan nama langsung tercermin di unit milik customer ini.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="space-y-1.5"><Label>Nama</Label><HistoryInput historyKey="customer-nama" value={editCustForm.nama} onChange={(e) => setEditCustForm({ ...editCustForm, nama: e.target.value })} /></div>
            <div className="space-y-1.5"><Label>No. WhatsApp</Label><Input value={editCustForm.noWa} onChange={(e) => setEditCustForm({ ...editCustForm, noWa: e.target.value })} placeholder="628xxx" /></div>
            <div className="space-y-1.5"><Label>Alamat</Label><HistoryInput historyKey="customer-alamat" value={editCustForm.alamat} onChange={(e) => setEditCustForm({ ...editCustForm, alamat: e.target.value })} placeholder="—" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditCust(null)}>Batal</Button>
            <Button
              className="bg-emerald-600 hover:bg-emerald-700"
              disabled={!editCust || !editCustForm.nama.trim() || updateCust.isPending}
              onClick={() => editCust && updateCust.mutate({ id: editCust.id, data: { nama: editCustForm.nama.trim(), noWa: editCustForm.noWa.trim() || null, alamat: editCustForm.alamat.trim() || null } })}
            >
              <Pencil className="mr-1 h-4 w-4" /> Simpan Perubahan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog edit unit */}
      <Dialog open={!!editUnit} onOpenChange={(o) => !o && setEditUnit(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Unit {editUnit && <span className="font-mono text-sm text-slate-500">{editUnit.serialNumber}</span>}</DialogTitle>
            <DialogDescription>Nomor seri tidak dapat diubah karena dipakai di tiket &amp; barcode.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5"><Label>Model / Tipe Unit</Label><HistoryInput historyKey="unit-model" value={editUnitForm.modelUnit} onChange={(e) => setEditUnitForm({ ...editUnitForm, modelUnit: e.target.value })} /></div>
            <div className="space-y-1.5"><Label>Merk</Label><HistoryInput historyKey="unit-merk" suggestions={brandRules.map((b) => b.nama)} value={editUnitForm.merk} onChange={(e) => setEditUnitForm({ ...editUnitForm, merk: e.target.value })} /></div>
            <div className="space-y-1.5 sm:col-span-2"><Label>Nama Unit (opsional)</Label><HistoryInput historyKey="unit-nama" value={editUnitForm.nama} onChange={(e) => setEditUnitForm({ ...editUnitForm, nama: e.target.value })} /></div>
            <div className="space-y-1.5">
              <Label>Toko Mitra</Label>
              <SearchSelect
                value={editUnitForm.tokoId}
                onChange={(v) => setEditUnitForm({ ...editUnitForm, tokoId: v, ...(v ? { statusGaransi: 'GARANSI' } : {}) })}
                options={(tokoList ?? []).map((t) => ({ value: String(t.id), label: `${t.kodeToko} — ${t.namaToko}` }))}
                placeholder="— Tanpa toko —"
                ariaLabel="Pilih toko mitra"
              />
              {editUnitForm.tokoId && (
                <p className="text-[11px] text-emerald-700">Stok toko — otomatis GARANSI, tgl pembelian dinonaktifkan.</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Customer</Label>
              <SearchSelect
                value={editUnitForm.customerId}
                onChange={(v) => setEditUnitForm({ ...editUnitForm, customerId: v })}
                options={(customerList ?? []).map((c) => ({ value: String(c.id), label: c.nama, sub: c.noWa ?? undefined }))}
                placeholder="— Tanpa customer —"
                ariaLabel="Pilih customer"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Status Garansi</Label>
              <Select value={editUnitForm.statusGaransi} onValueChange={(v) => setEditUnitForm({ ...editUnitForm, statusGaransi: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="GARANSI">GARANSI</SelectItem>
                  <SelectItem value="NON_GARANSI">NON-GARANSI</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5"><Label>Tgl Pembelian {editUnitForm.tokoId ? '— nonaktif (stok toko)' : ''}</Label><Input type="date" value={editUnitForm.tokoId ? '' : editUnitForm.tglPembelian} onChange={(e) => setEditUnitForm({ ...editUnitForm, tglPembelian: e.target.value })} disabled={!!editUnitForm.tokoId} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditUnit(null)}>Batal</Button>
            <Button
              className="bg-emerald-600 hover:bg-emerald-700"
              disabled={!editUnit || !editUnitForm.modelUnit.trim() || updateUnit.isPending}
              onClick={() => updateUnit.mutate()}
            >
              <Pencil className="mr-1 h-4 w-4" /> Simpan Perubahan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog import massal unit via CSV */}
      <CsvImportDialog
        kind="unit"
        open={importUnitOpen}
        onOpenChange={setImportUnitOpen}
        existingCodes={(unitList ?? []).map((u) => u.serialNumber)}
        onSuccess={(r) => {
          invalidate(['units', 'toko', 'dashboard', 'alerts'])
          toast({
            title: 'Import unit selesai',
            description: `${r.inserted} unit ditambahkan, ${r.updated} diperbarui, ${r.skipped} dilewati, ${r.failed} gagal.`,
          })
        }}
      />

      {/* Dialog import massal toko via CSV */}
      <CsvImportDialog
        kind="toko"
        open={importTokoOpen}
        onOpenChange={setImportTokoOpen}
        existingCodes={(tokoList ?? []).map((t) => t.kodeToko)}
        onSuccess={(r) => {
          invalidate(['toko', 'dashboard', 'alerts', 'kunjungan', 'units'])
          toast({
            title: 'Import toko selesai',
            description: `${r.inserted} toko ditambahkan, ${r.updated} diperbarui, ${r.skipped} dilewati, ${r.failed} gagal.`,
          })
        }}
      />

      {/* Dialog stiker barcode toko (Code-128 asli — dipindai saat kunjungan) */}
      <TokoBarcodeSticker toko={stickerToko} onOpenChange={(o) => !o && setStickerToko(null)} />

      {/* Dialog stiker barcode unit */}
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
