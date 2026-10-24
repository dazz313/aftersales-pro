'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetcher, postJson } from '@/lib/api'
import { useAppStore } from '@/lib/store'
import { useToast } from '@/hooks/use-toast'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import QuickSearch from '@/components/quick-search'
import LoadMore from '@/components/load-more'
import { useBertahap } from '@/hooks/use-bertahap'
import NotaSheet from '@/components/nota/nota-sheet'
import SignaturePad from '@/components/nota/signature-pad'
import {
  MERK_NOTA,
  hariIniNota,
  hitungBiayaNota,
  nomorBassAcak,
  nomorBassValid,
  parseRupiahNota,
  rupiahNota,
  tanggalNota,
  type NotaData,
  type NotaItemData,
} from '@/lib/nota'
import { ArrowLeft, Copy, FileSignature, FileText, Plus, Printer, Save, Trash2, Wrench } from 'lucide-react'
import { cn } from '@/lib/utils'

/* ================= Field kecil form nota (nyaman dipakai di HP) ================= */

function Fketik({ label, value, onChange, type = 'text', placeholder, list, wajib }: {
  label: string
  value: string
  onChange: (v: string) => void
  type?: 'text' | 'date' | 'time' | 'tel'
  placeholder?: string
  list?: string
  wajib?: boolean
}) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-slate-600">
        {label}
        {wajib ? <span className="text-rose-600"> *</span> : null}
      </span>
      <input
        type={type}
        list={list}
        value={value ?? ''}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 w-full rounded-md border border-input bg-white px-3 text-sm"
      />
    </label>
  )
}

function Fteks({ label, value, onChange, rows = 2, placeholder, wajib }: {
  label: string
  value: string
  onChange: (v: string) => void
  rows?: number
  placeholder?: string
  wajib?: boolean
}) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-slate-600">
        {label}
        {wajib ? <span className="text-rose-600"> *</span> : null}
      </span>
      <textarea
        rows={rows}
        value={value ?? ''}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-input bg-white px-3 py-2 text-sm"
      />
    </label>
  )
}

const STATUS_BADGE: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-700 border border-slate-300',
  selesai: 'bg-amber-100 text-amber-800 border border-amber-300',
  diambil: 'bg-emerald-100 text-emerald-800 border border-emerald-300',
}

const STATUS_LABEL: Record<string, string> = { draft: 'Draft', selesai: 'Selesai', diambil: 'Diambil' }

