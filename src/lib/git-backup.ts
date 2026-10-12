import { db } from '@/lib/db'

/**
 * Backup otomatis Git setiap perubahan sparepart.
 * --------------------------------------------------
 * db/custom.db sengaja di-gitignore (file biner SQLite yang menggembung),
 * jadi setiap mutasi sparepart menulis snapshot JSON ber-version ke
 * db/snapshots/sparepart-latest.json (di-track git) lalu mencoba
 * `git add + git commit` secara fire-and-forget.
 *
 * Tidak pernah melempar error — kegagalan backup tidak boleh menggagalkan
 * request API. Commit berjalan di background (detached) agar respons API
 * tetap cepat.
 */

export interface SparepartSnapshotRow {
  kodePart: string
  namaPart: string
  brandKompatibel: string
  supplier: string
  stokJual: number
  stokGaransi: number
  stokInventory: number
  reorderLimit: number
  hargaKlaim: number
  updatedAt: string
}

function gitCommitBackground(files: string[], message: string) {
  // Fire-and-forget: jangan blokir request. Diam bila bukan repo git.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { execFile } = require('node:child_process') as typeof import('node:child_process')
    const root = process.cwd()
    const child = execFile(
      'git',
      ['add', '--', ...files],
      { cwd: root, timeout: 10_000, windowsHide: true },
      () => {
        execFile(
          'git',
          ['commit', '-q', '-m', message, '--', ...files],
          { cwd: root, timeout: 10_000, windowsHide: true },
          () => {
            /* diam — backup best-effort, audit log sudah mencatat perubahan */
          }
        )
      }
    )
    child.unref?.()
  } catch {
    /* abaikan — lingkungan tanpa git (mis. desktop user) */
  }
}

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
      reorderLimit: s.reorderLimit ?? 5,
      hargaKlaim: s.hargaKlaim ?? 0,
      updatedAt: new Date().toISOString(),
    }))
    const { mkdir, writeFile } = await import('node:fs/promises')
    const { join, relative } = await import('node:path')
    const dir = join(process.cwd(), 'db', 'snapshots')
    await mkdir(dir, { recursive: true })
    const file = join(dir, 'sparepart-latest.json')
    const payload = {
      generatedAt: new Date().toISOString(),
      aksi,
      kodePart,
      aktor: aktor ?? 'SYSTEM',
      total: snapshot.length,
      spareparts: snapshot,
    }
    await writeFile(file, JSON.stringify(payload, null, 2), 'utf-8')
    const rel = relative(process.cwd(), file)
    const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ')
    gitCommitBackground([rel], `auto-backup sparepart ${stamp} ${aksi} ${kodePart}`)
  } catch {
    /* jangan gagalkan request utama */
  }
}
