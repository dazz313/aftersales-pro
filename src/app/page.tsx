'use client'

import { useEffect, useState } from 'react'
import { useAppStore, ROLE_LABELS, type RoleKey, type ViewKey } from '@/lib/store'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from '@/components/ui/sheet'
import {
  LayoutDashboard,
  Inbox,
  Wrench,
  Radio,
  MapPin,
  Package,
  Database,
  FileSpreadsheet,
  Settings2,
  Menu,
  WrenchIcon,
  LogOut,
  ChevronDown,
  Loader2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { authHeaders, clearSessionToken, fetcher } from '@/lib/api'
import { useQuery } from '@tanstack/react-query'
import DashboardView from '@/components/views/dashboard-view'
import InboxView from '@/components/views/inbox-view'
import ServiceView from '@/components/views/service-view'
import GatewayView from '@/components/views/gateway-view'
import FieldOpsView from '@/components/views/field-ops-view'
import InventoryView from '@/components/views/inventory-view'
import MasterDataView from '@/components/views/master-data-view'
import ClaimView from '@/components/views/claim-view'
import SettingsView from '@/components/views/settings-view'
import AutoBackupWatcher from '@/components/auto-backup-watcher'
import QuickActions from '@/components/quick-entry'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

const NAV_ITEMS: { key: ViewKey; label: string; icon: React.ComponentType<{ className?: string }>; desc: string }[] = [
  { key: 'dashboard', label: 'Dashboard KPI', icon: LayoutDashboard, desc: 'Monitoring & Alert Engine' },
  { key: 'inbox', label: 'Inbox', icon: Inbox, desc: 'Penampungan data Telegram' },
  { key: 'gateway', label: 'Gateway', icon: Radio, desc: 'Bot WhatsApp & Telegram' },
  { key: 'service', label: 'Service Tiket', icon: Wrench, desc: 'Workflow REQUEST → PROSES → FINISH' },
  { key: 'field-ops', label: 'Field Ops', icon: MapPin, desc: 'Kunjungan toko & scan barcode' },
  { key: 'inventory', label: 'Stok Inventory', icon: Package, desc: 'Sparepart titipan produsen' },
  { key: 'master', label: 'Master Data', icon: Database, desc: 'Toko, Customer, Unit, Karyawan' },
  { key: 'claim', label: 'Klaim & Rekap', icon: FileSpreadsheet, desc: 'Klaim produsen & export Excel' },
  { key: 'settings', label: 'Pengaturan', icon: Settings2, desc: 'Profil, Gateway, Backup & audit log' },
]

const ROLE_COLORS: Record<RoleKey, string> = {
  ADMIN_WORKSHOP: 'bg-emerald-500',
  TEKNISI: 'bg-amber-500',
  MANAGER: 'bg-violet-500',
  PRODUSEN: 'bg-teal-500',
}

function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('')
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { view, setView, user } = useAppStore()
  const { data: inboxCount } = useQuery({
    queryKey: ['inbox-pending-count'],
    queryFn: () => fetcher<{ items: unknown[]; pending: number }>('/api/inbox?status=PENDING'),
    refetchInterval: 30_000,
  })
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 px-5 py-5 border-b border-slate-800">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500 text-white">
          <WrenchIcon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-white leading-tight">AfterSales Pro</p>
          <p className="truncate text-xs text-slate-400">Workshop × Produsen</p>
        </div>
      </div>
      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4" aria-label="Navigasi utama">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon
          const active = view === item.key
          return (
            <button
              key={item.key}
              onClick={() => {
                setView(item.key)
                onNavigate?.()
              }}
              className={cn(
                'group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors',
                active ? 'bg-emerald-500/15 text-emerald-300' : 'text-slate-300 hover:bg-slate-800 hover:text-white'
              )}
              aria-current={active ? 'page' : undefined}
            >
              <Icon className={cn('h-4.5 w-4.5 shrink-0', active ? 'text-emerald-400' : 'text-slate-400 group-hover:text-white')} />
              <span className="min-w-0">
                <span className="block text-sm font-medium leading-tight">{item.label}</span>
                <span className="block truncate text-xs text-slate-500 leading-tight">{item.desc}</span>
              </span>
              {item.key === 'inbox' && (inboxCount?.pending ?? 0) > 0 && (
                <span className="ml-auto rounded-full bg-rose-500 px-2 py-0.5 text-[10px] font-bold text-white">
                  {inboxCount!.pending}
                </span>
              )}
            </button>
          )
        })}
      </nav>
      <div className="border-t border-slate-800 px-5 py-4">
        {user && (
          <p className="mb-1.5 truncate text-xs text-slate-400">
            Login sebagai <span className="font-medium text-slate-200">{user.nama}</span>
          </p>
        )}
        <p className="text-xs text-slate-500">Sesuai PRD: Otomasi after-sales, STTB QR, inventory, klaim Excel.</p>
      </div>
    </div>
  )
}

