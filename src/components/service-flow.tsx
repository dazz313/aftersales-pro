'use client'

import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { ServiceTicket } from '@/lib/api'
import { cn } from '@/lib/utils'
import {
  CheckCircle2,
  Circle,
  LoaderCircle,
  ClipboardList,
  Stethoscope,
  MessagesSquare,
  Wrench,
  PackageX,
  Truck,
  PackageCheck,
  Store,
  Flag,
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

interface ActionsProps {
  ticket: ServiceTicket
  pending: boolean
  onAction: (body: Record<string, unknown>) => void
}

/** Tombol aksi kontekstual sesuai tahap alur. */
export function ServiceFlowActions({ ticket, pending, onAction }: ActionsProps) {
  const [sj, setSj] = useState('')
  const butuhPart = ticket.parts.length > 0
  const menunggu = ticket.parts.filter((p) => p.statusKonfirmasi === 'MENUNGGU')
  const adaTidakReady = ticket.parts.some((p) => p.statusKonfirmasi === 'TIDAK_READY')
  const semuaPartReady = !butuhPart || ticket.parts.every((p) => p.statusPart === 'READY')
  const orderParts = ticket.parts.filter((p) => p.statusPart === 'ORDER_PRODUSEN')

  return (
    <div className="space-y-2 rounded-lg border border-dashed p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Aksi Alur</p>

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

      {ticket.status === 'REQUEST' && ticket.penanganan === 'BELUM' && menunggu.length === 0 && (
        <div className="grid grid-cols-2 gap-1.5">
          <Button size="sm" variant="outline" className="h-7 border-emerald-300 text-[11px] text-emerald-700" disabled={pending || !semuaPartReady} title={semuaPartReady ? 'Kerjakan tanpa penarikan' : 'Menunggu part READY'} onClick={() => onAction({ aksi: 'KERJAKAN_DI_TOKO' })}>
            <Wrench className="mr-1 h-3 w-3" /> Kerjakan di Toko
          </Button>
          <Button size="sm" className="h-7 bg-violet-600 text-[11px] hover:bg-violet-700" disabled={pending || !semuaPartReady} title={semuaPartReady ? 'Tarik + terbitkan STTB' : 'Menunggu part READY'} onClick={() => onAction({ aksi: 'TARIK_WORKSHOP' })}>
            <Truck className="mr-1 h-3 w-3" /> Tarik + STTB
          </Button>
        </div>
      )}

      {ticket.status === 'PROSES' && orderParts.length > 0 && (
        <Button size="sm" variant="outline" className="h-7 w-full border-teal-300 text-[11px] text-teal-700" disabled={pending} onClick={() => onAction({ aksi: 'TERIMA_PART_PRODUSEN' })}>
          <PackageCheck className="mr-1 h-3 w-3" /> Part Baru Diterima ({orderParts.length})
        </Button>
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
