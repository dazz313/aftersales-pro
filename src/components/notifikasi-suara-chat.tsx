'use client'

import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAppStore } from '@/lib/store'
import { bukaSuara, mainkanSuaraChat, deteksiPesanBaru } from '@/lib/suara-chat'
import type { ChatData } from '@/lib/types'

/**
 * NotifikasiSuaraChat — komponen tak terlihat yang membunyikan chime saat
 * ada pesan chat BARU dari orang lain.
 *
 * Cara kerja: BERLANGGANAN pada cache query `['chat']` (bukan menambah
 * polling sendiri) — setiap update sukses dari polling komponen yang aktif
 * (widget MiniChat 12/4 dtk, view Komunikasi 5 dtk, Dashboard CHAT-01 15
 * dtk) dievaluasi: id pesan lebih besar dari penanda terakhir & pengirim
 * ≠ saya → bunyi. Muat pertama hanya MENGINISIALISASI penanda agar bunyi
 * tidak muncul untuk riwayat lama saat halaman di-refresh.
 *
 * Dipasang SEKALI di semua view (page.tsx) — termasuk view Komunikasi,
 * karena widget MiniChat return null di view itu; komponen ini memastikan
 * bunyi tetap jalan di view mana pun yang sedang aktif.
 */
export default function NotifikasiSuaraChat() {
  const user = useAppStore((s) => s.user)
  const queryClient = useQueryClient()
  // Penanda id pesan terakhir (0 = belum pernah muat — tak ada bunyi awal).
  const idTerakhirRef = useRef(0)

  useEffect(() => {
    if (!user) return

    // Autoplay diblokir sebelum gesture pertama — bangunkan audio di klik/ketuk.
    const bangunkan = () => bukaSuara()
    document.addEventListener('pointerdown', bangunkan, { once: true })
    document.addEventListener('keydown', bangunkan, { once: true })

    const langgan = queryClient.getQueryCache().subscribe((ev) => {
      if (ev.type !== 'updated') return
      if (ev.query.queryKey[0] !== 'chat') return
      const data = ev.query.state.data as ChatData | undefined
      if (!data?.pesan || !Array.isArray(data.pesan)) return

      const { maxId, adaBaru } = deteksiPesanBaru(data.pesan, data.meId, idTerakhirRef.current)
      if (idTerakhirRef.current === 0) {
        idTerakhirRef.current = maxId // muat pertama — tanpa bunyi (riwayat lama)
        return
      }
      if (adaBaru) {
        idTerakhirRef.current = maxId
        mainkanSuaraChat()
      } else if (maxId > idTerakhirRef.current) {
        idTerakhirRef.current = maxId // hanya pesan sendiri — cukup pesan penanda
      }
    })

    return () => {
      document.removeEventListener('pointerdown', bangunkan)
      document.removeEventListener('keydown', bangunkan)
      langgan()
    }
  }, [user, queryClient])

  return null
}
