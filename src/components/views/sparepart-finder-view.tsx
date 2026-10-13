'use client'

import { useState } from 'react'
import { fetcher } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import HistoryInput from '@/components/history-input'
import { useToast } from '@/hooks/use-toast'
import { SearchCheck, PackageX, Database } from 'lucide-react'
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

  const cari = async () => {
    if (!model.trim() && !rusak.trim()) {
      toast({ title: 'Belum bisa melacak', description: 'Isi model unit dan/atau jenis kerusakan dulu.', variant: 'destructive' })
      return
    }
    setMencari(true)
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
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle className="text-base">Hasil Pelacakan ({hasil.totalCocok})</CardTitle>
              <CardDescription className="flex items-center gap-1">
                <Database className="h-3 w-3" /> Dipindai {hasil.totalTiketDipindai} tiket · peringkat = kecocokan kata + frekuensi pemakaian
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
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
