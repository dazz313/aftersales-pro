'use client'

import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, SendHorizonal, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useAppStore, ROLE_LABELS, type RoleKey } from '@/lib/store'
import { cn } from '@/lib/utils'
import { formatWaktu } from '@/lib/api'
import type { ChatPesanItem, ChatUser } from '@/lib/types'
import { pesanThread, threadDariPesan } from '@/lib/chat'

/**
 * ChatPanel — isi MiniChat (daftar akun, thread, kotak pesan).
 * Dipakai bersama: widget melayang MiniChat (compact) & tab MiniChat
 * di view Komunikasi (lebar). Data (query poll + kirim) dimiliki parent
 * agar badge unread tetap jalan walau panel tertutup.
 *
 * thread: 'SEMUA' (broadcast) | 'DM:<userId>'
 */
export interface ChatPanelProps {
  compact?: boolean
  users: ChatUser[]
  pesan: ChatPesanItem[]
  meId: number
  thread: string
  onThread: (thread: string) => void
  kirim: (tujuan: { penerimaId: number | null; isi: string }) => Promise<unknown>
  kirimPending?: boolean
  onKembali?: () => void
  className?: string
}

const ROLE_DOT: Record<RoleKey, string> = {
  ADMIN_WORKSHOP: 'bg-emerald-500',
  TEKNISI: 'bg-amber-500',
  MANAGER: 'bg-violet-500',
  PRODUSEN: 'bg-teal-500',
}

