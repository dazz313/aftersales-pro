'use client'

import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { MessageCircle, X } from 'lucide-react'
import { fetcher, postJson } from '@/lib/api'
import { useAppStore } from '@/lib/store'
import { Button } from '@/components/ui/button'
import ChatPanel from '@/components/chat-panel'
import { cn } from '@/lib/utils'
import type { ChatData } from '@/lib/types'
import { ambilReadMap, tandaiThreadBaca, totalUnread } from '@/lib/chat'

/**
 * MiniChat — widget komunikasi antar akun yang melayang di semua view.
 *  - FAB kanan-bawah dgn badge jumlah pesan belum dibaca (polling 12 dtk /
 *    4 dtk saat panel terbuka).
 *  - Panel: pilih akun (papan umum "Semua Akun" / DM) → kirim & balas pesan.
 *  - Status baca disimpan cache modul + localStorage (lib/chat.ts) — tanpa
 *    state React sehingga widget & view Komunikasi selalu senada, dan aman
 *    dari aturan react-hooks/set-state-in-effect (penandaan baca berbasis
 *    event klik, bukan effect).
 */
export default function MiniChat() {
  const user = useAppStore((s) => s.user)
  const view = useAppStore((s) => s.view)
  const [buka, setBuka] = useState(false)
  const [thread, setThread] = useState('SEMUA')
  const queryClient = useQueryClient()

  const { data } = useQuery<ChatData>({
    queryKey: ['chat'],
    queryFn: () => fetcher<ChatData>('/api/chat'),
    enabled: !!user,
    refetchInterval: buka ? 4_000 : 12_000,
    retry: false,
  })
  const meId = data?.meId ?? user?.id ?? 0

  // Badge dihitung dari cache status baca (modul) + pesan terbaru; deps
  // buka & thread menjaga nilai segar setelah penandaan baca event-driven.
  const unreadTotal = useMemo(
    () => (data ? totalUnread(data.pesan, meId, ambilReadMap(meId)) : 0),
    [data, meId, buka, thread]
  )

  const kirimMut = useMutation({
    mutationFn: (tujuan: { penerimaId: number | null; isi: string }) => postJson('/api/chat', tujuan),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chat'] })
    },
  })

  // Sembunyikan widget di view komunikasi (versi penuh sudah ada) & saat belum login
  if (!user || view === 'komunikasi') return null

  const toggleBuka = () => {
    const jadiBuka = !buka
    setBuka(jadiBuka)
    if (jadiBuka) tandaiThreadBaca(meId, thread) // membuka panel = membaca thread aktif
  }
  const bukaThreadBaru = (th: string) => {
    setThread(th)
    tandaiThreadBaca(meId, th)
  }

  return (
    <>
      {/* FAB kanan bawah */}
      <button
        onClick={toggleBuka}
        aria-label={buka ? 'Tutup MiniChat' : `Buka MiniChat${unreadTotal ? ` — ${unreadTotal} pesan belum dibaca` : ''}`}
        className={cn(
          'fixed bottom-5 right-5 z-40 flex h-12 w-12 items-center justify-center rounded-full shadow-lg ring-4 ring-emerald-500/20 transition-transform hover:scale-105 active:scale-95',
          buka ? 'bg-slate-800 text-white' : 'bg-emerald-600 text-white'
        )}
      >
        {buka ? <X className="h-5 w-5" /> : <MessageCircle className="h-6 w-6" />}
        {!buka && unreadTotal > 0 && (
          <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-bold text-white">
            {unreadTotal > 99 ? '99+' : unreadTotal}
          </span>
        )}
      </button>

      {/* Panel */}
      {buka && (
        <div
          role="dialog"
          aria-label="MiniChat — komunikasi antar akun"
          className="fixed bottom-20 right-5 z-40 flex h-[26rem] w-[21rem] max-w-[calc(100vw-2.5rem)] flex-col overflow-hidden rounded-xl border bg-white shadow-2xl sm:h-[28rem] sm:w-[24rem]"
        >
          <div className="flex items-center justify-between border-b bg-slate-900 px-3 py-2">
            <div>
              <p className="text-sm font-bold text-white">MiniChat</p>
              <p className="text-[10px] text-slate-400">Komunikasi antar akun — bukan WA eksternal</p>
            </div>
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-slate-300 hover:text-white" onClick={() => setBuka(false)} aria-label="Tutup">
              <X className="h-4 w-4" />
            </Button>
          </div>
          <ChatPanel
            compact
            users={data?.users ?? []}
            pesan={data?.pesan ?? []}
            meId={meId}
            thread={thread}
            onThread={bukaThreadBaru}
            kirim={kirimMut.mutateAsync}
            kirimPending={kirimMut.isPending}
            onKembali={() => bukaThreadBaru('SEMUA')}
            className="flex-1"
          />
        </div>
      )}
    </>
  )
}
