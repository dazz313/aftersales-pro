import { createSign } from 'node:crypto'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'

/**
 * Backup Otomatis Google Spreadsheet (data bersama)
 * --------------------------------------------------
 * Menyalin seluruh data master & operasional ke Google Spreadsheet sehingga
 * bisa dibuka bersama (manager / produsen) tanpa akses ke aplikasi.
 *
 * Konfigurasi (menu Pengaturan → Backup Google Spreadsheet):
 *  - gs_spreadsheet_id  : ID spreadsheet tujuan (dari URL spreadsheet)
 *  - gs_service_email   : email service account Google
 *  - gs_private_key     : private key service account (format PEM)
 *  - gs_auto_aktif      : "true" | "false" → backup otomatis berkala
 *  - gs_interval_jam    : jarak antar backup otomatis (jam)
 *
 * Jika kredensial Google belum diisi → fallback: snapshot JSON lokal
 * disimpan di db/backups/ agar data tetap terjaga (status LOCAL).
 */

export interface SheetData {
  nama: string
  rows: (string | number)[][]
}

export interface BackupOutcome {
  status: 'SUCCESS' | 'LOCAL' | 'FAILED'
  sheetsWritten: number
  rowsTotal: number
  tabel: string
  message: string
}

// ---------- 1. Kumpulkan data ----------

