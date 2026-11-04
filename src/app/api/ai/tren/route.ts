import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireActiveSession } from '@/lib/auth-server'
import { resolveAiConfig, chatCompletion } from '@/lib/ai'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// POST /api/ai/tren — indikator multi-periode dari SEMUA data aplikasi.
// Body: { periode: 'MINGGU' | 'BULAN' | 'TAHUN' }
// Agregasi dilakukan server (angka pasti), AI hanya menarasi tren — bila AI
// tidak tersedia data tetap dikembalikan lengkap (narasi null + catatan).

type Periode = 'MINGGU' | 'BULAN' | 'TAHUN'

export interface SelTren {
  key: string
  label: string
  tiketMasuk: number
  tiketSelesai: number
  slaLewat: number
  klaimDiajukan: number
  kunjungan: number
  unitBaru: number
}

export interface TotalTren {
  tiketMasuk: number
  tiketSelesai: number
  slaLewat: number
  klaimDiajukan: number
  kunjungan: number
  unitBaru: number
}

const NAMA_BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']
const p2 = (n: number) => String(n).padStart(2, '0')

function kunciBucket(d: Date, periode: Periode): string {
  if (periode === 'TAHUN') return String(d.getFullYear())
  if (periode === 'BULAN') return `${d.getFullYear()}-${p2(d.getMonth() + 1)}`
  // Minggu: awal HARI SENIN (getDay: mit=1..min=6? tidak — Ahad=0) → mundur ke Senin.
  const senin = new Date(d)
  senin.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return `${senin.getFullYear()}-${p2(senin.getMonth() + 1)}-${p2(senin.getDate())}`
}

function labelBucket(key: string, periode: Periode): string {
  if (periode === 'TAHUN') return `Tahun ${key}`
  if (periode === 'BULAN') {
    const t = key.split('-')
    return `${NAMA_BULAN[Number(t[1]) - 1]} ${t[0]}`
  }
  const [y, m, d] = key.split('-')
  return `Mgg ${d}/${m}/${y.slice(2)}`
}

