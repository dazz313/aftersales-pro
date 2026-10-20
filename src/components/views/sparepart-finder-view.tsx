'use client'

import { useEffect, useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { fetcher, postJson, type BankKode } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import HistoryInput from '@/components/history-input'
import CsvImportDialog from '@/components/csv-import-dialog'
import KodeSparepart from '@/components/kode-sparepart'
import { useAppStore } from '@/lib/store'
import { useToast } from '@/hooks/use-toast'
import { SearchCheck, PackageX, Database, Sparkles, Loader2, X, BookMarked, Plus, Upload, RefreshCw, Truck } from 'lucide-react'
import { cn } from '@/lib/utils'

interface HasilCari {
  sparepartId: number
  kodePart: string
  namaPart: string
  brandKompatibel: string
  supplier: string
  stokJual: number
  stokGaransi: number
  stokInventory: number
  skor: number
  frekuensi: number
  contoh: { noTiket: string; model: string; deskripsi: string }[]
}

interface CariResponse {
  query: { model: string; rusak: string }
  totalTiketDipindai: number
  totalCocok: number
  hasil: HasilCari[]
}

/** Baris hasil pencarian "Part Datang" — Surat Jalan produsen + pemiliknya (tiket). */
interface DatangRow {
  id: number
  noSuratJalan: string
  sjStatus: string
  tglSurat: string | null
  tglDatang: string | null
  kodePart: string
  namaPart: string
  qty: number
  serialNumber: string | null
  noTiket: string | null
  toko: string
  serial: string
  model: string
  kerusakan: string
  status: string
  statusPart: string
}

/** Satu dokumen Surat Jalan Request (SJR) + hasil cross-check kiriman. */
interface SjrDoc {
  noSurat: string
  tglRequest: string
  dibuatOleh: string | null
  totalTiket: number
  totalItem: number
  totalQty: number
  lewatTanpaKode: number
  diterima: number
  dicatat: number
  belum: number
  contohBelum: { noTiket: string; kodePart: string; namaPart: string }[]
}

/**
 * Pelacakan sparepart khusus: masukkan MODEL unit + JENIS KERUSAKAN,
 * sistem memindai kumpulan inputan tiket yang tersimpan di database
 * dan menampilkan kode + nama sparepart yang paling cocok & sering dipakai.
 */
export default function SparepartFinderView() {
  const { toast } = useToast()
  const [model, setModel] = useState('')
  const [rusak, setRusak] = useState('')
  const [mencari, setMencari] = useState(false)
  const [hasil, setHasil] = useState<CariResponse | null>(null)

  // ===== Analisa AI via 9router — ranking kandidat + alasan (kode tetap dari data) =====
  interface AiRekomendasi {
    rekomendasi: { kode: string; alasan: string }[]
    catatan: string
    model: string
  }
  const [aiHasil, setAiHasil] = useState<AiRekomendasi | null>(null)
  const aiMut = useMutation({
    mutationFn: () => postJson<AiRekomendasi>('/api/ai/rekomendasi-part', {
      model: model.trim(),
      rusak: rusak.trim(),
      kandidat: (hasil?.hasil ?? []).slice(0, 10).map((h) => ({
        kode: h.kodePart,
        nama: h.namaPart,
        brand: h.brandKompatibel ?? '',
        stok: h.stokInventory,
        frekuensi: h.frekuensi,
      })),
    }),
    onSuccess: (r) => {
      setAiHasil(r)
      toast({ title: 'Analisa AI diterima', description: `${r.rekomendasi.length} part direkomendasikan (${r.model}).` })
    },
    onError: (e: Error) => toast({ title: 'Analisa AI gagal', description: e.message, variant: 'destructive' }),
  })

  const cari = async () => {
    if (!model.trim() && !rusak.trim()) {
      toast({ title: 'Belum bisa melacak', description: 'Isi model unit dan/atau jenis kerusakan dulu.', variant: 'destructive' })
      return
    }
    setMencari(true)
    setAiHasil(null)
    try {
      const res = await fetcher<CariResponse>(
        `/api/sparepart/cari?model=${encodeURIComponent(model.trim())}&rusak=${encodeURIComponent(rusak.trim())}`
      )
      setHasil(res)
    } catch (e) {
      toast({ title: 'Pelacakan gagal', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setMencari(false)
    }
  }

  // ===== Bank Kode Produsen — semua kode rumit, siap dipanggil + disalin =====
  // Terisi otomatis dari katalog, balasan produsen di tiket, order & CSV.
  const { role, navIntent, clearNavIntent } = useAppStore()
  const [bankQ, setBankQ] = useState('')
  const [bankHasil, setBankHasil] = useState<{ total: number; totalBank: number; items: BankKode[] } | null>(null)
  const [bankLoading, setBankLoading] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [bankCodes, setBankCodes] = useState<string[]>([])
  const [tambahOpen, setTambahOpen] = useState(false)
  const [formKode, setFormKode] = useState({ kode: '', nama: '', brand: '', model: '', catatan: '' })
  const muatBank = async (q: string) => {
    setBankLoading(true)
    try {
      const res = await fetcher<{ total: number; totalBank: number; items: BankKode[] }>(
        `/api/bank-kode?q=${encodeURIComponent(q.trim())}&take=50`
      )
      setBankHasil(res)
    } catch (e) {
      toast({ title: 'Bank Kode gagal dimuat', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setBankLoading(false)
    }
  }
  const sinkronMut = useMutation({
    mutationFn: () => postJson<{ baru: number; dilengkapi: number; total: number }>('/api/bank-kode/sinkron', { aktor: role }),
    onSuccess: (r) => {
      toast({ title: 'Bank Kode tersinkron', description: `${r.baru} kode baru, ${r.dilengkapi} dilengkapi (total ${r.total}).` })
      void muatBank(bankQ)
    },
    onError: (e: Error) => toast({ title: 'Sinkron gagal', description: e.message, variant: 'destructive' }),
  })
  const tambahMut = useMutation({
    mutationFn: () => postJson('/api/bank-kode', { ...formKode, modelTipe: formKode.model, aktor: role }),
    onSuccess: () => {
      setTambahOpen(false)
      setFormKode({ kode: '', nama: '', brand: '', model: '', catatan: '' })
      toast({ title: 'Kode tercatat', description: 'Kode produsen masuk Bank Kode dan siap dipakai.' })
      void muatBank(bankQ)
    },
    onError: (e: Error) => toast({ title: 'Gagal menambah kode', description: e.message, variant: 'destructive' }),
  })
  // ===== Tanya AI — kebutuhan bebas → AI memilih dari Bank Kode =====
  interface AiKode {
    rekomendasi: { kode: string; alasan: string }[]
    catatan: string
    model: string
  }
  const [aiButuh, setAiButuh] = useState('')
  const [aiKode, setAiKode] = useState<AiKode | null>(null)
  const aiKodeMut = useMutation({
    mutationFn: () =>
      postJson<AiKode>('/api/ai/cari-kode', {
        butuh: aiButuh.trim(),
        kandidat: (bankHasil?.items ?? []).slice(0, 15).map((b) => ({
          kode: b.kode,
          nama: b.namaPart,
          brand: b.brandKompatibel ?? '',
          model: b.modelTipe ?? '',
          produsen: b.produsen ?? '',
        })),
      }),
    onSuccess: (r) => {
      setAiKode(r)
      toast({ title: 'Jawaban AI diterima', description: `${r.rekomendasi.length} kode disarankan (${r.model}).` })
    },
    onError: (e: Error) => toast({ title: 'Tanya AI gagal', description: e.message, variant: 'destructive' }),
  })
  const SUMBER_CLS: Record<string, string> = {
    PRODUSEN: 'border-violet-300 bg-violet-50 text-violet-700',
    KATALOG: 'border-teal-300 bg-teal-50 text-teal-700',
    CSV: 'border-sky-300 bg-sky-50 text-sky-700',
    MANUAL: 'border-amber-300 bg-amber-50 text-amber-700',
    WORKSHOP: 'border-orange-300 bg-orange-50 text-orange-700',
  }

  const skorMax = Math.max(1, ...(hasil?.hasil.map((h) => h.skor) ?? [1]))

  // ===== Part Datang — Surat Jalan produsen (kiriman bertahap per toko/tiket) =====
  // Masalah yang dijawab: order ke produsen datang TIDAK serentak, workshop
  // sering bingung kiriman untuk toko mana. Kotak bebas mencari tgl datang,
  // no. tiket, toko, serial/model, kode/nama part, kerusakan & status.
  const [datangQ, setDatangQ] = useState('')
  const [datangRows, setDatangRows] = useState<DatangRow[] | null>(null)
  const [datangLoading, setDatangLoading] = useState(false)
  const muatDatang = async (q: string) => {
    setDatangLoading(true)
    try {
      const res = await fetcher<DatangRow[]>(`/api/sparepart/datang?q=${encodeURIComponent(q.trim())}&take=200`)
      setDatangRows(res)
    } catch (e) {
      toast({ title: 'Part Datang gagal dimuat', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setDatangLoading(false)
    }
  }
  // Muat terkini saat kartu pertama dibuka — setState dijalankan via callback
  // async (setTimeout 0, pola claim-view) agar tidak setState sinkron di effect.
  useEffect(() => {
    const t = setTimeout(() => {
      void muatDatang('')
    }, 0)
    return () => clearTimeout(t)
    // muatDatang sengaja di luar deps (identitas berubah tiap render; muat sekali saja)
  }, [])
  const fmtTgl = (d: string | null): string =>
    d ? new Date(d).toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '—'
  const TIKET_CLS: Record<string, string> = {
    REQUEST: 'border-slate-400 text-slate-600',
    REQUEST_EMAIL: 'border-violet-300 text-violet-700',
    PROSES: 'border-amber-300 text-amber-700',
    FINISH: 'border-emerald-300 text-emerald-700',
  }
  const SJ_CLS: Record<string, string> = {
    DRAFT: 'border-slate-300 text-slate-500',
    DIPERIKSA: 'border-amber-300 text-amber-700',
    DITERAPKAN: 'border-emerald-300 text-emerald-700',
  }
  // Label ramah alur cek berlapis (nilai DB tetap DRAFT/DIPERIKSA/DITERAPKAN)
  const SJ_LABEL: Record<string, string> = { DRAFT: 'DRAF', DIPERIKSA: 'SUDAH DICEK', DITERAPKAN: 'PART DITERIMA' }

  // ===== Riwayat Request (SJR) + cross-check: part request mana yang sudah =====
  // dikirim produsen vs belum — dibuka manual dari klik supaya hemat & tanpa
  // setState di dalam effect. Verifikasi manual (periksa → terapkan) tetap wajib.
  const [sjrOpen, setSjrOpen] = useState(false)
  const [sjrRows, setSjrRows] = useState<SjrDoc[] | null>(null)
  const [sjrLoading, setSjrLoading] = useState(false)
  const toggleSjr = () => {
    const buka = !sjrOpen
    setSjrOpen(buka)
    if (buka && sjrRows === null) {
      setSjrLoading(true)
      fetcher<SjrDoc[]>('/api/surat-jalan-request')
        .then(setSjrRows)
        .catch((e) => toast({ title: 'Riwayat Request gagal dimuat', description: (e as Error).message, variant: 'destructive' }))
        .finally(() => setSjrLoading(false))
    }
  }

  // ===== Konsumsi navIntent — klik "Cek kode" dari view lain (tiket/inventory/klaim) =====
  // Isi pencarian Bank Kode dengan kode sasaran, muat hasilnya, lalu scroll ke kartu ini.
  // useRef + setTimeout(0) mengikuti pola claim-view (tidak setState sinkron di effect body).
  const bankRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!navIntent) return
    const kode = navIntent.lacakQuery
    const t = setTimeout(() => {
      if (kode) {
        setBankQ(kode)
        void muatBank(kode)
        bankRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }
      clearNavIntent()
    }, 0)
    return () => clearTimeout(t)
    // muatBank sengaja di luar deps — identitasnya berubah tiap render, intent dihormati cukup sekali
  }, [navIntent, clearNavIntent])

  return (
    <div className="space-y-4">
      {/* ===== Part Datang — Surat Jalan produsen (kiriman bertahap) ===== */}
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2 text-base">
            <Truck className="h-4 w-4 text-teal-700" /> Part Datang — Surat Jalan Produsen
            {datangRows && (
              <Badge variant="outline" className="border-slate-300 text-[10px] text-slate-600">
                {datangRows.length} baris · {new Set(datangRows.map((r) => r.noTiket).filter(Boolean)).size} tiket
              </Badge>
            )}
          </CardTitle>
          <CardDescription>
            Kiriman part jarang datang bersamaan — cari pemiliknya lewat kotak bebas: tgl datang, no. tiket, toko, serial/model, kode/nama part, kerusakan atau status. Ketuk kode untuk salin.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input
              value={datangQ}
              onChange={(e) => setDatangQ(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void muatDatang(datangQ)}
              placeholder="Cari part datang… cth: SVC-2610-0039 / nama toko / dk-01 / 20/10"
              className="h-8 text-xs"
              aria-label="Cari part datang"
            />
            <Button size="sm" variant="outline" className="h-8 shrink-0" disabled={datangLoading} onClick={() => void muatDatang(datangQ)}>
              {datangLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Cari'}
            </Button>
          </div>
          {datangRows === null ? (
            <p className="rounded-lg border border-dashed p-4 text-center text-xs text-slate-500">Memuat…</p>
          ) : datangRows.length === 0 ? (
            <p className="rounded-lg border border-dashed p-4 text-center text-xs text-slate-500">
              Tidak ada kiriman yang cocok — coba kata kunci lain (mis. kode part, nama toko, atau no. tiket).
            </p>
          ) : (
            <div className="max-h-[26rem] overflow-auto rounded-md border">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-slate-50">
                  <TableRow>
                    <TableHead className="text-[10px]">Tgl Datang</TableHead>
                    <TableHead className="text-[10px]">No. Surat Jalan</TableHead>
                    <TableHead className="text-[10px]">Kode Sparepart</TableHead>
                    <TableHead className="text-[10px]">Nama Sparepart</TableHead>
                    <TableHead className="text-[10px] text-right">Qty</TableHead>
                    <TableHead className="text-[10px]">No. Tiket</TableHead>
                    <TableHead className="text-[10px]">Toko</TableHead>
                    <TableHead className="text-[10px]">Serial / Model</TableHead>
                    <TableHead className="text-[10px]">Status</TableHead>
                    <TableHead className="hidden text-[10px] md:table-cell">Kerusakan</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {datangRows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="whitespace-nowrap">
                        <p className={cn('text-xs font-bold', r.tglDatang ? 'text-emerald-700' : 'text-slate-400')}>{fmtTgl(r.tglDatang)}</p>
                        <p className="text-[10px] text-slate-400" title="Tgl tercetak di surat jalan">surat: {fmtTgl(r.tglSurat)}</p>
                      </TableCell>
                      <TableCell>
                        <p className="font-mono text-[10px] font-semibold text-slate-700">{r.noSuratJalan}</p>
                        <Badge variant="outline" className={cn('mt-0.5 text-[9px]', SJ_CLS[r.sjStatus] ?? 'border-slate-300 text-slate-500')}>
                          {SJ_LABEL[r.sjStatus] ?? r.sjStatus}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <KodeSparepart kode={r.kodePart} nama={r.namaPart} className="text-[11px] text-slate-800" />
                      </TableCell>
                      <TableCell>
                        <p className="max-w-40 truncate text-xs text-slate-700" title={r.namaPart || undefined}>{r.namaPart || '—'}</p>
                      </TableCell>
                      <TableCell className="text-right text-xs font-bold">{r.qty}</TableCell>
                      <TableCell>
                        {r.noTiket ? (
                          <span className="font-mono text-[11px] font-semibold text-emerald-700">{r.noTiket}</span>
                        ) : (
                          <Badge variant="outline" className="text-[9px] text-slate-400">tanpa tiket</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <p className="max-w-32 truncate text-xs text-slate-700" title={r.toko || undefined}>{r.toko || '—'}</p>
                      </TableCell>
                      <TableCell>
                        <p className="font-mono text-[10px] text-slate-500">{r.serial || '—'}</p>
                        <p className="max-w-32 truncate text-[10px] text-slate-400" title={r.model || undefined}>{r.model || '—'}</p>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col items-start gap-0.5">
                          {r.status && (
                            <Badge variant="outline" className={cn('text-[9px]', TIKET_CLS[r.status] ?? 'border-slate-300 text-slate-500')}>
                              {r.status}
                            </Badge>
                          )}
                          <span className={cn('text-[9px] font-semibold', r.statusPart === 'READY' ? 'text-emerald-600' : r.statusPart === 'ORDER' ? 'text-rose-600' : 'text-slate-400')}>
                            {r.statusPart === '-' ? '—' : r.statusPart}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="hidden max-w-44 md:table-cell">
                        <p className="truncate text-[10px] text-slate-500" title={r.kerusakan || undefined}>{r.kerusakan || '—'}</p>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {/* Riwayat Request (SJR) + cross-check: sudah dikirim vs belum */}
          <div className="border-t border-slate-200 pt-3">
            <button
              type="button"
              onClick={toggleSjr}
              className="flex w-full items-center justify-between gap-2 text-[11px] font-semibold text-slate-700 hover:text-teal-700"
            >
              <span className="flex items-center gap-1.5">
                <BookMarked className="h-3.5 w-3.5" /> Riwayat Request (SJR) — cross-check ke kiriman
              </span>
              <span className="text-[10px] font-normal text-slate-400">{sjrOpen ? 'tutup ▲' : 'buka ▼'}</span>
            </button>
            {sjrOpen && (
              <div className="mt-2">
                {sjrRows === null ? (
                  <p className="rounded-lg border border-dashed p-3 text-center text-[10px] text-slate-500">
                    {sjrLoading ? 'Memuat…' : '—'}
                  </p>
                ) : sjrRows.length === 0 ? (
                  <p className="rounded-lg border border-dashed p-3 text-center text-[10px] text-slate-500">
                    Belum ada dokumen request — pilih tiket di Service Tiket → Surat Jalan → unduh.
                  </p>
                ) : (
                  <div className="overflow-auto rounded-md border">
                    <Table>
                      <TableHeader className="bg-slate-50">
                        <TableRow>
                          <TableHead className="text-[10px]">No. SJR</TableHead>
                          <TableHead className="text-[10px]">Tgl Request</TableHead>
                          <TableHead className="text-[10px] text-right">Item</TableHead>
                          <TableHead className="text-[10px] text-right">Diterima</TableHead>
                          <TableHead className="text-[10px] text-right">Dicatat</TableHead>
                          <TableHead className="text-[10px] text-right">Belum</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {sjrRows.map((d) => (
                          <TableRow key={d.noSurat}>
                            <TableCell>
                              <p className="font-mono text-[10px] font-bold text-slate-700">{d.noSurat}</p>
                              <p className="text-[9px] text-slate-400">{d.totalTiket} tiket · {d.totalQty} pcs</p>
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-[11px] text-slate-600">{fmtTgl(d.tglRequest)}</TableCell>
                            <TableCell className="text-right text-xs">{d.totalItem}</TableCell>
                            <TableCell className="text-right text-xs font-bold text-emerald-700">{d.diterima}</TableCell>
                            <TableCell className="text-right text-xs font-semibold text-amber-700">{d.dicatat}</TableCell>
                            <TableCell
                              className="text-right text-xs font-bold text-rose-600"
                              title={d.contohBelum.map((b) => `${b.kodePart} (${b.noTiket})`).join(' · ') || undefined}
                            >
                              {d.belum}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
                <p className="mt-1.5 text-[10px] text-slate-400">
                  Diterima = masuk lewat surat jalan yang PART DITERIMA · Dicatat = produsen sudah tandai kirim (cepat dicek manual) ·
                  arahkan kursor ke angka Belum untuk lihat kode partnya.
                </p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <SearchCheck className="h-4 w-4 text-teal-700" /> Lacak Sparepart dari Riwayat
          </CardTitle>
          <CardDescription>
            Masukkan model unit + jenis kerusakan — sistem memindai {hasil ? `${hasil.totalTiketDipindai} tiket tersimpan` : 'seluruh tiket tersimpan'} di database dan menampilkan kode + nama part yang cocok
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Model Unit</Label>
              <HistoryInput
                historyKey="unit-model"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void cari()}
                placeholder="cth: Kipas Angin 16 inch"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Jenis Kerusakan</Label>
              <HistoryInput
                historyKey="service-deskripsi"
                value={rusak}
                onChange={(e) => setRusak(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void cari()}
                placeholder="cth: tidak berputar, dinamo mati"
              />
            </div>
          </div>
          <Button className="mt-3 bg-teal-700 hover:bg-teal-800" disabled={mencari} onClick={() => void cari()}>
            <SearchCheck className="mr-1.5 h-4 w-4" /> {mencari ? 'Memindai…' : 'Lacak Sparepart'}
          </Button>
        </CardContent>
      </Card>

      {/* ===== Bank Kode Produsen — registry kode rumit + Powered AI ===== */}
      <div ref={bankRef}>
      <Card className="border-violet-200">
        <CardHeader className="flex-row items-start justify-between gap-2 space-y-0 pb-2">
          <div>
            <CardTitle className="flex flex-wrap items-center gap-2 text-base">
              <BookMarked className="h-4 w-4 text-violet-600" /> Bank Kode Produsen
              <Badge variant="outline" className="border-violet-300 text-[10px] text-violet-700">Powered AI</Badge>
              {bankHasil && (
                <Badge variant="outline" className="border-slate-300 text-[10px] text-slate-600">
                  {bankHasil.totalBank} kode terdaftar
                </Badge>
              )}
            </CardTitle>
            <CardDescription className="text-xs">
              Semua kode yang pernah masuk aplikasi + kode baru rilis produsen via CSV — cari, tanya AI, salin, tempel ke tiket.
            </CardDescription>
          </div>
          <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2 text-[11px]"
              disabled={sinkronMut.isPending}
              onClick={() => sinkronMut.mutate()}
              title="Tarik semua kode dari katalog, tiket & order ke bank"
            >
              {sinkronMut.isPending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <RefreshCw className="mr-1 h-3 w-3" />}
              Sinkronkan
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2 text-[11px]"
              onClick={() => {
                void fetcher<{ items: BankKode[] }>('/api/bank-kode?take=200')
                  .then((r) => {
                    setBankCodes(r.items.map((b) => b.kode))
                    setImportOpen(true)
                  })
                  .catch((e: Error) => toast({ title: 'Gagal membuka import', description: e.message, variant: 'destructive' }))
              }}
              title="Upload CSV kode baru rilis produsen"
            >
              <Upload className="mr-1 h-3 w-3" /> Import CSV
            </Button>
            <Button size="sm" className="h-7 bg-violet-600 px-2 text-[11px] hover:bg-violet-700" onClick={() => setTambahOpen(true)} title="Catat satu kode sparepart manual">
              <Plus className="mr-1 h-3 w-3" /> Tambah Kode Sparepart
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="flex flex-1 gap-2">
              <Input
                value={bankQ}
                onChange={(e) => setBankQ(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void muatBank(bankQ)}
                placeholder="Cari kode / nama / brand / model…"
                className="h-8 text-xs"
                aria-label="Cari bank kode"
              />
              <Button size="sm" variant="outline" className="h-8 shrink-0" disabled={bankLoading} onClick={() => void muatBank(bankQ)}>
                {bankLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Cari'}
              </Button>
            </div>
            <div className="flex flex-1 gap-2">
              <Input
                value={aiButuh}
                onChange={(e) => setAiButuh(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && aiButuh.trim() && !aiKodeMut.isPending && aiKodeMut.mutate()}
                placeholder="Ceritakan kebutuhan kode… cth: dinamo Miyako 16 inch"
                className="h-8 border-violet-300 text-xs"
                aria-label="Tanya AI kebutuhan kode"
              />
              <Button
                size="sm"
                className="h-8 shrink-0 bg-violet-600 hover:bg-violet-700"
                disabled={!aiButuh.trim() || aiKodeMut.isPending}
                onClick={() => aiKodeMut.mutate()}
                title="AI memilih kode dari Bank Kode"
              >
                {aiKodeMut.isPending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Sparkles className="mr-1 h-3 w-3" />}
                Tanya AI
              </Button>
            </div>
          </div>

          {aiKode && (
            <div className="rounded-xl border border-violet-300 bg-violet-50/50 p-2.5">
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <p className="flex min-w-0 items-center gap-1.5 text-xs font-bold text-violet-800">
                  <Sparkles className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">Jawaban AI · {aiKode.model}</span>
                </p>
                <Button size="sm" variant="ghost" className="h-6 w-6 shrink-0 p-0 text-slate-400 hover:text-slate-700" onClick={() => setAiKode(null)} aria-label="Tutup jawaban AI">
                  <X className="h-3 w-3" />
                </Button>
              </div>
              <div className="space-y-1.5">
                {aiKode.rekomendasi.map((r, i) => {
                  const refKode = (bankHasil?.items ?? []).find((b) => b.kode.toUpperCase() === r.kode.toUpperCase())
                  return (
                  <div key={r.kode} className="flex items-start gap-2 rounded-lg border border-violet-200 bg-white px-2.5 py-1.5">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-violet-600 text-[10px] font-bold text-white">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-1.5 font-mono text-[11px] font-bold text-slate-900">
                        <KodeSparepart kode={r.kode} className="text-[11px] text-slate-900" />
                        {refKode?.modelTipe?.trim() && (
                          <span className="rounded bg-emerald-100 px-1 py-px font-sans text-[9px] font-semibold text-emerald-700" title={`Cocok untuk model: ${refKode.modelTipe}`}>
                            {refKode.modelTipe}
                          </span>
                        )}
                      </p>
                      {r.alasan && <p className="mt-0.5 text-[11px] italic leading-snug text-violet-800">{r.alasan}</p>}
                    </div>
                  </div>
                  )
                })}
              </div>
              {aiKode.catatan && <p className="mt-1.5 text-[11px] text-violet-800">{aiKode.catatan}</p>}
            </div>
          )}

          {bankHasil ? (
            bankHasil.items.length === 0 ? (
              <p className="rounded-lg border border-dashed p-4 text-center text-xs text-slate-500">
                Tidak ada kode yang cocok — coba kata kunci lain, Sinkronkan, atau Import CSV kode baru produsen.
              </p>
            ) : (
              <div className="max-h-72 overflow-auto rounded-md border">
                <Table>
                  <TableHeader className="sticky top-0 z-10 bg-slate-50">
                    <TableRow>
                      <TableHead className="text-[10px]">Kode</TableHead>
                      <TableHead className="text-[10px]">Nama</TableHead>
                      <TableHead className="hidden text-[10px] sm:table-cell">Model / Brand</TableHead>
                      <TableHead className="text-[10px]">Sumber</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {bankHasil.items.map((b) => (
                      <TableRow key={b.id}>
                        <TableCell>
                          <KodeSparepart kode={b.kode} nama={b.namaPart} className="text-[11px] text-slate-800" />
                        </TableCell>
                        <TableCell>
                          <p className="max-w-48 truncate text-xs text-slate-700" title={b.namaPart || undefined}>{b.namaPart || '—'}</p>
                        </TableCell>
                        <TableCell className="hidden max-w-44 sm:table-cell">
                          {b.modelTipe?.trim() ? (
                            <span className="inline-block max-w-full truncate rounded bg-emerald-100 px-1.5 py-px font-mono text-[10px] font-semibold text-emerald-700" title={`Model/tipe: ${b.modelTipe}${b.brandKompatibel?.trim() ? ` · ${b.brandKompatibel}` : ''}`}>
                              {b.modelTipe}
                            </span>
                          ) : (
                            <span className="text-[11px] text-slate-300">—</span>
                          )}
                          {(b.brandKompatibel?.trim() || b.produsen?.trim()) && (
                            <p className="mt-0.5 max-w-44 truncate text-[10px] text-slate-400" title={[b.brandKompatibel?.trim(), b.produsen?.trim()].filter(Boolean).join(' · ')}>
                              {[b.brandKompatibel?.trim(), b.produsen?.trim()].filter(Boolean).join(' · ')}
                            </p>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={cn('text-[9px]', SUMBER_CLS[b.sumber] ?? 'border-slate-300 bg-slate-50 text-slate-500')}>
                            {b.sumber}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )
          ) : (
            <p className="rounded-lg border border-dashed p-4 text-center text-xs text-slate-500">
              Klik <span className="font-semibold">Cari</span> (kosongkan untuk semua), <span className="font-semibold">Sinkronkan</span> untuk menarik kode lama, atau <span className="font-semibold">Import CSV</span> untuk kode baru rilis produsen.
            </p>
          )}
        </CardContent>
      </Card>
      </div>

      {/* Dialog tambah kode sparepart manual */}
      <Dialog open={tambahOpen} onOpenChange={setTambahOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Tambah Kode Sparepart</DialogTitle>
            <DialogDescription>Catat satu kode — mis. baru diterima via chat produsen. Hanya kode yang wajib; isi model/tipe agar cepat terlacak.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="space-y-1.5"><Label>Kode *</Label><Input value={formKode.kode} onChange={(e) => setFormKode({ ...formKode, kode: e.target.value.toUpperCase() })} placeholder="cth: MX-88X-KLIMA" className="font-mono" /></div>
            <div className="space-y-1.5"><Label>Nama Part</Label><Input value={formKode.nama} onChange={(e) => setFormKode({ ...formKode, nama: e.target.value })} placeholder="boleh kosong bila belum ada" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>Brand</Label><Input value={formKode.brand} onChange={(e) => setFormKode({ ...formKode, brand: e.target.value })} /></div>
              <div className="space-y-1.5"><Label>Model / Tipe *</Label><Input value={formKode.model} onChange={(e) => setFormKode({ ...formKode, model: e.target.value })} placeholder="cth: Kipas Angin 16 inch" /></div>
            </div>
            <div className="space-y-1.5"><Label>Catatan</Label><Input value={formKode.catatan} onChange={(e) => setFormKode({ ...formKode, catatan: e.target.value })} placeholder="cth: rilis katalog Q3" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTambahOpen(false)}>Batal</Button>
            <Button className="bg-violet-600 hover:bg-violet-700" disabled={!formKode.kode.trim() || tambahMut.isPending} onClick={() => tambahMut.mutate()}>
              {tambahMut.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Plus className="mr-1 h-4 w-4" />} Simpan Kode
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog import CSV kode produsen */}
      <CsvImportDialog
        kind="bankkode"
        open={importOpen}
        onOpenChange={setImportOpen}
        existingCodes={bankCodes}
        onSuccess={() => void muatBank(bankQ)}
      />

      {mencari ? (
        <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14" />)}</div>
      ) : hasil ? (
        <Card>
          <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
            <div>
              <CardTitle className="text-base">Hasil Pelacakan ({hasil.totalCocok})</CardTitle>
              <CardDescription className="flex items-center gap-1">
                <Database className="h-3 w-3" /> Dipindai {hasil.totalTiketDipindai} tiket · peringkat = kecocokan kata + frekuensi pemakaian
              </CardDescription>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="h-7 shrink-0 border-violet-300 px-2 text-[11px] text-violet-700 hover:bg-violet-50"
              disabled={aiMut.isPending || hasil.hasil.length === 0}
              onClick={() => aiMut.mutate()}
              title="Minta AI (9router) meranking kandidat + alasan"
            >
              {aiMut.isPending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Sparkles className="mr-1 h-3 w-3" />}
              {aiMut.isPending ? 'Menganalisa…' : 'Analisa AI'}
            </Button>
          </CardHeader>
          <CardContent>
            {aiHasil && (
              <div className="mb-3 rounded-xl border border-violet-300 bg-violet-50/50 p-2.5">
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <p className="flex min-w-0 items-center gap-1.5 text-xs font-bold text-violet-800">
                    <Sparkles className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">Rekomendasi AI · {aiHasil.model}</span>
                  </p>
                  <Button size="sm" variant="ghost" className="h-6 w-6 shrink-0 p-0 text-slate-400 hover:text-slate-700" onClick={() => setAiHasil(null)} aria-label="Tutup analisa AI">
                    <X className="h-3 w-3" />
                  </Button>
                </div>
                <div className="space-y-1.5">
                  {aiHasil.rekomendasi.map((r, i) => {
                    const ref = hasil.hasil.find((h) => h.kodePart.toUpperCase() === r.kode.toUpperCase())
                    return (
                      <div key={r.kode} className="flex items-start gap-2 rounded-lg border border-violet-200 bg-white px-2.5 py-1.5">
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-violet-600 text-[10px] font-bold text-white">{i + 1}</span>
                        <div className="min-w-0 flex-1">
                          <p className="font-mono text-[11px] font-bold text-slate-900">
                            <KodeSparepart kode={r.kode} nama={ref?.namaPart} className="text-[11px] text-slate-900" />
                            <span className="font-sans font-medium text-slate-600">· {ref?.namaPart ?? ''}</span>
                            {ref && ref.stokInventory === 0 && <span className="ml-1 rounded bg-rose-100 px-1 font-sans text-[9px] font-semibold text-rose-700">KOSONG</span>}
                          </p>
                          {r.alasan && <p className="mt-0.5 text-[11px] italic leading-snug text-violet-800">{r.alasan}</p>}
                        </div>
                      </div>
                    )
                  })}
                </div>
                {aiHasil.catatan && <p className="mt-1.5 text-[11px] text-violet-800">{aiHasil.catatan}</p>}
              </div>
            )}
            {hasil.hasil.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-10 text-center">
                <PackageX className="h-8 w-8 text-slate-300" />
                <p className="text-sm font-medium text-slate-700">Tidak ada part yang cocok di riwayat</p>
                <p className="max-w-sm text-xs text-slate-500">
                  Coba kata kunci lain, atau input kode + nama langsung dari balasan produsen — data baru otomatis ikut terpindai berikutnya.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Kode Sparepart</TableHead>
                      <TableHead>Nama Sparepart</TableHead>
                      <TableHead>Stok</TableHead>
                      <TableHead>Kecocokan</TableHead>
                      <TableHead className="hidden md:table-cell">Pernah dipakai di</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {hasil.hasil.map((h) => (
                      <TableRow key={h.sparepartId}>
                        <TableCell>
                          <KodeSparepart kode={h.kodePart} nama={h.namaPart} className="text-[11px] text-slate-800" />
                          {(h.brandKompatibel?.trim() || h.supplier?.trim()) && (
                            <p className="max-w-36 truncate text-[10px] text-slate-400" title={[h.brandKompatibel, h.supplier].filter(Boolean).join(' · ')}>
                              {[h.brandKompatibel?.trim(), h.supplier?.trim()].filter(Boolean).join(' · ')}
                            </p>
                          )}
                        </TableCell>
                        <TableCell>
                          <p className="text-xs font-medium text-slate-800">{h.namaPart}</p>
                          <p className="text-[10px] text-slate-400">dipakai {h.frekuensi}×</p>
                        </TableCell>
                        <TableCell>
                          {h.stokInventory === 0 ? (
                            <Badge variant="destructive" className="text-[10px]">KOSONG</Badge>
                          ) : (
                            <span className="text-xs font-semibold text-slate-800">
                              {h.stokInventory} <span className="font-normal text-slate-400">({h.stokJual}/{h.stokGaransi})</span>
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="w-32">
                          <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                            <div
                              className={cn('h-full rounded-full', h.skor >= skorMax * 0.66 ? 'bg-emerald-500' : h.skor >= skorMax * 0.33 ? 'bg-amber-500' : 'bg-slate-300')}
                              style={{ width: `${Math.round((h.skor / skorMax) * 100)}%` }}
                            />
                          </div>
                          <p className="mt-0.5 text-[10px] text-slate-400">skor {h.skor}</p>
                        </TableCell>
                        <TableCell className="hidden max-w-56 md:table-cell">
                          <div className="space-y-1">
                            {h.contoh.map((c) => (
                              <p key={c.noTiket} className="truncate text-[10px] text-slate-500" title={`${c.model} — ${c.deskripsi}`}>
                                <span className="font-mono font-semibold text-slate-600">{c.noTiket}</span> · {c.deskripsi}
                              </p>
                            ))}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
            <SearchCheck className="h-8 w-8 text-slate-300" />
            <p className="text-sm font-medium text-slate-700">Belum ada pelacakan</p>
            <p className="max-w-sm text-xs text-slate-500">
              Contoh: model “Kipas Angin 16 inch” + kerusakan “tidak berputar” → sistem menampilkan kode &amp; nama part yang pernah dipakai untuk kasus serupa, lengkap dengan stoknya.
            </p>
          </CardContent>
        </Card>
      )}

    </div>
  )
}
