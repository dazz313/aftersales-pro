/**
 * Telegram Long-Polling Bridge (getUpdates) — alternatif webhook untuk lokal
 * ---------------------------------------------------------------------------
 * Untuk mode DESKTOP/local TANPA URL publik: bot Telegram dengan long polling
 * tidak butuh webhook & domain HTTPS — cukup internet keluar.
 *
 * Cara kerja:
 *  1. Baca token bot dari tabel Pengaturan (gateway_tg_token) via Prisma —
 *     sama dengan yang dipakai menu Pengaturan → Gateway di aplikasi.
 *  2. Poll `getUpdates` (long-poll 25 detik) dari api.telegram.org.
 *  3. Setiap update diteruskan (POST) ke webhook internal aplikasi
 *     /api/telegram/webhook?secret=<WEBHOOK_SECRET> — semua logika pemrosesan
 *     (barcode, OCR, #LAPOR, inbox, balasan chat) dipakai apa adanya.
 *
 * Pemakaian:
 *   node mini-services/tg-polling.mjs
 *   (atau: npm run tg:poll)
 *
 * Env opsional (di .env):
 *   APP_URL         → default http://localhost:3000
 *   WEBHOOK_SECRET  → wajib di produksi (app fail-closed tanpa ini)
 *
 * CATATAN: long polling TIDAK BOLEH bareng webhook aktif (Telegram melempar
 * 409 Conflict). Script ini otomatis menghapus webhook saat mulai.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PrismaClient } from '@prisma/client'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const db = new PrismaClient()

// ---- Muat .env minimal (Task Scheduler/PM2 tidak memuat .env otomatis) ----
const envFile = path.join(ROOT, '.env')
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^(?<k>\w+)=(?<v>.*)$/)
    if (m && process.env[m.groups.k] === undefined) process.env[m.groups.k] = m.groups.v.trim()
  }
}

const APP_URL = (process.env.APP_URL || 'http://localhost:3000').replace(/\/+$/, '')
const SECRET = process.env.WEBHOOK_SECRET || ''
const SECRET_Q = SECRET ? `?secret=${encodeURIComponent(SECRET)}` : ''
const POLL_TIMEOUT = 25 // detik long-poll
let offset = 0

async function loadToken() {
  const rows = await db.pengaturan.findMany({ where: { kunci: { startsWith: 'gateway_' } } })
  const map = Object.fromEntries(rows.map((r) => [r.kunci, r.nilai]))
  return (map['gateway_tg_token'] || '').trim()
}

async function tg(method) {
  const res = await fetch(`https://api.telegram.org/bot${process.env._TG_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(POLL_TIMEOUT * 1000 + 10_000),
  })
  return (await res.json())
}

function stamp() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ')
}

async function main() {
  const token = await loadToken()
  if (!token) {
    console.error(`[${stamp()}] ✗ gateway_tg_token kosong — isi token bot di menu Pengaturan → Gateway dulu.`)
    process.exit(1)
  }
  process.env._TG_TOKEN = token

  // Kalau bot SUDAH punya webhook (server publik), long polling akan konflik
  // (Telegram balas 409). Jangan hapus webhook orang lain — keluar dengan
  // jelas. Set TG_FORCE_POLLING=1 untuk memaksa mode polling.
  const info = await tg('getWebhookInfo').catch(() => null)
  const webhookUrl = info?.result?.url || ''
  if (webhookUrl && process.env.TG_FORCE_POLLING !== '1') {
    console.error(
      `[${stamp()}] ✗ Bot sudah terdaftar webhook (${webhookUrl}) — mode long polling akan konflik (409).\n` +
        `[${stamp()}]   Pilih salah satu: (a) biarkan webhook, matikan service ini; (b) set TG_FORCE_POLLING=1 untuk memaksa polling.`
    )
    process.exit(1)
  }
  // Long polling konflik dengan webhook aktif → hapus webhook saat start.
  const del = await tg('deleteWebhook')
  if (del.ok) console.log(`[${stamp()}] ✓ Webhook lama dihapus (mode long polling aktif)`)

  console.log(`[${stamp()}] ▶ Polling bridge jalan → meneruskan update ke ${APP_URL}/api/telegram/webhook`)
  if (!SECRET) {
    console.warn(`[${stamp()}] ! WEBHOOK_SECRET kosong — pastikan app dev/simulator (bukan NODE_ENV=production), else webhook app menolak 403.`)
  }

  // main loop
  while (true) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates?offset=${offset}&timeout=${POLL_TIMEOUT}`, {
        signal: AbortSignal.timeout(POLL_TIMEOUT * 1000 + 10_000),
      })
      const data = await res.json()
      if (!data.ok) {
        // 409 Conflict: webhook aktif lain (mis. versi VPS) — jangan spam retry
        if ((data.description || '').includes('Conflict')) {
          console.error(`[${stamp()}] × Telegram 409: webhook aktif di tempat lain. Hentikan salah satu (${data.description})`)
          await new Promise((r) => setTimeout(r, 30_000))
          continue
        }
        throw new Error(`getUpdates gagal: ${data.description || res.status}`)
      }
      for (const u of data.result || []) {
        offset = u.update_id + 1
        try {
          const fwd = await fetch(`${APP_URL}/api/telegram/webhook${SECRET_Q}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(u),
            signal: AbortSignal.timeout(120_000), // OCR/unduh file bisa lambat
          })
          const bodyText = await fwd.text().catch(() => '')
          if (!fwd.ok) {
            console.error(`[${stamp()}] × Teruskan update ${u.update_id} gagal: HTTP ${fwd.status} ${bodyText.slice(0, 200)}`)
          } else {
            console.log(`[${stamp()}] → update ${u.update_id} diproses: ${bodyText.slice(0, 160)}`)
          }
        } catch (e) {
          console.error(`[${stamp()}] × Teruskan update ${u.update_id} error: ${e.message}`)
        }
      }
    } catch (e) {
      console.error(`[${stamp()}] × Poll error (retry 5 dt): ${e.message}`)
      await new Promise((r) => setTimeout(r, 5_000))
    }
  }
}

process.on('SIGINT', () => {
  console.log(`\n[${stamp()}] Berhenti.`)
  db.$disconnect()
    .catch(() => undefined)
    .finally(() => process.exit(0))
})

main().catch((e) => {
  console.error(`[${stamp()}] ✗ Fatal: ${e?.message || e}`)
  process.exit(1)
})
