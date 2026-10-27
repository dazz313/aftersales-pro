'use client'

import { useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Printer } from 'lucide-react'
import type { Toko } from '@/lib/api'
import { cetakStiker, useStickerPrint } from '@/lib/sticker-print'

/**
 * Stiker Barcode TOKO — satu barcode per toko (bukan per unit).
 * Teknisi memindai stiker ini saat kunjungan; sistem otomatis
 * mengenali toko & mencatat kunjungan (check-in otomatis).
 *
 * Cetak: tombol "Cetak Stiker" memakai mode khusus (lib/sticker-print) — CSS
 * global menyembunyikan halaman lain sehingga hanya stiker .stiker-printroot
 * yang tercetak di pojok kiri atas kertas (A4/Letter, margin 10 mm).
 */
export default function TokoBarcodeSticker({ toko, onOpenChange }: { toko: Toko | null; onOpenChange: (o: boolean) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  // Mode cetak stiker aktif selama dialog terbuka (ukuran kertas + Ctrl+P manual)
  useStickerPrint(!!toko)

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
        try {
          JsBarcode(canvasRef.current, toko.barcodeToko, {
            format: 'CODE128',
            width: 2,
            height: 64,
            displayValue: true,
            fontSize: 15,
            fontOptions: 'bold',
            textMargin: 2,
            margin: 10,
            lineColor: '#0f172a',
            background: '#ffffff',
          })
        } catch (e) {
          console.error('Render barcode toko gagal:', e)
        }
      })
      .catch((e) => console.error('Render barcode toko gagal:', e))
    return () => {
      cancelled = true
    }
  }, [toko])

  return (
    <Dialog open={!!toko} onOpenChange={onOpenChange}>
      <DialogContent className="stiker-dialog sm:max-w-sm">
        {toko && (
          <>
            <DialogHeader>
              <DialogTitle>Stiker Barcode Toko</DialogTitle>
              <DialogDescription>
                Tempel di lokasi kasir/pintu toko — teknisi scan stiker ini saat kunjungan,
                sistem otomatis mencatat check-in. Tercetak di pojok kiri atas kertas.
              </DialogDescription>
            </DialogHeader>

            {/* ==== Stiker (inilah yang tercetak) ==== */}
            <div className="stiker-printroot mx-auto w-full max-w-[280px] overflow-hidden rounded-lg border-2 border-slate-900 bg-white">
              {/* Strip kepala — identitas stiker + frekuensi kunjungan */}
              <div className="flex items-center justify-between bg-emerald-600 px-3 py-1.5">
                <p className="text-[9px] font-bold tracking-[0.2em] text-white">BARCODE KUNJUNGAN</p>
                <p className="rounded-full bg-white/20 px-1.5 py-0.5 text-[9px] font-bold text-white">Visit {toko.frekuensiVisit}h</p>
              </div>

              {/* Identitas toko */}
              <div className="px-3 py-2 text-center">
                <p className="text-[15px] font-extrabold leading-snug text-slate-900">{toko.namaToko}</p>
                <p className="font-mono text-[10px] font-medium text-slate-500">{toko.kodeToko}</p>
                {toko.alamat && (
                  <p className="mt-0.5 truncate text-[10px] text-slate-500" title={toko.alamat}>{toko.alamat}</p>
                )}
              </div>

              {/* Barcode CODE128 — digambar jsbarcode ke canvas (ikut tercetak) */}
              <div className="flex justify-center border-t border-slate-900/10 px-3 pb-1 pt-2">
                <canvas ref={canvasRef} aria-label={`Barcode ${toko.barcodeToko}`} />
              </div>

              {/* Strip kaki — nilai barcode (cadangan bila barcode rusak/terkelupas) */}
              <div className="flex items-center justify-between border-t border-slate-900/10 bg-slate-50 px-3 py-1.5">
                <p className="font-mono text-[10px] font-bold text-slate-900">{toko.barcodeToko}</p>
                <p className="text-[9px] text-slate-500">Scan → check-in otomatis</p>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Tutup</Button>
              <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={cetakStiker}>
                <Printer className="mr-1 h-4 w-4" /> Cetak Stiker
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
