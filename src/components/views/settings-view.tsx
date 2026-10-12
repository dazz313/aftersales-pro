'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import { useAppStore } from '@/lib/store'
import {
  Building2, Save, ScrollText, ShieldCheck, DatabaseBackup, History,
  Radio, Smartphone, Send, CloudUpload, RefreshCw, CheckCircle2, XCircle, CircleAlert,
  Monitor, Bot, Copy, Inbox, ChevronDown,
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

type SecKey = 'profil' | 'gateway' | 'backup' | 'desktop' | 'keamanan'

/** Section dropdown — header selalu terlihat, isi bisa dibuka/tutup agar halaman tidak kepanjangan. */
function SettingSection({
  sec, title, icon, desc, contentClass, secOpen, onToggle, children,
}: {
  sec: SecKey
  title: string
  icon: ReactNode
  desc: string
  contentClass?: string
  secOpen: Record<SecKey, boolean>
  onToggle: (k: SecKey) => void
  children: ReactNode
}) {
  const open = secOpen[sec]
  return (
    <Collapsible open={open} onOpenChange={() => onToggle(sec)}>
      <Card>
        <CollapsibleTrigger asChild>
          <div
            className="cursor-pointer select-none"
            role="button"
            tabIndex={0}
            aria-expanded={open}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(sec) } }}
          >
            <CardHeader>
              <div className="flex items-center justify-between gap-2">
                <div>
                  <CardTitle className="flex items-center gap-2 text-base">{icon} {title}</CardTitle>
                  <CardDescription>{desc} · klik untuk buka/tutup</CardDescription>
                </div>
                <ChevronDown className={cn('h-4 w-4 shrink-0 text-slate-400 transition-transform', open && 'rotate-180')} />
              </div>
            </CardHeader>
          </div>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className={contentClass}>{children}</CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  )
}

// Info dari Electron preload (versi desktop) — tidak ada di mode web
interface AsproDesktopInfo {
  isDesktop: boolean
  version: string
  platform: string
  dbPath: string
  mcpServerPath: string
  mcpConfigFile: string
  userDataPath: string
  exePath: string
}

declare global {
  interface Window {
    asproDesktop?: { isDesktop: boolean; getInfo: () => Promise<AsproDesktopInfo> }
  }
}

