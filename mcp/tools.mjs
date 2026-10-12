/**
 * AfterSales Pro — MCP Tools
 * ==========================
 * Kumpulan tool Model Context Protocol (MCP) yang mengekspos data & operasi
 * aplikasi kepada AI assistant (Claude Desktop, Cursor, dll).
 *
 * Semua tool berbicara langsung ke database SQLite aplikasi (sama dengan
 * yang dipakai aplikasi desktop/web), sehingga AI bisa:
 *   - membaca ringkasan bisnis (stats, toko, customer, sparepart, unit, tiket)
 *   - mencatat kunjungan via barcode toko (check-in otomatis, sama dengan scan)
 *   - menambah/memperbarui master data
 *   - mengirim notifikasi lewat Gateway (WhatsApp/Telegram)
 *   - menjalankan backup data bersama
 *
 * Database path resolusi (urutan prioritas):
 *   1. ASPRO_DB_PATH      → path absolut file .db (dipakai versi desktop)
 *   2. DATABASE_URL       → format file:/path/ke/db.db
 *   3. fallback           → <cwd>/db/custom.db
 */

import path from 'node:path'
import fs from 'node:fs'
import { PrismaClient } from '@prisma/client'

// ---------- Resolusi path database ----------

function resolveDbPath() {
  if (process.env.ASPRO_DB_PATH) return process.env.ASPRO_DB_PATH
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL.replace(/^file:/, '')
  return path.resolve(process.cwd(), 'db', 'custom.db')
}

const DB_PATH = resolveDbPath()
const DB_DIR = path.dirname(DB_PATH)
const BACKUP_DIR = process.env.ASPRO_BACKUP_DIR || path.join(DB_DIR, 'backups')

// PrismaClient membaca DATABASE_URL saat constructor
process.env.DATABASE_URL = `file:${DB_PATH}`

const db = new PrismaClient()

export const APP_INFO = {
  name: 'aftersales-pro',
  version: '1.0.0',
  dbPath: DB_PATH,
}

// ---------- Helper umum ----------

function jsonOut(data) {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
}

function errOut(message) {
  return { isError: true, content: [{ type: 'text', text: `ERROR: ${message}` }] }
}

async function logAudit({ aksi, entitas, entitasId, deskripsi, aktor = 'MCP AI' }) {
  await db.auditLog.create({ data: { aksi, entitas, entitasId, deskripsi, aktor } })
}

const fmtTanggal = (d) =>
  d ? new Date(d).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' }) : ''

async function nextSequence(model, field, prefix) {
  // Cari nomor urut terbesar berpola PREFIX-### lalu tambah 1
  const rows = await model.findMany({ select: { [field]: true } })
  let max = 0
  const re = new RegExp(`^${prefix}-(\\d+)$`, 'i')
  for (const r of rows) {
    const m = re.exec(String(r[field] ?? ''))
    if (m) max = Math.max(max, parseInt(m[1], 10))
  }
  return `${prefix}-${String(max + 1).padStart(3, '0')}`
}

// ---------- Gateway inline (kirim notifikasi) ----------

async function getGatewayConfig() {
  const rows = await db.pengaturan.findMany({ where: { kunci: { startsWith: 'gateway_' } } })
  const map = {}
  for (const r of rows) map[r.kunci] = r.nilai
  return {
    waAktif: map['gateway_wa_aktif'] !== 'false',
    waUrl: map['gateway_wa_url'] ?? '',
    waToken: map['gateway_wa_token'] ?? '',
    tgAktif: map['gateway_tg_aktif'] === 'true',
    tgToken: map['gateway_tg_token'] ?? '',
    tgChatId: map['gateway_tg_chat_id'] ?? '',
    channelDefault: map['gateway_channel_default'] === 'TELEGRAM' ? 'TELEGRAM' : 'WHATSAPP',
  }
}

