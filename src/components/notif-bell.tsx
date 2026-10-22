'use client'

import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell, BellRing, ChevronRight, PackagePlus, Ticket, AlertTriangle, CheckCheck } from 'lucide-react'
import { fetcher, postJson, formatWaktu, type NotifikasiItem, type NotifikasiResponse } from '@/lib/api'
import { useAppStore } from '@/lib/store'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

/**
 * Lonceng notifikasi (header kanan atas)
 * ---------------------------------------
 * Sumber notifikasi = SERVER (tabel Notifikasi), bukan localStorage browser:
 *  • Registrasi Service unit baru  → notifikasi "REGISTRASI_UNIT"
 *  • Tiket service baru            → notifikasi "TIKET_BARU"
 * Semua role (teknisi / admin / manager) melihat daftar yang sama; status
 * "sudah dibaca" disimpan per pengguna, jadi membuka lonceng di satu komputer
 * tidak menghapus notifikasi untuk pengguna lain.
 *
 * Perilaku:
 *  • Badge merah = jumlah notifikasi BELUM dibaca (menurah = belum dilihat).
 *  • Notifikasi baru muncul sebagai toast popup agar tidak terlupa.
 *  • Klik baris → lonceng ditandai terbaca + melompat ke layar tujuan
 *    (unit → Master Data › Unit Asset, tiket → Proses Service).
 *  • Polling 20 detik.
 */
export default function NotifBell() {
  const navigateTo = useAppStore((s) => s.navigateTo)
  const user = useAppStore((s) => s.user)
  const queryClient = useQueryClient()
  const [buka, setBuka] = useState(false)

  const { data } = useQuery<NotifikasiResponse>({
    queryKey: ['notifikasi'],
    queryFn: () => fetcher<NotifikasiResponse>('/api/notifikasi'),
    refetchInterval: 20_000,
    enabled: !!user,
    retry: false,
  })

  const items = data?.items ?? []
  const belumDibaca = data?.belumDibaca ?? 0

  // Toast popup untuk notifikasi baru (agar tidak terlupa). Baseline diambil
  // dari data pertama — toast hanya untuk notifikasi yang muncul SESUDAHnya.
  const maxIdRef = useRef<number | null>(null)
  useEffect(() => {
    if (!items.length) return
    const maxId = items.reduce((m, i) => Math.max(m, i.id), 0)
    const sebelumnya = maxIdRef.current
    maxIdRef.current = maxId
    if (sebelumnya === null || maxId <= sebelumnya) return
    const baru = items.filter((i) => i.id > sebelumnya && !i.dibaca)
    const terbaru = baru[0]
    if (!terbaru) return
    toast({
      title: terbaru.judul,
      description: terbaru.pesan.replace(/\n/g, ' · '),
      variant: 'default',
    })
  }, [items])

  const tandaiDibaca = async (ids: number[]) => {
    if (!ids.length) return
    try {
      await postJson('/api/notifikasi', { ids })
    } catch {
      // gagal menandai → biarkan badge tetap, tidak boleh mengganggu alur
    }
    await queryClient.invalidateQueries({ queryKey: ['notifikasi'] })
  }

  const tandaiSemua = async () => {
    try {
      await postJson('/api/notifikasi', { semua: true })
    } catch {
      // abaikan
    }
    await queryClient.invalidateQueries({ queryKey: ['notifikasi'] })
  }

  const bukaNotif = async (item: NotifikasiItem) => {
    setBuka(false)
    if (!item.dibaca) void tandaiDibaca([item.id])
    if (item.refType === 'unit' || item.refType === 'unit-massal') {
      navigateTo('master', { masterTab: 'unit' })
    } else if (item.refType === 'alert') {
      navigateTo('dashboard')
    } else {
      navigateTo('service')
    }
  }

  // Belum dibaca di paling atas, lalu terbaru dulu.
  const daftar = [...items].sort((a, b) => {
    if (a.dibaca !== b.dibaca) return a.dibaca ? 1 : -1
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  })

  return (
    <Popover open={buka} onOpenChange={setBuka}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="relative rounded-full p-2 text-slate-600 transition-colors hover:bg-slate-100"
          aria-label={belumDibaca > 0 ? `Notifikasi — ${belumDibaca} belum dibaca` : 'Notifikasi'}
        >
          {belumDibaca > 0 ? <BellRing className="h-5 w-5 text-emerald-700" /> : <Bell className="h-5 w-5" />}
          {belumDibaca > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold leading-none text-white">
              { belumDibaca > 99 ? '99+' : belumDibaca }
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0">
        <div className="flex items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Notifikasi Masuk Baru
            {belumDibaca > 0 && <span className="ml-1 text-red-600">({belumDibaca})</span>}
          </p>
          {belumDibaca > 0 && (
            <button
              type="button"
              onClick={() => void tandaiSemua()}
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 transition-colors hover:bg-emerald-50"
            >
              <CheckCheck className="h-3 w-3" /> Tandai semua terbaca
            </button>
          )}
        </div>
        <div className="max-h-80 overflow-y-auto">
          {daftar.length === 0 ? (
            <p className="px-3 py-8 text-center text-xs text-slate-500">Belum ada notifikasi masuk.</p>
          ) : (
            daftar.slice(0, 30).map((item) => {
              const isUnit = item.tipe === 'REGISTRASI_UNIT'
              const isAlert = item.tipe === 'ALERT'
              const Ikon = isUnit ? PackagePlus : isAlert ? AlertTriangle : Ticket
              return (
                <button
                  key={item.id}
                  type="button"
                  className={cn(
                    'block w-full border-b border-slate-100 px-3 py-2 text-left transition-colors last:border-b-0',
                    item.dibaca ? 'opacity-60 hover:bg-slate-50' : isUnit ? 'hover:bg-sky-50/60' : isAlert ? 'hover:bg-amber-50/60' : 'hover:bg-emerald-50/60'
                  )}
                  onClick={() => void bukaNotif(item)}
                  aria-label={`Buka notifikasi ${item.judul}`}
                >
                  <div className="flex items-center gap-1.5">
                    <Ikon className={cn('h-3.5 w-3.5 shrink-0', isUnit ? 'text-sky-600' : isAlert ? 'text-amber-600' : 'text-emerald-600')} aria-hidden />
                    <span
                      className={cn(
                        'rounded-full px-1.5 py-0.5 text-[9px] font-bold',
                        isUnit ? 'bg-sky-100 text-sky-800' : isAlert ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'
                      )}
                    >
                      {isUnit ? 'REGISTRASI' : isAlert ? 'ALERT' : 'TIKET'}
                    </span>
                    {item.refLabel && (
                      <span className="truncate font-mono text-[11px] font-semibold text-slate-800">{item.refLabel}</span>
                    )}
                    {!item.dibaca && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-red-500" aria-hidden />}
                    <span className="ml-auto shrink-0 text-[10px] text-slate-400">{formatWaktu(item.createdAt)}</span>
                  </div>
                  <p className="truncate text-[11px] font-medium text-slate-700">{item.judul}</p>
                  <p className="truncate text-[11px] text-slate-600">{item.pesan.replace(/\n/g, ' — ')}</p>
                  {item.dibuatOleh && (
                    <p className="truncate text-[10px] text-slate-400">oleh {item.dibuatOleh}</p>
                  )}
                </button>
              )
            })
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
