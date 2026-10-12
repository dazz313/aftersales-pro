'use client'

import { useState } from 'react'
import { WrenchIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Logo perusahaan (diunggah via Pengaturan → Profil).
 * Otomatis fallback ke ikon bawaan bila belum ada logo.
 */
export default function CompanyLogo({ className }: { className?: string }) {
  const [noLogo, setNoLogo] = useState(false)
  if (noLogo) {
    return (
      <div className={cn('flex shrink-0 items-center justify-center rounded-xl bg-emerald-500 text-white', className)}>
        <WrenchIcon className="h-1/2 w-1/2" />
      </div>
    )
  }
  return (
    <img
      src="/api/logo"
      alt="Logo perusahaan"
      onError={() => setNoLogo(true)}
      className={cn('shrink-0 rounded-xl bg-white object-contain', className)}
    />
  )
}
