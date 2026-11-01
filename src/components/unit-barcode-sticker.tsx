'use client'

import { useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Barcode } from 'lucide-react'
import { formatTanggal, type UnitAsset } from '@/lib/api'
import { GARANSI_LABEL } from '@/lib/types'
import { cn } from '@/lib/utils'
import { cetakStikerTunggal, simpanKertasStiker, useKertasStiker, useStickerPrint } from '@/lib/sticker-print'
import { PilihKertas } from '@/components/stiker-kertas'

/**
 * Stiker Barcode UNIT ASSET — layout:
 * tgl input, toko/customer (toko atau perorangan sesuai input), merk,
 * model/tipe, nomor seri, status (STOK-TOKO/GARANSI/NON-GARANSI) + tgl garansi.
 * Barcode CODE128 asli (jsbarcode→SVG vektor) dari serial number agar bisa
 * dipindai, tetap tajam saat dicetak mini/ketut kolektif.
 *
 * Bodi stiker diekspor (StikerUnitBody) agar dipakai ulang dialog tunggal dan
 * dialog cetak KOLEKTIF (banyak stiker dalam 1 lembar).
 */

export function StikerUnitBody({ unit }: { unit: UnitAsset }) {
  const svgRef = useRef<SVGSVGElement>(null)

  useEffect(() => {
    if (!unit?.serialNumber) return
    let cancelled = false
    // Digambar ke SVG (bukan canvas) — vektor sehingga tetap tajam saat dicetak
    // mini (36 mm) di printer label portable.
    import('jsbarcode')
      .then((mod) => {
        const JsBarcode = ((mod as { default?: unknown }).default ?? mod) as (
          el: HTMLElement, value: string, options?: Record<string, unknown>
        ) => void
        if (cancelled || !svgRef.current || typeof JsBarcode !== 'function') return
        try {
          JsBarcode(svgRef.current as unknown as HTMLElement, unit.serialNumber, {
            format: 'CODE128',
            width: 1.2,
            height: 28,
            displayValue: true,
            fontSize: 8,
            margin: 2,
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
    <div className="stiker-printroot mx-auto w-full max-w-[214px] rounded-xl border-2 border-slate-200 bg-white p-1.5 text-center shadow-sm">
      <p className="text-[7px] font-bold uppercase tracking-[0.2em] text-slate-400">Unit Asset Sticker</p>

      {/* Barcode visual CODE128 asli — hanya bila nomor seri sudah terisi */}
      <div className="mt-0.5 flex justify-center">
        {unit.serialNumber ? (
          <svg ref={svgRef} aria-label={`Barcode ${unit.serialNumber}`} className="block max-w-full" />
        ) : (
          <p className="rounded-md bg-amber-50 px-2 py-1.5 text-[9px] font-medium text-amber-700">
            Nomor seri belum diisi — isi lewat Edit Unit, lalu buka kembali stiker ini.
          </p>
        )}
      </div>

      {/* Layout: tgl input, toko/customer, merk, model/tipe, nomor seri, status + tgl garansi */}
      <dl className="mt-0.5 space-y-0.5 border-t border-dashed border-slate-200 pt-0.5 text-left">
        <div className="flex justify-between gap-2 text-[9px] leading-tight">
          <dt className="shrink-0 text-slate-400">Tanggal Input</dt>
          <dd className="font-medium text-slate-800">{tanggalInput}</dd>
        </div>
        <div className="flex justify-between gap-2 text-[9px] leading-tight">
          <dt className="shrink-0 text-slate-400">Toko / Customer</dt>
          <dd className="text-right font-semibold text-slate-900">
            {unit.toko ? (
              <>
                {unit.toko.namaToko}
                <span className="ml-1 font-mono text-[8px] font-normal text-slate-400">{unit.toko.kodeToko}</span>
              </>
            ) : unit.customer ? (
              <>
                {unit.customer.nama}
                <span className="ml-1 text-[8px] font-normal text-slate-400">Perorangan</span>
              </>
            ) : (
              '-'
            )}
          </dd>
        </div>
        <div className="flex justify-between gap-2 text-[9px] leading-tight">
          <dt className="shrink-0 text-slate-400">Merk</dt>
          <dd className="font-medium text-slate-800">{unit.merk?.trim() || '-'}</dd>
        </div>
        <div className="flex justify-between gap-2 text-[9px] leading-tight">
          <dt className="shrink-0 text-slate-400">Model / Tipe</dt>
          <dd className="text-right font-medium text-slate-800">{unit.modelUnit}</dd>
        </div>
        <div className="flex justify-between gap-2 text-[9px] leading-tight">
          <dt className="shrink-0 text-slate-400">Nomor Seri</dt>
          <dd className="break-all font-mono text-[9px] font-bold text-slate-900">{unit.serialNumber || '-'}</dd>
        </div>
        <div className="flex items-center justify-between gap-2 text-[9px] leading-tight">
          <dt className="shrink-0 text-slate-400">Status</dt>
          <dd className="text-right">
            <Badge
              variant="outline"
              className={cn(
                'h-4 px-1 text-[8px]',
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
              <p className="mt-0.5 text-[8px] font-normal leading-tight text-slate-500" title="Tgl pembelian — awal masa garansi">
                {tglGaransi}
              </p>
            )}
          </dd>
        </div>
        {unit.nama?.trim() && (
          <div className="flex justify-between gap-2 text-[9px] leading-tight">
            <dt className="shrink-0 text-slate-400">Nama Unit</dt>
            <dd className="text-right text-slate-500">{unit.nama.trim()}</dd>
          </div>
        )}
      </dl>

      <p className="mt-1 break-all font-mono text-[7px] leading-tight text-slate-400">
        SN:{unit.serialNumber}|MOD:{unit.modelUnit}|TOK:{unit.toko?.kodeToko ?? '-'}
      </p>
    </div>
  )
}

export default function UnitBarcodeSticker({ unit, onOpenChange }: { unit: UnitAsset | null; onOpenChange: (o: boolean) => void }) {
  // SETTING KERTAS per perangkat (A4 printer biasa / label thermal) — live via store
  const kertas = useKertasStiker()
  // Mode cetak stiker aktif selama dialog terbuka (ukuran kertas + Ctrl+P manual)
  useStickerPrint(!!unit, 'stiker', kertas)

  return (
    <Dialog open={!!unit} onOpenChange={onOpenChange}>
      <DialogContent className="stiker-dialog sm:max-w-sm">
        {unit && (
          <>
            <DialogHeader>
              <DialogTitle>Stiker Barcode Unit</DialogTitle>
              <DialogDescription>Tempel di unit — teknisi scan untuk identifikasi garansi &amp; asal toko/customer.</DialogDescription>
            </DialogHeader>
            <StikerUnitBody unit={unit} />
            <DialogFooter className="sm:justify-between">
              <PilihKertas
                value={kertas}
                onChange={(k) => simpanKertasStiker(k)}
              />
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => onOpenChange(false)}>Tutup</Button>
                <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={() => cetakStikerTunggal(kertas)}>
                  <Barcode className="mr-1 h-4 w-4" /> Cetak Stiker
                </Button>
              </div>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
