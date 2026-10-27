import { db } from '@/lib/db'

// Helper server: konfigurasi EMAIL PRODUSEN untuk kekurangan sparepart.
// - Email tujuan diset di Pengaturan (kunci `email_produsen`).
// - Detail unit + daftar part yang kurang dibuat sebagai PDF dari
//   Master Barcode/Unit → tombol "Aksi" → "PDF Detail Unit", lalu
//   dilampirkan saat mengirim email ke produsen.
// - `kirimSmtp` dipakai untuk UJI KIRIM konfigurasi SMTP dari Pengaturan.

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

/** Kirim email lewat SMTP yang dikonfigurasi (dipakai uji kirim & aksi Kirim Email tiket REQUEST EMAIL). */
export async function kirimSmtp(
  cfg: KonfigurasiEmail,
  subjek: string,
  isi: string,
  lampiran?: { path: string; filename: string }
): Promise<{ messageId?: string }> {
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
    ...(lampiran ? { attachments: [{ path: lampiran.path, filename: lampiran.filename }] } : {}),
  })
  return { messageId: info?.messageId }
}

/** Susun subjek + isi email order part kurang untuk tiket REQUEST EMAIL (dipakai aksi Kirim Email). */
export function susunEmailOrder(params: {
  noTiket: string
  serialNumber: string | null
  modelUnit: string | null
  merk: string | null
  tokoNama: string | null
  catatan: string | null
  lampiranNama: string | null
  items: { kodePart: string; namaPart: string; qty: number; status?: string }[]
}): { subjek: string; isi: string } {
  const { noTiket, serialNumber, modelUnit, merk, tokoNama, catatan, lampiranNama, items } = params
  const subjek = `ORDER SPAREPART ${noTiket} — Kekurangan Part (${items.length} item)`
  const baris = items.map((it, i) => `${i + 1}. ${it.kodePart} — ${it.namaPart} ×${it.qty}${it.status ? ` (${it.status})` : ''}`)
  const isi = [
    `Order kekurangan sparepart ${noTiket}.`,
    '',
    'DETAIL UNIT:',
    `- Merk     : ${merk || '-'}`,
    `- Model    : ${modelUnit || '-'}`,
    `- No. Seri : ${serialNumber || '-'}`,
    `- Toko     : ${tokoNama || '-'}`,
    '',
    'PART YANG KURANG:',
    ...baris,
    ...(catatan ? ['', `Catatan: ${catatan}`] : []),
    ...(lampiranNama ? ['', `Lampiran terlampir: ${lampiranNama}`] : ['', 'Lampiran: PDF detail unit (dapat di-upload pada tiket).']),
    '',
    'Mohon konfirmasi harga & ketersediaan. Terima kasih.',
  ].join('\n')
  return { subjek, isi }
}

/** Susun pesan order part kurang untuk WHATSAPP (dipakai aksi Kirim WA).
 *  Format ringkas & ramah WA — item dirapikan per baris, pakai *bold* Markdown WA. */
export function susunPesanWaOrder(params: {
  noTiket: string
  serialNumber: string | null
  modelUnit: string | null
  merk: string | null
  tokoNama: string | null
  catatan: string | null
  items: { kodePart: string; namaPart: string; qty: number }[]
}): string {
  const { noTiket, serialNumber, modelUnit, merk, tokoNama, catatan, items } = params
  const baris = items.map((it, i) => `${i + 1}. ${it.kodePart} — ${it.namaPart} ×${it.qty}`)
  return [
    `*ORDER SPAREPART ${noTiket}* — Kekurangan Part (${items.length} item)`,
    '',
    `📝 Detail unit:`,
    `- Merk     : ${merk || '-'}`,
    `- Model    : ${modelUnit || '-'}`,
    `- No. Seri : ${serialNumber || '-'}`,
    `- Toko     : ${tokoNama || '-'}`,
    '',
    `🧾 *PART YANG KURANG:*`,
    ...baris,
    ...(catatan ? ['', `Catatan: ${catatan}`] : []),
    '',
    'Mohon konfirmasi harga & ketersediaan. Terima kasih 🙏',
  ].join('\n')
}

