'use client'

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { postJson } from '@/lib/api'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useToast } from '@/hooks/use-toast'
import { useAppStore } from '@/lib/store'
import { Plus, Store, Users, ScanLine, Radio, Zap } from 'lucide-react'

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
  const [newToko, setNewToko] = useState({ kodeToko: '', namaToko: '', alamat: '', kontak: '', frekuensiVisit: '14' })

  const addToko = useMutation({
    mutationFn: () => postJson('/api/toko', { ...newToko, frekuensiVisit: Number(newToko.frekuensiVisit), aktor: role }),
    onSuccess: () => {
      invalidate(['toko', 'dashboard', 'alerts'])
      onOpenChange(false)
      setNewToko({ kodeToko: '', namaToko: '', alamat: '', kontak: '', frekuensiVisit: '14' })
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
          <div className="space-y-1.5"><Label htmlFor="qa-nama">Nama Toko</Label><Input id="qa-nama" value={newToko.namaToko} onChange={(e) => setNewToko({ ...newToko, namaToko: e.target.value })} placeholder="cth: Elektronik Sejahtera" /></div>
          <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="qa-alamat">Alamat</Label><Input id="qa-alamat" value={newToko.alamat} onChange={(e) => setNewToko({ ...newToko, alamat: e.target.value })} /></div>
          <div className="space-y-1.5"><Label htmlFor="qa-kontak">Kontak</Label><Input id="qa-kontak" value={newToko.kontak} onChange={(e) => setNewToko({ ...newToko, kontak: e.target.value })} placeholder="021-xxx / 08xx" /></div>
          <div className="space-y-1.5"><Label htmlFor="qa-siklus">Siklus Visit (hari)</Label><Input id="qa-siklus" type="number" value={newToko.frekuensiVisit} onChange={(e) => setNewToko({ ...newToko, frekuensiVisit: e.target.value })} /></div>
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
          <div className="space-y-1.5"><Label htmlFor="qc-nama">Nama</Label><Input id="qc-nama" value={newCust.nama} onChange={(e) => setNewCust({ ...newCust, nama: e.target.value })} /></div>
          <div className="space-y-1.5"><Label htmlFor="qc-wa">No. WhatsApp</Label><Input id="qc-wa" value={newCust.noWa} onChange={(e) => setNewCust({ ...newCust, noWa: e.target.value })} placeholder="628xxx" /></div>
          <div className="space-y-1.5"><Label htmlFor="qc-alamat">Alamat</Label><Input id="qc-alamat" value={newCust.alamat} onChange={(e) => setNewCust({ ...newCust, alamat: e.target.value })} /></div>
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
  const { setView } = useAppStore()

  return (
    <>
      <Card className="border-emerald-200 bg-gradient-to-r from-emerald-50 via-white to-teal-50">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Zap className="h-4 w-4 text-emerald-600" /> Akses Cepat
          </CardTitle>
          <CardDescription>Tambah data & akses fitur utama tanpa berpindah menu</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={() => setTokoOpen(true)}>
            <Store className="mr-1.5 h-4 w-4" /> Add Toko
          </Button>
          <Button className="bg-teal-600 hover:bg-teal-700" onClick={() => setCustOpen(true)}>
            <Users className="mr-1.5 h-4 w-4" /> Add Customer
          </Button>
          <Button variant="outline" className="border-emerald-300 hover:bg-emerald-50" onClick={() => setView('field-ops')}>
            <ScanLine className="mr-1.5 h-4 w-4 text-emerald-600" /> Scan Kunjungan
          </Button>
          <Button variant="outline" className="border-teal-300 hover:bg-teal-50" onClick={() => setView('gateway')}>
            <Radio className="mr-1.5 h-4 w-4 text-teal-600" /> Gateway
          </Button>
        </CardContent>
      </Card>

      <AddTokoDialog open={tokoOpen} onOpenChange={setTokoOpen} />
      <AddCustomerDialog open={custOpen} onOpenChange={setCustOpen} />
    </>
  )
}
