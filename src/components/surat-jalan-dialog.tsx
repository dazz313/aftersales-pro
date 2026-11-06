'use client'

import { useEffect, useState } from 'react'
import { Loader2, FileDown, FileSpreadsheet, Truck, PackageOpen, CalendarClock, AlertTriangle, History, Printer } from 'lucide-react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import { authHeaders, fetcher, formatRupiah, type ServiceTicket } from '@/lib/api'
import { ALUR_SJ_STYLES, alurSjState, tglPendek, type AlurSj } from '@/lib/alur-sj'

/**
 * Chip mini alur SJ utk baris pratinjau — "–" bila tiket tak relevan (sudah
 * tak ada part inden dan belum pernah masuk alur surat jalan apa pun).
 */
function ChipAlurSj({ alur }: { alur: AlurSj }) {
  if (alur === 'TAK_PERLU_SJ') return <span className="text-xs text-slate-300">–</span>
  const s = ALUR_SJ_STYLES[alur]
  return (
    <Badge variant="outline" className={cn('text-[9px]', s.cls)}>
      {s.label}
    </Badge>
  )
}

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
  onDownloaded,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  tickets: ServiceTicket[]
  onDownloaded?: () => void
}) {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState<'pdf' | 'xlsx' | null>(null)
  // Produsen tujuan ("Kepada: PT ...") yang tercetak di surat — input bebas.
  // Auto-fill dari pengaturan `partner_produsen` (Pengaturan → Profil) agar
  // user tidak perlu mengetik ulang; saran merk unit jadi fallback bila kosong.
  const [kepada, setKepada] = useState('')
  const { data: settingsData } = useQuery<{ map?: Record<string, string> }>({
    queryKey: ['pengaturan'],
    queryFn: () => fetcher<{ map?: Record<string, string> }>('/api/pengaturan'),
    enabled: open,
  })
  // Isi otomatis "Kepada" dari partner_produsen bila belum diisi manual.
  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => {
      if (kepada.trim()) return
      const partner = settingsData?.map?.['partner_produsen']
      if (partner && partner.trim()) setKepada(partner.trim())
    }, 0)
    return () => clearTimeout(t)
  }, [open, settingsData, kepada])
  // RIWAYAT PERSURATAN — bundel dokumen yang pernah menyentuh tiket terpilih
  // (SJR/STTB/STTBK/SKTB). Cetak ulang = regenerate nomor SAMA, bukan dokumen
  // baru, sehingga persuratan tidak pernah bertumpuk nomor ganda.
  // Dimuat via useQuery (tanpa setState dalam effect).
  interface EntriRiwayat {
    tipe: string
    nomor: string
    tgl: string | null
    oleh: string | null
    link: string
    tiket: string[]
    toko?: string | null
    info?: string
  }
  const daftarNoTiket = tickets.map((t) => t.noTiket)
  const kunciRiwayat = daftarNoTiket.join('|')
  const { data: riwayatData } = useQuery<{ riwayat?: EntriRiwayat[] }>({
    queryKey: ['surat-riwayat', kunciRiwayat],
    queryFn: () => fetcher<{ riwayat?: EntriRiwayat[] }>(`/api/surat-riwayat?noTiket=${encodeURIComponent(kunciRiwayat)}`),
    enabled: open && kunciRiwayat.length > 0,
    retry: false,
  })
  const riwayat = riwayatData?.riwayat ?? null
  const [riwayatBusy, setRiwayatBusy] = useState<string | null>(null)

  async function unduhUlang(entri: EntriRiwayat) {
    if (!entri.link || riwayatBusy) return
    setRiwayatBusy(entri.nomor)
    try {
      const res = await fetch(entri.link, { headers: authHeaders() })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error((err as { error?: string }).error || `Gagal cetak ulang (${res.status})`)
      }
      const cd = res.headers.get('content-disposition') ?? ''
      const m = cd.match(/filename="([^"]+)"/)
      const filename = m?.[1] ?? `${entri.tipe}-${entri.nomor}.pdf`
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      toast({
        title: `Cetak ulang ${entri.tipe} ${entri.nomor}`,
        description: `${filename} — nomor sama dengan dokumen asli, tidak membuat dokumen baru.`,
      })
    } catch (e) {
      toast({
        title: 'Gagal mencetak ulang',
        description: e instanceof Error ? e.message : 'Coba lagi',
        variant: 'destructive',
      })
    } finally {
      setRiwayatBusy(null)
    }
  }

  // Tiket FINISH tidak lagi mengikuti alur surat jalan — pengerjaan sudah
  // tamat (part terpasang, unit menunggu/mas sudah dikembalikan), jadi
  // dikeluarkan dari draft SJR dan hanya diberi keterangan di dialog.
  const tiketAktif = tickets.filter((t) => t.status !== 'FINISH')
  const tiketFinishDibuang = tickets.length - tiketAktif.length

  // Hanya part yang kode+nama-nya sudah terinput yang masuk draft pengiriman.
  const mentah = tiketAktif.flatMap((t) =>
    t.parts
      .filter((p) => !p.tglPasang) // part yang sudah terpasang tidak ikut SJR
      .map((p) => ({
        noTiket: t.noTiket,
        kodePart: p.sparepart?.kodePart ?? '',
        namaPart: p.sparepart?.namaPart ?? '',
        qty: p.qty,
        toko: t.unitAsset.toko?.namaToko ?? '-',
        sn: t.unitAsset.serialNumber,
        alur: alurSjState(t),
      }))
  )
  const items = mentah.filter((i) => i.kodePart.trim() && i.namaPart.trim())
  const tanpaKode = mentah.length - items.length
  const totalQty = items.reduce((a, i) => a + i.qty, 0)
  const totalNilai =
    tiketAktif.reduce((a, t) => a + (t.nilaiKlaim ?? 0), 0)
  const merkSet = [...new Set(tiketAktif.map((t) => (t.unitAsset.merk || '').trim()).filter(Boolean))]
  const merkUmum = merkSet.length === 1 ? merkSet[0] : ''

  // ===== GUARD — deteksi tiket yang SEBENARNYA sudah pernah masuk alur
  // surat jalan, supaya dokumen SJR tidak dibuat dua kali tanpa sadar =====
  // Tiga tingkat (merah paling mendesak): part sudah datang → alat bekas
  // sudah terkirim (noSuratJalan) → surat jalan sudah dicetak (tglRequestPart).
  // Peringatan, BUKAN blokir: SJR ke-2 boleh jadi disengaja (part baru
  // ditambahkan ke tiket sama); server pun tidak menimpa tanggal request lama.
  interface GuardInfo { t: ServiceTicket; alasan: string; tingkat: 'merah' | 'biru' | 'kuning' }
  const guard = tiketAktif
    .map((t): GuardInfo | null => {
      if (t.tglPartDatang) return { t, tingkat: 'merah', alasan: `Part sudah datang ${tglPendek(t.tglPartDatang)} — surat jalan umumnya tidak perlu lagi` }
      if (t.noSuratJalan) return { t, tingkat: 'biru', alasan: `Alat bekas sudah terkirim via SJ ${t.noSuratJalan} — jangan buat dokumen dobel` }
      if (t.tglRequestPart) return { t, tingkat: 'kuning', alasan: `Sudah dibuatkan surat jalan pada ${tglPendek(t.tglRequestPart)} (alat bekas belum tercatat terkirim)` }
      return null
    })
    .filter((g): g is GuardInfo => g !== null)
    .sort((a, b) => a.tingkat.localeCompare(b.tingkat)) // merah → biru → kuning
  const merah = guard.filter((g) => g.tingkat === 'merah').length
  const biru = guard.filter((g) => g.tingkat === 'biru').length

  async function download(format: 'pdf' | 'xlsx') {
    if (tiketAktif.length === 0 || busy) return
    setBusy(format)
    try {
      const res = await fetch('/api/surat-jalan-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          noTiket: tiketAktif.map((t) => t.noTiket),
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
      // Dokumen baru masuk bundel — segarkan panel riwayat.
      void queryClient.invalidateQueries({ queryKey: ['surat-riwayat', daftarNoTiket.join('|')] })
      // Surat jalan berhasil diunduh → kosongkan pilihan centang di server
      // (hanya setelah unduh, bukan saat back/X).
      onDownloaded?.()
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
      <DialogContent className="max-h-[90vh] max-w-[950px] overflow-y-auto bg-white p-6">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 pr-8 text-slate-900">
            <Truck className="h-5 w-5 shrink-0 text-teal-700" /> Surat Jalan Request Part
          </DialogTitle>
          <DialogDescription>
            Request part ke produsen — kolektif unit terpilih. Setiap unduhan tersimpan dengan tanggal request; part datangnya dilacak di Lacak Sparepart → Part Datang.
          </DialogDescription>
        </DialogHeader>

        {/* Ringkasan */}
        <div className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-4 mb-4">
          {[
            { label: 'Tiket', value: tiketAktif.length },
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

        {/* Keterangan: tiket FINISH tidak ikut SJR — alurnya sudah tamat */}
        {tiketFinishDibuang > 0 && (
          <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
            {tiketFinishDibuang} tiket FINISH tidak ikut dalam surat jalan — pekerjaannya sudah tamat, partnya sudah terpasang (alur "bekas terkirim"/"part datang" tidak berlaku lagi).
          </p>
        )}

        {/* GUARD — tiket yang sudah pernah masuk alur surat jalan */}
        {guard.length > 0 && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-800">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              {guard.length} dari {tiketAktif.length} tiket sudah pernah masuk alur surat jalan
              {merah > 0 && <span className="text-rose-700">· {merah} partnya sudah datang</span>}
              {biru > 0 && <span className="text-sky-700">· {biru} bekasnya sudah terkirim</span>}
              — pastikan bukan dokumen dobel
            </p>
            <ul className="mt-1.5 space-y-0.5 text-[11px] leading-snug">
              {guard.slice(0, 6).map((g) => (
                <li key={g.t.noTiket} className="flex min-w-0 gap-1.5">
                  <span
                    className={cn(
                      'mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full',
                      g.tingkat === 'merah' ? 'bg-rose-500' : g.tingkat === 'biru' ? 'bg-sky-500' : 'bg-amber-500'
                    )}
                  />
                  <span className="font-mono font-semibold text-slate-700">{g.t.noTiket}</span>
                  <span className={cn(g.tingkat === 'merah' ? 'text-rose-700' : g.tingkat === 'biru' ? 'text-sky-700' : 'text-amber-700')}>{g.alasan}</span>
                </li>
              ))}
              {guard.length > 6 && <li className="text-amber-600">… {guard.length - 6} tiket lainnya</li>}
            </ul>
            <p className="mt-1.5 text-[10px] leading-relaxed text-amber-600">
              Masih bisa dilanjutkan bila memang sengaja (mis. part baru ditambahkan ke tiket sama) — tanggal request lama tidak akan ditimpa.
            </p>
          </div>
        )}

        {/* RIWAYAT PERSURATAN — bundel yang pernah mencakup tiket terpilih */}
        {(riwayat?.length ?? 0) > 0 && (
          <div className="rounded-lg border border-sky-200 bg-sky-50/60 px-3 py-2.5">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-sky-900">
              <History className="h-3.5 w-3.5 shrink-0" />
              Riwayat Persuratan ({riwayat!.length}) — cetak ulang cukup cari bundelnya
            </p>
            <div className="mt-1.5 max-h-52 space-y-1 overflow-y-auto pr-1">
              {riwayat!.slice(0, 20).map((e) => (
                <div key={`${e.tipe}-${e.nomor}`} className="flex min-w-0 flex-wrap items-center gap-1.5 text-[11px] leading-snug">
                  <Badge variant="outline" className="shrink-0 border-sky-300 bg-white text-[9px] text-sky-800">{e.tipe}</Badge>
                  <span className="shrink-0 font-mono font-semibold text-slate-700">{e.nomor}</span>
                  <span className="text-slate-500">
                    {e.tgl ? tglPendek(e.tgl) : '—'}
                    {e.oleh ? ` · ${e.oleh}` : ''}
                  </span>
                  {e.info && <span className="min-w-0 truncate text-slate-400" title={e.info}>{e.info}</span>}
                  {e.link && (
                    <button
                      type="button"
                      disabled={riwayatBusy !== null}
                      onClick={() => void unduhUlang(e)}
                      className="ml-auto inline-flex shrink-0 items-center gap-1 rounded border border-sky-300 bg-white px-1.5 py-0.5 text-[10px] font-semibold text-sky-800 hover:bg-sky-100 disabled:opacity-50"
                      title="Cetak ulang — nomor sama dengan aslinya"
                    >
                      {riwayatBusy === e.nomor ? <Loader2 className="h-3 w-3 animate-spin" /> : <Printer className="h-3 w-3" />}
                      Cetak ulang
                    </button>
                  )}
                </div>
              ))}
              {riwayat!.length > 20 && <p className="text-[10px] text-sky-700">… {riwayat!.length - 20} dokumen lainnya</p>}
            </div>
            <p className="mt-1 text-[10px] leading-relaxed text-sky-700">
              Cetak ulang memakai NOMOR DOKUMEN ASLI (tidak terbit nomor baru) — aman dari kop persuratan ganda.
            </p>
          </div>
        )}

        {/* Pratinjau item — scroll dua arah agar tabel panjang tidak meluber keluar dialog */}
        <ScrollArea className="h-72 min-w-0 rounded-lg border border-slate-200">
          {items.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <PackageOpen className="h-8 w-8 text-slate-300" />
              <p className="px-6 text-sm text-slate-500">
                Tiket terpilih belum memiliki rincian sparepart. Pilih tiket yang memiliki part untuk disertakan dalam surat jalan.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table className="w-full min-w-[700px]">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">No</TableHead>
                    <TableHead className="w-32">No. Tiket</TableHead>
                    <TableHead>Sparepart</TableHead>
                    <TableHead className="w-14 text-right">Qty</TableHead>
                    <TableHead className="hidden w-32 sm:table-cell">Toko Asal</TableHead>
                    <TableHead className="w-44">Alur SJ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((it, i) => (
                    <TableRow key={`${it.noTiket}-${it.kodePart}-${i}`}>
                      <TableCell className="text-xs text-slate-400">{i + 1}</TableCell>
                      <TableCell className="truncate font-mono text-xs" title={it.noTiket}>{it.noTiket}</TableCell>
                      <TableCell className="w-80 text-xs">
                        <span className="font-semibold break-words text-slate-700">{it.kodePart}</span>
                        <span className="break-words"> · {it.namaPart}</span>
                        <p className="truncate font-mono text-[10px] text-slate-400" title={it.sn}>{it.sn}</p>
                      </TableCell>
                      <TableCell className="text-right text-xs font-bold">{it.qty}</TableCell>
                      <TableCell className="hidden max-w-32 truncate text-xs text-slate-500 sm:table-cell" title={it.toko}>{it.toko}</TableCell>
                      <TableCell><ChipAlurSj alur={it.alur} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </ScrollArea>

        <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-slate-500">
          <Badge variant="outline" className="shrink-0 border-teal-300 text-[10px] text-teal-700">
            {tiketAktif.length} tiket terpilih
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
            className="h-8 w-full text-xs"
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
            disabled={busy !== null || tiketAktif.length === 0}
          >
            {busy === 'xlsx' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileSpreadsheet className="mr-2 h-4 w-4" />}
            Unduh Excel
          </Button>
          <Button
            className="bg-rose-700 hover:bg-rose-800"
            onClick={() => download('pdf')}
            disabled={busy !== null || tiketAktif.length === 0}
          >
            {busy === 'pdf' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileDown className="mr-2 h-4 w-4" />}
            Unduh PDF
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
