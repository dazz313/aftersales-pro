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
 * Bodi stiker diekspor (StikerTokoBody) agar dipakai ulang dialog tunggal
 * dan dialog cetak KOLEKTIF (banyak stiker dalam 1 lembar).
 *
 * Cetak: tombol "Cetak Stiker" memakai mode khusus (lib/sticker-print) — CSS
 * global menyembunyikan halaman lain sehingga hanya stiker .stiker-printroot
 * yang tercetak: mini 42 mm (pas label thermal 58 mm portable) & pojok kiri
 * atas untuk A4/Letter. Barcode SVG vektor — tetap tajam saat disusutkan.
 */

/** Bodi stiker toko — menggambar barcode sendiri, mandiri (dipakai tunggal & kolektif). */
export function StikerTokoBody({ toko }: { toko: Toko }) {
  const svgRef = useRef<SVGSVGElement>(null)

  useEffect(() => {
    let cancelled = false
    // Import dinamis: aman untuk SSR & menangani bentuk ekspor CJS/ESM jsbarcode.
    // Digambar ke SVG (bukan canvas) — vektor sehingga tetap tajam saat dicetak
    // mini (42 mm) di printer label portable.
    import('jsbarcode')
      .then((mod) => {
        const JsBarcode = ((mod as { default?: unknown }).default ?? mod) as (
          el: HTMLElement, value: string, options?: Record<string, unknown>
        ) => void
        if (cancelled || !svgRef.current || typeof JsBarcode !== 'function') return
        try {
          JsBarcode(svgRef.current as unknown as HTMLElement, toko.barcodeToko, {
            format: 'CODE128',
            width: 1.6,
            height: 50,
            displayValue: true,
            fontSize: 13,
            fontOptions: 'bold',
            textMargin: 2,
            margin: 5,
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
    <div className="stiker-printroot mx-auto w-full max-w-[232px] overflow-hidden rounded-lg border-2 border-slate-900 bg-white">
      {/* Strip kepala — identitas stiker + frekuensi kunjungan */}
      <div className="flex items-center justify-between bg-emerald-600 px-2.5 py-1">
        <p className="text-[8px] font-bold tracking-[0.15em] text-white">BARCODE KUNJUNGAN</p>
        <p className="rounded-full bg-white/20 px-1.5 py-0.5 text-[8px] font-bold text-white">Visit {toko.frekuensiVisit}h</p>
      </div>

      {/* Identitas toko */}
      <div className="px-2.5 py-1.5 text-center">
        <p className="text-[13px] font-extrabold leading-snug text-slate-900">{toko.namaToko}</p>
        <p className="font-mono text-[9px] font-medium text-slate-500">{toko.kodeToko}</p>
        {toko.alamat && (
          <p className="mt-0.5 truncate text-[9px] text-slate-500" title={toko.alamat}>{toko.alamat}</p>
        )}
      </div>

      {/* Barcode CODE128 — digambar jsbarcode ke SVG (ikut tercetak, tetap tajam saat mini) */}
      <div className="flex justify-center border-t border-slate-900/10 px-2 pb-0.5 pt-1.5">
        <svg ref={svgRef} aria-label={`Barcode ${toko.barcodeToko}`} className="block max-w-full" />
      </div>

      {/* Strip kaki — nilai barcode (cadangan bila barcode rusak/terkelupas) */}
      <div className="flex items-center justify-between border-t border-slate-900/10 bg-slate-50 px-2.5 py-1">
        <p className="font-mono text-[9px] font-bold text-slate-900">{toko.barcodeToko}</p>
        <p className="text-[8px] text-slate-500">Scan → check-in otomatis</p>
      </div>
    </div>
  )
}

export default function TokoBarcodeSticker({ toko, onOpenChange }: { toko: Toko | null; onOpenChange: (o: boolean) => void }) {
  // Mode cetak stiker aktif selama dialog terbuka (ukuran kertas + Ctrl+P manual)
  useStickerPrint(!!toko)

  return (
    <Dialog open={!!toko} onOpenChange={onOpenChange}>
      <DialogContent className="stiker-dialog sm:max-w-sm">
        {toko && (
          <>
            <DialogHeader>
              <DialogTitle>Stiker Barcode Toko</DialogTitle>
              <DialogDescription>
                Tempel di lokasi kasir/pintu toko — teknisi scan stiker ini saat kunjungan,
                sistem otomatis mencatat check-in. Mini 42 mm — pas label thermal 58 mm (portable)
                maupun pojok kiri atas kertas A4. Centang beberapa toko di daftar untuk cetak kolektif.
              </DialogDescription>
            </DialogHeader>

            {/* ==== Stiker (inilah yang tercetak) ==== */}
            <StikerTokoBody toko={toko} />

            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Tutup</Button>
              <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={() => cetakStiker()}>
                <Printer className="mr-1 h-4 w-4" /> Cetak Stiker
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
