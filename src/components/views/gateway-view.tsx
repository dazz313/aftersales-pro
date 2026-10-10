'use client'

import { useState, useRef, useEffect, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetcher, gatewaySimulate, fetchGatewayStatus, formatWaktu, type WaMessage, type GatewayStatus } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useToast } from '@/hooks/use-toast'
import { Send, Bot, Smartphone, ScanLine, Lightbulb, Radio, CheckCircle2, XCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

const CONTOH_COMMANDS = [
  '#LAPOR SN-ACSP-2024-00532 PRT-CMP-02 Kompresor tidak menyala sama sekali',
  '#LAPOR SN-CWAS-2024-00312 PRT-THR-07 Suhu freezer tidak stabil dan sering mati sendiri',
  '#LAPOR SN-MESC-2023-00422 PRT-KPT-3D Kapasitor mesin cuci bocor, unit tidak mau spin',
]

type Channel = 'WHATSAPP' | 'TELEGRAM'

const CHANNEL_META: Record<Channel, { label: string; badge: string; bubble: string; avatar: string; header: string }> = {
  WHATSAPP: {
    label: 'WhatsApp',
    badge: 'border-emerald-300 bg-emerald-50 text-emerald-700',
    bubble: 'bg-[#d9fdd3] rounded-tr-none',
    avatar: 'bg-emerald-500',
    header: 'bg-emerald-50/60',
  },
  TELEGRAM: {
    label: 'Telegram',
    badge: 'border-sky-300 bg-sky-50 text-sky-700',
    bubble: 'bg-sky-100 rounded-tr-none',
    avatar: 'bg-sky-500',
    header: 'bg-sky-50/60',
  },
}

function parseMeta(meta: string | null): { noTiket?: string; aksi?: string; mode?: string } {
  try {
    return meta ? JSON.parse(meta) : {}
  } catch {
    return {}
  }
}

export default function GatewayView() {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [channel, setChannel] = useState<Channel>('WHATSAPP')
  const [pesan, setPesan] = useState('')
  const [pengirim, setPengirim] = useState('TOK-001 (Maju Jaya)')
  const scrollRef = useRef<HTMLDivElement>(null)

  const { data: messages, isLoading } = useQuery<WaMessage[]>({
    queryKey: ['wa-messages'],
    queryFn: () => fetcher<WaMessage[]>('/api/wa/webhook'),
  })
  const { data: gwStatus } = useQuery<GatewayStatus>({
    queryKey: ['gateway-status'],
    queryFn: fetchGatewayStatus,
  })

  const channelMessages = useMemo(
    () => (messages ?? []).filter((m) => (m.channel ?? 'WHATSAPP') === channel),
    [messages, channel]
  )

  const sendMutation = useMutation({
    mutationFn: () => gatewaySimulate(pesan.trim(), pengirim, channel),
    onSuccess: (res) => {
      setPesan('')
      queryClient.invalidateQueries({ queryKey: ['wa-messages'] })
      queryClient.invalidateQueries({ queryKey: ['service-tickets'] })
      queryClient.invalidateQueries({ queryKey: ['spareparts'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      queryClient.invalidateQueries({ queryKey: ['alerts'] })
      queryClient.invalidateQueries({ queryKey: ['audit'] })
      toast({
        title: res.aksi === 'FORMAT_INVALID' ? 'Format tidak valid' : `Bot memproses: ${res.aksi}`,
        description: res.noTiket
          ? `Tiket ${res.noTiket} dibuat otomatis via ${CHANNEL_META[channel].label}.`
          : `Bot membalas di ${CHANNEL_META[channel].label}${res.mode === 'SIMULASI' ? ' (mode simulasi — kredensial belum diisi di Pengaturan)' : ''}.`,
        variant: res.aksi === 'FORMAT_INVALID' ? 'destructive' : 'default',
      })
    },
    onError: (e: Error) => {
      toast({ title: 'Webhook gagal', description: e.message, variant: 'destructive' })
    },
  })

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [channelMessages])

  const kirim = () => {
    if (!pesan.trim()) {
      toast({ title: 'Pesan kosong', description: 'Tulis perintah #LAPOR terlebih dahulu.', variant: 'destructive' })
      return
    }
    sendMutation.mutate()
  }

  const meta = CHANNEL_META[channel]

  return (
    <div className="grid gap-4 lg:grid-cols-5">
      {/* Chat simulator */}
      <Card className="flex flex-col overflow-hidden lg:col-span-3">
        <CardHeader className={cn('border-b', meta.header)}>
          <div className="flex flex-wrap items-center gap-3">
            <div className={cn('flex h-10 w-10 items-center justify-center rounded-full text-white', meta.avatar)}>
              <Bot className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <CardTitle className="text-sm">Gateway — Group Produsen ({meta.label})</CardTitle>
              <CardDescription className="flex items-center gap-1 text-xs">
                <span className={cn('inline-block h-2 w-2 rounded-full', channel === 'WHATSAPP' ? 'bg-emerald-500' : 'bg-sky-500')} />
                Bot online · respon &lt; 5 detik
              </CardDescription>
            </div>
            <Tabs value={channel} onValueChange={(v) => setChannel(v as Channel)}>
              <TabsList aria-label="Pilih channel gateway">
                <TabsTrigger value="WHATSAPP" className="gap-1.5 px-3 text-xs">
                  <Smartphone className="h-3.5 w-3.5" /> WhatsApp
                </TabsTrigger>
                <TabsTrigger value="TELEGRAM" className="gap-1.5 px-3 text-xs">
                  <Send className="h-3.5 w-3.5" /> Telegram
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </CardHeader>

        <CardContent className="flex min-h-0 flex-1 flex-col gap-0 p-0">
          <div ref={scrollRef} className="h-[460px] flex-1 overflow-y-auto bg-[#ece5dd] p-4">
            {isLoading ? (
              <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14" />)}</div>
            ) : channelMessages.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
                <Radio className="h-8 w-8 text-slate-400" />
                <p className="text-sm font-medium text-slate-600">Belum ada pesan via {meta.label}</p>
                <p className="max-w-xs text-xs text-slate-400">
                  Kirim laporan dengan format <span className="font-mono">#LAPOR</span> untuk memicu bot. Channel WhatsApp &amp; Telegram punya log pesan terpisah.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {channelMessages.map((m) => {
                  const isBot = m.tipe === 'OUT'
                  const msgMeta = parseMeta(m.meta)
                  return (
                    <div key={m.id} className={cn('flex', isBot ? 'justify-start' : 'justify-end')}>
                      <div
                        className={cn(
                          'max-w-[85%] rounded-xl px-3.5 py-2.5 shadow-sm sm:max-w-[75%]',
                          isBot ? 'rounded-tl-none bg-white' : meta.bubble
                        )}
                      >
                        <div className="mb-1 flex flex-wrap items-center gap-2">
                          <span className={cn('text-xs font-semibold', isBot ? (channel === 'TELEGRAM' ? 'text-sky-700' : 'text-emerald-700') : 'text-slate-700')}>
                            {isBot ? (channel === 'TELEGRAM' ? '✈️ TG-BOT' : '🤖 WA-BOT') : m.pengirim}
                          </span>
                          {msgMeta.noTiket && (
                            <Badge variant="outline" className="px-1.5 py-0 font-mono text-[9px]">{msgMeta.noTiket}</Badge>
                          )}
                          {msgMeta.mode === 'SIMULASI' && (
                            <Badge variant="outline" className="px-1.5 py-0 text-[9px] text-amber-600">simulasi</Badge>
                          )}
                        </div>
                        <p className="whitespace-pre-wrap break-words text-sm text-slate-800">{m.pesan}</p>
                        <p className="mt-1 text-right text-[10px] text-slate-400">{formatWaktu(m.createdAt)}</p>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Input bar */}
          <div className="space-y-2 border-t bg-white p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-slate-500">Pengirim:</span>
              <select
                value={pengirim}
                onChange={(e) => setPengirim(e.target.value)}
                className="rounded-md border bg-slate-50 px-2 py-1 text-xs text-slate-700 outline-none focus:ring-2 focus:ring-emerald-500/40"
                aria-label="Pilih identitas pengirim"
              >
                <option>TOK-001 (Maju Jaya)</option>
                <option>TOK-002 (Berkah Sentosa)</option>
                <option>TOK-003 (Cahaya Elektronik)</option>
                <option>TOK-004 (Sumber Rejeki)</option>
                <option>TOK-005 (Giant Elektronik)</option>
                <option>TOK-006 (Toserba Nusantara)</option>
              </select>
            </div>
            <div className="flex gap-2">
              <Input
                value={pesan}
                onChange={(e) => setPesan(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && kirim()}
                placeholder="#LAPOR [Nomor_Seri] [Kode_Sparepart] [Deskripsi_Kerusakan]"
                className="flex-1 font-mono text-xs sm:text-sm"
                aria-label={`Pesan ${meta.label}`}
              />
              <Button onClick={kirim} disabled={sendMutation.isPending} className={cn('text-white', channel === 'TELEGRAM' ? 'bg-sky-600 hover:bg-sky-700' : 'bg-emerald-600 hover:bg-emerald-700')} aria-label="Kirim pesan ke bot">
                <Send className="h-4 w-4" />
                <span className="ml-1 hidden sm:inline">Kirim</span>
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Panel info */}
      <div className="space-y-4 lg:col-span-2">
        {/* Status koneksi gateway */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Radio className="h-4 w-4 text-emerald-600" /> Status Koneksi Gateway
            </CardTitle>
            <CardDescription>Konfigurasi kredensial ada di menu <span className="font-semibold">Pengaturan → Gateway</span></CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {[
              { ch: 'WHATSAPP' as Channel, st: gwStatus?.whatsapp },
              { ch: 'TELEGRAM' as Channel, st: gwStatus?.telegram },
            ].map(({ ch, st }) => (
              <div key={ch} className="flex items-center justify-between gap-2 rounded-lg border p-3">
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-slate-800">{CHANNEL_META[ch].label}</p>
                  <p className="truncate text-[10px] text-slate-400">
                    {!st ? 'Memuat…' : st.terkonfigurasi ? (ch === 'TELEGRAM' ? 'Bot API Telegram siap' : 'API gateway WA siap') : 'Belum dikonfigurasi — mode simulasi'}
                  </p>
                </div>
                {st?.terkonfigurasi ? (
                  <Badge variant="outline" className="gap-1 border-emerald-300 text-[10px] text-emerald-700"><CheckCircle2 className="h-3 w-3" /> SIAP</Badge>
                ) : (
                  <Badge variant="outline" className="gap-1 border-amber-300 text-[10px] text-amber-600"><XCircle className="h-3 w-3" /> SIMULASI</Badge>
                )}
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Lightbulb className="h-4 w-4 text-amber-500" /> Template Cepat
            </CardTitle>
            <CardDescription>Klik untuk mengisi perintah laporan</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {CONTOH_COMMANDS.map((c, i) => (
              <button
                key={i}
                onClick={() => setPesan(c)}
                className="w-full rounded-lg border bg-slate-50 p-3 text-left font-mono text-xs text-slate-700 transition hover:border-emerald-400 hover:bg-emerald-50"
              >
                {c}
              </button>
            ))}
            <button
              onClick={() => setPesan('#STATUS SV-20261008-0001')}
              className="w-full rounded-lg border border-dashed bg-white p-3 text-left font-mono text-xs text-slate-400 transition hover:border-emerald-400"
            >
              #STATUS SV-20261008-0001 (format belum didukung → coba!)
            </button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ScanLine className="h-4 w-4 text-emerald-600" /> Aturan Pemrosesan Bot
            </CardTitle>
            <CardDescription>Section 6 PRD — sama untuk semua channel</CardDescription>
          </CardHeader>
          <CardContent>
            <ol className="list-decimal space-y-2.5 pl-4 text-xs text-slate-600">
              <li>Webhook Gateway mengirim payload teks &amp; gambar ke backend (<span className="font-mono">/api/wa/webhook</span>).</li>
              <li>Sistem mencari <span className="font-mono">serial_number</span> di tabel <span className="font-mono">unit_asset</span> → menentukan status garansi &amp; toko asal.</li>
              <li>
                Cek stok part konsinyasi:
                <div className="mt-1.5 space-y-1.5">
                  <div className="rounded-md border border-emerald-200 bg-emerald-50 p-2">
                    <span className="font-semibold text-emerald-800">Part READY</span> → stok direserve, tiket dibuat, STTB PDF dengan QR terbit otomatis.
                  </div>
                  <div className="rounded-md border border-rose-200 bg-rose-50 p-2">
                    <span className="font-semibold text-rose-800">Part KOSONG</span> → status <span className="font-mono">ORDER_PRODUSEN</span>, notifikasi permintaan dikirim ke produsen.
                  </div>
                </div>
              </li>
              <li>Bot membalas di channel yang sama (WhatsApp atau Telegram) dengan nomor tiket &amp; link STTB.</li>
            </ol>
          </CardContent>
        </Card>

        <Card className="bg-slate-900 text-white">
          <CardContent className="flex items-start gap-3 p-4">
            <Smartphone className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" />
            <p className="text-xs leading-relaxed text-slate-300">
              Gateway mendukung WhatsApp (Fonnte/Wablas/Business API) dan Telegram Bot API sebagai alternatif.
              Isi bot token &amp; chat ID Telegram di <span className="font-semibold text-white">Pengaturan → Gateway</span>, lalu uji koneksi — laporan toko/teknisi bisa masuk lewat salah satu atau kedua channel sekaligus.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
