import { NextResponse } from 'next/server'
import { jalankanAlertEngine } from '@/lib/alert-engine'

/**
 * API System Alert Engine (Modul 5.2 + Section 7 PRD)
 * Menjalankan business rules:
 * - ALT-01: Toko Melewati Jadwal Kunjungan
 * - ALT-02: SLA Sparepart Pending (REQUEST > 24 jam)
 * - ALT-03: Low Stock Sparepart (ROP)
 * - ALT-04: Potential Unclaimed Revenue (FINISH > 7 hari, klaim DRAFT)
 * - ALT-05: Unit Belum Terproses (REQUEST tanpa part READY > 24 jam)
 * - ALT-06: Unit Terregistrasi Tanpa Tiket (registrasi > 24 jam tanpa tiket)
 *
 * Logika aturan berada di src/lib/alert-engine.ts — dipakai bersama dengan
 * scheduler pengiriman harian (src/lib/alert-scheduler.ts) agar tidak ada
 * dua versi aturan yang berbeda.
 */
export async function GET() {
  try {
    const hasil = await jalankanAlertEngine()
    return NextResponse.json(hasil)
  } catch (error) {
    console.error('Alerts API error:', error)
    return NextResponse.json({ error: 'Gagal menjalankan alert engine' }, { status: 500 })
  }
}
