import { NextResponse } from 'next/server'
import { readInboxFile, type InboxKind } from '@/lib/telegram-files'

const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.webp': 'image/webp', '.gif': 'image/gif', '.bmp': 'image/bmp',
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ folder: string; name: string }> },
) {
  try {
    const { folder, name } = await ctx.params
    const kind: InboxKind = folder.toLowerCase() === 'kunjungan' ? 'KUNJUNGAN' : 'SERVICE'
    const buf = await readInboxFile(kind, name)
    const dot = name.lastIndexOf('.')
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        'Content-Type': MIME[name.slice(dot).toLowerCase()] ?? 'application/octet-stream',
        'Cache-Control': 'private, max-age=3600',
      },
    })
  } catch {
    return NextResponse.json({ error: 'File tidak ditemukan' }, { status: 404 })
  }
}
