import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { autoGitBackup } from '@/lib/git-backup'
import { getActiveSession } from '@/lib/auth-server'

// POST /api/toko/[id]/geocode — cari posisi toko di OpenStreetMap via Nominatim (gratis,
// tanpa API key). Posisi lalu di-cache ke kolom latitude/longitude toko sehingga
// pembukaan peta berikutnya langsung instan tanpa menanyakan server OSM lagi.

/**
 * Etika Nominatim: maksimal 1 request/detik + identitas aplikasi pada User-Agent.
 * Dipenuhi lewat throttle global sederhana (jeda min. ~1,1 detik antar request
 * dari seluruh proses server).
 */
let lastRequestAt = 0

interface NominatimHit {
  lat: string
  lon: string
  display_name?: string
  name?: string
}

async function nominatimCari(query: string): Promise<NominatimHit[]> {
  const jeda = Math.max(0, 1100 - (Date.now() - lastRequestAt))
  if (jeda > 0) await new Promise((resolve) => setTimeout(resolve, jeda))
  lastRequestAt = Date.now()
  const url = 'https://nominatim.openstreetmap.org/search?' + new URLSearchParams({
    format: 'jsonv2',
    limit: '1',
    addressdetails: '0',
    'accept-language': 'id',
    q: query,
  })
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'AfterSalesPro/1.0 (aplikasi manajemen after-sales service)',
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(10_000),
    cache: 'no-store',
  })
  if (!res.ok) {
    const err = new Error(`Nominatim HTTP ${res.status}`) as Error & { status?: number }
    err.status = res.status
    throw err
  }
  return (await res.json()) as NominatimHit[]
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getActiveSession(request)
    if (!session) {
      return NextResponse.json({ error: 'Sesi berakhir atau akun nonaktif. Silakan login ulang.' }, { status: 401 })
    }
    const { id } = await params
    const toko = await db.masterToko.findUnique({ where: { id: Number(id) } })
    if (!toko) return NextResponse.json({ error: 'Toko tidak ditemukan' }, { status: 404 })

    // Sudah punya koordinat (hasil pencarian sebelumnya atau pin manual)? Tidak perlu tanya OSM lagi.
    if (toko.latitude !== null && toko.longitude !== null) {
      return NextResponse.json({
        ok: true,
        sumber: 'CACHE',
        latitude: toko.latitude,
        longitude: toko.longitude,
        namaHasil: null,
      })
    }

    const alamat = (toko.alamat ?? '').trim()
    if (!alamat) {
      return NextResponse.json(
        { error: 'Alamat toko belum diisi — isi alamat terlebih dahulu, atau set pin manual dengan klik di peta.' },
        { status: 400 }
      )
    }

    // 3 upaya: nama toko + alamat, alamat saja, lalu fallback segmen kota/last-part alamat
    // (mis. "Jl. Beringin, Watampone" → "Watampone") — posisi kota lebih baik daripada kosong.
    const segmen = alamat.split(',').map((s) => s.trim()).filter(Boolean)
    const kota = segmen.length > 1 ? segmen[segmen.length - 1] : null
    const queries = [`${toko.namaToko}, ${alamat}`, alamat, ...(kota ? [kota] : [])]
    let hit: NominatimHit | null = null
    let gagalJaringan = false
    let gagalStatus = 0
    for (const q of queries) {
      try {
        const hasil = await nominatimCari(q)
        if (hasil.length > 0) {
          hit = hasil[0]
          break
        }
      } catch (e) {
        gagalJaringan = true
        gagalStatus = typeof e === 'object' && e && 'status' in e ? Number((e as { status: number }).status) : 0
      }
    }

    if (!hit) {
      return NextResponse.json(
        {
          error: gagalJaringan
            ? gagalStatus === 403
              ? 'Akses ke OpenStreetMap gagal (HTTP 403 — server menolak klien ini untuk sementara). Gunakan "Set pin manual" di peta, atau coba "Cari ulang" lagi beberapa saat.'
              : 'Gagal menghubungi OpenStreetMap — periksa koneksi internet server, atau set pin manual dengan klik di peta.'
            : 'Posisi tidak ditemukan di OpenStreetMap dari alamat toko — set pin manual dengan klik di peta.',
        },
        { status: 404 }
      )
    }

    const latitude = Number(hit.lat)
    const longitude = Number(hit.lon)
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return NextResponse.json({ error: 'Respon koordinat OpenStreetMap tidak valid' }, { status: 500 })
    }

    const updated = await db.masterToko.update({
      where: { id: toko.id },
      data: { latitude, longitude },
    })
    await logAudit({
      aksi: 'GEOCODE_MASTER_TOKO',
      entitas: 'master_toko',
      entitasId: updated.kodeToko,
      deskripsi: `Posisi toko dicari otomatis dari alamat (OpenStreetMap): ${latitude}, ${longitude}`,
      aktor: session.nama,
    })
    await autoGitBackup('UPDATE', 'master_toko', updated.kodeToko, session.nama)
    return NextResponse.json({
      ok: true,
      sumber: 'NOMINATIM',
      latitude,
      longitude,
      namaHasil: hit.display_name ?? hit.name ?? null,
    })
  } catch (error) {
    console.error('Toko geocode error:', error)
    return NextResponse.json({ error: 'Gagal mencari posisi dari OpenStreetMap' }, { status: 500 })
  }
}
