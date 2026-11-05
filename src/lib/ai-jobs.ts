'use client'

import { create } from 'zustand'
import { postJson } from '@/lib/api'
import { toast } from '@/hooks/use-toast'

/**
 * ai-jobs — penyimpan status pekerjaan AI di level modul (bukan di dalam
 * komponen). Request AI tetap berjalan walau view Analisa AI di-unmount
 * (user pindah ke fitur lain); saat kembali, hasil sudah tersedia.
 *
 * Semua panggilan API berat (ringkasan, jadwal, rekomendasi, tren, upload)
 * dan chat interaktif melewati store ini supaya:
 *  - tidak ikut dibatalkan saat komponen hilang,
 *  - status "sedang bekerja" bisa ditampilkan global di header,
 *  - hasil + riwayat chat tidak hilang saat berpindah fitur.
 */

export type AiJobKey = 'ringkasan' | 'jadwal' | 'rekomendasi' | 'tren' | 'upload'

export type AiJobStatus = 'idle' | 'running' | 'success' | 'error'

export interface AiJobState {
  status: AiJobStatus
  hasil: unknown | null
  error: string | null
  label: string
  startedAt: number | null
  finishedAt: number | null
}

export interface ChatMsg {
  role: 'user' | 'assistant'
  content: string
}

export const AI_JOB_LABELS: Record<AiJobKey, string> = {
  ringkasan: 'Ringkasan operasional',
  jadwal: 'Saran jadwal kunjungan',
  rekomendasi: 'Rekomendasi sparepart',
  tren: 'Analisa tren',
  upload: 'Analisa file Excel',
}

interface RunOptions<T> {
  /** Judul toast saat selesai. Default: "<label> selesai". */
  judulSukses?: string
  /** Deskripsi toast saat selesai (opsional). */
  deskripsiSukses?: (hasil: T) => string | undefined
  /** Judul toast saat gagal. Default: "<label> gagal". */
  judulGagal?: string
}

interface AiJobsStore {
  jobs: Record<AiJobKey, AiJobState>
  /** Jalankan pekerjaan AI di background. Aman dipanggil berulang (diabaikan bila masih berjalan). */
  runJob: <T>(
    key: AiJobKey,
    label: string,
    fn: () => Promise<T>,
    opsi?: RunOptions<T>,
  ) => Promise<T | null>
  /** Kosongkan hasil/status satu pekerjaan (tombol Tutup). */
  resetJob: (key: AiJobKey) => void
  /** Ubah sebagian hasil yang sudah ada (mis. menutup narasi tren). */
  patchHasil: (key: AiJobKey, patch: Record<string, unknown>) => void

  /** Riwayat chat AI (bertahan saat pindah fitur). */
  chatMessages: ChatMsg[]
  chatSending: boolean
  kirimChat: (isi: string) => Promise<void>
  resetChat: () => void
}

const SAPAAN_AWAL: ChatMsg = {
  role: 'assistant',
  content:
    'Halo! Saya AI Asisten AfterSales Pro. Bisa tanya apa saja — kondisi usaha, tiket, sparepart, klaim, stok, atau masalah yang kamu hadapi. Saya akan bantu analisis.',
}

const JOB_KOSONG: AiJobState = {
  status: 'idle',
  hasil: null,
  error: null,
  label: '',
  startedAt: null,
  finishedAt: null,
}

function jobsAwal(): Record<AiJobKey, AiJobState> {
  return {
    ringkasan: { ...JOB_KOSONG },
    jadwal: { ...JOB_KOSONG },
    rekomendasi: { ...JOB_KOSONG },
    tren: { ...JOB_KOSONG },
    upload: { ...JOB_KOSONG },
  }
}

export const useAiJobs = create<AiJobsStore>((set, get) => ({
  jobs: jobsAwal(),

  runJob: async <T,>(
    key: AiJobKey,
    label: string,
    fn: () => Promise<T>,
    opsi?: RunOptions<T>,
  ): Promise<T | null> => {
    // Satu pekerjaan per key: klik ganda tidak mengirim request kedua.
    if (get().jobs[key].status === 'running') return null

    set((s) => ({
      jobs: {
        ...s.jobs,
        [key]: {
          ...s.jobs[key],
          status: 'running',
          label,
          error: null,
          startedAt: Date.now(),
          finishedAt: null,
        },
      },
    }))

    try {
      const hasil = await fn()
      set((s) => ({
        jobs: {
          ...s.jobs,
          [key]: {
            ...s.jobs[key],
            status: 'success',
            hasil,
            error: null,
            finishedAt: Date.now(),
          },
        },
      }))
      toast({
        title: opsi?.judulSukses ?? `${label} selesai`,
        description: opsi?.deskripsiSukses?.(hasil),
      })
      return hasil
    } catch (e: unknown) {
      const pesan = e instanceof Error ? e.message : String(e)
      set((s) => ({
        jobs: {
          ...s.jobs,
          [key]: {
            ...s.jobs[key],
            status: 'error',
            error: pesan,
            finishedAt: Date.now(),
          },
        },
      }))
      toast({
        title: opsi?.judulGagal ?? `${label} gagal`,
        description: pesan,
        variant: 'destructive',
      })
      return null
    }
  },

  resetJob: (key) =>
    set((s) => ({
      jobs: { ...s.jobs, [key]: { ...JOB_KOSONG, label: s.jobs[key].label } },
    })),

  patchHasil: (key, patch) =>
    set((s) => {
      const lama = s.jobs[key].hasil
      const baru =
        lama && typeof lama === 'object'
          ? { ...(lama as Record<string, unknown>), ...patch }
          : lama
      return { jobs: { ...s.jobs, [key]: { ...s.jobs[key], hasil: baru } } }
    }),

  chatMessages: [SAPAAN_AWAL],
  chatSending: false,

  kirimChat: async (isi: string) => {
    const teks = isi.trim()
    if (!teks || get().chatSending) return
    const riwayat = [...get().chatMessages, { role: 'user' as const, content: teks }]
    set({ chatMessages: riwayat.slice(-60), chatSending: true })

    try {
      const payload = riwayat
        .filter((m) => m.content.trim())
        .slice(-12)
        .map((m) => ({ role: m.role, content: m.content.trim() }))
      const res = await postJson<{ reply: string; model: string }>('/api/ai/chat', {
        messages: payload,
      })
      set((s) => ({
        chatMessages: [...s.chatMessages, { role: 'assistant' as const, content: res.reply }].slice(-60),
        chatSending: false,
      }))
    } catch (e: unknown) {
      const pesan = e instanceof Error ? e.message : String(e)
      set({ chatSending: false })
      toast({ title: 'Chat AI gagal', description: pesan, variant: 'destructive' })
    }
  },

  resetChat: () => set({ chatMessages: [SAPAAN_AWAL], chatSending: false }),
}))
