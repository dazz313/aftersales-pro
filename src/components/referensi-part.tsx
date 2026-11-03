'use client'

import { useEffect, useRef, useState } from 'react'
import { BookMarked, Loader2, PackageCheck, TrendingUp } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { authHeaders } from '@/lib/api'
import { cn } from '@/lib/utils'
import type { ReferensiPart } from '@/lib/bank-kode'

/**
 * ReferensiPart — cek kesamaan otomatis saat kode/nama part sudah cukup lengkap.
 *
 * Pengguna mengetik kode (≥4 karakter) atau nama (≥3 karakter); setelah jeda
 * singkat sistem memanggil /api/bank-kode/referensi dan menampilkan kode/nama
 * yang pernah ada beserta sumber, stok, dan jumlah pemakaian. Klik satu baris
 * untuk memakai kode + nama itu. Bila ada TEPAT satu kecocokan 100%, field
 * yang masih kosong diisi otomatis lewat `onCocokPersis`.
 */
interface ReferensiPartProps {
  kode?: string
  nama?: string
  onPilih: (item: ReferensiPart) => void
  /** Dipanggil saat ada tepat satu kecocokan persis (skor 100). */
  onCocokPersis?: (item: ReferensiPart) => void
  /** Batasi jumlah baris yang ditampilkan (default 4). */
  tampil?: number
  className?: string
}

export default function ReferensiPart({ kode = '', nama = '', onPilih, onCocokPersis, tampil = 4, className }: ReferensiPartProps) {
  // Hasil disimpan bersama kunci query — mencegah referensi lama tampil saat
  // pengguna sudah mengganti kode/nama (tanpa setState sinkron di effect).
  const [hasil, setHasil] = useState<{ kunci: string; items: ReferensiPart[] } | null>(null)
  const [loadingKunci, setLoadingKunci] = useState<string | null>(null)
  const urut = useRef(0)
  const pilihRef = useRef(onPilih)
  const persisRef = useRef(onCocokPersis)
  useEffect(() => {
    pilihRef.current = onPilih
    persisRef.current = onCocokPersis
  }, [onPilih, onCocokPersis])

  const kodeQ = kode.trim()
  const namaQ = nama.trim()
  const kodeCukup = kodeQ.replace(/[^A-Za-z0-9]/g, '').length >= 4
  const namaCukup = namaQ.length >= 3
  const kunci = `${kodeQ}\u0000${namaQ}`
  const aktif = kodeCukup || namaCukup

  useEffect(() => {
    if (!aktif) return
    const t = setTimeout(async () => {
      const seq = ++urut.current
      setLoadingKunci(kunci)
      try {
        const res = await fetch(
          `/api/bank-kode/referensi?kode=${encodeURIComponent(kodeQ)}&nama=${encodeURIComponent(namaQ)}&take=6`,
          { headers: authHeaders() },
        )
        const j = (await res.json().catch(() => ({}))) as { items?: ReferensiPart[] }
        if (seq !== urut.current) return
        const daftar = (j.items ?? []).filter((d) => d.kode)
        setHasil({ kunci, items: daftar })
        const persis = daftar.filter((d) => d.skor === 100)
        if (persis.length === 1) persisRef.current?.(persis[0])
      } catch {
        if (seq === urut.current) setHasil({ kunci, items: [] })
      } finally {
        if (seq === urut.current) setLoadingKunci((k) => (k === kunci ? null : k))
      }
    }, 400)
    return () => clearTimeout(t)
  }, [aktif, kunci, kodeQ, namaQ])

  if (!aktif) return null
  const loading = loadingKunci === kunci
  const cocok = hasil?.kunci === kunci
  const items = cocok ? hasil.items : []
  if (!loading && !items.length && !cocok) return null
  if (!loading && !items.length) {
    return (
      <p className={cn('text-[10px] text-slate-400', className)}>
        Tidak ada referensi untuk kode/nama ini — aman dianggap part baru.
      </p>
    )
  }

  return (
    <div className={cn('rounded-md border border-violet-200 bg-violet-50/60 p-1.5', className)}>
      <div className="flex items-center gap-1 text-[10px] font-medium text-violet-700">
        {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <BookMarked className="h-3 w-3" />}
        {loading ? 'Mencari referensi…' : `${items.length} referensi mirip`}
        {!loading && <span className="font-normal text-violet-500">— klik untuk pakai</span>}
      </div>
      {loading && !items.length ? (
        <p className="mt-1 text-[10px] text-violet-500">Mencocokkan dengan katalog & riwayat part…</p>
      ) : (
        <div className="mt-1 space-y-1">
          {items.slice(0, tampil).map((it) => (
            <button
              key={it.kode}
              type="button"
              onClick={() => pilihRef.current(it)}
              className="w-full rounded border border-violet-100 bg-white px-1.5 py-1 text-left transition hover:border-violet-300 hover:bg-violet-50"
              title={`Pakai ${it.kode} — ${it.namaPart}`}
            >
              <div className="flex flex-wrap items-center gap-1">
                <span className="font-mono text-[10px] font-semibold text-slate-800">{it.kode}</span>
                <Badge
                  variant="outline"
                  className={cn(
                    'text-[9px]',
                    it.skor === 100
                      ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                      : 'border-amber-300 bg-amber-50 text-amber-700',
                  )}
                >
                  {it.skor === 100 ? 'persis' : `${it.skor}%`}
                </Badge>
                {it.adaKatalog && (
                  <Badge variant="outline" className="border-teal-300 bg-teal-50 text-[9px] text-teal-700">
                    <PackageCheck className="mr-0.5 h-2.5 w-2.5" /> katalog
                  </Badge>
                )}
                <span className="ml-auto text-[9px] text-slate-400">{it.sumber}</span>
              </div>
              <p className="truncate text-[10px] text-slate-700" title={it.namaPart}>{it.namaPart || '—'}</p>
              <p className="flex flex-wrap items-center gap-x-1.5 text-[9px] text-slate-500">
                {it.modelTampil && <span className="font-mono text-emerald-700">{it.modelTampil}</span>}
                {it.brandKompatibel && <span>{it.brandKompatibel}</span>}
                {it.adaKatalog && <span>stok {it.stokInventory}</span>}
                {it.dipakai > 0 && (
                  <span className="inline-flex items-center gap-0.5 text-violet-600">
                    <TrendingUp className="h-2.5 w-2.5" /> dipakai {it.dipakai}×
                  </span>
                )}
                {it.cocokPada.length > 0 && <span className="text-slate-400">cocok: {it.cocokPada.join(', ')}</span>}
              </p>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
