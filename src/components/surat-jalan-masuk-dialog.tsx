'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useToast } from '@/hooks/use-toast'
import { useAppStore } from '@/lib/store'
import { fetcher, postJson, authHeaders, formatTanggal, formatWaktu, type SJKandidat, type SJPreview, type SJRingkasan, type SJRiwayat, type SJCekHasil, type SJDraftDetail, type SJAnalisaHasil } from '@/lib/api'
import { CheckCircle2, Download, Loader2, Search, Truck, Sparkles } from 'lucide-react'

/**
 * Dialog Surat Jalan Masuk — penerimaan part dari produsen dengan CEK BERLAPIS:
 * uraikan Excel → Simpan Draft (tanpa efek) → Cek Otomatis (+ opsi Cek Manual
 * per baris) → Cek Akhir → Terapkan Permanen. Komponen mandiri (dipasang di
 * bagian Analisa AI); parent hanya mengatur open/onOpenChange.
 */
export default function SuratJalanMasukDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { toast } = useToast()
  const { role } = useAppStore()
  const queryClient = useQueryClient()
  const aktor = role === 'TEKNISI' ? 'Teknisi Lapangan' : 'Admin Workshop'
  const [sjFile, setSjFile] = useState<File | null>(null)
  const [sjMeta, setSjMeta] = useState({ noSuratJalan: '', tglSurat: '', produsen: '', refSjrNo: '' })
  // Hasil cross-check bila kiriman mengisi referensi request SJR-… — strip
  // informasi "part request mana yang benar-benar sudah dikirim". Hanya
  // informatif: cek manual (periksa → terapkan) tetap wajib dijalankan.
  const [sjRefInfo, setSjRefInfo] = useState<{ noSjr: string; totalItem: number; terpenuhi: number; belum: { noTiket: string; kodePart: string; namaPart: string }[] } | null>(null)
  const [sjPreview, setSjPreview] = useState<SJPreview | null>(null)
  const [sjPilih, setSjPilih] = useState<Record<number, string>>({}) // baris → key kandidat pilihan user
  const [sjGunakanAi, setSjGunakanAi] = useState(true)
  // Alur cek berlapis: INPUT (uraikan Excel) → DRAFT (simpan → cek otomatis/manual → cek akhir → terapkan)
  const [sjMode, setSjMode] = useState<'INPUT' | 'DRAFT'>('INPUT')
  const [sjDraftId, setSjDraftId] = useState<number | null>(null)
  const [sjCekManual, setSjCekManual] = useState(false)
  const [sjTicks, setSjTicks] = useState<Record<number, boolean>>({})
  const [sjCek, setSjCek] = useState<SJCekHasil | null>(null)
  const [sjCekAkhir, setSjCekAkhir] = useState(false)
  // Hasil "Analisa AI — Kirim vs Terima" (tombol manual, bukan otomatis):
  // pembanding draft ini vs dokumen SJR yang dikirim ke produsen + saran
  // penautan baris salah ketik OCR. Murni display — saran diterima manual.
  const [sjAnalisa, setSjAnalisa] = useState<SJAnalisaHasil | null>(null)
  const sjNrm = (s: string) => (s || '').toUpperCase().replace(/[^A-Z0-9#]/g, '')
  // Label ramah untuk status alur cek berlapis (nilai DB tetap DRAFT/DIPERIKSA/DITERAPKAN).
  const SJ_LABEL: Record<string, string> = { DRAFT: 'DRAF', DIPERIKSA: 'SUDAH DICEK', DITERAPKAN: 'PART DITERIMA' }

  // Tutup dialog: kembalikan ke mode input & bersihkan seluruh status wizard.
  const tutup = (o: boolean) => {
    onOpenChange(o)
    if (!o) {
      setSjPreview(null); setSjFile(null); setSjPilih({}); setSjCek(null); setSjCekAkhir(false); setSjTicks({}); setSjDraftId(null); setSjMode('INPUT'); setSjCekManual(false); setSjRefInfo(null); setSjAnalisa(null); setSjMeta({ noSuratJalan: '', tglSurat: '', produsen: '', refSjrNo: '' })
    }
  }

  // Efek terapkan mengubah tiket/part/stok → segarkan view yang menampilkan data itu.
  const invalidasiLuas = () => {
    for (const k of ['service-tickets', 'spareparts', 'dashboard', 'alerts', 'audit', 'claims', 'order-email']) {
      queryClient.invalidateQueries({ queryKey: [k] })
    }
  }

  const sjMatchMutation = useMutation({
    mutationFn: () => {
      if (!sjFile) throw new Error('Pilih file Excel/CSV surat jalan dulu')
      const fd = new FormData()
      fd.append('file', sjFile)
      fd.append('useAi', String(sjGunakanAi))
      return fetch('/api/surat-jalan/match', { method: 'POST', headers: authHeaders(), body: fd }).then(async (res) => {
        const j = (await res.json().catch(() => ({}))) as (SJPreview & { error?: string })
        if (!res.ok) throw new Error(j.error || `Gagal menguraikan file (${res.status})`)
        return j
      })
    },
    onSuccess: (p) => {
      setSjPreview(p)
      setSjPilih({})
      setSjMeta((m) => ({
        ...m,
        noSuratJalan: p.noSuratJalan || m.noSuratJalan,
        tglSurat: p.tglSurat ? new Date(p.tglSurat).toISOString().slice(0, 10) : m.tglSurat,
        produsen: p.produsen || m.produsen,
      }))
      toast({
        title: `Surat jalan teruraikan — ${p.cocokCount} dari ${p.items.length} baris otomatis cocok`,
        description: p.dibantuAi > 0 ? `${p.dibantuAi} baris dicocokkan AI. Periksa hasil → Simpan Draft → cek berlapis.` : 'Preview hanya baca — Simpan Draft lalu lewati cek berlapis sebelum diterapkan.',
      })
    },
    onError: (e: Error) => toast({ title: 'Gagal menguraikan surat jalan', description: e.message, variant: 'destructive' }),
  })

  // Templat Excel resmi Surat Jalan Masuk — dibuat muka di browser (SheetJS)
  // agar pengisian intake selalu cocok dengan parser (kepala tabel + alias kolom).
  const unduhTemplat = async () => {
    const X = await import('xlsx')
    const isi = [
      ['KODE PART', 'NAMA PART', 'QTY', 'SN UNIT'],
      ['WD-6200', 'Impeller Pompa', 1, '02100056000'],
      ['FK-2200', 'Filter Kapasitor', 2, ''],
    ]
    const petunjuk = [
      ['TEMPLATE SURAT JALAN MASUK — penerimaan part dari produsen'],
      [''],
      ['1. Isi baris item di sheet "SURAT JALAN" mulai baris ke-2, lalu hapus baris contoh (WD-6200/FK-2200).'],
      ['2. KODE PART wajib; NAMA PART, QTY (angka, kosong = 1), SN UNIT opsional (serial unit tujuan).'],
      ['3. Nama kolom lain yang juga dikenali parser: kode/no part/part number/kode item · nama/deskripsi/item · qty/jumlah/pcs · sn/serial/no seri/unit.'],
      ['4. No Surat Jalan, Tanggal, dan Produsen diisi pada FORM dialog (bukan di file).'],
      ['5. Simpan sbg .xlsx/.xls/.csv lalu unggah di dialog Surat Jalan Masuk → Uraikan & Cocokkan.'],
    ]
    const wb = X.utils.book_new()
    const ws = X.utils.aoa_to_sheet(isi)
    ws['!cols'] = [{ wch: 14 }, { wch: 26 }, { wch: 8 }, { wch: 16 }]
    X.utils.book_append_sheet(wb, ws, 'SURAT JALAN')
    const ws2 = X.utils.aoa_to_sheet(petunjuk)
    ws2['!cols'] = [{ wch: 120 }]
    X.utils.book_append_sheet(wb, ws2, 'PETUNJUK')
    X.writeFile(wb, 'templat-surat-jalan-masuk.xlsx')
  }

  const sjApplyMutation = useMutation({
    // SIMPAN DRAFT — tanpa efek ke tiket/unit; lanjut: cek berlapis → cek akhir → terapkan.
    mutationFn: () =>
      postJson<{ ok: boolean; id: number; status: string; totalItem: number; cocokCount: number; tanpaTiket: number; refInfo: { noSjr: string; totalItem: number; terpenuhi: number; belum: { noTiket: string; kodePart: string; namaPart: string }[] } | null }>('/api/surat-jalan', {
        noSuratJalan: sjMeta.noSuratJalan.trim() || new Date().toISOString().slice(0, 10).replace(/-/g, ''),
        tglSurat: sjMeta.tglSurat || null,
        produsen: sjMeta.produsen.trim() || null,
        refSjrNo: sjMeta.refSjrNo.trim() || undefined,
        namaFile: sjPreview?.namaFile,
        aktor,
        rows: (sjPreview?.items ?? []).map((b, i) => ({
          kodePart: b.kodePart,
          namaPart: b.namaPart,
          qty: b.qty,
          serialNumber: b.serialNumber,
          pilihKey: sjPilih[i] || b.cocokKey || '',
        })),
      }),
    onSuccess: (r) => {
      invalidasiLuas()
      setSjMode('DRAFT')
      setSjDraftId(r.id)
      setSjCek(null)
      setSjCekAkhir(false)
      setSjCekManual(false)
      setSjTicks({})
      setSjPreview(null)
      setSjFile(null)
      setSjPilih({})
      setSjRefInfo(r.refInfo)
      setSjMeta({ noSuratJalan: '', tglSurat: '', produsen: '', refSjrNo: '' })
      toast({
        title: `Draft ${r.totalItem} baris tersimpan (belum berpengaruh)`,
        description: r.refInfo
          ? `Ref ${r.refInfo.noSjr}: ${r.refInfo.terpenuhi}/${r.refInfo.totalItem} part request ada di kiriman ini. Lanjutkan: Cek Berlapis → Cek Akhir → Terapkan.`
          : 'Lanjutkan: Cek Berlapis → Cek Akhir → Terapkan Permanen. Draft tidak mengubah tiket/unit apa pun.',
      })
    },
    onError: (e: Error) => toast({ title: 'Gagal menyimpan draft surat jalan', description: e.message, variant: 'destructive' }),
  })
  const sjDetailQuery = useQuery<SJDraftDetail>({
    queryKey: ['surat-jalan-detail', sjDraftId],
    queryFn: () => fetcher<SJDraftDetail>(`/api/surat-jalan/${sjDraftId}`),
    enabled: sjMode === 'DRAFT' && sjDraftId != null,
  })
  const sjDraft = sjDetailQuery.data ?? null
  const sjPeriksaMutation = useMutation({
    // Cek berlapis: duplikat nomor + validasi silang tiap baris (tiket aktif,
    // penerimaan ganda, SN unit, katalog) — tidak menulis apa pun ke tiket.
    mutationFn: (params: { cekManual: boolean }) => postJson<SJCekHasil>(`/api/surat-jalan/${sjDraftId}/periksa`, { cekManual: params.cekManual, aktor }),
    onSuccess: (h, params) => {
      setSjCek(h)
      setSjCekAkhir(false)
      void queryClient.invalidateQueries({ queryKey: ['surat-jalan-detail', sjDraftId] })
      queryClient.invalidateQueries({ queryKey: ['surat-jalan'] })
      toast({
        title: h.bisaTerapkan ? `Cek ${params.cekManual ? '(manual) ' : ''}selesai — belum ada blokir` : `Cek menemukan ${h.blokir} masalah blokir`,
        description: `${h.blokir} blokir · ${h.peringatan} peringatan · ${h.info} info${h.bisaTerapkan ? '. Lanjut Cek Akhir.' : '. Perbaiki baris bermasalah dulu.'}`,
        variant: h.bisaTerapkan ? 'default' : 'destructive',
      })
    },
    onError: (e: Error) => toast({ title: 'Gagal menjalankan cek', description: e.message, variant: 'destructive' }),
  })
  const sjItemMutation = useMutation({
    // Koreksi/tautan tiket satu baris draft (cek manual/fix blokir) ATAU
    // menerima saran AI (asalSaran='AI' — kode OCR salah ketik dibereskan).
    mutationFn: (params: { itemId: number; pilihKey: string; asalSaran?: string; alasanSaran?: string }) => postJson<{ ok: boolean }>(`/api/surat-jalan/${sjDraftId}/item`, { ...params, aktor }),
    onSuccess: (_r, params) => {
      setSjCek(null) // cek harus diulang setelah koreksi
      setSjCekAkhir(false)
      if (params.asalSaran === 'AI') {
        // Saran sudah dieksekusi — keluarkan dari panel analisa.
        setSjAnalisa((a) => (a ? { ...a, saran: a.saran.filter((s) => s.terimaId !== params.itemId), ringkasan: { ...a.ringkasan, saran: Math.max(0, a.ringkasan.saran - 1) } } : a))
      }
      void queryClient.invalidateQueries({ queryKey: ['surat-jalan-detail', sjDraftId] })
      queryClient.invalidateQueries({ queryKey: ['surat-jalan'] })
    },
    onError: (e: Error) => toast({ title: 'Gagal mengubah baris', description: e.message, variant: 'destructive' }),
  })
  const sjAnalisaMutation = useMutation({
    // ANALISA AI KIRIM vs TERIMA: bandingkan draft ini dengan dokumen SJR yang
    // dikirim ke produsen + saran penautan untuk baris OCR salah ketik.
    // TIDAK menulis database — hasil hanya display untuk cek manual.
    mutationFn: () => postJson<SJAnalisaHasil>(`/api/surat-jalan/${sjDraftId}/analisa`, {}),
    onSuccess: (a) => {
      setSjAnalisa(a)
      toast({
        title: a.saran.length > 0 ? `Analisa selesai — ${a.saran.length} saran penautan` : 'Analisa selesai',
        description: `${a.ringkasan.sama} sama · ${a.ringkasan.bedaQty} beda qty · ${a.ringkasan.belumDiterima} belum diterima · ${a.ringkasan.tanpaKirim} tanpa kirim. Tidak ada data yang diubah.`,
      })
    },
    onError: (e: Error) => toast({ title: 'Gagal menjalankan analisa', description: e.message, variant: 'destructive' }),
  })
  const sjTerapkanMutation = useMutation({
    // CEK AKHIR + TERAPKAN PERMANEN: server menjalankan cek ulang & menolak bila blokir.
    mutationFn: () =>
      postJson<SJRingkasan>(`/api/surat-jalan/${sjDraftId}/terapkan`, {
        aktor,
        sudahCekManual: sjCekManual && sjDraft?.items.every((i) => sjTicks[i.id]) === true ? true : undefined,
      }),
    onSuccess: (r) => {
      invalidasiLuas()
      queryClient.invalidateQueries({ queryKey: ['surat-jalan-detail', sjDraftId] })
      queryClient.invalidateQueries({ queryKey: ['surat-jalan'] })
      setSjCek(null)
      setSjCekAkhir(false)
      toast({
        title: `Surat jalan ${r.noSuratJalan} DITERAPKAN PERMANEN`,
        description: `${r.cocokCount} dari ${r.totalItem} baris cocok${r.tanpaTiket ? ` · ${r.tanpaTiket} tanpa tiket (tercatat)` : ''}${r.naikProses ? ` · ${r.naikProses} tiket otomatis naik PROSES` : ''}.`,
      })
    },
    onError: (e: Error) => toast({ title: 'Cek akhir menolak — tidak diterapkan', description: e.message, variant: 'destructive' }),
  })
  const sjHapusMutation = useMutation({
    mutationFn: (id: number) => fetch(`/api/surat-jalan/${id}`, { method: 'DELETE', headers: authHeaders() }).then(async (res) => {
      if (!res.ok) throw new Error(`Gagal menghapus (${res.status})`)
      return res.json()
    }),
    onSuccess: () => {
      if (sjDraftId) { setSjDraftId(null); setSjMode('INPUT'); setSjAnalisa(null) }
      queryClient.invalidateQueries({ queryKey: ['surat-jalan'] })
      toast({ title: 'Draft surat jalan dihapus' })
    },
    onError: (e: Error) => toast({ title: 'Gagal menghapus draft', description: e.message, variant: 'destructive' }),
  })
  // Riwayat surat jalan masuk (diambil hanya saat dialog terbuka)
  const { data: sjRiwayat } = useQuery<SJRiwayat[]>({
    queryKey: ['surat-jalan'],
    queryFn: () => fetcher<SJRiwayat[]>('/api/surat-jalan'),
    enabled: open,
  })

  return (
    <Dialog open={open} onOpenChange={tutup}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Surat Jalan Masuk — Penerimaan Part Produsen</DialogTitle>
          <DialogDescription>
            <b>Cek berlapis</b>: uraikan Excel → <b>Simpan Draft</b> (tidak berpengaruh apa pun) → <b>Cek Otomatis</b>
            {' '}+ opsi <b>Cek Manual per baris</b> → <b>Cek Akhir</b>. Efek ke tiket/unit hanya saat <b>Terapkan Permanen</b>.
          </DialogDescription>
        </DialogHeader>

        {/* Strip cross-check: part request yang benar-benar sudah dikirim produsen */}
        {sjRefInfo && sjMode === 'DRAFT' && (
          <div className="rounded-lg border border-teal-200 bg-teal-50 px-3 py-2 text-[11px] text-teal-900">
            <p className="flex flex-wrap items-center gap-1 font-semibold">
              <Truck className="h-3.5 w-3.5" /> Cross-check {sjRefInfo.noSjr}
              <Badge variant="outline" className="border-teal-300 text-[9px] text-teal-700">
                {sjRefInfo.terpenuhi}/{sjRefInfo.totalItem} part request ada di kiriman ini
              </Badge>
            </p>
            {sjRefInfo.belum.length > 0 && (
              <p className="mt-1 text-teal-800">
                <span className="font-semibold">{sjRefInfo.belum.length} belum dikirim</span> (produsen tidak selalu
                mengirim semuanya): {sjRefInfo.belum.slice(0, 6).map((b) => `${b.kodePart} (${b.noTiket})`).join(' · ')}
                {sjRefInfo.belum.length > 6 ? ' …' : ''}
              </p>
            )}
          </div>
        )}

        {sjMode === 'INPUT' && (
          <div className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-3">
              <div className="space-y-1"><Label>No Surat Jalan</Label><Input value={sjMeta.noSuratJalan} onChange={(e) => setSjMeta({ ...sjMeta, noSuratJalan: e.target.value })} placeholder="mis. SJ-20261018-112" /></div>
              <div className="space-y-1"><Label>Tanggal Surat</Label><Input type="date" value={sjMeta.tglSurat} onChange={(e) => setSjMeta({ ...sjMeta, tglSurat: e.target.value })} /></div>
              <div className="space-y-1"><Label>Produsen</Label><Input value={sjMeta.produsen} onChange={(e) => setSjMeta({ ...sjMeta, produsen: e.target.value })} placeholder="mis. SANY" /></div>
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] text-slate-600">Referensi Request (SJR-…) — opsional</Label>
              <Input
                value={sjMeta.refSjrNo}
                onChange={(e) => setSjMeta({ ...sjMeta, refSjrNo: e.target.value })}
                placeholder="mis. SJR-20261020-0001"
                className="h-8 font-mono text-xs"
              />
              <p className="text-[10px] leading-relaxed text-slate-500">
                Tempel nomor SJR dari surat jalan <b>request part</b> yang pernah diunduh — sistem otomatis menandai
                part request yang benar-benar sudah dikirim vs yang belum (produsen sering tidak mengirim semuanya
                sekaligus). Cek manual per baris tetap wajib.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={(e) => { setSjFile(e.target.files?.[0] ?? null); setSjPreview(null) }}
                aria-label="File surat jalan Excel/CSV"
                className="w-full cursor-pointer rounded-md border border-dashed border-slate-300 p-2 text-xs file:mr-2 file:cursor-pointer file:rounded file:border-0 file:bg-slate-100 file:px-2 file:py-1 file:text-xs sm:flex-1"
              />
              <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-slate-600">
                <Checkbox className="h-3.5 w-3.5" checked={sjGunakanAi} onCheckedChange={(c) => setSjGunakanAi(c === true)} aria-label="Gunakan AI untuk baris yang belum cocok" />
                Bantuan AI untuk baris belum cocok
              </label>
              <Button
                size="sm" variant="outline"
                className="h-8 border-indigo-300 px-2 text-[11px] text-indigo-700 hover:bg-indigo-50"
                onClick={() => { unduhTemplat().catch((e) => toast({ title: 'Gagal menyiapkan templat', description: String(e), variant: 'destructive' })) }}
              >
                <Download className="mr-1 h-3.5 w-3.5" /> Unduh Templat Excel
              </Button>
              <Button size="sm" className="bg-indigo-600 hover:bg-indigo-700" disabled={!sjFile || sjMatchMutation.isPending} onClick={() => sjMatchMutation.mutate()}>
                {sjMatchMutation.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Truck className="mr-1 h-4 w-4" />} Uraikan &amp; Cocokkan
              </Button>
            </div>
            {sjPreview && (
              <div className="rounded-lg border">
                <div className="border-b bg-slate-50 px-3 py-1.5 text-[11px] text-slate-600">
                  {sjPreview.items.length} baris · <b className="text-emerald-700">{sjPreview.cocokCount} cocok</b>
                  {sjPreview.items.length - sjPreview.cocokCount > 0 && <> · <b className="text-amber-700">{sjPreview.items.length - sjPreview.cocokCount} tanpa tiket (tetap tercatat)</b></>}
                  {sjPreview.dibantuAi > 0 && <> · {sjPreview.dibantuAi} dibantu AI</>}
                  {sjPreview.terlewati > 0 && <> · {sjPreview.terlewati} baris dilewati</>}
                </div>
                <div className="max-h-60 overflow-y-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-[11px]">Kode</TableHead>
                        <TableHead className="text-[11px]">Nama</TableHead>
                        <TableHead className="text-[11px]">Qty</TableHead>
                        <TableHead className="text-[11px]">SN Unit</TableHead>
                        <TableHead className="text-[11px]">Hasil</TableHead>
                        <TableHead className="text-[11px]">Tiket</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sjPreview.items.map((b, i) => {
                        const kand: SJKandidat | undefined = [...(b.cocokCand ? [b.cocokCand] : []), ...b.opsi].find((k) => k.key === (sjPilih[i] || b.cocokKey))
                        return (
                          <TableRow key={i}>
                            <TableCell className="font-mono text-[11px]" title={b.keterangan || undefined}>{b.kodePart}</TableCell>
                            <TableCell className="max-w-40 truncate text-[11px]" title={b.namaPart}>{b.namaPart || '—'}</TableCell>
                            <TableCell className="text-[11px]">{b.qty}</TableCell>
                            <TableCell className="font-mono text-[11px]">{b.serialNumber || '—'}</TableCell>
                            <TableCell>
                              <Badge variant="outline" className={b.statusMatch === 'COCOK' ? 'border-emerald-300 bg-emerald-50 text-[10px] text-emerald-700' : 'border-amber-300 bg-amber-50 text-[10px] text-amber-700'}>
                                {b.statusMatch === 'COCOK' ? 'COCOK' : 'TANPA TIKET'}
                              </Badge>
                              {b.yakin != null && <span className="ml-1 text-[9px] text-indigo-600" title={b.keterangan}>AI {b.yakin}%</span>}
                            </TableCell>
                            <TableCell>
                              {kand && b.statusMatch === 'COCOK' ? (
                                <p className="font-mono text-[10px] text-emerald-700" title={`${kand.model} · ${kand.serial}${kand.sudahReady ? ' · sudah READY' : ''}`}>{kand.noTiket}</p>
                              ) : (
                                <select
                                  value={sjPilih[i] || ''}
                                  onChange={(e) => setSjPilih({ ...sjPilih, [i]: e.target.value })}
                                  className="w-44 cursor-pointer rounded border border-slate-200 px-1 py-0.5 text-[10px]"
                                  aria-label={`Pilih tiket untuk baris ${b.kodePart}`}
                                >
                                  <option value="">— biarkan tanpa tiket —</option>
                                  {b.opsi.map((o) => (
                                    <option key={o.key} value={o.key}>{o.noTiket} · {o.serial || o.model} · {o.kodePart}</option>
                                  ))}
                                  {b.cocokCand && !b.opsi.some((o) => o.key === b.cocokCand!.key) && (
                                    <option key={b.cocokCand.key} value={b.cocokCand.key}>{b.cocokCand.noTiket} · {b.cocokCand.serial || b.cocokCand.model} · {b.cocokCand.kodePart}</option>
                                  )}
                                </select>
                              )}
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}
            <p className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[10px] text-slate-500">
              <b>Simpan Draft</b> hanya merekam hasil uraikan &amp; pencocokan. Tidak ada part/tiket/unit yang berubah —
              verifikasi dilakukan di tahap cek berlapis.
            </p>
          </div>
        )}

        {sjMode === 'DRAFT' && sjDraft && (() => {
          const butuhCekManual = sjCekManual || sjDraft.cekManual
          const semuaCekManual = !butuhCekManual || sjDraft.items.every((i) => sjTicks[i.id])
          const cekByItem = new Map((sjCek?.items ?? []).filter((m) => m.itemId != null).map((m) => [m.itemId as number, m]))
          const masalahNonOk = (sjCek?.items ?? []).filter((m) => m.tingkat !== 'OK')
          const warnaStatus = sjDraft.status === 'DITERAPKAN' ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : sjDraft.status === 'DIPERIKSA' ? 'border-sky-300 bg-sky-50 text-sky-700' : 'border-slate-300 bg-slate-100 text-slate-600'
          return (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className={`text-[10px] ${warnaStatus}`}>{sjDraft.status}</Badge>
                  <span className="font-mono font-semibold text-slate-700">{sjDraft.noSuratJalan}</span>
                  {sjDraft.produsen && <span>{sjDraft.produsen}</span>}
                  <span>{sjDraft.cocokCount}/{sjDraft.items.length} cocok</span>
                  {sjDraft.diperiksaOleh && <span className="text-slate-400">· cek: {sjDraft.diperiksaOleh} {sjDraft.diperiksaAt ? formatWaktu(sjDraft.diperiksaAt) : ''}</span>}
                  {sjDraft.diterapkanOleh && <span className="text-emerald-700">· diterapkan {sjDraft.diterapkanOleh} {sjDraft.diterapkanAt ? formatWaktu(sjDraft.diterapkanAt) : ''}</span>}
                </div>
                {sjDraft.status !== 'DITERAPKAN' && (
                  <Button size="sm" variant="outline" className="border-rose-200 text-[10px] text-rose-600 hover:bg-rose-50" onClick={() => sjHapusMutation.mutate(sjDraft.id)}>
                    Hapus Draft
                  </Button>
                )}
              </div>

              <div className="max-h-60 overflow-y-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {butuhCekManual && <TableHead className="w-8 text-[11px]">✓</TableHead>}
                      <TableHead className="text-[11px]">Kode</TableHead>
                      <TableHead className="text-[11px]">Qty</TableHead>
                      <TableHead className="text-[11px]">SN</TableHead>
                      <TableHead className="text-[11px]">Tiket Tujuan</TableHead>
                      <TableHead className="text-[11px]">Cek</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sjDraft.items.map((item) => {
                      const kandTujuan = item.tiket ? sjDraft.kandidat.find((k) => k.serviceRequestId === item.tiket!.id && sjNrm(k.kodePart) === sjNrm(item.kodePart)) : undefined
                      const cekRow = cekByItem.get(item.id)
                      return (
                        <TableRow key={item.id}>
                          {butuhCekManual && (
                            <TableCell>
                              <Checkbox
                                className="h-3.5 w-3.5"
                                checked={sjTicks[item.id] === true}
                                disabled={sjDraft.status === 'DITERAPKAN'}
                                onCheckedChange={(c) => { setSjTicks({ ...sjTicks, [item.id]: c === true }); setSjCekAkhir(false) }}
                                aria-label={`Verifikasi manual baris ${item.kodePart}`}
                              />
                            </TableCell>
                          )}
                          <TableCell className="font-mono text-[11px]" title={item.namaPart ?? undefined}>{item.kodePart}</TableCell>
                          <TableCell className="text-[11px]">{item.qty}</TableCell>
                          <TableCell className="font-mono text-[11px]">{item.serialNumber || '—'}</TableCell>
                          <TableCell>
                            {sjDraft.status === 'DITERAPKAN' ? (
                              <span className="font-mono text-[10px] text-slate-600">{item.tiket?.noTiket ?? '—'}</span>
                            ) : (
                              <select
                                value={kandTujuan?.key ?? ''}
                                onChange={(e) => { sjItemMutation.mutate({ itemId: item.id, pilihKey: e.target.value }); setSjTicks({ ...sjTicks, [item.id]: false }) }}
                                className="w-48 cursor-pointer rounded border border-slate-200 px-1 py-0.5 text-[10px]"
                                aria-label={`Tiket tujuan baris ${item.kodePart}`}
                              >
                                <option value="">— tanpa tiket (catatan saja) —</option>
                                {sjDraft.kandidat
                                  .filter((k) => sjNrm(k.kodePart) === sjNrm(item.kodePart))
                                  .map((o) => (
                                    <option key={o.key} value={o.key}>{o.noTiket} · {o.serial || o.model} · {o.kodePart}{o.sudahReady ? ' · READY' : ''}</option>
                                  ))}
                              </select>
                            )}
                          </TableCell>
                          <TableCell>
                            {cekRow ? (
                              <span
                                className={`text-[10px] ${cekRow.tingkat === 'BLOKIR' ? 'text-rose-700' : cekRow.tingkat === 'PERINGATAN' ? 'text-amber-700' : cekRow.tingkat === 'INFO' ? 'text-sky-700' : 'text-emerald-700'}`}
                                title={cekRow.pesan}
                              >
                                {cekRow.tingkat === 'BLOKIR' ? '⛔ BLOKIR' : cekRow.tingkat === 'PERINGATAN' ? '⚠ PERINGATAN' : cekRow.tingkat === 'INFO' ? 'ⓘ INFO' : '✔ OK'}
                              </span>
                            ) : (
                              <span className="text-[10px] text-slate-300">belum dicek</span>
                            )}
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-slate-600">
                  <Checkbox
                    className="h-3.5 w-3.5"
                    checked={sjCekManual}
                    disabled={sjDraft.status === 'DITERAPKAN'}
                    onCheckedChange={(c) => { setSjCekManual(c === true); setSjCek(null); setSjCekAkhir(false) }}
                    aria-label="Cek manual per baris"
                  />
                  Cek manual per baris {butuhCekManual ? <span className="text-[10px] text-rose-600">(centang semua baris)</span> : ''}
                </label>
                <Button size="sm" variant="outline" className="ml-auto" disabled={sjDraft.status === 'DITERAPKAN' || sjPeriksaMutation.isPending || sjDraft.items.length === 0} onClick={() => sjPeriksaMutation.mutate({ cekManual: butuhCekManual })}>
                  {sjPeriksaMutation.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Search className="mr-1 h-4 w-4" />}
                  {sjCek ? 'Cek Ulang' : 'Jalankan Cek Berlapis'}
                </Button>
                <Button
                  size="sm" variant="outline"
                  className="border-indigo-300 text-[11px] text-indigo-700 hover:bg-indigo-50"
                  disabled={sjAnalisaMutation.isPending || sjDraft.items.length === 0}
                  onClick={() => sjAnalisaMutation.mutate()}
                  title="Bandingkan draft ini dengan dokumen SJR yang dikirim ke produsen + saran AI utk baris salah ketik OCR — hanya tampilan, tidak mengubah data apa pun"
                >
                  {sjAnalisaMutation.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Sparkles className="mr-1 h-4 w-4" />}
                  {sjAnalisa ? 'Ulangi Analisa AI' : 'Analisa AI (Kirim vs Terima)'}
                </Button>
              </div>

              {sjCek && (
                <div className="rounded-lg border p-3 text-[11px]">
                  <div className="mb-1.5 flex flex-wrap items-center gap-2">
                    {sjCek.header.map((h, i) => (
                      <span key={i} className={`rounded px-1.5 py-0.5 ${h.tingkat === 'BLOKIR' ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700'}`}>{h.tingkat}: {h.pesan}</span>
                    ))}
                    <span className="text-slate-500">{sjCek.items.length} baris · {sjCek.blokir} blokir · {sjCek.peringatan} peringatan · {sjCek.info} info</span>
                  </div>
                  {masalahNonOk.length > 0 && (
                    <ul className="max-h-36 space-y-0.5 overflow-y-auto">
                      {masalahNonOk.slice(0, 12).map((m, i) => (
                        <li key={i} className="flex items-start gap-1">
                          <span className={`font-semibold ${m.tingkat === 'BLOKIR' ? 'text-rose-700' : m.tingkat === 'PERINGATAN' ? 'text-amber-700' : 'text-sky-700'}`}>{m.tingkat === 'BLOKIR' ? '⛔' : m.tingkat === 'PERINGATAN' ? '⚠' : 'ⓘ'}</span>
                          <span className="text-slate-600"><span className="font-mono">{m.kode}</span> — {m.pesan}</span>
                        </li>
                      ))}
                      {masalahNonOk.length > 12 && <li className="text-slate-400">… dan {masalahNonOk.length - 12} lainnya</li>}
                    </ul>
                  )}
                </div>
              )}

              {sjCek && !sjCekAkhir && (
                <p className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[10px] text-slate-500">
                  Cek berlapis selesai{butuhCekManual && !semuaCekManual ? ' — selesaikan centang verifikasi manual' : ''}. Tekan <b>Cek Akhir</b> untuk verifikasi
                  final; <b>Terapkan Permanen</b> baru tersedia bila cek akhir bersih.
                </p>
              )}
              {sjCekAkhir && sjCek?.bisaTerapkan && (
                <p className="rounded-md border border-emerald-300 bg-emerald-50 px-2.5 py-1.5 text-[10px] font-semibold text-emerald-700">
                  ✔ CEK AKHIR BERSIH — siap diterapkan permanen. Server akan mengulang cek sebagai pertahanan akhir.
                </p>
              )}

              {sjAnalisa && (
                <div className="space-y-2 rounded-lg border border-indigo-200 bg-indigo-50/40 p-3 text-[11px]">
                  <div className="flex flex-wrap items-center gap-2">
                    <Sparkles className="h-3.5 w-3.5 text-indigo-600" />
                    <span className="font-semibold text-indigo-900">Analisa AI — Kirim vs Terima</span>
                    <Badge variant="outline" className="border-indigo-300 text-[9px] text-indigo-700">
                      {sjAnalisa.sumber === 'REF_SJR' ? `doc kirim: ${sjAnalisa.refSjr}` : sjAnalisa.sumber === 'SJR_TIKET' ? `doc kirim (SJR tiket): ${sjAnalisa.dipakaiSjr.join(', ')}` : 'tidak ada dokumen kirim (SJR)'}
                    </Badge>
                    {sjAnalisa.model && <Badge variant="outline" className="border-slate-300 text-[9px] text-slate-500">AI: {sjAnalisa.model}</Badge>}
                    <span className="text-slate-500">
                      {sjAnalisa.ringkasan.sama} sama · {sjAnalisa.ringkasan.bedaQty} beda qty · {sjAnalisa.ringkasan.belumDiterima} belum diterima · {sjAnalisa.ringkasan.tanpaKirim} tanpa kirim
                    </span>
                  </div>

                  {sjAnalisa.pasangan.length > 0 && (
                    <div className="max-h-48 overflow-y-auto rounded border border-slate-200 bg-white">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="text-[10px]">Status</TableHead>
                            <TableHead className="text-[10px]">Kode / Nama</TableHead>
                            <TableHead className="text-[10px]">Dikirim (SJR)</TableHead>
                            <TableHead className="text-[10px]">Diterima (draft ini)</TableHead>
                            <TableHead className="text-[10px]">Catatan</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {sjAnalisa.pasangan.map((p, i) => (
                            <TableRow key={i}>
                              <TableCell>
                                <Badge variant="outline" className={`text-[9px] ${p.jenis === 'SAMA' ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : p.jenis === 'BEDA_QTY' ? 'border-amber-300 bg-amber-50 text-amber-700' : p.jenis === 'KIRIM_TANPA_TERIMA' ? 'border-rose-300 bg-rose-50 text-rose-700' : 'border-slate-300 bg-slate-50 text-slate-600'}`}>
                                  {p.jenis === 'SAMA' ? '✔ SAMA' : p.jenis === 'BEDA_QTY' ? '⚠ BEDA QTY' : p.jenis === 'KIRIM_TANPA_TERIMA' ? '❌ BELUM DITERIMA' : '➕ TIDAK DIKIRIM'}
                                </Badge>
                              </TableCell>
                              <TableCell className="font-mono text-[10px]">
                                {p.kode}
                                {p.nama ? <span className="block max-w-40 truncate font-sans text-[9px] text-slate-500" title={p.nama}>{p.nama}</span> : null}
                              </TableCell>
                              <TableCell className="text-[10px]">
                                {p.kirim ? <span title={`${p.kirim.noSjr} · ${p.kirim.tgl ? formatTanggal(p.kirim.tgl) : ''} · ${p.kirim.noTiket}`}>{p.kirim.qty} <span className="text-slate-400">via</span> <span className="font-mono">{p.kirim.noSjr}</span></span> : <span className="text-slate-300">—</span>}
                              </TableCell>
                              <TableCell className="text-[10px]">
                                {p.terima ? <span className={p.terima.kodeAsli !== p.kode ? 'font-mono text-amber-700' : ''}>{p.terima.kodeAsli !== p.kode ? `${p.terima.kodeAsli} → ` : ''}{p.terima.qty}</span> : <span className="text-slate-300">—</span>}
                              </TableCell>
                              <TableCell className="max-w-44 truncate text-[10px] text-slate-600" title={p.catatan}>{p.catatan || '—'}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}

                  {sjAnalisa.saran.length > 0 && sjDraft.status !== 'DITERAPKAN' && (
                    <div className="rounded border border-indigo-200 bg-white p-2">
                      <div className="mb-1.5 flex flex-wrap items-center gap-2">
                        <span className="text-[10px] font-semibold text-slate-600">Saran penautan ({sjAnalisa.saran.length} baris) — diterima manual per baris:</span>
                        {sjAnalisa.ringkasan.saranYakin > 0 && (
                          <Button
                            size="sm" variant="outline" disabled={sjItemMutation.isPending}
                            className="h-6 border-emerald-300 px-2 text-[9px] text-emerald-700 hover:bg-emerald-50"
                            onClick={() => {
                              const yakinList = sjAnalisa.saran.filter((s) => s.yakin >= 90)
                              void (async () => {
                                for (const s of yakinList) {
                                  try { await sjItemMutation.mutateAsync({ itemId: s.terimaId, pilihKey: s.saranKey, asalSaran: 'AI', alasanSaran: `${s.alasan} (AI ${s.yakin}%)` }) } catch { /* toast dr onError */ }
                                }
                              })()
                            }}
                            title="Autolink semua saran dengan keyakinan AI ≥ 90% — tiap baris tetap tercatat di Audit Log"
                          >
                            Terima semua saran yakin (≥90%) — {sjAnalisa.ringkasan.saranYakin} baris
                          </Button>
                        )}
                      </div>
                      <div className="max-h-44 overflow-y-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="text-[10px]">Kode (file OCR)</TableHead>
                              <TableHead className="text-[10px]">Saran AI</TableHead>
                              <TableHead className="text-[10px]">Tiket</TableHead>
                              <TableHead className="text-[10px]">Ref SJR</TableHead>
                              <TableHead className="text-[10px]">Alasan</TableHead>
                              <TableHead className="text-[10px]"></TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {sjAnalisa.saran.map((s) => (
                              <TableRow key={s.terimaId}>
                                <TableCell className="font-mono text-[10px] text-rose-700" title="Teks asli di file Excel">{s.kodeAsli}</TableCell>
                                <TableCell className="font-mono text-[10px] text-emerald-700">
                                  {s.kodeSaran ? `${s.kodeSaran} ` : ''}
                                  <Badge variant="outline" className={`ml-0.5 text-[8px] ${s.yakin >= 90 ? 'border-emerald-300 text-emerald-700' : s.yakin >= 75 ? 'border-amber-300 text-amber-700' : 'border-slate-300 text-slate-500'}`}>AI {s.yakin}%</Badge>
                                </TableCell>
                                <TableCell className="font-mono text-[10px]">{s.noTiket}</TableCell>
                                <TableCell className="font-mono text-[9px] text-slate-500">{s.noSjr || '—'}</TableCell>
                                <TableCell className="max-w-40 truncate text-[10px] text-slate-600" title={s.alasan}>{s.alasan}</TableCell>
                                <TableCell>
                                  <Button
                                    size="sm" variant="outline" disabled={sjItemMutation.isPending}
                                    className="h-6 border-emerald-300 px-1.5 text-[9px] text-emerald-700 hover:bg-emerald-50"
                                    onClick={() => sjItemMutation.mutate({ itemId: s.terimaId, pilihKey: s.saranKey, asalSaran: 'AI', alasanSaran: `${s.alasan} (AI ${s.yakin}%)` })}
                                    title="Tautkan baris ini ke tiket saran AI (kode salah ketik dibereskan; kode asli tercatat di alasan & Audit Log)"
                                  >
                                    Terima
                                  </Button>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </div>
                  )}

                  <p className="text-[9px] text-slate-400">
                    Analisa hanya untuk diperiksa — tidak mengubah data apa pun. Saran yang diterima baris secara manual tercatat di pelacakan audit (Audit Log).
                  </p>
                </div>
              )}
            </div>
          )
        })()}

        {sjMode === 'DRAFT' && !sjDraft && (
          <div className="flex items-center gap-2 py-6 text-center text-xs text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Memuat draft…
          </div>
        )}

        {(() => {
          const butuhCekManual = sjCekManual || (sjDraft?.cekManual ?? false)
          const semuaCekManual = !butuhCekManual || sjDraft?.items.every((i) => sjTicks[i.id]) === true
          const siapTerapkan = sjCekAkhir && sjCek?.bisaTerapkan === true && semuaCekManual && sjDraft?.status !== 'DITERAPKAN'
          const riwayat = sjRiwayat ?? []
          const jalankanCekAkhir = async () => {
            try {
              const h = await sjPeriksaMutation.mutateAsync({ cekManual: butuhCekManual })
              if (h.bisaTerapkan) setSjCekAkhir(true)
            } catch {
              // toast kesalahan sudah ditampilkan mutation onError
            }
          }
          return (
            <DialogFooter className="flex-col gap-2 sm:items-end">
              {riwayat.length > 0 && (
                <div className="w-full space-y-1 text-left">
                  <p className="text-[11px] font-semibold text-slate-600">Riwayat surat jalan masuk (klik Lanjut untuk draft yang belum selesai)</p>
                  {riwayat.slice(0, 5).map((r) => (
                    <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-200 px-2 py-1 text-[10px] text-slate-500">
                      <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                        <Badge variant="outline" className={r.status === 'DITERAPKAN' ? 'border-emerald-300 bg-emerald-50 text-[9px] text-emerald-700' : r.status === 'DIPERIKSA' ? 'border-sky-300 bg-sky-50 text-[9px] text-sky-700' : 'border-slate-300 bg-slate-100 text-[9px] text-slate-600'}>{SJ_LABEL[r.status] ?? r.status}</Badge>
                        <span className="font-mono font-semibold text-slate-700">{r.noSuratJalan}{r.produsen ? ` · ${r.produsen}` : ''}</span>
                        <span>{formatTanggal(r.createdAt)} · {r.cocokCount}/{r.totalItem} cocok</span>
                      </span>
                      <span className="flex items-center gap-1">
                        {r.status !== 'DITERAPKAN' ? (
                          <>
                            <button type="button" className="cursor-pointer rounded border border-indigo-200 bg-indigo-50 px-1.5 py-0.5 text-[9px] text-indigo-700 hover:bg-indigo-100" onClick={() => { setSjDraftId(r.id); setSjMode('DRAFT'); setSjCekManual(r.cekManual); setSjCek(null); setSjCekAkhir(false); setSjTicks({}); setSjAnalisa(null) }}>Lanjut</button>
                            <button type="button" className="cursor-pointer rounded border border-rose-200 bg-rose-50 px-1.5 py-0.5 text-[9px] text-rose-600 hover:bg-rose-100" onClick={() => sjHapusMutation.mutate(r.id)}>Hapus</button>
                          </>
                        ) : (
                          <span className="text-emerald-700">diterapkan {r.diterapkanOleh ?? ''}{r.diterapkanAt ? ` · ${formatWaktu(r.diterapkanAt)}` : ''}</span>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {sjMode === 'INPUT' && (
                <div className="flex gap-2">
                  <Button variant="outline" disabled={!sjPreview || sjPreview.items.length === 0 || sjApplyMutation.isPending} onClick={() => sjApplyMutation.mutate()}>
                    {sjApplyMutation.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Truck className="mr-1 h-4 w-4" />} Simpan Draft
                  </Button>
                </div>
              )}
              {sjMode === 'DRAFT' && sjDraft && sjDraft.status !== 'DITERAPKAN' && (
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <Button
                    variant="outline"
                    disabled={!sjCek || !sjCek.bisaTerapkan || !semuaCekManual || sjPeriksaMutation.isPending}
                    onClick={() => void jalankanCekAkhir()}
                    title="Verifikasi final ulang (server menjalankan cek penuh) — syarat sebelum Terapkan Permanen"
                  >
                    {sjPeriksaMutation.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-1 h-4 w-4" />} Cek Akhir
                  </Button>
                  <Button
                    className="bg-emerald-600 hover:bg-emerald-700"
                    disabled={!siapTerapkan || sjTerapkanMutation.isPending}
                    onClick={() => sjTerapkanMutation.mutate()}
                  >
                    {sjTerapkanMutation.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-1 h-4 w-4" />} Terapkan Permanen
                  </Button>
                </div>
              )}
            </DialogFooter>
          )
        })()}
      </DialogContent>
    </Dialog>
  )
}
