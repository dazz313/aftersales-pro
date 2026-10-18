import { db } from '@/lib/db'

// Helper server: order kekurangan sparepart VIA EMAIL ke produsen.
// - Email tujuan diset di Pengaturan (kunci `email_produsen`).
// - Pengiriman otomatis via SMTP (kunci `smtp_host`, `smtp_port`, `smtp_user`,
//   `smtp_password`, `smtp_secure`, `smtp_dari`) bila dikonfigurasi.
// - Bila SMTP belum diset/kirim gagal → kembalikan draf `mailto:` yang bisa
//   dibuka di aplikasi email pengguna (status tetap PENDING sampai benar-benar terkirim).

export interface ItemOrderEmail {
  id: number
  kodePart: string
  namaPart: string
  qty: number
  serialNumber?: string | null
  modelUnit?: string | null
  tokoKode?: string | null
  tokoNama?: string | null
  catatan?: string | null
}

interface KonfigurasiEmail {
  ke: string
  dari: string
  host: string
  port: number
  user: string
  pass: string
  secure: boolean
}

export async function konfigurasiEmail(): Promise<KonfigurasiEmail> {
  const rows = await db.pengaturan.findMany({
    where: { kunci: { in: ['email_produsen', 'smtp_dari', 'smtp_host', 'smtp_port', 'smtp_user', 'smtp_password', 'smtp_secure'] } },
  })
  const m = new Map(rows.map((r) => [r.kunci, r.nilai]))
  return {
    ke: (m.get('email_produsen') ?? '').trim(),
    dari: (m.get('smtp_dari') ?? '').trim(),
    host: (m.get('smtp_host') ?? '').trim(),
    port: Number(m.get('smtp_port')) || 587,
    user: (m.get('smtp_user') ?? '').trim(),
    pass: m.get('smtp_password') ?? '',
    secure: (m.get('smtp_secure') ?? '') === '1' || /^465$/.test(String(m.get('smtp_port') ?? '')),
  }
}

/** Teks isi email order (juga dipakai untuk draf mailto). */
export function buatTeksOrder(items: ItemOrderEmail[]): string {
  const tgl = new Date().toLocaleString('id-ID', { dateStyle: 'full', timeStyle: 'short' })
  const total = items.reduce((n, i) => n + i.qty, 0)
  const baris = items
    .map((i, idx) => {
      const unit = i.serialNumber ? ` (unit ${i.modelUnit ?? ''} SN ${i.serialNumber}${i.tokoNama ? `, ${i.tokoNama}` : ''})` : ''
      const ket = i.catatan ? ` — ${i.catatan}` : ''
      return `${idx + 1}. ${i.kodePart} · ${i.namaPart} × ${i.qty}${unit}${ket}`
    })
    .join('\n')
  return (
    `Kepada Yth. Produsen,\n\n` +
    `Mohon bantuan order sparepart berikut untuk unit service kami:\n\n` +
    `${baris}\n\n` +
    `Total item: ${items.length} (qty ${total})\n` +
    `Dikirim otomatis: ${tgl}\n\n` +
    `Terima kasih.\nAfterSales Pro — Workshop After-Sales`
  )
}

export function buatSubjekOrder(items: ItemOrderEmail[]): string {
  return `ORDER SPAREPART — Kekurangan Part (${items.length} item) — ${new Date().toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })}`
}

export async function kirimSmtp(cfg: KonfigurasiEmail, subjek: string, isi: string): Promise<{ messageId?: string }> {
  if (!cfg.host || !cfg.user || !cfg.pass) {
    throw new Error('SMTP belum dikonfigurasi — isi SMTP Host, User & Password di Pengaturan → Email Produsen')
  }
  if (!cfg.dari) throw new Error('Alamat pengirim (SMTP Dari) belum diisi — Pengaturan → Email Produsen')
  const nodemailer = await import('nodemailer')
  const transporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: cfg.user, pass: cfg.pass },
  })
  const info = await transporter.sendMail({
    from: cfg.dari,
    to: cfg.ke,
    subject: subjek,
    text: isi,
  })
  return { messageId: info?.messageId }
}

/** Kunci kredensial SMTP pernah diset? (membedakan "belum diset" vs "gagal kirim") */
async function smtpTerisi(cfg: KonfigurasiEmail): Promise<boolean> {
  return !!cfg.host && !!cfg.user && !!cfg.pass
}

/**
 * Kirim email order berisi item-item terpilih (default: semua PENDING).
 * - SMTP terkirim → item berubah TERKIRIM (emailKirimAt/Oleh/Mode terisi).
 * - SMTP belum diset → item tetap PENDING + hasil berisi draf mailto (mode MAILTO).
 * - SMTP gagal → gagal dicatat ke emailPesanGagal + hasil berisi draf mailto (mode SMTP_GAGAL).
 */
export async function prosesKirimOrderEmail(
  itemIds: number[] | null,
  aktor: string
): Promise<{ mode: 'SMTP' | 'MAILTO' | 'SMTP_GAGAL'; terkirim: number; mailto?: string; error?: string; ke?: string }> {
  const items = await db.orderEmailPart.findMany({
    where: itemIds && itemIds.length > 0 ? { id: { in: itemIds } } : { status: 'PENDING' },
    orderBy: { id: 'asc' },
  })
  if (items.length === 0) {
    return { mode: 'MAILTO', terkirim: 0, error: 'Tidak ada item untuk dikirim (semua sudah TERKIRIM/SELESAI).' }
  }

  const cfg = await konfigurasiEmail()
  const subjek = buatSubjekOrder(items)
  const isi = buatTeksOrder(items)

  if (await smtpTerisi(cfg)) {
    if (!cfg.ke) {
      const err = 'Email tujuan produsen (email_produsen) belum diisi — Pengaturan → Email Produsen'
      await db.orderEmailPart.updateMany({
        where: { id: { in: items.map((i) => i.id) } },
        data: { emailPesanGagal: err },
      })
      return { mode: 'SMTP_GAGAL', terkirim: 0, error: err }
    }
    try {
      await kirimSmtp(cfg, subjek, isi)
      await db.orderEmailPart.updateMany({
        where: { id: { in: items.map((i) => i.id) } },
        data: {
          status: 'TERKIRIM',
          emailTujuan: cfg.ke,
          emailKirimAt: new Date(),
          emailOleh: aktor,
          emailMode: 'SMTP',
          emailPesanGagal: null,
        },
      })
      return { mode: 'SMTP', terkirim: items.length, ke: cfg.ke }
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e)
      await db.orderEmailPart.updateMany({
        where: { id: { in: items.map((i) => i.id) } },
        data: { emailPesanGagal: `SMTP gagal: ${err}`.slice(0, 300) },
      })
      return { mode: 'SMTP_GAGAL', terkirim: 0, error: err }
    }
  }

  // SMTP belum diset → kembalikan draf mailto (item tetap PENDING)
  const mailto: string = cfg.ke
    ? `mailto:${encodeURIComponent(cfg.ke)}?subject=${encodeURIComponent(subjek)}&body=${encodeURIComponent(isi.replace(/\n/g, '\r\n'))}`
    : ''
  return {
    mode: 'MAILTO',
    terkirim: 0,
    mailto: mailto || undefined,
    error: cfg.ke
      ? undefined
      : 'SMTP belum diset dan Email Produsen belum diisi — isi dulu di Pengaturan → Email Produsen.',
    ke: cfg.ke || undefined,
  }
}
