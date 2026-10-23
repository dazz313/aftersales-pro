'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * Signature pad canvas sederhana (mouse + sentuh HP).
 * Menyimpan hasil sebagai dataURL PNG — dipakai kolom ttd_* di tabel nota.
 * Kosong = null (nota menampilkan garis tanda tangan polos).
 */
export default function SignaturePad({
  label,
  nama,
  onNama,
  dataUrl,
  onDataUrl,
}: {
  label: string
  nama: string
  onNama: (v: string) => void
  dataUrl: string | null
  onDataUrl: (v: string | null) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [menggambar, setMenggambar] = useState(false)
  const terakhir = useRef<{ x: number; y: number } | null>(null)
  const adaIsi = useRef(false)

  // Ukur canvas sesuai ukuran tampilan × devicePixelRatio agar tajam di HP
  useEffect(() => {
    const c = canvasRef.current
    if (!c) return
    const rect = c.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    c.width = Math.max(rect.width * dpr, 1)
    c.height = Math.max(rect.height * dpr, 1)
    const ctx = c.getContext('2d')
    if (ctx) {
      ctx.scale(dpr, dpr)
      ctx.lineWidth = 2
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.strokeStyle = '#111827'
    }
    // Pilih dataUrl tersimpan tampil ulang (mis. saat edit nota lama / duplikat)
    if (dataUrl) {
      const img = new Image()
      img.onload = () => ctx?.drawImage(img, 0, 0, rect.width, rect.height)
      img.src = dataUrl
      adaIsi.current = true
    }
     
  }, [])

  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    return { x: (e.clientX - rect.left), y: (e.clientY - rect.top) }
  }

  const mulai = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    setMenggambar(true)
    terakhir.current = pos(e)
    adaIsi.current = true
  }

  const geser = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!menggambar) return
    const ctx = canvasRef.current?.getContext('2d')
    const a = terakhir.current ?? pos(e)
    const b = pos(e)
    if (ctx) {
      ctx.beginPath()
      ctx.moveTo(a.x, a.y)
      ctx.lineTo(b.x, b.y)
      ctx.stroke()
    }
    terakhir.current = b
  }

  const selesai = () => {
    setMenggambar(false)
    terakhir.current = null
    const c = canvasRef.current
    if (c && adaIsi.current) onDataUrl(c.toDataURL('image/png'))
  }

  const bersih = () => {
    const c = canvasRef.current
    const ctx = c?.getContext('2d')
    if (c && ctx) {
      const dpr = window.devicePixelRatio || 1
      ctx.clearRect(0, 0, c.width / dpr, c.height / dpr)
    }
    adaIsi.current = false
    onDataUrl(null)
  }

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-slate-600">{label}</p>
      <canvas
        ref={canvasRef}
        onPointerDown={mulai}
        onPointerMove={geser}
        onPointerUp={selesai}
        onPointerLeave={selesai}
        className="h-24 w-full touch-none rounded-lg border border-dashed border-slate-300 bg-white"
      />
      <div className="flex items-center gap-2">
        <input
          value={nama}
          onChange={(e) => onNama(e.target.value)}
          placeholder="Nama jelas"
          className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
        />
        <button onClick={bersih} className="shrink-0 rounded-md border border-input px-2 py-1 text-xs text-slate-600 hover:bg-slate-50">
          Hapus
        </button>
      </div>
    </div>
  )
}
