'use client'

/**
 * KodeSparepart — kode sparepart mono yang bisa diklik:
 * - Klik kode          → salin ke clipboard (toast "Kode tersalin")
 * - Ikon cari ("cek")  → buka Lacak Sparepart dengan kata kunci = kode
 *                        (query Bank Kode terfilter — pola navIntent drill-down)
 * Dipakai di tabel Service Tiket, Stok Inventory, Klaim, serta dialog detail.
 * Ikon Copy manual lama digantikan: kode itu sendiri sekarang tombolnya.
 */
import { useState } from 'react'
import { Check, SearchCheck } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import { useAppStore } from '@/lib/store'
import { copyToClipboard } from '@/lib/clipboard'
import { cn } from '@/lib/utils'

interface KodeSparepartProps {
  kode: string
  /** Nama part (opsional) — menempel di tooltip agar lebih informatif. */
  nama?: string
  /** Tampilkan ikon cek → navigasi ke Lacak Sparepart dengan kode ini. */
  cek?: boolean
  /** Kelas warna/ukuran teks; font-mono & semibold sudah bawaan. */
  className?: string
}

export function KodeSparepart({ kode, nama, cek = false, className }: KodeSparepartProps) {
  const { toast } = useToast()
  const { navigateTo } = useAppStore()
  const [tersalin, setTersalin] = useState(false)

  const kodeText = (kode ?? '').trim()
  // Semua hook dipanggil sebelum early-return agar urutan hook tetap stabil.
  if (!kodeText) {
    return (
      <span className={cn('font-mono text-[10px] text-slate-400', className)}>?</span>
    )
  }

  const salin = async () => {
    await copyToClipboard(kodeText)
    setTersalin(true)
    toast({ title: 'Kode tersalin', description: `${kodeText}${nama ? ` — ${nama}` : ''} siap ditempel ke tiket / order.` })
    setTimeout(() => setTersalin(false), 1500)
  }

  return (
    <span className={cn('inline-flex max-w-full min-w-0 items-center gap-0.5', className)}>
      <button
        onClick={() => void salin()}
        title={nama ? `Salin ${kodeText} — ${nama}` : `Salin ${kodeText}`}
        aria-label={`Salin kode ${kodeText}`}
        className={cn(
          'truncate rounded font-mono font-semibold text-current hover:underline',
          tersalin ? 'bg-emerald-100 text-emerald-700 no-underline' : 'hover:bg-slate-100'
        )}
      >
        {tersalin && <Check className="mr-0.5 inline h-2.5 w-2.5" />}
        {kodeText}
      </button>
      {cek && (
        <button
          onClick={() => navigateTo('lacak', { lacakQuery: kodeText })}
          title={`Cek ${kodeText} — buka Lacak Sparepart`}
          aria-label={`Cek kode ${kodeText}`}
          className="shrink-0 rounded text-slate-400 hover:bg-slate-100 hover:text-teal-700"
        >
          <SearchCheck className="h-3 w-3" />
        </button>
      )}
    </span>
  )
}

export default KodeSparepart
