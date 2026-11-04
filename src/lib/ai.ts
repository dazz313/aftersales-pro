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
/**
 * Anggaran total satu permintaan AI (detik). Dijaga di bawah ±100 detik agar
 * Cloudflare tidak memotong respons dengan error 524 saat AI lambat.
 */
export const AI_TIMEOUT_MS = 80000
/**
 * Model cadangan bila model utama gagal/kosong/timeout. Urut dari yang paling
 * cepat. Model yang sama dengan model utama otomatis dilewati.
 */
export const AI_FALLBACK_MODELS = ['kc/cohere/north-mini-code:free', 'kr/claude-haiku-4.5']

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

interface HasilAi {
  teks: string
  alasan: string
}

/** Ambil isi jawaban dari satu objek completion (JSON utuh maupun satu delta SSE). */
function bacaIsi(obj: unknown): HasilAi {
  const pilihan = (obj as { choices?: { message?: Record<string, unknown>; delta?: Record<string, unknown> }[] })
    ?.choices?.[0]
  const isi = (pilihan?.message ?? pilihan?.delta ?? {}) as { content?: string; reasoning?: string }
  return { teks: isi.content ?? '', alasan: isi.reasoning ?? '' }
}

/**
 * 9router tidak konsisten: sebagian provider membalas JSON biasa, sebagian SSE
 * (`data: {...}`), dan ada yang mengirim JSON utuh TANPA awalan `data:` lalu
 * diakhiri `data: [DONE]`. Semua bentuk harus terbaca.
 */
function bacaJawaban(mentah: string): HasilAi {
  const utuh = (() => {
    try {
      return JSON.parse(mentah.trim()) as unknown
    } catch {
      return null
    }
  })()
  if (utuh) {
    const hasil = bacaIsi(utuh)
    if (hasil.teks || hasil.alasan) return hasil
  }
  const potongan: string[] = []
  const alasan: string[] = []
  for (const baris of mentah.split('\n')) {
    let t = baris.trim()
    if (!t) continue
    if (t.startsWith('data:')) t = t.slice(5).trim()
    if (!t || t === '[DONE]') continue
    try {
      const hasil = bacaIsi(JSON.parse(t) as unknown)
      if (hasil.teks) potongan.push(hasil.teks)
      if (hasil.alasan) alasan.push(hasil.alasan)
    } catch {
      // baris rusak / bukan JSON — abaikan
    }
  }
  return { teks: potongan.join(''), alasan: alasan.join('') }
}

/** Satu percobaan ke satu model. */
async function panggilModel(
  cfg: AiConfig,
  model: string,
  messages: ChatMessage[],
  opts?: { temperature?: number; maxTokens?: number; timeoutMs?: number }
): Promise<HasilAi> {
  let res: Response
  try {
    res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({
        model,
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
        `9router tidak merespons dalam ${Math.round((opts?.timeoutMs ?? AI_TIMEOUT_MS) / 1000)} detik (model ${model})`
      )
    }
    throw new Error(
      `Tidak dapat menghubungi 9router di ${cfg.baseUrl} — pastikan aplikasi 9router berjalan. (${(e as Error).message})`
    )
  }
  // Body hanya bisa dibaca sekali — baca teks mentah lalu deteksi formatnya.
  const mentah = await res.text()
  if (!res.ok) {
    let detail = ''
    try {
      const j = JSON.parse(mentah) as { error?: { message?: string } | string }
      detail = typeof j.error === 'string' ? j.error : j.error?.message ?? ''
    } catch {
      detail = mentah.slice(0, 300)
    }
    throw new Error(`9router menolak permintaan (${res.status}, model ${model})${detail ? ` — ${detail.slice(0, 300)}` : ''}`)
  }
  return bacaJawaban(mentah)
}

/** Panggil chat completion OpenAI-compatible; throw dengan pesan Indonesia bila gagal. */
export async function chatCompletion(
  cfg: AiConfig,
  messages: ChatMessage[],
  opts?: { temperature?: number; maxTokens?: number; timeoutMs?: number; onModelUsed?: (model: string) => void }
): Promise<string> {
  if (!cfg.apiKey) {
    throw new Error(
      'Kunci API 9router tidak ditemukan — buka dashboard 9router (http://localhost:20128), salin API key, lalu isi di Pengaturan → AI Suggest.'
    )
  }
  const anggaran = opts?.timeoutMs ?? AI_TIMEOUT_MS
  const mulai = Date.now()
  const kandidat = [cfg.model, ...AI_FALLBACK_MODELS].filter((m, i, a) => !!m && a.indexOf(m) === i)
  const galat: string[] = []
  for (const model of kandidat) {
    const sisa = anggaran - (Date.now() - mulai)
    if (sisa < 3000) break
    // Percobaan pertama dibatasi agar model yang menggantung cepat dialihkan.
    const batas = model === cfg.model ? Math.min(sisa, 40000) : sisa
    try {
      let hasil = await panggilModel(cfg, model, messages, { ...opts, timeoutMs: batas })
      // Model "reasoning" menghabiskan jatah token untuk berpikir lalu content
      // kosong. Ulangi sekali dengan jatah token lebih besar.
      if (!hasil.teks && hasil.alasan) {
        const sisaUlang = anggaran - (Date.now() - mulai)
        if (sisaUlang > 5000) {
          hasil = await panggilModel(cfg, model, messages, {
            ...opts,
            maxTokens: Math.max((opts?.maxTokens ?? 1500) * 3, 2000),
            timeoutMs: sisaUlang,
          })
        }
      }
      if (hasil.teks) {
        opts?.onModelUsed?.(model)
        return hasil.teks
      }
      galat.push(`${model}: jawaban kosong`)
    } catch (e) {
      galat.push((e as Error).message)
    }
  }
  throw new Error(`AI gagal — ${galat.join(' | ') || 'tidak ada model yang tersedia'}`)
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
