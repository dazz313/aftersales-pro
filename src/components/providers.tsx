'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { Toaster } from '@/components/ui/toaster'

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Data bisa berubah dari perangkat lain (Telegram, HP teknisi,
            // pengguna lain) tanpa aksi di tab ini. Karena itu:
            // - polling ringan tiap 30 detik agar daftar ikut segar sendiri,
            // - refetch saat tab kembali aktif / jaringan tersambung lagi,
            // - staleTime 0 supaya focus/reconnect tidak menunggu cache basi.
            // Query yang butuh interval lain (chat, backup, dll.) tetap
            // menimpa nilai ini di masing-masing useQuery.
            staleTime: 0,
            refetchOnWindowFocus: true,
            refetchOnReconnect: true,
            refetchInterval: 30_000,
            refetchIntervalInBackground: false,
            retry: 1,
          },
        },
      })
  )
  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <Toaster />
    </QueryClientProvider>
  )
}
