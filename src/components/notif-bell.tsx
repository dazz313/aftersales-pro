'use client'

import { useMemo, useState, useSyncExternalStore } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Bell, BellRing, ChevronRight, PackagePlus } from 'lucide-react'
import { fetcher, formatWaktu, type ServiceTicket, type UnitAsset } from '@/lib/api'
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
 * Entri notifikasi gabungan: tiket service baru ATAU unit baru hasil
 * Registrasi Service (termasuk unit tanpa nomor seri — diisi belakangan).
 */
type NotifItem =
  | {
      jenis: 'tiket'
      id: number
      waktu: number
      waktuIso: string
      noTiket: string
      status: string
      label: string
      sumber: string | null
    }
  | {
      jenis: 'unit'
      id: number
      waktu: number
      waktuIso: string
      nomor: string
      label: string
      diagnosa: string | null
    }

/**
 * Lonceng notifikasi (header kanan atas) — pemberitahuan PINTU MASUK BARU agar
 * tidak terlewat:
 * • Tiket service baru (semua sumber: manual / WA bot / kunjungan / laporan).
 * • Unit baru hasil Registrasi Service — Master Data → Unit Asset, termasuk
 *   unit yang nomor serinya masih kosong (diisi belakangan via Edit Unit).
 * • Badge merah = jumlah tiket + unit baru sejak terakhir dilihat.
 * • Klik baris tiket → lompat ke menu Proses Service; klik baris unit → Master
 *   Data pada tab Unit Asset. Membuka lonceng = semua dianggap terbaca.
 * • Polling 30 detik memakai cache `service-tickets` & `units` yang sama (hemat
 *   request — tidak membuat endpoint baru).
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
  const [dilihat, setDilihat] = useState<NotifItem[]>([])

  const enabled = lastSeen > 0

  // Polling lazy tiket service — dibagi cache dgn Service View (queryKey sama)
  const { data: tickets } = useQuery<ServiceTicket[]>({
    queryKey: ['service-tickets'],
    queryFn: () => fetcher<ServiceTicket[]>('/api/service'),
    refetchInterval: 30_000,
    enabled,
  })
  // Polling lazy unit asset — dibagi cache dgn Master Data → tab Unit (sama)
  const { data: units } = useQuery<UnitAsset[]>({
    queryKey: ['units'],
    queryFn: () => fetcher<UnitAsset[]>('/api/unit'),
    refetchInterval: 30_000,
    enabled,
  })

  // Baru = createdAt setelah lastSeen (data backdate tetap masuk — yang dihitung
  // adalah kapan data MEMASUKI sistem, yaitu createdAt). Gabungan tiket + unit,
  // diurutkan terbaru dulu.
  const baru = useMemo(() => {
    const tiketRows: NotifItem[] = (tickets ?? [])
      .filter((t) => new Date(t.createdAt).getTime() > lastSeen)
      .map((t) => ({
        jenis: 'tiket' as const,
        id: t.id,
        waktu: new Date(t.createdAt).getTime(),
        waktuIso: t.createdAt,
        noTiket: t.noTiket,
        status: t.status,
        label: `${t.unitAsset.merk?.trim() ? `${t.unitAsset.merk.trim()} · ` : ''}${
          t.unitAsset.modelUnit || t.unitAsset.nama || '(tanpa jenis)'
        }${
          t.unitAsset.toko?.namaToko
            ? ` — ${t.unitAsset.toko.namaToko}`
            : t.unitAsset.customer?.nama
              ? ` — ${t.unitAsset.customer.nama}`
              : ' — tanpa pemilik'
        }`,
        sumber: t.sumberLaporan !== 'MANUAL' ? (SUMBER_LABEL[t.sumberLaporan] ?? t.sumberLaporan) : null,
      }))
    const unitRows: NotifItem[] = (units ?? [])
      .filter((u) => new Date(u.createdAt).getTime() > lastSeen)
      .map((u) => ({
        jenis: 'unit' as const,
        id: u.id,
        waktu: new Date(u.createdAt).getTime(),
        waktuIso: u.createdAt,
        nomor: u.serialNumber,
        label: `${u.merk?.trim() ? `${u.merk.trim()} · ` : ''}${u.nama?.trim() || u.modelUnit || '(tanpa nama)'}${
          u.toko
            ? ` — ${u.toko.kodeToko} — ${u.toko.namaToko}`
            : u.customer?.nama
              ? ` — ${u.customer.nama}`
              : ''
        }`,
        diagnosa: u.kerusakanAwal?.trim() || null,
      }))
    return [...tiketRows, ...unitRows].sort((a, b) => b.waktu - a.waktu)
  }, [tickets, units, lastSeen])

  const bukaHandler = (open: boolean) => {
    setBuka(open)
    if (open) {
      setDilihat(baru) // snapshot daftar baru agar list tetap tampil satu sesi popover
      tulisTs(Date.now()) // tandai sudah terbaca — badge hilang
    }
  }

  // Saat popover terbuka, `baru` sudah di-nol-kan (sudah terbaca) → tampilkan snapshot
  const daftar = baru.length > 0 ? baru : dilihat

  const bukaNotif = (item: NotifItem) => {
    if (item.jenis === 'tiket') navigateTo('service')
    else navigateTo('master', { masterTab: 'unit' })
    setBuka(false)
  }

  return (
    <Popover open={buka} onOpenChange={bukaHandler}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="relative rounded-full p-2 text-slate-600 transition-colors hover:bg-slate-100"
          aria-label={baru.length > 0 ? `Notifikasi — ${baru.length} tiket/unit baru` : 'Notifikasi req service'}
        >
          {baru.length > 0 ? <BellRing className="h-5 w-5 text-emerald-700" /> : <Bell className="h-5 w-5" />}
          {baru.length > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold leading-none text-white">
              { baru.length > 99 ? '99+' : baru.length}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-3 py-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Notifikasi Masuk Baru</p>
          {daftar.length > 0 && (
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">
              {daftar.length} notifikasi
            </span>
          )}
        </div>
        <div className="max-h-72 overflow-y-auto">
          {daftar.length === 0 ? (
            <p className="px-3 py-8 text-center text-xs text-slate-500">Tidak ada yang baru — semua sudah terbaca.</p>
          ) : (
            daftar.slice(0, 10).map((item) =>
              item.jenis === 'tiket' ? (
                <button
                  key={`tiket-${item.id}`}
                  type="button"
                  className="block w-full border-b border-slate-100 px-3 py-2 text-left transition-colors last:border-b-0 hover:bg-emerald-50/60"
                  onClick={() => bukaNotif(item)}
                  aria-label={`Buka tiket ${item.noTiket}`}
                >
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-[11px] font-semibold text-slate-800">{item.noTiket}</span>
                    <span
                      className={cn(
                        'rounded-full px-1.5 py-0.5 text-[9px] font-bold',
                        item.status === 'FINISH'
                          ? 'bg-emerald-100 text-emerald-800'
                          : item.status === 'PROSES'
                            ? 'bg-violet-100 text-violet-800'
                            : 'bg-amber-100 text-amber-800'
                      )}
                    >
                      {item.status}
                    </span>
                    <span className="ml-auto text-[10px] text-slate-400">{formatWaktu(item.waktuIso)}</span>
                  </div>
                  <p className="truncate text-[11px] text-slate-600">
                    {item.label}
                    {item.sumber ? ` (${item.sumber})` : ''}
                  </p>
                </button>
              ) : (
                <button
                  key={`unit-${item.id}`}
                  type="button"
                  className="block w-full border-b border-slate-100 px-3 py-2 text-left transition-colors last:border-b-0 hover:bg-sky-50/60"
                  onClick={() => bukaNotif(item)}
                  aria-label="Buka data unit di Master Data"
                >
                  <div className="flex items-center gap-1.5">
                    <PackagePlus className="h-3.5 w-3.5 shrink-0 text-sky-600" aria-hidden />
                    <span className="rounded-full bg-sky-100 px-1.5 py-0.5 text-[9px] font-bold text-sky-800">
                      REGISTRASI
                    </span>
                    {item.nomor && (
                      <span className="font-mono text-[11px] font-semibold text-slate-800">{item.nomor}</span>
                    )}
                    <span className="ml-auto text-[10px] text-slate-400">{formatWaktu(item.waktuIso)}</span>
                  </div>
                  <p className="truncate text-[11px] text-slate-600">
                    {item.label}
                    {item.diagnosa ? ` — ${item.diagnosa}` : ''}
                  </p>
                </button>
              )
            )
          )}
        </div>
        <div className="flex border-t border-slate-200 bg-slate-50 p-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="flex-1 justify-between text-xs text-emerald-700 hover:bg-emerald-50"
            onClick={() => {
              navigateTo('service')
              setBuka(false)
            }}
          >
            Proses Service <ChevronRight className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="flex-1 justify-between text-xs text-sky-700 hover:bg-sky-50"
            onClick={() => {
              navigateTo('master', { masterTab: 'unit' })
              setBuka(false)
            }}
          >
            Master Data <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
