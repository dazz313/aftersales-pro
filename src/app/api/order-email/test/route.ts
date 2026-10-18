import { NextResponse } from 'next/server'
import { logAudit } from '@/lib/audit'
import { getActiveSession } from '@/lib/auth-server'
import { konfigurasiEmail, kirimSmtp } from '@/lib/order-email'

// POST /api/order-email/test — uji kirim email (Pengaturan → Email Produsen).
// Mengirim email "tes" ke alamat tujuan produsen (atau alamat pengirim bila tujuan kosong).
export async function POST(request: Request) {
  try {
    const session = await getActiveSession(request)
    if (!session) {
      return NextResponse.json({ error: 'Sesi berakhir atau akun nonaktif. Silakan login ulang.' }, { status: 401 })
    }
    const cfg = await konfigurasiEmail()
    const ke = cfg.ke || cfg.dari
    if (!cfg.host || !cfg.user || !cfg.pass || !cfg.dari) {
      return NextResponse.json(
        { ok: false, error: 'SMTP belum lengkap — isi SMTP Host, User, Password & Pengirim (Dari) di Pengaturan → Email Produsen.' },
        { status: 409 }
      )
    }
    if (!ke) {
      return NextResponse.json(
        { ok: false, error: 'Email tujuan produsen belum diisi — isi dulu kolom "Email Produsen".' },
        { status: 409 }
      )
    }
    const info = await kirimSmtp(
      { ...cfg, ke },
      'TES — AfterSales Pro (konfigurasi Email Produsen)',
      `Email ini dikirim otomatis sebagai uji konfigurasi SMTP di Pengaturan → Email Produsen.\n` +
        `Jika email ini masuk ke kotak masuk ${ke}, pengiriman order kekurangan sparepart siap dipakai.`
    )
    await logAudit({
      aksi: 'TEST_EMAIL_PRODUSEN',
      entitas: 'pengaturan',
      deskripsi: `Uji kirim email produsen ke ${ke} berhasil`,
      aktor: session.nama,
    })
    return NextResponse.json({ ok: true, ke, detail: info.messageId ?? 'terkirim' })
  } catch (error) {
    const err = error instanceof Error ? error.message : String(error)
    console.error('OrderEmail test error:', err)
    return NextResponse.json({ ok: false, error: err }, { status: 500 })
  }
}