export default function ChatPanel({ compact, users, pesan, meId, thread, onThread, kirim, kirimPending, onKembali, className }: ChatPanelProps) {
  const [teks, setTeks] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  // Partner DM saat ini (untuk header baris)
  const partner = thread.startsWith('DM:') ? users.find((u) => u.id === Number(thread.slice(3))) ?? null : null
  const dj = pesanThread(pesan, thread, meId)

  useEffect(() => {
    // Scroll ke bawah tiap thread/pesan berubah — pengguna selalu melihat pesan terbaru
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [dj.length, thread])

  const kirimPesan = async () => {
    const isi = teks.trim()
    if (!isi) return
    setTeks('')
    try {
      await kirim({ penerimaId: thread === 'SEMUA' ? null : Number(thread.slice(3)), isi })
    } catch {
      setTeks(isi) // kembalikan teks bila kirim gagal — tidak hilang
    }
  }

  const daftarThread = [
    { key: 'SEMUA', nama: 'Semua Akun', role: null as RoleKey | null },
    ...users.filter((u) => u.id !== meId).map((u) => ({
      key: `DM:${u.id}`,
      nama: u.nama,
      role: u.role as RoleKey,
    })),
  ]

  return (
    // Compact (widget melayang) = susunan KOLOM: pemilih akun di atas dgn
    // lebar penuh, pesan di bawah — kalau tidak, pemilih jadi "kolom" kiri
    // yang memakan lebar dan nama/gelembung pesan di kanan jadi terpotong.
    // Mode lebar (view Komunikasi) = baris: sidebar kiri + kolom pesan.
    <div className={cn('flex min-h-0 flex-1 overflow-hidden', compact ? 'flex-col' : undefined, className)}>
      {/* Pemilih akun: sidebar daftar akun (lebar) / dropdown (compact) */}
      {!compact ? (
        <div className="flex w-52 shrink-0 flex-col border-r bg-slate-50/60">
          <div className="flex items-center gap-1.5 border-b px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            <Users className="h-3.5 w-3.5" /> Akun
          </div>
          <ScrollArea className="flex-1">
            <div className="space-y-0.5 p-1.5">
              {daftarThread.map((t) => (
                <button
                  key={t.key}
                  onClick={() => onThread(t.key)}
                  aria-current={thread === t.key ? 'true' : undefined}
                  className={cn(
                    'flex w-full items-start gap-2 rounded-md px-2.5 py-2 text-left text-xs transition-colors',
                    thread === t.key ? 'bg-emerald-500/15 font-semibold text-emerald-700' : 'text-slate-600 hover:bg-slate-200/60'
                  )}
                >
                  <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', t.role ? ROLE_DOT[t.role] : 'bg-sky-500')} />
                  <span className="min-w-0 flex-1">
                    {/* Nama boleh 2 baris agar nama panjang tetap terlihat utuh — bukan terpotong */}
                    <span className="line-clamp-2 break-words leading-snug">{t.nama}</span>
                    {t.role ? <span className="block truncate text-[9px] font-normal text-slate-400">{ROLE_LABELS[t.role]}</span> : <span className="block text-[9px] font-normal text-sky-600">papan umum</span>}
                  </span>
                </button>
              ))}
            </div>
          </ScrollArea>
        </div>
      ) : (
        // Baris atas widget compact: tombol kembali (saat DM) + dropdown akun.
        <div className="flex shrink-0 items-center gap-1.5 border-b p-2">
          {partner && (
            <Button size="sm" variant="ghost" className="h-8 w-8 shrink-0 p-0" onClick={onKembali} title="Ganti akun tujuan">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          )}
          <Select value={thread} onValueChange={onThread}>
            {/* Nama panjang tetap tampil 2 baris di trigger — override line-clamp-1 & nowrap bawaan */}
            <SelectTrigger
              aria-label="Ganti thread"
              size="sm"
              className={cn(
                'h-auto min-h-8 w-full flex-1 text-xs whitespace-normal!',
                '[&_[data-slot=select-value]]:h-auto! [&_[data-slot=select-value]]:min-h-5 [&_[data-slot=select-value]]:line-clamp-2! [&_[data-slot=select-value]]:whitespace-normal! [&_[data-slot=select-value]]:break-words!'
              )}
            >
              <SelectValue placeholder="Pilih akun…" />
            </SelectTrigger>
            <SelectContent>
              {daftarThread.map((t) => (
                <SelectItem key={t.key} value={t.key}>
                  {t.nama}
                  {t.role ? ` — ${ROLE_LABELS[t.role as RoleKey]}` : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Kolom pesan */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center justify-between gap-2 border-b px-3 py-2">
          <div className="min-w-0">
            {/* Nama partner 2 baris — nama panjang tetap terbaca utuh */}
            <p className="line-clamp-2 break-words text-sm font-semibold leading-snug text-slate-800">
              {partner ? partner.nama : 'Semua Akun'}
            </p>
            <p className="truncate text-[11px] text-slate-500">
              {partner ? ROLE_LABELS[partner.role] : 'Broadcast — terlihat semua akun'}
            </p>
          </div>
          {!partner && <Badge variant="outline" className="shrink-0 border-sky-300 text-[10px] text-sky-700">PAPAN UMUM</Badge>}
        </div>

        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-2 p-3">
            {dj.length === 0 && (
              <p className="py-10 text-center text-xs text-slate-400">
                Belum ada pesan. {compact ? '<- pilih akun & tulis pesan pertama' : 'Tulis pesan pertama di bawah.'}
              </p>
            )}
            {dj.map((p) => {
              const mine = p.pengirimId === meId
              const pengirim = users.find((u) => u.id === p.pengirimId)
              return (
                <div key={p.id} className={cn('flex', mine ? 'justify-end' : 'justify-start')}>
                  <div className={cn('max-w-[85%] rounded-lg px-2.5 py-1.5 text-xs shadow-sm', mine ? 'bg-emerald-600 text-white' : 'bg-white text-slate-800 ring-1 ring-slate-200')}>
                    {!mine && pengirim && (
                      <p className={cn('mb-0.5 flex items-center gap-1 text-[10px] font-semibold', 'text-slate-500')}>
                        <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', ROLE_DOT[pengirim.role])} />
                        <span className="min-w-0 break-words">{pengirim.nama}</span>
                      </p>
                    )}
                    <p className="whitespace-pre-wrap break-words leading-relaxed">{p.isi}</p>
                    <p className={cn('mt-0.5 text-right text-[9px]', mine ? 'text-emerald-100/90' : 'text-slate-400')}>
                      {formatWaktu(p.createdAt)}
                    </p>
                  </div>
                </div>
              )
            })}
            <div ref={bottomRef} />
          </div>
        </ScrollArea>

        <div className="shrink-0 border-t p-2">
          <div className="flex items-end gap-1.5">
            <Textarea
              value={teks}
              onChange={(e) => setTeks(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  void kirimPesan()
                }
              }}
              placeholder={partner ? `Pesan untuk ${partner.nama}…` : 'Pesan untuk semua akun…'}
              rows={2}
              aria-label="Tulis pesan"
              className="max-h-28 min-h-[2.25rem] flex-1 resize-none text-xs"
            />
            <Button
              size="sm"
              className="h-9 shrink-0 bg-emerald-600 hover:bg-emerald-700"
              disabled={kirimPending || !teks.trim()}
              onClick={() => void kirimPesan()}
              title="Kirim (Enter)"
            >
              <SendHorizonal className="h-4 w-4" />
            </Button>
          </div>
          {!compact && <p className="mt-1 text-[10px] text-slate-400">Enter kirim · Shift+Enter baris baru · maks 2000 karakter</p>}
        </div>
      </div>
    </div>
  )
}