async function sendGateway(channel, text) {
  const cfg = await getGatewayConfig()
  const ch = channel || cfg.channelDefault
  try {
    if (ch === 'TELEGRAM') {
      if (!cfg.tgAktif || !cfg.tgToken || !cfg.tgChatId) {
        return { ok: true, mode: 'SIMULASI', detail: 'Telegram belum dikonfigurasi — pesan hanya tercatat di log gateway.' }
      }
      const res = await fetch(`https://api.telegram.org/bot${cfg.tgToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: cfg.tgChatId, text, parse_mode: 'Markdown' }),
        signal: AbortSignal.timeout(10_000),
      })
      const data = await res.json().catch(() => ({}))
      return res.ok && data.ok
        ? { ok: true, mode: 'REAL', detail: 'Terkirim via Telegram Bot API.' }
        : { ok: false, mode: 'REAL', detail: `Telegram API menolak: ${data.description ?? res.status}` }
    }
    if (!cfg.waAktif || !cfg.waUrl) {
      return { ok: true, mode: 'SIMULASI', detail: 'WhatsApp gateway belum dikonfigurasi — pesan hanya tercatat di log gateway.' }
    }
    const res = await fetch(cfg.waUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(cfg.waToken ? { Authorization: `Bearer ${cfg.waToken}` } : {}) },
      body: JSON.stringify({ message: text }),
      signal: AbortSignal.timeout(10_000),
    })
    return res.ok
      ? { ok: true, mode: 'REAL', detail: `Terkirim via WhatsApp gateway (HTTP ${res.status}).` }
      : { ok: false, mode: 'REAL', detail: `WhatsApp gateway menolak: HTTP ${res.status}` }
  } catch (e) {
    return { ok: false, mode: 'REAL', detail: `Gagal menghubungi gateway: ${e.message}` }
  }
}

async function logWaMessage({ pengirim, channel, tipe, pesan, meta }) {
  await db.waMessage.create({ data: { pengirim, channel, tipe, pesan, meta: meta ? JSON.stringify(meta) : null } })
}

// ---------- Resolver toko (barcode / kode / id) — mirip logika scan aplikasi ----------

async function resolveToko({ tokoId, kodeToko, barcode }) {
  if (tokoId) {
    return db.masterToko.findUnique({ where: { id: Number(tokoId) } })
  }
  const norm = String(kodeToko || barcode || '').trim().toUpperCase().replace(/^BC-/, '')
  if (!norm) return null
  const byUnique = await db.masterToko.findFirst({
    where: { OR: [{ barcodeToko: `BC-${norm}` }, { barcodeToko: String(barcode ?? '').trim() }, { kodeToko: norm }] },
  })
  if (byUnique) return byUnique
  // Fallback scan dataset kecil (SQLite tidak punya mode insensitive)
  const all = await db.masterToko.findMany()
  return all.find((t) => (t.barcodeToko ?? '').toUpperCase().replace(/^BC-/, '') === norm || t.kodeToko.toUpperCase() === norm) ?? null
}

// ---------- Definisi tools (JSON Schema — tanpa dependensi zod) ----------

const str = { type: 'string' }
const num = { type: 'number' }
const bool = { type: 'boolean' }

export const TOOLS = [
  {
    name: 'get_stats',
    description:
      'Ringkasan KPI AfterSales Pro: jumlah toko, customer, sparepart, unit, kunjungan bulan ini, tiket per status, klaim, stok kritis, dan toko yang kunjungannya terlambat.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'list_toko',
    description: 'Daftar toko (cari dengan kata kunci q pada kode/nama/alamat/kontak). Hasil termasuk barcode toko untuk scan kunjungan.',
    inputSchema: {
      type: 'object',
      properties: { q: str, limit: { type: 'number', default: 20 }, offset: { type: 'number', default: 0 } },
      additionalProperties: false,
    },
  },
  {
    name: 'get_toko',
    description: 'Detail satu toko (cari via id, kodeToko, atau barcode). Termasuk jumlah unit, kunjungan terakhir, dan tiket terkait.',
    inputSchema: {
      type: 'object',
      properties: { id: num, kodeToko: str, barcode: str },
      additionalProperties: false,
    },
  },
  {
    name: 'add_toko',
    description: 'Tambah toko baru. kodeToko & barcode toko (BC-{KODETOKO}) dibuat otomatis bila tidak diberikan.',
    inputSchema: {
      type: 'object',
      properties: {
        namaToko: { type: 'string', description: 'Nama toko (wajib)' },
        kodeToko: str,
        alamat: str,
        kontak: str,
        frekuensiVisit: { type: 'number', description: 'Siklus kunjungan dalam hari (default 14)' },
      },
      required: ['namaToko'],
      additionalProperties: false,
    },
  },
  {
    name: 'update_toko',
    description: 'Perbarui data toko berdasarkan id (nama, alamat, kontak, siklus kunjungan).',
    inputSchema: {
      type: 'object',
      properties: {
        id: num,
        namaToko: str,
        alamat: str,
        kontak: str,
        frekuensiVisit: num,
      },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_customer',
    description: 'Daftar customer beserta jumlah unit yang dimiliki.',
    inputSchema: {
      type: 'object',
      properties: { q: str, limit: { type: 'number', default: 20 }, offset: { type: 'number', default: 0 } },
      additionalProperties: false,
    },
  },
  {
    name: 'add_customer',
    description: 'Tambah customer baru (nama wajib; noWa & alamat opsional).',
    inputSchema: {
      type: 'object',
      properties: { nama: str, noWa: str, alamat: str },
      required: ['nama'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_sparepart',
    description: 'Daftar sparepart inventory. Set lowStockOnly=true untuk hanya menampilkan stok <= reorder limit.',
    inputSchema: {
      type: 'object',
      properties: {
        q: str,
        lowStockOnly: bool,
        limit: { type: 'number', default: 30 },
        offset: { type: 'number', default: 0 },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'add_sparepart',
    description: 'Tambah sparepart baru. kodePart dibuat otomatis (SP-###) bila tidak diberikan.',
    inputSchema: {
      type: 'object',
      properties: {
        namaPart: { type: 'string', description: 'Nama sparepart (wajib)' },
        kodePart: str,
        brandKompatibel: { type: 'string', description: 'Brand kompatibel, pisah koma (mis. Samsung, LG)' },
        supplier: { type: 'string', description: 'Nama supplier' },
        stokJual: { type: 'number', description: 'Stok bisa jual' },
        stokGaransi: { type: 'number', description: 'Stok garansi' },
        stokInventory: num,
        reorderLimit: num,
        hargaKlaim: num,
      },
      required: ['namaPart'],
      additionalProperties: false,
    },
  },
  {
    name: 'update_sparepart',
    description: 'Perbarui sparepart: stok jual/garansi, brand kompatibel, supplier, reorder limit, harga klaim, atau nama.',
    inputSchema: {
      type: 'object',
      properties: {
        id: num,
        namaPart: str,
        brandKompatibel: { type: 'string' },
        supplier: { type: 'string' },
        stokJual: num,
        stokGaransi: num,
        stokInventory: num,
        reorderLimit: num,
        hargaKlaim: num,
      },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_unit',
    description: 'Daftar unit asset (serial number, model, toko, pemilik, status garansi).',
    inputSchema: {
      type: 'object',
      properties: {
        q: str,
        tokoId: num,
        statusGaransi: { type: 'string', enum: ['GARANSI', 'NON_GARANSI'] },
        limit: { type: 'number', default: 20 },
        offset: { type: 'number', default: 0 },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'add_unit',
    description: 'Daftarkan unit asset baru (serial number & model wajib; bisa dikaitkan ke toko/customer).',
    inputSchema: {
      type: 'object',
      properties: {
        serialNumber: str,
        modelUnit: str,
        tokoId: num,
        customerId: num,
        statusGaransi: { type: 'string', enum: ['GARANSI', 'NON_GARANSI'] },
      },
      required: ['serialNumber', 'modelUnit'],
      additionalProperties: false,
    },
  },
  {
    name: 'record_kunjungan',
    description:
      'Catat kunjungan onsite (check-in). Sama dengan scan barcode toko di aplikasi: berikan barcode toko (mis. BC-TOK-001) ATAU tokoId/kodeToko. Siklus kunjungan toko otomatis di-reset, audit log tercatat, dan notifikasi gateway dikirim bila terkonfigurasi.',
    inputSchema: {
      type: 'object',
      properties: {
        barcode: { type: 'string', description: 'Nilai barcode toko, mis. BC-TOK-001' },
        tokoId: num,
        kodeToko: str,
        teknisiId: { type: 'number', description: 'Opsional — default: pengguna aktif pertama' },
        catatan: str,
      },
      additionalProperties: false,
    },
  },
  {
    name: 'list_kunjungan',
    description: 'Riwayat kunjungan onsite terbaru, bisa difilter per toko.',
    inputSchema: {
      type: 'object',
      properties: { tokoId: num, limit: { type: 'number', default: 20 } },
      additionalProperties: false,
    },
  },
  {
    name: 'list_service',
    description: 'Daftar tiket service request (status REQUEST/PROSES/FINISH) beserta parts dan klaim produsen.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['REQUEST', 'PROSES', 'FINISH'] },
        limit: { type: 'number', default: 20 },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'send_gateway_message',
    description:
      'Kirim pesan notifikasi melalui Gateway (WhatsApp/Telegram sesuai konfigurasi Pengaturan). Mode SIMULASI bila kredensial belum diisi — pesan tetap tercatat di log gateway.',
    inputSchema: {
      type: 'object',
      properties: {
        pesan: { type: 'string', description: 'Isi pesan' },
        channel: { type: 'string', enum: ['WHATSAPP', 'TELEGRAM'] },
      },
      required: ['pesan'],
      additionalProperties: false,
    },
  },
  {
    name: 'set_gateway_config',
    description:
      'Simpan konfigurasi Gateway dari AI: token bot Telegram, chat ID, URL/token WhatsApp, channel default. Kolom yang tidak diberikan tidak diubah.',
    inputSchema: {
      type: 'object',
      properties: {
        telegramToken: str,
        telegramChatId: str,
        telegramAktif: bool,
        waUrl: str,
        waToken: str,
        waAktif: bool,
        channelDefault: { type: 'string', enum: ['WHATSAPP', 'TELEGRAM'] },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'run_backup',
    description:
      'Jalankan backup data bersama sekarang. Bila aplikasi desktop/server sedang jalan → backup ke Google Spreadsheet sesuai konfigurasi. Bila tidak → snapshot JSON lokal (folder backups) supaya data tetap terjaga.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'list_audit',
    description: 'Audit activity log terbaru (jejak semua perubahan data).',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'number', default: 30 } },
      additionalProperties: false,
    },
  },
]

// ---------- Implementasi handler ----------

async function hGetStats() {
  const now = new Date()
  const awalBulan = new Date(now.getFullYear(), now.getMonth(), 1)

  const [toko, customer, sparepart, unit, kunjunganBulan, tiketRequest, tiketProses, tiketFinish, klaimDraft, klaimSubmitted] =
    await Promise.all([
      db.masterToko.count(),
      db.masterCustomer.count(),
      db.masterSparepart.count(),
      db.unitAsset.count(),
      db.kunjungan.count({ where: { tglKunjungan: { gte: awalBulan } } }),
      db.serviceRequest.count({ where: { status: 'REQUEST' } }),
      db.serviceRequest.count({ where: { status: 'PROSES' } }),
      db.serviceRequest.count({ where: { status: 'FINISH' } }),
      db.serviceRequest.count({ where: { statusKlaimProdusen: 'DRAFT' } }),
      db.serviceRequest.count({ where: { statusKlaimProdusen: 'SUBMITTED' } }),
    ])

  const semuaSparepart = await db.masterSparepart.findMany({
    select: { kodePart: true, namaPart: true, brandKompatibel: true, supplier: true, stokJual: true, stokGaransi: true, stokInventory: true, reorderLimit: true },
    orderBy: { stokInventory: 'asc' },
  })
  const stokKritis = semuaSparepart
    .filter((s) => s.stokInventory <= s.reorderLimit)
    .slice(0, 10)

  const tokos = await db.masterToko.findMany()
  const hariIni = Date.now()
  const terlambat = tokos
    .filter((t) => {
      if (!t.tglVisitTerakhir) return true
      const due = new Date(t.tglVisitTerakhir).getTime() + t.frekuensiVisit * 86_400_000
      return due < hariIni
    })
    .map((t) => ({ kodeToko: t.kodeToko, namaToko: t.namaToko, visitTerakhir: fmtTanggal(t.tglVisitTerakhir) || 'BELUM PERNAH', siklus: t.frekuensiVisit }))

  return jsonOut({
    ringkasan: { toko, customer, sparepart, unit, kunjunganBulanIni: kunjunganBulan },
    tiketService: { request: tiketRequest, proses: tiketProses, finish: tiketFinish },
    klaimProdusen: { draft: klaimDraft, submitted: klaimSubmitted },
    stokKritis,
    kunjunganTerlambat: terlambat.slice(0, 10),
    jumlahKunjunganTerlambat: terlambat.length,
  })
}

async function hListToko(args) {
  const q = (args.q ?? '').trim()
  const take = Math.min(Number(args.limit) || 20, 100)
  const skip = Number(args.offset) || 0
  const where = q
    ? {
        OR: [
          { kodeToko: { contains: q } },
          { namaToko: { contains: q } },
          { alamat: { contains: q } },
          { kontak: { contains: q } },
        ],
      }
    : {}
  const [total, rows] = await Promise.all([
    db.masterToko.count({ where }),
    db.masterToko.findMany({
      where,
      orderBy: { kodeToko: 'asc' },
      take,
      skip,
      select: {
        id: true, kodeToko: true, namaToko: true, alamat: true, kontak: true,
        frekuensiVisit: true, tglVisitTerakhir: true, barcodeToko: true,
      },
    }),
  ])
  return jsonOut({
    total,
    menampilkan: rows.length,
    toko: rows.map((t) => ({ ...t, tglVisitTerakhir: fmtTanggal(t.tglVisitTerakhir) })),
  })
}

async function hGetToko(args) {
  const toko = await resolveToko(args)
  if (!toko) return errOut('Toko tidak ditemukan. Berikan id, kodeToko, atau barcode yang valid.')
  const [unitCount, kunjungan, tiket] = await Promise.all([
    db.unitAsset.count({ where: { tokoId: toko.id } }),
    db.kunjungan.findMany({
      where: { tokoId: toko.id },
      orderBy: { tglKunjungan: 'desc' },
      take: 5,
      include: { teknisi: { select: { nama: true } } },
    }),
    db.serviceRequest.findMany({
      where: { unitAsset: { tokoId: toko.id } },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { noTiket: true, status: true, createdAt: true },
    }),
  ])
  return jsonOut({
    toko: { ...toko, tglVisitTerakhir: fmtTanggal(toko.tglVisitTerakhir) },
    jumlahUnit: unitCount,
    kunjunganTerakhir: kunjungan.map((k) => ({
      waktu: fmtTanggal(k.tglKunjungan), teknisi: k.teknisi.nama, metode: k.metodeCheckin,
    })),
    tiketTerakhir: tiket,
  })
}

async function hAddToko(args) {
  const namaToko = String(args.namaToko ?? '').trim()
  if (!namaToko) return errOut('namaToko wajib diisi.')
  const kodeToko = (args.kodeToko ? String(args.kodeToko).trim().toUpperCase() : await nextSequence(db.masterToko, 'kodeToko', 'TOK'))
  const exists = await db.masterToko.findUnique({ where: { kodeToko } })
  if (exists) return errOut(`Kode toko ${kodeToko} sudah terdaftar.`)
  const barcodeToko = `BC-${kodeToko}`
  const barcodeExists = await db.masterToko.findUnique({ where: { barcodeToko } })
  if (barcodeExists) return errOut(`Barcode ${barcodeToko} sudah dipakai toko lain.`)
  const toko = await db.masterToko.create({
    data: {
      kodeToko,
      namaToko,
      alamat: args.alamat ?? null,
      kontak: args.kontak ?? null,
      frekuensiVisit: Number(args.frekuensiVisit) || 14,
      barcodeToko,
    },
  })
  await logAudit({
    aksi: 'CREATE', entitas: 'master_toko', entitasId: toko.kodeToko,
    deskripsi: `Toko baru ditambahkan via MCP AI: ${toko.namaToko} — barcode kunjungan ${toko.barcodeToko}`,
  })
  return jsonOut({ ok: true, toko })
}

async function hUpdateToko(args) {
  const id = Number(args.id)
  if (!id) return errOut('id toko wajib diisi.')
  const data = {}
  if (args.namaToko != null) data.namaToko = String(args.namaToko).trim()
  if (args.alamat != null) data.alamat = String(args.alamat)
  if (args.kontak != null) data.kontak = String(args.kontak)
  if (args.frekuensiVisit != null) data.frekuensiVisit = Number(args.frekuensiVisit) || 14
  if (Object.keys(data).length === 0) return errOut('Tidak ada kolom yang diubah.')
  try {
    const toko = await db.masterToko.update({ where: { id }, data })
    await logAudit({ aksi: 'UPDATE', entitas: 'master_toko', entitasId: toko.kodeToko, deskripsi: `Data toko diperbarui via MCP AI: ${toko.namaToko}` })
    return jsonOut({ ok: true, toko })
  } catch {
    return errOut(`Toko dengan id ${id} tidak ditemukan.`)
  }
}

async function hListCustomer(args) {
  const q = (args.q ?? '').trim()
  const take = Math.min(Number(args.limit) || 20, 100)
  const skip = Number(args.offset) || 0
  const where = q ? { OR: [{ nama: { contains: q } }, { noWa: { contains: q } }, { alamat: { contains: q } }] } : {}
  const [total, rows] = await Promise.all([
    db.masterCustomer.count({ where }),
    db.masterCustomer.findMany({
      where, orderBy: { nama: 'asc' }, take, skip,
      include: { unitAssets: { select: { modelUnit: true } } },
    }),
  ])
  return jsonOut({
    total,
    customer: rows.map((c) => ({ id: c.id, nama: c.nama, noWa: c.noWa, alamat: c.alamat, jumlahUnit: c.unitAssets.length })),
  })
}

async function hAddCustomer(args) {
  const nama = String(args.nama ?? '').trim()
  if (!nama) return errOut('nama customer wajib diisi.')
  const customer = await db.masterCustomer.create({
    data: { nama, noWa: args.noWa ?? null, alamat: args.alamat ?? null },
  })
  await logAudit({ aksi: 'CREATE', entitas: 'master_customer', entitasId: String(customer.id), deskripsi: `Customer baru ditambahkan via MCP AI: ${customer.nama}` })
  return jsonOut({ ok: true, customer })
}

async function hListSparepart(args) {
  const q = (args.q ?? '').trim()
  const take = Math.min(Number(args.limit) || 30, 200)
  const skip = Number(args.offset) || 0
  const where = q ? { OR: [{ kodePart: { contains: q } }, { namaPart: { contains: q } }, { brandKompatibel: { contains: q } }, { supplier: { contains: q } }] } : {}
  let rows = await db.masterSparepart.findMany({ where, orderBy: { kodePart: 'asc' }, take: args.lowStockOnly ? 1000 : take, skip })
  if (args.lowStockOnly) {
    rows = rows.filter((s) => s.stokInventory <= s.reorderLimit).slice(0, take)
  }
  return jsonOut({ total: rows.length, sparepart: rows })
}

async function hAddSparepart(args) {
  const namaPart = String(args.namaPart ?? '').trim()
  if (!namaPart) return errOut('namaPart wajib diisi.')
  const kodePart = (args.kodePart ? String(args.kodePart).trim().toUpperCase() : await nextSequence(db.masterSparepart, 'kodePart', 'SP'))
  const exists = await db.masterSparepart.findUnique({ where: { kodePart } })
  if (exists) return errOut(`Kode part ${kodePart} sudah terdaftar.`)
  const stokJual = Math.max(0, Math.trunc(Number(args.stokJual ?? args.stokInventory) || 0))
  const stokGaransi = Math.max(0, Math.trunc(Number(args.stokGaransi) || 0))
  const sparepart = await db.masterSparepart.create({
    data: {
      kodePart,
      namaPart,
      brandKompatibel: String(args.brandKompatibel ?? '').trim(),
      supplier: String(args.supplier ?? '').trim(),
      stokJual,
      stokGaransi,
      stokInventory: stokJual + stokGaransi,
      reorderLimit: Number(args.reorderLimit) || 5,
      hargaKlaim: Number(args.hargaKlaim) || 0,
    },
  })
  await logAudit({ aksi: 'CREATE', entitas: 'master_sparepart', entitasId: sparepart.kodePart, deskripsi: `Sparepart baru via MCP AI: ${sparepart.kodePart} — ${sparepart.namaPart}` })
  return jsonOut({ ok: true, sparepart })
}

async function hUpdateSparepart(args) {
  const id = Number(args.id)
  if (!id) return errOut('id sparepart wajib diisi.')
  const existing = await db.masterSparepart.findUnique({ where: { id } })
  if (!existing) return errOut(`Sparepart dengan id ${id} tidak ditemukan.`)
  const data = {}
  if (args.namaPart != null) data.namaPart = String(args.namaPart).trim()
  if (args.brandKompatibel != null) data.brandKompatibel = String(args.brandKompatibel).trim()
  if (args.supplier != null) data.supplier = String(args.supplier).trim()
  if (args.stokJual != null) data.stokJual = Math.max(0, Math.trunc(Number(args.stokJual)))
  if (args.stokGaransi != null) data.stokGaransi = Math.max(0, Math.trunc(Number(args.stokGaransi)))
  if (args.stokInventory != null && args.stokJual == null && args.stokGaransi == null) {
    // legacy: total saja → selisih masuk stok jual
    data.stokInventory = Math.max(0, Math.trunc(Number(args.stokInventory)))
    data.stokJual = Math.max(0, data.stokInventory - existing.stokGaransi)
  }
  if (data.stokJual != null || data.stokGaransi != null) {
    data.stokInventory = (data.stokJual ?? existing.stokJual) + (data.stokGaransi ?? existing.stokGaransi)
  }
  if (args.reorderLimit != null) data.reorderLimit = Math.max(0, Math.trunc(Number(args.reorderLimit)))
  if (args.hargaKlaim != null) data.hargaKlaim = Math.max(0, Number(args.hargaKlaim))
  if (Object.keys(data).length === 0) return errOut('Tidak ada kolom yang diubah.')
  try {
    const sparepart = await db.masterSparepart.update({ where: { id }, data })
    await logAudit({ aksi: 'UPDATE', entitas: 'master_sparepart', entitasId: sparepart.kodePart, deskripsi: `Sparepart diperbarui via MCP AI: ${sparepart.kodePart} (jual ${sparepart.stokJual}, garansi ${sparepart.stokGaransi})` })
    return jsonOut({ ok: true, sparepart })
  } catch {
    return errOut(`Sparepart dengan id ${id} tidak ditemukan.`)
  }
}

async function hListUnit(args) {
  const q = (args.q ?? '').trim()
  const take = Math.min(Number(args.limit) || 20, 100)
  const skip = Number(args.offset) || 0
  const where = {
    ...(args.tokoId ? { tokoId: Number(args.tokoId) } : {}),
    ...(args.statusGaransi ? { statusGaransi: args.statusGaransi } : {}),
    ...(q ? { OR: [{ serialNumber: { contains: q } }, { modelUnit: { contains: q } }] } : {}),
  }
  const [total, rows] = await Promise.all([
    db.unitAsset.count({ where }),
    db.unitAsset.findMany({
      where, orderBy: { serialNumber: 'asc' }, take, skip,
      include: { toko: { select: { kodeToko: true, namaToko: true } }, customer: { select: { nama: true } } },
    }),
  ])
  return jsonOut({
    total,
    unit: rows.map((u) => ({
      id: u.id, serialNumber: u.serialNumber, modelUnit: u.modelUnit,
      toko: u.toko ? `${u.toko.kodeToko} — ${u.toko.namaToko}` : null,
      pemilik: u.customer?.nama ?? null, statusGaransi: u.statusGaransi,
      tglPembelian: fmtTanggal(u.tglPembelian),
    })),
  })
}

async function hAddUnit(args) {
  const serialNumber = String(args.serialNumber ?? '').trim()
  const modelUnit = String(args.modelUnit ?? '').trim()
  if (!serialNumber || !modelUnit) return errOut('serialNumber dan modelUnit wajib diisi.')
  const exists = await db.unitAsset.findUnique({ where: { serialNumber } })
  if (exists) return errOut(`Serial number ${serialNumber} sudah terdaftar.`)
  const unit = await db.unitAsset.create({
    data: {
      serialNumber, modelUnit,
      tokoId: args.tokoId ? Number(args.tokoId) : null,
      customerId: args.customerId ? Number(args.customerId) : null,
      statusGaransi: args.statusGaransi === 'NON_GARANSI' ? 'NON_GARANSI' : 'GARANSI',
    },
  })
  await logAudit({ aksi: 'CREATE', entitas: 'unit_asset', entitasId: unit.serialNumber, deskripsi: `Unit baru via MCP AI: ${unit.serialNumber} (${unit.modelUnit})` })
  return jsonOut({ ok: true, unit })
}

async function hRecordKunjungan(args) {
  // Resolusi toko — identik dengan logika scan barcode di aplikasi
  const toko = await resolveToko(args)
  if (!toko) return errOut('Toko tidak dikenali. Berikan barcode toko (mis. BC-TOK-001), kodeToko, atau tokoId yang valid.')

  // Teknisi: dari argumen atau default pengguna aktif pertama
  let teknisi = null
  if (args.teknisiId) teknisi = await db.pengguna.findUnique({ where: { id: Number(args.teknisiId) } })
  if (!teknisi) teknisi = await db.pengguna.findFirst({ where: { aktif: true }, orderBy: { id: 'asc' } })
  if (!teknisi) return errOut('Belum ada pengguna (teknisi) terdaftar. Tambahkan pengguna terlebih dahulu di aplikasi.')

  const barcodeTerscan = args.barcode ? String(args.barcode).trim() : toko.barcodeToko
  const [kunjungan] = await Promise.all([
    db.kunjungan.create({
      data: {
        tokoId: toko.id,
        teknisiId: teknisi.id,
        metodeCheckin: 'SCAN_BARCODE',
        barcodeTerscan,
        catatanStokRusak: args.catatan ?? null,
      },
    }),
    db.masterToko.update({ where: { id: toko.id }, data: { tglVisitTerakhir: new Date() } }),
  ])

  await logAudit({
    aksi: 'CREATE_KUNJUNGAN', entitas: 'kunjungan', entitasId: String(kunjungan.id),
    deskripsi: `Teknisi ${teknisi.nama} check-in via MCP AI (scan barcode) di ${toko.namaToko} (${toko.kodeToko}) — barcode: ${barcodeTerscan}`,
    aktor: `MCP AI (${teknisi.nama})`,
  })

  // Notifikasi gateway (kalau terkonfigurasi) — konsisten dengan channel aplikasi
  const cfg = await getGatewayConfig()
  const pesan = `📍 *Check-in Kunjungan*\nToko: ${toko.namaToko} (${toko.kodeToko})\nTeknisi: ${teknisi.nama}\nMetode: Scan Barcode (${barcodeTerscan})\nSumber: MCP AI${args.catatan ? `\nCatatan: ${args.catatan}` : ''}`
  const kirim = await sendGateway(null, pesan)
  await logWaMessage({
    pengirim: 'MCP AI', channel: cfg.channelDefault, tipe: 'OUT', pesan,
    meta: { aksi: 'CHECKIN_MCP', kunjunganId: kunjungan.id, mode: kirim.mode },
  })

  return jsonOut({
    ok: true,
    kunjungan: { id: kunjungan.id, waktu: fmtTanggal(kunjungan.tglKunjungan), metode: kunjungan.metodeCheckin },
    toko: { id: toko.id, kodeToko: toko.kodeToko, namaToko: toko.namaToko, barcode: toko.barcodeToko },
    teknisi: { id: teknisi.id, nama: teknisi.nama },
    gateway: kirim,
  })
}

async function hListKunjungan(args) {
  const take = Math.min(Number(args.limit) || 20, 100)
  const rows = await db.kunjungan.findMany({
    where: args.tokoId ? { tokoId: Number(args.tokoId) } : {},
    orderBy: { tglKunjungan: 'desc' },
    take,
    include: {
      toko: { select: { kodeToko: true, namaToko: true } },
      teknisi: { select: { nama: true } },
    },
  })
  return jsonOut({
    total: rows.length,
    kunjungan: rows.map((k) => ({
      id: k.id,
      waktu: fmtTanggal(k.tglKunjungan),
      toko: `${k.toko.kodeToko} — ${k.toko.namaToko}`,
      teknisi: k.teknisi.nama,
      metode: k.metodeCheckin,
      barcode: k.barcodeTerscan,
      catatan: k.catatanStokRusak,
    })),
  })
}

async function hListService(args) {
  const take = Math.min(Number(args.limit) || 20, 100)
  const rows = await db.serviceRequest.findMany({
    where: args.status ? { status: args.status } : {},
    orderBy: { createdAt: 'desc' },
    take,
    include: {
      unitAsset: { include: { toko: { select: { kodeToko: true, namaToko: true } } } },
      parts: { include: { sparepart: { select: { kodePart: true, namaPart: true } } } },
    },
  })
  return jsonOut({
    total: rows.length,
    tiket: rows.map((t) => ({
      noTiket: t.noTiket, status: t.status,
      unit: `${t.unitAsset.serialNumber} (${t.unitAsset.modelUnit})`,
      toko: t.unitAsset.toko ? `${t.unitAsset.toko.kodeToko} — ${t.unitAsset.toko.namaToko}` : null,
      slaFlag: t.slaFlag, statusKlaim: t.statusKlaimProdusen, biayaJasa: t.biayaJasa,
      parts: t.parts.map((p) => `${p.sparepart.kodePart} x${p.qty}`),
      dibuat: fmtTanggal(t.createdAt), selesai: fmtTanggal(t.tglFinish),
    })),
  })
}

async function hSendGatewayMessage(args) {
  const pesan = String(args.pesan ?? '').trim()
  if (!pesan) return errOut('pesan wajib diisi.')
  const cfg = await getGatewayConfig()
  const channel = args.channel || cfg.channelDefault
  const hasil = await sendGateway(channel, pesan)
  await logWaMessage({
    pengirim: 'MCP AI', channel, tipe: 'OUT', pesan,
    meta: { aksi: 'SEND_MCP', mode: hasil.mode },
  })
  return jsonOut({ ok: hasil.ok, channel, mode: hasil.mode, detail: hasil.detail })
}

async function hSetGatewayConfig(args) {
  const updates = []
  const put = async (kunci, nilai) => {
    await db.pengaturan.upsert({
      where: { kunci },
      update: { nilai: String(nilai) },
      create: { kunci, nilai: String(nilai) },
    })
    updates.push(kunci)
  }
  if (args.telegramToken != null) await put('gateway_tg_token', args.telegramToken)
  if (args.telegramChatId != null) await put('gateway_tg_chat_id', args.telegramChatId)
  if (args.telegramAktif != null) await put('gateway_tg_aktif', args.telegramAktif)
  if (args.waUrl != null) await put('gateway_wa_url', args.waUrl)
  if (args.waToken != null) await put('gateway_wa_token', args.waToken)
  if (args.waAktif != null) await put('gateway_wa_aktif', args.waAktif)
  if (args.channelDefault) await put('gateway_channel_default', args.channelDefault)
  if (updates.length === 0) return errOut('Tidak ada konfigurasi yang diberikan.')
  await logAudit({ aksi: 'UPDATE', entitas: 'pengaturan', entitasId: 'gateway', deskripsi: `Konfigurasi Gateway diperbarui via MCP AI (${updates.join(', ')})` })
  return jsonOut({ ok: true, kunciDiubah: updates })
}

// Backup: jalankan via aplikasi bila online, selain itu snapshot lokal
async function hRunBackup() {
  const appUrl = process.env.ASPRO_APP_URL
  if (appUrl) {
    try {
      const res = await fetch(`${appUrl.replace(/\/$/, '')}/api/backup/sheets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trigger: 'AUTO', aktor: 'MCP AI' }),
        signal: AbortSignal.timeout(60_000),
      })
      if (res.ok) {
        const outcome = await res.json()
        return jsonOut({ ok: true, via: 'aplikasi', ...outcome })
      }
    } catch {
      // jatuh ke snapshot lokal di bawah
    }
  }

  // Snapshot lokal (fallback) — kumpulkan seluruh tabel utama
  const [tokos, customers, spareparts, units, kunjungan, tikets] = await Promise.all([
    db.masterToko.findMany(),
    db.masterCustomer.findMany(),
    db.masterSparepart.findMany(),
    db.unitAsset.findMany(),
    db.kunjungan.findMany({ take: 1000, orderBy: { tglKunjungan: 'desc' } }),
    db.serviceRequest.findMany({ take: 1000, orderBy: { createdAt: 'desc' } }),
  ])
  fs.mkdirSync(BACKUP_DIR, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const file = path.join(BACKUP_DIR, `backup-mcp-${stamp}.json`)
  const payload = {
    dibuat: new Date().toISOString(),
    sumber: 'MCP AI (snapshot lokal)',
    toko: tokos, customer: customers, sparepart: spareparts, unit: units, kunjungan, tiketService: tikets,
  }
  fs.writeFileSync(file, JSON.stringify(payload, null, 2))
  const rowsTotal = tokos.length + customers.length + spareparts.length + units.length + kunjungan.length + tikets.length
  await db.backupLog.create({
    data: { status: 'LOCAL', trigger: 'AUTO', sheetsWritten: 0, rowsTotal, tabel: 'toko, customer, sparepart, unit, kunjungan, tiket', message: `Snapshot lokal via MCP AI: ${path.basename(file)}` },
  })
  await logAudit({ aksi: 'BACKUP', entitas: 'backup_log', deskripsi: `Backup data bersama via MCP AI — snapshot lokal ${path.basename(file)} (${rowsTotal} baris)` })
  return jsonOut({ ok: true, via: 'snapshot-lokal', file, rowsTotal, catatan: 'Isi kredensial Google Sheets di Pengaturan untuk backup ke spreadsheet bersama.' })
}

