'use client'

import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import NotaSheet from '@/components/nota/nota-sheet'
import { Send, Printer, FileEdit } from 'lucide-react'
import type { NotaData } from '@/lib/nota'

/**
 * Dialog "Duplikasi Nota" yang muncul saat menekan tombol Ajukan Klaim di
 * view Klaim & Rekap: nota BASS yang SUDAH TERISI DATA dari tiket service —
 * bisa dilihat live, diedit manual (dibuka di view Nota), dicetak PDF, lalu
 * klaim tetap diajukan dari tombol di footer dialog.
 */
export default function NotaKlaimDialog({
  nota,
  tiket,
  onClose,
  onEditManual,
  onSubmitClaim,
  sedangAju,
  sudahDiajukan,
}: {
  nota: NotaData
  tiket: { noTiket: string; nilaiKlaim?: number | null }
  onClose: () => void
  onEditManual: () => void
  onSubmitClaim: () => void
  sedangAju?: boolean
  sudahDiajukan?: boolean
}) {
  const [lembar, setLembar] = useState<1 | 2>(1)
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-[98vw] sm:max-w-5xl max-h-[94vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Send className="h-4 w-4" /> Duplikasi Nota Klaim — Tiket {tiket.noTiket}
          </DialogTitle>
          <DialogDescription>
            Nota BASS <b className="font-mono">{nota.nomorBass}</b> sudah terisi data dari tiket. Boleh diedit manual atau langsung dicetak sebagai bukti klaim.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-lg border border-slate-300 bg-slate-50 p-3">
          <NotaSheet nota={nota} lembar={lembar} printable />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-full border border-input overflow-hidden">
            {[1, 2].map((l) => (
              <button
                key={l}
                onClick={() => setLembar(l as 1 | 2)}
                className={lembar === l ? 'bg-slate-900 text-white px-3 py-1.5 text-xs font-bold' : 'px-3 py-1.5 text-xs text-slate-600'}
              >
                Lembar {l} dari 2
              </button>
            ))}
          </div>
          <Button variant="outline" size="sm" onClick={() => window.print()}>
            <Printer className="mr-1 h-4 w-4" /> Cetak / PDF
          </Button>
          <Button variant="outline" size="sm" onClick={onEditManual}>
            <FileEdit className="mr-1 h-4 w-4" /> Edit Manual
          </Button>
          <div className="ml-auto flex items-center gap-2">
            {sudahDiajukan ? (
              <p className="text-xs text-emerald-700">Klaim tiket ini sudah diajukan.</p>
            ) : (
              <Button size="sm" className="bg-amber-600 hover:bg-amber-700" onClick={onSubmitClaim} disabled={sedangAju}>
                <Send className="mr-1 h-4 w-4" /> {sedangAju ? 'Mengajukan…' : 'Lanjut: Ajukan Klaim'}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
