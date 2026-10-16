'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { postJson } from '@/lib/api'
import { parseCsv, validateTokoRows, validateSparepartRows, validateUnitRows, validateBankKodeRows, CSV_MAX_ROWS, type ValidatedRow } from '@/lib/csv'
import { useAppStore } from '@/lib/store'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import {
  FileDown,
  FileUp,
  ClipboardPaste,
  CheckCircle2,
  XCircle,
  CircleAlert,
  UploadCloud,
  Loader2,
  ArrowLeft,
  ClipboardCheck,
  MinusCircle,
} from 'lucide-react'

export type ImportKind = 'toko' | 'sparepart' | 'unit' | 'bankkode'

export interface ImportResult {
  total: number
  inserted: number
  updated: number
  skipped: number
  failed: number
  errors: { row: number; kode: string; nama: string; message: string }[]
  skippedDetails?: { row: number; kode: string; nama: string; message: string }[]
}

interface CsvImportDialogProps {
  kind: ImportKind
  open: boolean
  onOpenChange: (open: boolean) => void
  existingCodes: string[]
  onSuccess?: (result: ImportResult) => void
}

const CONFIG: Record<
  ImportKind,
  {
    title: string
    description: string
    templateUrl: string
    apiUrl: string
    requiredCols: string[]
    optionalCols: string[]
    columns: { label: string; get: (r: ValidatedRow<unknown>) => string }[]
  }
