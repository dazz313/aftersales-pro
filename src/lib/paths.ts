import fs from 'node:fs'
import { dirname, join } from 'node:path'

/**
 * Path aplikasi — SATU sumber kebenaran lokasi folder data runtime.
 *
 * Kenapa perlu:
 * Build standalone Next.js menjalankan `process.chdir(__dirname)`, jadi
 * process.cwd() = <root>/.next/standalone, BUKAN root project. Semua path
 * berbasis process.cwd() (snapshot git, backup DB, folder upload Telegram,
 * logo, cache OCR) berarti data ditulis ke dalam folder BUILD — hilang dari
 * root repo, tidak ikut ter-backup, dan menyesatkan saat dibaca.
 *
 * appRoot() mencari ke atas sampai ketemu root project yang benar-benar punya:
 *   package.json + prisma/schema.prisma + src/  — dan BUKAN berada di dalam
 *   folder ".next" (build standalone berisi salinan repo, jadi sering ikut
 *   cocok kalau syaratnya kurang ketat).
 *
 * Kalau tidak ketemu (deploy minimal) → jatuh ke process.cwd() (perilaku lama).
 */

function cariRoot(): string {
  let dir = process.cwd()
  for (let i = 0; i < 8; i++) {
    const diDalamNext = dir.split(/[\\/]/).includes('.next')
    if (
      !diDalamNext &&
      fs.existsSync(join(dir, 'package.json')) &&
      fs.existsSync(join(dir, 'prisma', 'schema.prisma')) &&
      fs.existsSync(join(dir, 'src'))
    ) {
      return dir
    }
    const parent = dirname(dir)
    if (!parent || parent === dir) break
    dir = parent
  }
  return process.cwd()
}

/** Root project (absolute). */
export const APP_ROOT = cariRoot()

/** Folder data runtime — semuanya di root project, bukan di folder build. */
export const DB_DIR = join(APP_ROOT, 'db')
export const SNAPSHOT_DIR = join(DB_DIR, 'snapshots')
export const BACKUP_DIR = join(DB_DIR, 'backups')
export const UPLOAD_DIR = join(APP_ROOT, 'upload')
export const LOGO_DIR = join(UPLOAD_DIR, 'logo')
export const TESSDATA_DIR = join(APP_ROOT, '.cache', 'tesseract')

/** Path absolut dari path relatif (mis. 'upload/telegram-service'). */
export function dariRoot(rel: string): string {
  return join(/*turbopackIgnore: true*/ APP_ROOT, rel)
}
