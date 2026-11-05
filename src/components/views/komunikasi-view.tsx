'use client'

import { useEffect, useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  MessageSquare, StickyNote, Plus, Pin, PinOff, Pencil, Trash2, SendHorizonal, ShieldAlert, RefreshCw,
} from 'lucide-react'
import { fetcher, postJson, formatWaktu, formatTanggal } from '@/lib/api'
import { useAppStore, ROLE_LABELS, type RoleKey } from '@/lib/store'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import ChatPanel from '@/components/chat-panel'
import type { ChatData, CatatanItem } from '@/lib/types'
import { tandaiThreadBaca } from '@/lib/chat'

/**
 * View Komunikasi — komunikasi antar akun dalam satu tempat:
 *  1. Tab MiniChat : chat antar akun (papan umum "Semua Akun" + DM) memakai
 *     ChatPanel yang sama dengan widget melayang MiniChat.
 *  2. Tab Notes    : papan catatan bersama — pengumuman/kesepakatan kerja,
 *     dengan balasan inline, sematan (Admin/Manager), dan target role.
 */

const ROLE_TARGETS: { value: string; label: string }[] = [
  { value: '', label: 'Semua Role' },
  ...Object.entries(ROLE_LABELS).map(([value, label]) => ({ value, label })),
]

const ROLE_TONE: Record<RoleKey, string> = {
  ADMIN_WORKSHOP: 'border-emerald-300 bg-emerald-50 text-emerald-700',
  TEKNISI: 'border-amber-300 bg-amber-50 text-amber-700',
  MANAGER: 'border-violet-300 bg-violet-50 text-violet-700',
  PRODUSEN: 'border-teal-300 bg-teal-50 text-teal-700',
}