> = {
  toko: {
    title: 'Import Massal Toko (CSV)',
    description: 'Registrasi banyak toko mitra sekaligus lewat file CSV — cocok untuk onboarding jaringan toko baru.',
    templateUrl: '/api/toko/import',
    apiUrl: '/api/toko/import',
    requiredCols: ['kode_toko', 'nama_toko'],
    optionalCols: ['alamat', 'kontak', 'frekuensi_visit'],
    columns: [
      { label: 'Kode', get: (r) => r.kode },
      { label: 'Nama Toko', get: (r) => r.nama },
      {
        label: 'Alamat',
        get: (r) => {
          const d = r.data as { insert?: { alamat?: string | null } } | undefined
          return d?.insert?.alamat || '—'
        },
      },
      {
        label: 'Kontak',
        get: (r) => {
          const d = r.data as { insert?: { kontak?: string | null } } | undefined
          return d?.insert?.kontak || '—'
        },
      },
      {
        label: 'Siklus',
        get: (r) => {
          const d = r.data as { insert?: { frekuensiVisit?: number } } | undefined
          return d?.insert?.frekuensiVisit ? `${d.insert.frekuensiVisit} hari` : '—'
        },
      },
    ],
  },
  sparepart: {
    title: 'Import Massal Sparepart (CSV)',
    description: 'Daftarkan banyak item sparepart inventory sekaligus — katalog stok langsung terisi.',
    templateUrl: '/api/sparepart/import',
    apiUrl: '/api/sparepart/import',
    requiredCols: ['kode_part', 'nama_part'],
    optionalCols: ['brand_kompatibel', 'supplier', 'stok_jual', 'stok_garansi', 'stok_inventory', 'reorder_limit', 'harga_klaim'],
    columns: [
      { label: 'Kode', get: (r) => r.kode },
      { label: 'Nama Part', get: (r) => r.nama },
      {
        label: 'Brand Kompatibel',
        get: (r) => {
          const d = r.data as { insert?: { brandKompatibel?: string } } | undefined
          return d?.insert?.brandKompatibel?.trim() || '—'
        },
      },
      {
        label: 'Supplier',
        get: (r) => {
          const d = r.data as { insert?: { supplier?: string } } | undefined
          return d?.insert?.supplier?.trim() || '—'
        },
      },
      {
        label: 'Jual',
        get: (r) => {
          const d = r.data as { insert?: { stokJual?: number } } | undefined
          return d?.insert?.stokJual != null ? String(d.insert.stokJual) : '—'
        },
      },
      {
        label: 'Garansi',
        get: (r) => {
          const d = r.data as { insert?: { stokGaransi?: number } } | undefined
          return d?.insert?.stokGaransi != null ? String(d.insert.stokGaransi) : '—'
        },
      },
      {
        label: 'ROP',
        get: (r) => {
          const d = r.data as { insert?: { reorderLimit?: number } } | undefined
          return d?.insert?.reorderLimit != null ? String(d.insert.reorderLimit) : '—'
        },
      },
      {
        label: 'Harga Klaim',
        get: (r) => {
          const d = r.data as { insert?: { hargaKlaim?: number } } | undefined
          return d?.insert?.hargaKlaim != null ? new Intl.NumberFormat('id-ID').format(d.insert.hargaKlaim) : '—'
        },
      },
    ],
  },
  bankkode: {
    title: 'Import Kode Produsen (CSV)',
    description: 'Catat banyak kode sparepart rumit rilis produsen sekaligus — bank kode langsung terisi dan siap dipanggil.',
    templateUrl: '/api/bank-kode/import',
    apiUrl: '/api/bank-kode/import',
    requiredCols: ['kode'],
    optionalCols: ['nama', 'brand', 'produsen', 'catatan'],
    columns: [
      { label: 'Kode', get: (r) => r.kode },
      {
        label: 'Nama',
        get: (r) => {
          const d = r.data as { insert?: { namaPart?: string } } | undefined
          return d?.insert?.namaPart?.trim() || '—'
        },
      },
      {
        label: 'Brand',
        get: (r) => {
          const d = r.data as { insert?: { brandKompatibel?: string } } | undefined
          return d?.insert?.brandKompatibel?.trim() || '—'
        },
      },
      {
        label: 'Produsen',
        get: (r) => {
          const d = r.data as { insert?: { produsen?: string } } | undefined
          return d?.insert?.produsen?.trim() || '—'
        },
      },
    ],
  },
  unit: {
    title: 'Import Massal Unit (CSV)',
    description: 'Registrasi banyak unit asset sekaligus per toko — cocok untuk pendataan stok toko baru.',
    templateUrl: '/api/unit/import',
    apiUrl: '/api/unit/import',
    requiredCols: ['nomor_seri', 'model_tipe'],
    optionalCols: ['tgl_input', 'toko_customer', 'merk', 'status', 'tgl_garansi', 'nama_unit', 'nama_customer'],
    columns: [
      {
        label: 'Tgl Input',
        get: (r) => {
          const d = r.data as { insert?: { tglInput?: Date | null } } | undefined
          const t = d?.insert?.tglInput
          return t ? new Date(t).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : 'otomatis'
        },
      },
      {
        label: 'Toko / Customer',
        get: (r) => {
          const d = r.data as { insert?: { tokoKey?: string; customerNama?: string } } | undefined
          return d?.insert?.tokoKey?.trim() || d?.insert?.customerNama?.trim() || '—'
        },
      },
      {
        label: 'Merk',
        get: (r) => {
          const d = r.data as { insert?: { merk?: string } } | undefined
          return d?.insert?.merk?.trim() || '—'
        },
      },
      {
        label: 'Model / Tipe',
        get: (r) => {
          const d = r.data as { insert?: { modelUnit?: string } } | undefined
          return d?.insert?.modelUnit?.trim() || r.nama || '—'
        },
      },
      { label: 'Nomor Seri', get: (r) => r.kode },
      {
        label: 'Status + Tgl Garansi',
        get: (r) => {
          const d = r.data as { insert?: { statusGaransi?: string; tglPembelian?: Date | null } } | undefined
          const s = d?.insert?.statusGaransi === 'NON_GARANSI' ? 'NON-GARANSI' : d?.insert?.statusGaransi === 'STOK_TOKO' ? 'STOK-TOKO' : 'GARANSI'
          const t = d?.insert?.tglPembelian
          return t ? `${s} · ${new Date(t).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}` : s
        },
      },
    ],
  },
}

type PreviewStatus = 'new' | 'update' | 'skip' | 'error'

