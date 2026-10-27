'use client'

import type { ChatPesanItem } from '@/lib/types'

/**
 * Util MiniChat — logika thread & status baca dipakai bersama oleh
 * widget melayang (components/minichat.tsx) dan view Komunikasi.
 *
 * Thread:
 *  - 'SEMUA'          → broadcast (penerima null), semua akun
 *  - 'DM:<userId>'    → DM saya ↔ user <userId>
 *
 * Status baca disimpan lokal (localStorage) PER USER LOGIN:
 *  readMap[thread] = ISO terakhir thread dibuka. Unread = pesan dari
 *  orang lain yang lebih baru dari stempel itu (mesin lain tetap ikut
 *  menandai sendiri — mirip pola NotifikasiBaca tapi ringan, tanpa tabel).
 */

const KUNCI_VERSI = 'aspro_chat_baca_v1'

/** Cache modul — dibaca/ditulis lintas komponen (widget & view) tanpa state React. */
const cache: Record<string, Record<string, string>> = {}

function muatDariStorage(meId: number): Record<string, string> {
  try {
    const raw = window.localStorage.getItem(`${KUNCI_VERSI}_me${meId}`)
    return raw ? (JSON.parse(raw) as Record<string, string>) : {}
  } catch {
    return {}
  }
}

export function ambilReadMap(meId: number): Record<string, string> {
  if (typeof window === 'undefined') return {}
  if (!cache[meId]) cache[meId] = muatDariStorage(meId)
  return cache[meId]
}

export function simpanReadMap(meId: number, map: Record<string, string>) {
  if (typeof window === 'undefined') return
  cache[meId] = map
  try {
    window.localStorage.setItem(`${KUNCI_VERSI}_me${meId}`, JSON.stringify(map))
  } catch {
    // localStorage tak tersedia — badge akan selalu penuh, tak fatal
  }
}

/** Tandai satu thread terbaca (stempel = waktu sekarang). */
export function tandaiThreadBaca(meId: number, thread: string) {
  if (typeof window === 'undefined') return
  const map = ambilReadMap(meId)
  map[thread] = new Date().toISOString()
  simpanReadMap(meId, map)
}

/** Kunci thread tempat sebuah pesan berada dilihat dari sudut saya. */
export function threadDariPesan(p: ChatPesanItem, meId: number): string {
  if (p.penerimaId === null) return 'SEMUA'
  return p.pengirimId === meId ? `DM:${p.penerimaId}` : `DM:${p.pengirimId}`
}

export function threadLabel(thread: string): string {
  return thread === 'SEMUA' ? 'Semua Akun' : 'DM'
}

/** Pesan milik thread tertentu (terlama → terbaru). */
export function pesanThread(pesan: ChatPesanItem[], thread: string, meId: number): ChatPesanItem[] {
  return pesan
    .filter((p) => threadDariPesan(p, meId) === thread)
    .sort((a, b) => a.id - b.id)
}

/** Jumlah belum dibaca per thread (hanya pesan dari akun lain). */
export function unreadPerThread(pesan: ChatPesanItem[], meId: number, readMap: Record<string, string>): Record<string, number> {
  const hitung: Record<string, number> = {}
  for (const p of pesan) {
    if (p.pengirimId === meId) continue
    const th = threadDariPesan(p, meId)
    const stamp = readMap[th]
    if (!stamp) {
      hitung[th] = (hitung[th] ?? 0) + 1
      continue
    }
    if (new Date(p.createdAt).getTime() > new Date(stamp).getTime()) {
      hitung[th] = (hitung[th] ?? 0) + 1
    }
  }
  return hitung
}

/** Total belum dibaca (badge FAB). */
export function totalUnread(pesan: ChatPesanItem[], meId: number, readMap: Record<string, string>): number {
  const per = unreadPerThread(pesan, meId, readMap)
  return Object.values(per).reduce((a, b) => a + b, 0)
}
