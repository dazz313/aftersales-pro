'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchVisionScans, uploadVisionScan, visionFileUrl, gatewaySimulate, type VisionScan } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import { ImagePlus, Loader2, Barcode, ScanText, Send, CheckCircle2 } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Props {
  channel: 'WHATSAPP' | 'TELEGRAM'
  pengirimDefault: string
  compact?: boolean
  /** Varian tipis: header & padding dipadatkan untuk berdampingan rapi. */
  thin?: boolean
}

export default function VisionScanner({ channel, pengirimDefault, compact, thin }: Props) {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [caption, setCaption] = useState('')
  const [folder, setFolder] = useState<'KUNJUNGAN' | 'SERVICE'>('SERVICE')
  const [hasil, setHasil] = useState<VisionScan | null>(null)

  const { data: riwayat, isLoading } = useQuery<VisionScan[]>({
    queryKey: ['vision-scans'],
    queryFn: fetchVisionScans,
  })

  const upMutation = useMutation({
    mutationFn: () => uploadVisionScan(file!, pengirimDefault, caption, folder),
    onSuccess: (res) => {
      setHasil(res.scan)
      queryClient.invalidateQueries({ queryKey: ['vision-scans'] })
      queryClient.invalidateQueries({ queryKey: ['inbox'] })
      queryClient.invalidateQueries({ queryKey: ['inbox-pending-count'] })
      queryClient.invalidateQueries({ queryKey: ['wa-messages'] })
      toast({
        title: res.scan.barcode || res.scan.ocrText ? 'Foto terbaca' : 'Foto tersimpan, tidak terbaca',
        description: res.scan.barcode
          ? `Barcode: ${res.scan.barcode} — item masuk Inbox folder ${folder}.`
          : 'Item masuk Inbox untuk review manual.',
        variant: res.scan.barcode || res.scan.ocrText ? 'default' : 'destructive',
      })
    },
    onError: (e: Error) => toast({ title: 'Upload gagal', description: e.message, variant: 'destructive' }),
  })

  const laporMutation = useMutation({
    mutationFn: (teks: string) => gatewaySimulate(teks, pengirimDefault, channel),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['wa-messages'] })
      queryClient.invalidateQueries({ queryKey: ['service-tickets'] })
      toast({ title: `Bot memproses: ${res.aksi}`, description: res.noTiket ? `Tiket ${res.noTiket} dibuat.` : res.reply.slice(0, 120) })
    },
    onError: (e: Error) => toast({ title: 'Gagal mengirim laporan', description: e.message, variant: 'destructive' }),
  })

  const pilihFile = (f: File | null) => {
    setFile(f)
    setHasil(null)
    if (preview) URL.revokeObjectURL(preview)
    setPreview(f ? URL.createObjectURL(f) : null)
  }

  return (
    <Card className="h-full border-sky-200">
      <CardHeader className={thin ? 'px-3 pb-2 pt-3' : undefined}>
        <CardTitle className={cn('flex items-center gap-2', thin ? 'text-sm' : 'text-base')}>
          <ImagePlus className={cn('text-sky-600', thin ? 'h-3.5 w-3.5' : 'h-4 w-4')} /> Pembaca Foto &amp; Barcode
        </CardTitle>
        <CardDescription className={thin ? 'text-[11px]' : undefined}>
          Upload foto → tersimpan di folder Telegram ({folder === 'KUNJUNGAN' ? 'kunjungan' : 'service'}) → barcode &amp; tulisan terbaca otomatis → masuk Inbox untuk dikontrol.
        </CardDescription>
      </CardHeader>
      <CardContent className={thin ? 'space-y-2 px-3 pb-3' : 'space-y-3'}>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-xs">Foto (JPG/PNG/WebP, maks 10 MB)</Label>
            <Input type="file" accept="image/*" onChange={(e) => pilihFile(e.target.files?.[0] ?? null)} aria-label="Pilih foto untuk dibaca" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Folder tujuan</Label>
            <Select value={folder} onValueChange={(v) => setFolder(v as typeof folder)}>
              <SelectTrigger aria-label="Folder tujuan"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="SERVICE">Service request</SelectItem>
                <SelectItem value="KUNJUNGAN">Kunjungan toko</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Caption / keterangan (opsional, mis. #LAPOR …)</Label>
          <Input value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="#LAPOR SN-... PRT-... deskripsi…" className="font-mono text-xs" />
        </div>

        {preview && (
          <img src={preview} alt="Pratinjau upload" className={cn('rounded-lg border object-contain', thin ? 'max-h-40' : 'max-h-56')} />
        )}

        <Button className={cn('bg-sky-600 hover:bg-sky-700', thin ? 'h-8 w-full text-xs' : 'w-full')} disabled={!file || upMutation.isPending} onClick={() => upMutation.mutate()}>
          {upMutation.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <ScanText className="mr-1.5 h-4 w-4" />}
          Simpan &amp; Baca Foto
        </Button>

        {hasil && (
          <div className={cn('space-y-1.5 rounded-lg border border-emerald-300 bg-emerald-50/50 text-xs', thin ? 'p-2.5' : 'p-3')}>
            <p className="flex items-center gap-1 font-semibold text-emerald-800"><CheckCircle2 className="h-3.5 w-3.5" /> Hasil bacaan tersimpan di Inbox</p>
            {hasil.barcode ? (
              <p className="font-mono text-[11px] text-slate-800"><Barcode className="mr-1 inline h-3.5 w-3.5 text-emerald-600" />{hasil.barcode}{hasil.barcodeFormat ? ` (${hasil.barcodeFormat})` : ''}</p>
            ) : (
              <p className="text-slate-500">Barcode: tidak terdeteksi</p>
            )}
            {hasil.ocrText ? (
              <pre className="max-h-32 overflow-y-auto whitespace-pre-wrap rounded bg-white p-2 text-[11px] text-slate-700">{hasil.ocrText}</pre>
            ) : (
              <p className="text-slate-500">Teks OCR: tidak terbaca</p>
            )}
          </div>
        )}

        {!compact && (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-slate-700">Riwayat pindaian (50 terakhir)</p>
            {isLoading ? (
              <div className="space-y-2">{[0, 1].map((i) => <Skeleton key={i} className="h-16" />)}</div>
            ) : (riwayat ?? []).length === 0 ? (
              <p className="text-xs text-slate-400">Belum ada foto yang dipindai.</p>
            ) : (
              <div className="max-h-72 space-y-2 overflow-y-auto">
                {(riwayat ?? []).map((s) => (
                  <div key={s.id} className="flex items-center gap-2 rounded-lg border p-2">
                    <img src={visionFileUrl(s)} alt={`Pindaian ${s.id}`} className="h-12 w-12 shrink-0 rounded border object-cover" />
                    <div className="min-w-0 flex-1">
                      <p className={cn('truncate font-mono text-[11px]', s.barcode ? 'text-slate-800' : 'text-slate-400')}>
                        {s.barcode ?? s.caption ?? s.fileName}
                      </p>
                      <p className="text-[10px] text-slate-400">{s.pengirim} · {s.status}</p>
                    </div>
                    {s.caption && /#LAPOR/i.test(s.caption) && (
                      <Button size="sm" variant="outline" disabled={laporMutation.isPending} onClick={() => laporMutation.mutate(s.caption!)}>
                        <Send className="mr-1 h-3 w-3" /> Lapor
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
