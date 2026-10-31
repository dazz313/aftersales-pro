'use client'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Printer } from 'lucide-react'
import type { Toko, UnitAsset } from '@/lib/api'
import { cetakStikerKolektif, simpanKertasStiker, useKertasStiker, useStickerPrint } from '@/lib/sticker-print'
import { PilihKertas } from '@/components/stiker-kertas'
import { StikerTokoBody } from '@/components/toko-barcode-sticker'
import { StikerUnitBody } from '@/components/unit-barcode-sticker'

/**
 * ===== CETAK STIKER KOLEKTIF — banyak stiker dalam 1 lembar =====
 *
 * Menerima daftar toko ATAU unit hasil centang di tab Master menampilkan
 * pratinjau berjejer (.stiker-kolektif-grid), lalu mencetak: mode
 * body[data-print-mode='stiker-kolektif'] membuat CSS cetak menampilkan hanya
 * kolom stiker — tiap stiker berukuran mengikuti SETTING KERTAS: A4 printer
 * biasa 44 mm (±4 kolom per baris) / label thermal 58 mm mini 36 mm.
 */

export function TokoBarcodeKolektif({ open, list, onOpenChange }: { open: boolean; list: Toko[]; onOpenChange: (o: boolean) => void }) {
  const kertas = useKertasStiker()
  useStickerPrint(open, 'stiker-kolektif', kertas)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="stiker-dialog stiker-kolektif-dialog sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Cetak Stiker Kolektif — Toko ({list.length})</DialogTitle>
          <DialogDescription>
            Semua stiker yang dicentang dicetak berjejer dalam 1 lembar, dipusatkan dan
            terpotong rapi ({kertas === 'THERMAL' ? 'mini 36 mm untuk label thermal' : '44 mm untuk kertas A4'}).
          </DialogDescription>
        </DialogHeader>
        <div className="stiker-kolektif-grid stiker-printroot flex max-h-[60vh] flex-wrap gap-2 overflow-auto rounded-md border border-slate-100 bg-slate-50 p-2">
          {list.map((t) => (
            <StikerTokoBody key={t.id} toko={t} />
          ))}
        </div>
        <DialogFooter className="sm:justify-between">
          <PilihKertas
            value={kertas}
            onChange={(k) => simpanKertasStiker(k)}
          />
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Tutup</Button>
            <Button className="bg-emerald-600 hover:bg-emerald-700" disabled={list.length === 0} onClick={() => cetakStikerKolektif(kertas)}>
              <Printer className="mr-1 h-4 w-4" /> Cetak {list.length} Stiker
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function UnitBarcodeKolektif({ open, list, onOpenChange }: { open: boolean; list: UnitAsset[]; onOpenChange: (o: boolean) => void }) {
  const kertas = useKertasStiker()
  useStickerPrint(open, 'stiker-kolektif', kertas)
  const tanpaSeri = list.filter((u) => !u.serialNumber).length
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="stiker-dialog stiker-kolektif-dialog sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Cetak Stiker Kolektif — Unit ({list.length})</DialogTitle>
          <DialogDescription>
            Semua stiker unit yang dicentang dicetak berjejer dalam 1 lembar.
            {tanpaSeri > 0 && ` Perhatian: ${tanpaSeri} unit belum punya nomor seri — stikernya tanpa barcode.`}
          </DialogDescription>
        </DialogHeader>
        <div className="stiker-kolektif-grid stiker-printroot flex max-h-[60vh] flex-wrap gap-2 overflow-auto rounded-md border border-slate-100 bg-slate-50 p-2">
          {list.map((u) => (
            <StikerUnitBody key={u.id} unit={u} />
          ))}
        </div>
        <DialogFooter className="sm:justify-between">
          <PilihKertas
            value={kertas}
            onChange={(k) => simpanKertasStiker(k)}
          />
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Tutup</Button>
            <Button className="bg-emerald-600 hover:bg-emerald-700" disabled={list.length === 0} onClick={() => cetakStikerKolektif(kertas)}>
              <Printer className="mr-1 h-4 w-4" /> Cetak {list.length} Stiker
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