export async function collectBackupData(): Promise<SheetData[]> {
  const [tokos, customers, spareparts, units, kunjungan, tikets, suratJalanList] = await Promise.all([
    db.masterToko.findMany({ orderBy: { kodeToko: 'asc' } }),
    db.masterCustomer.findMany({ include: { unitAssets: { select: { modelUnit: true } } }, orderBy: { id: 'asc' } }),
    db.masterSparepart.findMany({ orderBy: { kodePart: 'asc' } }),
    db.unitAsset.findMany({ include: { toko: { select: { kodeToko: true, namaToko: true } }, customer: { select: { nama: true } } }, orderBy: { serialNumber: 'asc' } }),
    db.kunjungan.findMany({ include: { toko: { select: { kodeToko: true, namaToko: true } }, teknisi: { select: { nama: true } } }, orderBy: { tglKunjungan: 'desc' }, take: 1000 }),
    db.serviceRequest.findMany({ include: { unitAsset: { include: { toko: { select: { kodeToko: true, namaToko: true } } } }, parts: { include: { sparepart: { select: { kodePart: true, namaPart: true } } } } }, orderBy: { createdAt: 'desc' }, take: 1000 }),
    db.suratJalanMasuk.findMany({ include: { items: true }, orderBy: { createdAt: 'desc' }, take: 500 }),
  ])

  const fmt = (d: Date | null | undefined) => (d ? new Date(d).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' }) : '')

  return [
    {
      nama: 'Toko',
      rows: [
        ['Kode Toko', 'Nama Toko', 'Alamat', 'Kontak', 'Siklus Visit (hari)', 'Visit Terakhir', 'Barcode Toko'],
        ...tokos.map((t) => [t.kodeToko, t.namaToko, t.alamat ?? '', t.kontak ?? '', t.frekuensiVisit, fmt(t.tglVisitTerakhir), t.barcodeToko]),
      ],
    },
    {
      nama: 'Customer',
      rows: [
        ['ID', 'Nama', 'No. WhatsApp', 'Alamat', 'Jumlah Unit', 'Model Unit'],
        ...customers.map((c) => [c.id, c.nama, c.noWa ?? '', c.alamat ?? '', c.unitAssets.length, c.unitAssets.map((u) => u.modelUnit).join(', ')]),
      ],
    },
    {
      nama: 'Sparepart',
      rows: [
        ['Kode Part', 'Nama Part', 'Brand Kompatibel', 'Supplier', 'Stok Jual', 'Stok Garansi', 'Stok Inventory', 'Reorder Limit', 'Harga Klaim (Rp)'],
        ...spareparts.map((s) => [s.kodePart, s.namaPart, s.brandKompatibel ?? '', s.supplier ?? '', s.stokJual ?? 0, s.stokGaransi ?? 0, s.stokInventory, s.reorderLimit, s.hargaKlaim]),
      ],
    },
    {
      nama: 'Unit Asset',
      rows: [
        ['Serial Number', 'Model Unit', 'Merk', 'Nama Unit', 'Toko', 'Pemilik', 'Status Garansi', 'Tgl Pembelian'],
        ...units.map((u) => [u.serialNumber, u.modelUnit, u.merk ?? '', u.nama ?? '', u.toko ? `${u.toko.kodeToko} — ${u.toko.namaToko}` : '', u.customer?.nama ?? '', u.statusGaransi, fmt(u.tglPembelian)]),
      ],
    },
    {
      nama: 'Kunjungan',
      rows: [
        ['Waktu', 'Toko', 'Teknisi', 'Metode Check-in', 'Catatan Stok Rusak'],
        ...kunjungan.map((k) => [fmt(k.tglKunjungan), `${k.toko.kodeToko} — ${k.toko.namaToko}`, k.teknisi.nama, k.metodeCheckin === 'SCAN_BARCODE' ? 'Scan Barcode Toko' : 'Manual', k.catatanStokRusak ?? '']),
      ],
    },
    {
      nama: 'Tiket Service',
      rows: [
        ['No. Tiket', 'Status', 'Unit (SN)', 'Model', 'Toko', 'Status Klaim', 'Biaya Jasa (Rp)', 'Dibuat', 'Selesai', 'Parts'],
        ...tikets.map((t) => [
          t.noTiket,
          t.status,
          t.unitAsset.serialNumber,
          t.unitAsset.modelUnit,
          t.unitAsset.toko ? `${t.unitAsset.toko.kodeToko} — ${t.unitAsset.toko.namaToko}` : '',
          t.statusKlaimProdusen,
          t.biayaJasa,
          fmt(t.createdAt),
          fmt(t.tglFinish),
          t.parts.map((p) => `${p.sparepart.kodePart} x${p.qty}`).join(', '),
        ]),
      ],
    },
    {
      nama: 'Surat Jalan Masuk',
      rows: [
        ['No. Surat Jalan', 'Tanggal Surat', 'Produsen', 'Baris Item', 'Kode Part', 'Nama Part', 'Qty', 'SN Unit', 'Hasil Match', 'Keterangan Match', 'Dibuat'],
        ...suratJalanList.flatMap((s) => {
          const kepala = `${s.noSuratJalan} — ${s.produsen ?? ''} (${s.cocokCount}/${s.totalItem} cocok)`
          return s.items.length
            ? s.items.map((i) => [
                kepala,
                fmt(s.tglSurat),
                s.produsen ?? '',
                s.totalItem,
                i.kodePart,
                i.namaPart ?? '',
                i.qty,
                i.serialNumber ?? '',
                i.statusMatch,
                i.alasan ?? '',
                fmt(s.createdAt),
              ])
            : [[kepala, fmt(s.tglSurat), s.produsen ?? '', s.totalItem, '', '', '', '', '', '', fmt(s.createdAt)]]
        }),
      ],
    },
  ]
}

// ---------- 2. Autentikasi service account (JWT RS256) ----------

function normalizePrivateKey(key: string): string {
  // Private key bisa disimpan dengan "\n" literal saat diketik di input teks
  return key.replace(/\\n/g, '\n').trim()
}

interface AccessTokenResult {
  ok: boolean
  token?: string
  detail?: string
}

async function getAccessToken(serviceEmail: string, privateKey: string): Promise<AccessTokenResult> {
  const now = Math.floor(Date.now() / 1000)
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url')
  const claim = Buffer.from(
    JSON.stringify({
      iss: serviceEmail,
      scope: 'https://www.googleapis.com/auth/spreadsheets',
      aud: 'https://oauth2.googleapis.com/token',
      exp: now + 3600,
      iat: now,
    })
  ).toString('base64url')

  let signed: string
  try {
    const signer = createSign('RSA-SHA256')
    signer.update(`${header}.${claim}`)
    signer.end()
    signed = signer.sign(normalizePrivateKey(privateKey), 'base64url')
  } catch (e) {
    return { ok: false, detail: `Private key tidak valid: ${(e as Error).message}` }
  }

  try {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: `${header}.${claim}.${signed}`,
      }),
      signal: AbortSignal.timeout(15_000),
    })
    const data = (await res.json().catch(() => ({}))) as { access_token?: string; error_description?: string }
    if (res.ok && data.access_token) return { ok: true, token: data.access_token }
    return { ok: false, detail: `Google OAuth menolak: ${data.error_description ?? res.status} (pastikan Google Sheets API aktif & service account diberi akses editor ke spreadsheet)` }
  } catch (e) {
    return { ok: false, detail: `Gagal menghubungi Google OAuth: ${(e as Error).message}` }
  }
}

