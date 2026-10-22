import { join, basename, normalize } from 'node:path'
import { db } from '@/lib/db'
import { dariRoot } from '@/lib/paths'

export type InboxKind = 'KUNJUNGAN' | 'SERVICE'
export const MAX_FILE_BYTES = 10 * 1024 * 1024
/** Folder lama — hanya dipakai sebagai fallback baca. */
export const LEGACY_INBOX_REL = 'upload/telegram-inbox'

const DEFAULTS: Record<InboxKind, string> = {
  KUNJUNGAN: 'upload/telegram-kunjungan',
  SERVICE: 'upload/telegram-service',
}
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.gif'])

export function isImageName(name: string): boolean {
  const dot = name.lastIndexOf('.')
  if (dot < 0) return false
  return IMAGE_EXTS.has(name.slice(dot).toLowerCase())
}

/** Baca folder dari Pengaturan (fallback default). Aman dari path traversal. */
export async function inboxDirRel(kind: InboxKind): Promise<string> {
  const kunci = kind === 'KUNJUNGAN' ? 'inbox_folder_kunjungan' : 'inbox_folder_service'
  const row = await db.pengaturan.findUnique({ where: { kunci } }).catch(() => null)
  let rel = (row?.nilai || DEFAULTS[kind]).replace(/\\/g, '/').trim()
  if (!rel || rel.includes('..') || rel.startsWith('/')) rel = DEFAULTS[kind]
  return normalize(rel).replace(/\\/g, '/')
}

export async function ensureInboxDir(kind: InboxKind): Promise<string> {
  const { mkdir } = await import('node:fs/promises')
  // path runtime (isi Pengaturan), bukan saat build
  const dir = dariRoot(await inboxDirRel(kind))
  await mkdir(/*turbopackIgnore: true*/ dir, { recursive: true })
  return dir
}

export async function saveInboxFile(buffer: Buffer, ext: string, kind: InboxKind, prefix = 'tg') {
  const { writeFile } = await import('node:fs/promises')
  const { randomUUID } = await import('node:crypto')
  const dir = await ensureInboxDir(kind)
  const safeExt = ext.startsWith('.') ? ext.toLowerCase() : '.jpg'
  const fileName = `${prefix}-${Date.now()}-${randomUUID().slice(0, 8)}${safeExt}`
  await writeFile(join(/*turbopackIgnore: true*/ dir, fileName), buffer)
  return { fileName, filePathRel: `${await inboxDirRel(kind)}/${fileName}` }
}

/** Daftar file inbox (terbaru dulu, maks 50). Gagal baca → array kosong. */
export async function listInboxFiles(kind: InboxKind, limit = 50): Promise<string[]> {
  try {
    const { readdir } = await import('node:fs/promises')
    const files = await readdir(/*turbopackIgnore: true*/ dariRoot(await inboxDirRel(kind)))
    return files.sort().reverse().slice(0, limit)
  } catch {
    return []
  }
}

/** Cari file di folder yang diminta → folder satunya → folder lama. */
export async function readInboxFile(kind: InboxKind, fileName: string): Promise<Buffer> {
  const { readFile } = await import('node:fs/promises')
  const safe = basename(fileName)
  const candidates = [
    dariRoot(`${await inboxDirRel(kind)}/${safe}`),
    dariRoot(`${await inboxDirRel(kind === 'KUNJUNGAN' ? 'SERVICE' : 'KUNJUNGAN')}/${safe}`),
    dariRoot(`${LEGACY_INBOX_REL}/${safe}`),
  ]
  let lastErr: unknown = null
  for (const p of candidates) {
    try {
      return await readFile(/*turbopackIgnore: true*/ p)
    } catch (e) {
      lastErr = e
    }
  }
  throw lastErr ?? new Error('File tidak ditemukan')
}

/** Pindahkan file antar folder (dipakai aksi "Pindah" di Inbox). */
export async function moveInboxFile(from: InboxKind, to: InboxKind, fileName: string) {
  const { rename } = await import('node:fs/promises')
  const safe = basename(fileName)
  const toDir = await ensureInboxDir(to)
  await rename(/*turbopackIgnore: true*/ dariRoot(`${await inboxDirRel(from)}/${safe}`), join(/*turbopackIgnore: true*/ toDir, safe))
  return `${await inboxDirRel(to)}/${safe}`
}
