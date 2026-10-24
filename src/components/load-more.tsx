'use client'

import { ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface LoadMoreProps {
  /** Jumlah baris yang sedang ditampilkan. */
  tampil: number
  /** Jumlah total baris. */
  total: number
  /** Dipanggil saat tombol ditekan (biasanya menambah batas render). */
  onMore: () => void
  /** Kata satuan untuk keterangan, mis. "tiket" / "baris". */
  satuan?: string
}

/** Kaki daftar panjang: keterangan "Menampilkan X dari Y" + tombol tampilkan lagi. */
export default function LoadMore({ tampil, total, onMore, satuan = 'baris' }: LoadMoreProps) {
  if (total <= tampil) return null
  const sisa = total - tampil
  return (
    <div className="flex flex-col items-center gap-1.5 border-t bg-slate-50/50 py-3">
      <span className="text-[11px] text-slate-500">
        Menampilkan {tampil} dari {total} {satuan}
      </span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onMore}
        aria-label={`Tampilkan lebih banyak (sisa ${sisa})`}
      >
        <ChevronDown className="h-3.5 w-3.5" />
        Tampilkan lebih banyak (sisa {sisa})
      </Button>
    </div>
  )
}
