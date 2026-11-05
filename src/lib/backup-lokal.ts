import { db } from '@/lib/db'
import fs from 'node:fs'
import path from 'node:path'
import { BACKUP_DIR } from '@/lib/paths'

const KEEP = 42

/**
 * Backup database SQLite (live-safe) ke db/backups/custom-<stamp>.db.
 * Memakai VACUUM INTO → snapshot konsisten walau aplikasi sedang menulis.
 * Rotasi: sisakan KEEP file terbaru.
 */
export async function backupLokal(): Promise<{ ok: boolean; file: string; size: number; message: string }> {
  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true })
    const d = new Date()
    const p2 = (n: number) => String(n).padStart(2, '0')
    const stamp = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`
    const dest = path.join(BACKUP_DIR, `custom-${stamp}.db`)
    if (fs.existsSync(dest)) fs.unlinkSync(dest)
    await db.$executeRawUnsafe(`VACUUM INTO '${dest.replace(/\\/g, '/')}'`)
    const size = fs.statSync(dest).size
    const files = fs
      .readdirSync(BACKUP_DIR)
      .filter((f) => /^custom-\d{4}-\d{2}-\d{2}-\d{4,6}\.db$/.test(f))
      .sort()
    for (const f of files.slice(0, Math.max(files.length - KEEP, 0))) {
      try { fs.unlinkSync(path.join(BACKUP_DIR, f)) } catch { /* abaikan */ }
    }
    return { ok: true, file: dest, size, message: `Backup lokal OK (${(size / 1024).toFixed(0)} KB) → ${path.basename(dest)}` }
  } catch (e) {
    return { ok: false, file: '', size: 0, message: `Backup lokal GAGAL: ${(e as Error).message}` }
  }
}
