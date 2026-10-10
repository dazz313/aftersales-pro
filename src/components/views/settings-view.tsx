'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetcher, postJson, formatWaktu, type AuditLog, type Pengguna } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useToast } from '@/hooks/use-toast'
import { useAppStore } from '@/lib/store'
import { Building2, Save, ScrollText, ShieldCheck, DatabaseBackup, Search, History } from 'lucide-react'
import { cn } from '@/lib/utils'

const AKSI_TONES: Record<string, string> = {
  CREATE: 'bg-emerald-100 text-emerald-700',
  UPDATE: 'bg-amber-100 text-amber-700',
  DELETE: 'bg-rose-100 text-rose-700',
  SUBMIT: 'bg-teal-100 text-teal-700',
  MARK: 'bg-violet-100 text-violet-700',
  EXPORT: 'bg-sky-100 text-sky-800',
  RESTOCK: 'bg-lime-100 text-lime-800',
  ALT: 'bg-rose-100 text-rose-700',
  FINISH: 'bg-emerald-100 text-emerald-700',
  MULAI: 'bg-violet-100 text-violet-700',
}

function aksiTone(aksi: string): string {
  const prefix = aksi.split('_')[0]
  return AKSI_TONES[prefix] ?? 'bg-slate-100 text-slate-600'
}

export default function SettingsView() {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const { role } = useAppStore()
  const [form, setForm] = useState<Record<string, string>>({})

  const { data: settings, isLoading: settingsLoading } = useQuery({
    queryKey: ['pengaturan'],
    queryFn: () => fetcher<{ list: { id: number; kunci: string; nilai: string }[]; map: Record<string, string> }>('/api/pengaturan'),
  })

  const { data: logs, isLoading: logsLoading } = useQuery<AuditLog[]>({
    queryKey: ['audit'],
    queryFn: () => fetcher<AuditLog[]>('/api/audit?limit=150'),
  })

  const { data: users } = useQuery<Pengguna[]>({
    queryKey: ['pengguna'],
    queryFn: () => fetcher<Pengguna[]>('/api/pengguna'),
  })

  const saveMutation = useMutation({
    mutationFn: () => postJson('/api/pengaturan', { settings: { ...(settings?.map ?? {}), ...form }, aktor: role }, 'PUT'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pengaturan'] })
      queryClient.invalidateQueries({ queryKey: ['audit'] })
      toast({ title: 'Profil perusahaan tersimpan' })
    },
    onError: (e: Error) => toast({ title: 'Gagal menyimpan', description: e.message, variant: 'destructive' }),
  })

  const LABELS: Record<string, string> = {
    nama_perusahaan: 'Nama Perusahaan (Workshop)',
    alamat_perusahaan: 'Alamat Perusahaan',
    telepon_perusahaan: 'Telepon',
    email_perusahaan: 'Email',
    partner_produsen: 'Partner Produsen',
    sla_jam_request: 'Batas SLA Request (jam)',
    batas_hari_klaim: 'Batas Hari Klaim (hari)',
  }

  const filteredLogs = logs ?? []

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {/* Profil perusahaan */}
      <div className="space-y-4 lg:col-span-1">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Building2 className="h-4 w-4 text-emerald-600" /> Profil Perusahaan
            </CardTitle>
            <CardDescription>Data ini muncul pada dokumen STTB PDF dan rekap klaim</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {settingsLoading ? (
              Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10" />)
            ) : (
              Object.entries(LABELS).map(([k, label]) => (
                <div key={k} className="space-y-1.5">
                  <Label htmlFor={`set-${k}`} className="text-xs">{label}</Label>
                  <Input id={`set-${k}`} value={form[k] ?? settings?.map[k] ?? ''} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
                </div>
              ))
            )}
            <Button className="w-full bg-emerald-600 hover:bg-emerald-700" disabled={saveMutation.isPending} onClick={() => saveMutation.mutate()}>
              <Save className="mr-1.5 h-4 w-4" /> Simpan Profil
            </Button>
          </CardContent>
        </Card>

        {/* Keamanan & backup info */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="h-4 w-4 text-teal-600" /> Keamanan & Reliabilitas
            </CardTitle>
            <CardDescription>Non-Functional Requirements PRD (Section 8)</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2.5 text-xs">
            <div className="flex items-start gap-2.5 rounded-lg border p-3">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
              <div>
                <p className="font-semibold text-slate-800">Otentikasi & Enkripsi</p>
                <p className="text-slate-500">Kata sandi dienkripsi, token API untuk WA Gateway, HTTPS aktif di gateway.</p>
              </div>
            </div>
            <div className="flex items-start gap-2.5 rounded-lg border p-3">
              <DatabaseBackup className="mt-0.5 h-4 w-4 shrink-0 text-teal-600" />
              <div>
                <p className="font-semibold text-slate-800">Backup Database Harian</p>
                <p className="text-slate-500">Database SQLite snapshot otomatis tiap hari ke cloud storage (cron).</p>
              </div>
            </div>
            <div className="flex items-start gap-2.5 rounded-lg border p-3">
              <History className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <div>
                <p className="font-semibold text-slate-800">Audit Activity Log</p>
                <p className="text-slate-500">Setiap perubahan status data tercatat permanen: aktor, aksi, waktu.</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Audit log */}
      <Card className="lg:col-span-2">
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <ScrollText className="h-4 w-4 text-slate-600" /> Audit Activity Logs
            </CardTitle>
            <CardDescription>Jejak lengkap setiap perubahan data: siapa, kapan, dan apa yang berubah (Modul 6 PRD)</CardDescription>
          </div>
          <Badge variant="outline">{filteredLogs.length} entri</Badge>
        </CardHeader>
        <CardContent>
          {logsLoading ? (
            <div className="space-y-2">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
          ) : (
            <ScrollArea className="max-h-[640px] pr-3">
              <div className="space-y-2">
                {filteredLogs.map((l) => (
                  <div key={l.id} className="flex items-start gap-3 rounded-lg border p-3 transition hover:bg-slate-50">
                    <Badge variant="outline" className={cn('shrink-0 font-mono text-[9px]', aksiTone(l.aksi))}>
                      {l.aksi}
                    </Badge>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-slate-800">{l.deskripsi}</p>
                      <p className="mt-0.5 text-[10px] text-slate-400">
                        {l.entitas}{l.entitasId ? ` · ${l.entitasId}` : ''} · oleh <span className="font-medium text-slate-600">{l.aktor}</span> · {formatWaktu(l.createdAt)}
                      </p>
                    </div>
                  </div>
                ))}
                {filteredLogs.length === 0 && (
                  <p className="py-10 text-center text-sm text-slate-500">Belum ada aktivitas tercatat.</p>
                )}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
