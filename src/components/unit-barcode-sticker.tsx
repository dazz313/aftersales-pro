'use client'

import { useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Barcode } from 'lucide-react'
import type { UnitAsset } from '@/lib/api'
import { GARANSI_LABEL } from '@/lib/types'
import { cetakStikerTunggal, simpanKertasStiker, useKertasStiker, useStickerPrint } from '@/lib/sticker-print'
import { PilihKertas } from '@/components/stiker-kertas'
import { bangunKodeUnit } from '@/lib/kode-unit'

/**
 * Stiker QR UNIT ASSET — versi MINI (4 identifikasi utama):
 *   1. Nama produk (nama unit; fallback model)
 *   2. Model / tipe
 *   3. Nomor seri — sekaligus "Tag ID" di aplikasi mobile
 *   4. Toko / customer — otomatis tersinkron dari data unit (hasil scan toko
 *      saat kunjungan pertama), jadi tidak perlu diketik ulang.
 *
 * ISI QR (lihat src/lib/kode-unit.ts):
 *   SN:<nomor seri>|MOD:<model>|TOK:<toko>|NAMA:<nama produk>
 * Jadi HP bisa menampilkan keempat identifikasi langsung dari hasil pindai,
 * tanpa menebak, dan tanpa menunggu server. `SN:` selalu di depan agar
 * "Tag ID" = nomor seri (bukan seluruh teks QR).
 *
 * Tata letak sengaja dipadatkan (vertikal) agar muat dicetak mini 28 mm /
 * label thermal 36 mm dan tetap tajam karena QR berupa vektor.
 *
 * Bodi stiker diekspor (StikerUnitBody) agar dipakai ulang dialog tunggal dan
 * dialog cetak KOLEKTIF (banyak stiker dalam 1 lembar).
 */

export function StikerUnitBody({ unit }: { unit: UnitAsset }) {
  const qrRef = useRef<HTMLDivElement>(null)
  const pemilik = unit?.toko?.namaToko ?? unit?.customer?.nama ?? '-'
  const namaProduk = unit?.nama?.trim() || unit?.modelUnit || '-'
  const kodeQr = unit ? bangunKodeUnit({
    serialNumber: unit.serialNumber,
    modelUnit: unit.modelUnit,
    nama: unit.nama,
    pemilik,
  }) : ''

  useEffect(() => {
    if (!kodeQr) return
    let cancelled = false
    // QR SVG vektor (bukan canvas) — tetap tajam saat dicetak mini.
    import('qrcode')
      .then((mod) => {
        const QRCode = ((mod as { default?: unknown }).default ?? mod) as {
          toString: (text: string, opts: Record<string, unknown>, cb: (err: Error | null, str: string) => void) => void
        }
        if (cancelled || !qrRef.current || typeof QRCode?.toString !== 'function') return
        QRCode.toString(kodeQr, { type: 'svg', width: 96, margin: 1, color: { dark: '#0f172a', light: '#ffffff' } }, (err, svg) => {
          if (cancelled || !qrRef.current) return
          if (err || !svg) { console.error('Render QR unit gagal:', err); return }
          qrRef.current.innerHTML = svg
          const el = qrRef.current.querySelector('svg')
          if (el) { el.setAttribute('class', 'block h-full w-full'); el.setAttribute('aria-label', `QR ${unit.serialNumber}`) }
        })
      })
      .catch((e) => console.error('Render QR unit gagal:', e))
    return () => { cancelled = true }
  }, [kodeQr, unit?.serialNumber])

  const statusLabel = unit ? (GARANSI_LABEL[unit.statusGaransi] ?? unit.statusGaransi.replace('_', '-')) : ''

  return (
    <div className="stiker-printroot mx-auto w-full max-w-[150px] overflow-hidden rounded-md border border-slate-900 bg-white text-center">
      {/* Strip kepala — jenis stiker + status garansi */}
      <div className="flex items-center justify-between bg-slate-900 px-1 py-px">
        <span className="text-[5.5px] font-bold uppercase tracking-widest text-white">Unit Asset</span>
        <span className="text-[5.5px] font-bold uppercase text-emerald-300">{statusLabel}</span>
      </div>

      {/* QR code vektor — hanya bila nomor seri sudah terisi */}
      {kodeQr ? (
        <div ref={qrRef} className="mx-auto mt-0.5 h-20 w-20" />
      ) : (
        <p className="m-1 rounded bg-amber-50 px-1 py-1 text-[7px] font-medium leading-tight text-amber-700">
          Nomor seri belum diisi — isi lewat Edit Unit, lalu buka kembali stiker ini.
        </p>
      )}

      {/* 4 identifikasi utama — dipadatkan agar muat mini */}
      <div className="space-y-px px-1 pb-1 pt-0.5 text-left leading-tight">
        <p className="line-clamp-2 text-[8px] font-extrabold leading-[1.1] text-slate-900" title={namaProduk}>
          {namaProduk}
        </p>
        <p className="truncate text-[6.5px] text-slate-500" title={unit.modelUnit}>
          Model <span className="font-semibold text-slate-800">{unit.modelUnit || '-'}</span>
        </p>
        <p className="truncate font-mono text-[6.5px] text-slate-500" title={unit.serialNumber}>
          Tag ID <span className="font-bold text-slate-900">{unit.serialNumber || '-'}</span>
        </p>
        <p className="line-clamp-2 text-[6.5px] leading-[1.1] text-slate-500" title={pemilik}>
          Pemilik <span className="font-semibold text-slate-800">{pemilik}</span>
        </p>
      </div>
    </div>
  )
}

export default function UnitBarcodeSticker({ unit, onOpenChange }: { unit: UnitAsset | null; onOpenChange: (o: boolean) => void }) {
  // SETTING KERTAS per perangkat (A4 / thermal / mini) — live via store
  const kertas = useKertasStiker()
  // Mode cetak stiker aktif selama dialog terbuka (ukuran kertas + Ctrl+P manual)
  useStickerPrint(!!unit, 'stiker', kertas)

  return (
    <Dialog open={!!unit} onOpenChange={onOpenChange}>
      <DialogContent className="stiker-dialog sm:max-w-sm">
        {unit && (
          <>
            <DialogHeader>
              <DialogTitle>Stiker QR Unit — Mini</DialogTitle>
              <DialogDescription>
                QR berisi 4 identifikasi: <b>nama produk</b>, <b>model</b>, <b>nomor seri</b> (Tag ID),
                dan <b>toko</b> (otomatis dari data kunjungan/scan toko). Tempel di unit — teknisi
                scan untuk identifikasi &amp; pindah tahap. Pilih kertas <b>Mini 28 mm</b> untuk label kecil.
              </DialogDescription>
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
