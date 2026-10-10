'use client'

import { useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Barcode } from 'lucide-react'
import type { Toko } from '@/lib/api'

/**
 * Stiker Barcode TOKO — satu barcode per toko (bukan per unit).
 * Teknisi memindai stiker ini saat kunjungan; sistem otomatis
 * mengenali toko & mencatat kunjungan (check-in otomatis).
 */
export default function TokoBarcodeSticker({ toko, onOpenChange }: { toko: Toko | null; onOpenChange: (o: boolean) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (!toko) return
    let cancelled = false
    // Import dinamis: aman untuk SSR & menangani bentuk ekspor CJS/ESM jsbarcode
    import('jsbarcode')
      .then((mod) => {
        const JsBarcode = ((mod as { default?: unknown }).default ?? mod) as (
          el: HTMLElement, value: string, options?: Record<string, unknown>
        ) => void
        if (cancelled || !canvasRef.current || typeof JsBarcode !== 'function') return
        JsBarcode(canvasRef.current, toko.barcodeToko, {
          format: 'CODE128',
          width: 2,
          height: 60,
          displayValue: true,
          fontSize: 14,
          margin: 8,
          background: '#ffffff',
        })
      })
      .catch((e) => console.error('Render barcode toko gagal:', e))
    return () => {
      cancelled = true
    }
  }, [toko])

  return (
    <Dialog open={!!toko} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        {toko && (
          <>
            <DialogHeader>
              <DialogTitle>Stiker Barcode Toko</DialogTitle>
              <DialogDescription>
                Tempel di lokasi kasir/pintu toko. Teknisi scan stiker ini saat kunjungan — sistem otomatis mencatat check-in.
              </DialogDescription>
            </DialogHeader>
            <div className="mx-auto w-full max-w-xs rounded-xl border-2 border-slate-200 bg-white p-4 text-center shadow-sm">
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Kunjungan Toko — Barcode</p>
              <p className="mt-1 text-sm font-bold text-slate-900">{toko.namaToko}</p>
              <p className="font-mono text-[11px] text-slate-500">{toko.kodeToko}</p>
              <div className="mt-3 flex justify-center">
                <canvas ref={canvasRef} aria-label={`Barcode ${toko.barcodeToko}`} />
              </div>
              <div className="mt-2 flex justify-center gap-1">
                <Badge variant="outline" className="font-mono text-[9px]">{toko.barcodeToko}</Badge>
                <Badge variant="outline" className="text-[9px]">Visit {toko.frekuensiVisit}h</Badge>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Tutup</Button>
              <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={() => window.print()}>
                <Barcode className="mr-1 h-4 w-4" /> Cetak Stiker
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
