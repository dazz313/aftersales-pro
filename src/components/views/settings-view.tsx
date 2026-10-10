'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  fetcher, postJson, formatWaktu, testGateway,
  type AuditLog, type Pengguna, type GatewayStatus, type GatewayTestResult, type BackupStatus, type BackupOutcome,
} from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import { useAppStore } from '@/lib/store'
import {
  Building2, Save, ScrollText, ShieldCheck, DatabaseBackup, History,
  Radio, Smartphone, Send, CloudUpload, RefreshCw, CheckCircle2, XCircle, CircleAlert,
} from 'lucide-react'
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
  TEST: 'bg-sky-100 text-sky-800',
  BACKUP: 'bg-teal-100 text-teal-800',
}

function aksiTone(aksi: string): string {
  const prefix = aksi.split('_')[0]
  return AKSI_TONES[prefix] ?? 'bg-slate-100 text-slate-600'
}

const STATUS_TONE: Record<string, string> = {
  SUCCESS: 'border-emerald-300 bg-emerald-50 text-emerald-700',
  LOCAL: 'border-amber-300 bg-amber-50 text-amber-700',
  FAILED: 'border-rose-300 bg-rose-50 text-rose-700',
}

export default function SettingsView() {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const { role } = useAppStore()
  const [form, setForm] = useState<Record<string, string>>({})
  const [gwForm, setGwForm] = useState<Record<string, string>>({})
  const [gsForm, setGsForm] = useState<Record<string, string>>({})

  const { data: settings, isLoading: settingsLoading } = useQuery({
    queryKey: ['pengaturan'],
    queryFn: () => fetcher<{ list: { id: number; kunci: string; nilai: string }[]; map: Record<string, string> }>('/api/pengaturan'),
  })
  const { data: gwStatus } = useQuery<GatewayStatus>({
    queryKey: ['gateway-status'],
    queryFn: () => fetcher<GatewayStatus>('/api/gateway/test'),
  })
  const { data: backupStatus } = useQuery<BackupStatus>({
    queryKey: ['backup-status'],
    queryFn: () => fetcher<BackupStatus>('/api/backup/sheets'),
    refetchInterval: 60_000,
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

  const saveGateway = useMutation({
    mutationFn: () => postJson('/api/pengaturan', { settings: { ...(settings?.map ?? {}), ...gwForm }, aktor: role }, 'PUT'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pengaturan'] })
      queryClient.invalidateQueries({ queryKey: ['gateway-status'] })
      queryClient.invalidateQueries({ queryKey: ['audit'] })
      toast({ title: 'Konfigurasi Gateway tersimpan', description: 'WhatsApp & Telegram siap digunakan sebagai channel laporan.' })
    },
    onError: (e: Error) => toast({ title: 'Gagal menyimpan Gateway', description: e.message, variant: 'destructive' }),
  })

  const saveBackup = useMutation({
    mutationFn: () => postJson('/api/pengaturan', { settings: { ...(settings?.map ?? {}), ...gsForm }, aktor: role }, 'PUT'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pengaturan'] })
      queryClient.invalidateQueries({ queryKey: ['backup-status'] })
      queryClient.invalidateQueries({ queryKey: ['audit'] })
      toast({ title: 'Konfigurasi Backup tersimpan', description: 'Backup otomatis Google Spreadsheet mengikuti pengaturan baru.' })
    },
    onError: (e: Error) => toast({ title: 'Gagal menyimpan Backup', description: e.message, variant: 'destructive' }),
  })

  const testMutation = useMutation({
    mutationFn: (channel: 'WHATSAPP' | 'TELEGRAM') => testGateway(channel),
    onSuccess: (res: GatewayTestResult) => {
      queryClient.invalidateQueries({ queryKey: ['audit'] })
      toast({
        title: res.ok ? `Tes ${res.channel} terkirim (${res.mode})` : `Tes ${res.channel} gagal`,
        description: res.detail,
        variant: res.ok ? 'default' : 'destructive',
      })
    },
    onError: (e: Error) => toast({ title: 'Tes gateway gagal', description: e.message, variant: 'destructive' }),
  })

  const backupMutation = useMutation({
    mutationFn: () => postJson<BackupOutcome>('/api/backup/sheets', { trigger: 'MANUAL', aktor: role }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['backup-status'] })
      queryClient.invalidateQueries({ queryKey: ['audit'] })
      toast({
        title: res.status === 'SUCCESS' ? 'Backup ke Google Spreadsheet berhasil' : res.status === 'LOCAL' ? 'Backup tersimpan lokal (snapshot)' : 'Backup gagal',
        description: res.message,
        variant: res.status === 'FAILED' ? 'destructive' : 'default',
      })
    },
    onError: (e: Error) => toast({ title: 'Backup gagal', description: e.message, variant: 'destructive' }),
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

  const gw = (k: string) => gwForm[k] ?? settings?.map[k] ?? ''
  const gs = (k: string) => gsForm[k] ?? settings?.map[k] ?? ''

  const filteredLogs = logs ?? []

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {/* Kolom kiri: profil + gateway + backup */}
      <div className="space-y-4 lg:col-span-1">
        {/* Profil perusahaan */}
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

        {/* ===== GATEWAY (WhatsApp & Telegram) ===== */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Radio className="h-4 w-4 text-emerald-600" /> Gateway — WhatsApp &amp; Telegram
            </CardTitle>
            <CardDescription>Channel alternatif laporan toko/teknisi. Konfigurasi disimpan di sini (Pengaturan).</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* WhatsApp */}
            <div className="space-y-2.5 rounded-lg border p-3">
              <div className="flex items-center justify-between">
                <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-800"><Smartphone className="h-3.5 w-3.5 text-emerald-600" /> WhatsApp</p>
                <Switch
                  checked={gw('gateway_wa_aktif') !== 'false'}
                  onCheckedChange={(v) => setGwForm({ ...gwForm, gateway_wa_aktif: String(v) })}
                  aria-label="Aktifkan channel WhatsApp"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="gw-wa-url" className="text-xs">URL API Gateway (Fonnte / Wablas / custom webhook)</Label>
                <Input id="gw-wa-url" value={gw('gateway_wa_url')} onChange={(e) => setGwForm({ ...gwForm, gateway_wa_url: e.target.value })} placeholder="https://api.fonnte.com/send" className="font-mono text-xs" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="gw-wa-token" className="text-xs">Token API</Label>
                <Input id="gw-wa-token" type="password" value={gw('gateway_wa_token')} onChange={(e) => setGwForm({ ...gwForm, gateway_wa_token: e.target.value })} placeholder="••••••••" className="font-mono text-xs" />
              </div>
              <div className="flex items-center justify-between gap-2">
                {gwStatus?.whatsapp.terkonfigurasi ? (
                  <Badge variant="outline" className="gap-1 border-emerald-300 text-[10px] text-emerald-700"><CheckCircle2 className="h-3 w-3" /> terkonfigurasi</Badge>
                ) : (
                  <Badge variant="outline" className="gap-1 border-amber-300 text-[10px] text-amber-600"><CircleAlert className="h-3 w-3" /> mode simulasi</Badge>
                )}
                <Button size="sm" variant="outline" disabled={testMutation.isPending} onClick={() => testMutation.mutate('WHATSAPP')}>
                  <Send className="mr-1 h-3 w-3" /> Tes
                </Button>
              </div>
            </div>

            {/* Telegram */}
            <div className="space-y-2.5 rounded-lg border p-3">
              <div className="flex items-center justify-between">
                <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-800"><Send className="h-3.5 w-3.5 text-sky-600" /> Telegram (alternatif)</p>
                <Switch
                  checked={gw('gateway_tg_aktif') === 'true'}
                  onCheckedChange={(v) => setGwForm({ ...gwForm, gateway_tg_aktif: String(v) })}
                  aria-label="Aktifkan channel Telegram"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="gw-tg-token" className="text-xs">Bot Token (dari @BotFather)</Label>
                <Input id="gw-tg-token" type="password" value={gw('gateway_tg_token')} onChange={(e) => setGwForm({ ...gwForm, gateway_tg_token: e.target.value })} placeholder="123456:ABC-DEF..." className="font-mono text-xs" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="gw-tg-chat" className="text-xs">Chat / Group ID tujuan</Label>
                <Input id="gw-tg-chat" value={gw('gateway_tg_chat_id')} onChange={(e) => setGwForm({ ...gwForm, gateway_tg_chat_id: e.target.value })} placeholder="-1001234567890" className="font-mono text-xs" />
              </div>
              <div className="flex items-center justify-between gap-2">
                {gwStatus?.telegram.terkonfigurasi ? (
                  <Badge variant="outline" className="gap-1 border-emerald-300 text-[10px] text-emerald-700"><CheckCircle2 className="h-3 w-3" /> terkonfigurasi</Badge>
                ) : (
                  <Badge variant="outline" className="gap-1 border-amber-300 text-[10px] text-amber-600"><CircleAlert className="h-3 w-3" /> mode simulasi</Badge>
                )}
                <Button size="sm" variant="outline" disabled={testMutation.isPending} onClick={() => testMutation.mutate('TELEGRAM')}>
                  <Send className="mr-1 h-3 w-3" /> Tes
                </Button>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Channel default notifikasi sistem (alert engine)</Label>
              <Select value={gw('gateway_channel_default') || 'WHATSAPP'} onValueChange={(v) => setGwForm({ ...gwForm, gateway_channel_default: v })}>
                <SelectTrigger aria-label="Channel default"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="WHATSAPP">WhatsApp</SelectItem>
                  <SelectItem value="TELEGRAM">Telegram</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Button className="w-full bg-emerald-600 hover:bg-emerald-700" disabled={saveGateway.isPending} onClick={() => saveGateway.mutate()}>
              <Save className="mr-1.5 h-4 w-4" /> Simpan Gateway
            </Button>
          </CardContent>
        </Card>

        {/* ===== BACKUP GOOGLE SPREADSHEET ===== */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <DatabaseBackup className="h-4 w-4 text-teal-600" /> Backup Google Spreadsheet
            </CardTitle>
            <CardDescription>Backup otomatis data bersama (toko, customer, sparepart, unit, kunjungan, tiket) ke Google Sheets</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="gs-id" className="text-xs">Spreadsheet ID (dari URL spreadsheet)</Label>
              <Input id="gs-id" value={gs('gs_spreadsheet_id')} onChange={(e) => setGsForm({ ...gsForm, gs_spreadsheet_id: e.target.value })} placeholder="1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms" className="font-mono text-xs" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="gs-email" className="text-xs">Service Account Email</Label>
              <Input id="gs-email" value={gs('gs_service_email')} onChange={(e) => setGsForm({ ...gsForm, gs_service_email: e.target.value })} placeholder="backup@project.iam.gserviceaccount.com" className="font-mono text-xs" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="gs-key" className="text-xs">Private Key (PEM)</Label>
              <Textarea id="gs-key" value={gs('gs_private_key')} onChange={(e) => setGsForm({ ...gsForm, gs_private_key: e.target.value })} placeholder="-----BEGIN PRIVATE KEY-----\nMIIEvQ...\n-----END PRIVATE KEY-----" className="font-mono text-[10px]" rows={3} />
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <p className="text-xs font-semibold text-slate-800">Backup otomatis berkala</p>
                <p className="text-[10px] text-slate-500">Jalan otomatis saat aplikasi dibuka bila jadwal tercapai</p>
              </div>
              <Switch
                checked={gs('gs_auto_aktif') !== 'false'}
                onCheckedChange={(v) => setGsForm({ ...gsForm, gs_auto_aktif: String(v) })}
                aria-label="Aktifkan backup otomatis"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="gs-interval" className="text-xs">Interval backup otomatis (jam)</Label>
              <Input id="gs-interval" type="number" min={1} value={gs('gs_interval_jam') || '24'} onChange={(e) => setGsForm({ ...gsForm, gs_interval_jam: e.target.value })} />
            </div>

            {backupStatus?.last && (
              <div className="rounded-lg border p-3 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <Badge variant="outline" className={cn('text-[10px]', STATUS_TONE[backupStatus.last.status])}>
                    {backupStatus.last.status === 'SUCCESS' ? 'GOOGLE SHEETS' : backupStatus.last.status === 'LOCAL' ? 'SNAPSHOT LOKAL' : 'GAGAL'}
                  </Badge>
                  <span className="text-[10px] text-slate-400">{formatWaktu(backupStatus.last.createdAt)}</span>
                </div>
                <p className="mt-1.5 line-clamp-3 text-slate-600">{backupStatus.last.message}</p>
                {backupStatus.dueNow && (
                  <p className="mt-1 flex items-center gap-1 text-[10px] text-amber-600"><RefreshCw className="h-3 w-3 animate-spin" /> Backup otomatis akan segera dijalankan…</p>
                )}
              </div>
            )}

            {backupStatus && backupStatus.logs.length > 0 && (
              <ScrollArea className="max-h-40 pr-2">
                <div className="space-y-1.5">
                  {backupStatus.logs.slice(1, 6).map((l) => (
                    <div key={l.id} className="flex items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-[10px]">
                      <Badge variant="outline" className={cn('text-[9px]', STATUS_TONE[l.status])}>{l.status}</Badge>
                      <span className="text-slate-500">{l.trigger} · {l.rowsTotal} baris</span>
                      <span className="text-slate-400">{formatWaktu(l.createdAt)}</span>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}

            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" disabled={saveBackup.isPending} onClick={() => saveBackup.mutate()}>
                <Save className="mr-1.5 h-4 w-4" /> Simpan
              </Button>
              <Button className="flex-1 bg-teal-600 hover:bg-teal-700" disabled={backupMutation.isPending} onClick={() => backupMutation.mutate()}>
                <CloudUpload className={cn('mr-1.5 h-4 w-4', backupMutation.isPending && 'animate-bounce')} /> Backup Sekarang
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Keamanan & backup info */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="h-4 w-4 text-teal-600" /> Keamanan &amp; Reliabilitas
            </CardTitle>
            <CardDescription>Non-Functional Requirements PRD (Section 8)</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2.5 text-xs">
            <div className="flex items-start gap-2.5 rounded-lg border p-3">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
              <div>
                <p className="font-semibold text-slate-800">Otentikasi &amp; Enkripsi</p>
                <p className="text-slate-500">Kata sandi dienkripsi, token API untuk Gateway WA/Telegram, HTTPS aktif di gateway.</p>
              </div>
            </div>
            <div className="flex items-start gap-2.5 rounded-lg border p-3">
              <DatabaseBackup className="mt-0.5 h-4 w-4 shrink-0 text-teal-600" />
              <div>
                <p className="font-semibold text-slate-800">Backup Data Bersama</p>
                <p className="text-slate-500">Google Spreadsheet otomatis berkala + snapshot lokal JSON (db/backups) sebagai fallback.</p>
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
