'use client'

import { useEffect, useRef, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import SearchSelect from '@/components/search-select'
import HistoryInput from '@/components/history-input'
import type { ServiceTicket, Sparepart } from '@/lib/api'
import { cn } from '@/lib/utils'
import {
  CheckCircle2,
  Circle,
  LoaderCircle,
  ClipboardList,
  Stethoscope,
  MessagesSquare,
  MessageCircle,
  Wrench,
  PackageX,
  PackagePlus,
  Truck,
  PackageCheck,
  Store,
  Flag,
  X,
} from 'lucide-react'

export const SUMBER_LABEL: Record<string, string> = {
  KUNJUNGAN: 'Kunjungan toko',
  LAPORAN_TOKO: 'Laporan toko',
  LAPORAN_CUSTOMER: 'Laporan customer',
  WA_BOT: 'Laporan WA Bot',
  MANUAL: 'Manual',
}

export const PENANGANAN_LABEL: Record<string, string> = {
  BELUM: 'Belum ditentukan',
  TUNGGU_PART_TOKO: 'Teregistrasi — simpan di toko',
  DI_TOKO: 'Dikerjakan di toko',
  TARIK_WORKSHOP: 'Ditarik ke workshop',
}

interface Stage {
  key: string
  label: string
  desc: string
  state: 'done' | 'now' | 'todo' | 'skip'
}

/** Hitung 7 tahap alur service lapangan dari kondisi tiket. */
export function flowStages(t: ServiceTicket): Stage[] {
  const butuhPart = t.parts.length > 0
  const konfirmasiSelesai = !butuhPart || t.parts.every((p) => p.statusKonfirmasi !== 'MENUNGGU')
  const adaTidakReady = t.parts.some((p) => p.statusKonfirmasi === 'TIDAK_READY')
  const semuaReady = !butuhPart || t.parts.every((p) => p.statusPart === 'READY')
  const penangananOk = t.penanganan !== 'BELUM'
  const sjOk = !butuhPart || !!t.noSuratJalan
  const kembaliOk = t.lokasiUnit === 'TOKO' && (t.sttbDicabut || !t.noSttb)
  const finishOk = t.status === 'FINISH'

  const stages: Stage[] = [
    {
      key: 'lapor',
      label: `Laporan diterima (${SUMBER_LABEL[t.sumberLaporan] ?? t.sumberLaporan})`,
      desc: 'Kunjungan toko / laporan toko / laporan customer',
      state: 'done',
    },
    {
      key: 'identifikasi',
      label: butuhPart
        ? `Butuh ${t.parts.length} sparepart — unit ${t.unitAsset.serialNumber}`
        : 'Unit diidentifikasi — tanpa sparepart',
      desc: 'Kerusakan, model & SN dicek teknisi',
      state: 'done',
    },
    {
      key: 'konfirmasi',
      label: !butuhPart
        ? 'Konfirmasi produsen — tidak diperlukan'
        : konfirmasiSelesai
          ? adaTidakReady
            ? 'Produsen: ada part TIDAK READY'
            : 'Produsen: part READY'
          : 'Menunggu konfirmasi produsen via WA',
      desc: 'Kode + nama part rusak & status ready stok',
      state: !butuhPart || konfirmasiSelesai ? 'done' : t.status === 'REQUEST' ? 'now' : 'todo',
    },
    {
      key: 'penanganan',
      label: penangananOk ? `Penanganan: ${PENANGANAN_LABEL[t.penanganan]}` : 'Tentukan penanganan',
      desc: 'Part tidak ready → simpan di toko · ready → kerjakan di toko / tarik + STTB',
      state: penangananOk ? 'done' : konfirmasiSelesai || !butuhPart ? 'now' : 'todo',
    },
    {
      key: 'sj',
      label: !butuhPart ? 'Surat jalan — tidak diperlukan' : t.noSuratJalan ? `Part rusak terkirim (${t.noSuratJalan})` : 'Kirim part rusak + surat jalan',
      desc: 'Bongkar unit, daftar part rusak ke produsen',
      state: sjOk ? 'done' : t.status === 'PROSES' ? 'now' : 'todo',
    },
    {
      key: 'pasang',
      label: semuaReady ? 'Part siap / terpasang' : 'Menunggu part baru dari produsen',
      desc: 'Produsen kirim part baru → dipasang teknisi',
      state: semuaReady ? 'done' : 'now',
    },
    {
      key: 'kembali',
      label: finishOk
        ? 'Selesai — nota stempel + TTD'
        : kembaliOk
          ? 'Unit kembali di toko — ajukan nota servis'
          : t.lokasiUnit === 'WORKSHOP'
            ? 'Unit di workshop — kembalikan + cabut STTB'
            : 'Unit di toko',
      desc: 'STTB dicabut → nota servis → stempel & tanda tangan',
      state: finishOk ? 'done' : t.status === 'PROSES' ? 'now' : 'todo',
    },
  ]
  return stages
}

const STAGE_ICON = [ClipboardList, Stethoscope, MessagesSquare, Wrench, PackageX, Truck, PackageCheck, Store, Flag]

export function ServiceFlowStepper({ ticket }: { ticket: ServiceTicket }) {
  const stages = flowStages(ticket)
  return (
    <div className="rounded-lg border p-3">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Alur Service Lapangan</p>
      <div className="mb-2 flex flex-wrap gap-1.5">
        <Badge variant="outline" className="text-[9px]">{SUMBER_LABEL[ticket.sumberLaporan] ?? ticket.sumberLaporan}</Badge>
        <Badge variant="outline" className={cn('text-[9px]', ticket.tipeCustomer === 'TOKO' ? 'border-emerald-300 text-emerald-700' : 'border-slate-300 text-slate-600')}>
          {ticket.tipeCustomer === 'TOKO' ? 'Stok toko (garansi)' : 'Perorangan'}
        </Badge>
        <Badge variant="outline" className={cn('text-[9px]', ticket.lokasiUnit === 'WORKSHOP' ? 'border-violet-300 text-violet-700' : 'border-slate-300 text-slate-600')}>
          {ticket.lokasiUnit === 'WORKSHOP' ? 'Unit di WORKSHOP' : 'Unit di TOKO'}
        </Badge>
        <Badge variant="outline" className="text-[9px]">{PENANGANAN_LABEL[ticket.penanganan] ?? ticket.penanganan}</Badge>
        {ticket.noSttb && (
          <Badge variant="outline" className={cn('text-[9px]', ticket.sttbDicabut ? 'border-slate-300 text-slate-500 line-through' : 'border-teal-300 text-teal-700')}>
            {ticket.noSttb}{ticket.sttbDicabut ? ' (dicabut)' : ''}
          </Badge>
        )}
        {ticket.noSuratJalan && <Badge variant="outline" className="text-[9px]">SJ {ticket.noSuratJalan}</Badge>}
      </div>
      <ol className="space-y-1">
        {stages.map((s, i) => {
          const Icon = STAGE_ICON[Math.min(i, STAGE_ICON.length - 1)]
          return (
            <li key={s.key} className="flex items-start gap-2">
              {s.state === 'done' ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
              ) : s.state === 'now' ? (
                <LoaderCircle className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-amber-600" />
              ) : (
                <Circle className="mt-0.5 h-4 w-4 shrink-0 text-slate-300" />
              )}
              <div className="min-w-0">
                <p className={cn('flex items-center gap-1.5 text-xs font-medium', s.state === 'done' ? 'text-slate-800' : s.state === 'now' ? 'text-amber-800' : 'text-slate-400')}>
                  <Icon className="h-3 w-3 shrink-0" /> {i + 1}. {s.label}
                </p>
                <p className="ml-4.5 text-[10px] text-slate-400">{s.desc}</p>
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

export interface SaranPart {
  kodePart: string
  namaPart: string
  count: number
}

interface ActionsProps {
  ticket: ServiceTicket
  pending: boolean
  onAction: (body: Record<string, unknown>) => void
  spareparts?: Sparepart[]
  saran?: SaranPart[]
  onKirimWa?: () => void
  waPending?: boolean
}

/** Tombol aksi kontekstual sesuai tahap alur. */
export function ServiceFlowActions({ ticket, pending, onAction, spareparts, saran, onKirimWa, waPending }: ActionsProps) {
  const [sj, setSj] = useState('')
  // Baris dinamis kode + nama part (balasan produsen) — baris kosong baru
  // otomatis bertambah saat baris terakhir terisi lengkap.
  type BalasRow = { key: number; kode: string; nama: string; qty: string }
  const [balasRows, setBalasRows] = useState<BalasRow[]>([{ key: 0, kode: '', nama: '', qty: '1' }])
  const balasKey = useRef(1)
  // Baris dinamis tambah sparepart katalog — perilaku auto-tambah yang sama.
  type TambahRow = { key: number; sparepartId: string; qty: string }
  const [tambahRows, setTambahRows] = useState<TambahRow[]>([{ key: 0, sparepartId: '', qty: '1' }])
  const tambahKey = useRef(1)
  // Kerusakan quick-edit (REQUEST/PROSES) — tersimpan via UPDATE_JASA.
  const [rusak, setRusak] = useState(ticket.deskripsiKerusakan ?? '')
  // Ganti tiket → ulangi form dari awal
  useEffect(() => {
    setBalasRows([{ key: balasKey.current++, kode: '', nama: '', qty: '1' }])
    setTambahRows([{ key: tambahKey.current++, sparepartId: '', qty: '1' }])
    setRusak(ticket.deskripsiKerusakan ?? '')
    setSj('')
  }, [ticket.id])
  useEffect(() => {
    setBalasRows((rows) => {
      const last = rows[rows.length - 1]
      if (last && last.kode.trim() && last.nama.trim()) {
        return [...rows, { key: balasKey.current++, kode: '', nama: '', qty: '1' }]
      }
      return rows
    })
  }, [balasRows])
  useEffect(() => {
    setTambahRows((rows) => {
      const last = rows[rows.length - 1]
      if (last && last.sparepartId) {
        return [...rows, { key: tambahKey.current++, sparepartId: '', qty: '1' }]
      }
      return rows
    })
  }, [tambahRows])
  const balasKodeList = balasRows.map((r) => r.kode.trim().toUpperCase())
  const dupBalasKode = (() => {
    const count = new Map<string, number>()
    for (const k of balasKodeList) if (k) count.set(k, (count.get(k) ?? 0) + 1)
    return new Set(balasKodeList.filter((k) => k && (count.get(k) ?? 0) > 1))
  })()
  const isiBalasSaran = (kodePart: string, namaPart: string) => {
    setBalasRows((rows) => {
      const idx = rows.findIndex((r) => !r.kode.trim() && !r.nama.trim())
      if (idx >= 0) return rows.map((r, i) => (i === idx ? { ...r, kode: kodePart, nama: namaPart } : r))
      return [...rows, { key: balasKey.current++, kode: kodePart, nama: namaPart, qty: '1' }]
    })
  }
  const hapusBalasRow = (key: number) =>
    setBalasRows((rows) => (rows.length > 1 ? rows.filter((r) => r.key !== key) : rows))
  const hapusTambahRow = (key: number) =>
    setTambahRows((rows) => (rows.length > 1 ? rows.filter((r) => r.key !== key) : rows))
  const rusakBerubah = rusak !== (ticket.deskripsiKerusakan ?? '')
  const butuhPart = ticket.parts.length > 0
  const menunggu = ticket.parts.filter((p) => p.statusKonfirmasi === 'MENUNGGU')
  const adaTidakReady = ticket.parts.some((p) => p.statusKonfirmasi === 'TIDAK_READY')
  const semuaPartReady = !butuhPart || ticket.parts.every((p) => p.statusPart === 'READY')
  const orderParts = ticket.parts.filter((p) => p.statusPart === 'ORDER_PRODUSEN')

  return (
    <div className="space-y-2 rounded-lg border border-dashed p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Aksi Alur</p>

      {/* 1-klik kirim ke produsen + input balasannya (kode + nama) */}
      {(ticket.status === 'REQUEST' || ticket.status === 'PROSES') && (
        <div className="space-y-1.5 rounded-md border border-emerald-300 bg-emerald-50/60 p-2">
          <Label className="text-xs">Produsen — kirim &amp; catat balasan (cukup kode + nama)</Label>
          <Button
            size="sm"
            className="h-7 w-full bg-[#25D366] text-[11px] text-white hover:bg-[#1fb857]"
            disabled={pending || waPending || !onKirimWa}
            onClick={() => onKirimWa?.()}
          >
            <MessageCircle className="mr-1 h-3 w-3" /> {waPending ? 'Menyiapkan…' : 'Kirim ke Produsen via WA'}
          </Button>
          {(saran ?? []).length > 0 && (
            <div className="flex flex-wrap items-center gap-1">
              <span className="text-[10px] text-slate-500">Sering dipakai {ticket.unitAsset.modelUnit}:</span>
              {(saran ?? []).map((s) => (
                <button
                  key={s.kodePart}
                  type="button"
                  className="rounded-full border border-teal-300 bg-white px-2 py-0.5 font-mono text-[10px] text-teal-700 hover:bg-teal-50"
                  title={`${s.namaPart} — dipakai ${s.count}× sebelumnya`}
                  onClick={() => isiBalasSaran(s.kodePart, s.namaPart)}
                >
                  {s.kodePart} ({s.count}×)
                </button>
              ))}
            </div>
          )}
          {balasRows.map((row, i) => {
            const kodeRow = row.kode.trim().toUpperCase()
            const dup = kodeRow !== '' && dupBalasKode.has(kodeRow)
            const lengkap = row.kode.trim() !== '' && row.nama.trim() !== ''
            return (
              <div key={row.key} className="space-y-1">
                <div className="flex gap-1.5">
                  <Input value={row.kode} onChange={(e) => setBalasRows((rows) => rows.map((r) => (r.key === row.key ? { ...r, kode: e.target.value.toUpperCase() } : r)))} placeholder="Kode part" className={cn('h-7 font-mono text-[11px]', dup && 'border-red-400')} aria-label={`Kode sparepart baris ${i + 1}`} />
                  <Input value={row.nama} onChange={(e) => setBalasRows((rows) => rows.map((r) => (r.key === row.key ? { ...r, nama: e.target.value } : r)))} placeholder="Nama part" className="h-7 text-[11px]" aria-label={`Nama sparepart baris ${i + 1}`} />
                  <Input type="number" min="1" value={row.qty} onChange={(e) => setBalasRows((rows) => rows.map((r) => (r.key === row.key ? { ...r, qty: e.target.value } : r)))} className="h-7 w-14 shrink-0 text-[11px]" aria-label={`Jumlah baris ${i + 1}`} />
                  <Button
                    size="sm"
                    className="h-7 shrink-0 bg-teal-600 text-[11px] hover:bg-teal-700"
                    disabled={pending || !lengkap || Number(row.qty) < 1 || dup}
                    title={lengkap ? 'Catat part ini ke tiket' : 'Isi kode + nama dulu'}
                    onClick={() => {
                      onAction({ aksi: 'INPUT_PART_PRODUSEN', kodePart: row.kode.trim(), namaPart: row.nama.trim(), qty: Number(row.qty) })
                      setBalasRows((rows) => {
                        const next = rows.filter((r) => r.key !== row.key)
                        return next.length ? next : [{ key: balasKey.current++, kode: '', nama: '', qty: '1' }]
                      })
                    }}
                  >
                    <PackagePlus className="mr-1 h-3 w-3" /> Catat
                  </Button>
                  {balasRows.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0 text-slate-400 hover:text-red-600"
                      onClick={() => hapusBalasRow(row.key)}
                      aria-label={`Hapus baris ${i + 1}`}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
                {dup && (
                  <p className="text-[10px] font-medium text-red-600">Kode {kodeRow} sudah ada di baris lain — gabungkan qty-nya jadi satu baris.</p>
                )}
              </div>
            )
          })}
          <p className="text-[10px] text-slate-400">Baris kosong otomatis bertambah saat kode + nama terisi. Kode baru otomatis masuk katalog &amp; muncul di surat jalan.</p>
          {!balasRows.some((r) => r.kode.trim() && r.nama.trim()) && (
            <p className="text-[10px] text-amber-700">Isi kode + nama part untuk mengaktifkan tombol Catat.</p>
          )}
        </div>
      )}

      {ticket.status === 'REQUEST' && menunggu.length > 0 && (
        <div className="space-y-1.5">
          <Label className="text-xs">Konfirmasi produsen via WA — {menunggu.length} part menunggu</Label>
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" className="h-7 bg-teal-600 text-[11px] hover:bg-teal-700" disabled={pending} onClick={() => onAction({ aksi: 'KONFIRMASI_PRODUSEN', statusKonfirmasi: 'READY' })}>
              <CheckCircle2 className="mr-1 h-3 w-3" /> Produsen READY
            </Button>
            <Button size="sm" variant="outline" className="h-7 border-rose-300 text-[11px] text-rose-700" disabled={pending} onClick={() => onAction({ aksi: 'KONFIRMASI_PRODUSEN', statusKonfirmasi: 'TIDAK_READY' })}>
              <PackageX className="mr-1 h-3 w-3" /> Tidak Ready
            </Button>
          </div>
          {menunggu.map((p) => (
            <div key={p.id} className="flex items-center justify-between gap-2 rounded-md bg-slate-50 px-2 py-1.5">
              <span className="font-mono text-[10px] text-slate-600">{p.sparepart?.kodePart} · {p.sparepart?.namaPart}</span>
              <span className="flex gap-1">
                <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[10px] text-teal-700" disabled={pending} onClick={() => onAction({ aksi: 'KONFIRMASI_PRODUSEN', partId: p.id, statusKonfirmasi: 'READY' })}>Ready</Button>
                <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[10px] text-rose-600" disabled={pending} onClick={() => onAction({ aksi: 'KONFIRMASI_PRODUSEN', partId: p.id, statusKonfirmasi: 'TIDAK_READY' })}>Tidak</Button>
              </span>
            </div>
          ))}
        </div>
      )}

      {ticket.status === 'REQUEST' && ticket.penanganan === 'BELUM' && adaTidakReady && (
        <Button size="sm" variant="outline" className="h-7 w-full border-amber-300 text-[11px] text-amber-800" disabled={pending} onClick={() => onAction({ aksi: 'DAFTAR_TUNGGU_TOKO' })}>
          <Store className="mr-1 h-3 w-3" /> Daftarkan — Unit Tetap di Toko
        </Button>
      )}

      {ticket.penanganan === 'BELUM' && menunggu.length === 0 && ticket.status !== 'FINISH' && (
        <div className="grid grid-cols-2 gap-1.5">
          <Button size="sm" variant="outline" className="h-7 border-emerald-300 text-[11px] text-emerald-700" disabled={pending || !semuaPartReady} title={semuaPartReady ? 'Kerjakan tanpa penarikan' : 'Menunggu part READY — input kode+nama dulu'} onClick={() => onAction({ aksi: 'KERJAKAN_DI_TOKO' })}>
            <Wrench className="mr-1 h-3 w-3" /> Kerjakan di Toko
          </Button>
          <Button size="sm" className="h-7 bg-violet-600 text-[11px] hover:bg-violet-700" disabled={pending || !semuaPartReady} title={semuaPartReady ? 'Tarik + terbitkan STTB' : 'Menunggu part READY — input kode+nama dulu'} onClick={() => onAction({ aksi: 'TARIK_WORKSHOP' })}>
            <Truck className="mr-1 h-3 w-3" /> Tarik + STTB
          </Button>
        </div>
      )}

      {ticket.status === 'PROSES' && orderParts.length > 0 && (
        <Button size="sm" variant="outline" className="h-7 w-full border-teal-300 text-[11px] text-teal-700" disabled={pending} onClick={() => onAction({ aksi: 'TERIMA_PART_PRODUSEN' })}>
          <PackageCheck className="mr-1 h-3 w-3" /> Part Baru Diterima ({orderParts.length})
        </Button>
      )}

      {(ticket.status === 'PROSES' || ticket.status === 'REQUEST') && (spareparts ?? []).length > 0 && (
        <div className="space-y-1.5">
          <Label className="text-xs">Tambah sparepart saat pengerjaan</Label>
          {tambahRows.map((row, i) => (
            <div key={row.key} className="flex gap-1.5">
              <div className="min-w-0 flex-1">
                <SearchSelect
                  value={row.sparepartId}
                  onChange={(v) => setTambahRows((rows) => rows.map((r) => (r.key === row.key ? { ...r, sparepartId: v } : r)))}
                  options={(spareparts ?? []).map((p) => ({
                    value: String(p.id),
                    label: `${p.kodePart} · ${p.namaPart}`,
                    sub: `jual ${p.stokJual}/garansi ${p.stokGaransi}`,
                  }))}
                  placeholder="— Ketik part —"
                  ariaLabel={`Pilih sparepart tambahan baris ${i + 1}`}
                  className="h-7 text-[11px]"
                />
              </div>
              <Input type="number" min="1" value={row.qty} onChange={(e) => setTambahRows((rows) => rows.map((r) => (r.key === row.key ? { ...r, qty: e.target.value } : r)))} className="h-7 w-16 shrink-0 text-[11px]" aria-label={`Jumlah baris ${i + 1}`} />
              <Button
                size="sm"
                className="h-7 shrink-0 bg-teal-600 text-[11px] hover:bg-teal-700"
                disabled={pending || !row.sparepartId || Number(row.qty) < 1}
                onClick={() => {
                  onAction({ aksi: 'TAMBAH_PART', sparepartId: Number(row.sparepartId), qty: Number(row.qty) })
                  setTambahRows((rows) => {
                    const next = rows.filter((r) => r.key !== row.key)
                    return next.length ? next : [{ key: tambahKey.current++, sparepartId: '', qty: '1' }]
                  })
                }}
              >
                Tambah
              </Button>
              {tambahRows.length > 1 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0 text-slate-400 hover:text-red-600"
                  onClick={() => hapusTambahRow(row.key)}
                  aria-label={`Hapus baris ${i + 1}`}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          ))}
          <p className="text-[10px] text-slate-400">Baris kosong otomatis bertambah saat part dipilih. Stok cukup → READY &amp; terpasang. Stok kurang → otomatis ORDER ke produsen.</p>
        </div>
      )}

      {/* Kerusakan quick-edit — tampil di mode REQUEST & PROSES */}
      {(ticket.status === 'REQUEST' || ticket.status === 'PROSES') && (
        <div className="space-y-1.5 rounded-md border p-2">
          <Label className="text-xs">Kerusakan</Label>
          <HistoryInput historyKey="service-deskripsi" value={rusak} onChange={(e) => setRusak(e.target.value)} placeholder="Deskripsi kerusakan…" aria-label="Deskripsi kerusakan" />
          <div className="flex items-center justify-between gap-2">
            <p className="text-[10px] text-slate-400">Ubah lalu Simpan untuk memperbarui tiket.</p>
            <Button
              size="sm"
              className="h-7 shrink-0 bg-emerald-600 text-[11px] hover:bg-emerald-700"
              disabled={pending || !rusak.trim() || !rusakBerubah}
              onClick={() => onAction({ aksi: 'UPDATE_JASA', deskripsiKerusakan: rusak.trim(), biayaJasa: ticket.biayaJasa })}
            >
              Simpan Kerusakan
            </Button>
          </div>
        </div>
      )}

      {ticket.status === 'PROSES' && butuhPart && !ticket.noSuratJalan && (
        <div className="flex gap-1.5">
          <Input value={sj} onChange={(e) => setSj(e.target.value.toUpperCase())} placeholder="No. SJ, cth SJ-20261012-0001" className="h-7 font-mono text-[11px]" aria-label="Nomor surat jalan" />
          <Button size="sm" variant="outline" className="h-7 shrink-0 text-[11px]" disabled={pending || !sj.trim()} onClick={() => onAction({ aksi: 'KIRIM_PART_RUSAK', noSuratJalan: sj.trim() })}>
            <Truck className="mr-1 h-3 w-3" /> Kirim Rusak
          </Button>
        </div>
      )}

      {ticket.status === 'PROSES' && ticket.lokasiUnit === 'WORKSHOP' && !ticket.sttbDicabut && (
        <Button size="sm" variant="outline" className="h-7 w-full border-emerald-300 text-[11px] text-emerald-700" disabled={pending} onClick={() => onAction({ aksi: 'KEMBALI_KE_TOKO' })}>
          <Store className="mr-1 h-3 w-3" /> Kembalikan ke Toko (Cabut STTB)
        </Button>
      )}

      {ticket.status === 'FINISH' && (
        <p className="rounded-md bg-emerald-50 p-2 text-[11px] text-emerald-800">
          <Flag className="mr-1 inline h-3 w-3" /> Selesai — nota stempel + TTD. Lanjut ke klaim produsen bila ada part garansi.
        </p>
      )}
    </div>
  )
}
