'use client'

import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { fetcher, postJson } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import HistoryInput from '@/components/history-input'
import { useToast } from '@/hooks/use-toast'
import { SearchCheck, PackageX, Database, Sparkles, Loader2, X } from 'lucide-react'
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

  const skorMax = Math.max(1, ...(hasil?.hasil.map((h) => h.skor) ?? [1]))

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
                        <div className="min-w-0">
                          <p className="font-mono text-[11px] font-bold text-slate-900">
                            {r.kode} <span className="font-sans font-medium text-slate-600">· {ref?.namaPart ?? ''}</span>
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
                          <p className="font-mono text-[11px] font-semibold text-slate-800">{h.kodePart}</p>
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
