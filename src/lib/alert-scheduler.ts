import { db } from '@/lib/db'
import { jalankanAlertEngine, susunTeksAlert } from '@/lib/alert-engine'
import { buatNotifikasi, kirimNotifikasiGateway, alertLoncengAktif } from '@/lib/notifikasi'

/**
 * Scheduler alert harian (berjalan di dalam proses server).
 * ------------------------------------------------------------
 * Dijalankan sekali saat server boot via src/instrumentation.ts.
 * Tiap 30 menit: bila hari ini belum ada pengiriman alert (penanda
 * `alert_kirim_tanggal` di tabel Pengaturan) → jalankan alert engine,
 * kirim ringkasannya ke grup WA/Telegram (kalau sakelarnya menyala) dan —
 * hanya bila Pengaturan `alert_lonceng_aktif` disalakan (default MATI) —
 * catat notifikasi in-app (lonceng).
 *
 * Catatan: server harus hidup saat jadwal tiba (server desktop/LAN umumnya
 * standby 24 jam).
 */

const g = globalThis as unknown as { __asproAlertScheduler?: boolean }

function todayStr(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export async function kirimAlertHarian(): Promise<{ dikirim: boolean; total: number; mode: string }> {
  const hariIni = todayStr()
  const marker = await db.pengaturan.findUnique({ where: { kunci: 'alert_kirim_tanggal' } })
  if (marker?.nilai === hariIni) return { dikirim: false, total: 0, mode: 'SUDAH_DIKIRIM' }

  const hasil = await jalankanAlertEngine()
  let mode = 'TIDAK_ADA_ALERT'

  if (hasil.alerts.length > 0) {
    const teks = susunTeksAlert(hasil)
    const keGrup = await kirimNotifikasiGateway(teks, 'alert', {
      total: hasil.total,
      critical: hasil.critical,
    })
    mode = keGrup.mode
    // Notifikasi in-app (lonceng) — kini OPSIONAL (Pengaturan ›
    // alert_lonceng_aktif, default MATI). Dulu selalu ditulis, sehingga tiap
    // hari lonceng memunculkan "Ringkasan alert: N aktif" yang menghitung
    // semua kondisi yang sekadar menunggu tindakan — bising & karena tick
    // 30-menit, sering muncul bersamaan dengan aksi user (mis. registrasi
    // unit) sehingga dikira dipicu aksi itu.
    if (await alertLoncengAktif()) {
      const kodeUnik = [...new Set(hasil.alerts.map((a) => a.kode))]
      await buatNotifikasi({
        tipe: 'ALERT',
        judul: `Ringkasan alert: ${hasil.total} aktif`,
        pesan: `${hasil.critical} kritis · ${kodeUnik.join(', ')}\n${hasil.alerts
          .slice(0, 5)
          .map((a) => `• ${a.kode} ${a.entitas}: ${a.detail}`)
          .join('\n')}`,
        refType: 'alert',
        dibuatOleh: 'ALERT-ENGINE',
      })
    }
  }

  await db.pengaturan.upsert({
    where: { kunci: 'alert_kirim_tanggal' },
    update: { nilai: hariIni },
    create: { kunci: 'alert_kirim_tanggal', nilai: hariIni },
  })
  return { dikirim: hasil.alerts.length > 0, total: hasil.total, mode }
}

async function tick() {
  try {
    const hasil = await kirimAlertHarian()
    if (hasil.dikirim) {
      console.log(`[alert-scheduler] Ringkasan alert dikirim: ${hasil.total} alert (${hasil.mode})`)
    }
  } catch (e) {
    console.error('[alert-scheduler] Gagal:', (e as Error).message)
  }
}

export function startAlertScheduler() {
  if (g.__asproAlertScheduler) return
  g.__asproAlertScheduler = true
  // Tick pertama 2 menit setelah boot, lalu tiap 30 menit (penanda harian
  // memastikan hanya 1 pengiriman per hari).
  setTimeout(() => {
    void tick()
    setInterval(() => void tick(), 30 * 60_000).unref?.()
  }, 120_000).unref?.()
  console.log('[alert-scheduler] Aktif — cek alert tiap 30 menit (kirim 1×/hari)')
}
