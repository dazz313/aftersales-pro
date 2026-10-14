/**
 * Suggest AI via 9router (gateway OpenAI-compatible di mesin ini).
 * - Base URL & model dari Pengaturan (ai_base_url, ai_model).
 * - API key: prioritas dari Pengaturan (ai_api_key), bila kosong dibaca
 *   otomatis dari database 9router lokal (tanpa perlu copy-paste).
 * Semua pemanggilan dibatasi timeout agar gagal cepat & jelas, bukan gantung.
 */
import { DatabaseSync } from 'node:sqlite'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const AI_DEFAULT_BASE_URL = 'http://localhost:20128/v1'
export const AI_DEFAULT_MODEL = 'kr/claude-haiku-4.5'
export const AI_TIMEOUT_MS = 120000

export interface AiConfig {
  baseUrl: string
  apiKey: string | null
  keySource: 'pengaturan' | '9router' | null
  model: string
}

/** Baca kunci gateway 9router lokal (best-effort, null bila tak ada). */
export function readNineRouterKey(): string | null {
  try {
    const appdata = process.env.APPDATA || join(homedir(), 'AppData', 'Roaming')
    const kandidat = [
      process.env.NINEROUTER_DB,
      join(appdata, '9router', 'db', 'data.sqlite'),
      join(homedir(), '.9router', 'db', 'data.sqlite'),
    ].filter((p): p is string => !!p)
    for (const p of kandidat) {
      try {
        const db = new DatabaseSync(p, { readOnly: true })
        try {
          const row = db
            .prepare('SELECT key FROM apiKeys WHERE isActive = 1 ORDER BY createdAt DESC LIMIT 1')
            .get() as { key?: string } | undefined
          if (row?.key) return row.key
        } finally {
          db.close()
        }
      } catch {
        // file tak ada / terkunci — coba kandidat berikutnya
      }
    }
    return null
  } catch {
    return null
  }
}

export function resolveAiConfig(pengaturan: Record<string, string>): AiConfig {
  const baseUrl = (pengaturan.ai_base_url || AI_DEFAULT_BASE_URL).trim().replace(/\/+$/, '')
  const model = (pengaturan.ai_model || AI_DEFAULT_MODEL).trim()
  const dariPengaturan = (pengaturan.ai_api_key || '').trim()
  if (dariPengaturan) {
    return { baseUrl, apiKey: dariPengaturan, keySource: 'pengaturan', model }
  }
  const otomatis = readNineRouterKey()
  return { baseUrl, apiKey: otomatis, keySource: otomatis ? '9router' : null, model }
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/** Panggil chat completion OpenAI-compatible; throw dengan pesan Indonesia bila gagal. */
export async function chatCompletion(
  cfg: AiConfig,
  messages: ChatMessage[],
  opts?: { temperature?: number; maxTokens?: number; timeoutMs?: number }
): Promise<string> {
  if (!cfg.apiKey) {
    throw new Error(
      'Kunci API 9router tidak ditemukan — buka dashboard 9router (http://localhost:20128), salin API key, lalu isi di Pengaturan → AI Suggest.'
    )
  }
  let res: Response
  try {
    res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({
        model: cfg.model,
        messages,
        temperature: opts?.temperature ?? 0.2,
        max_tokens: opts?.maxTokens ?? 1500,
      }),
      signal: AbortSignal.timeout(opts?.timeoutMs ?? AI_TIMEOUT_MS),
    })
  } catch (e) {
    const nama = typeof e === 'object' && e !== null && 'name' in e ? (e as { name?: string }).name : null
    if (nama === 'TimeoutError' || nama === 'AbortError') {
      throw new Error(
        `9router tidak merespons dalam ${(opts?.timeoutMs ?? AI_TIMEOUT_MS) / 1000} detik (model ${cfg.model}). Coba lagi atau ganti model di Pengaturan → AI Suggest.`
      )
    }
    throw new Error(
      `Tidak dapat menghubungi 9router di ${cfg.baseUrl} — pastikan aplikasi 9router berjalan. (${(e as Error).message})`
    )
  }
  // 9router bisa menjawab SSE (text/event-stream) walau tanpa stream:true — rangkai delta-nya.
  // Cek tipe konten DULU sebelum membaca body (body hanya bisa dibaca sekali).
  const tipe = res.headers.get('content-type') ?? ''
  if (tipe.includes('text/event-stream')) {
    if (!res.ok) {
      const cuplik = (await res.text().catch(() => '')).slice(0, 300)
      throw new Error(`9router menolak permintaan (${res.status}, model ${cfg.model})${cuplik ? ` — ${cuplik}` : ''}`)
    }
    const mentah = await res.text()
    const potongan: string[] = []
    for (const baris of mentah.split('\n')) {
      const t = baris.trim()
      if (!t.startsWith('data:')) continue
      const muatan = t.slice(5).trim()
      if (!muatan || muatan === '[DONE]') continue
      try {
        const j = JSON.parse(muatan) as {
          choices?: { delta?: { content?: string }; message?: { content?: string } }[]
        }
        const isi = j.choices?.[0]?.delta?.content ?? j.choices?.[0]?.message?.content ?? ''
        if (isi) potongan.push(isi)
      } catch {
        // baris rusak — abaikan
      }
    }
    const gabung = potongan.join('').trim()
    if (!gabung) throw new Error('AI mengembalikan jawaban kosong — coba lagi.')
    return gabung
  }
  const data = (await res.json().catch(() => ({}))) as {
    choices?: { message?: { content?: string } }[]
    error?: { message?: string } | string
  }
  if (!res.ok) {
    const detail = typeof data.error === 'string' ? data.error : data.error?.message
    throw new Error(`9router menolak permintaan (${res.status}, model ${cfg.model})${detail ? ` — ${detail.slice(0, 300)}` : ''}`)
  }
  const teks = data.choices?.[0]?.message?.content?.trim() ?? ''
  if (!teks) throw new Error('AI mengembalikan jawaban kosong — coba lagi.')
  return teks
}

/** Ambil objek JSON dari jawaban AI (mentoleransi code fence / teks pengiring). */
export function extractJson<T>(teks: string): T {
  const bersih = teks
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim()
  const langsung = (() => {
    try {
      return JSON.parse(bersih) as T
    } catch {
      return null
    }
  })()
  if (langsung) return langsung
  const m = bersih.match(/\{[\s\S]*\}/)
  if (m) {
    try {
      return JSON.parse(m[0]) as T
    } catch {
      // lanjut ke error di bawah
    }
  }
  throw new Error('Jawaban AI bukan JSON valid — coba lagi.')
}
