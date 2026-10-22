import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { db } from '@/lib/db'

/**
 * Retensi Log 7 Hari
 * -------------------
 * Job harian di dalam proses server (dijalankan dari src/instrumentation.ts,
 * satu scheduler dengan backup harian) — tetap aktif walau tidak ada browser
 * yang terbuka, karena tugasnya ada di sisi server.
 *
 * Yang dikelola:
 *  1. File log PM2 milik aplikasi ini:
 *     • file AKTIF (sedang ditulis PM2) → TIDAK PERNAH dihapus (Windows
 *       mengunci handle; menghapus = PM2 menulis ke "file hantu" dan log
 *       hilang tanpa jejak). Kalau ukurannya melewati batas → dipotong
 *       (truncate) dan disisakan ekornya.
 *     • file rotasi/arsip lama (> 7 hari) → dihapus.
 *  2. File *.log di folder logs/ dan root repo (> 7 hari) → dihapus.
 *  3. Tabel log di database: WaMessage (log gateway), Notifikasi, dan
 *     AuditLog (retensi lebih panjang — default 365 hari).
 *
 * Konfigurasi (tabel Pengaturan, opsional):
 *   log_retensi_hari      = "7"    → umur file log & log gateway
 *   log_retensi_audit_hari= "365"  → umur AuditLog
 *   log_retensi_mb        = "25"   → batas ukuran file log aktif (MB)
 *
 * Yang TIDAK tersentuh: data bisnis, snapshot git (db/snapshots), backup DB
 * (db/backups), source code, dan file .db.
 */

const HARI_MS = 24 * 3600 * 1000
const EKOR_BYTE = 200 * 1024 // 200 KB terakhir disimpan saat truncate

const g = globalThis as unknown as { __asproLogRetention?: boolean }