// ---------- 3. Tulis ke Google Sheets ----------

async function pushSheets(spreadsheetId: string, token: string, sheets: SheetData[]): Promise<{ written: number; rows: number; detail: string }> {
  const api = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`

  // Pastikan semua tab ada — buat yang belum ada
  const metaRes = await fetch(`${api}?fields=sheets.properties.title`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
  })
  if (!metaRes.ok) throw new Error(`Gagal membaca spreadsheet (HTTP ${metaRes.status}) — pastikan ID benar & service account punya akses`)
  const meta = (await metaRes.json()) as { sheets?: { properties?: { title?: string } }[] }
  const existing = new Set((meta.sheets ?? []).map((s) => s.properties?.title).filter(Boolean) as string[])
  const missing = sheets.filter((s) => !existing.has(s.nama))
  if (missing.length) {
    const addRes = await fetch(`${api}:batchUpdate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests: missing.map((s) => ({ addSheet: { properties: { title: s.nama } } })) }),
      signal: AbortSignal.timeout(15_000),
    })
    if (!addRes.ok) throw new Error(`Gagal membuat tab baru di spreadsheet (HTTP ${addRes.status})`)
  }

  let written = 0
  let rows = 0
  for (const s of sheets) {
    // Bersihkan isi lama
    await fetch(`${api}/values/${encodeURIComponent(`${s.nama}!A1:Z10000`)}:clear`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000),
    })
    // Tulis data baru
    const putRes = await fetch(`${api}/values/${encodeURIComponent(`${s.nama}!A1`)}?valueInputOption=RAW`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: s.rows }),
      signal: AbortSignal.timeout(20_000),
    })
    if (!putRes.ok) throw new Error(`Gagal menulis tab "${s.nama}" (HTTP ${putRes.status})`)
    written++
    rows += s.rows.length
  }
  return { written, rows, detail: `${written} tab diperbarui (${sheets.map((s) => s.nama).join(', ')})` }
}

// ---------- 4. Snapshot lokal (fallback) ----------

async function writeLocalSnapshot(sheets: SheetData[]): Promise<string> {
  const { mkdir, writeFile } = await import('node:fs/promises')
  const { join } = await import('node:path')
  const dir = join(process.cwd(), 'db', 'backups')
  await mkdir(dir, { recursive: true })
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const file = join(dir, `backup-${ts}.json`)
  const payload: Record<string, unknown> = { generatedAt: new Date().toISOString(), tabel: {} }
  for (const s of sheets) {
    ;(payload.tabel as Record<string, unknown>)[s.nama] = s.rows
  }
  await writeFile(file, JSON.stringify(payload, null, 2), 'utf-8')
  return file
}

// ---------- 5. Orchestrator ----------

