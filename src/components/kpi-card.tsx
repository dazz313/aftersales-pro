'use client'

import type { ComponentType } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ArrowUpRight } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface KpiDef {
  title: string
  value: string
  sub?: string
  icon: ComponentType<{ className?: string }>
  tone: string
  onClick?: () => void
}

/**
 * Kartu indikator KPI portable — dipakai di Dashboard dan bisa dipakai ulang
 * di view mana pun. Cukup kirim KpiDef (judul, nilai, sub-teks, ikon, aksen,
 * aksi klik drill-down). Klik + Enter/Spasi didukung untuk aksesibilitas.
 * Varian `compact` memadatkan kartu agar banyak indikator muat di halaman pertama.
 */
export default function KpiCard({
  title, value, sub, icon: Icon, tone, onClick, compact,
}: KpiDef & { compact?: boolean }) {
  const clickable = Boolean(onClick)
  return (
    <Card
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      aria-label={clickable ? `Buka data sumber: ${title}` : undefined}
      onClick={clickable ? onClick : undefined}
      onKeyDown={clickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick?.() } } : undefined}
      className={cn(
        'group relative overflow-hidden',
        clickable && 'cursor-pointer transition-all hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500'
      )}
    >
      <div className={cn('absolute inset-x-0 top-0', compact ? 'h-0.5' : 'h-1', tone)} />
      <CardHeader className={cn('flex flex-row items-center justify-between', compact ? 'pb-1' : 'pb-2')}>
        <CardTitle className={cn('font-medium text-slate-500', compact ? 'text-xs' : 'text-sm')}>{title}</CardTitle>
        <Icon className={cn('text-slate-400 transition-colors group-hover:text-emerald-500', compact ? 'h-4 w-4' : 'h-5 w-5')} />
      </CardHeader>
      <CardContent className={compact ? 'pb-3' : undefined}>
        <div className={cn('font-bold text-slate-900', compact ? 'text-xl' : 'text-2xl')}>{value}</div>
        {sub && (
          <p className={cn('text-slate-500', compact ? 'mt-0.5 truncate text-[11px]' : 'mt-1 text-xs')} title={sub}>
            {sub}
            {!compact && clickable && (
              <span className="ml-1.5 inline-flex translate-y-px items-center gap-0.5 whitespace-nowrap text-[10px] font-semibold text-emerald-600 transition-colors group-hover:text-emerald-700 group-hover:underline">
                Lihat sumber <ArrowUpRight className="h-3 w-3" />
              </span>
            )}
          </p>
        )}
      </CardContent>
    </Card>
  )
}

/** Baris/grid indikator — tambah, pindah, atau kurangi cukup edit array items. */
export function KpiGrid({ items, compact, className }: { items: KpiDef[]; compact?: boolean; className?: string }) {
  return (
    <div className={cn(compact ? 'grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-5' : 'grid gap-4 sm:grid-cols-2 xl:grid-cols-4', className)}>
      {items.map((k) => <KpiCard key={k.title} {...k} compact={compact} />)}
    </div>
  )
}
