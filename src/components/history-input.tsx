'use client'

import { useId, useState } from 'react'
import { Input } from '@/components/ui/input'

const PREFIX = 'aspro-history:'
const MAX_ITEMS = 20

/** Ambil riwayat nilai per kunci (tersimpan di browser masing-masing). */
export function getHistory(key: string): string[] {
  try {
    const raw = localStorage.getItem(PREFIX + key)
    const arr = raw ? JSON.parse(raw) : []
    return Array.isArray(arr) ? arr.filter((v) => typeof v === 'string') : []
  } catch {
    return []
  }
}

/** Simpan nilai ke riwayat (unik, terbaru di depan, maks 20). */
export function pushHistory(key: string, value: string) {
  const v = value.trim()
  if (!v) return
  try {
    const next = [v, ...getHistory(key).filter((x) => x.toLowerCase() !== v.toLowerCase())].slice(0, MAX_ITEMS)
    localStorage.setItem(PREFIX + key, JSON.stringify(next))
  } catch {
    /* abaikan — mode privat dsb. */
  }
}

interface HistoryInputProps extends React.ComponentProps<typeof Input> {
  historyKey: string
  /** Opsi tambahan selain riwayat (mis. daftar merk dari server). */
  suggestions?: string[]
}

/**
 * Input teks dengan saran otomatis dari nilai yang pernah ditulis
 * sebelumnya (disimpan lokal per browser). Pilih saran untuk mengisi
 * cepat tanpa mengetik ulang — cocok untuk deskripsi, catatan, nama,
 * alamat, merk, model, dsb.
 */
export default function HistoryInput({ historyKey, suggestions, onBlur, ...props }: HistoryInputProps) {
  const reactId = useId()
  const listId = `${historyKey}-${reactId}`.replace(/[^a-zA-Z0-9_-]/g, '')
  const [items, setItems] = useState<string[]>(() => getHistory(historyKey))
  const options = [...items]
  for (const s of suggestions ?? []) {
    if (s && !options.some((x) => x.toLowerCase() === s.toLowerCase())) options.push(s)
  }

  return (
    <>
      <Input
        {...props}
        list={listId}
        autoComplete="off"
        onBlur={(e) => {
          pushHistory(historyKey, e.target.value)
          setItems(getHistory(historyKey))
          onBlur?.(e)
        }}
      />
      <datalist id={listId}>
        {options.map((v) => (
          <option key={v} value={v} />
        ))}
      </datalist>
    </>
  )
}
