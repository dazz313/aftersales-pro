import { execFile } from 'node:child_process'
import { db } from '@/lib/db'
import { SNAPSHOT_DIR, APP_ROOT } from '@/lib/paths'

/**
 * Backup otomatis Git untuk SEMUA perubahan data.
 * --------------------------------------------------
 * db/custom.db sengaja di-gitignore (file biner SQLite yang menggembung),
 * jadi setiap API yang mengubah data memanggil `autoGitBackup()` yang:
 *  1. menulis snapshot JSON lengkap ke db/snapshots/latest.json (di-track git),
 *  2. mengantrekan `git add + git commit` best-effort (tidak pernah
 *     menggagalkan request; commit di-serialize agar tidak rebutan lock).
 *
 * Rahasia tidak ikut snapshot: passwordHash pengguna & nilai pengaturan
 * sensitif (private key / token / secret) disensor menjadi "***".
 */

export interface SparepartSnapshotRow {
  kodePart: string
  namaPart: string
  brandKompatibel: string
  supplier: string
  stokJual: number
  stokGaransi: number
  stokInventory: number
  totalTerpakai: number
  reorderLimit: number
  hargaKlaim: number
  updatedAt: string
}

const SNAP_DIR = ['db', 'snapshots']
const LATEST_FILE = 'latest.json'
const SPAREPART_FILE = 'sparepart-latest.json'
// Maksimal 1 commit otomatis per interval agar riwayat tidak banjir saat banyak request
const MIN_COMMIT_INTERVAL_MS = 20_000

let commitQueue: Promise<void> = Promise.resolve()
let lastCommitAt = 0

function git(args: string[]): Promise<{ ok: boolean; stdout: string }> {
  return new Promise((resolve) => {
    execFile('git', args, { cwd: APP_ROOT, timeout: 15_000, windowsHide: true }, (err, stdout) => {
      resolve({ ok: !err, stdout: String(stdout ?? '') })
    })
  })
}

function queueAutoCommit(message: string) {
  const now = Date.now()
  // Snapshot file selalu ditulis fresh; commit dihemat — sweeper per-jam
  // (scripts/git-snapshot.ps1) menampung sisanya bila interval belum lewat.
  if (now - lastCommitAt < MIN_COMMIT_INTERVAL_MS) return
  lastCommitAt = now
  commitQueue = commitQueue
    .then(async () => {
      const add = await git(['add', '--', `${SNAP_DIR.join('/')}/${LATEST_FILE}`, `${SNAP_DIR.join('/')}/${SPAREPART_FILE}`])
      if (!add.ok) return
      // diff --cached --quiet: exit 0 = tidak ada perubahan staged → skip commit
      const diff = await git(['diff', '--cached', '--quiet'])
      if (diff.ok) return
      await git(['commit', '-q', '-m', message])
    })
    .catch(() => {
      /* diam — best-effort */
    })
}

const SENSITIVE_KEY = /private|token|secret|password|passwd|pwd|key/i

