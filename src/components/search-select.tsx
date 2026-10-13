'use client'

import { useState } from 'react'
import { Check, ChevronsUpDown, Plus, X } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { cn } from '@/lib/utils'

export interface SearchOption {
  value: string
  label: string
  sub?: string
}

interface SearchSelectProps {
  value: string
  onChange: (v: string) => void
  options: SearchOption[]
  placeholder?: string
  emptyText?: string
  disabled?: boolean
  className?: string
  /** Bila true, teks ketikan bebas bisa dipakai sebagai nilai baru */
  allowCustom?: string
  ariaLabel?: string
}

/**
 * Dropdown dengan pencarian cepat: ketik huruf awal untuk menyaring
 * ratusan opsi tanpa scroll. Pengganti Select untuk data master
 * (toko, customer, unit, sparepart, teknisi).
 */
export default function SearchSelect({
  value,
  onChange,
  options,
  placeholder = '— Pilih —',
  emptyText = 'Tidak ada yang cocok.',
  disabled,
  className,
  allowCustom,
  ariaLabel,
}: SearchSelectProps) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const selected = options.find((o) => o.value === value)

  const pick = (v: string) => {
    onChange(v)
    setOpen(false)
    setQ('')
  }

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQ('') }}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={ariaLabel ?? placeholder}
          disabled={disabled}
          className={cn('w-full justify-between font-normal', !selected && 'text-slate-500', className)}
        >
          <span className="truncate">{selected ? selected.label : placeholder}</span>
          <span className="ml-2 flex shrink-0 items-center">
            {selected && !disabled && (
              <span
                role="button"
                tabIndex={0}
                aria-label="Hapus pilihan"
                onClick={(e) => { e.stopPropagation(); pick('') }}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); pick('') } }}
                className="rounded-full p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                <X className="h-3 w-3" />
              </span>
            )}
            <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command shouldFilter>
          <CommandInput value={q} onValueChange={setQ} placeholder="Ketik untuk mencari…" />
          <CommandList>
            <CommandEmpty>
              {allowCustom && q.trim() ? (
                <button
                  type="button"
                  className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left text-sm text-emerald-700 hover:underline"
                  onClick={() => pick(q.trim())}
                >
                  <Plus className="h-3.5 w-3.5" /> {allowCustom} “{q.trim()}”
                </button>
              ) : (
                emptyText
              )}
            </CommandEmpty>
            <CommandGroup>
              {options.map((o) => (
                <CommandItem
                  key={o.value}
                  value={`${o.label} ${o.sub ?? ''}`}
                  keywords={[o.value]}
                  onSelect={() => pick(o.value)}
                >
                  <Check className={cn('mr-1 h-4 w-4 shrink-0', o.value === value ? 'opacity-100' : 'opacity-0')} />
                  <span className="min-w-0">
                    <span className="block truncate">{o.label}</span>
                    {o.sub && <span className="block truncate text-[11px] text-slate-400">{o.sub}</span>}
                  </span>
                </CommandItem>
              ))}
              {allowCustom && q.trim() && !options.some((o) => o.label.toLowerCase() === q.trim().toLowerCase()) && (
                <CommandItem value={`__custom__ ${q}`} onSelect={() => pick(q.trim())}>
                  <Plus className="mr-1 h-4 w-4 shrink-0 text-emerald-600" />
                  <span>{allowCustom} “{q.trim()}”</span>
                </CommandItem>
              )}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
