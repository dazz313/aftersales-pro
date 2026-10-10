'use client'

import { useState } from 'react'
import { useAppStore, type ViewKey, ROLE_LABELS, type RoleKey } from '@/lib/store'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from '@/components/ui/sheet'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  LayoutDashboard,
  Wrench,
  MessageSquareText,
  MapPin,
  Package,
  Database,
  FileSpreadsheet,
  Settings2,
  Menu,
  WrenchIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import DashboardView from '@/components/views/dashboard-view'
import ServiceView from '@/components/views/service-view'
import WaBotView from '@/components/views/wa-bot-view'
import FieldOpsView from '@/components/views/field-ops-view'
import InventoryView from '@/components/views/inventory-view'
import MasterDataView from '@/components/views/master-data-view'
import ClaimView from '@/components/views/claim-view'
import SettingsView from '@/components/views/settings-view'

const NAV_ITEMS: { key: ViewKey; label: string; icon: React.ComponentType<{ className?: string }>; desc: string }[] = [
  { key: 'dashboard', label: 'Dashboard KPI', icon: LayoutDashboard, desc: 'Monitoring & Alert Engine' },
  { key: 'wa-bot', label: 'WA Bot Gateway', icon: MessageSquareText, desc: 'Laporan kerusakan via WhatsApp' },
  { key: 'service', label: 'Service Tiket', icon: Wrench, desc: 'Workflow REQUEST → PROSES → FINISH' },
  { key: 'field-ops', label: 'Field Ops', icon: MapPin, desc: 'Kunjungan toko & scan barcode' },
  { key: 'inventory', label: 'Stok Konsinyasi', icon: Package, desc: 'Sparepart titipan produsen' },
  { key: 'master', label: 'Master Data', icon: Database, desc: 'Toko, Customer, Unit, Karyawan' },
  { key: 'claim', label: 'Klaim & Rekap', icon: FileSpreadsheet, desc: 'Klaim produsen & export Excel' },
  { key: 'settings', label: 'Pengaturan', icon: Settings2, desc: 'Profil perusahaan & audit log' },
]

const ROLE_COLORS: Record<RoleKey, string> = {
  ADMIN_WORKSHOP: 'bg-emerald-500',
  TEKNISI: 'bg-amber-500',
  MANAGER: 'bg-violet-500',
  PRODUSEN: 'bg-teal-500',
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { view, setView } = useAppStore()
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
            </button>
          )
        })}
      </nav>
      <div className="border-t border-slate-800 px-5 py-4">
        <p className="text-xs text-slate-500">Sesuai PRD: Otomasi after-sales, STTB QR, konsinyasi, klaim Excel.</p>
      </div>
    </div>
  )
}

export default function Home() {
  const [open, setOpen] = useState(false)
  const { view, role, setRole } = useAppStore()
  const current = NAV_ITEMS.find((n) => n.key === view)

  return (
    <div className="flex min-h-screen w-full bg-slate-100">
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
            <span className="hidden text-xs text-slate-500 md:block">Akses sebagai:</span>
            <Select value={role} onValueChange={(v) => setRole(v as RoleKey)}>
              <SelectTrigger className="w-[150px] sm:w-[190px] bg-slate-50" aria-label="Pilih peran pengguna">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(ROLE_LABELS) as RoleKey[]).map((r) => (
                  <SelectItem key={r} value={r}>
                    <span className="flex items-center gap-2">
                      <span className={cn('h-2 w-2 rounded-full', ROLE_COLORS[r])} />
                      {ROLE_LABELS[r]}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 p-4 sm:p-6 pb-10">
          {view === 'dashboard' && <DashboardView />}
          {view === 'service' && <ServiceView />}
          {view === 'wa-bot' && <WaBotView />}
          {view === 'field-ops' && <FieldOpsView />}
          {view === 'inventory' && <InventoryView />}
          {view === 'master' && <MasterDataView />}
          {view === 'claim' && <ClaimView />}
          {view === 'settings' && <SettingsView />}
        </main>

        {/* Sticky footer */}
        <footer className="mt-auto border-t bg-white px-6 py-4 text-center text-xs text-slate-500 pb-[max(1rem,env(safe-area-inset-bottom))]">
          AfterSales Pro — Sistem Otomasi After-Sales Operations & Inventory Management · Workshop × Produsen (Konsinyasi)
        </footer>
      </div>
    </div>
  )
}