/** Tulis snapshot lengkap seluruh DB. Mengembalikan path absolut file atau null. */
export async function writeDbSnapshot(): Promise<string | null> {
  try {
    const [tokos, customers, spareparts, units, kunjungan, tikets, orders, emails, sjList, pengguna, pengaturan, audit, backupLog] = await Promise.all([
      db.masterToko.findMany({ orderBy: { kodeToko: 'asc' } }),
      db.masterCustomer.findMany({ orderBy: { nama: 'asc' } }),
      db.masterSparepart.findMany({ orderBy: { kodePart: 'asc' } }),
      db.unitAsset.findMany({ orderBy: { serialNumber: 'asc' } }),
      db.kunjungan.findMany({ orderBy: { tglKunjungan: 'desc' }, take: 2000 }),
      db.serviceRequest.findMany({
        include: { parts: true },
        orderBy: { createdAt: 'desc' },
        take: 2000,
      }),
      db.permintaanOrder.findMany({ orderBy: { createdAt: 'desc' }, take: 2000 }),
      db.orderEmailPart.findMany({ orderBy: { id: 'desc' }, take: 2000 }),
      db.suratJalanMasuk.findMany({ include: { items: true }, orderBy: { createdAt: 'desc' }, take: 500 }),
      db.pengguna.findMany({ orderBy: { id: 'asc' } }),
      db.pengaturan.findMany({ orderBy: { kunci: 'asc' } }),
      db.auditLog.findMany({ orderBy: { id: 'desc' }, take: 1000 }),
      db.backupLog.findMany({ orderBy: { id: 'desc' }, take: 100 }),
    ])
    const { mkdir, writeFile } = await import('node:fs/promises')
    const { join } = await import('node:path')
    const dir = SNAPSHOT_DIR
    await mkdir(/*turbopackIgnore: true*/ dir, { recursive: true })
    const payload = {
      generatedAt: new Date().toISOString(),
      masterToko: tokos,
      masterCustomer: customers,
      masterSparepart: spareparts,
      unitAsset: units,
      kunjungan,
      serviceRequest: tikets,
      permintaanOrder: orders,
      orderEmailPart: emails,
      suratJalanMasuk: sjList,
      pengguna: pengguna.map((u) => ({ ...u, passwordHash: u.passwordHash ? '***' : null })),
      pengaturan: pengaturan.map((p) => ({
        ...p,
        nilai: SENSITIVE_KEY.test(p.kunci) ? '***' : p.nilai,
      })),
      auditLog: audit,
      backupLog,
    }
    const file = join(dir, LATEST_FILE)
    await writeFile(/*turbopackIgnore: true*/ file, JSON.stringify(payload, null, 2), 'utf-8')
    return file
  } catch {
    return null
  }
}

/**
 * Panggil di setiap API yang mengubah data, SETELAH mutasi berhasil:
 *   await autoGitBackup('CREATE', 'master_toko', kodeToko, aktor)
 */
export async function autoGitBackup(aksi: string, entitas: string, ringkasan?: string, aktor?: string) {
  const file = await writeDbSnapshot()
  if (!file) return
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ')
  const msg = `auto-backup ${stamp} ${aksi} ${entitas}${ringkasan ? ` ${ringkasan}` : ''}${aktor ? ` oleh ${aktor}` : ''}`.slice(0, 200)
  queueAutoCommit(msg)
}

/** Kompatibilitas: snapshot khusus sparepart, lalu ikut alur backup umum. */
export async function backupSparepartToGit(aksi: string, kodePart: string, aktor?: string) {
  try {
    const rows = await db.masterSparepart.findMany({ orderBy: { kodePart: 'asc' } })
    const snapshot: SparepartSnapshotRow[] = rows.map((s) => ({
      kodePart: s.kodePart,
      namaPart: s.namaPart,
      brandKompatibel: s.brandKompatibel ?? '',
      supplier: s.supplier ?? '',
      stokJual: s.stokJual ?? 0,
      stokGaransi: s.stokGaransi ?? 0,
      stokInventory: s.stokInventory ?? 0,
      totalTerpakai: s.totalTerpakai ?? 0,
      reorderLimit: s.reorderLimit ?? 5,
      hargaKlaim: s.hargaKlaim ?? 0,
      updatedAt: new Date().toISOString(),
    }))
    const { mkdir, writeFile } = await import('node:fs/promises')
    const { join } = await import('node:path')
    const dir = SNAPSHOT_DIR
    await mkdir(/*turbopackIgnore: true*/ dir, { recursive: true })
    const payload = {
      generatedAt: new Date().toISOString(),
      aksi,
      kodePart,
      aktor: aktor ?? 'SYSTEM',
      total: snapshot.length,
      spareparts: snapshot,
    }
    await writeFile(/*turbopackIgnore: true*/ join(dir, SPAREPART_FILE), JSON.stringify(payload, null, 2), 'utf-8')
  } catch {
    /* jangan gagalkan request utama */
  }
  await autoGitBackup(aksi, 'master_sparepart', kodePart, aktor)
}