function todayStr(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Folder log PM2 aplikasi ini (PM2_HOME env → fallback ~/.pm2). */
function folderLogPm2(): string | null {
  const base = process.env.PM2_HOME || path.join(os.homedir(), '.pm2')
  const dir = path.join(base, 'logs')
  return fs.existsSync(dir) ? dir : null
}

/**
 * Root repo. Server standalone Next.js melakukan `process.chdir(__dirname)`
 * (cwd = .next/standalone), dan folder standalone berisi SALINAN repo
 * (package.json, prisma/, src/ …) → cwd tidak bisa dipakai langsung.
 * Cari ke atas sampai ketemu root project yang BUKAN di dalam folder .next.
 */
function rootRepo(): string {
  let dir = process.cwd()
  for (let i = 0; i < 8; i++) {
    const segmen = dir.split(/[\\/]/)
    const diDalamNext = segmen.includes('.next')
    if (
      !diDalamNext &&
      fs.existsSync(path.join(dir, 'package.json')) &&
      fs.existsSync(path.join(dir, 'prisma', 'schema.prisma')) &&
      fs.existsSync(path.join(dir, 'src'))
    ) {
      return dir
    }
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return process.cwd()
}

/**
 * Potong file log aktif: sisakan ekor (200 KB terakhir) supaya error terbaru
 * tetap terbaca. Truncate in-place aman di Windows (sudah diuji) selama PM2
 * masih memegang handle-nya.
 */
function potongLogAktif(file: string, maksByte: number): string | null {
  let ukuran: number
  try {
    ukuran = fs.statSync(file).size
  } catch {
    return null
  }
  if (ukuran <= maksByte) return null
  try {
    const fd = fs.openSync(file, 'r+')
    try {
      const ekor = Buffer.alloc(Math.min(EKOR_BYTE, ukuran))
      fs.readSync(fd, ekor, 0, ekor.length, ukuran - ekor.length)
      fs.ftruncateSync(fd, 0)
      fs.writeSync(fd, ekor, 0, ekor.length, 0)
    } finally {
      fs.closeSync(fd)
    }
    return `${path.basename(file)} (${(ukuran / 1048576).toFixed(1)} MB → ${(EKOR_BYTE / 1024).toFixed(0)} KB)`
  } catch (e) {
    console.warn(`[log-retensi] Gagal memotong ${path.basename(file)}:`, (e as Error).message)
    return null
  }
}

/** Hapus file *.log yang umurnya lebih dari hari yang ditentukan. */
function hapusLogKedaluwarsa(dir: string, hari: number, kecuali: Set<string> = new Set()): string[] {
  const hasil: string[] = []
  if (!fs.existsSync(dir)) return hasil
  const batas = Date.now() - hari * HARI_MS
  let files: string[]
  try {
    files = fs.readdirSync(dir)
  } catch {
    return hasil
  }
  for (const f of files) {
    if (!/\.log$/i.test(f)) continue
    if (kecuali.has(f)) continue
    const p = path.join(dir, f)
    try {
      const st = fs.statSync(p)
      if (!st.isFile() || st.mtimeMs >= batas) continue
      fs.rmSync(p, { force: true })
      hasil.push(path.join(path.basename(dir), f))
    } catch {
      // abaikan — file mungkin sedang dipakai proses lain
    }
  }
  return hasil
}

/** Nama file log PM2 yang SEDANG ditulis (harus dipotong, bukan dihapus). */
function fileLogAktif(dir: string): string[] {
  try {
    return fs.readdirSync(dir).filter((f) => /^aspro-prod-(out|error)-\d+\.log$/i.test(f))
  } catch {
    return []
  }
}

export async function bersihkanLog(): Promise<void> {
  try {
    const rows = await db.pengaturan.findMany({
      where: { kunci: { in: ['log_retensi_hari', 'log_retensi_audit_hari', 'log_retensi_mb'] } },
    })
    const map: Record<string, string> = {}
    for (const r of rows) map[r.kunci] = r.nilai
    const hari = Math.max(1, Number(map['log_retensi_hari'] || '7') || 7)
    const hariAudit = Math.max(hari, Number(map['log_retensi_audit_hari'] || '365') || 365)
    const maksMB = Math.max(1, Number(map['log_retensi_mb'] || '25') || 25)
    const maksByte = maksMB * 1024 * 1024

    const dipotong: string[] = []
    const dihapus: string[] = []

    // 1) Log PM2
    const dirPm2 = folderLogPm2()
    if (dirPm2) {
      const aktif = fileLogAktif(dirPm2)
      for (const f of aktif) {
        const r = potongLogAktif(path.join(dirPm2, f), maksByte)
        if (r) dipotong.push(r)
      }
      // file log lain milik app ini yang sudah lama (rotasi manual/otomatis)
      dihapus.push(...hapusLogKedaluwarsa(dirPm2, hari, new Set(aktif)))
    }

    // 2) Log di repo (folder logs/ + root)
    const root = rootRepo()
    dihapus.push(...hapusLogKedaluwarsa(path.join(root, 'logs'), hari))
    dihapus.push(...hapusLogKedaluwarsa(root, hari))

    // 3) Tabel log di database
    const batasWa = new Date(Date.now() - hari * HARI_MS)
    const hapusWa = await db.waMessage.deleteMany({ where: { createdAt: { lt: batasWa } } }).catch(() => null)
    const batasNotif = new Date(Date.now() - hari * HARI_MS)
    const notifLama = await db.notifikasi.findMany({ where: { createdAt: { lt: batasNotif } }, select: { id: true } }).catch(() => [])
    if (notifLama.length) {
      const ids = notifLama.map((n) => n.id)
      await db.notifikasiBaca.deleteMany({ where: { notifikasiId: { in: ids } } }).catch(() => null)
      await db.notifikasi.deleteMany({ where: { id: { in: ids } } }).catch(() => null)
    }
    const batasAudit = new Date(Date.now() - hariAudit * HARI_MS)
    const hapusAudit = await db.auditLog.deleteMany({ where: { createdAt: { lt: batasAudit } } }).catch(() => null)

    const ringkas = [
      dipotong.length ? `dipotong: ${dipotong.join(', ')}` : '',
      dihapus.length ? `dihapus: ${dihapus.join(', ')}` : '',
      hapusWa ? `WaMessage: ${hapusWa.count}` : '',
      notifLama.length ? `Notifikasi: ${notifLama.length}` : '',
      hapusAudit ? `AuditLog: ${hapusAudit.count}` : '',
    ].filter(Boolean)
    if (ringkas.length) console.log(`[log-retensi] ${ringkas.join(' · ')}`)
  } catch (e) {
    console.error('[log-retensi] Gagal:', (e as Error).message)
  }
}

async function tick() {
  try {
    const row = await db.pengaturan.findUnique({ where: { kunci: 'log_retensi_terakhir' } })
    if ((row?.nilai ?? '').slice(0, 10) === todayStr()) return
    await bersihkanLog()
    await db.pengaturan.upsert({
      where: { kunci: 'log_retensi_terakhir' },
      update: { nilai: `${todayStr()} ${new Date().toTimeString().slice(0, 5)}` },
      create: { kunci: 'log_retensi_terakhir', nilai: `${todayStr()} ${new Date().toTimeString().slice(0, 5)}` },
    })
  } catch (e) {
    console.error('[log-retensi] Gagal:', (e as Error).message)
  }
}

export function startLogRetention() {
  if (g.__asproLogRetention) return
  g.__asproLogRetention = true
  // Tick pertama setelah 90 detik (boot tidak terbebani), lalu tiap 30 menit —
  // cek harian dilakukan lewat penanda tanggal di Pengaturan.
  setTimeout(() => {
    void tick()
    setInterval(() => void tick(), 30 * 60_000).unref?.()
  }, 90_000).unref?.()
  console.log('[log-retensi] Aktif — retensi 7 hari, cek tiap 30 menit')
}
