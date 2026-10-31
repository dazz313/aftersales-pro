'use client'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Printer } from 'lucide-react'
import type { Toko, UnitAsset } from '@/lib/api'
import { cetakStiker, useStickerPrint } from '@/lib/sticker-print'
import { StikerTokoBody } from '@/components/toko-barcode-sticker'
import { StikerUnitBody } from '@/components/unit-barcode-sticker'

/**
 * ===== CETAK STIKER KOLEKTIF — banyak stiker dalam 1 lembar =====
 *
 * Menerima daftar toko ATAU unit hasil centang di tab Master (checkbox pilih),
 * menampilkan pratinjau berjejer (.stiker-kolektif-grid), lalu mencetak: mode
 * body[data-print-mode='stiker-kolektif'] (lib/sticker-print) membuat CSS cetak
 * menampilkan hanya kolom stiker — tiap stiker tetap mini 42 mm sehingga
 * ±4 stiker per baris di kertas A4 (dan masih muat stiker-kecil di thermal).
 */

function KolektifFooter({ jumlah, onTutup }: { jumlah: number; onTutup: () => void }) {
  return (
    <DialogFooter>
      <Badge variant="outline" className="mr-auto text-[10px] text-slate-500">{jumlah} stiker dalam 1 lembar</Badge>
      <Button variant="outline" onClick={onTutup}>Tutup</Button>
      <Button className="bg-emerald-600 hover:bg-emerald-700" disabled={jumlah === 0} onClick={() => cetakStiker('stiker-kolektif')}>
        <Printer className="mr-1 h-4 w-4" /> Cetak {jumlah} Stiker
      </Button>
    </DialogFooter>
  )
}

export function TokoBarcodeKolektif({ open, list, onOpenChange }: { open: boolean; list: Toko[]; onOpenChange: (o: boolean) => void }) {
  useStickerPrint(open, 'stiker-kolektif')
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="stiker-dialog stiker-kolektif-dialog sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Cetak Stiker Kolektif — Toko ({list.length})</DialogTitle>
          <DialogDescription>
            Semua stiker yang dicentang dicetak berjejajar dalam 1 lembar (mini 42 mm,
            ±4 kolom per baris di A4). Potong sesuai garis bingkai setelahnya.
          </DialogDescription>
        </DialogHeader>
        <div className="stiker-kolektif-grid stiker-printroot flex max-h-[60vh] flex-wrap gap-2 overflow-auto rounded-md border border-slate-100 bg-slate-50 p-2">
          {list.map((t) => (
            <StikerTokoBody key={t.id} toko={t} />
          ))}
        </div>
        <KolektifFooter jumlah={list.length} onTutup={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  )
}

export function UnitBarcodeKolektif({ open, list, onOpenChange }: { open: boolean; list: UnitAsset[]; onOpenChange: (o: boolean) => void }) {
  useStickerPrint(open, 'stiker-kolektif')
  const tanpaSeri = list.filter((u) => !u.serialNumber).length
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="stiker-dialog stiker-kolektif-dialog sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Cetak Stiker Kolektif — Unit ({list.length})</DialogTitle>
          <DialogDescription>
            Semua stiker unit yang dicentang dicetak berjejajar dalam 1 lembar (mini
            42 mm, ±4 kolom per baris di A4).
            {tanpaSeri > 0 && ` Perhatian: ${tanpaSeri} unit belum punya nomor seri — stikernya tanpa barcode.`}
          </DialogDescription>
        </DialogHeader>
        <div className="stiker-kolektif-grid stiker-printroot flex max-h-[60vh] flex-wrap gap-2 overflow-auto rounded-md border border-slate-100 bg-slate-50 p-2">
          {list.map((u) => (
            <StikerUnitBody key={u.id} unit={u} />
          ))}
        </div>
        <KolektifFooter jumlah={list.length} onTutup={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  )
}
