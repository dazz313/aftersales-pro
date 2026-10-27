'use client'

import type { ChatPesanItem } from '@/lib/types'

/**
 * Notifikasi SUARA untuk MiniChat
 * ================================
 * Dibunyikan saat ada pesan chat BARU dari orang lain, dipicu pembaruan
 * query `['chat']` (update dari polling apa pun: widget MiniChat, view
 * Komunikasi, kartu CHAT-01 Dashboard — semuanya pakai kunci query yang
 * sama sehingga cukup satu komponen pendengar global).
 *
 * - Suara disintesis dgn Web Audio (dua nada lembut) → tak butuh file
 *   audio & risiko 404 tidak ada.
 * - Autoplay browser melarang suara SEBELUM interaksi pertama (klik) —
 *   AudioContext dibangunkan pada gesture pertama; bila tetap diblokir
 *   fungsi ini SENGAJA diam (suara adalah info tambahan, tak boleh error).
 */

/** Penanda id pesan terakhir yang sudah diketahui — diinisialisasi komponen. */
let konteksKolam: AudioContext | null = null

/** Ambil/buat AudioContext tunggal; bila suspended coba dibangunkan. */
function ambilKonteks(): AudioContext | null {
  if (typeof window === 'undefined') return null
  try {
    if (!konteksKolam) konteksKolam = new AudioContext()
    if (konteksKolam.state === 'suspended') void konteksKolam.resume()
    return konteksKolam
  } catch {
    return null
  }
}

/**
 * Bangunkan mesin suara di interaksi pertama (pointerdown/keydown) —
 * dipanggil sekali oleh komponen pendengar; aman dipanggil berulang.
 */
export function bukaSuara(): void {
  ambilKonteks()
}

/** Bunyi chime 2 nada (D6 → G6) — ringan, panjang total ~0,7 detik. */
export function mainkanSuaraChat(): void {
  try {
    const ctx = ambilKonteks()
    if (!ctx || ctx.state !== 'running') return
    const t0 = ctx.currentTime
    const nada = (frekuensi: number, mulai: number, durasi: number, nyaring: number) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = frekuensi
      gain.gain.setValueAtTime(0.0001, mulai)
      gain.gain.linearRampToValueAtTime(nyaring, mulai + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, mulai + durasi)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(mulai)
      osc.stop(mulai + durasi + 0.05)
    }
    nada(1174.7, t0, 0.35, 0.2)
    nada(1568.0, t0 + 0.18, 0.4, 0.15)
  } catch {
    // Web Audio tak tersedia — suara diabaikan, fungsi utama chat aman.
  }
}

/**
 * Deteksi pesan baru (murni, mudah diuji): dgn id terakhir yang sudah
 * diketahui, apakah ada pesan ber-id lebih besar (dan apakah ada di
 * antaranya yang dari ORANG LAIN = perlu dibunyikan).
 */
export function deteksiPesanBaru(
  pesan: ChatPesanItem[],
  meId: number,
  idTerakhir: number
): { maxId: number; adaBaru: boolean } {
  let maxId = idTerakhir
  let adaBaru = false
  for (const p of pesan) {
    if (p.id > maxId) maxId = p.id
    if (p.id > idTerakhir && p.pengirimId !== meId) adaBaru = true
  }
  return { maxId, adaBaru }
}
