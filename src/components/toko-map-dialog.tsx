'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { postJson, type Toko } from '@/lib/api'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/use-toast'
import { useAppStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import { Loader2, MapPin, MousePointerClick, Navigation, RefreshCw, Save, X } from 'lucide-react'
import type * as LeafletT from 'leaflet'
import 'leaflet/dist/leaflet.css'

// Dialog peta posisi toko — gratis & tanpa API key, lintas pemasok tile:
// 1) OpenStreetMap resmi → 2) mirror OSM Germany → 3) CARTO (base OSM) → 4) Esri Street.
// Server resmi OSM meng-403 sebagian klien (desktop Electron, IP yang dibatasi) —
// maka peta otomatis beralih ke sumber berikutnya ketika tile gagal, dan pengguna
// bisa mencoba sumber lain manual via switcher kecil di bawah peta.
// - Toko sudah punya koordinat (cache/pin manual) → langsung tampilkan pin.
// - Belum ada → otomatis cari posisi via Nominatim (OpenStreetMap) dari alamat; hasilnya
//   di-cache ke DB sehingga pembukaan berikutnya instan.
// - Admin/Manager bisa "Set pin manual": klik peta → geser pin → simpan koordinat.
// - Deep-link Google Maps (gratis, bukan API berbayar) untuk membuka/navigasi posisi.

interface TokoMapDialogProps {
  toko: Toko | null
  onOpenChange: (open: boolean) => void
}

type StatusMap = 'MEMUAT' | 'GEOCODE' | 'SIAP' | 'GAGAL'

interface SumberPeta {
  id: string
  short: string
  nama: string
  url: string
  opsi: Record<string, unknown>
}

/** ≈4% antar pemasok: OSM resmi → mirror DE → CARTO → Esri Street (semua gratis). */
const PETA_SOURCES: SumberPeta[] = [
  {
    id: 'OSM',
    short: 'OSM',
    nama: 'OpenStreetMap resmi',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    opsi: {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    },
  },
  {
    id: 'OSM_DE',
    short: 'OSM·DE',
    nama: 'OpenStreetMap (mirror Germany)',
    url: 'https://tile.openstreetmap.de/{z}/{x}/{y}.png',
    opsi: {
      maxZoom: 18,
      attribution: '&copy; OpenStreetMap contributors &middot; tile.openstreetmap.de',
    },
  },
  {
    id: 'CARTO',
    short: 'CARTO',
    nama: 'CARTO (base OpenStreetMap)',
    url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    opsi: {
      maxZoom: 20,
      subdomains: 'abcd',
      detectRetina: true,
      attribution: '&copy; OpenStreetMap contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    },
  },
  {
    id: 'ESRI',
    short: 'Esri',
    nama: 'Esri Street Map',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
    opsi: {
      maxZoom: 19,
      attribution: 'Tiles &copy; <a href="https://www.esri.com/">Esri</a> — sources: Esri, i-cubed, USDA, USGS, AEX, GeoEye',
    },
  },
]

/** Aplikasi desktop (Electron) mulai dari CARTO — server tile resmi OSM sering membantah UA aplikasi. */
function petaIdxAwal(): number {
  if (typeof window === 'undefined') return 0
  return /Electron/i.test(window.navigator.userAgent) ? 2 : 0
}

function buatIkon(L: typeof LeafletT, warna: string, garis: string) {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 40" width="28" height="40">` +
    `<path d="M14 0C6.3 0 0 6.3 0 14c0 10.5 14 26 14 26s14-15.5 14-26C28 6.3 21.7 0 14 0z" fill="${warna}" stroke="${garis}" stroke-width="1"/>` +
    `<circle cx="14" cy="14" r="5.5" fill="#fff"/></svg>`
  return L.icon({
    iconUrl: 'data:image/svg+xml;utf8,' + encodeURIComponent(svg),
    iconSize: [28, 40],
    iconAnchor: [14, 40],
    popupAnchor: [0, -36],
  })
}

export default function TokoMapDialog({ toko, onOpenChange }: TokoMapDialogProps) {
  const { toast } = useToast()
  const role = useAppStore((s) => s.role)
  const queryClient = useQueryClient()
  const bisaSetPin = role === 'ADMIN_WORKSHOP' || role === 'MANAGER'

  const mapDivRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<LeafletT.Map | null>(null)
  const markerRef = useRef<LeafletT.Marker | null>(null)
  const layerRef = useRef<LeafletT.TileLayer | null>(null)
  const pinModeRef = useRef(false)
  // Guard: pencarian otomatis ke Nominatim hanya sekali per toko per sesi komponen.
  // Coba lagi manual bisa lewat tombol "Cari ulang" agar tidak spam server OSM.
  const pernahAutoGeocode = useRef<Set<number>>(new Set())
  // Failover tile: hitungan error sumber aktif + timer switch + set sumber yang sudah tercatat gagal
  const errTileRef = useRef(0)
  const switchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const gagalSumberRef = useRef<Set<string>>(new Set())

  const [status, setStatus] = useState<StatusMap>('MEMUAT')
  const [pesanGagal, setPesanGagal] = useState('')
  const [posisiTerkini, setPosisiTerkini] = useState<{ lat: number; lng: number } | null>(null)
  const [pinBaru, setPinBaru] = useState<{ lat: number; lng: number } | null>(null)
  const [pinMode, setPinMode] = useState(false)
  const [sumber, setSumber] = useState<'DB' | 'OSM' | 'PIN' | null>(null)
  const [sumberIdx, setSumberIdx] = useState<number>(0)
  const [notisTile, setNotisTile] = useState<string | null>(null)

  const posisiTampil = pinBaru ?? posisiTerkini

  function invalidateToko() {
    queryClient.invalidateQueries({ queryKey: ['toko'] })
  }

  function taruhMarker(
    L: typeof LeafletT,
    lat: number,
    lng: number,
    draggable: boolean,
    baru = false
  ) {
    const map = mapRef.current
    if (!map) return
    if (markerRef.current) markerRef.current.remove()
    const ikon = baru ? buatIkon(L, '#b45309', '#f59e0b') : buatIkon(L, '#0f766e', '#0d9488')
    markerRef.current = L.marker([lat, lng], { icon: ikon, draggable }).addTo(map)
    if (draggable) {
      markerRef.current.on('dragend', () => {
        const p = markerRef.current?.getLatLng()
        if (p) setPinBaru({ lat: p.lat, lng: p.lng })
      })
    }
  }

  /**
   * Pasang tile layer sumber ke-idx dengan failover otomatis:
   * tileerror yang terus-menerus (4+ tanpa keberhasilan tileload) → pindah sumber.
   */
  function pasangPeta(L: typeof LeafletT, map: LeafletT.Map, idx: number) {
    const sedia = PETA_SOURCES[idx % PETA_SOURCES.length]
    errTileRef.current = 0
    if (switchTimerRef.current) {
      clearTimeout(switchTimerRef.current)
      switchTimerRef.current = null
    }
    if (layerRef.current) layerRef.current.remove()
    const layer = L.tileLayer(sedia.url, sedia.opsi as L.TileLayerOptions)
    layer.addTo(map)
    layerRef.current = layer
    layer.on('tileload', () => {
      errTileRef.current = 0 // tile sukses → hitungan error direset (blips acak tidak memicu switch)
    })
    layer.on('tileerror', () => {
      errTileRef.current += 1
      if (switchTimerRef.current || errTileRef.current < 4) return
      const sediaNama = sedia.nama
      switchTimerRef.current = setTimeout(() => {
        switchTimerRef.current = null
        errTileRef.current = 0
        const map = mapRef.current
        if (!map) return
        gagalSumberRef.current.add(sedia.id)
        if (gagalSumberRef.current.size >= PETA_SOURCES.length) {
          setNotisTile('Semua sumber peta diblokir/tidak tersedia — periksa koneksi internet aplikasi lalu buka peta lagi.')
          return
        }
        const next = (idx + 1) % PETA_SOURCES.length
        setNotisTile(
          `Tile "${sediaNama}" diblokir (mis. HTTP 403) / tidak tersedia — otomatis beralih ke "${PETA_SOURCES[next].nama}".`
        )
        setSumberIdx(next)
        pasangPeta(L, map, next)
      }, 600)
    })
  }

  /** Ganti sumber peta manual (klik switcher) — tanpa mengubah view/marker. */
  function pilihSumber(i: number) {
    if (i === sumberIdx) return
    setNotisTile(null)
    setSumberIdx(i)
    gagalSumberRef.current.delete(PETA_SOURCES[i].id) // boleh dicoba lagi manual setelah dulu gagal
    void (async () => {
      const L = await import('leaflet')
      const map = mapRef.current
      if (map) pasangPeta(L, map, i)
    })()
  }

  /** Pencarian posisi via Nominatim — dipakai otomatis & tombol "Cari ulang". */
  async function cariPosisiOsm(tokoId: number) {
    try {
      setStatus('GEOCODE')
      setPesanGagal('')
      const r = await postJson<{ sumber?: string; latitude: number; longitude: number }>(
        `/api/toko/${tokoId}/geocode`,
        {}
      )
      if (typeof r?.latitude === 'number' && typeof r?.longitude === 'number') {
        const L = await import('leaflet')
        if (mapRef.current) {
          taruhMarker(L, r.latitude, r.longitude, false)
          setPosisiTerkini({ lat: r.latitude, lng: r.longitude })
          mapRef.current.setView([r.latitude, r.longitude], 16)
        }
        setSumber('OSM')
        setPinBaru(null)
        setStatus('SIAP')
        invalidateToko()
      } else {
        setStatus('GAGAL')
        setPesanGagal('Posisi tidak ditemukan di OpenStreetMap — set pin manual dengan klik di peta.')
      }
    } catch (e) {
      setStatus('GAGAL')
      setPesanGagal(e instanceof Error ? e.message : 'Gagal mencari posisi di OpenStreetMap')
    }
  }

  // Inisialisasi peta tiap kali toko dibuka (cleanup saat toko berubah/dialog ditutup)
  useEffect(() => {
    let batal = false
    if (!toko) return
    async function init(t: Toko) {
      setStatus('MEMUAT')
      setPesanGagal('')
      setPinBaru(null)
      setPosisiTerkini(null)
      setSumber(null)
      setPinMode(false)
      pinModeRef.current = false
      gagalSumberRef.current = new Set()
      setNotisTile(null)
      const idxAwal = petaIdxAwal()
      setSumberIdx(idxAwal)
      if (idxAwal !== 0) {
        setNotisTile('Aplikasi desktop memakai tile CARTO — tile resmi OpenStreetMap membatasi klien aplikasi.')
      }
      try {
        const L = await import('leaflet')
        if (batal || !mapDivRef.current) return
        mapRef.current?.remove()
        const map = L.map(mapDivRef.current)
        pasangPeta(L, map, idxAwal)
        map.on('click', (e: LeafletT.LeafletMouseEvent) => {
          if (!pinModeRef.current) return
          taruhMarker(L, e.latlng.lat, e.latlng.lng, true, true)
          setPinBaru({ lat: e.latlng.lat, lng: e.latlng.lng })
        })
        mapRef.current = map
        await new Promise((r) => setTimeout(r, 80)) // tunggu dialog terpasang/animasi Radix
        if (batal) return
        map.invalidateSize()

        if (t.latitude !== null && t.longitude !== null) {
          taruhMarker(L, t.latitude, t.longitude, false)
          setPosisiTerkini({ lat: t.latitude, lng: t.longitude })
          setSumber('DB')
          setStatus('SIAP')
          map.setView([t.latitude, t.longitude], 16)
        } else if (!pernahAutoGeocode.current.has(t.id)) {
          pernahAutoGeocode.current.add(t.id)
          await cariPosisiOsm(t.id)
        } else {
          map.setView([-2.0, 118.0], 4) // tinjauan Indonesia saat auto-sudah dicoba & posisi kosong
          setStatus('SIAP')
        }
      } catch (e) {
        console.error('Leaflet init error:', e)
        if (!batal) {
          setStatus('GAGAL')
          setPesanGagal('Gagal memuat peta Leaflet — muat ulang halaman lalu coba lagi.')
        }
      }
    }
    void init(toko)
    return () => {
      batal = true
      if (switchTimerRef.current) clearTimeout(switchTimerRef.current)
      switchTimerRef.current = null
      mapRef.current?.remove()
      mapRef.current = null
      markerRef.current = null
      layerRef.current = null
    }
  }, [toko])

  const googleMapsHref = useMemo(() => {
    const p = posisiTampil
    return p ? `https://www.google.com/maps?q=${p.lat},${p.lng}` : null
  }, [posisiTampil])

  // Simpan posisi pin manual → PATCH koordinat toko
  async function simpanPin() {
    if (!toko || !pinBaru) return
    try {
      await postJson(
        `/api/toko/${toko.id}`,
        { latitude: pinBaru.lat, longitude: pinBaru.lng, aktor: role },
        'PATCH'
      )
      const p = pinBaru
      setPinBaru(null)
      setPinMode(false)
      pinModeRef.current = false
      setPosisiTerkini(p)
      setSumber('PIN')
      setStatus('SIAP')
      invalidateToko()
      toast({ title: 'Posisi toko tersimpan', description: 'Koordinat pin kini menjadi posisi resmi toko ini.' })
    } catch (e) {
      toast({ title: 'Gagal menyimpan posisi', description: e instanceof Error ? e.message : String(e), variant: 'destructive' })
    }
  }

  // Hapus koordinat tercatat (Admin/Manager) lalu cari ulang otomatis dari alamat
  async function resetDanCari() {
    if (!toko) return
    try {
      setStatus('GEOCODE')
      await postJson(`/api/toko/${toko.id}`, { latitude: null, longitude: null, aktor: role }, 'PATCH')
      pernahAutoGeocode.current.delete(toko.id)
      setPosisiTerkini(null)
      setSumber(null)
      await cariPosisiOsm(toko.id)
      invalidateToko()
      toast({ title: 'Posisi direset', description: 'Koordinat lama dihapus dan pencarian alamat diulang di OpenStreetMap.' })
    } catch (e) {
      setStatus('GAGAL')
      setPesanGagal(e instanceof Error ? e.message : 'Gagal mereset posisi')
    }
  }

  function keluarPinMode() {
    setPinMode(false)
    pinModeRef.current = false
    setPinBaru(null)
    if (posisiTerkini) {
      import('leaflet').then((L) => taruhMarker(L, posisiTerkini.lat, posisiTerkini.lng, false))
    } else {
      markerRef.current?.remove()
    }
  }

  return (
    <Dialog open={!!toko} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[calc(100vw-2rem)] gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="px-4 pt-4 sm:px-6">
          <DialogTitle className="flex flex-wrap items-center gap-2 text-base">
            <MapPin className="h-4 w-4 text-teal-600" />
            {toko?.namaToko ?? ''}
            <Badge variant="outline" className="font-mono text-[10px]">
              {toko?.kodeToko}
            </Badge>
          </DialogTitle>
          <DialogDescription className="line-clamp-2 text-xs">
            {toko?.alamat || 'Alamat belum diisi — set pin manual untuk mencatat posisi.'}
          </DialogDescription>
        </DialogHeader>

        <div className="px-4 sm:px-6">
          <div className="flex min-h-8 flex-wrap items-center gap-2 text-xs">
            {status === 'GEOCODE' && (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-500" />
                <span className="text-slate-600">Mencari posisi di OpenStreetMap dari alamat&hellip;</span>
              </>
            )}
            {status === 'SIAP' && posisiTampil && (
              <>
                <Badge className="bg-teal-600 font-mono text-[10px]">
                  {posisiTampil.lat.toFixed(5)}, {posisiTampil.lng.toFixed(5)}
                </Badge>
                {sumber === 'OSM' && <span className="text-slate-500">otomatis dari alamat (OpenStreetMap)</span>}
                {(sumber === 'DB' || sumber === 'PIN') && <span className="text-slate-500">posisi tersimpan</span>}
                {pinMode && <span className="font-medium text-amber-600">klik peta untuk menaruh pin, geser bila perlu</span>}
              </>
            )}
            {status === 'GAGAL' && <span className="text-rose-600">{pesanGagal || 'Peta gagal dimuat.'}</span>}
            {status === 'GAGAL' && toko && (
              <Button size="sm" variant="outline" className="h-7 gap-1.5 px-2 text-xs" onClick={() => void cariPosisiOsm(toko.id)}>
                <RefreshCw className="h-3 w-3" /> Cari ulang
              </Button>
            )}
          </div>
        </div>

        <div className="relative mx-4 sm:mx-6">
          <div ref={mapDivRef} className="z-0 h-72 w-full overflow-hidden rounded-md border bg-slate-100 sm:h-96" />
          {pinMode && (
            <div className="pointer-events-none absolute inset-x-0 top-2 z-[500] flex justify-center">
              <span className="flex items-center gap-1.5 rounded-full bg-white/95 px-3 py-1 text-xs font-medium text-amber-700 shadow">
                <MousePointerClick className="h-3.5 w-3.5" /> Klik lokasi toko di peta untuk menaruh pin
              </span>
            </div>
          )}
        </div>

        {/* Ads notis failover tile + switcher sumber peta manual */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-4 pt-2 sm:px-6">
          {notisTile ? (
            <p className="mr-auto max-w-full text-[11px] leading-tight text-amber-600">{notisTile}</p>
          ) : (
            <span className="mr-auto text-[11px] text-slate-400">
              Peta gratis (tanpa API key) &mdash; sumber ini yang sedang dipakai:
            </span>
          )}
          <div className="flex items-center gap-0.5 rounded-md border border-slate-200 bg-slate-50 p-0.5">
            {PETA_SOURCES.map((p, i) => (
              <button
                key={p.id}
                type="button"
                onClick={() => pilihSumber(i)}
                title={p.nama}
                className={cn(
                  'rounded px-1.5 py-0.5 text-[10px] transition',
                  i === sumberIdx ? 'bg-white font-semibold text-teal-700 shadow-sm' : 'text-slate-400 hover:text-slate-600'
                )}
              >
                {p.short}
              </button>
            ))}
          </div>
        </div>

        <DialogFooter className="flex-col items-stretch gap-2 px-4 pb-4 pt-2 sm:flex-row sm:items-center sm:px-6 sm:pb-5">
          {googleMapsHref ? (
            <a
              href={googleMapsHref}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center justify-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              <Navigation className="h-3.5 w-3.5 text-teal-600" /> Buka posisi di Google Maps
            </a>
          ) : (
            <span className="text-xs text-slate-400">Posisi belum diketahui — belum bisa dibuka di Google Maps.</span>
          )}
          <div className="flex gap-2 sm:ml-auto">
            {bisaSetPin && !pinMode && status !== 'GEOCODE' && toko && (
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5 border-amber-300 text-amber-700 hover:bg-amber-50"
                onClick={() => {
                  setPinMode(true)
                  pinModeRef.current = true
                  const map = mapRef.current
                  const p = posisiTampil
                  if (map && p) map.setView([p.lat, p.lng], Math.max(map.getZoom(), 17))
                }}
              >
                <MapPin className="h-3.5 w-3.5" /> Set pin manual
              </Button>
            )}
            {bisaSetPin && !pinMode && toko?.latitude != null && (
              <Button size="sm" variant="ghost" className="gap-1.5 text-slate-500 hover:text-slate-700" onClick={() => void resetDanCari()}>
                <RefreshCw className="h-3.5 w-3.5" /> Reset posisi
              </Button>
            )}
            {bisaSetPin && pinMode && (
              <>
                <Button size="sm" variant="ghost" className="gap-1.5" onClick={keluarPinMode}>
                  <X className="h-3.5 w-3.5" /> Batal
                </Button>
                <Button size="sm" className="gap-1.5 bg-teal-600 hover:bg-teal-700" disabled={!pinBaru} onClick={() => void simpanPin()}>
                  <Save className="h-3.5 w-3.5" /> Simpan posisi
                </Button>
              </>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
