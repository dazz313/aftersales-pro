'use client'

import { useState } from 'react'
import { Loader2, FileDown, FileSpreadsheet, Truck, PackageOpen, CalendarClock } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useToast } from '@/hooks/use-toast'
import { authHeaders, formatRupiah, type ServiceTicket } from '@/lib/api'

/**
 * Dialog cetak Surat Jalan kolektif — request part ke produsen.
 * Format: PDF (A4 landscape + QR verifikasi) & Excel (.xlsx, 2 sheet).
 * Setiap unduhan menandai tiket dengan tgl request (tersimpan sebagai dokumen
 * SJR-YYYYMMDD-NNNN) — part datang kemudian bisa dianalisa di Lacak Sparepart.
 * Unduhan dilakukan via fetch+blob agar bekerja juga di konteks iframe
 * yang memblokir cookie (fallback Bearer header ikut terkirim).
 */
export default function SuratJalanDialog({
  open,
  onOpenChange,
  tickets,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  tickets: ServiceTicket[]
}) {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState<'pdf' | 'xlsx' | null>(null)
  // Produsen tujuan ("Kepada: PT ...") yang tercetak di surat — input bebas;
  // saran otomatis dari merk unit bila semua tiket terpilih merknya sama.
  const [kepada, setKepada] = useState('')

  // Hanya part yang kode+nama-nya sudah terinput yang masuk draft pengiriman.
  const mentah = tickets.flatMap((t) =>
    t.parts.map((p) => ({
      noTiket: t.noTiket,
      kodePart: p.sparepart?.kodePart ?? '',
      namaPart: p.sparepart?.namaPart ?? '',
      qty: p.qty,
      toko: t.unitAsset.toko?.namaToko ?? '-',
      sn: t.unitAsset.serialNumber,
    }))
  )
  const items = mentah.filter((i) => i.kodePart.trim() && i.namaPart.trim())
  const tanpaKode = mentah.length - items.length
  const totalQty = items.reduce((a, i) => a + i.qty, 0)
  const totalNilai =
    tickets.reduce((a, t) => a + (t.nilaiKlaim ?? 0), 0)
  const merkSet = [...new Set(tickets.map((t) => (t.unitAsset.merk || '').trim()).filter(Boolean))]
  const merkUmum = merkSet.length === 1 ? merkSet[0] : ''

  async function download(format: 'pdf' | 'xlsx') {
    if (tickets.length === 0 || busy) return
    setBusy(format)
    try {
      const res = await fetch('/api/surat-jalan-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          noTiket: tickets.map((t) => t.noTiket),
          format,
          produsen: (kepada.trim() || merkUmum) || undefined,
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error((err as { error?: string }).error || `Gagal membuat surat jalan (${res.status})`)
      }
      const cd = res.headers.get('content-disposition') ?? ''
      const m = cd.match(/filename="([^"]+)"/)
      const filename = m?.[1] ?? `Surat-Jalan-Request-${new Date().toISOString().slice(0, 10)}.${format}`
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      // Badge REQUEST di baris tiket menampilkan tgl request — segarkan daftar.
      void queryClient.invalidateQueries({ queryKey: ['service-tickets'] })
      toast({
        title: `Surat Jalan Request ${format.toUpperCase()} terunduh`,
        description: `${filename} · tanggal request tercatat & ditulis di dokumen/badge tiket.`,
      })
    } catch (e) {
      toast({
        title: 'Gagal mencetak surat jalan',
        description: e instanceof Error ? e.message : 'Coba lagi',
        variant: 'destructive',
      })
    } finally {
      setBusy(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto bg-white">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 pr-8 text-slate-900">
            <Truck className="h-5 w-5 shrink-0 text-teal-700" /> Surat Jalan Request Part
          </DialogTitle>
          <DialogDescription>
            Request part ke produsen — kolektif unit terpilih. Setiap unduhan tersimpan dengan tanggal request; part datangnya dilacak di Lacak Sparepart → Part Datang.
          </DialogDescription>
        </DialogHeader>

        {/* Ringkasan */}
        <div className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            { label: 'Tiket', value: tickets.length },
            { label: 'Item Part', value: items.length },
            { label: 'Total Qty', value: `${totalQty} pcs` },
            { label: 'Nilai Klaim', value: formatRupiah(totalNilai) },
          ].map((s) => (
            <div key={s.label} className="min-w-0 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <p className="text-[10px] uppercase tracking-wide text-slate-400">{s.label}</p>
              <p className="truncate text-sm font-bold text-slate-800" title={String(s.value)}>{s.value}</p>
            </div>
          ))}
        </div>

        {/* Pratinjau item — scroll dua arah agar tabel panjang tidak meluber keluar dialog */}
        <ScrollArea className="h-56 min-w-0 rounded-lg border border-slate-200">
          {items.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <PackageOpen className="h-8 w-8 text-slate-300" />
              <p className="px-6 text-sm text-slate-500">
                Tiket terpilih belum memiliki rincian sparepart. Pilih tiket yang memiliki part untuk disertakan dalam surat jalan.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table className="w-full min-w-[520px]">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">No</TableHead>
                    <TableHead className="w-32">No. Tiket</TableHead>
                    <TableHead>Sparepart</TableHead>
                    <TableHead className="w-14 text-right">Qty</TableHead>
                    <TableHead className="hidden w-32 sm:table-cell">Toko Asal</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((it, i) => (
                    <TableRow key={`${it.noTiket}-${it.kodePart}-${i}`}>
                      <TableCell className="text-xs text-slate-400">{i + 1}</TableCell>
                      <TableCell className="truncate font-mono text-xs" title={it.noTiket}>{it.noTiket}</TableCell>
                      <TableCell className="max-w-56 text-xs">
                        <span className="font-semibold break-words text-slate-700">{it.kodePart}</span>
                        <span className="break-words"> · {it.namaPart}</span>
                        <p className="truncate font-mono text-[10px] text-slate-400" title={it.sn}>{it.sn}</p>
                      </TableCell>
                      <TableCell className="text-right text-xs font-bold">{it.qty}</TableCell>
                      <TableCell className="hidden max-w-32 truncate text-xs text-slate-500 sm:table-cell" title={it.toko}>{it.toko}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </ScrollArea>

        <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-slate-500">
          <Badge variant="outline" className="shrink-0 border-teal-300 text-[10px] text-teal-700">
            {tickets.length} tiket terpilih
          </Badge>
          <Badge variant="outline" className="gap-1 shrink-0 border-teal-300 text-[10px] text-teal-700">
            <CalendarClock className="h-3 w-3" /> tgl request tercatat saat unduh
          </Badge>
          <span className="min-w-0">No. SJR otomatis (SJR-YYYYMMDD-NNNN) + baris "Tanggal Request" di bawah judul dokumen.</span>
          {tanpaKode > 0 && (
            <span className="min-w-0 text-amber-600">{tanpaKode} part tanpa kode dilewati — lengkapi dulu di tiket.</span>
          )}
        </div>

        {/* Kepada (produsen tujuan) — tercetak di surat resmi: "Kepada: PT ..." */}
        <div className="space-y-1">
          <Label className="text-[11px] text-slate-600">Kepada (Produsen)</Label>
          <Input
            value={kepada}
            onChange={(e) => setKepada(e.target.value)}
            placeholder="mis. PT SANY INDONESIA"
            className="h-8 max-w-sm text-xs"
          />
          <p className="text-[10px] leading-relaxed text-slate-500">
            Tercetak sebagai blok "Kepada: …" di surat.
            {merkUmum ? (
              <> Kosongkan untuk memakai saran otomatis dari merk unit: <b>{merkUmum}</b>.</>
            ) : (
              <> Isi manual — merk unit tiket terpilih tidak seragam, tidak ada saran otomatis.</>
            )}
          </p>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy !== null}>
            Tutup
          </Button>
          <Button
            className="bg-emerald-700 hover:bg-emerald-800"
            onClick={() => download('xlsx')}
            disabled={busy !== null || tickets.length === 0}
          >
            {busy === 'xlsx' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileSpreadsheet className="mr-2 h-4 w-4" />}
            Unduh Excel
          </Button>
          <Button
            className="bg-rose-700 hover:bg-rose-800"
            onClick={() => download('pdf')}
            disabled={busy !== null || tickets.length === 0}
          >
            {busy === 'pdf' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileDown className="mr-2 h-4 w-4" />}
            Unduh PDF
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