export default function CsvImportDialog({ kind, open, onOpenChange, existingCodes, onSuccess }: CsvImportDialogProps) {
  const { toast } = useToast()
  const { role } = useAppStore()
  const config = CONFIG[kind]
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [stage, setStage] = useState<'input' | 'preview' | 'result'>('input')
  const [csvText, setCsvText] = useState('')
  const [pasteMode, setPasteMode] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [mode, setMode] = useState<'skip' | 'update'>('skip')
  const [result, setResult] = useState<ImportResult | null>(null)

  // Reset seluruh state saat dialog ditutup
  useEffect(() => {
    if (!open) {
      const t = setTimeout(() => {
        setStage('input')
        setCsvText('')
        setPasteMode(false)
        setDragOver(false)
        setMode('skip')
        setResult(null)
      }, 200)
      return () => clearTimeout(t)
    }
  }, [open])

  const parsed = useMemo(() => (csvText.trim() ? parseCsv(csvText) : null), [csvText])

  const validation = useMemo(() => {
    if (!parsed || parsed.rows.length === 0) return null
    if (kind === 'toko') return validateTokoRows(parsed.headers, parsed.rows)
    if (kind === 'unit') return validateUnitRows(parsed.headers, parsed.rows)
    if (kind === 'bankkode') return validateBankKodeRows(parsed.headers, parsed.rows)
    return validateSparepartRows(parsed.headers, parsed.rows)
  }, [parsed, kind])

  const previewRows = useMemo(() => {
    if (!validation) return []
    const existing = new Set(existingCodes)
    return validation.acc.map((a): ValidatedRow<unknown> & { preview: PreviewStatus } => {
      if (a.status === 'error') return { ...a, preview: 'error' }
      if (existing.has(a.kode)) return { ...a, preview: mode === 'update' ? 'update' : 'skip' }
      return { ...a, preview: 'new' }
    })
  }, [validation, existingCodes, mode])

  const counts = useMemo(() => {
    const c = { new: 0, update: 0, skip: 0, error: 0 }
    previewRows.forEach((r) => c[r.preview]++)
    return c
  }, [previewRows])

  const tooManyRows = (parsed?.rows.length ?? 0) > CSV_MAX_ROWS
  const readyCount = counts.new + counts.update

  const importMutation = useMutation({
    mutationFn: () => postJson<ImportResult>(config.apiUrl, { csvText, mode, aktor: role }),
    onSuccess: (data) => {
      setResult(data)
      setStage('result')
      onSuccess?.(data)
    },
    onError: (e: Error) => toast({ title: 'Import gagal', description: e.message, variant: 'destructive' }),
  })

  const readFile = (file: File) => {
    const isCsv = file.name.toLowerCase().endsWith('.csv') || file.type === 'text/csv' || file.type === 'application/vnd.ms-excel'
    if (!isCsv) {
      toast({ title: 'Format tidak didukung', description: 'Hanya file .csv yang dapat diimpor. Unduh template untuk melihat formatnya.', variant: 'destructive' })
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      toast({ title: 'File terlalu besar', description: 'Ukuran maksimal 5 MB. Pecah file menjadi beberapa bagian.', variant: 'destructive' })
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const text = String(reader.result ?? '')
      if (!text.trim()) {
        toast({ title: 'File kosong', description: 'File CSV tidak berisi data apa pun.', variant: 'destructive' })
        return
      }
      setCsvText(text)
      setPasteMode(false)
      toast({ title: 'File terbaca', description: `${file.name} siap diperiksa — klik "Periksa & Pratinjau".` })
    }
    reader.onerror = () => toast({ title: 'Gagal membaca file', variant: 'destructive' })
    reader.readAsText(file, 'utf-8')
  }

  const goPreview = () => {
    if (!csvText.trim()) {
      toast({ title: 'Belum ada data', description: 'Unggah file CSV atau tempel data terlebih dahulu.', variant: 'destructive' })
      return
    }
    setStage('preview')
  }

  const STATUS_BADGE: Record<PreviewStatus, { label: string; className: string }> = {
    new: { label: 'BARU', className: 'border-emerald-300 bg-emerald-50 text-emerald-700' },
    update: { label: 'PERBARUI', className: 'border-teal-300 bg-teal-50 text-teal-700' },
    skip: { label: 'LEWATI', className: 'border-slate-300 bg-slate-50 text-slate-500' },
    error: { label: 'ERROR', className: 'border-rose-300 bg-rose-50 text-rose-700' },
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{config.title}</DialogTitle>
          <DialogDescription>{config.description}</DialogDescription>
        </DialogHeader>

        {/* ===== Indikator tahap ===== */}
        <div className="flex items-center gap-2 text-[11px] font-medium text-slate-500" aria-label="Tahap import">
          {['1. Unggah', '2. Pratinjau', '3. Selesai'].map((s, i) => {
            const active = (stage === 'input' && i === 0) || (stage === 'preview' && i === 1) || (stage === 'result' && i === 2)
            return (
              <span key={s} className="flex items-center gap-2">
                {i > 0 && <span className="h-px w-4 bg-slate-300" aria-hidden />}
                <span className={cn('rounded-full px-2 py-0.5', active ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-400')}>
                  {s}
                </span>
              </span>
            )
          })}
        </div>

        {/* ===== TAHAP 1: INPUT ===== */}
        {stage === 'input' && (
          <div className="space-y-4">
            <Alert className="border-emerald-200 bg-emerald-50/70">
              <ClipboardCheck className="h-4 w-4 text-emerald-700" />
              <AlertTitle className="text-sm text-emerald-900">Format kolom yang dibutuhkan</AlertTitle>
              <AlertDescription className="text-xs text-emerald-800">
                <p className="mt-1">
                  <span className="font-semibold">Wajib:</span> {config.requiredCols.join(', ')} · <span className="font-semibold">Opsional:</span>{' '}
                  {config.optionalCols.join(', ')}
                </p>
                <p className="mt-1">
                  Delimiter koma (,) atau titik-koma (;) didukung otomatis. Kolom boleh ditulis dengan variasi nama (mis. &quot;Kode Toko&quot;,
                  &quot;KODE_TOKO&quot;). Kode yang sudah terdaftar akan mengikuti mode di bawah.
                </p>
                <a
                  href={config.templateUrl}
                  download
                  className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-[11px] font-semibold text-white transition-colors hover:bg-emerald-700"
                >
                  <FileDown className="h-3.5 w-3.5" /> Unduh Template CSV
                </a>
              </AlertDescription>
            </Alert>

            {!pasteMode ? (
              <>
                <div
                  role="button"
                  tabIndex={0}
                  aria-label="Unggah file CSV"
                  onClick={() => fileInputRef.current?.click()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      fileInputRef.current?.click()
                    }
                  }}
                  onDragOver={(e) => {
                    e.preventDefault()
                    setDragOver(true)
                  }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(e) => {
                    e.preventDefault()
                    setDragOver(false)
                    const f = e.dataTransfer.files?.[0]
                    if (f) readFile(f)
                  }}
                  className={cn(
                    'flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-8 text-center transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-500',
                    dragOver ? 'border-emerald-500 bg-emerald-50' : 'border-slate-300 bg-slate-50/50 hover:border-emerald-400 hover:bg-emerald-50/50'
                  )}
                >
                  <UploadCloud className={cn('h-9 w-9', dragOver ? 'text-emerald-600' : 'text-slate-400')} />
                  <p className="mt-2 text-sm font-medium text-slate-700">Tarik &amp; letakkan file CSV di sini</p>
                  <p className="text-xs text-slate-500">atau klik untuk memilih file (.csv, maks 5 MB / {CSV_MAX_ROWS.toLocaleString('id-ID')} baris)</p>
                  {csvText && (
                    <Badge variant="outline" className="mt-3 border-emerald-300 bg-emerald-50 text-emerald-700">
                      <FileUp className="mr-1 h-3 w-3" /> File dimuat — siap diperiksa
                    </Badge>
                  )}
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  aria-hidden
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) readFile(f)
                    e.target.value = ''
                  }}
                />
                <button
                  type="button"
                  onClick={() => setPasteMode(true)}
                  className="mx-auto flex items-center gap-1 text-xs font-medium text-emerald-700 underline-offset-2 hover:underline"
                >
                  <ClipboardPaste className="h-3.5 w-3.5" /> atau tempel data CSV langsung
                </button>
              </>
            ) : (
              <div className="space-y-1.5">
                <Label htmlFor="csv-paste">Tempel data CSV (baris pertama = header)</Label>
                <Textarea
                  id="csv-paste"
                  value={csvText}
                  onChange={(e) => setCsvText(e.target.value)}
                  placeholder={'kode_toko;nama_toko;alamat;kontak;frekuensi_visit\nTOK-201;Toko Barokah;Jl. Kenanga 5;081200011122;14'}
                  rows={7}
                  className="font-mono text-xs"
                />
                <button
                  type="button"
                  onClick={() => {
                    setPasteMode(false)
                    setCsvText('')
                  }}
                  className="flex items-center gap-1 text-xs font-medium text-slate-500 underline-offset-2 hover:underline"
                >
                  <UploadCloud className="h-3.5 w-3.5" /> kembali ke mode unggah file
                </button>
              </div>
            )}

            <div className="space-y-2">
              <Label>Mode import untuk kode yang sudah terdaftar</Label>
              <RadioGroup value={mode} onValueChange={(v) => setMode(v as 'skip' | 'update')} className="grid gap-2 sm:grid-cols-2">
                <div className={cn('flex cursor-pointer items-start gap-2 rounded-lg border p-3 transition-colors', mode === 'skip' ? 'border-emerald-400 bg-emerald-50/60' : 'border-slate-200')}>
                  <RadioGroupItem value="skip" id="mode-skip" className="mt-0.5" />
                  <Label htmlFor="mode-skip" className="cursor-pointer space-y-0.5 font-normal">
                    <span className="block text-xs font-semibold text-slate-800">Lewati yang sudah ada</span>
                    <span className="block text-[11px] text-slate-500">Hanya kode baru yang ditambahkan, data lama tidak disentuh (aman).</span>
                  </Label>
                </div>
                <div className={cn('flex cursor-pointer items-start gap-2 rounded-lg border p-3 transition-colors', mode === 'update' ? 'border-teal-400 bg-teal-50/60' : 'border-slate-200')}>
                  <RadioGroupItem value="update" id="mode-update" className="mt-0.5" />
                  <Label htmlFor="mode-update" className="cursor-pointer space-y-0.5 font-normal">
                    <span className="block text-xs font-semibold text-slate-800">Perbarui yang sudah ada</span>
                    <span className="block text-[11px] text-slate-500">Data lama dioverwrite dari CSV. Kolom kosong tidak diubah.</span>
                  </Label>
                </div>
              </RadioGroup>
            </div>
          </div>
        )}

        {/* ===== TAHAP 2: PRATINJAU ===== */}
        {stage === 'preview' && validation && (
          <div className="space-y-3">
            {validation.headerError && (
              <Alert variant="destructive">
                <CircleAlert className="h-4 w-4" />
                <AlertTitle className="text-sm">Header CSV tidak sesuai</AlertTitle>
                <AlertDescription className="text-xs">{validation.headerError}</AlertDescription>
              </Alert>
            )}
            {!validation.headerError && (
              <>
                <div className="flex flex-wrap items-center gap-2 text-[11px]">
                  <Badge variant="outline" className="border-emerald-300 bg-emerald-50 text-emerald-700"><CheckCircle2 className="mr-1 h-3 w-3" /> {counts.new} baru</Badge>
                  {counts.update > 0 && <Badge variant="outline" className="border-teal-300 bg-teal-50 text-teal-700"><CheckCircle2 className="mr-1 h-3 w-3" /> {counts.update} diperbarui</Badge>}
                  {counts.skip > 0 && <Badge variant="outline" className="border-slate-300 bg-slate-50 text-slate-500">{counts.skip} dilewati</Badge>}
                  {counts.error > 0 && <Badge variant="destructive"><XCircle className="mr-1 h-3 w-3" /> {counts.error} error</Badge>}
                  <span className="ml-auto text-slate-400">{parsed?.rows.length ?? 0} baris terbaca</span>
                </div>

                <div className="max-h-72 overflow-auto rounded-lg border">
                  <Table>
                    <TableHeader className="sticky top-0 z-10 bg-slate-50">
                      <TableRow>
                        <TableHead className="w-10 text-[10px]">#</TableHead>
                        {config.columns.map((c) => (
                          <TableHead key={c.label} className="text-[10px]">{c.label}</TableHead>
                        ))}
                        <TableHead className="text-[10px]">Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {previewRows.map((r) => {
                        const sb = STATUS_BADGE[r.preview]
                        return (
                          <TableRow key={r.row} className={cn(r.preview === 'error' && 'bg-rose-50/60')}>
                            <TableCell className="text-[10px] text-slate-400">{r.row}</TableCell>
                            {config.columns.map((c) => (
                              <TableCell key={c.label} className="max-w-36 truncate text-xs text-slate-700">
                                {r.preview === 'error' ? '—' : c.get(r)}
                              </TableCell>
                            ))}
                            <TableCell>
                              <Badge variant="outline" className={cn('text-[9px]', sb.className)} title={r.message ?? undefined}>
                                {sb.label}
                              </Badge>
                              {r.preview === 'error' && r.message && (
                                <p className="mt-0.5 max-w-52 text-[10px] leading-tight text-rose-600">{r.message}</p>
                              )}
                            </TableCell>
                          </TableRow>
                        )
                      })}
                      {previewRows.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={config.columns.length + 2} className="py-8 text-center text-xs text-slate-400">
                            Tidak ada baris data yang terbaca dari CSV.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </>
            )}
          </div>
        )}

        {/* ===== TAHAP 3: HASIL ===== */}
        {stage === 'result' && result && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { label: 'Ditambahkan', value: result.inserted, cls: 'text-emerald-700 bg-emerald-50 border-emerald-200' },
                { label: 'Diperbarui', value: result.updated, cls: 'text-teal-700 bg-teal-50 border-teal-200' },
                { label: 'Dilewati', value: result.skipped, cls: 'text-slate-600 bg-slate-50 border-slate-200' },
                { label: 'Gagal', value: result.failed, cls: 'text-rose-700 bg-rose-50 border-rose-200' },
              ].map((s) => (
                <div key={s.label} className={cn('rounded-xl border p-3 text-center', s.cls)}>
                  <p className="text-2xl font-bold">{s.value}</p>
                  <p className="text-[11px] font-medium">{s.label}</p>
                </div>
              ))}
            </div>

            <p className="text-center text-xs text-slate-500">
              Dari <span className="font-semibold text-slate-700">{result.total}</span> baris CSV · mode{' '}
              <span className="font-semibold text-slate-700">{mode === 'skip' ? 'lewati yang sudah ada' : 'perbarui yang sudah ada'}</span>
            </p>

            {result.skipped > 0 && (result.skippedDetails ?? []).length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-semibold text-slate-700">Detail baris dilewati ({result.skipped}):</p>
                <div className="max-h-36 space-y-1.5 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50/70 p-2.5">
                  {(result.skippedDetails ?? []).map((e, i) => (
                    <div key={i} className="flex items-start gap-2 text-[11px]">
                      <MinusCircle className="mt-0.5 h-3 w-3 shrink-0 text-slate-400" />
                      <p className="text-slate-600">
                        <span className="font-mono font-semibold">Baris {e.row}</span>
                        {e.kode ? <span className="font-mono"> ({e.kode})</span> : null} — {e.message}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {result.errors.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-semibold text-slate-700">Detail baris gagal ({result.errors.length}):</p>
                <div className="max-h-44 space-y-1.5 overflow-y-auto rounded-lg border border-rose-200 bg-rose-50/50 p-2.5">
                  {result.errors.map((e, i) => (
                    <div key={i} className="flex items-start gap-2 text-[11px]">
                      <XCircle className="mt-0.5 h-3 w-3 shrink-0 text-rose-500" />
                      <p className="text-slate-700">
                        <span className="font-mono font-semibold">Baris {e.row}</span>
                        {e.kode ? <span className="font-mono"> ({e.kode})</span> : null} — {e.message}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {result.inserted + result.updated > 0 && (
              <Alert className="border-emerald-200 bg-emerald-50/70">
                <CheckCircle2 className="h-4 w-4 text-emerald-700" />
                <AlertTitle className="text-sm text-emerald-900">Import berhasil dicatat</AlertTitle>
                <AlertDescription className="text-xs text-emerald-800">
                  Aktivitas ini tercatat pada Audit Log (Modul 6) dan seluruh data terkait (dashboard, alert) telah diperbarui.
                </AlertDescription>
              </Alert>
            )}
          </div>
        )}

        {/* ===== Footer aksi ===== */}
        <DialogFooter className="gap-2">
          {stage === 'input' && (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Batal</Button>
              <Button
                className="bg-emerald-600 hover:bg-emerald-700"
                disabled={!csvText.trim() || tooManyRows || importMutation.isPending}
                onClick={goPreview}
              >
                <ClipboardCheck className="mr-1 h-4 w-4" /> Periksa &amp; Pratinjau
              </Button>
            </>
          )}
          {stage === 'preview' && (
            <>
              <Button variant="outline" onClick={() => setStage('input')} disabled={importMutation.isPending}>
                <ArrowLeft className="mr-1 h-4 w-4" /> Kembali
              </Button>
              <Button
                className="bg-emerald-600 hover:bg-emerald-700"
                disabled={!!validation?.headerError || readyCount === 0 || importMutation.isPending || tooManyRows}
                onClick={() => importMutation.mutate()}
              >
                {importMutation.isPending ? (
                  <>
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" /> Mengimpor…
                  </>
                ) : (
                  <>
                    <UploadCloud className="mr-1 h-4 w-4" /> Import {readyCount} Data
                  </>
                )}
              </Button>
            </>
          )}
          {stage === 'result' && (
            <Button className="ml-auto bg-emerald-600 hover:bg-emerald-700" onClick={() => onOpenChange(false)}>
              Selesai
            </Button>
          )}
        </DialogFooter>

        {tooManyRows && (
          <p className="text-center text-[11px] font-medium text-rose-600">
            File melebihi batas {CSV_MAX_ROWS.toLocaleString('id-ID')} baris — pecah menjadi beberapa file.
          </p>
        )}
      </DialogContent>
    </Dialog>
  )
}
