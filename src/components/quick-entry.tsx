'use client'

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { postJson } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useToast } from '@/hooks/use-toast'
import { useAppStore } from '@/lib/store'
import HistoryInput from '@/components/history-input'
import { Plus, Store, Users, ScanLine, Radio, Zap, QrCode } from 'lucide-react'

/**
 * Akses cepat di fitur utama (Dashboard):
 * - Add Toko & Add Customer tanpa harus membuka Master Data
 * - Shortcut ke Scan Kunjungan (Field Ops) & Gateway
 * Dialog berbagi komponen yang sama dengan Master Data View.
 */

function useInvalidate() {
  const queryClient = useQueryClient()
  return (keys: string[]) => {
    keys.forEach((k) => queryClient.invalidateQueries({ queryKey: [k] }))
    queryClient.invalidateQueries({ queryKey: ['audit'] })
  }
}

export function AddTokoDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { toast } = useToast()
  const { role } = useAppStore()
  const invalidate = useInvalidate()
  const [newToko, setNewToko] = useState({ kodeToko: '', namaToko: '', alamat: '', kontak: '', frekuensiVisit: '14', jarakKm: '' })

  const addToko = useMutation({
    mutationFn: () => postJson('/api/toko', { ...newToko, frekuensiVisit: Number(newToko.frekuensiVisit), jarakKm: newToko.jarakKm.trim() === '' ? null : Math.max(0, Number(newToko.jarakKm) || 0), aktor: role }),
    onSuccess: () => {
      invalidate(['toko', 'dashboard', 'alerts'])
      onOpenChange(false)
      setNewToko({ kodeToko: '', namaToko: '', alamat: '', kontak: '', frekuensiVisit: '14', jarakKm: '' })
      toast({ title: 'Toko teregistrasi', description: 'Barcode toko otomatis dibuat untuk identifikasi kunjungan.' })
    },
    onError: (e: Error) => toast({ title: 'Gagal menambah toko', description: e.message, variant: 'destructive' }),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Tambah Toko Mitra</DialogTitle>
          <DialogDescription>Registrasi cepat toko baru — barcode kunjungan dibuat otomatis (BC-[kode]).</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5"><Label htmlFor="qa-kode">Kode Toko</Label><Input id="qa-kode" value={newToko.kodeToko} onChange={(e) => setNewToko({ ...newToko, kodeToko: e.target.value.toUpperCase() })} placeholder="TOK-007" className="font-mono" /></div>
          <div className="space-y-1.5"><Label htmlFor="qa-nama">Nama Toko</Label><HistoryInput historyKey="toko-nama" id="qa-nama" value={newToko.namaToko} onChange={(e) => setNewToko({ ...newToko, namaToko: e.target.value })} placeholder="cth: Elektronik Sejahtera" /></div>
          <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="qa-alamat">Alamat</Label><HistoryInput historyKey="toko-alamat" id="qa-alamat" value={newToko.alamat} onChange={(e) => setNewToko({ ...newToko, alamat: e.target.value })} /></div>
          <div className="space-y-1.5"><Label htmlFor="qa-kontak">Kontak</Label><Input id="qa-kontak" value={newToko.kontak} onChange={(e) => setNewToko({ ...newToko, kontak: e.target.value })} placeholder="021-xxx / 08xx" /></div>
          <div className="space-y-1.5"><Label htmlFor="qa-siklus">Siklus Visit (hari)</Label><Input id="qa-siklus" type="number" value={newToko.frekuensiVisit} onChange={(e) => setNewToko({ ...newToko, frekuensiVisit: e.target.value })} /></div>
          <div className="space-y-1.5"><Label htmlFor="qa-jarak">Jarak Workshop (km)</Label><Input id="qa-jarak" type="number" min="0" step="0.1" value={newToko.jarakKm} onChange={(e) => setNewToko({ ...newToko, jarakKm: e.target.value })} placeholder="opsional" /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Batal</Button>
          <Button className="bg-emerald-600 hover:bg-emerald-700" disabled={!newToko.kodeToko || !newToko.namaToko || addToko.isPending} onClick={() => addToko.mutate()}>
            <Plus className="mr-1 h-4 w-4" /> Simpan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function AddCustomerDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { toast } = useToast()
  const { role } = useAppStore()
  const invalidate = useInvalidate()
  const [newCust, setNewCust] = useState({ nama: '', noWa: '', alamat: '' })

  const addCust = useMutation({
    mutationFn: () => postJson('/api/customer', { ...newCust, aktor: role }),
    onSuccess: () => {
      invalidate(['customers'])
      onOpenChange(false)
      setNewCust({ nama: '', noWa: '', alamat: '' })
      toast({ title: 'Customer teregistrasi' })
    },
    onError: (e: Error) => toast({ title: 'Gagal menambah customer', description: e.message, variant: 'destructive' }),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Tambah Customer</DialogTitle>
          <DialogDescription>Data pemilik unit (end-user).</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5"><Label htmlFor="qc-nama">Nama</Label><HistoryInput historyKey="customer-nama" id="qc-nama" value={newCust.nama} onChange={(e) => setNewCust({ ...newCust, nama: e.target.value })} /></div>
          <div className="space-y-1.5"><Label htmlFor="qc-wa">No. WhatsApp</Label><Input id="qc-wa" value={newCust.noWa} onChange={(e) => setNewCust({ ...newCust, noWa: e.target.value })} placeholder="628xxx" /></div>
          <div className="space-y-1.5"><Label htmlFor="qc-alamat">Alamat</Label><HistoryInput historyKey="customer-alamat" id="qc-alamat" value={newCust.alamat} onChange={(e) => setNewCust({ ...newCust, alamat: e.target.value })} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Batal</Button>
          <Button className="bg-emerald-600 hover:bg-emerald-700" disabled={!newCust.nama || addCust.isPending} onClick={() => addCust.mutate()}>
            <Plus className="mr-1 h-4 w-4" /> Simpan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default function QuickActions() {
  const [tokoOpen, setTokoOpen] = useState(false)
  const [custOpen, setCustOpen] = useState(false)
  const { setView, navigateTo } = useAppStore()

  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-emerald-200 bg-gradient-to-r from-emerald-50 via-white to-teal-50 px-2.5 py-1.5">
        <span className="mr-0.5 hidden items-center gap-1 text-[11px] font-semibold text-emerald-700 sm:flex">
          <Zap className="h-3.5 w-3.5" /> Akses Cepat
        </span>
        <Button size="sm" className="h-7 bg-emerald-600 px-2.5 text-[11px] hover:bg-emerald-700" onClick={() => setTokoOpen(true)} title="Tambah Toko Mitra" aria-label="Tambah Toko Mitra">
          <Store className="mr-1 h-3.5 w-3.5" /> Toko
        </Button>
        <Button size="sm" className="h-7 bg-teal-600 px-2.5 text-[11px] hover:bg-teal-700" onClick={() => setCustOpen(true)} title="Tambah Customer" aria-label="Tambah Customer">
          <Users className="mr-1 h-3.5 w-3.5" /> Customer
        </Button>
        <Button size="sm" variant="outline" className="h-7 border-emerald-300 px-2.5 text-[11px] hover:bg-emerald-50" onClick={() => setView('field-ops')} title="Scan Kunjungan" aria-label="Buka Scan Kunjungan">
          <ScanLine className="mr-1 h-3.5 w-3.5 text-emerald-600" /> Scan
        </Button>
        <Button size="sm" variant="outline" className="h-7 border-violet-300 px-2.5 text-[11px] hover:bg-violet-50" onClick={() => navigateTo('master', { masterTab: 'unit' })} title="Unit Asset (Master Barcode)" aria-label="Buka Unit Asset">
          <QrCode className="mr-1 h-3.5 w-3.5 text-violet-600" /> Unit
        </Button>
        <Button size="sm" variant="outline" className="h-7 border-teal-300 px-2.5 text-[11px] hover:bg-teal-50" onClick={() => setView('gateway')} title="Gateway Pesan" aria-label="Buka Gateway">
          <Radio className="mr-1 h-3.5 w-3.5 text-teal-600" /> Gateway
        </Button>
      </div>

      <AddTokoDialog open={tokoOpen} onOpenChange={setTokoOpen} />
      <AddCustomerDialog open={custOpen} onOpenChange={setCustOpen} />
    </>
  )
}