export default function Home() {
  const [open, setOpen] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)
  const { view, role, user, authReady, setUser, setAuthReady } = useAppStore()
  const current = NAV_ITEMS.find((n) => n.key === view)

  // Verifikasi sesi saat aplikasi dibuka — pakai cookie ATAU fallback Bearer
  // (localStorage); tanpa sesi valid, client gate me-redirect ke /login.
  useEffect(() => {
    let cancelled = false
    fetch('/api/auth/me', { headers: authHeaders() })
      .then((r) => {
        if (!r.ok) throw new Error('unauthenticated')
        return r.json()
      })
      .then((u) => {
        if (cancelled) return
        setUser(u)
        setAuthReady(true)
      })
      .catch(() => {
        if (!cancelled) {
          clearSessionToken()
          window.location.replace('/login')
        }
      })
    return () => {
      cancelled = true
    }
  }, [setUser, setAuthReady])

  async function handleLogout() {
    if (loggingOut) return
    setLoggingOut(true)
    try {
      await fetch('/api/auth/logout', { method: 'POST', headers: authHeaders() })
    } catch {
      // tetap redirect walau request gagal
    }
    clearSessionToken()
    window.location.replace('/login')
  }

  // Gate: tampilkan layar loading sampai sesi terverifikasi
  if (!authReady) {
    return (
      <div className="flex min-h-screen w-full flex-col items-center justify-center gap-3 bg-slate-900">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500 text-white">
          <WrenchIcon className="h-6 w-6" />
        </div>
        <div className="flex items-center gap-2 text-sm text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" /> Memeriksa sesi…
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen w-full bg-slate-100">
      {/* Backup otomatis ke Google Spreadsheet (berjalan di background) */}
      <AutoBackupWatcher />
      {/* Sidebar desktop */}
      <aside className="sticky top-0 hidden h-screen w-72 shrink-0 bg-slate-900 lg:block">
        <SidebarContent />
      </aside>

      {/* Sidebar mobile */}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button
            variant="outline"
            size="icon"
            className="fixed left-4 top-4 z-40 lg:hidden bg-slate-900 text-white border-slate-700"
            aria-label="Buka menu navigasi"
          >
            <Menu className="h-5 w-5" />
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="w-72 bg-slate-900 p-0 border-slate-800">
          <SheetTitle className="sr-only">Menu Navigasi</SheetTitle>
          <SidebarContent onNavigate={() => setOpen(false)} />
        </SheetContent>
      </Sheet>

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Header */}
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-3 border-b bg-white/90 backdrop-blur px-4 pl-16 lg:pl-6">
          <div className="min-w-0">
            <h1 className="truncate text-base font-bold text-slate-900 sm:text-lg">{current?.label}</h1>
            <p className="hidden truncate text-xs text-slate-500 sm:block">{current?.desc}</p>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            {/* Chip user + menu Keluar (Log Out) */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    'flex items-center gap-2.5 rounded-full border border-slate-200 bg-slate-50 py-1 pl-1 pr-2.5 transition-colors hover:bg-slate-100',
                    loggingOut && 'opacity-60'
                  )}
                  aria-label="Menu akun pengguna"
                >
                  <span
                    className={cn(
                      'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white',
                      ROLE_COLORS[role]
                    )}
                  >
                    {user ? getInitials(user.nama) : '?'}
                  </span>
                  <span className="hidden flex-col items-start leading-tight sm:flex">
                    <span className="max-w-[140px] truncate text-xs font-semibold text-slate-800">{user?.nama}</span>
                    <span className="text-[10px] text-slate-500">{ROLE_LABELS[role]}</span>
                  </span>
                  <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuLabel className="font-normal">
                  <p className="text-sm font-semibold text-slate-900">{user?.nama}</p>
                  <p className="truncate text-xs text-slate-500">{user?.email}</p>
                  <span
                    className={cn(
                      'mt-1.5 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium text-white',
                      ROLE_COLORS[role]
                    )}
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-white/80" />
                    {ROLE_LABELS[role]}
                  </span>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={handleLogout}
                  disabled={loggingOut}
                  className="text-red-600 focus:bg-red-50 focus:text-red-700"
                  aria-label="Keluar dari akun"
                >
                  {loggingOut ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
                  Keluar (Log Out)
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 p-4 sm:p-6 pb-10">
          {view === 'dashboard' && (
            <div className="space-y-4">
              <QuickActions />
              <DashboardView />
            </div>
          )}
          {view === 'inbox' && <InboxView />}
          {view === 'service' && <ServiceView />}
          {view === 'gateway' && <GatewayView />}
          {view === 'field-ops' && <FieldOpsView />}
          {view === 'inventory' && <InventoryView />}
          {view === 'master' && <MasterDataView />}
          {view === 'claim' && <ClaimView />}
          {view === 'settings' && <SettingsView />}
        </main>

        {/* Sticky footer */}
        <footer className="mt-auto border-t bg-white px-6 py-4 text-center text-xs text-slate-500 pb-[max(1rem,env(safe-area-inset-bottom))]">
          AfterSales Pro — Sistem Otomasi After-Sales Operations & Inventory Management · Workshop × Produsen (Inventory)
        </footer>
      </div>
    </div>
  )
}