export default function NotaView() {
  const { navIntent, clearNavIntent } = useAppStore()
  const { toast } = useToast()
  const queryClient = useQueryClient()

  const [mode, setMode] = useState<'daftar' | 'edit'>('daftar')
  const [cari, setCari] = useState('')
  const [statusFilter, setStatusFilter] = useState('SEMUA')

  // Nota yang sedang diedit (null = belum disimpan → POST saat autosave pertama)
  const [draft, setDraft] = useState<NotaData | null>(null)
  const draftRef = useRef<NotaData | null>(null)
  useEffect(() => { draftRef.current = draft }, [draft])

  const [lembar, setLembar] = useState<1 | 2>(1)
  const [simpanKebadaan, setSimpanKebadaan] = useState<'tunggu' | 'nyala' | null>(null)
  const simpanTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Navigasi " notaId" — datang dari tombol nota/klaim di view lain
  useEffect(() => {
    if (navIntent?.notaId) {
      const id = navIntent.notaId
      clearNavIntent()
      fetcher<NotaData>(`/api/nota/${id}`)
        .then((n) => { setDraft(n); setMode('edit') })
        .catch((e: Error) => toast({ title: 'Nota gagal dimuat', description: e.message, variant: 'destructive' }))
    }
     
  }, [navIntent?.ts])

  useEffect(() => () => { if (simpanTimer.current) clearTimeout(simpanTimer.current) }, [])

  /* ================= Simpan (autosave debounced + manual) ================= */

  const simpanMutation = useMutation({
    mutationFn: (n: NotaData) =>
      n.id ? postJson<NotaData>(`/api/nota/${n.id}`, n, 'PATCH') : postJson<NotaData>('/api/nota', n),
    onSuccess: (n) => {
      setSimpanKebadaan('nyala')
      setDraft((d) => (d ? { ...d, id: n.id, nomorBass: n.nomorBass, updatedAt: n.updatedAt, items: n.items ?? [] } : d))
      queryClient.invalidateQueries({ queryKey: ['nota-list'] })
    },
    onError: (e: Error) => {
      setSimpanKebadaan(null)
      if (simpanTimer.current) clearTimeout(simpanTimer.current)
      toast({ title: 'Simpan nota gagal', description: e.message, variant: 'destructive' })
    },
  })

  const update = (patch: Partial<NotaData>) => {
    setDraft((d) => (d ? { ...d, ...patch } : d))
    setSimpanKebadaan('tunggu')
    if (simpanTimer.current) clearTimeout(simpanTimer.current)
    simpanTimer.current = setTimeout(() => {
      const n = draftRef.current
      if (n && nomorBassValid(n.nomorBass)) simpanMutation.mutate(n)
    }, 1200)
  }

  const simpanManual = () => {
    const n = draftRef.current
    if (!n) return
    if (!nomorBassValid(n.nomorBass)) {
      toast({ title: 'Nomor BASS belum benar', description: 'Isi 6 digit angka (contoh: 204501).', variant: 'destructive' })
      return
    }
    const { total } = hitungBiayaNota(n)
    simpanMutation.mutate({ ...n, total })
  }

  const tandaiStatus = (status: 'selesai' | 'diambil') => {
    const n = draftRef.current
    if (!n) return
    // Validasi wajib untuk status Selesai/Diambil: Nama, Merk, Model, Pengaduan
    const kurang: string[] = []
    if (!(n.nama ?? '').trim()) kurang.push('Nama')
    if (!(n.merk ?? '').trim()) kurang.push('Merk')
    if (!(n.model ?? '').trim()) kurang.push('Model')
    if (!(n.pengaduan ?? '').trim()) kurang.push('Pengaduan')
    if (kurang.length > 0) {
      toast({ title: 'Data belum lengkap', description: `Isi dulu: ${kurang.join(', ')}.`, variant: 'destructive' })
      return
    }
    const { total } = hitungBiayaNota(n)
    update({ status, total })
    const isi = { ...n, status, total }
    draftRef.current = isi
    setDraft(isi)
    simpanMutation.mutate(isi)
  }

  const buatBaru = () => {
    setDraft({
      nomorBass: nomorBassAcak(),
      tanggal: hariIniNota(),
      status: 'draft',
      ppnPersen: 0,
      biayaService: 0,
      biayaTransportasi: 0,
      total: 0,
      items: [{}],
    })
    setMode('edit')
  }

  const duplikatSekarang = async (id: number) => {
    try {
      const n = await postJson<NotaData>(`/api/nota/${id}/duplikat`, {})
      setDraft(n)
      setMode('edit')
      toast({ title: 'Nota diduplikat', description: `Nomor BASS baru: ${n.nomorBass}. Silakan edit manual.` })
      queryClient.invalidateQueries({ queryKey: ['nota-list'] })
    } catch (e) {
      toast({ title: 'Duplikat gagal', description: (e as Error).message, variant: 'destructive' })
    }
  }

  const hapus = (id: number) => {
    if (!confirm('Hapus nota ini? Tindakan tidak bisa dibatalkan.')) return
    hapusMutation.mutate(id)
  }

  const hapusMutation = useMutation({
    mutationFn: (id: number) => postJson<{ ok: boolean }>(`/api/nota/${id}`, undefined, 'DELETE'),
    onSuccess: (_d, id) => {
      toast({ title: 'Nota dihapus' })
      if (draftRef.current?.id === id) { setDraft(null); setMode('daftar') }
      queryClient.invalidateQueries({ queryKey: ['nota-list'] })
    },
    onError: (e: Error) => toast({ title: 'Hapus gagal', description: e.message, variant: 'destructive' }),
  })

  /* ================= Daftar nota ================= */

  const daftarParam = encodeURIComponent(cari.trim())
  const { data: daftar, isLoading } = useQuery({
    queryKey: ['nota-list', daftarParam, statusFilter],
    queryFn: () => fetcher<NotaData[]>(`/api/nota?q=${daftarParam}&status=${statusFilter}`),
  })

  const daftarla = useMemo(() => daftar ?? [], [daftar])
  const cariHasil = (n: NotaData) => {
    const q = cari.trim().toLowerCase()
    if (!q) return true
    if (statusFilter !== 'SEMUA' && (n.status ?? 'draft') !== statusFilter) return false
    return true
  }
  const tampil = daftarla.filter(cariHasil)
  // Render bertahap daftar nota (lihat src/hooks/use-bertahap.ts) — hook dipanggil
  // sebelum early-return mode edit agar urutan hooks tetap konsisten.
  const notaBertahap = useBertahap(tampil, `${cari}|${statusFilter}`)

  /* =============== Editor: kumpul field → satu fungsi pengecek (patch) =============== */

  if (mode === 'edit' && draft) {
    const hitung = hitungBiayaNota(draft)
    const garansiPenuh = hitung.garansiPenuh
    const items = draft.items ?? []
    const setItem = (i: number, patch: Partial<NotaItemData>) => {
      const nitems = items.map((it, idx) => (idx === i ? { ...it, ...patch } : it))
      update({ items: nitems })
    }
    const tambahItem = () => items.length < 7 ? update({ items: [...items, {}] }) : null
    const hapusItem = (i: number) => update({ items: items.filter((_x, idx) => idx !== i) })

    // Aktifkan garansi penuh → kosongkan seluruh biaya ("Biaya ditanggung garansi")
    const setGaransiPenuh = (on: boolean) => {
      if (!on) return
      update({ biayaService: 0, biayaTransportasi: 0, ppnPersen: 0, total: 0 })
    }

    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => { setDraft(null); setMode('daftar'); setSimpanKebadaan(null) }}>
            <ArrowLeft className="mr-1 h-4 w-4" /> Daftar Nota
          </Button>
          <span className="font-mono text-sm font-bold tracking-wider text-slate-800">BASS {draft.nomorBass}</span>
          <Badge variant="outline" className={STATUS_BADGE[draft.status ?? 'draft']}>{STATUS_LABEL[draft.status ?? 'draft']}</Badge>
          {simpanKebadaan === 'tunggu' && <span className="text-xs text-amber-600">menyimpan…</span>}
          {simpanKebadaan === 'nyala' && <span className="text-xs text-emerald-600">tersimpan otomatis ✓</span>}
          <div className="ml-auto flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={simpanManual}>
              <Save className="mr-1 h-4 w-4" /> Simpan
            </Button>
            <Button size="sm" className="bg-amber-600 hover:bg-amber-700" onClick={() => tandaiStatus('selesai')}>
              Tandai Selesai
            </Button>
            <Button size="sm" className="bg-emerald-700 hover:bg-emerald-800" onClick={() => tandaiStatus('diambil')}>
              Tandai Diambil
            </Button>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          {/* ===================== FORM (kiri) ===================== */}
          <div className={cn('space-y-4', 'lg:max-h-[75vh] lg:overflow-y-auto lg:pr-1')}>
            {/* --- Header: lokasi & nomor BASS --- */}
            <Card className="p-4 space-y-3">
              <p className="text-sm font-bold flex items-center gap-2"><Wrench className="h-4 w-4" /> Header Nota</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs font-medium text-slate-600 mb-1">Lokasi (pilih satu)</p>
                  <div className="flex gap-2">
                    {['Indoor', 'Outdoor'].map((l) => (
                      <button
                        key={l}
                        onClick={() => update({ lokasi: l })}
                        className={cn(
                          'h-10 flex-1 rounded-md border text-sm font-medium',
                          (draft.lokasi ?? 'Indoor') === l ? 'border-slate-900 bg-slate-900 text-white' : 'border-input bg-white text-slate-700'
                        )}
                      >
                        {l}
                      </button>
                    ))}
                  </div>
                </div>
                <Fketik
                  label="Nomor BASS (6 digit)"
                  wajib
                  value={draft.nomorBass ?? ''}
                  onChange={(v) => update({ nomorBass: v.replace(/\D/g, '').slice(0, 6) })}
                  placeholder="contoh: 204501"
                />
              </div>
            </Card>

            {/* --- Data konsumen & unit (panel kiri nota) --- */}
            <Card className="p-4 space-y-3">
              <p className="text-sm font-bold">Data Konsumen & Unit</p>
              <div className="grid grid-cols-2 gap-3">
                <Fketik label="Tanggal" type="date" value={draft.tanggal ?? ''} onChange={(v) => update({ tanggal: v })} />
                <Fketik label="Jam Masuk" type="time" value={draft.jamMasuk ?? ''} onChange={(v) => update({ jamMasuk: v })} />
              </div>
              <Fketik label="Nama (toko/konsumen)" wajib value={draft.nama ?? ''} onChange={(v) => update({ nama: v })} />
              <Fteks label="Alamat" value={draft.alamat ?? ''} onChange={(v) => update({ alamat: v })} rows={2} />
              <div className="grid grid-cols-2 gap-3">
                <Fketik label="Telp" type="tel" value={draft.telp ?? ''} onChange={(v) => update({ telp: v })} />
                <Fketik label="HP" type="tel" value={draft.hp ?? ''} onChange={(v) => update({ hp: v })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-slate-600">Merk <span className="text-rose-600">*</span> (pilih / ketik bebas)</span>
                  <input
                    list="merk-nota-list"
                    value={draft.merk ?? ''}
                    onChange={(e) => update({ merk: e.target.value })}
                    className="h-10 w-full rounded-md border border-input bg-white px-3 text-sm"
                    placeholder="Miyako, Daikin, …"
                  />
                  <datalist id="merk-nota-list">
                    {MERK_NOTA.map((m) => <option key={m} value={m} />)}
                  </datalist>
                </label>
                <Fketik label="LP" value={draft.lp ?? ''} onChange={(v) => update({ lp: v })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Fketik label="Model" wajib value={draft.model ?? ''} onChange={(v) => update({ model: v })} />
                <Fketik label="No. Seri" value={draft.noSeri ?? ''} onChange={(v) => update({ noSeri: v })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Fketik label="Tgl Beli" type="date" value={draft.tglBeli ?? ''} onChange={(v) => update({ tglBeli: v })} />
                <div>
                  <p className="text-xs font-medium text-slate-600 mb-1">Garansi</p>
                  <div className="flex gap-2">
                    {['Ya', 'Tdk'].map((g) => (
                      <button
                        key={g}
                        onClick={() => update({ garansi: g })}
                        className={cn(
                          'h-10 flex-1 rounded-md border text-sm font-medium',
                          (draft.garansi ?? 'Ya') === g ? 'border-slate-900 bg-slate-900 text-white' : 'border-input bg-white text-slate-700'
                        )}
                      >
                        {g}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Fketik label="Tgl Selesai" type="date" value={draft.tglSelesai ?? ''} onChange={(v) => update({ tglSelesai: v })} />
                <Fketik label="Jam Selesai" type="time" value={draft.jamSelesai ?? ''} onChange={(v) => update({ jamSelesai: v })} />
              </div>
            </Card>

            {/* --- Panel teknis (kanan nota) --- */}
            <Card className="p-4 space-y-3">
              <p className="text-sm font-bold">Pengaduan & Teknis</p>
              <Fteks label="Pengaduan" wajib rows={3} value={draft.pengaduan ?? ''} onChange={(v) => update({ pengaduan: v })} placeholder="keluhan dari konsumen…" />
              <Fteks label="Kelengkapan" rows={2} value={draft.kelengkapan ?? ''} onChange={(v) => update({ kelengkapan: v })} />
              <Fteks label="Penyebab" rows={2} value={draft.penyebab ?? ''} onChange={(v) => update({ penyebab: v })} />
              <Fteks label="Perbaikan" rows={2} value={draft.perbaikan ?? ''} onChange={(v) => update({ perbaikan: v })} />
            </Card>

            {/* --- Tabel suku cadang --- */}
            <Card className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-bold">Suku Cadang <span className="text-xs text-slate-500">(maks 7 baris — total otomatis)</span></p>
                <Button variant="outline" size="sm" onClick={tambahItem} disabled={items.length >= 7}>
                  <Plus className="mr-1 h-4 w-4" /> Baris
                </Button>
              </div>
              <div className="space-y-2">
                {items.map((it, i) => (
                  <div key={i} className="grid grid-cols-[1fr_2fr_auto_auto] items-end gap-2">
                    <input
                      value={it.kode ?? ''}
                      onChange={(e) => setItem(i, { kode: e.target.value })}
                      placeholder="Kode"
                      className="h-10 rounded-md border border-input px-2 text-sm"
                    />
                    <input
                      value={it.nama ?? ''}
                      onChange={(e) => setItem(i, { nama: e.target.value })}
                      placeholder="Nama suku cadang"
                      className="h-10 rounded-md border border-input px-2 text-sm"
                    />
                    <input
                      inputMode="numeric"
                      value={it.harga ? rupiahNota(it.harga) : ''}
                      onChange={(e) => setItem(i, { harga: parseRupiahNota(e.target.value) })}
                      placeholder="Harga"
                      className="h-10 w-24 rounded-md border border-input px-2 text-right text-sm"
                    />
                    <div className="flex items-center gap-1">
                      <input
                        inputMode="numeric"
                        value={it.qty ?? ''}
                        onChange={(e) => setItem(i, { qty: Math.max(0, parseInt(e.target.value || '0', 10) || 0) })}
                        placeholder="Qty"
                        className="h-10 w-14 rounded-md border border-input px-2 text-right text-sm"
                      />
                      <button onClick={() => hapusItem(i)} className="rounded-md p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600" aria-label="Hapus baris">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                    <p className="col-span-4 text-right text-xs text-slate-500">
                      Total baris: <b>{rupiahNota((it.harga ?? 0) * (it.qty ?? 0))}</b>
                    </p>
                  </div>
                ))}
              </div>
            </Card>

            {/* --- Ringkasan biaya --- */}
            <Card className="p-4 space-y-3">
              <p className="text-sm font-bold">Ringkasan Biaya <span className="text-xs text-slate-500">(Total dihitung otomatis)</span></p>
              {(draft.garansi ?? 'Ya') === 'Ya' && (
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={garansiPenuh}
                    onChange={(e) => e.target.checked && setGaransiPenuh(true)}
                    className="h-4 w-4"
                  />
                  Biaya ditanggung garansi (semua biaya nol)
                </label>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                  <p className="text-xs text-slate-500">Total Harga Suku Cadang</p>
                  <p className="text-sm font-bold">{rupiahNota(hitung.totalSparepart)}</p>
                </div>
                <Fketik label="PPN (%)" value={String(draft.ppnPersen ?? 0)} onChange={(v) => update({ ppnPersen: parseRupiahNota(v) })} type="text" />
                <Fketik label="Biaya Service" value={draft.biayaService ? rupiahNota(draft.biayaService) : ''} onChange={(v) => update({ biayaService: parseRupiahNota(v) })} />
                <Fketik label="Biaya Transportasi" value={draft.biayaTransportasi ? rupiahNota(draft.biayaTransportasi) : ''} onChange={(v) => update({ biayaTransportasi: parseRupiahNota(v) })} />
              </div>
              <div className="rounded-lg border border-slate-900 bg-slate-900 px-4 py-3 text-white">
                <div className="flex justify-between text-xs text-slate-300"><span>Sub Total</span><b className="text-white">{rupiahNota(hitung.subTotal)}</b></div>
                <div className="flex justify-between text-xs text-slate-300"><span>PPN {(draft.ppnPersen ?? 0)}%</span><b className="text-white">{rupiahNota(hitung.ppn)}</b></div>
                <div className="mt-1 flex justify-between border-t border-slate-700 pt-1"><span className="text-sm">Total Biaya Service</span><b className="text-lg">{rupiahNota(hitung.total)}</b></div>
              </div>
            </Card>

            {/* --- Tanda tangan --- */}
            <Card className="p-4 space-y-4">
              <p className="text-sm font-bold flex items-center gap-2"><FileSignature className="h-4 w-4" /> Tanda Tangan</p>
              <SignaturePad
                label="Diserahkan oleh (Customer)"
                nama={draft.namaCustomer1 ?? ''}
                onNama={(v) => update({ namaCustomer1: v })}
                dataUrl={draft.ttdCustomer1 ?? null}
                onDataUrl={(v) => update({ ttdCustomer1: v })}
              />
              <SignaturePad
                label="Teknisi"
                nama={draft.namaTeknisi ?? ''}
                onNama={(v) => update({ namaTeknisi: v })}
                dataUrl={draft.ttdTeknisi ?? null}
                onDataUrl={(v) => update({ ttdTeknisi: v })}
              />
              <SignaturePad
                label="Diambil oleh (Customer)"
                nama={draft.namaCustomer2 ?? ''}
                onNama={(v) => update({ namaCustomer2: v })}
                dataUrl={draft.ttdCustomer2 ?? null}
                onDataUrl={(v) => update({ ttdCustomer2: v })}
              />
              <Fketik label="Tgl. Ambil" type="date" value={draft.tglAmbil ?? ''} onChange={(v) => update({ tglAmbil: v })} />
            </Card>

            {draft.id && (
              <div className="flex gap-2 pb-6">
                <Button variant="outline" size="sm" onClick={() => duplikatSekarang(draft.id!)}>
                  <Copy className="mr-1 h-4 w-4" /> Duplikat
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-rose-600 hover:bg-rose-50"
                  onClick={() => hapus(draft.id!)}
                >
                  <Trash2 className="mr-1 h-4 w-4" /> Hapus
                </Button>
              </div>
            )}
          </div>

          {/* ===================== LIVE PREVIEW + CETAK (kanan, sticky) ===================== */}
          <div className="space-y-3 lg:sticky lg:top-4 self-start">
            <Card className="p-3">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <p className="text-sm font-bold flex items-center gap-2"><FileText className="h-4 w-4" /> Pratinjau Nota</p>
                <div className="ml-auto flex items-center gap-1">
                  {[1, 2].map((l) => (
                    <button
                      key={l}
                      onClick={() => setLembar(l as 1 | 2)}
                      className={cn(
                        'rounded-full border px-3 py-1 text-xs font-medium',
                        lembar === l ? 'border-slate-900 bg-slate-900 text-white' : 'border-input text-slate-600'
                      )}
                    >
                      Lembar {l} dari 2
                    </button>
                  ))}
                </div>
              </div>
              <NotaSheet nota={draft} lembar={lembar} printable />
              <div className="mt-3 flex gap-2">
                <Button className="flex-1" onClick={() => window.print()}>
                  <Printer className="mr-1 h-4 w-4" /> Cetak / Unduh PDF
                </Button>
              </div>
              <p className="mt-1 text-[11px] text-slate-500">
                Cetak A5 landscape — hasil PDF sama persis dengan pratinjau ini.
              </p>
            </Card>
          </div>
        </div>
      </div>
    )
  }

  /* ===================== DAFTAR NOTA ===================== */
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div>
          <h2 className="text-lg font-bold flex items-center gap-2"><Wrench className="h-5 w-5 text-slate-700" /> Nota Servis BASS</h2>
          <p className="text-xs text-slate-500">Nota servis “SERVICE CENTER” — isi, simpan, duplikat & cetak.</p>
        </div>
        <Button className="ml-auto" onClick={buatBaru}>
          <Plus className="mr-1 h-4 w-4" /> Buat Nota Baru
        </Button>
      </div>

      <Card className="p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <QuickSearch
            value={cari}
            onChange={setCari}
            placeholder="Cari nomor BASS / nama / merk / model…"
            resultCount={tampil.length}
          />
          <div className="flex gap-1 overflow-x-auto">
            {['SEMUA', 'draft', 'selesai', 'diambil'].map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={cn(
                  'shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium',
                  statusFilter === s ? 'border-slate-900 bg-slate-900 text-white' : 'border-input text-slate-600'
                )}
              >
                {s === 'SEMUA' ? 'Semua' : STATUS_LABEL[s]}
              </button>
            ))}
          </div>
        </div>
        <p className="text-[11px] text-slate-400">Filter status memilih nota berdasarkan babak kerja: belum data lengkap (draft), pengerjaan selesai, atau sudah diambil konsumen.</p>
      </Card>

      {isLoading && <p className="text-sm text-slate-500">Memuat nota…</p>}
      {!isLoading && tampil.length === 0 && (
        <Card className="p-8 text-center text-slate-500">
          <p>Belum ada nota{cari ? ' yang cocok' : ''}. Tekan <b>Buat Nota Baru</b> atau buka dari view <b>Klaim & Rekap</b>.</p>
        </Card>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {notaBertahap.tampil.map((n) => (
          <Card key={n.id} className="p-4 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <span className="font-mono text-base font-bold tracking-widest">{n.nomorBass}</span>
              <Badge variant="outline" className={STATUS_BADGE[n.status ?? 'draft']}>{STATUS_LABEL[n.status ?? 'draft']}</Badge>
            </div>
            <p className="text-sm font-bold text-slate-800 truncate">{n.nama || '(tanpa nama)'}</p>
            <p className="text-xs text-slate-500">
              {tanggalNota(n.tanggal) || '–'} · {n.merk ?? '–'} {n.model ? `· ${n.model}` : ''}
            </p>
            <p className="text-xs text-slate-600">
              Total: <b>{rupiahNota(hitungBiayaNota(n).total)}</b>
              {hitungBiayaNota(n).garansiPenuh ? ' (garansi)' : ''}
            </p>
            <div className="flex items-center gap-2 pt-1">
              <Button size="sm" variant="outline" onClick={() => { setDraft(n); setMode('edit') }}>
                <FileText className="mr-1 h-4 w-4" /> Buka / Edit
              </Button>
              <Button size="sm" variant="ghost" onClick={() => n.id && duplikatSekarang(n.id)}>
                <Copy className="mr-1 h-4 w-4" /> Duplikat
              </Button>
              <button
                onClick={() => n.id && hapus(n.id)}
                className="ml-auto rounded-md p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                aria-label="Hapus nota"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </Card>
        ))}
      </div>
      <LoadMore
        tampil={notaBertahap.tampil.length}
        total={notaBertahap.total}
        onMore={notaBertahap.tambah}
        satuan="nota"
      />
    </div>
  )
}
