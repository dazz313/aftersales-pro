'use client'

import { useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Barcode } from 'lucide-react'
import { formatTanggal, type UnitAsset } from '@/lib/api'
import { GARANSI_LABEL } from '@/lib/types'
import { cn } from '@/lib/utils'
import { cetakStiker, useStickerPrint } from '@/lib/sticker-print'

/**
 * Stiker Barcode UNIT ASSET — layout:
 * tgl input, toko/customer (toko atau perorangan sesuai input), merk,
 * model/tipe, nomor seri, status (STOK-TOKO/GARANSI/NON-GARANSI) + tgl garansi.
 * Barcode CODE128 asli (jsbarcode) dari serial number agar bisa dipindai.
 */
export default function UnitBarcodeSticker({ unit, onOpenChange }: { unit: UnitAsset | null; onOpenChange: (o: boolean) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  // Mode cetak stiker aktif selama dialog terbuka (ukuran kertas + Ctrl+P manual)
  useStickerPrint(!!unit)

  useEffect(() => {
    if (!unit?.serialNumber) return
    let cancelled = false
    import('jsbarcode')
      .then((mod) => {
        const JsBarcode = ((mod as { default?: unknown }).default ?? mod) as (
          el: HTMLElement, value: string, options?: Record<string, unknown>
        ) => void
        if (cancelled || !canvasRef.current || typeof JsBarcode !== 'function') return
        try {
          JsBarcode(canvasRef.current, unit.serialNumber, {
            format: 'CODE128',
            width: 1.8,
            height: 56,
            displayValue: true,
            fontSize: 12,
            margin: 6,
            background: '#ffffff',
          })
        } catch (e) {
          console.error('Render barcode unit gagal:', e)
        }
      })
      .catch((e) => console.error('Render barcode unit gagal:', e))
    return () => {
      cancelled = true
    }
  }, [unit])

  const statusLabel = unit ? (GARANSI_LABEL[unit.statusGaransi] ?? unit.statusGaransi.replace('_', '-')) : ''
  // Tanggal awal = tanggal input registrasi; tgl garansi (tgl beli) tampil di field Status
  const tanggalInput = unit ? formatTanggal(unit.createdAt) : '-'
  const tglGaransi = unit?.tglPembelian ? formatTanggal(unit.tglPembelian) : null

  return (
    <Dialog open={!!unit} onOpenChange={onOpenChange}>
      <DialogContent className="stiker-dialog sm:max-w-sm">
        {unit && (
          <>
            <DialogHeader>
              <DialogTitle>Stiker Barcode Unit</DialogTitle>
              <DialogDescription>Tempel di unit — teknisi scan untuk identifikasi garansi &amp; asal toko/customer.</DialogDescription>
            </DialogHeader>
            <div className="stiker-printroot mx-auto w-full max-w-xs rounded-xl border-2 border-slate-200 bg-white p-4 text-center shadow-sm">
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Unit Asset Sticker</p>

              {/* Barcode visual CODE128 asli — hanya bila nomor seri sudah terisi */}
              <div className="mt-2 flex justify-center">
                {unit.serialNumber ? (
                  <canvas ref={canvasRef} aria-label={`Barcode ${unit.serialNumber}`} />
                ) : (
                  <p className="rounded-md bg-amber-50 px-3 py-2 text-[11px] font-medium text-amber-700">
                    Nomor seri belum diisi — isi lewat Edit Unit, lalu buka kembali stiker ini.
                  </p>
                )}
              </div>

              {/* Layout: tgl input, toko/customer, merk, model/tipe, nomor seri, status + tgl garansi */}
              <dl className="mt-3 space-y-1 border-t border-dashed border-slate-200 pt-3 text-left">
                <div className="flex justify-between gap-2 text-xs">
                  <dt className="shrink-0 text-slate-400">Tanggal Input</dt>
                  <dd className="font-medium text-slate-800">{tanggalInput}</dd>
                </div>
                <div className="flex justify-between gap-2 text-xs">
                  <dt className="shrink-0 text-slate-400">Toko / Customer</dt>
                  <dd className="text-right font-semibold text-slate-900">
                    {unit.toko ? (
                      <>
                        {unit.toko.namaToko}
                        <span className="ml-1 font-mono text-[10px] font-normal text-slate-400">{unit.toko.kodeToko}</span>
                      </>
                    ) : unit.customer ? (
                      <>
                        {unit.customer.nama}
                        <span className="ml-1 text-[10px] font-normal text-slate-400">Perorangan</span>
                      </>
                    ) : (
                      '-'
                    )}
                  </dd>
                </div>
                <div className="flex justify-between gap-2 text-xs">
                  <dt className="shrink-0 text-slate-400">Merk</dt>
                  <dd className="font-medium text-slate-800">{unit.merk?.trim() || '-'}</dd>
                </div>
                <div className="flex justify-between gap-2 text-xs">
                  <dt className="shrink-0 text-slate-400">Model / Tipe</dt>
                  <dd className="text-right font-medium text-slate-800">{unit.modelUnit}</dd>
                </div>
                <div className="flex justify-between gap-2 text-xs">
                  <dt className="shrink-0 text-slate-400">Nomor Seri</dt>
                  <dd className="break-all font-mono text-[11px] font-bold text-slate-900">{unit.serialNumber || '-'}</dd>
                </div>
                <div className="flex items-center justify-between gap-2 text-xs">
                  <dt className="shrink-0 text-slate-400">Status</dt>
                  <dd className="text-right">
                    <Badge
                      variant="outline"
                      className={cn(
                        'text-[10px]',
                        unit.statusGaransi === 'NON_GARANSI'
                          ? 'border-amber-300 text-amber-700'
                          : unit.statusGaransi === 'STOK_TOKO'
                            ? 'border-teal-300 text-teal-700'
                            : 'border-emerald-300 text-emerald-700'
                      )}
                    >
                      {statusLabel}
                    </Badge>
                    {tglGaransi && (
                      <p className="mt-0.5 text-[10px] font-normal text-slate-500" title="Tgl pembelian — awal masa garansi">
                        {tglGaransi}
                      </p>
                    )}
                  </dd>
                </div>
                {unit.nama?.trim() && (
                  <div className="flex justify-between gap-2 text-xs">
                    <dt className="shrink-0 text-slate-400">Nama Unit</dt>
                    <dd className="text-right text-slate-500">{unit.nama.trim()}</dd>
                  </div>
                )}
              </dl>

              <p className="mt-2 break-all font-mono text-[9px] text-slate-400">
                SN:{unit.serialNumber}|MOD:{unit.modelUnit}|TOK:{unit.toko?.kodeToko ?? '-'}
              </p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Tutup</Button>
              <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={cetakStiker}>
                <Barcode className="mr-1 h-4 w-4" /> Cetak Stiker
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