export async function POST(request: Request) {
  const { denied } = await requireActiveSession(request)
  if (denied) return denied
  try {
    const body = (await request.json().catch(() => ({}))) as { periode?: string }
    const periode: Periode = body.periode === 'TAHUN' ? 'TAHUN' : body.periode === 'MINGGU' ? 'MINGGU' : 'BULAN'

    const [tikets, kunjungan, unit] = await Promise.all([
      db.serviceRequest.findMany({
        select: { tglTiket: true, status: true, slaFlag: true, statusKlaimProdusen: true, tglFinish: true, tglKlaim: true },
      }),
      db.kunjungan.findMany({ select: { tglKunjungan: true } }),
      db.unitAsset.findMany({ select: { createdAt: true } }),
    ])

    // ── Akumulasi per bucket
    let minTgl: number | null = null
    let maxTgl: number | null = null
    const catat = (ms: number) => {
      if (Number.isNaN(ms)) return
      if (minTgl === null || ms < minTgl) minTgl = ms
      if (maxTgl === null || ms > maxTgl) maxTgl = ms
    }
    const tiketMasuk = new Map<string, { n: number; sla: number }>()
    const tiketSelesai = new Map<string, number>()
    const klaimDiajukan = new Map<string, number>()
    const kunjunganPerB = new Map<string, number>()
    const unitBaru = new Map<string, number>()
    const tambah = (m: Map<string, number>, key: string) => m.set(key, (m.get(key) ?? 0) + 1)

    for (const t of tikets) {
      const ms = new Date(t.tglTiket).getTime()
      catat(ms)
      const k = kunciBucket(new Date(ms), periode)
      const cur = tiketMasuk.get(k) ?? { n: 0, sla: 0 }
      cur.n++
      if (t.slaFlag) cur.sla++
      tiketMasuk.set(k, cur)
      if (t.tglFinish) {
        const msF = new Date(t.tglFinish).getTime()
        catat(msF)
        tambah(tiketSelesai, kunciBucket(new Date(msF), periode))
      }
      if (t.tglKlaim && t.statusKlaimProdusen !== 'DRAFT') {
        const msK = new Date(t.tglKlaim).getTime()
        catat(msK)
        tambah(klaimDiajukan, kunciBucket(new Date(msK), periode))
      }
    }
    for (const k of kunjungan) {
      const ms = new Date(k.tglKunjungan).getTime()
      catat(ms)
      tambah(kunjunganPerB, kunciBucket(new Date(ms), periode))
    }
    for (const u of unit) {
      const ms = new Date(u.createdAt).getTime()
      catat(ms)
      tambah(unitBaru, kunciBucket(new Date(ms), periode))
    }

    // ── Isi semua bucket dari awal → sekarang (nol utk periode kosong)
    const series: SelTren[] = []
    if (minTgl !== null && maxTgl !== null) {
      // Telusuri per bucket dengan konstruksi tanggal langsung (aman untuk minggu).
      const awal = kunciBucket(new Date(minTgl), periode)
      const akhir = kunciBucket(new Date(maxTgl), periode)
      let key: string | null = awal
      let lindungi = 0
      const MAKS_BANGKU = periode === 'MINGGU' ? 400 : periode === 'BULAN' ? 180 : 60
      while (key && key <= akhir && lindungi++ < MAKS_BANGKU) {
        series.push({
          key,
          label: labelBucket(key, periode),
          tiketMasuk: tiketMasuk.get(key)?.n ?? 0,
          tiketSelesai: tiketSelesai.get(key) ?? 0,
          slaLewat: tiketMasuk.get(key)?.sla ?? 0,
          klaimDiajukan: klaimDiajukan.get(key) ?? 0,
          kunjungan: kunjunganPerB.get(key) ?? 0,
          unitBaru: unitBaru.get(key) ?? 0,
        })
        // Maju bucket: tanggal harian contoh dari key + langkah
        const dc = periode === 'TAHUN'
          ? new Date(Number(key), 0, 2)
          : periode === 'BULAN'
            ? new Date(Number(key.split('-')[0]), Number(key.split('-')[1]) - 1, 2)
            : new Date(key + 'T12:00:00')
        dc.setDate(dc.getDate() + (periode === 'MINGGU' ? 7 : periode === 'BULAN' ? 30 : 366))
        const keyBaru = kunciBucket(dc, periode)
        key = keyBaru > key ? keyBaru : null // jangan berputar tanpa maju
      }
    }

    const total: TotalTren = {
      tiketMasuk: series.reduce((a, s) => a + s.tiketMasuk, 0),
      tiketSelesai: series.reduce((a, s) => a + s.tiketSelesai, 0),
      slaLewat: series.reduce((a, s) => a + s.slaLewat, 0),
      klaimDiajukan: series.reduce((a, s) => a + s.klaimDiajukan, 0),
      kunjungan: series.reduce((a, s) => a + s.kunjungan, 0),
      unitBaru: series.reduce((a, s) => a + s.unitBaru, 0),
    }

    // ── Narasi AI (opsional — data tetap lengkap bila AI gagal)
    let narasi: string | null = null
    let model: string | null = null
    let caturan: string | null = null
    if (series.length > 0) {
      const terakhir = series.slice(-12)
      const puncak = [...series].sort((a, b) => b.tiketMasuk - a.tiketMasuk).slice(0, 3)
      const ringkasanData =
        `Periode pemotongan: ${periode} (${series.length} periode, ${series[0].label} s/d ${series[series.length - 1].label}).\n` +
        `TOTAL SEMUA: tiket masuk ${total.tiketMasuk}, selesai ${total.tiketSelesai}, SLA lewat ${total.slaLewat}, klaim diajukan ${total.klaimDiajukan}, kunjungan toko ${total.kunjungan}, unit baru ${total.unitBaru}.\n` +
        `12 periode TERAKHIR (label | tiketMasuk | selesai | SLA lewat | klaim | kunjungan | unitBaru):\n` +
        terakhir.map((s) => `${s.label} | ${s.tiketMasuk} | ${s.tiketSelesai} | ${s.slaLewat} | ${s.klaimDiajukan} | ${s.kunjungan} | ${s.unitBaru}`).join('\n') +
        `\n3 periode DENGAN tiket masuk TERTINGGI: ${puncak.map((s) => `${s.label} (${s.tiketMasuk} tiket)`).join(', ')}.`

      try {
        const pengaturan = await db.pengaturan.findMany({ select: { kunci: true, nilai: true } })
        const map: Record<string, string> = {}
        for (const r of pengaturan) map[r.kunci] = r.nilai
        const cfg = resolveAiConfig(map)
        narasi = await chatCompletion(
          cfg,
          [
            { role: 'system', content: 'Kamu analis data after-sales. Jawab Bahasa Indonesia, bullet poin, maksimum 130 kata.' },
            {
              role: 'user',
              content:
                `Data indikator ${periode.toLowerCase()} dari seluruh riwayat data:\n${ringkasanData}\n` +
                `Analisa: (1) arah tren tiap indikator (naik/stabil/turun), (2) periode puncak & kemungkinan penyebabnya, (3) satu anjuran tindakan konkret.`,
            },
          ],
          { temperature: 0.35, maxTokens: 700, timeoutMs: 60000 }
        )
        model = cfg.model
      } catch (e) {
        caturan = `AI tidak tersedia (${(e as Error).message}) — angka indikator tetap lengkap di bawah.`
      }
    } else {
      caturan = 'Belum ada data untuk dianalisa.'
    }

    return NextResponse.json({ periode, series, total, narasi, model, catatan: caturan })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 })
  }
}