export default function SettingsView() {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const { role } = useAppStore()
  const [form, setForm] = useState<Record<string, string>>({})
  const [gwForm, setGwForm] = useState<Record<string, string>>({})
  const [gsForm, setGsForm] = useState<Record<string, string>>({})
  const [desktopInfo, setDesktopInfo] = useState<AsproDesktopInfo | null>(null)
  // Section dropdown — default: profil & gateway terbuka, sisanya tertutup
  const [secOpen, setSecOpen] = useState<Record<SecKey, boolean>>({ profil: true, gateway: true, backup: false, desktop: false, keamanan: false })
  const toggleSec = (k: SecKey) => setSecOpen((s) => ({ ...s, [k]: !s[k] }))

  // Deteksi mode desktop (Electron preload) untuk path MCP yang pasti
  useEffect(() => {
    const bridge = (window as Window & { asproDesktop?: { isDesktop: boolean; getInfo: () => Promise<AsproDesktopInfo> } }).asproDesktop
    if (bridge?.isDesktop) {
      let alive = true
      bridge
        .getInfo()
        .then((info) => {
          if (alive) setDesktopInfo(info)
        })
        .catch(() => {})
      return () => {
        alive = false
      }
    }
  }, [])

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

  // ===== Desktop & MCP =====
  const isDesktop = !!desktopInfo?.isDesktop

  const mcpConfigSnippet = useMemo(() => {
    if (isDesktop && desktopInfo) {
      // Config pasti — menggunakan runtime bawaan aplikasi (tanpa Node.js)
      return JSON.stringify(
        {
          mcpServers: {
            'aftersales-pro': {
              command: desktopInfo.exePath,
              args: [desktopInfo.mcpServerPath],
              env: {
                ELECTRON_RUN_AS_NODE: '1',
                ASPRO_DB_PATH: desktopInfo.dbPath,
              },
            },
          },
        },
        null,
        2
      )
    }
    // Mode web — template dengan placeholder
    return JSON.stringify(
      {
        mcpServers: {
          'aftersales-pro': {
            command: 'node',
            args: ['C:\\path\\ke\\project\\mcp\\server.mjs'],
            env: { DATABASE_URL: 'file:C:\\path\\ke\\project\\db\\custom.db' },
          },
        },
      },
      null,
      2
    )
  }, [isDesktop, desktopInfo])

  const copyMcpConfig = async () => {
    try {
      await navigator.clipboard.writeText(mcpConfigSnippet)
      toast({ title: 'Config MCP tersalin', description: 'Tempel ke claude_desktop_config.json lalu restart Claude Desktop.' })
    } catch {
      toast({ title: 'Gagal menyalin', description: 'Salin manual dari teks yang ditampilkan.', variant: 'destructive' })
    }
  }

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
        <SettingSection
          sec="profil"
          title="Profil Perusahaan"
          icon={<Building2 className="h-4 w-4 text-emerald-600" />}
          desc="Data ini muncul pada dokumen STTB PDF dan rekap klaim"
          contentClass="space-y-3"
          secOpen={secOpen}
          onToggle={toggleSec}
        >
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
        </SettingSection>

        {/* ===== GATEWAY (WhatsApp & Telegram) ===== */}
        <SettingSection
          sec="gateway"
          title="Gateway — WhatsApp & Telegram"
          icon={<Radio className="h-4 w-4 text-emerald-600" />}
          desc="Channel alternatif laporan toko/teknisi. Konfigurasi disimpan di sini (Pengaturan)."
          contentClass="space-y-4"
          secOpen={secOpen}
          onToggle={toggleSec}
        >
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

            {/* Penampungan Telegram — 2 kantong sesuai konsumen fitur */}
            <div className="space-y-2.5 rounded-lg border border-sky-200 bg-sky-50/50 p-3">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-800">
                <Inbox className="h-3.5 w-3.5 text-sky-600" /> Penampungan Telegram (2 folder)
              </p>
              <p className="text-[11px] leading-relaxed text-slate-500">
                Semua foto/teks dari grup Telegram ditahan di Inbox sebelum menyentuh fitur.
                Webhook memilah otomatis: barcode toko → folder kunjungan, laporan #LAPOR → folder service.
              </p>
              <div className="space-y-1.5">
                <Label htmlFor="gw-inbox-kunj" className="text-xs">Folder kunjungan (Master Data Toko)</Label>
                <Input id="gw-inbox-kunj" value={gw('inbox_folder_kunjungan') || 'upload/telegram-kunjungan'} onChange={(e) => setGwForm({ ...gwForm, inbox_folder_kunjungan: e.target.value })} placeholder="upload/telegram-kunjungan" className="font-mono text-xs" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="gw-inbox-svc" className="text-xs">Folder service request otomatis</Label>
                <Input id="gw-inbox-svc" value={gw('inbox_folder_service') || 'upload/telegram-service'} onChange={(e) => setGwForm({ ...gwForm, inbox_folder_service: e.target.value })} placeholder="upload/telegram-service" className="font-mono text-xs" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Mode penampungan</Label>
                <Select value={gw('inbox_mode') || 'TAHAN'} onValueChange={(v) => setGwForm({ ...gwForm, inbox_mode: v })}>
                  <SelectTrigger aria-label="Mode penampungan"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="TAHAN">TAHAN — review di Inbox dulu (disarankan)</SelectItem>
                    <SelectItem value="OTOMATIS">OTOMATIS — langsung ke fitur</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <Button className="w-full bg-emerald-600 hover:bg-emerald-700" disabled={saveGateway.isPending} onClick={() => saveGateway.mutate()}>
              <Save className="mr-1.5 h-4 w-4" /> Simpan Gateway
            </Button>
        </SettingSection>

        {/* ===== BACKUP GOOGLE SPREADSHEET ===== */}
        <SettingSection
          sec="backup"
          title="Backup Google Spreadsheet"
          icon={<DatabaseBackup className="h-4 w-4 text-teal-600" />}
          desc="Backup otomatis data bersama (toko, customer, sparepart, unit, kunjungan, tiket) ke Google Sheets"
          contentClass="space-y-3"
          secOpen={secOpen}
          onToggle={toggleSec}
        >
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
        </SettingSection>

        {/* ===== DESKTOP WINDOWS & AI (MCP) ===== */}
        <SettingSection
          sec="desktop"
          title="Desktop Windows & AI (MCP)"
          icon={<Monitor className="h-4 w-4 text-emerald-600" />}
          desc="Instalasi desktop (file MSI) & integrasi AI assistant via Model Context Protocol"
          contentClass="space-y-3"
          secOpen={secOpen}
          onToggle={toggleSec}
        >
            <div className="space-y-1.5 rounded-lg border p-3">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-800">
                <Monitor className="h-3.5 w-3.5 text-emerald-600" /> Versi Desktop Windows (MSI)
              </p>
              {isDesktop ? (
                <p className="text-[11px] text-slate-500">
                  Terpasang sebagai aplikasi desktop v{desktopInfo?.version} ({desktopInfo?.platform}). Data tersimpan di <span className="font-mono text-[10px]">{desktopInfo?.dbPath}</span>
                </p>
              ) : (
                <p className="text-[11px] text-slate-500">
                  Installer MSI dibangun otomatis via GitHub Actions (tab <span className="font-medium">Actions → Build Windows Installer</span>) atau di Windows lokal: <span className="font-mono text-[10px]">npm install</span> lalu <span className="font-mono text-[10px]">node scripts/build-desktop.mjs</span>. Panduan lengkap ada di <span className="font-medium">README-DESKTOP.md</span>.
                </p>
              )}
            </div>

            <div className="space-y-2 rounded-lg border p-3">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-800">
                <Bot className="h-3.5 w-3.5 text-teal-600" /> AI Assistant via MCP — 19 tool siap pakai
              </p>
              <p className="text-[11px] text-slate-500">
                Hubungkan Claude Desktop / AI assistant lain ke data aplikasi: ringkasan bisnis, toko, customer, sparepart, unit, check-in kunjungan via barcode toko, kirim notifikasi Gateway (WhatsApp/Telegram), dan backup data bersama.
              </p>
              <div className="flex items-center justify-between gap-2">
                <Badge variant="outline" className="border-emerald-300 text-[10px] text-emerald-700">aftersales-pro · stdio</Badge>
                <Button size="sm" variant="outline" onClick={copyMcpConfig} aria-label="Salin konfigurasi MCP Claude Desktop">
                  <Copy className="mr-1 h-3 w-3" /> Salin Config Claude Desktop
                </Button>
              </div>
              <pre className="max-h-44 overflow-y-auto rounded-md bg-slate-950 p-2.5 font-mono text-[9.5px] leading-relaxed text-slate-100">{mcpConfigSnippet}</pre>
              {isDesktop && desktopInfo?.mcpConfigFile && (
                <p className="flex items-start gap-1 text-[10px] text-teal-700">
                  <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0" />
                  <span>Config siap-pakai (path pasti) sudah ditulis aplikasi: <span className="font-mono">{desktopInfo.mcpConfigFile}</span></span>
                </p>
              )}
            </div>
        </SettingSection>

        {/* Keamanan & backup info */}
        <SettingSection
          sec="keamanan"
          title="Keamanan & Reliabilitas"
          icon={<ShieldCheck className="h-4 w-4 text-teal-600" />}
          desc="Non-Functional Requirements PRD (Section 8)"
          contentClass="space-y-2.5 text-xs"
          secOpen={secOpen}
          onToggle={toggleSec}
        >
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
        </SettingSection>
      </div>

      {/* Audit log */}
      <Card className="lg:col-span-2">
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <ScrollText className="h-4 w-4 text-slate-600" /> Audit Activity Logs
            </CardTitle>
            <CardDescription>Jejak lengkap setiap perubahan data: siapa, kapan, dan apa yang berubah (Modul 6 PRD) · gulir di dalam daftar</CardDescription>
          </div>
          <Badge variant="outline">{filteredLogs.length} entri</Badge>
        </CardHeader>
        <CardContent>
          {logsLoading ? (
            <div className="space-y-2">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
          ) : (
            <ScrollArea className="h-[calc(100vh-340px)] min-h-[240px] pr-3">
              <div className="space-y-2">
                {filteredLogs.map((l) => (
                  <div key={l.id} className="flex items-start gap-3 rounded-lg border p-2 transition hover:bg-slate-50">
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
