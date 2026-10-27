'use client'

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  fetcher, postJson, formatWaktu, testGateway, authHeaders,
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
  Mail, Monitor, Bot, Copy, Inbox, ChevronDown, Download, Upload, Clock, ImagePlus, Tags, Trash2, Plus, Bell,
} from 'lucide-react'
import { parseBrandRules, type BrandRule } from '@/lib/brand'
import { cn } from '@/lib/utils'
import QuickSearch, { matchQuery } from '@/components/quick-search'

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

/** Label ramah trigger BackupLog — PERUBAHAN = sinkron cepat perubahan service/unit. */
const TRIGGER_LABEL: Record<string, string> = {
  MANUAL: 'manual',
  AUTO: 'otomatis',
  PERUBAHAN: 'perubahan service/unit',
}

type SecKey = 'profil' | 'merk' | 'gateway' | 'email' | 'ai' | 'backup' | 'desktop' | 'keamanan'

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
  const [aiForm, setAiForm] = useState<Record<string, string>>({})
  const [aiTest, setAiTest] = useState<{ ok: boolean; info: string } | null>(null)
  // Daftar merk & masa garansi (null = ikut data server, belum diedit user)
  const [brandRows, setBrandRows] = useState<BrandRule[] | null>(null)
  const [brandBaru, setBrandBaru] = useState({ nama: '', garansiBulan: '12' })
  const [desktopInfo, setDesktopInfo] = useState<AsproDesktopInfo | null>(null)
  // Section dropdown — default: SEMUA TERTUTUP agar halaman ringkas; buka sesuai kebutuhan
  const [secOpen, setSecOpen] = useState<Record<SecKey, boolean>>({ profil: false, merk: false, gateway: false, email: false, ai: false, backup: false, desktop: false, keamanan: false })
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

  const ai = (k: string) => aiForm[k] ?? settings?.map[k] ?? ''
  const saveAi = useMutation({
    mutationFn: () => postJson('/api/pengaturan', { settings: { ...(settings?.map ?? {}), ...aiForm }, aktor: role }, 'PUT'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pengaturan'] })
      queryClient.invalidateQueries({ queryKey: ['audit'] })
      toast({ title: 'Konfigurasi AI tersimpan', description: 'Suggest AI memakai endpoint & model baru.' })
    },
    onError: (e: Error) => toast({ title: 'Gagal menyimpan AI', description: e.message, variant: 'destructive' }),
  })

  const testAi = useMutation({
    mutationFn: () => postJson<{ ok: boolean; model?: string; keySource?: string | null; ms?: number; reply?: string; error?: string }>('/api/ai/test', {}),
    onSuccess: (res) => {
      setAiTest(res.ok
        ? { ok: true, info: `Tersambung (${res.model}, kunci: ${res.keySource === '9router' ? 'otomatis 9router' : 'pengaturan'}, ${res.ms} ms) — balasan: ${res.reply}` }
        : { ok: false, info: res.error ?? 'Tes gagal' })
    },
    onError: (e: Error) => setAiTest({ ok: false, info: e.message }),
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

  // ===== Email Produsen — order kekurangan sparepart (SMTP + daftar) =====
  const [emailForm, setEmailForm] = useState<Record<string, string>>({})
  const em = (k: string) => emailForm[k] ?? settings?.map[k] ?? ''
  const saveEmail = useMutation({
    mutationFn: () => postJson('/api/pengaturan', { settings: { ...(settings?.map ?? {}), ...emailForm }, aktor: role }, 'PUT'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pengaturan'] })
      queryClient.invalidateQueries({ queryKey: ['audit'] })
      toast({ title: 'Konfigurasi Email Produsen tersimpan', description: 'Dipakai sebagai tujuan email order part yang kurang.' })
    },
    onError: (e: Error) => toast({ title: 'Gagal menyimpan konfigurasi email', description: e.message, variant: 'destructive' }),
  })
  const [emailTest, setEmailTest] = useState<{ ok: boolean; info: string } | null>(null)
  const testEmail = useMutation({
    mutationFn: () => postJson<{ ok: boolean; ke?: string; detail?: string; error?: string }>('/api/order-email/test', { aktor: role }),
    onSuccess: (r) => setEmailTest(r.ok ? { ok: true, info: `Email tes terkirim ke ${r.ke} — cek kotak masuk produsen.` } : { ok: false, info: r.error ?? 'Tes email gagal' }),
    onError: (e: Error) => setEmailTest({ ok: false, info: e.message }),
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

  // ===== Logo perusahaan =====
  const logoInputRef = useRef<HTMLInputElement>(null)
  const [logoTick, setLogoTick] = useState(0)
  const [logoBusy, setLogoBusy] = useState(false)
  const uploadLogo = async (file: File) => {
    setLogoBusy(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/logo', { method: 'POST', headers: authHeaders(), body: fd })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error((err as { error?: string }).error || `Gagal mengunggah logo (${res.status})`)
      }
      setLogoTick(Date.now())
      queryClient.invalidateQueries({ queryKey: ['audit'] })
      toast({ title: 'Logo diperbarui', description: 'Logo tampil di sidebar & halaman login.' })
    } catch (e) {
      toast({ title: 'Upload logo gagal', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setLogoBusy(false)
    }
  }

  // ===== Backup database (file JSON) =====
  const restoreInputRef = useRef<HTMLInputElement>(null)
  const [restoreBusy, setRestoreBusy] = useState(false)
  const downloadDbBackup = async () => {
    try {
      const res = await fetch('/api/backup/db', { headers: authHeaders() })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error((err as { error?: string }).error || `Gagal mengunduh backup (${res.status})`)
      }
      const cd = res.headers.get('content-disposition') ?? ''
      const m = cd.match(/filename="([^"]+)"/)
      const filename = m?.[1] ?? `backup-aspro-${new Date().toISOString().slice(0, 10)}.json`
      const blob = await res.blob()
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(a.href), 5000)
      toast({ title: 'Backup database diunduh', description: `File ${filename} tersimpan. Simpan baik-baik.` })
    } catch (e) {
      toast({ title: 'Unduh backup gagal', description: (e as Error).message, variant: 'destructive' })
    }
  }
  const uploadRestore = async (file: File) => {
    if (!window.confirm('Restore akan MENIMPA seluruh data dengan isi file backup. Lanjutkan?')) return
    setRestoreBusy(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/backup/restore', { method: 'POST', headers: authHeaders(), body: fd })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error((body as { error?: string }).error || `Restore gagal (${res.status})`)
      const total = Object.values((body as { counts?: Record<string, number> }).counts ?? {}).reduce((a, b) => a + (Number(b) || 0), 0)
      toast({ title: 'Restore berhasil', description: `${total} baris dikembalikan. Memuat ulang…` })
      setTimeout(() => window.location.reload(), 1200)
    } catch (e) {
      toast({ title: 'Restore gagal', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setRestoreBusy(false)
    }
  }

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
    kontak_produsen: 'No. WA Produsen (untuk kirim permintaan part)',
    sla_jam_request: 'Batas SLA Request (jam)',
    batas_hari_klaim: 'Batas Hari Klaim (hari)',
  }

  const gw = (k: string) => gwForm[k] ?? settings?.map[k] ?? ''
  const gs = (k: string) => gsForm[k] ?? settings?.map[k] ?? ''
  const brandList: BrandRule[] = brandRows ?? parseBrandRules(settings?.map['brand_daftar'])

  const saveBrand = useMutation({
    mutationFn: (rows: BrandRule[]) =>
      postJson('/api/pengaturan', { settings: { brand_daftar: JSON.stringify(rows) }, aktor: role }, 'PUT'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pengaturan'] })
      queryClient.invalidateQueries({ queryKey: ['audit'] })
      setBrandRows(null)
      toast({ title: 'Daftar merk tersimpan', description: 'Deteksi garansi otomatis memakai masa garansi ini.' })
    },
    onError: (e: Error) => toast({ title: 'Gagal menyimpan merk', description: e.message, variant: 'destructive' }),
  })

  const [cariLog, setCariLog] = useState('')
  const filteredLogs = useMemo(
    () => (logs ?? []).filter((l) => matchQuery([l.aksi, l.entitas, l.entitasId, l.deskripsi, l.aktor], cariLog)),
    [logs, cariLog]
  )

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
            <div className="space-y-1.5">
              <Label className="text-xs">Logo Perusahaan</Label>
              <div className="flex items-center gap-3 rounded-lg border p-3">
                <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-slate-100">
                  <img
                    src={`/api/logo?v=${logoTick}`}
                    alt="Logo perusahaan"
                    className="h-full w-full object-contain"
                    onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
                    onLoad={(e) => { (e.currentTarget as HTMLImageElement).style.display = '' }}
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] text-slate-500">PNG/JPG/WebP/GIF ≤ 2 MB — tampil di sidebar &amp; halaman login.</p>
                  <input
                    ref={logoInputRef}
                    type="file"
                    accept=".png,.jpg,.jpeg,.webp,.gif"
                    className="hidden"
                    aria-label="Pilih file logo"
                    onChange={(e) => {
                      const f = e.target.files?.[0]
                      e.target.value = ''
                      if (f) void uploadLogo(f)
                    }}
                  />
                  <Button size="sm" variant="outline" className="mt-1.5" disabled={logoBusy} onClick={() => logoInputRef.current?.click()}>
                    <ImagePlus className="mr-1 h-3.5 w-3.5" /> {logoBusy ? 'Mengunggah…' : 'Pilih & Unggah Logo'}
                  </Button>
                </div>
              </div>
            </div>
            <Button className="w-full bg-emerald-600 hover:bg-emerald-700" disabled={saveMutation.isPending} onClick={() => saveMutation.mutate()}>
              <Save className="mr-1.5 h-4 w-4" /> Simpan Profil
            </Button>
        </SettingSection>

        {/* ===== MERK & MASA GARANSI ===== */}
        <SettingSection
          sec="merk"
          title="Merk & Masa Garansi"
          icon={<Tags className="h-4 w-4 text-emerald-600" />}
          desc="Daftar merk yang ditangani + masa garansi tiap merk — dipakai deteksi otomatis saat input tanggal pembelian"
          contentClass="space-y-3"
          secOpen={secOpen}
          onToggle={toggleSec}
        >
            <div className="space-y-2">
              {brandList.map((b, i) => (
                <div key={`${b.nama}-${i}`} className="flex items-center gap-2 rounded-lg border p-2">
                  <p className="min-w-0 flex-1 truncate text-xs font-semibold text-slate-800">{b.nama}</p>
                  <Input
                    type="number"
                    min={0}
                    value={String(b.garansiBulan)}
                    onChange={(e) => {
                      const v = Math.max(0, Math.trunc(Number(e.target.value) || 0))
                      setBrandRows(brandList.map((x, j) => (j === i ? { ...x, garansiBulan: v } : x)))
                    }}
                    className="h-7 w-20 text-xs"
                    aria-label={`Masa garansi ${b.nama} (bulan)`}
                  />
                  <span className="text-[10px] text-slate-500">bln</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-slate-400 hover:text-rose-600"
                    aria-label={`Hapus merk ${b.nama}`}
                    onClick={() => setBrandRows(brandList.filter((_, j) => j !== i))}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
              {brandList.length === 0 && (
                <p className="rounded-lg border border-dashed p-4 text-center text-xs text-slate-500">Belum ada merk — tambahkan di bawah.</p>
              )}
            </div>
            <div className="flex gap-2">
              <Input
                value={brandBaru.nama}
                onChange={(e) => setBrandBaru({ ...brandBaru, nama: e.target.value })}
                placeholder="Nama merk baru…"
                className="h-8 flex-1 text-xs"
                aria-label="Nama merk baru"
              />
              <Input
                type="number"
                min={0}
                value={brandBaru.garansiBulan}
                onChange={(e) => setBrandBaru({ ...brandBaru, garansiBulan: e.target.value })}
                className="h-8 w-20 text-xs"
                aria-label="Masa garansi merk baru (bulan)"
              />
              <Button
                size="sm"
                variant="outline"
                className="h-8 shrink-0"
                disabled={!brandBaru.nama.trim()}
                onClick={() => {
                  const nama = brandBaru.nama.trim()
                  if (brandList.some((x) => x.nama.toLowerCase() === nama.toLowerCase())) {
                    toast({ title: 'Merk sudah ada', description: `"${nama}" sudah terdaftar.`, variant: 'destructive' })
                    return
                  }
                  setBrandRows([...brandList, { nama, garansiBulan: Math.max(0, Math.trunc(Number(brandBaru.garansiBulan) || 0)) }])
                  setBrandBaru({ nama: '', garansiBulan: '12' })
                }}
              >
                <Plus className="mr-1 h-3.5 w-3.5" /> Tambah
              </Button>
            </div>
            <Button className="w-full bg-emerald-600 hover:bg-emerald-700" disabled={saveBrand.isPending} onClick={() => saveBrand.mutate(brandList)}>
              <Save className="mr-1.5 h-4 w-4" /> Simpan Merk &amp; Garansi
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

            {/* Notifikasi keluar aplikasi (grup WA/Telegram) */}
            <div className="space-y-2.5 rounded-lg border border-emerald-200 bg-emerald-50/40 p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-800">
                  <Bell className="h-3.5 w-3.5 text-emerald-600" /> Kirim notifikasi ke grup
                </p>
                <Switch
                  checked={gw('notifikasi_gateway_aktif') === 'true'}
                  onCheckedChange={(v) => setGwForm({ ...gwForm, notifikasi_gateway_aktif: String(v) })}
                  aria-label="Aktifkan pengiriman notifikasi ke grup"
                />
              </div>
              <p className="text-[11px] leading-relaxed text-slate-500">
                Master switch. Bila mati, notifikasi tetap muncul di lonceng dalam aplikasi, tapi tidak
                dikirim ke WhatsApp/Telegram. Bila menyala, pesan dikirim ke channel default di atas.
              </p>
              <div className="space-y-2">
                {(
                  [
                    ['notifikasi_registrasi_gateway', 'Registrasi unit baru'],
                    ['notifikasi_produsen_gateway', 'Permintaan sparepart ke Produsen'],
                    ['notifikasi_alert_gateway', 'Ringkasan alert harian'],
                  ] as [string, string][]
                ).map(([key, label]) => (
                  <div key={key} className="flex items-center justify-between gap-2">
                    <Label htmlFor={key} className="text-xs font-normal">{label}</Label>
                    <Switch
                      id={key}
                      checked={gw('notifikasi_gateway_aktif') !== 'true' ? false : gw(key) !== 'false'}
                      onCheckedChange={(v) => setGwForm({ ...gwForm, [key]: String(v) })}
                      aria-label={label}
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* Notifikasi lonceng in-app — ringkasan alert harian (default MATI) */}
            <div className="space-y-2.5 rounded-lg border border-amber-200 bg-amber-50/40 p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-800">
                  <Bell className="h-3.5 w-3.5 text-amber-600" /> Ringkasan alert di lonceng (dalam aplikasi)
                </p>
                <Switch
                  checked={gw('alert_lonceng_aktif') === 'true'}
                  onCheckedChange={(v) => setGwForm({ ...gwForm, alert_lonceng_aktif: String(v) })}
                  aria-label="Tampilkan ringkasan alert harian di lonceng"
                />
              </div>
              <p className="text-[11px] leading-relaxed text-slate-500">
                Default mati: ringkasan alert harian tetap dievaluasi & dikirim ke grup (bila
                sakelar grup di atas menyala), tapi TIDAK memunculkan notifikasi/toast di lonceng
                — ringkasan menghitung semua part stok-rendah & toko lewat jadwal, jadi tiap hari
                pasti berbunyi. Nyalakan bila ringkasan juga ingin tampil di lonceng.
              </p>
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

        {/* ===== EMAIL PRODUSEN — KONFIGURASI UNTUK ORDER PART YANG KURANG ===== */}
        <SettingSection
          sec="email"
          title="Email Produsen (Kekurangan Sparepart)"
          icon={<Mail className="h-4 w-4 text-sky-600" />}
          desc="Isi tujuan + akun pengirim untuk email order part yang kurang. Dokumen lampirannya dibuat dari Master Data → Unit Asset → tombol Aksi → PDF Detail Unit."
          contentClass="space-y-3"
          secOpen={secOpen}
          onToggle={toggleSec}
        >
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="em-tujuan" className="text-xs">Email Produsen (tujuan)</Label>
                <Input id="em-tujuan" type="email" value={em('email_produsen')} onChange={(e) => setEmailForm({ ...emailForm, email_produsen: e.target.value })} placeholder="produsen@pabrik.co.id" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="em-dari" className="text-xs">Pengirim (SMTP Dari)</Label>
                <Input id="em-dari" type="email" value={em('smtp_dari')} onChange={(e) => setEmailForm({ ...emailForm, smtp_dari: e.target.value })} placeholder="Workshop <noreply@workshop.co.id>" />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="em-wa" className="text-xs">Nomor WA Produsen (opsional — draf wa.me bila gateway belum aktif)</Label>
                <Input id="em-wa" type="tel" value={em('wa_produsen')} onChange={(e) => setEmailForm({ ...emailForm, wa_produsen: e.target.value })} placeholder="62812xxxxxxxxx / 0812xxxxxxxxx" className="font-mono" />
                <p className="text-[11px] text-slate-500">Dipakai tombol ⬤ WA Order di Proses Service saat gateway WhatsApp belum dicek: draf pesan order terbuka di WhatsApp produsen. Fallback berikutnya: No. WA Produsen / kontak profil.</p>
              </div>
            </div>
            <div className="space-y-2 rounded-lg border border-sky-200 bg-sky-50/50 p-3">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-800">
                <Send className="h-3.5 w-3.5 text-sky-600" /> Akun Pengirim SMTP (opsional — agar kirim otomatis)
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="em-host" className="text-xs">SMTP Host</Label>
                  <Input id="em-host" value={em('smtp_host')} onChange={(e) => setEmailForm({ ...emailForm, smtp_host: e.target.value })} placeholder="smtp.gmail.com" className="font-mono text-xs" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="em-port" className="text-xs">Port</Label>
                  <Input id="em-port" type="number" value={em('smtp_port')} onChange={(e) => setEmailForm({ ...emailForm, smtp_port: e.target.value })} placeholder="587" className="font-mono text-xs" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="em-user" className="text-xs">SMTP User</Label>
                  <Input id="em-user" value={em('smtp_user')} onChange={(e) => setEmailForm({ ...emailForm, smtp_user: e.target.value })} placeholder="user@workshop.co.id" className="font-mono text-xs" autoComplete="off" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="em-pass" className="text-xs">SMTP Password / App Password</Label>
                  <Input id="em-pass" type="password" value={em('smtp_password')} onChange={(e) => setEmailForm({ ...emailForm, smtp_password: e.target.value })} placeholder="••••••••" autoComplete="new-password" />
                </div>
              </div>
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] text-slate-500">SSL/TLS implisit (mis. port 465) → aktifkan. Port 587 biasanya cukup nonaktif (STARTTLS).</p>
                <div className="flex shrink-0 items-center gap-2">
                  <Switch id="em-secure" checked={(em('smtp_secure') || (em('smtp_port') === '465' ? '1' : '')) === '1'} onCheckedChange={(v) => setEmailForm({ ...emailForm, smtp_secure: String(v) })} />
                  <Label htmlFor="em-secure" className="text-xs font-normal">SSL/TLS langsung</Label>
                </div>
              </div>
              <p className="text-[11px] text-slate-500">Email + PDF detail unit dikirim manual dari aplikasi email Anda; SMTP dipakai untuk uji kirim konfigurasi.</p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" disabled={testEmail.isPending} onClick={() => testEmail.mutate()}>
                <Send className="mr-1 h-3 w-3" /> {testEmail.isPending ? 'Mengirim tes…' : 'Uji Kirim Email'}
              </Button>
              <Button className="flex-1 bg-emerald-600 hover:bg-emerald-700" disabled={saveEmail.isPending} onClick={() => saveEmail.mutate()}>
                <Save className="mr-1.5 h-4 w-4" /> Simpan Email
              </Button>
            </div>
            {emailTest && (
              <p className={cn('rounded-md p-2 text-[11px]', emailTest.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-700')}>
                {emailTest.info}
              </p>
            )}
        </SettingSection>

        <SettingSection
          sec="ai"
          title="AI Suggest — 9router"
          icon={<Bot className="h-4 w-4 text-violet-600" />}
          desc="Saran jadwal kunjungan AI via gateway 9router lokal (OpenAI-compatible)."
          contentClass="space-y-3"
          secOpen={secOpen}
          onToggle={toggleSec}
        >
            <div className="space-y-1.5">
              <Label htmlFor="ai-base" className="text-xs">Base URL gateway</Label>
              <Input id="ai-base" value={ai('ai_base_url') || 'http://localhost:20128/v1'} onChange={(e) => setAiForm({ ...aiForm, ai_base_url: e.target.value })} placeholder="http://localhost:20128/v1" className="font-mono text-xs" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ai-key" className="text-xs">API Key <span className="font-normal text-slate-400">(kosongkan = otomatis dari 9router lokal)</span></Label>
              <Input id="ai-key" type="password" value={ai('ai_api_key')} onChange={(e) => setAiForm({ ...aiForm, ai_api_key: e.target.value })} placeholder="sk-… (atau kosongkan)" className="font-mono text-xs" autoComplete="off" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ai-model" className="text-xs">Model</Label>
              <Input id="ai-model" value={ai('ai_model') || 'kr/claude-haiku-4.5'} onChange={(e) => setAiForm({ ...aiForm, ai_model: e.target.value })} placeholder="kr/claude-haiku-4.5" className="font-mono text-xs" />
              <p className="text-[11px] text-slate-500">Format <span className="font-mono">provider/model</span> sesuai 9router — cth: <span className="font-mono">kr/claude-haiku-4.5</span>. Lihat daftar di dashboard 9router (http://localhost:20128).</p>
            </div>
            {aiTest && (
              <p className={cn('rounded-md p-2 text-[11px]', aiTest.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-700')}>
                {aiTest.info}
              </p>
            )}
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" disabled={testAi.isPending} onClick={() => testAi.mutate()}>
                <Send className="mr-1 h-3 w-3" /> {testAi.isPending ? 'Mengetes…' : 'Tes Koneksi'}
              </Button>
              <Button className="flex-1 bg-emerald-600 hover:bg-emerald-700" disabled={saveAi.isPending} onClick={() => saveAi.mutate()}>
                <Save className="mr-1.5 h-4 w-4" /> Simpan AI
              </Button>
            </div>
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
              <Label htmlFor="gs-id" className="text-xs">Spreadsheet ID atau URL utuh spreadsheet</Label>
              <Input id="gs-id" value={gs('gs_spreadsheet_id')} onChange={(e) => setGsForm({ ...gsForm, gs_spreadsheet_id: e.target.value })} placeholder="1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms" className="font-mono text-xs" />
              {/* Tempel URL utuh diperkenankan — ID diambil otomatis saat disimpan */}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="gs-email" className="text-xs">Service Account Email</Label>
              <Input id="gs-email" value={gs('gs_service_email')} onChange={(e) => setGsForm({ ...gsForm, gs_service_email: e.target.value })} placeholder="backup@project.iam.gserviceaccount.com" className="font-mono text-xs" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="gs-key" className="text-xs">Private Key (PEM)</Label>
              <Textarea id="gs-key" value={gs('gs_private_key')} onChange={(e) => setGsForm({ ...gsForm, gs_private_key: e.target.value })} placeholder="-----BEGIN PRIVATE KEY-----\nMIIEvQ...\n-----END PRIVATE KEY-----" className="font-mono text-[10px]" rows={3} />
            </div>

            {/* Checklist kesiapan kredensial — tunjukkan persis mana yang masih kosong */}
            {backupStatus && (
              <div className="space-y-2 rounded-lg border bg-slate-50/60 p-3">
                <p className="text-xs font-semibold text-slate-800">Kesiapan kredensial sinkron ke Google</p>
                <ul className="space-y-1">
                  {(
                    [
                      { label: 'Spreadsheet ID', ok: backupStatus.config.terisi.spreadsheetId },
                      { label: 'Service Account Email', ok: backupStatus.config.terisi.serviceEmail },
                      { label: 'Private Key', ok: backupStatus.config.terisi.privateKey },
                    ] as const
                  ).map((c) => (
                    <li key={c.label} className="flex items-center gap-1.5 text-[11px]">
                      {c.ok ? (
                        <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                      ) : (
                        <XCircle className="h-3.5 w-3.5 shrink-0 text-rose-500" />
                      )}
                      <span className={cn('font-medium', c.ok ? 'text-slate-700' : 'text-rose-600')}>
                        {c.label} {c.ok ? 'terisi' : 'BELUM diisi'}
                      </span>
                    </li>
                  ))}
                </ul>
                {!backupStatus.config.terkonfigurasi && (
                  <p className="flex items-start gap-1.5 rounded-md bg-amber-50 px-2 py-1.5 text-[10px] leading-relaxed text-amber-700">
                    <CircleAlert className="mt-0.5 h-3 w-3 shrink-0" />
                    <span>
                      Selama salah satu kolom di atas kosong, data TIDAK masuk ke Google — hanya disimpan
                      sebagai snapshot JSON lokal (status LOCAL). Lengkapi ketiganya agar sinkron ke spreadsheet.
                    </span>
                  </p>
                )}
                <details className="group">
                  <summary className="cursor-pointer text-[11px] font-semibold text-teal-700 hover:underline">
                    Cara membuat service account Google (sekali saja)…
                  </summary>
                  <ol className="mt-1.5 list-decimal space-y-1 pl-4 text-[10px] leading-relaxed text-slate-600">
                    <li>Buka <span className="font-mono">console.cloud.google.com</span> → pilih/buat project.</li>
                    <li>Menu <b>APIs &amp; Services → Library</b> → cari &amp; aktifkan <b>Google Sheets API</b>.</li>
                    <li>Menu <b>IAM &amp; Admin → Service Accounts</b> → <b>Create</b> (role boleh kosong) → buka akun tersebut → tab <b>Keys</b> → <b>Add Key → JSON</b> → unduh file.</li>
                    <li>Dari file JSON: salin nilai <span className="font-mono">client_email</span> ke kolom <b>Service Account Email</b>, dan <span className="font-mono">private_key</span> (yang berisi BEGIN/END PRIVATE KEY) ke kolom <b>Private Key</b>.</li>
                    <li>Buka spreadsheet Anda → tombol <b>Share</b> → tambahkan email service account tersebut sebagai <b>Editor</b>.</li>
                    <li>Kembali ke sini → <b>Simpan</b> → <b>Backup Sekarang</b>. Status berubah jadi <b>GOOGLE SHEETS</b> bila berhasil.</li>
                  </ol>
                </details>
              </div>
            )}
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
                      <span className="text-slate-500">{TRIGGER_LABEL[l.trigger] ?? l.trigger} · {l.rowsTotal} baris</span>
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

            {/* Jadwal backup harian otomatis */}
            <div className="space-y-3 rounded-lg border border-teal-200 bg-teal-50/50 p-3">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-800">
                <Clock className="h-3.5 w-3.5 text-teal-600" /> Jadwal Backup Harian Otomatis
              </p>
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] text-slate-500">Jalan tiap hari di jam berikut (server harus hidup)</p>
                <Switch
                  checked={gs('gs_jadwal_aktif') === 'true'}
                  onCheckedChange={(v) => setGsForm({ ...gsForm, gs_jadwal_aktif: String(v) })}
                  aria-label="Aktifkan jadwal backup harian"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="gs-jadwal-jam" className="text-xs">Jam backup (HH:MM)</Label>
                <Input id="gs-jadwal-jam" type="time" value={gs('gs_jadwal_jam') || '02:00'} onChange={(e) => setGsForm({ ...gsForm, gs_jadwal_jam: e.target.value })} className="font-mono text-xs" />
              </div>
              {backupStatus?.jadwal && (
                <p className="text-[11px] text-slate-500">
                  {backupStatus.jadwal.aktif
                    ? `Aktif tiap hari pk. ${backupStatus.jadwal.jam}${backupStatus.jadwal.terakhir ? ` · terakhir jalan ${backupStatus.jadwal.terakhir}` : ' · belum pernah jalan'}`
                    : 'Nonaktif — aktifkan + Simpan untuk menjadwalkan.'}
                </p>
              )}
            </div>

            {/* Backup & restore database (file) */}
            <div className="space-y-2.5 rounded-lg border p-3">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-800">
                <DatabaseBackup className="h-3.5 w-3.5 text-slate-600" /> Backup &amp; Restore Database (File)
              </p>
              <p className="text-[11px] leading-relaxed text-slate-500">
                Unduh seluruh database sebagai file JSON. Restore menimpa SEMUA data — hanya dipakai saat darurat/pindah perangkat.
              </p>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" className="flex-1" onClick={() => void downloadDbBackup()}>
                  <Download className="mr-1 h-3.5 w-3.5" /> Unduh Backup
                </Button>
                <input
                  ref={restoreInputRef}
                  type="file"
                  accept=".json,application/json"
                  className="hidden"
                  aria-label="Pilih file backup untuk restore"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    e.target.value = ''
                    if (f) void uploadRestore(f)
                  }}
                />
                <Button size="sm" variant="outline" className="flex-1 border-rose-300 text-rose-700 hover:bg-rose-50" disabled={restoreBusy} onClick={() => restoreInputRef.current?.click()}>
                  <Upload className="mr-1 h-3.5 w-3.5" /> {restoreBusy ? 'Me-restore…' : 'Restore…'}
                </Button>
              </div>
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
          <div className="mb-3">
            <QuickSearch value={cariLog} onChange={setCariLog} placeholder="Cari aksi / deskripsi / aktor…" resultCount={filteredLogs.length} />
          </div>
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
