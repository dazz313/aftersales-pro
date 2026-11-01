</rfl:parameter> 'use client'

import { useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Printer } from 'lucide-react'
import type { Toko } from '@/lib/api'
import { cetakStikerTunggal, simpanKertasStiker, useKertasStiker, useStickerPrint } from '@/lib/sticker-print'
import { PilihKertas } from '@/components/stiker-kertas'

/**
 * Stiker Barcode TOKO — satu QR code per toko (bukan per unit).
 * Teknisi memindai QR ini saat kunjungan; sistem otomatis
 * mengenali toko & mencatat kunjungan (check-in otomatis).
 *
 * Bodi stiker diekspor (StikerTokoBody) agar dipakai ulang dialog tunggal
 * dan dialog cetak KOLEKTIF (banyak stiker dalam 1 lembar).
 *
 * Cetak: tombol "Cetak Stiker" memakai mode khusus (lib/sticker-print) — CSS
 * global menyembunyikan halaman lain sehingga hanya stiker .stiker-printroot
 * yang tercetak: mini 36 mm (pas label thermal 58 mm portable) & pojok kiri
 * atas untuk A4/Letter. QR code vektor (SVG) — tetap tajam saat dicetak mini.
 */

/** Bodi stiker toko — menggambar QR code sendiri, mandiri (dipakai tunggal & kolektif). */
export function StikerTokoBody({ toko }: { toko: Toko }) {
  const qrRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    import('qrcode')
      .then((mod) => {
        const QRCode = ((mod as { default?: unknown }).default ?? mod) as {
          toString: (text: string, opts: Record<string, unknown>, cb: (err: Error | null, str: string) => void) => void
        }
        if (cancelled || !qrRef.current || typeof QRCode?.toString !== 'function') return
        QRCode.toString(toko.barcodeToko, { type: 'svg', width: 96, margin: 1, color: { dark: '#0f172a', light: '#ffffff' } }, (err, svg) => {
          if (cancelled || !qrRef.current) return
          if (err || !svg) { console.error('Render QR toko gagal:', err); return }
          qrRef.current.innerHTML = svg
          const el = qrRef.current.querySelector('svg')
          if (el) { el.setAttribute('class', 'block max-w-full'); el.setAttribute('aria-label', `QR ${toko.barcodeToko}`) }
        })
      })
      .catch((e) => console.error('Render QR toko gagal:', e))
    return () => { cancelled = true }
  }, [toko])

  return (
    <div className="stiker-printroot mx-auto w-full max-w-[196px] overflow-hidden rounded-lg border-2 border-slate-900 bg-white">
      {/* Strip kepala — identitas stiker + frekuensi kunjungan */}
      <div className="flex items-center justify-between bg-emerald-600 px-1.5 py-0.5">
        <p className="text-[7px] font-bold tracking-widest text-white">QR KUNJUNGAN</p>
        <p className="rounded-full bg-white/20 px-1 py-0 text-[7px] font-bold text-white">Visit {toko.frekuensiVisit}h</p>
      </div>

      {/* Identitas toko */}
      <div className="px-1.5 py-0.5 text-center">
        <p className="text-[11px] font-extrabold leading-tight text-slate-900">{toko.namaToko}</p>
        <p className="font-mono text-[8px] font-medium leading-none text-slate-500">{toko.kodeToko}</p>
        {toko.alamat && (
          <p className="mt-0.5 truncate text-[8px] leading-tight text-slate-500" title={toko.alamat}>{toko.alamat}</p>
        )}
      </div>

      {/* QR code — vektor SVG, tetap tajam saat dicetak mini */}
      <div className="flex justify-center border-t border-slate-900/10 px-1 pb-0 pt-0.5">
        <div ref={qrRef} className="block max-w-full" />
      </div>

      {/* Strip kaki — nilai yang ter-encode (cadangan bila QR rusak/terkelupas) */}
      <div className="flex items-center justify-between border-t border-slate-900/10 bg-slate-50 px-1.5 py-0.5">
        <p className="truncate font-mono text-[8px] font-bold text-slate-900">{toko.barcodeToko}</p>
        <p className="text-[7px] text-slate-500">Scan → check-in</p>
      </div>
    </div>
  )
}

export default function TokoBarcodeSticker({ toko, onOpenChange }: { toko: Toko | null; onOpenChange: (o: boolean) => void }) {
  // SETTING KERTAS per perangkat (A4 printer biasa / label thermal) — live via store
  const kertas = useKertasStiker()
  // Mode cetak stiker aktif selama dialog terbuka (ukuran kertas + Ctrl+P manual)
  useStickerPrint(!!toko, 'stiker', kertas)

  return (
    <Dialog open={!!toko} onOpenChange={onOpenChange}>
      <DialogContent className="stiker-dialog sm:max-w-sm">
        {toko && (
          <>
            <DialogHeader>
              <DialogTitle>Stiker Barcode Toko</DialogTitle>
              <DialogDescription>
                Tempel di lokasi kasir/pintu toko — teknisi scan stiker ini saat kunjungan,
                sistem otomatis mencatat check-in. Pilih kertas di bawah: A4 (printer biasa,
                stiker 44 mm) atau label thermal 58 mm (mini 36 mm). Centang beberapa toko
                di daftar untuk cetak kolektif.
              </DialogDescription>
            </DialogHeader>

            {/* ==== Stiker (inilah yang tercetak) ==== */}
            <StikerTokoBody toko={toko} />

            <DialogFooter className="sm:justify-between">
              <PilihKertas
                value={kertas}
                onChange={(k) => simpanKertasStiker(k)}
              />
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => onOpenChange(false)}>Tutup</Button>
                <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={() => cetakStikerTunggal(kertas)}>
                  <Printer className="mr-1 h-4 w-4" /> Cetak Stiker
                </Button>
              </div>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
