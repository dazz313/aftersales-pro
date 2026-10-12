'use client'

import { Search, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

interface QuickSearchProps {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  className?: string
  resultCount?: number
}

/** Kolom pencarian cepat standar: ikon kaca pembesar + tombol hapus + hitungan hasil. */
export default function QuickSearch({ value, onChange, placeholder = 'Cari cepat…', className, resultCount }: QuickSearchProps) {
  return (
    <div className={cn('relative', className)}>
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="h-8 pr-14 pl-8 text-xs"
      />
      <span className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
        {typeof resultCount === 'number' && value.trim() && (
          <span className="rounded bg-slate-100 px-1 font-mono text-[10px] text-slate-500">{resultCount}</span>
        )}
        {value && (
          <button
            type="button"
            aria-label="Hapus pencarian"
            onClick={() => onChange('')}
            className="rounded-full p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </span>
    </div>
  )
}

/** Filter generik: cocok bila query ada di gabungan field (case-insensitive). */
export function matchQuery(fields: (string | null | undefined)[], query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return fields
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .includes(q)
}
