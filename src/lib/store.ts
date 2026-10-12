'use client'

import { create } from 'zustand'

export type ViewKey =
  | 'dashboard'
  | 'inbox'
  | 'service'
  | 'gateway'
  | 'field-ops'
  | 'inventory'
  | 'master'
  | 'claim'
  | 'settings'

export type RoleKey = 'ADMIN_WORKSHOP' | 'TEKNISI' | 'MANAGER' | 'PRODUSEN'

/**
 * NavIntent — konteks drill-down saat navigasi antar view (mis. klik KPI Dashboard
 * → view sumber dengan filter otomatis aktif). `ts` memastikan intent identik
 * yang dikirim berulang tetap memicu efek di view tujuan.
 */
export interface NavIntent {
  serviceStatus?: 'REQUEST' | 'PROSES' | 'FINISH' | 'SEMUA'
  serviceGaransi?: 'GARANSI' | 'NON_GARANSI'
  serviceModel?: string
  klaimTab?: 'DRAFT' | 'SUBMITTED' | 'PAID'
  inventoryFilter?: 'kritis' | 'kosong'
  fieldOpsFilter?: 'terlambat' | 'kunjungan'
  ts: number
}

export interface SessionUser {
  id: number
  nama: string
  email: string
  username: string | null
  role: RoleKey
}

interface AppState {
  view: ViewKey
  role: RoleKey
  user: SessionUser | null
  authReady: boolean
  navIntent: NavIntent | null
  setView: (v: ViewKey) => void
  setRole: (r: RoleKey) => void
  setUser: (u: SessionUser | null) => void
  setAuthReady: (b: boolean) => void
  /** Navigasi ke view lain sambil membawa konteks filter (drill-down dashboard). */
  navigateTo: (v: ViewKey, intent?: Omit<NavIntent, 'ts'>) => void
  /** Dipanggil view tujuan setelah intent dikonsumsi agar tidak diterapkan ulang. */
  clearNavIntent: () => void
}

export const useAppStore = create<AppState>((set) => ({
  view: 'dashboard',
  role: 'ADMIN_WORKSHOP',
  user: null,
  authReady: false,
  navIntent: null,
  setView: (view) => set({ view }),
  setRole: (role) => set({ role }),
  setUser: (user) => set({ user, role: user?.role ?? 'ADMIN_WORKSHOP' }),
  setAuthReady: (authReady) => set({ authReady }),
  navigateTo: (view, intent) =>
    set({ view, navIntent: intent ? { ...intent, ts: Date.now() } : null }),
  clearNavIntent: () => set({ navIntent: null }),
}))

export const ROLE_LABELS: Record<RoleKey, string> = {
  ADMIN_WORKSHOP: 'Admin Workshop',
  TEKNISI: 'Teknisi Lapangan',
  MANAGER: 'Management',
  PRODUSEN: 'Produsen',
}