async function hListAudit(args) {
  const take = Math.min(Number(args.limit) || 30, 150)
  const rows = await db.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take })
  return jsonOut({
    total: rows.length,
    log: rows.map((l) => ({ waktu: fmtTanggal(l.createdAt), aksi: l.aksi, entitas: l.entitas, entitasId: l.entitasId, aktor: l.aktor, deskripsi: l.deskripsi })),
  })
}

// ---------- Dispatcher ----------

// Tool yang mengubah data → selalu dibackup otomatis ke git
const MUTATING_TOOLS = new Set([
  'add_toko',
  'update_toko',
  'add_customer',
  'add_sparepart',
  'update_sparepart',
  'add_unit',
  'record_kunjungan',
  'send_gateway_message',
  'set_gateway_config',
])

const HANDLERS = {
  get_stats: hGetStats,
  list_toko: hListToko,
  get_toko: hGetToko,
  add_toko: hAddToko,
  update_toko: hUpdateToko,
  list_customer: hListCustomer,
  add_customer: hAddCustomer,
  list_sparepart: hListSparepart,
  add_sparepart: hAddSparepart,
  update_sparepart: hUpdateSparepart,
  list_unit: hListUnit,
  add_unit: hAddUnit,
  record_kunjungan: hRecordKunjungan,
  list_kunjungan: hListKunjungan,
  list_service: hListService,
  send_gateway_message: hSendGatewayMessage,
  set_gateway_config: hSetGatewayConfig,
  run_backup: hRunBackup,
  list_audit: hListAudit,
}

export async function handleToolCall({ name, arguments: args }) {
  const handler = HANDLERS[name]
  if (!handler) {
    return errOut(`Tool "${name}" tidak dikenal. Gunakan tools/list untuk melihat daftar tool yang tersedia.`)
  }
  try {
    const out = await handler(args ?? {})
    // Semua perubahan via MCP otomatis dibackup ke git (best-effort, tak blokir respons)
    if (!out?.isError && MUTATING_TOOLS.has(name)) {
      const { queueGitBackup } = await import('./git-backup.mjs')
      queueGitBackup(db, `mcp ${name}`)
    }
    return out
  } catch (e) {
    console.error(`[MCP] Tool ${name} gagal:`, e)
    return errOut(`${e.message}`)
  }
}

export async function shutdown() {
  await db.$disconnect()
}
