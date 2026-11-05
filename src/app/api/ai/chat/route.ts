import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { requireActiveSession } from '@/lib/auth-server'
import { resolveAiConfig, chatCompletion, AI_TIMEOUT_MS, type ChatMessage } from '@/lib/ai'
import { kumpulkanKonteks, statusTiket, cariKonteksPertanyaan } from '@/lib/ai-context'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * POST /api/ai/chat — Chat AI interaktif (komunikasi dua arah):
 *  - Body: { messages: [{ role: 'user'|'assistant'|'system', content: string }], context?: { judul?: string; isi?: string } | null }
 *  - Riwayat dipakai sebagai percakapan (max 12 pesan terakhir yang valid).
 *  - Konteks opsional dari pemanggil (mis. analisa AI hasil) ditambah; selain itu
 *    endpoint menyusun otomatis konteks pergerakan aplikasi (kondisi operasional
 *    + riwayat audit) supaya AI bisa bantu pecahkan masalah lebih cepat.
 *  - Tidak menulis data operasional (hanya Audit Log AI_CHAT).
 */
export async function POST(request: Request) {
  try {
    const { session, denied } = await requireActiveSession(request)
    if (denied) return denied
    const body = (await request.json().catch(() => null)) as
      | { messages?: { role?: string; content?: string }[]; context?: { judul?: string; isi?: string } | null; tiket?: string }
      | null

    const riwayat: ChatMessage[] = []
    for (const m of body?.messages ?? []) {
      const content = (m?.content ?? '').trim()
      if (!content) continue
      const role = m?.role === 'assistant' ? 'assistant' : m?.role === 'system' ? 'system' : 'user'
      if (role === 'system') continue
      riwayat.push({ role, content })
    }
    if (riwayat.length > 12) riwayat.splice(0, riwayat.length - 12)

    const teksTerakhir = [...riwayat].reverse().find((m) => m.role === 'user')?.content ?? ''

    const rows = await db.pengaturan.findMany({ select: { kunci: true, nilai: true } })
    const map: Record<string, string> = {}
    for (const r of rows) map[r.kunci] = r.nilai
    const cfg = resolveAiConfig(map)
    let modelDipakai = cfg.model

    const konteksAi = await kumpulkanKonteks()
    const konteksPertanyaan = await cariKonteksPertanyaan(teksTerakhir)
    const blok = [
      konteksAi.sistem ? konteksAi.sistem : null,
      konteksAi.operasional ? `KONDISI APLIKASI SAAT INI:\n${konteksAi.operasional}` : null,
      konteksAi.audit ? `RIWAYAT AUDIT TERBARU:\n${konteksAi.audit}` : null,
      konteksPertanyaan ? `DATA RELEVAN DARI DATABASE (hasil pencarian untuk pertanyaan pengguna):\n${konteksPertanyaan}` : null,
      body?.context?.isi?.trim() ? `KONTEKS TAMBAHAN DARI PENGGUNA:\n${body.context.isi.trim()}` : null,
    ].filter(Boolean) as string[]

    if (body?.tiket?.trim()) {
      const stTiket = await statusTiket(body.tiket.trim())
      if (stTiket) blok.push(`STATUS TIKET YANG DIMINTA:\n${stTiket}`)
    }

    const pesan: ChatMessage[] = [{ role: 'system', content: 'Kamu adalah AI Asisten AfterSales Pro — asisten untuk layanan sparepart (tiket service, sparepart, klaim produsen, kunjungan toko, stok, SLA) DAN penjelas sistem. Jawab dalam Bahasa Indonesia, praktis, ringkas, dan apa adanya. Kamu SUDAH diberi PENGETAHUAN SISTEM (cara kerja aplikasi, modul, alur, status, tabel database, kode produk) dan data dari database (KONDISI APLIKASI / DATA RELEVAN): gunakan data itu apa adanya (sebutkan kode toko, nomor tiket, SN, model, kode part, jumlah, status part). Jika ditanya cara kerja fitur/modul, jelaskan berdasarkan PENGETAHUAN SISTEM. Jika ditanya kode produk/sparepart, sebutkan kode, nama, brand, stok, supplier, model tipe, produsen dari DATA RELEVAN. PENTING: saat ditanya unit/tiket dengan status tertentu (proses/request/finish/selesai), gunakan HANYA daftar pada DATA RELEVAN yang berstatus tersebut — jangan campur status lain (mis. unit finish tidak boleh muncul di daftar unit proses). Jangan mengatakan "tidak ada informasi" bila datanya ada di konteks; baru katakan tidak ditemukan bila memang tidak tercantum.' }]
    if (blok.length > 0) pesan.push({ role: 'system', content: blok.join('\n\n') })
    pesan.push(...riwayat)

    const hasil = await chatCompletion(cfg, pesan, {
      maxTokens: 2000,
      timeoutMs: AI_TIMEOUT_MS,
      onModelUsed: (m) => { modelDipakai = m },
    })
    await logAudit({
      aksi: 'AI_CHAT',
      entitas: 'ai_chat',
      deskripsi: `Percakapan AI: ${teksTerakhir.slice(0, 120)}`,
      aktor: session?.nama ?? 'SYSTEM',
    })
    return NextResponse.json({ reply: hasil, model: modelDipakai })
  } catch (error) {
    console.error('AI chat error:', error)
    return NextResponse.json({ error: (error as Error).message || 'Gagal membalas chat AI' }, { status: 502 })
  }
}