export async function runBackup(trigger: 'MANUAL' | 'AUTO', aktor?: string): Promise<BackupOutcome> {
  const rows = await db.pengaturan.findMany({ where: { kunci: { startsWith: 'gs_' } } })
  const map: Record<string, string> = {}
  for (const r of rows) map[r.kunci] = r.nilai

  const spreadsheetId = map['gs_spreadsheet_id'] ?? ''
  const serviceEmail = map['gs_service_email'] ?? ''
  const privateKey = map['gs_private_key'] ?? ''

  const sheets = await collectBackupData()
  const rowsTotal = sheets.reduce((a, s) => a + s.rows.length, 0)
  const tabelStr = sheets.map((s) => s.nama).join(', ')

  let outcome: BackupOutcome

  if (!spreadsheetId || !serviceEmail || !privateKey) {
    try {
      const file = await writeLocalSnapshot(sheets)
      outcome = {
        status: 'LOCAL',
        sheetsWritten: 0,
        rowsTotal,
        tabel: tabelStr,
        message: `Kredensial Google belum lengkap — snapshot lokal disimpan: ${file.split('/').pop()}. Isi Spreadsheet ID, service account email & private key di Pengaturan untuk sinkron ke Google.`,
      }
    } catch (e) {
      outcome = { status: 'FAILED', sheetsWritten: 0, rowsTotal, tabel: tabelStr, message: `Snapshot lokal gagal: ${(e as Error).message}` }
    }
  } else {
    try {
      const auth = await getAccessToken(serviceEmail, privateKey)
      if (!auth.ok || !auth.token) {
        outcome = { status: 'FAILED', sheetsWritten: 0, rowsTotal, tabel: tabelStr, message: auth.detail ?? 'Autentikasi Google gagal' }
      } else {
        const push = await pushSheets(spreadsheetId, auth.token, sheets)
        outcome = { status: 'SUCCESS', sheetsWritten: push.written, rowsTotal: push.rows, tabel: tabelStr, message: `Backup tersinkron ke Google Spreadsheet: ${push.detail}.` }
      }
    } catch (e) {
      outcome = { status: 'FAILED', sheetsWritten: 0, rowsTotal, tabel: tabelStr, message: `Backup ke Google gagal: ${(e as Error).message}` }
    }
  }

  await db.backupLog.create({
    data: {
      status: outcome.status,
      trigger,
      sheetsWritten: outcome.sheetsWritten,
      rowsTotal: outcome.rowsTotal,
      tabel: outcome.tabel,
      message: outcome.message,
    },
  })
  await logAudit({
    aksi: 'BACKUP_DATA',
    entitas: 'backup_google_sheets',
    entitasId: outcome.status,
    deskripsi: `Backup data bersama (${trigger}): status ${outcome.status} — ${outcome.message}`,
    aktor: trigger === 'AUTO' ? 'SYSTEM-CRON' : aktor ?? 'ADMIN',
  })

  return outcome
}

export async function getBackupStatus() {
  const [rows, logs] = await Promise.all([
    db.pengaturan.findMany({ where: { kunci: { startsWith: 'gs_' } } }),
    db.backupLog.findMany({ orderBy: { createdAt: 'desc' }, take: 15 }),
  ])
  const map: Record<string, string> = {}
  for (const r of rows) map[r.kunci] = r.nilai

  const autoAktif = map['gs_auto_aktif'] !== 'false'
  const intervalJam = Number(map['gs_interval_jam']) || 24
  const terkonfigurasi = !!(map['gs_spreadsheet_id'] && map['gs_service_email'] && map['gs_private_key'])
  const last = logs[0] ?? null

  // dueNow: backup otomatis perlu dijalankan?
  let dueNow = false
  if (autoAktif) {
    if (!last) dueNow = true
    else {
      const elapsedJam = (Date.now() - new Date(last.createdAt).getTime()) / 3_600_000
      const elapsedDetik = (Date.now() - new Date(last.createdAt).getTime()) / 1000
      dueNow = elapsedJam >= intervalJam && elapsedDetik > 60 // guard anti dobel-trigger
    }
  }

  return {
    logs,
    last,
    config: {
      autoAktif,
      intervalJam,
      spreadsheetId: map['gs_spreadsheet_id'] ?? '',
      serviceEmail: map['gs_service_email'] ?? '',
      terkonfigurasi,
    },
    dueNow,
    lastBackupAt: last?.createdAt ?? null,
    jadwal: {
      aktif: map['gs_jadwal_aktif'] === 'true',
      jam: /^([01]\d|2[0-3]):[0-5]\d$/.test(map['gs_jadwal_jam'] ?? '') ? map['gs_jadwal_jam'] : '02:00',
      terakhir: map['gs_jadwal_terakhir'] ?? '',
    },
  }
}
