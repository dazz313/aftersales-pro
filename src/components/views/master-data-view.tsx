'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
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
import { Checkbox } from '@/components/ui/checkbox'
import { useToast } from '@/hooks/use-toast'
import { useAppStore } from '@/lib/store'
import CsvImportDialog from '@/components/csv-import-dialog'
import QuickSearch, { matchQuery } from '@/components/quick-search'
import SearchSelect from '@/components/search-select'
import HistoryInput from '@/components/history-input'
import { parseBrandRules, detectGaransi, type BrandRule } from '@/lib/brand'
import { AddTokoDialog, AddCustomerDialog } from '@/components/quick-entry'
import TokoBarcodeSticker from '@/components/toko-barcode-sticker'
import UnitBarcodeSticker from '@/components/unit-barcode-sticker'
import { GARANSI_LABEL } from '@/lib/types'
import { Store, Users, QrCode, UserCog, Plus, MapPinOff, MapPinCheck, Barcode, Upload, KeyRound, Power, Pencil, PackagePlus, X, Trash2, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'

// Peringatan nomor seri ganda — tampil live saat mengetik (sebelum tombol ditekan),
// supaya inputer langsung tahu faktanya dan tidak menekan Registrasi berulang-ulang.
function DupSerialWarning({ existing, mode, tokoIdSekarang }: { existing: UnitAsset; mode: 'registrasi' | 'edit'; tokoIdSekarang?: string }) {
  const pemilikLama = existing.toko
    ? `${existing.toko.kodeToko} — ${existing.toko.namaToko}`
    : existing.customer?.nama
      ? `customer ${existing.customer.nama}`
      : 'tanpa toko'
  const pesan =
    mode === 'edit'
      ? 'Nomor seri ini sudah terdaftar di unit lain — ganti ke nomor yang belum terpakai.'
      : (existing.tokoId ? String(existing.tokoId) : '') === (tokoIdSekarang ?? '')
        ? 'Nomor seri ini sudah terdaftar di toko yang sama — input ganda, Registrasi akan ditolak.'
        : 'Nomor seri ini sudah terdaftar — periksa data, jangan input ulang.'
  return (
    <div role="alert" className="rounded-md border border-red-300 bg-red-50 px-2.5 py-1.5 text-[11px] leading-snug text-red-700">
      <p className="flex items-start gap-1.5 font-semibold"><AlertTriangle aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />{pesan}</p>
      <p className="mt-0.5 pl-5 font-mono">{existing.serialNumber} · {existing.modelUnit} · {pemilikLama}</p>
    </div>
  )
}

export default function MasterDataView() {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const { role, navIntent, clearNavIntent } = useAppStore()
  // Tab aktif — bisa dibuka langsung dari Dashboard via intent (mis. indikator unit belum diproses)
  const [tabAktif, setTabAktif] = useState('toko')

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
  const [newUnit, setNewUnit] = useState({ serialNumber: '', modelUnit: '', merk: '', nama: '', tokoId: '', customerId: '', statusGaransi: 'GARANSI', tglPembelian: '', tglInput: '' })
  // Buka dialog registrasi — default tanggal input = hari ini (bisa dimundurkan untuk susulan)
  const openUnitRegistrasi = () => {
    if (!newUnit.tglInput) {
      const d = new Date()
      const p = (n: number) => String(n).padStart(2, '0')
      setNewUnit({ ...newUnit, tglInput: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` })
    }
    setUnitOpen(true)
  }
  const [qrUnit, setQrUnit] = useState<UnitAsset | null>(null)
  const [userOpen, setUserOpen] = useState(false)
  const [newUser, setNewUser] = useState({ nama: '', email: '', username: '', kodeTeknisi: '', password: '', role: 'TEKNISI', noWa: '', wilayahKerja: '' })
  const [resetPwUser, setResetPwUser] = useState<Pengguna | null>(null)
  const [resetPwValue, setResetPwValue] = useState('')
  // Edit toko & customer
  const [editToko, setEditToko] = useState<Toko | null>(null)
  const [editTokoForm, setEditTokoForm] = useState({ namaToko: '', alamat: '', kontak: '', frekuensiVisit: '14', jarakKm: '' })
  // Hapus massal toko (khusus Admin/Manager — centang baris lalu hapus sekaligus)
  const [tokoDipilih, setTokoDipilih] = useState<Set<number>>(new Set())
  const [hapusTokoOpen, setHapusTokoOpen] = useState(false)
  const bisaHapusToko = role === 'ADMIN_WORKSHOP' || role === 'MANAGER'
  // Hapus massal unit (centang baris tanpa tiket lalu hapus sekaligus)
  const [unitDipilih, setUnitDipilih] = useState<Set<number>>(new Set())
  const [hapusUnitOpen, setHapusUnitOpen] = useState(false)
  const [editCust, setEditCust] = useState<Customer | null>(null)
  const [editCustForm, setEditCustForm] = useState({ nama: '', noWa: '', alamat: '' })
  // Edit unit
  const [editUnit, setEditUnit] = useState<UnitAsset | null>(null)
  // Koreksi nomor seri unit bertiket (hanya Admin Workshop/Manager) wajib dikonfirmasi centang dulu
  const [konfirmasiKoreksiSN, setKonfirmasiKoreksiSN] = useState(false)
  // Hapus unit (koreksi kesalahan input registrasi)
  const [deleteUnit, setDeleteUnit] = useState<UnitAsset | null>(null)
  const [editUnitForm, setEditUnitForm] = useState({ serialNumber: '', modelUnit: '', merk: '', nama: '', tokoId: '', customerId: '', statusGaransi: 'GARANSI', tglPembelian: '', tglInput: '' })
  // Quick input kode+nama part dari Master Data → tiket + otomatis PROSES
  const [partUnit, setPartUnit] = useState<UnitAsset | null>(null)
  // Multi-part: 1 unit bisa butuh >1 kode+nama part berbeda — tiap baris satu
  // kode (anti-pengulangan: kode sama ditolak, dicek client & server).
  type PartUnitRow = { key: number; kodePart: string; namaPart: string; qty: string }
  const [partForm, setPartForm] = useState({
    deskripsi: '',
    jasa: '0',
    tgl: '',
    rows: [{ key: 0, kodePart: '', namaPart: '', qty: '1' }] as PartUnitRow[],
  })
  const nextPartRowKey = useRef(1)
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

  // Konsumsi navIntent dari Dashboard → buka tab yang diminta lalu bersihkan
  useEffect(() => {
    if (!navIntent?.masterTab) return
    const t = setTimeout(() => {
      setTabAktif(navIntent.masterTab as string)
      clearNavIntent()
    }, 0)
    return () => clearTimeout(t)
  }, [navIntent, clearNavIntent])

  const addUnit = useMutation({
    mutationFn: () => postJson('/api/unit', { ...newUnit, tokoId: newUnit.tokoId ? Number(newUnit.tokoId) : null, customerId: newUnit.customerId ? Number(newUnit.customerId) : null, tglPembelian: newUnit.tokoId ? null : newUnit.tglPembelian || null, tglInput: newUnit.tglInput ? new Date(newUnit.tglInput).toISOString() : undefined, aktor: role }),
    onSuccess: () => { invalidate(['units', 'toko', 'dashboard']); setUnitOpen(false); setNewUnit({ serialNumber: '', modelUnit: '', merk: '', nama: '', tokoId: '', customerId: '', statusGaransi: 'GARANSI', tglPembelian: '', tglInput: '' }); setUnitGaransiAuto(true); toast({ title: 'Unit asset teregistrasi', description: 'Stiker barcode/QR dapat dicetak.' }) },
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
  const bulkDeleteToko = useMutation({
    mutationFn: (ids: number[]) => postJson<{ deleted: number; deletedCodes: string[]; skipped: { id: number; kodeToko: string; namaToko: string; alasan: string }[]; skippedCount: number }>('/api/toko/bulk-delete', { ids, aktor: role }),
    onSuccess: (r) => {
      invalidate(['toko', 'dashboard', 'alerts', 'kunjungan', 'units'])
      setTokoDipilih(new Set())
      setHapusTokoOpen(false)
      toast({
        title: `Hapus massal selesai — ${r.deleted} terhapus`,
        description: r.skippedCount > 0
          ? `${r.skippedCount} dilewati: ${r.skipped.slice(0, 5).map((s) => `${s.kodeToko} (${s.alasan})`).join('; ')}${r.skippedCount > 5 ? '…' : ''}`
          : 'Semua toko terpilih berhasil dihapus.',
      })
    },
    onError: (e: Error) => toast({ title: 'Gagal hapus massal', description: e.message, variant: 'destructive' }),
  })
  const updateCust = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Record<string, unknown> }) => postJson<Customer>(`/api/customer/${id}`, { ...data, aktor: role }, 'PATCH'),
    onSuccess: (c) => { invalidate(['customers', 'units']); setEditCust(null); toast({ title: 'Customer diperbarui', description: `Data ${c.nama} tersimpan.` }) },
    onError: (e: Error) => toast({ title: 'Gagal memperbarui customer', description: e.message, variant: 'destructive' }),
  })
  const openEditUnit = (u: UnitAsset) => {
    setEditUnit(u)
    setKonfirmasiKoreksiSN(false)
    setEditUnitForm({
      serialNumber: u.serialNumber,
      modelUnit: u.modelUnit,
      merk: u.merk ?? '',
      nama: u.nama ?? '',
      tokoId: u.tokoId ? String(u.tokoId) : '',
      customerId: u.customerId ? String(u.customerId) : '',
      statusGaransi: u.statusGaransi,
      tglPembelian: u.tglPembelian ? new Date(u.tglPembelian).toISOString().slice(0, 10) : '',
      tglInput: u.createdAt ? new Date(u.createdAt).toISOString().slice(0, 10) : '',
    })
  }
  const openInputPart = (u: UnitAsset) => {
    setPartUnit(u)
    const d = new Date()
    const p = (n: number) => String(n).padStart(2, '0')
    setPartForm({
      deskripsi: '',
      jasa: '0',
      tgl: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`,
      rows: [{ key: nextPartRowKey.current++, kodePart: '', namaPart: '', qty: '1' }],
    })
  }
  const updatePartRow = (key: number, patch: Partial<PartUnitRow>) =>
    setPartForm((f) => ({ ...f, rows: f.rows.map((r) => (r.key === key ? { ...r, ...patch } : r)) }))
  const tambahPartRow = () =>
    setPartForm((f) => ({ ...f, rows: [...f.rows, { key: nextPartRowKey.current++, kodePart: '', namaPart: '', qty: '1' }] }))
  const hapusPartRow = (key: number) =>
    setPartForm((f) => ({ ...f, rows: f.rows.filter((r) => r.key !== key) }))

  // Validasi anti-pengulangan: kode sama tidak boleh dua kali dalam 1 tiket
  const partKodePerRow = partForm.rows.map((r) => r.kodePart.trim().toUpperCase())
  const dupPartKode = useMemo(() => {
    const c = new Map<string, number>()
    for (const k of partKodePerRow) if (k) c.set(k, (c.get(k) ?? 0) + 1)
    return new Set(partKodePerRow.filter((k) => k && (c.get(k) ?? 0) > 1))
  }, [partForm.rows])
  const partRowSetengah = partForm.rows.some(
    (r) => (r.kodePart.trim() && !r.namaPart.trim()) || (!r.kodePart.trim() && r.namaPart.trim())
  )
  const partsLengkap = partForm.rows.filter((r) => r.kodePart.trim() && r.namaPart.trim())
  const partFormValid =
    partForm.deskripsi.trim() !== '' && partsLengkap.length > 0 && !partRowSetengah && dupPartKode.size === 0

  const createTiketPart = useMutation({
    mutationFn: () => {
      const isToko = !!partUnit!.tokoId
      const freeJasa = isToko || partUnit!.statusGaransi !== 'NON_GARANSI'
      return postJson('/api/service', {
        unitAssetId: partUnit!.id,
        deskripsiKerusakan: partForm.deskripsi.trim(),
        tglTiket: partForm.tgl ? new Date(partForm.tgl).toISOString() : undefined,
        biayaJasa: freeJasa ? 0 : Number(partForm.jasa) || 0,
        sumberLaporan: 'MANUAL',
        customerType: isToko ? 'TOKO' : 'PERORANGAN',
        klasifikasiGaransi: partUnit!.statusGaransi,
        parts: partsLengkap.map((r) => ({
          kodePart: r.kodePart.trim().toUpperCase(),
          namaPart: r.namaPart.trim(),
          qty: Math.max(1, Number(r.qty) || 1),
        })),
        aktor: role,
      })
    },
    onSuccess: (t: unknown) => {
      invalidate(['units', 'service-tickets', 'spareparts', 'dashboard', 'alerts'])
      setPartUnit(null)
      const tt = (t as { noTiket?: string; status?: string }) ?? {}
      toast({
        title: 'Part tersimpan',
        description: `Tiket ${tt.noTiket ?? ''} — ${tt.status === 'PROSES' ? 'stok ready, otomatis PROSES.' : 'stok kosong, tercatat ORDER & menunggu di panel Belum Terproses.'}`,
      })
    },
    onError: (e: Error) => toast({ title: 'Gagal mencatat part', description: e.message, variant: 'destructive' }),
  })
  const updateUnit = useMutation({
    mutationFn: () => {
      // Tanggal input hanya dikirim bila benar-benar diubah (agar jam aslinya tidak terpotong)
      const tglInputAsli = editUnit!.createdAt ? new Date(editUnit!.createdAt).toISOString().slice(0, 10) : ''
      const snBaru = editUnitForm.serialNumber.trim().toUpperCase()
      return postJson(`/api/unit/${editUnit!.id}`, {
        serialNumber: snBaru,
        modelUnit: editUnitForm.modelUnit.trim(),
        merk: editUnitForm.merk.trim(),
        nama: editUnitForm.nama.trim(),
        tokoId: editUnitForm.tokoId ? Number(editUnitForm.tokoId) : null,
        customerId: editUnitForm.customerId ? Number(editUnitForm.customerId) : null,
        statusGaransi: editUnitForm.statusGaransi,
        tglPembelian: editUnitForm.tokoId ? null : editUnitForm.tglPembelian || null,
        ...(editUnitForm.tglInput && editUnitForm.tglInput !== tglInputAsli
          ? { tglInput: new Date(editUnitForm.tglInput).toISOString() }
          : {}),
        // Koreksi disengaja nomor seri unit bertiket — server cek ulang role Admin/Manager
        ...(snBaru !== editUnit!.serialNumber.trim().toUpperCase() && (editUnit!.serviceRequests?.length ?? 0) > 0
          ? { koreksiSerial: konfirmasiKoreksiSN }
          : {}),
        aktor: role,
      }, 'PATCH')
    },
    onSuccess: () => {
      invalidate(['units', 'toko', 'dashboard', 'service-tickets'])
      setEditUnit(null)
      toast({ title: 'Unit diperbarui', description: 'Koreksi data tersimpan.' })
    },
    onError: (e: Error) => toast({ title: 'Gagal memperbarui unit', description: e.message, variant: 'destructive' }),
  })
  const deleteUnitMutation = useMutation({
    mutationFn: (id: number) => postJson(`/api/unit/${id}`, { aktor: role }, 'DELETE'),
    onSuccess: () => {
      invalidate(['units', 'toko', 'customer', 'dashboard', 'service-tickets', 'alerts'])
      setDeleteUnit(null)
      toast({ title: 'Unit dihapus', description: 'Data unit keluar dari registrasi.' })
    },
    onError: (e: Error) => toast({ title: 'Unit tidak dapat dihapus', description: e.message, variant: 'destructive' }),
  })
  const bulkDeleteUnit = useMutation({
    mutationFn: (ids: number[]) => postJson<{ deleted: number; deletedSerials: string[]; skipped: { id: number; serialNumber: string; modelUnit: string; alasan: string }[]; skippedCount: number }>('/api/unit/bulk-delete', { ids, aktor: role }),
    onSuccess: (r) => {
      invalidate(['units', 'toko', 'customer', 'dashboard', 'service-tickets', 'alerts'])
      setUnitDipilih(new Set())
      setHapusUnitOpen(false)
      toast({
        title: `Hapus massal selesai — ${r.deleted} terhapus`,
        description: r.skippedCount > 0
          ? `${r.skippedCount} dilewati: ${r.skipped.slice(0, 5).map((s) => `${s.serialNumber} (${s.alasan})`).join('; ')}${r.skippedCount > 5 ? '…' : ''}`
          : 'Semua unit terpilih berhasil dihapus.',
      })
    },
    onError: (e: Error) => toast({ title: 'Gagal hapus massal', description: e.message, variant: 'destructive' }),
  })
  const resetPw = useMutation({
    mutationFn: () => postJson(`/api/pengguna/${resetPwUser!.id}`, { password: resetPwValue, aktor: role }, 'PATCH'),
    onSuccess: () => { invalidate(['pengguna']); setResetPwUser(null); setResetPwValue(''); toast({ title: 'Password direset', description: 'Karyawan dapat login dengan password baru.' }) },
    onError: (e: Error) => toast({ title: 'Gagal', description: e.message, variant: 'destructive' }),
  })

  const tokoTampil = useMemo(
    () => (tokoList ?? []).filter((t) => matchQuery([t.kodeToko, t.namaToko, t.alamat, t.kontak, t.barcodeToko], cariToko)),
    [tokoList, cariToko]
  )
  const toggleToko = (id: number) =>
    setTokoDipilih((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const toggleSemuaToko = () =>
    setTokoDipilih((prev) => {
      const ids = tokoTampil.map((t) => t.id)
      const semua = ids.length > 0 && ids.every((id) => prev.has(id))
      const next = new Set(prev)
      if (semua) ids.forEach((id) => next.delete(id))
      else ids.forEach((id) => next.add(id))
      return next
    })
  const custTampil = useMemo(
    () => (customerList ?? []).filter((c) => matchQuery([c.nama, c.noWa, c.alamat, ...c.unitAssets.map((u) => u.modelUnit)], cariCust)),
    [customerList, cariCust]
  )
  // Kode sparepart per unit (dari semua tiket) — pemisah "sudah vs belum dapat part".
  // "Part Ready Produsen" = unit punya part di tiket yang masih BERJALAN (REQUEST/PROSES);
  // tiket yang sudah FINISH tidak lagi dilabeli ready produsen (part-nya selesai diproses).
  const partInfoByUnit = useMemo(() => {
    const m = new Map<number, { count: number; countAktif: number; codes: string[] }>()
    for (const u of unitList ?? []) {
      const codes: string[] = []
      let count = 0
      let countAktif = 0
      for (const t of u.serviceRequests ?? []) {
        const aktif = t.status === 'REQUEST' || t.status === 'PROSES'
        for (const p of t.parts ?? []) {
          count += p.qty
          if (aktif) countAktif += p.qty
          const k = p.sparepart?.kodePart
          if (k && !codes.includes(k)) codes.push(k)
        }
      }
      m.set(u.id, { count, countAktif, codes })
    }
    return m
  }, [unitList])
  const unitTampil = useMemo(
    () => (unitList ?? []).filter((u) => matchQuery([u.serialNumber, u.modelUnit, u.merk, u.nama, u.toko?.kodeToko, u.toko?.namaToko, u.customer?.nama, u.statusGaransi, ...(partInfoByUnit.get(u.id)?.codes ?? [])], cariUnit)),
    [unitList, cariUnit, partInfoByUnit]
  )
  // Deteksi nomor seri ganda secara live saat mengetik — instant dari daftar unit yang
  // sudah termuat (kunci normalisasi sama dengan server: trim + uppercase), jadi faktanya
  // tampak jauh sebelum request dikirim & tombol Registrasi tidak bisa dipaksa berulang.
  const regSerialDupe = useMemo(() => {
    const sn = newUnit.serialNumber.trim().toUpperCase()
    if (!sn) return null
    return (unitList ?? []).find((u) => u.serialNumber.trim().toUpperCase() === sn) ?? null
  }, [newUnit.serialNumber, unitList])
  const editSerialDupe = useMemo(() => {
    const sn = editUnitForm.serialNumber.trim().toUpperCase()
    if (!sn || !editUnit) return null
    return (unitList ?? []).find((u) => u.id !== editUnit.id && u.serialNumber.trim().toUpperCase() === sn) ?? null
  }, [editUnitForm.serialNumber, editUnit, unitList])
  // Koreksi nomor seri pada unit bertiket: terkunci default, dibuka hanya
  // melalui jalur koreksi disengaja (khusus Admin Workshop/Manager — server
  // juga memvalidasi role & flag `koreksiSerial`, bukan sekadar percaya UI).
  const bisaKoreksiSerial = role === 'ADMIN_WORKSHOP' || role === 'MANAGER'
  const editUnitBertiket = !!editUnit && (editUnit.serviceRequests?.length ?? 0) > 0
  const editSnBerubah = !!editUnit && editUnitForm.serialNumber.trim().toUpperCase() !== editUnit.serialNumber.trim().toUpperCase()
  const editSnButuhKoreksi = editUnitBertiket && editSnBerubah
  const editSnTerblokir = editSnButuhKoreksi && !bisaKoreksiSerial
  // Pisahan: unit yang sudah dapat kode sparepart vs yang belum (default: belum).
  // Saat ada kata kunci pencarian, filter dilepas → hasil mencakup keduanya (tanpa perlu swap tab).
  const [unitPartTab, setUnitPartTab] = useState<'belum' | 'sudah' | 'semua'>('belum')
  const sedangMencariUnit = cariUnit.trim() !== ''
  const unitBelumPart = useMemo(() => unitTampil.filter((u) => (partInfoByUnit.get(u.id)?.count ?? 0) === 0), [unitTampil, partInfoByUnit])
  // Part Ready Produsen: hanya part pada tiket BERJALAN — unit bertiket FINISH dikeluarkan.
  const unitSudahPart = useMemo(() => unitTampil.filter((u) => (partInfoByUnit.get(u.id)?.countAktif ?? 0) > 0), [unitTampil, partInfoByUnit])
  // Unit terkunci (punya tiket) tidak bisa dicentang — server juga melewatinya
  const unitBisaHapus = (u: UnitAsset) => (u.serviceRequests ?? []).length === 0
  const toggleUnit = (id: number) =>
    setUnitDipilih((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const toggleSemuaUnit = (list: UnitAsset[]) => () =>
    setUnitDipilih((prev) => {
      const ids = list.filter(unitBisaHapus).map((u) => u.id)
      const semua = ids.length > 0 && ids.every((id) => prev.has(id))
      const next = new Set(prev)
      if (semua) ids.forEach((id) => next.delete(id))
      else ids.forEach((id) => next.add(id))
      return next
    })
  const userTampil = useMemo(
    () => (userList ?? []).filter((u) => matchQuery([u.nama, u.email, u.username, u.kodeTeknisi, u.noWa, u.wilayahKerja, u.role], cariUser)),
    [userList, cariUser]
  )

  // Tabel unit ringkas: scroll vertikal berbatas + header sticky agar tidak panjang ke bawah.
  // showStatus=true dipakai untuk hasil pencarian gabungan agar jelas asal Belum/Part Ready Produsen.
  const renderUnitTable = (list: UnitAsset[], emptyText: string, showStatus = false) => (
    <div className="max-h-[52vh] overflow-auto rounded-md border [&_thead]:sticky [&_thead]:top-0 [&_thead]:z-10 [&_thead]:bg-white [&_thead]:shadow-[0_1px_0_rgb(0_0_0/0.08)]">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-9 pr-0">
              <Checkbox
                aria-label="Pilih semua unit tampil yang bisa dihapus"
                checked={list.filter(unitBisaHapus).length > 0 && list.filter(unitBisaHapus).every((u) => unitDipilih.has(u.id))}
                onCheckedChange={toggleSemuaUnit(list)}
              />
            </TableHead>
            <TableHead>Tanggal Input</TableHead>
            <TableHead>Toko / Customer</TableHead>
            <TableHead>Merk</TableHead>
            <TableHead>Model / Tipe</TableHead>
            <TableHead>Nomor Seri</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Kode Part</TableHead>
            {showStatus && <TableHead>Part</TableHead>}
            <TableHead className="text-right">Barcode</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {list.length === 0 ? (
            <TableRow>
              <TableCell colSpan={showStatus ? 10 : 9} className="py-8 text-center text-sm text-slate-500">{emptyText}</TableCell>
            </TableRow>
          ) : list.map((u) => {
            const info = partInfoByUnit.get(u.id) ?? { count: 0, countAktif: 0, codes: [] as string[] }
            // Unit finish (punya tiket tapi tak ada yang aktif) → abu-abu + label FINISH
            const finish = (u.serviceRequests ?? []).length > 0 && !(u.serviceRequests ?? []).some((t) => t.status === 'REQUEST' || t.status === 'PROSES')
            return (
              <TableRow key={u.id} className={cn(finish && 'bg-slate-100/80 opacity-70', unitDipilih.has(u.id) && 'bg-red-50/50 opacity-100')}>
                <TableCell className="pr-0">
                  <Checkbox
                    aria-label={`Pilih unit ${u.serialNumber}`}
                    checked={unitDipilih.has(u.id)}
                    disabled={!unitBisaHapus(u)}
                    title={!unitBisaHapus(u) ? 'Terkunci: sudah punya tiket service' : `Pilih unit ${u.serialNumber}`}
                    onCheckedChange={() => toggleUnit(u.id)}
                  />
                </TableCell>
                <TableCell className="whitespace-nowrap text-xs text-slate-600" title="Tanggal input registrasi unit">
                  {formatTanggal(u.createdAt)}
                </TableCell>
                <TableCell className="text-xs text-slate-700">
                  {u.toko ? (
                    <>
                      <p className="font-medium text-slate-800">{u.toko.namaToko}</p>
                      <p className="font-mono text-[10px] text-slate-400">{u.toko.kodeToko}</p>
                    </>
                  ) : u.customer ? (
                    <>
                      <p className="font-medium text-slate-800">{u.customer.nama}</p>
                      <p className="text-[10px] text-slate-400">Perorangan{u.customer.noWa ? ` · ${u.customer.noWa}` : ''}</p>
                    </>
                  ) : (
                    <span className="text-slate-400">-</span>
                  )}
                </TableCell>
                <TableCell className="text-xs text-slate-700">{u.merk?.trim() || <span className="text-slate-400">-</span>}</TableCell>
                <TableCell className="text-xs font-medium text-slate-800">
                  {u.modelUnit}
                  {u.nama?.trim() && <p className="text-[10px] font-normal text-slate-500">{u.nama.trim()}</p>}
                </TableCell>
                <TableCell className="font-mono text-[11px] font-semibold text-slate-900">{u.serialNumber}</TableCell>
                <TableCell>
                  <Badge variant="outline" className={cn('text-[10px]', u.statusGaransi === 'NON_GARANSI' ? 'border-amber-300 text-amber-700' : u.statusGaransi === 'STOK_TOKO' ? 'border-teal-300 text-teal-700' : 'border-emerald-300 text-emerald-700')}>
                    {GARANSI_LABEL[u.statusGaransi] ?? u.statusGaransi.replace('_', '-')}
                  </Badge>
                  {finish && (
                    <p className="mt-0.5">
                      <Badge variant="outline" className="border-slate-300 bg-slate-200 text-[10px] text-slate-500">FINISH</Badge>
                    </p>
                  )}
                  {u.tglPembelian && (
                    <p className="mt-0.5 whitespace-nowrap text-[10px] text-slate-500" title="Tgl pembelian — awal masa garansi">
                      {formatTanggal(u.tglPembelian)}
                    </p>
                  )}
                </TableCell>
                <TableCell className="max-w-44">
                  {info.codes.length === 0 ? (
                    <span className="text-[11px] text-slate-400">–</span>
                  ) : (
                    <div className="flex flex-wrap gap-1" title={info.codes.join(', ')}>
                      {info.codes.slice(0, 3).map((k) => (
                        <Badge key={k} variant="outline" className="font-mono text-[9px] text-teal-700">{k}</Badge>
                      ))}
                      {info.codes.length > 3 && <span className="text-[9px] text-slate-400">+{info.codes.length - 3}</span>}
                    </div>
                  )}
                </TableCell>
                {showStatus && (
                  <TableCell>
                    {info.countAktif > 0 ? (
                      <Badge variant="outline" className="border-teal-300 bg-teal-50 text-[10px] text-teal-700">Part Ready Produsen</Badge>
                    ) : info.count > 0 ? (
                      <Badge variant="outline" className="border-slate-300 bg-slate-100 text-[10px] text-slate-500" title="Part sebelumnya sudah dibawa tiket yang FINISH — tidak dihitung Part Ready Produsen">Selesai (FINISH)</Badge>
                    ) : (
                      <Badge variant="outline" className="border-slate-300 text-[10px] text-slate-500">Belum Ada Part</Badge>
                    )}
                  </TableCell>
                )}
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    {(() => {
                      const aktif = (u.serviceRequests ?? []).find((t) => t.status === 'REQUEST' || t.status === 'PROSES')
                              return aktif ? (
                                <Badge variant="outline" className="border-violet-300 font-mono text-[10px] text-violet-700" title="Unit sedang dalam proses — input part lewat tiket ini agar tidak ganda">
                                  {aktif.noTiket}
                                </Badge>
                              ) : finish ? (
                                <Button size="sm" variant="outline" className="h-7 border-slate-200 bg-slate-100 px-2 text-[11px] text-slate-400" disabled title="Unit sudah finish — tidak dapat input part lagi">
                                  FINISH
                                </Button>
                              ) : (
                                <Button size="sm" variant="outline" className="h-7 border-teal-300 px-2 text-[11px] text-teal-700" onClick={() => openInputPart(u)} aria-label={`Input part ${u.serialNumber}`} title="Input kode + nama sparepart (otomatis PROSES)">
                                  <PackagePlus className="mr-1 h-3 w-3" /> Part
                                </Button>
                              )
                    })()}
                    <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px] text-slate-500 hover:text-emerald-700" onClick={() => openEditUnit(u)} aria-label={`Edit ${u.serialNumber}`} title="Edit unit">
                      <Pencil className="h-3 w-3" />
                    </Button>
                    {(u.serviceRequests ?? []).length === 0 && (
                      <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px] text-slate-400 hover:text-red-600" onClick={() => setDeleteUnit(u)} aria-label={`Hapus ${u.serialNumber}`} title="Hapus unit (koreksi kesalahan input registrasi)">
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    )}
                    <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" onClick={() => setQrUnit(u)}>
                      <Barcode className="mr-1 h-3 w-3" /> Stiker
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )

  return (
    <Tabs value={tabAktif} onValueChange={setTabAktif} className="space-y-4">
      {/* Header tab Toko/Customer/Unit/Karyawan DIHAPUS — pindah root sekarang
          lewat dropdown di sidebar (menu Master Data), fungsinya sama. */}
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
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <QuickSearch value={cariToko} onChange={setCariToko} placeholder="Cari kode / nama / alamat / kontak toko…" className="max-w-xs flex-1" resultCount={tokoTampil.length} />
              {bisaHapusToko && tokoDipilih.size > 0 && (
                <>
                  <Badge variant="outline" className="border-red-300 bg-red-50 text-[11px] text-red-700">{tokoDipilih.size} dipilih</Badge>
                  <Button size="sm" variant="destructive" className="h-7 px-2 text-[11px]" onClick={() => setHapusTokoOpen(true)}>
                    <Trash2 className="mr-1 h-3 w-3" /> Hapus ({tokoDipilih.size})
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px] text-slate-500" onClick={() => setTokoDipilih(new Set())} aria-label="Batalkan pilihan toko">
                    <X className="h-3 w-3" />
                  </Button>
                </>
              )}
            </div>
            {tokoLoading ? (
              <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
            ) : (
              <div className="max-h-[60vh] overflow-auto rounded-md border [&_thead]:sticky [&_thead]:top-0 [&_thead]:z-10 [&_thead]:bg-white [&_thead]:shadow-[0_1px_0_rgb(0_0_0/0.08)]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {bisaHapusToko && (
                        <TableHead className="w-9 pr-0">
                          <Checkbox
                            aria-label="Pilih semua toko tampil"
                            checked={tokoTampil.length > 0 && tokoTampil.every((t) => tokoDipilih.has(t.id))}
                            onCheckedChange={toggleSemuaToko}
                          />
                        </TableHead>
                      )}
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
                      <TableRow key={t.id} className={cn(tokoDipilih.has(t.id) && 'bg-red-50/50')}>
                        {bisaHapusToko && (
                          <TableCell className="pr-0">
                            <Checkbox
                              aria-label={`Pilih toko ${t.kodeToko}`}
                              checked={tokoDipilih.has(t.id)}
                              onCheckedChange={() => toggleToko(t.id)}
                            />
                          </TableCell>
                        )}
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
                            <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" onClick={() => { setEditToko(t); setEditTokoForm({ namaToko: t.namaToko, alamat: t.alamat ?? '', kontak: t.kontak ?? '', frekuensiVisit: String(t.frekuensiVisit), jarakKm: t.jarakKm !== null && t.jarakKm !== undefined ? String(t.jarakKm) : '' }) }} aria-label={`Edit ${t.namaToko}`}>
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
              <CardDescription>Tanggal input · Toko/Customer · Merk · Model/Tipe · Nomor seri · Status + tgl garansi — cetak stiker &amp; scan dengan kamera HP</CardDescription>
            </div>
            <div className="flex shrink-0 flex-wrap justify-end gap-2">
              <Button size="sm" variant="outline" onClick={() => setImportUnitOpen(true)}>
                <Upload className="mr-1 h-4 w-4" /> Import CSV
              </Button>
              <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={openUnitRegistrasi}><Plus className="mr-1 h-4 w-4" /> Registrasi Unit</Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <QuickSearch value={cariUnit} onChange={setCariUnit} placeholder="Cari toko / customer / merk / model / seri / kode part…" className="max-w-xs flex-1" resultCount={unitTampil.length} />
              {unitDipilih.size > 0 && (
                <>
                  <Badge variant="outline" className="border-red-300 bg-red-50 text-[11px] text-red-700">{unitDipilih.size} dipilih</Badge>
                  <Button size="sm" variant="destructive" className="h-7 px-2 text-[11px]" onClick={() => setHapusUnitOpen(true)}>
                    <Trash2 className="mr-1 h-3 w-3" /> Hapus ({unitDipilih.size})
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px] text-slate-500" onClick={() => setUnitDipilih(new Set())} aria-label="Batalkan pilihan unit">
                    <X className="h-3 w-3" />
                  </Button>
                </>
              )}
            </div>
            {unitLoading ? (
              <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
            ) : sedangMencariUnit ? (
              <div className="space-y-2">
                <p className="rounded-md bg-teal-50 px-2.5 py-1.5 text-[11px] text-teal-800">
                  Hasil pencarian mencakup <span className="font-semibold">Belum &amp; Part Ready Produsen</span> — {unitTampil.length} unit cocok &quot;{cariUnit.trim()}&quot;.
                </p>
                {renderUnitTable(unitTampil, `Tidak ada unit yang cocok dengan "${cariUnit.trim()}" di Belum maupun Part Ready Produsen.`, true)}
              </div>
            ) : (
              <Tabs value={unitPartTab} onValueChange={(v) => setUnitPartTab(v as typeof unitPartTab)}>
                <TabsList className="flex-wrap">
                  <TabsTrigger value="semua" className="text-xs">Semua ({unitTampil.length})</TabsTrigger>
                  <TabsTrigger value="belum" className="text-xs">Belum Ada Part ({unitBelumPart.length})</TabsTrigger>
                  <TabsTrigger value="sudah" className="text-xs">Part Ready Produsen ({unitSudahPart.length})</TabsTrigger>
                </TabsList>
                <TabsContent value="semua">
                  {renderUnitTable(unitTampil, 'Belum ada unit terdaftar.', true)}
                </TabsContent>
                <TabsContent value="belum">
                  {renderUnitTable(unitBelumPart, 'Semua unit sudah dapat kode part — tidak ada yang belum.')}
                </TabsContent>
                <TabsContent value="sudah">
                  {renderUnitTable(unitSudahPart, 'Tidak ada unit dengan part pada tiket berjalan (REQUEST/PROSES).')}
                </TabsContent>
              </Tabs>
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
            <div className="space-y-1.5">
              <Label>Serial Number</Label>
              <Input value={newUnit.serialNumber} onChange={(e) => setNewUnit({ ...newUnit, serialNumber: e.target.value.toUpperCase() })} placeholder="SN-KPAS-2026-XXXXX" className="font-mono" aria-invalid={!!regSerialDupe} />
              {regSerialDupe && <DupSerialWarning existing={regSerialDupe} mode="registrasi" tokoIdSekarang={newUnit.tokoId} />}
            </div>
            <div className="space-y-1.5"><Label>Model / Tipe Unit</Label><HistoryInput historyKey="unit-model" value={newUnit.modelUnit} onChange={(e) => setNewUnit({ ...newUnit, modelUnit: e.target.value })} placeholder="Kipas Angin 16 inch ..." /></div>
            <div className="space-y-1.5"><Label>Merk</Label><HistoryInput historyKey="unit-merk" suggestions={brandRules.map((b) => b.nama)} value={newUnit.merk} onChange={(e) => setUnitMerk(e.target.value)} placeholder="cth: Miyako, Rinnai, Shimizu" /></div>
            <div className="space-y-1.5"><Label>Nama Unit (opsional)</Label><HistoryInput historyKey="unit-nama" value={newUnit.nama} onChange={(e) => setNewUnit({ ...newUnit, nama: e.target.value })} placeholder="cth: Kipas Ruang Tamu" /></div>
            <div className="space-y-1.5">
              <Label>Toko Mitra</Label>
              <SearchSelect
                value={newUnit.tokoId}
                onChange={(v) => setNewUnit({ ...newUnit, tokoId: v, ...(v ? { statusGaransi: 'STOK_TOKO' } : {}) })}
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
                  <SelectItem value="STOK_TOKO">STOK TOKO (otomatis garansi)</SelectItem>
                  <SelectItem value="GARANSI">GARANSI</SelectItem>
                  <SelectItem value="NON_GARANSI">NON-GARANSI</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5"><Label>Tgl Pembelian {newUnit.tokoId ? '— nonaktif (stok toko)' : ''}</Label><Input type="date" value={newUnit.tokoId ? '' : newUnit.tglPembelian} onChange={(e) => setUnitTgl(e.target.value)} disabled={!!newUnit.tokoId} /></div>
            <div className="space-y-1.5">
              <Label>Tanggal Input</Label>
              <Input type="date" value={newUnit.tglInput} onChange={(e) => setNewUnit({ ...newUnit, tglInput: e.target.value })} aria-label="Tanggal input registrasi" />
              <p className="text-[11px] text-slate-500">Boleh diisi mundur sesuai tanggal postingan WA (input susulan).</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUnitOpen(false)}>Batal</Button>
            <Button className="bg-emerald-600 hover:bg-emerald-700" disabled={!newUnit.serialNumber || !newUnit.modelUnit || !!regSerialDupe || addUnit.isPending} onClick={() => addUnit.mutate()}><Plus className="mr-1 h-4 w-4" /> Registrasi</Button>
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
            <div className="space-y-1.5"><Label>Jarak Workshop (km)</Label><Input type="number" min="0" step="0.1" value={editTokoForm.jarakKm} onChange={(e) => setEditTokoForm({ ...editTokoForm, jarakKm: e.target.value })} placeholder="kosong = belum tahu" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditToko(null)}>Batal</Button>
            <Button
              className="bg-emerald-600 hover:bg-emerald-700"
              disabled={!editToko || !editTokoForm.namaToko.trim() || Number(editTokoForm.frekuensiVisit) < 1 || updateToko.isPending}
              onClick={() => editToko && updateToko.mutate({ id: editToko.id, data: { namaToko: editTokoForm.namaToko.trim(), alamat: editTokoForm.alamat.trim() || null, kontak: editTokoForm.kontak.trim() || null, frekuensiVisit: Number(editTokoForm.frekuensiVisit), jarakKm: editTokoForm.jarakKm.trim() === '' ? null : Math.max(0, Number(editTokoForm.jarakKm) || 0) } })}
            >
              <Pencil className="mr-1 h-4 w-4" /> Simpan Perubahan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog konfirmasi hapus massal toko (khusus Admin/Manager) */}
      <Dialog open={hapusTokoOpen} onOpenChange={setHapusTokoOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Hapus {tokoDipilih.size} Toko?</DialogTitle>
            <DialogDescription>
              Toko yang masih punya unit terdaftar, riwayat kunjungan, atau order sparepart otomatis dilewati server. Tindakan ini tidak dapat dibatalkan.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-56 space-y-1 overflow-y-auto rounded-md border bg-slate-50 p-2.5">
            {(tokoList ?? []).filter((t) => tokoDipilih.has(t.id)).map((t) => (
              <p key={t.id} className="text-xs text-slate-700">
                <span className="font-mono font-semibold">{t.kodeToko}</span> — {t.namaToko} <span className="text-slate-400">({t.jumlahUnit} unit)</span>
              </p>
            ))}
            {tokoDipilih.size === 0 && (
              <p className="py-4 text-center text-xs text-slate-400">Tidak ada toko terpilih.</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setHapusTokoOpen(false)}>Batal</Button>
            <Button
              variant="destructive"
              disabled={tokoDipilih.size === 0 || bulkDeleteToko.isPending}
              onClick={() => bulkDeleteToko.mutate([...tokoDipilih])}
            >
              <Trash2 className="mr-1 h-4 w-4" /> {bulkDeleteToko.isPending ? 'Menghapus…' : `Ya, Hapus (${tokoDipilih.size})`}
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
            <DialogDescription>Nomor seri boleh dikoreksi selama belum duplikat. Unit yang sudah punya tiket terkunci — koreksi hanya oleh Admin Workshop/Manager dengan konfirmasi (tiket tetap menaut unit lewat ID).</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Nomor Seri</Label>
              <Input value={editUnitForm.serialNumber} onChange={(e) => setEditUnitForm({ ...editUnitForm, serialNumber: e.target.value.toUpperCase() })} placeholder="SN-KPAS-2026-XXXXX" className="font-mono" aria-invalid={!!editSerialDupe} />
              {editSerialDupe && <DupSerialWarning existing={editSerialDupe} mode="edit" />}
              {editSnTerblokir && (
                <div role="alert" className="rounded-md border border-red-300 bg-red-50 px-2.5 py-1.5 text-[11px] leading-snug text-red-700">
                  <span className="flex items-start gap-1.5 font-semibold"><AlertTriangle aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />Nomor seri terkunci</span>
                  <p className="pl-5">Unit ini sudah punya tiket {editUnit?.serviceRequests?.map((t) => t.noTiket).join(', ')} — koreksi nomor seri hanya oleh Admin Workshop/Manager.</p>
                </div>
              )}
              {editSnButuhKoreksi && bisaKoreksiSerial && !editSerialDupe && (
                <label className="flex cursor-pointer items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-2 text-[11px] leading-snug text-amber-800">
                  <Checkbox checked={konfirmasiKoreksiSN} onCheckedChange={(v) => setKonfirmasiKoreksiSN(v === true)} className="mt-0.5" aria-label="Konfirmasi koreksi nomor seri" />
                  <span>
                    <b>Koreksi nomor seri unit bertiket</b> ({editUnit?.serviceRequests?.map((t) => t.noTiket).join(', ')}): riwayat tiket &amp; klaim tetap menaut unit ini lewat ID, namun stiker barcode tercetak lama harus dicetak ulang. Centang bila Anda yakin koreksinya benar.
                  </span>
                </label>
              )}
            </div>
            <div className="space-y-1.5"><Label>Model / Tipe Unit</Label><HistoryInput historyKey="unit-model" value={editUnitForm.modelUnit} onChange={(e) => setEditUnitForm({ ...editUnitForm, modelUnit: e.target.value })} /></div>
            <div className="space-y-1.5"><Label>Merk</Label><HistoryInput historyKey="unit-merk" suggestions={brandRules.map((b) => b.nama)} value={editUnitForm.merk} onChange={(e) => setEditUnitForm({ ...editUnitForm, merk: e.target.value })} /></div>
            <div className="space-y-1.5 sm:col-span-2"><Label>Nama Unit (opsional)</Label><HistoryInput historyKey="unit-nama" value={editUnitForm.nama} onChange={(e) => setEditUnitForm({ ...editUnitForm, nama: e.target.value })} /></div>
            <div className="space-y-1.5">
              <Label>Toko Mitra</Label>
              <SearchSelect
                value={editUnitForm.tokoId}
                onChange={(v) => setEditUnitForm({ ...editUnitForm, tokoId: v, ...(v ? { statusGaransi: 'STOK_TOKO' } : {}) })}
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
                  <SelectItem value="STOK_TOKO">STOK TOKO (otomatis garansi)</SelectItem>
                  <SelectItem value="GARANSI">GARANSI</SelectItem>
                  <SelectItem value="NON_GARANSI">NON-GARANSI</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5"><Label>Tgl Pembelian {editUnitForm.tokoId ? '— nonaktif (stok toko)' : ''}</Label><Input type="date" value={editUnitForm.tokoId ? '' : editUnitForm.tglPembelian} onChange={(e) => setEditUnitForm({ ...editUnitForm, tglPembelian: e.target.value })} disabled={!!editUnitForm.tokoId} /></div>
            <div className="space-y-1.5">
              <Label>Tanggal Input</Label>
              <Input type="date" value={editUnitForm.tglInput} onChange={(e) => setEditUnitForm({ ...editUnitForm, tglInput: e.target.value })} aria-label="Tanggal input registrasi" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditUnit(null)}>Batal</Button>
            <Button
              className="bg-emerald-600 hover:bg-emerald-700"
              disabled={!editUnit || !editUnitForm.serialNumber.trim() || !editUnitForm.modelUnit.trim() || !!editSerialDupe || editSnTerblokir || (editSnButuhKoreksi && !konfirmasiKoreksiSN) || updateUnit.isPending}
              onClick={() => updateUnit.mutate()}
            >
              <Pencil className="mr-1 h-4 w-4" /> Simpan Perubahan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog konfirmasi hapus unit (koreksi kesalahan input registrasi) */}
      <Dialog open={!!deleteUnit} onOpenChange={(o) => !o && setDeleteUnit(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Hapus Unit?</DialogTitle>
            <DialogDescription>
              {deleteUnit && (
                <span>
                  <span className="font-mono font-semibold">{deleteUnit.serialNumber}</span> — {deleteUnit.modelUnit} akan dihapus dari registrasi. Tindakan ini tidak dapat dibatalkan.
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          <p className="rounded-md bg-amber-50 p-2.5 text-xs text-amber-800">
            Unit ini belum punya tiket service — aman dihapus untuk mengoreksi kesalahan input (serial/model/toko).
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteUnit(null)}>Batal</Button>
            <Button
              variant="destructive"
              disabled={!deleteUnit || deleteUnitMutation.isPending}
              onClick={() => deleteUnit && deleteUnitMutation.mutate(deleteUnit.id)}
            >
              <Trash2 className="mr-1 h-4 w-4" /> Ya, Hapus
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog konfirmasi hapus massal unit (hanya unit tanpa tiket) */}
      <Dialog open={hapusUnitOpen} onOpenChange={setHapusUnitOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Hapus {unitDipilih.size} Unit?</DialogTitle>
            <DialogDescription>
              Unit yang sudah punya tiket service otomatis dilewati server agar riwayat &amp; klaim tetap utuh. Tindakan ini tidak dapat dibatalkan.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-56 space-y-1 overflow-y-auto rounded-md border bg-slate-50 p-2.5">
            {(unitList ?? []).filter((u) => unitDipilih.has(u.id)).map((u) => (
              <p key={u.id} className="text-xs text-slate-700">
                <span className="font-mono font-semibold">{u.serialNumber}</span> — {u.modelUnit}
              </p>
            ))}
            {unitDipilih.size === 0 && (
              <p className="py-4 text-center text-xs text-slate-400">Tidak ada unit terpilih.</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setHapusUnitOpen(false)}>Batal</Button>
            <Button
              variant="destructive"
              disabled={unitDipilih.size === 0 || bulkDeleteUnit.isPending}
              onClick={() => bulkDeleteUnit.mutate([...unitDipilih])}
            >
              <Trash2 className="mr-1 h-4 w-4" /> {bulkDeleteUnit.isPending ? 'Menghapus…' : `Ya, Hapus (${unitDipilih.size})`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog quick input kode+nama part → tiket otomatis PROSES bila ready */}
      <Dialog open={!!partUnit} onOpenChange={(o) => !o && setPartUnit(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Input Part Unit</DialogTitle>
            <DialogDescription>
              {partUnit && <span>{partUnit.modelUnit} · <span className="font-mono">{partUnit.serialNumber}</span> — kode+nama terinput otomatis menjadikan tiket PROSES.</span>}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Deskripsi Kerusakan</Label>
              <HistoryInput historyKey="service-deskripsi" value={partForm.deskripsi} onChange={(e) => setPartForm({ ...partForm, deskripsi: e.target.value })} placeholder="cth: Dinamo mati total" />
            </div>
            <div className="space-y-1.5">
              <Label>Tanggal Kejadian</Label>
              <Input type="date" value={partForm.tgl} onChange={(e) => setPartForm({ ...partForm, tgl: e.target.value })} aria-label="Tanggal kejadian tiket" />
              <p className="text-[11px] text-slate-500">Boleh diisi mundur (data historis) — nomor tiket otomatis menyesuaikan tanggal ini.</p>
            </div>
            <div className="space-y-2">
              <Label>Sparepart — boleh lebih satu kode (tiap baris kode & nama berbeda)</Label>
              {partForm.rows.map((row, i) => {
                const kodeRow = row.kodePart.trim().toUpperCase()
                const dup = kodeRow !== '' && dupPartKode.has(kodeRow)
                const setengah = (row.kodePart.trim() && !row.namaPart.trim()) || (!row.kodePart.trim() && row.namaPart.trim())
                return (
                  <div key={row.key} className="space-y-1.5 rounded-md border border-slate-200 bg-slate-50 p-2">
                    <div className="flex items-center gap-1.5">
                      <Input
                        value={row.kodePart}
                        onChange={(e) => updatePartRow(row.key, { kodePart: e.target.value.toUpperCase() })}
                        placeholder="PRT-XXX-00"
                        className={`h-9 min-w-0 flex-1 font-mono ${dup ? 'border-red-400' : ''}`}
                        aria-label={`Kode sparepart baris ${i + 1}`}
                      />
                      <Input
                        type="number"
                        min="1"
                        value={row.qty}
                        onChange={(e) => updatePartRow(row.key, { qty: e.target.value })}
                        className="h-9 w-14 shrink-0 text-center"
                        aria-label={`Qty baris ${i + 1}`}
                      />
                      {partForm.rows.length > 1 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-9 w-8 shrink-0 text-slate-400 hover:text-red-600"
                          onClick={() => hapusPartRow(row.key)}
                          aria-label={`Hapus part baris ${i + 1}`}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                    <HistoryInput
                      historyKey="part-nama"
                      value={row.namaPart}
                      onChange={(e) => updatePartRow(row.key, { namaPart: e.target.value })}
                      placeholder="cth: Dinamo 16 inch"
                    />
                    {dup && (
                      <p className="text-[11px] font-medium text-red-600">
                        Kode {kodeRow} sudah terisi di baris lain — hapus salah satu (pengulangan tidak diizinkan).
                      </p>
                    )}
                    {setengah && (
                      <p className="text-[11px] font-medium text-red-600">Kode dan nama wajib diisi bersamaan.</p>
                    )}
                  </div>
                )
              })}
              <Button type="button" variant="outline" size="sm" className="w-full border-dashed" onClick={tambahPartRow}>
                <Plus className="mr-1 h-3.5 w-3.5" /> Tambah Part
              </Button>
            </div>
            {partUnit && !partUnit.tokoId && partUnit.statusGaransi === 'NON_GARANSI' && (
              <div className="space-y-1.5">
                <Label>Biaya Jasa (Rp)</Label>
                <Input type="number" min={0} value={partForm.jasa} onChange={(e) => setPartForm({ ...partForm, jasa: e.target.value })} />
              </div>
            )}
            {partUnit && (partUnit.tokoId || partUnit.statusGaransi !== 'NON_GARANSI') && (
              <p className="rounded-md bg-emerald-50 p-2 text-[11px] text-emerald-800">Unit {partUnit.tokoId ? 'stok toko' : 'garansi'} — biaya jasa Rp 0 (otomatis).</p>
            )}
            {(!partFormValid && !dupPartKode.size && !partRowSetengah) && (
              <p className="rounded-md bg-amber-50 p-2 text-[11px] text-amber-800">
                Lengkapi dulu: {[!partForm.deskripsi.trim() && 'deskripsi', partsLengkap.length === 0 && 'kode + nama part'].filter(Boolean).join(', ')} — tombol Simpan aktif setelah lengkap.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPartUnit(null)}>Batal</Button>
            <Button
              className="bg-emerald-600 hover:bg-emerald-700"
              disabled={!partUnit || !partFormValid || createTiketPart.isPending}
              onClick={() => createTiketPart.mutate()}
            >
              <PackagePlus className="mr-1 h-4 w-4" /> Simpan &amp; Proses
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

      {/* Dialog stiker barcode unit — layout: tgl input, toko/customer, merk, model/tipe, nomor seri, status + tgl garansi */}
      <UnitBarcodeSticker unit={qrUnit} onOpenChange={(o) => !o && setQrUnit(null)} />
    </Tabs>
  )
}
