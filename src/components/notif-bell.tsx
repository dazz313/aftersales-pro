'use client'

import { useMemo, useState, useSyncExternalStore } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Bell, BellRing, ChevronRight } from 'lucide-react'
import { fetcher, formatWaktu, type ServiceTicket } from '@/lib/api'
import { useAppStore } from '@/lib/store'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/** Simpan waktu "terakhir dilihat" notifikasi di localStorage (global, per browser). */
const KEY = 'aspro-notif-last-seen'

// ===== Store kecil lastSeen (dibaca SSR-safe lewat useSyncExternalStore) =====
// cacheTs hanya dilakukan cache modul pada client agar snapshot stabilize antar render.
let cacheTs = 0
const listeners = new Set<() => void>()

function bacaTs(): number {
  if (typeof window === 'undefined') return 0
  if (!cacheTs) {
    const raw = window.localStorage.getItem(KEY)
    const angka = raw ? Number(raw) : NaN
    cacheTs = !Number.isNaN(angka) && angka > 0 ? angka : Date.now()
    try {
      window.localStorage.setItem(KEY, String(cacheTs))
    } catch {
      // localStorage tidak tersedia (mode privat dsb.) — notif tetap jalan sesi ini
    }
  }
  return cacheTs
}

function tulisTs(v: number) {
  cacheTs = v
  try {
    window.localStorage.setItem(KEY, String(v))
  } catch {
    /* abaikan */
  }
  listeners.forEach((l) => l())
}

const SUMBER_LABEL: Record<string, string> = {
  MANUAL: 'Manual',
  WA_BOT: 'Bot WA',
  KUNJUNGAN: 'Kunjungan',
  LAPORAN_TOKO: 'Laporan toko',
  LAPORAN_CUSTOMER: 'Laporan customer',
}

/**
 * Lonceng notifikasi (header kanan atas) — pemberitahuan tiket/req BARU agar
 * tidak terlewat:
 * • Badge merah berisi jumlah tiket baru sejak terakhir dilihat.
 * • Daftar tiket terbaru (dipotong 10) — klik baris → lompat ke Service Tiket.
 * • Membuka lonceng = semua dianggap terbaca (batas "terakhir dilihat" naik).
 * • Polling 30 detik memakai cache `service-tickets` yang sama (hemat request).
 */
export default function NotifBell() {
  const navigateTo = useAppStore((s) => s.navigateTo)
  const lastSeen = useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    bacaTs,
    () => 0
  )
  const [buka, setBuka] = useState(false)
  const [dilihat, setDilihat] = useState<ServiceTicket[]>([])

  // Polling lazy ticket service — dibagi cache dgn Service View (queryKey sama)
  const { data: tickets } = useQuery<ServiceTicket[]>({
    queryKey: ['service-tickets'],
    queryFn: () => fetcher<ServiceTicket[]>('/api/service'),
    refetchInterval: 30_000,
    enabled: lastSeen > 0,
  })

  // Tiket baru = createdAt setelah lastSeen (tiket backdate tetap masuk —
  // yang dihitung adalah kapan tiket MEMASUKI sistem, yaitu createdAt).
  const baru = useMemo(
    () =>
      (tickets ?? [])
        .filter((t) => new Date(t.createdAt).getTime() > lastSeen)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [tickets, lastSeen]
  )

  const bukaHandler = (open: boolean) => {
    setBuka(open)
    if (open) {
      setDilihat(baru) // snapshot daftar baru agar list tetap tampil satu sesi popover
      tulisTs(Date.now()) // tandai sudah terbaca — badge hilang
    }
  }

  // Saat popover terbuka, `baru` sudah di-nol-kan (sudah terbaca) → tampilkan snapshot
  const daftar = baru.length > 0 ? baru : dilihat

  return (
    <Popover open={buka} onOpenChange={bukaHandler}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="relative rounded-full p-2 text-slate-600 transition-colors hover:bg-slate-100"
          aria-label={baru.length > 0 ? `Notifikasi — ${baru.length} req baru` : 'Notifikasi — req service'}
        >
          {baru.length > 0 ? <BellRing className="h-5 w-5 text-emerald-700" /> : <Bell className="h-5 w-5" />}
          {baru.length > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold leading-none text-white">
              {baru.length > 99 ? '99+' : baru.length}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-3 py-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Notifikasi Req Service</p>
          {daftar.length > 0 && (
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">
              {daftar.length} tiket
            </span>
          )}
        </div>
        <div className="max-h-72 overflow-y-auto">
          {daftar.length === 0 ? (
            <p className="px-3 py-8 text-center text-xs text-slate-500">Tidak ada req baru — semua sudah tercatat.</p>
          ) : (
            daftar.slice(0, 10).map((t) => (
              <button
                key={t.id}
                type="button"
                className="block w-full border-b border-slate-100 px-3 py-2 text-left transition-colors last:border-b-0 hover:bg-emerald-50/60"
                onClick={() => {
                  navigateTo('service')
                  setBuka(false)
                }}
                aria-label={`Buka tiket ${t.noTiket}`}
              >
                <div className="flex items-center gap-1.5">
                  <span className="font-mono text-[11px] font-semibold text-slate-800">{t.noTiket}</span>
                  <span
                    className={cn(
                      'rounded-full px-1.5 py-0.5 text-[9px] font-bold',
                      t.status === 'FINISH'
                        ? 'bg-emerald-100 text-emerald-800'
                        : t.status === 'PROSES'
                          ? 'bg-violet-100 text-violet-800'
                          : 'bg-amber-100 text-amber-800'
                    )}
                  >
                    {t.status}
                  </span>
                  <span className="ml-auto text-[10px] text-slate-400">{formatWaktu(t.createdAt)}</span>
                </div>
                <p className="truncate text-[11px] text-slate-600">
                  {t.unitAsset.merk?.trim() ? `${t.unitAsset.merk.trim()} · ` : ''}
                  {t.unitAsset.modelUnit || t.unitAsset.nama || '(tanpa jenis)'}
                  {t.unitAsset.toko?.namaToko
                    ? ` — ${t.unitAsset.toko.namaToko}`
                    : t.unitAsset.customer?.nama
                      ? ` — ${t.unitAsset.customer.nama}`
                      : ' — tanpa pemilik'}
                  {t.sumberLaporan !== 'MANUAL' ? ` (${SUMBER_LABEL[t.sumberLaporan] ?? t.sumberLaporan})` : ''}
                </p>
              </button>
            ))
          )}
        </div>
        <div className="border-t border-slate-200 bg-slate-50 p-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="w-full justify-between text-xs text-emerald-700 hover:bg-emerald-50"
            onClick={() => navigateTo('service')}
          >
            Buka Daftar Tiket Service <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
