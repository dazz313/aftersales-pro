'use client'

import { useAiJobs } from '@/lib/ai-jobs'
import { useAppStore } from '@/lib/store'
import { Loader2, Sparkles } from 'lucide-react'

/**
 * Indikator global "AI bekerja" — tampil di header semua fitur selama ada
 * pekerjaan AI (analisa atau chat) yang berjalan di background. Klik untuk
 * kembali ke view Analisa AI dan melihat hasilnya.
 */
export default function AiJobsIndicator() {
  const jobs = useAiJobs((s) => s.jobs)
  const chatSending = useAiJobs((s) => s.chatSending)
  const navigateTo = useAppStore((s) => s.navigateTo)

  const berjalan = Object.values(jobs).filter((j) => j.status === 'running')
  const total = berjalan.length + (chatSending ? 1 : 0)
  if (total === 0) return null

  const label = [
    ...berjalan.map((j) => j.label),
    ...(chatSending ? ['Chat AI'] : []),
  ].join(' · ')

  return (
    <button
      type="button"
      onClick={() => navigateTo('ai')}
      title={`AI sedang bekerja: ${label}. Klik untuk membuka Analisa AI.`}
      className="flex items-center gap-1.5 rounded-full border border-violet-200 bg-violet-50 py-1.5 pl-2 pr-2.5 text-[11px] font-semibold text-violet-700 transition-colors hover:bg-violet-100"
      aria-label={`AI sedang bekerja (${total} pekerjaan). Buka Analisa AI.`}
    >
      <span className="relative flex h-4 w-4 items-center justify-center">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      </span>
      <Sparkles className="hidden h-3 w-3 sm:block" />
      <span className="hidden sm:inline">AI bekerja</span>
      <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-violet-600 px-1 text-[10px] font-bold text-white">
        {total}
      </span>
    </button>
  )
}
