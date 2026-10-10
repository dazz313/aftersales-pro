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

interface AppState {
  view: ViewKey
  role: RoleKey
  setView: (v: ViewKey) => void
  setRole: (r: RoleKey) => void
}

export const useAppStore = create<AppState>((set) => ({
  view: 'dashboard',
  role: 'ADMIN_WORKSHOP',
  setView: (view) => set({ view }),
  setRole: (role) => set({ role }),
}))

export const ROLE_LABELS: Record<RoleKey, string> = {
  ADMIN_WORKSHOP: 'Admin Workshop',
  TEKNISI: 'Teknisi Lapangan',
  MANAGER: 'Management',
  PRODUSEN: 'Produsen',
}
