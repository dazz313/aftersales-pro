/**
 * Backup otomatis Git untuk perubahan via MCP AI.
 * ----------------------------------------------
 * Dipanggil fire-and-forget oleh dispatcher tools.mjs setiap tool yang
 * mengubah data berhasil dijalankan: tulis snapshot JSON lengkap ke
 * db/snapshots/latest.json lalu `git add + git commit` best-effort.
 * Rahasia disensor (passwordHash, private key / token / secret).
 */
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SNAP_REL = path.join('db', 'snapshots', 'latest.json')
const MIN_COMMIT_INTERVAL_MS = 20_000

let chain = Promise.resolve()
let lastAt = 0

const SENSITIVE_KEY = /private|token|secret|password|passwd|pwd|key/i

function git(args) {
  return new Promise((resolve) => {
    execFile('git', args, { cwd: ROOT, timeout: 15_000, windowsHide: true }, (err, stdout) => {
      resolve({ ok: !err, stdout: String(stdout ?? '') })
    })
  })
}

async function dumpDb(db) {
  const [tokos, customers, spareparts, units, kunjungan, tikets, pengguna, pengaturan, audit, backupLog] = await Promise.all([
    db.masterToko.findMany({ orderBy: { kodeToko: 'asc' } }),
    db.masterCustomer.findMany({ orderBy: { nama: 'asc' } }),
    db.masterSparepart.findMany({ orderBy: { kodePart: 'asc' } }),
    db.unitAsset.findMany({ orderBy: { serialNumber: 'asc' } }),
    db.kunjungan.findMany({ orderBy: { tglKunjungan: 'desc' }, take: 2000 }),
    db.serviceRequest.findMany({ include: { parts: true }, orderBy: { createdAt: 'desc' }, take: 2000 }),
    db.pengguna.findMany({ orderBy: { id: 'asc' } }),
    db.pengaturan.findMany({ orderBy: { kunci: 'asc' } }),
    db.auditLog.findMany({ orderBy: { id: 'desc' }, take: 1000 }),
    db.backupLog.findMany({ orderBy: { id: 'desc' }, take: 100 }),
  ])
  return {
    generatedAt: new Date().toISOString(),
    masterToko: tokos,
    masterCustomer: customers,
    masterSparepart: spareparts,
    unitAsset: units,
    kunjungan,
    serviceRequest: tikets,
    pengguna: pengguna.map((u) => ({ ...u, passwordHash: u.passwordHash ? '***' : null })),
    pengaturan: pengaturan.map((p) => ({ ...p, nilai: SENSITIVE_KEY.test(p.kunci) ? '***' : p.nilai })),
    auditLog: audit,
    backupLog,
  }
}

export function queueGitBackup(db, label) {
  const now = Date.now()
  if (now - lastAt < MIN_COMMIT_INTERVAL_MS) return
  lastAt = now
  chain = chain
    .then(async () => {
      const snap = await dumpDb(db)
      fs.mkdirSync(path.join(ROOT, 'db', 'snapshots'), { recursive: true })
      fs.writeFileSync(path.join(ROOT, SNAP_REL), JSON.stringify(snap, null, 2), 'utf-8')
      const add = await git(['add', '--', SNAP_REL])
      if (!add.ok) return
      const diff = await git(['diff', '--cached', '--quiet'])
      if (diff.ok) return // tidak ada perubahan staged
      const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ')
      await git(['commit', '-q', '-m', `auto-backup ${stamp} ${label}`.slice(0, 200)])
    })
    .catch(() => {
      /* diam — best-effort */
    })
}