export default function KomunikasiView() {
  const { user, role } = useAppStore()
  const navIntent = useAppStore((s) => s.navIntent)
  const clearNavIntent = useAppStore((s) => s.clearNavIntent)
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const meId = user?.id ?? 0
  const isAdminFor = role === 'ADMIN_WORKSHOP' || role === 'MANAGER'

  // ===== MiniChat data (dipakai tab chat; widget punya query sendiri) =====
  const [thread, setThread] = useState('SEMUA')

  // Konsumsi navIntent drill-down dari kartu "Chat Baru" Dashboard → buka
  // thread yang diminta, lalu bersihkan intent (pola view lain: setTimeout 0
  // di callback — bukan setState sinkron di body effect).
  useEffect(() => {
    if (!navIntent?.komunikasiThread) return
    const target = navIntent.komunikasiThread
    const t = setTimeout(() => {
      setThread(target)
      clearNavIntent()
    }, 0)
    return () => clearTimeout(t)
  }, [navIntent, clearNavIntent])

  const { data: chat, isLoading } = useQuery<ChatData>({
    queryKey: ['chat'],
    queryFn: () => fetcher<ChatData>('/api/chat'),
    refetchInterval: 5_000,
    enabled: !!user,
  })
  const kirimMut = useMutation({
    mutationFn: (tujuan: { penerimaId: number | null; isi: string }) => postJson('/api/chat', tujuan),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['chat'] }),
    onError: (e: Error) => toast({ title: 'Pesan gagal terkirim', description: e.message, variant: 'destructive' }),
  })
  // Thread aktif dianggap sedang DIBACA saat mulai menampilkan pesan baru di
  // view ini — stempel ditulis ke cache modul (`lib/chat`) sehingga badge
  // widget MiniChat ikut turun tanpa state tambahan.
  useEffect(() => {
    if (!meId || !chat) return
    tandaiThreadBaca(meId, thread)
  }, [meId, thread, chat?.pesan.length])

  // ===== Notes =====
  const [cari, setCari] = useState('')
  const [buatBuka, setBuatBuka] = useState(false)
  const [form, setForm] = useState({ judul: '', isi: '', untukRole: '' })
  const [editTarget, setEditTarget] = useState<CatatanItem | null>(null)
  const [balasTerbuka, setBalasTerbuka] = useState<number | null>(null)
  const [balasTeks, setBalasTeks] = useState('')

  const { data: catatanData, isLoading: catatanLoading } = useQuery<{ items: CatatanItem[] }>({
    queryKey: ['catatan'],
    queryFn: () => fetcher<{ items: CatatanItem[] }>('/api/catatan'),
    refetchInterval: 30_000,
    enabled: !!user,
  })
  const items = catatanData?.items ?? []

  const tersaring = useMemo(() => {
    const q = cari.trim().toLowerCase()
    if (!q) return items
    return items.filter((c) => `${c.judul ?? ''} ${c.isi} ${c.penulis.nama}`.toLowerCase().includes(q))
  }, [items, cari])

  const buatMut = useMutation({
    mutationFn: () => postJson('/api/catatan', { ...form, untukRole: form.untukRole || null }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['catatan'] })
      setBuatBuka(false)
      setForm({ judul: '', isi: '', untukRole: '' })
      toast({ title: 'Catatan tersimpan', description: 'Semua akun yang berhak melihat akan menemukan di papan Notes.' })
    },
    onError: (e: Error) => toast({ title: 'Gagal membuat catatan', description: e.message, variant: 'destructive' }),
  })

  const ubahMut = useMutation({
    mutationFn: (c: CatatanItem) => postJson(`/api/catatan/${c.id}`, { judul: form.judul, isi: form.isi, untukRole: form.untukRole || null }, 'PATCH'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['catatan'] })
      setEditTarget(null)
      toast({ title: 'Catatan diperbarui', description: 'Perubahan ditandai "(edited)" untuk pemeriksaan.' })
    },
    onError: (e: Error) => toast({ title: 'Gagal mengubah catatan', description: e.message, variant: 'destructive' }),
  })

  const pinMut = useMutation({
    mutationFn: (c: CatatanItem) => postJson(`/api/catatan/${c.id}`, { aksi: 'PIN', pinned: !c.pinned }, 'PATCH'),
    onSuccess: (_d, c) => {
      queryClient.invalidateQueries({ queryKey: ['catatan'] })
      toast({ title: c.pinned ? 'Sematan dibuka' : 'Catatan disematkan', description: c.pinned ? 'Catatan kembali urut waktu biasa.' : 'Catatan tampil paling atas untuk semua akun.' })
    },
    onError: (e: Error) => toast({ title: 'Gagal sematkan', description: e.message, variant: 'destructive' }),
  })

  const hapusMut = useMutation({
    mutationFn: (id: number) => postJson(`/api/catatan/${id}`, {}, 'DELETE'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['catatan'] })
      toast({ title: 'Catatan dihapus', description: 'Catatan & balasannya dihapus selamanya.' })
    },
    onError: (e: Error) => toast({ title: 'Gagal menghapus catatan', description: e.message, variant: 'destructive' }),
  })

  const balasMut = useMutation({
    mutationFn: ({ id, isi }: { id: number; isi: string }) => postJson(`/api/catatan/${id}`, { aksi: 'BALAS', isi }, 'PATCH'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['catatan'] })
      setBalasTeks('')
      toast({ title: 'Balasan terkirim', description: 'Balasan tampil untuk semua akun yang berhak melihat catatan ini.' })
    },
    onError: (e: Error) => toast({ title: 'Gagal membalas', description: e.message, variant: 'destructive' }),
  })

  if (!user) return null

  const bisaKelola = (c: CatatanItem) => c.penulisId === meId || isAdminFor

  return (
    <div className="grid gap-4 xl:grid-cols-2 xl:items-start">
      {/* ===== KIRI — MiniChat (chat antar akun) ===== */}
      <Card className="flex min-h-[24rem] flex-col xl:h-[36rem]">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <MessageSquare className="h-4 w-4 text-emerald-600" /> MiniChat
          </CardTitle>
          <p className="text-xs text-slate-500">Papan umum &amp; DM antar akun — Enter kirim</p>
        </CardHeader>
        <CardContent className="flex min-h-0 flex-1 flex-col pt-2">
          <div className="flex min-h-0 flex-1 overflow-hidden rounded-lg border">
            {isLoading ? (
              <div className="flex flex-1 items-center justify-center text-xs text-slate-400"><RefreshCw className="mr-2 h-4 w-4 animate-spin" /> Memuat chat…</div>
            ) : (
              <ChatPanel
                users={chat?.users ?? []}
                pesan={chat?.pesan ?? []}
                meId={chat?.meId ?? meId}
                thread={thread}
                onThread={setThread}
                kirim={kirimMut.mutateAsync}
                kirimPending={kirimMut.isPending}
                className="flex-1"
              />
            )}
          </div>
        </CardContent>
      </Card>

      {/* ===== KANAN — Notes (papan catatan bersama) ===== */}
      <Card className="flex min-h-[24rem] flex-col xl:h-[36rem]">
        <CardHeader className="flex-row items-start justify-between gap-2 space-y-0 pb-2">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-base">
              <StickyNote className="h-4 w-4 text-amber-500" /> Notes
              {items.length > 0 && <Badge variant="outline" className="text-[10px] text-slate-500">{items.length} catatan</Badge>}
            </CardTitle>
            <p className="text-xs text-slate-500">Catatan bersama antar akun — bisa dibalas inline</p>
          </div>
          <Button
            size="sm"
            className="shrink-0 bg-emerald-600 hover:bg-emerald-700"
            onClick={() => {
              setForm({ judul: '', isi: '', untukRole: '' })
              setBuatBuka(true)
            }}
          >
            <Plus className="mr-1 h-3.5 w-3.5" /> Buat Catatan
          </Button>
        </CardHeader>
        <CardContent className="flex min-h-0 flex-1 flex-col pt-2">
          <Input
            value={cari}
            onChange={(e) => setCari(e.target.value)}
            placeholder="Cari judul, isi, atau penulis catatan…"
            aria-label="Pencarian catatan"
            className="mb-2 text-xs"
          />
          <ScrollArea className="min-h-0 flex-1">
            {catatanLoading ? (
              <div className="py-16 text-center text-xs text-slate-400"><RefreshCw className="mr-2 inline h-4 w-4 animate-spin" /> Memuat catatan…</div>
            ) : tersaring.length === 0 ? (
              <div className="rounded-xl border border-dashed py-16 text-center text-sm text-slate-400">
                {items.length === 0 ? 'Belum ada catatan — buat catatan pertama untuk semua akun.' : 'Tidak ada catatan cocok dengan pencarian.'}
              </div>
            ) : (
              <div className="space-y-3 pr-2">
                {tersaring.map((c) => (
                <Card key={c.id} className={cn('flex flex-col', c.pinned && 'border-amber-300 bg-amber-50/40')}>
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <CardTitle className="break-words text-sm leading-snug">
                          {c.judul || 'Tanpa judul'}
                        </CardTitle>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          <Badge variant="outline" className={cn('text-[10px]', ROLE_TONE[c.penulis.role])}>
                            {c.penulis.nama} · {ROLE_LABELS[c.penulis.role]}
                          </Badge>
                          <span className="text-[10px] text-slate-400">{formatWaktu(c.createdAt)}</span>
                          {c.editedAt && <span className="text-[10px] italic text-slate-400" title={c.editedBy ?? ''}>(edited {formatTanggal(c.editedAt)})</span>}
                          {c.pinned && <Badge variant="outline" className="border-amber-400 bg-amber-100 text-[10px] text-amber-800"><Pin className="mr-0.5 h-2.5 w-2.5" /> Tersemat</Badge>}
                          {c.untukRole && (
                            <Badge variant="outline" className="border-sky-300 text-[9px] text-sky-700" title="Target role penerima catatan">
                              untuk: {c.untukRole.split(',').map((r) => (ROLE_LABELS[r.trim() as RoleKey] ?? r.trim())).join(', ')}
                            </Badge>
                          )}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        {isAdminFor && (
                          <Button
                            size="sm" variant="ghost" className="h-7 w-7 p-0 text-amber-600 hover:bg-amber-100"
                            disabled={pinMut.isPending}
                            title={c.pinned ? 'Lepas sematan (Admin/Manager)' : 'Sematkan catatan ini paling atas (Admin/Manager)'}
                            onClick={() => pinMut.mutate(c)}
                          >
                            {c.pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
                          </Button>
                        )}
                        {bisaKelola(c) && (
                          <>
                            <Button
                              size="sm" variant="ghost" className="h-7 w-7 p-0 text-sky-600 hover:bg-sky-100"
                              title="Ubah isi catatan"
                              onClick={() => {
                                setForm({ judul: c.judul ?? '', isi: c.isi, untukRole: c.untukRole ?? '' })
                                setEditTarget(c)
                              }}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="sm" variant="ghost" className="h-7 w-7 p-0 text-rose-600 hover:bg-rose-100"
                              title="Hapus catatan (+ balasan)"
                              onClick={() => hapusMut.mutate(c.id)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="flex min-h-0 flex-1 flex-col gap-2 pt-0">
                    <p className="whitespace-pre-wrap text-xs leading-relaxed text-slate-700">{c.isi}</p>

                    {/* Balasan */}
                    <div className="mt-auto">
                      <button
                        className="text-[11px] font-semibold text-emerald-700 hover:underline"
                        onClick={() => setBalasTerbuka((v) => (v === c.id ? null : c.id))}
                        aria-expanded={balasTerbuka === c.id}
                      >
                        {balasTerbuka === c.id ? 'Sembunyikan balasan' : `Balasan (${c.balasan.length})`}
                      </button>
                      {balasTerbuka === c.id && (
                        <div className="mt-2 space-y-2 rounded-lg border bg-slate-50/70 p-2">
                          <ScrollArea className="max-h-40">
                            <div className="space-y-2 pr-2">
                              {c.balasan.map((b) => (
                                <div key={b.id} className="rounded-md bg-white p-2 text-[11px] shadow-sm ring-1 ring-slate-200">
                                  <p className="mb-0.5 flex items-center gap-1.5">
                                    <Badge variant="outline" className={cn('text-[9px]', ROLE_TONE[b.penulis.role])}>
                                      {b.penulis.nama} · {ROLE_LABELS[b.penulis.role]}
                                    </Badge>
                                    <span className="text-[9px] text-slate-400">{formatWaktu(b.createdAt)}</span>
                                  </p>
                                  <p className="whitespace-pre-wrap break-words leading-relaxed text-slate-700">{b.isi}</p>
                                </div>
                              ))}
                              {c.balasan.length === 0 && <p className="text-[11px] text-slate-400">Belum ada balasan.</p>}
                            </div>
                          </ScrollArea>
                          <div className="flex items-end gap-1.5">
                            <Textarea
                              value={balasTeks}
                              onChange={(e) => setBalasTeks(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && !e.shiftKey) {
                                  e.preventDefault()
                                  if (balasTeks.trim()) balasMut.mutate({ id: c.id, isi: balasTeks.trim() })
                                }
                              }}
                              placeholder="Tulis balasan…"
                              rows={2}
                              aria-label="Tulis balasan catatan"
                              className="min-h-[2.25rem] flex-1 resize-none text-[11px]"
                            />
                            <Button
                              size="sm"
                              className="h-9 bg-emerald-600 hover:bg-emerald-700"
                              disabled={balasMut.isPending || !balasTeks.trim()}
                              onClick={() => balasMut.mutate({ id: c.id, isi: balasTeks.trim() })}
                              title="Kirim balasan (Enter)"
                            >
                              <SendHorizonal className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
                ))}
              </div>
            )}
          </ScrollArea>
        </CardContent>
      </Card>

      {/* ===== Dialog buat/ubah catatan ===== */}
      <Dialog
        open={buatBuka || !!editTarget}
        onOpenChange={(o) => {
          if (!o) {
            setBuatBuka(false)
            setEditTarget(null)
          }
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editTarget ? 'Ubah Catatan' : 'Buat Catatan Baru'}</DialogTitle>
            <DialogDescription>
              {editTarget
                ? 'Perubahan disimpan dengan tanda (edited).'
                : 'Catatan tampil untuk semua akun (atau role tujuan) dan bisa dibalas antar akun.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="cat-judul">Judul (opsional)</Label>
              <Input id="cat-judul" value={form.judul} onChange={(e) => setForm({ ...form, judul: e.target.value })} placeholder="cth: SOP Ambil Part Inden" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cat-isi">Isi catatan</Label>
              <Textarea id="cat-isi" value={form.isi} onChange={(e) => setForm({ ...form, isi: e.target.value })} rows={5} placeholder="Tulis isi catatan…" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cat-role">Tampil untuk</Label>
              <Select value={form.untukRole || ''} onValueChange={(v) => setForm({ ...form, untukRole: v })}>
                <SelectTrigger id="cat-role" aria-label="Target role">
                  <SelectValue placeholder="Semua Role" />
                </SelectTrigger>
                <SelectContent>
                  {ROLE_TARGETS.map((r) => (
                    <SelectItem key={r.value} value={r.value || 'SEMUA'}>{r.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {!isAdminFor && (
              <p className="flex items-start gap-1.5 rounded-md bg-amber-50 p-2 text-[11px] text-amber-700">
                <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                Sematan (pin) hanya oleh Admin Workshop / Manager.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setBuatBuka(false); setEditTarget(null) }}>Batal</Button>
            <Button
              className="bg-emerald-600 hover:bg-emerald-700"
              disabled={buatMut.isPending || ubahMut.isPending || !form.isi.trim()}
              onClick={() => (editTarget ? ubahMut.mutate(editTarget) : buatMut.mutate())}
            >
              {editTarget ? 'Simpan Perubahan' : 'Simpan Catatan'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
