'use client'

import { useState } from 'react'
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
import { useAppStore } from '@/lib/store'
import { useToast } from '@/hooks/use-toast'
import { SearchCheck, PackageX, Database, Sparkles, Loader2, X, Copy, Check, BookMarked, Plus, Upload, RefreshCw } from 'lucide-react'
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
  const { role } = useAppStore()
  const [bankQ, setBankQ] = useState('')
  const [bankHasil, setBankHasil] = useState<{ total: number; totalBank: number; items: BankKode[] } | null>(null)
  const [bankLoading, setBankLoading] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [bankCodes, setBankCodes] = useState<string[]>([])
  const [tambahOpen, setTambahOpen] = useState(false)
  const [formKode, setFormKode] = useState({ kode: '', nama: '', brand: '', produsen: '', catatan: '' })
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
    mutationFn: () => postJson('/api/bank-kode', { ...formKode, aktor: role }),
    onSuccess: () => {
      setTambahOpen(false)
      setFormKode({ kode: '', nama: '', brand: '', produsen: '', catatan: '' })
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

  // ===== Salin kode — satu ketuk langsung copy-paste ke tiket/order =====
  const [disalin, setDisalin] = useState<string | null>(null)
  const salinKode = async (kode: string) => {
    const teks = kode.trim()
    if (!teks) return
    try {
      await navigator.clipboard.writeText(teks)
    } catch {
      // Fallback untuk iframe / konteks non-secure (clipboard API diblokir)
      const ta = document.createElement('textarea')
      ta.value = teks
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      try {
        document.execCommand('copy')
      } catch {
        // abaikan — toast tetap memberi tahu kode yang dimaksud
      }
      ta.remove()
    }
    setDisalin(teks)
    toast({ title: 'Kode tersalin', description: `${teks} siap ditempel ke tiket / order.` })
    setTimeout(() => setDisalin((d) => (d === teks ? null : d)), 1500)
  }

  return (
    <div className="space-y-4">
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
                placeholder="cth: AC Split 1 PK"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Jenis Kerusakan</Label>
              <HistoryInput
                historyKey="service-deskripsi"
                value={rusak}
                onChange={(e) => setRusak(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void cari()}
                placeholder="cth: tidak dingin, kompresor mati"
              />
            </div>
          </div>
          <Button className="mt-3 bg-teal-700 hover:bg-teal-800" disabled={mencari} onClick={() => void cari()}>
            <SearchCheck className="mr-1.5 h-4 w-4" /> {mencari ? 'Memindai…' : 'Lacak Sparepart'}
          </Button>
        </CardContent>
      </Card>

      {/* ===== Bank Kode Produsen — registry kode rumit + Powered AI ===== */}
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
            <Button size="sm" className="h-7 bg-violet-600 px-2 text-[11px] hover:bg-violet-700" onClick={() => setTambahOpen(true)} title="Catat satu kode manual">
              <Plus className="mr-1 h-3 w-3" /> Tambah
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
                placeholder="Cari kode / nama / brand / produsen…"
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
                placeholder="Ceritakan kebutuhan kode… cth: kompresor Samsung 3/4 PK"
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
                {aiKode.rekomendasi.map((r, i) => (
                  <div key={r.kode} className="flex items-start gap-2 rounded-lg border border-violet-200 bg-white px-2.5 py-1.5">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-violet-600 text-[10px] font-bold text-white">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <p className="font-mono text-[11px] font-bold text-slate-900">{r.kode}</p>
                      {r.alasan && <p className="mt-0.5 text-[11px] italic leading-snug text-violet-800">{r.alasan}</p>}
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 w-6 shrink-0 p-0 text-violet-500 hover:bg-violet-100 hover:text-violet-700"
                      onClick={() => void salinKode(r.kode)}
                      title={`Salin kode ${r.kode}`}
                      aria-label={`Salin kode ${r.kode}`}
                    >
                      {disalin === r.kode ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                    </Button>
                  </div>
                ))}
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
                      <TableHead className="hidden text-[10px] sm:table-cell">Brand / Produsen</TableHead>
                      <TableHead className="text-[10px]">Sumber</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {bankHasil.items.map((b) => (
                      <TableRow key={b.id}>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <p className="font-mono text-[11px] font-semibold text-slate-800">{b.kode}</p>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 w-6 shrink-0 p-0 text-slate-400 hover:bg-violet-50 hover:text-violet-700"
                              onClick={() => void salinKode(b.kode)}
                              title={`Salin kode ${b.kode}`}
                              aria-label={`Salin kode ${b.kode}`}
                            >
                              {disalin === b.kode ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                            </Button>
                          </div>
                        </TableCell>
                        <TableCell>
                          <p className="max-w-48 truncate text-xs text-slate-700" title={b.namaPart || undefined}>{b.namaPart || '—'}</p>
                        </TableCell>
                        <TableCell className="hidden max-w-44 truncate text-[11px] text-slate-500 sm:table-cell" title={[b.brandKompatibel, b.produsen].filter(Boolean).join(' · ') || undefined}>
                          {[b.brandKompatibel?.trim(), b.produsen?.trim()].filter(Boolean).join(' · ') || '—'}
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

      {/* Dialog tambah kode manual */}
      <Dialog open={tambahOpen} onOpenChange={setTambahOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Tambah Kode Produsen</DialogTitle>
            <DialogDescription>Catat satu kode — mis. baru diterima via chat produsen. Hanya kode yang wajib.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="space-y-1.5"><Label>Kode *</Label><Input value={formKode.kode} onChange={(e) => setFormKode({ ...formKode, kode: e.target.value.toUpperCase() })} placeholder="cth: MX-88X-KLIMA" className="font-mono" /></div>
            <div className="space-y-1.5"><Label>Nama Part</Label><Input value={formKode.nama} onChange={(e) => setFormKode({ ...formKode, nama: e.target.value })} placeholder="boleh kosong bila belum ada" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>Brand</Label><Input value={formKode.brand} onChange={(e) => setFormKode({ ...formKode, brand: e.target.value })} /></div>
              <div className="space-y-1.5"><Label>Produsen</Label><Input value={formKode.produsen} onChange={(e) => setFormKode({ ...formKode, produsen: e.target.value })} /></div>
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
                            {r.kode} <span className="font-sans font-medium text-slate-600">· {ref?.namaPart ?? ''}</span>
                            {ref && ref.stokInventory === 0 && <span className="ml-1 rounded bg-rose-100 px-1 font-sans text-[9px] font-semibold text-rose-700">KOSONG</span>}
                          </p>
                          {r.alasan && <p className="mt-0.5 text-[11px] italic leading-snug text-violet-800">{r.alasan}</p>}
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 w-6 shrink-0 p-0 text-violet-500 hover:bg-violet-100 hover:text-violet-700"
                          onClick={() => void salinKode(r.kode)}
                          title={`Salin kode ${r.kode}`}
                          aria-label={`Salin kode ${r.kode}`}
                        >
                          {disalin === r.kode ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                        </Button>
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
                          <div className="flex items-center gap-1">
                            <p className="font-mono text-[11px] font-semibold text-slate-800">{h.kodePart}</p>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 w-6 shrink-0 p-0 text-slate-400 hover:bg-teal-50 hover:text-teal-700"
                              onClick={() => void salinKode(h.kodePart)}
                              title={`Salin kode ${h.kodePart}`}
                              aria-label={`Salin kode ${h.kodePart}`}
                            >
                              {disalin === h.kodePart ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                            </Button>
                          </div>
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
              Contoh: model “AC Split 1 PK” + kerusakan “tidak dingin” → sistem menampilkan kode &amp; nama part yang pernah dipakai untuk kasus serupa, lengkap dengan stoknya.
            </p>
          </CardContent>
        </Card>
      )}

    </div>
  )
}
