'use client'

import { create } from 'zustand'

export type ViewKey =
  | 'dashboard'
  | 'service'
  | 'gateway'
  | 'field-ops'
  | 'inventory'
  | 'master'
  | 'claim'
  | 'settings'

export type RoleKey = 'ADMIN_WORKSHOP' | 'TEKNISI' | 'MANAGER' | 'PRODUSEN'

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
  setView: (v: ViewKey) => void
  setRole: (r: RoleKey) => void
  setUser: (u: SessionUser | null) => void
  setAuthReady: (b: boolean) => void
}

export const useAppStore = create<AppState>((set) => ({
  view: 'dashboard',
  role: 'ADMIN_WORKSHOP',
  user: null,
  authReady: false,
  setView: (view) => set({ view }),
  setRole: (role) => set({ role }),
  setUser: (user) => set({ user, role: user?.role ?? 'ADMIN_WORKSHOP' }),
  setAuthReady: (authReady) => set({ authReady }),
}))

export const ROLE_LABELS: Record<RoleKey, string> = {
  ADMIN_WORKSHOP: 'Admin Workshop',
  TEKNISI: 'Teknisi Lapangan',
  MANAGER: 'Management',
  PRODUSEN: 'Produsen',
}
