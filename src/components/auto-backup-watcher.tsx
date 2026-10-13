'use client'

import { useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchBackupStatus, postJson } from '@/lib/api'
import { useToast } from '@/hooks/use-toast'

/**
 * Auto Backup Google Spreadsheet (berjalan di background aplikasi).
 * - Memeriksa /api/backup/sheets berkala (tiap 10 menit).
 * - Server menentukan dueNow: auto-aktif && backup terakhir lebih tua
 *   dari interval (default 24 jam, diatur di Pengaturan → Backup).
 * - Jika dueNow → POST backup dengan trigger AUTO (tanpa ganggu UI user).
 */
export default function AutoBackupWatcher() {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const runningRef = useRef(false)

  const { data: status } = useQuery({
    queryKey: ['backup-status'],
    queryFn: fetchBackupStatus,
    refetchInterval: 10 * 60_000,
    staleTime: 5 * 60_000,
  })

  const autoBackup = useMutation({
    mutationFn: () => postJson<{ status: string; message: string }>('/api/backup/sheets', { trigger: 'AUTO' }),
    onSuccess: (res: { status: string; message: string }) => {
      queryClient.invalidateQueries({ queryKey: ['backup-status'] })
      queryClient.invalidateQueries({ queryKey: ['audit'] })
      if (res.status === 'SUCCESS') {
        toast({ title: 'Backup otomatis ke Google Spreadsheet berhasil', description: res.message })
      } else if (res.status === 'LOCAL') {
        toast({ title: 'Backup otomatis tersimpan lokal', description: res.message })
      } else {
        toast({ title: 'Backup otomatis gagal', description: res.message, variant: 'destructive' })
      }
    },
    onError: () => {
      // senyap — auto backup jangan mengganggu user dengan error toast berulang
    },
  })

  useEffect(() => {
    if (!status?.dueNow || runningRef.current || autoBackup.isPending) return
    runningRef.current = true
    autoBackup.mutate()
  }, [status?.dueNow])

  useEffect(() => {
    if (!autoBackup.isPending && !autoBackup.isSuccess) runningRef.current = false
  }, [autoBackup.isPending, autoBackup.isSuccess])

  return null
}
