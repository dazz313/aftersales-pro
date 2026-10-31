'use client'

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { KertasStiker } from '@/lib/sticker-print'

/**
 * SETTING KERTAS cetak stiker — selalu tampil kecil di footer setiap dialog stiker.
 * Pilihan disimpan per perangkat (localStorage), karena printer berbeda-beda antar komputer/HP.
 */
export function PilihKertas({ value, onChange }: { value: KertasStiker; onChange: (k: KertasStiker) => void }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] font-medium text-slate-500">Kertas</span>
      <Select value={value} onValueChange={(v) => onChange(v as KertasStiker)}>
        <SelectTrigger className="h-7 w-[250px] text-[11px]" aria-label="Pilih ukuran kertas cetak stiker">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="A4" className="text-[11px]">A4 — printer biasa (stiker 44 mm)</SelectItem>
          <SelectItem value="THERMAL" className="text-[11px]">Label Thermal 58 mm — portable (36 mm)</SelectItem>
        </SelectContent>
      </Select>
    </div>
  )
}
