'use client'

import { useCallback, useMemo, useState } from 'react'
import { batasAktif, potongBertahap, UKURAN_BERTAHAP, type BatasState, type HasilBertahap } from '@/lib/bertahap'

export interface HasilUseBertahap<T> extends HasilBertahap<T> {
  /** Tampilkan satu blok lagi ("Tampilkan lebih banyak"). */
  tambah: () => void
  /** Batas render yang sedang berlaku. */
  batas: number
}

/**
 * Render bertahap daftar panjang untuk sebuah komponen.
 *
 * `kunci` adalah sidik jari filter/pencarian (mis. gabungan tab + kata kunci).
 * Saat kunci berubah, batas otomatis kembali ke `ukuran` — jadi daftar selalu
 * mulai dari halaman pertama setelah filter diubah. Ini dihitung saat render
 * (bukan lewat useEffect) agar tidak memicu render berantai.
 */
export function useBertahap<T>(
  items: readonly T[],
  kunci: string,
  ukuran: number = UKURAN_BERTAHAP
): HasilUseBertahap<T> {
  const [state, setState] = useState<BatasState>({ kunci, batas: ukuran })
  const batas = batasAktif(state, kunci, ukuran)
  const hasil = useMemo(() => potongBertahap(items, batas), [items, batas])
  const tambah = useCallback(() => {
    setState((s) => ({ kunci, batas: batasAktif(s, kunci, ukuran) + ukuran }))
  }, [kunci, ukuran])
  return { ...hasil, batas, tambah }
}
