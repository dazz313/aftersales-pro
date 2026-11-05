'use client'

import { useEffect, useRef, useState } from 'react'
import { useAiJobs } from '@/lib/ai-jobs'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Loader2, SendHorizonal, Bot, User } from 'lucide-react'

/**
 * AiChat — chat interaktif dua arah dengan AI Asisten AfterSales Pro.
 *  - Riwayat percakapan dikirim ke /api/ai/chat; endpoint menyusun otomatis
 *    konteks pergerakan aplikasi (kondisi operasional + audit) supaya AI bisa
 *    bantu analisis masalah lebih cepat.
 *  - Riwayat & status kirim disimpan di store ai-jobs (level modul), jadi chat
 *    tetap berjalan dan tidak hilang saat user pindah ke fitur lain.
 *  - Bukan MiniChat (komunikasi antar akun) — ini AI chat.
 */
export default function AiChat() {
  const messages = useAiJobs((s) => s.chatMessages)
  const sending = useAiJobs((s) => s.chatSending)
  const kirimChat = useAiJobs((s) => s.kirimChat)
  const [input, setInput] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, sending])

  const kirim = () => {
    const isi = input.trim()
    if (!isi || sending) return
    setInput('')
    void kirimChat(isi)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      kirim()
    }
  }

  return (
    <Card className="overflow-hidden border-indigo-200/80 shadow-sm">
      <div className="h-1 bg-gradient-to-r from-indigo-500 via-blue-400 to-indigo-300" />
      <CardHeader className="flex-row items-start justify-between gap-2 space-y-0 pb-2">
        <div className="flex items-start gap-2.5">
          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-indigo-700 shadow-sm">
            <Bot className="h-4 w-4 text-white" />
          </div>
          <div>
            <CardTitle className="text-sm font-bold tracking-tight text-slate-900">Chat AI Interaktif</CardTitle>
            <CardDescription className="text-[11px] leading-snug">
              Komunikasi dua arah dengan AI — tanya apa saja, AI membaca konteks kondisi aplikasi untuk bantu analisis lebih cepat.
            </CardDescription>
          </div>
        </div>
        <Badge variant="outline" className="border-indigo-300 text-[10px] text-indigo-700">AI · 2 ARAH</Badge>
      </CardHeader>
      <CardContent className="space-y-2.5">
        {/* Area percakapan */}
        <div ref={scrollRef} className="flex h-72 flex-col gap-2 overflow-y-auto rounded-xl border border-indigo-100 bg-indigo-50/40 p-2.5">
          {messages.map((m, i) => (
            <div key={i} className={`flex items-start gap-2 ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              {m.role === 'assistant' && (
                <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-white">
                  <Bot className="h-3.5 w-3.5" />
                </div>
              )}
              <div className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-2.5 py-1.5 text-[11px] leading-relaxed ${m.role === 'user' ? 'bg-indigo-600 text-white' : 'bg-white text-slate-700 shadow-sm'}`}>
                {m.content}
              </div>
              {m.role === 'user' && (
                <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-700 text-white">
                  <User className="h-3.5 w-3.5" />
                </div>
              )}
            </div>
          ))}
          {sending && (
            <div className="flex items-start gap-2 justify-start">
              <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-white">
                <Bot className="h-3.5 w-3.5" />
              </div>
              <div className="flex items-center gap-1.5 rounded-2xl bg-white px-2.5 py-2 text-[11px] text-slate-500 shadow-sm">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-indigo-600" /> AI sedang menulis…
              </div>
            </div>
          )}
        </div>

        {/* Input */}
        <div className="flex items-center gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Ketik pertanyaan atau masalah… (Enter untuk kirim)"
            className="h-9 text-[11px]"
            maxLength={1000}
          />
          <Button size="sm" className="h-9 shrink-0 bg-indigo-600 px-3 hover:bg-indigo-700" disabled={!input.trim() || sending} onClick={kirim}>
            {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <SendHorizonal className="h-3.5 w-3.5" />}
          </Button>
        </div>
        <p className="text-[10px] text-slate-400">Riwayat pesan tetap tersimpan saat Anda pindah fitur · dikirim ke AI via 9router · konteks kondisi aplikasi disusun otomatis.</p>
      </CardContent>
    </Card>
  )
}
