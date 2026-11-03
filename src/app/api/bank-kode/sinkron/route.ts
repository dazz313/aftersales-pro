import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { requireActiveSession } from '@/lib/auth-server'
import { catatBankKode } from '@/lib/bank-kode'

// POST /api/bank-kode/sinkron — tarik SEMUA kode yang pernah diinput di aplikasi
// ke Bank Kode:
//  · katalog sparepart (master)
//  · semua baris part di tiket service (termasuk cache kode/nama)
//  · order customer (permintaan order)
//  · item order-email ke produsen
// Idempoten: aman dijalankan kapan pun, baris lama tidak ditimpa.
//
// Catatan: model TIDAK diisi dari unit tiket di sini. Satu part bisa dipakai
// beberapa model; menyalin model unit ke kolom model akan menyesatkan. Pencarian
// model tetap bekerja karena nama part ikut dinilai (mis. "Top Plate RI 202 S").
export async function POST(request: Request) {
  try {
    const { denied } = await requireActiveSession(request)
    if (denied) return denied
    const body = (await request.json().catch(() => ({}))) as { aktor?: string }
    const aktor = String(body.aktor ?? 'SYSTEM')

    const [parts, serviceParts, orders, emailParts] = await Promise.all([
      db.masterSparepart.findMany(),
      db.serviceRequestPart.findMany({ include: { sparepart: true } }),
      db.permintaanOrder.findMany({ select: { kodePart: true, namaPart: true, brand: true } }),
      db.orderEmailPart.findMany({ select: { kodePart: true, namaPart: true, brand: true } }),
    ])

    let baru = 0
    let dilengkapi = 0
    const catat = async (hasil: 'baru' | 'dilengkapi' | 'sudah-ada') => {
      if (hasil === 'baru') baru++
      else if (hasil === 'dilengkapi') dilengkapi++
    }

    // 1) Baris part di tiket — termasuk cache kode/nama untuk master yang sudah
    //    berubah/dihapus. Sumber PRODUSEN dipertahankan sebagai penanda.
    for (const sp of serviceParts) {
      const kode = sp.sparepart?.kodePart ?? sp.kodePartCache ?? ''
      const nama = sp.sparepart?.namaPart ?? sp.namaPartCache ?? ''
      if (!kode) continue
      await catat(
        await catatBankKode({
          kode,
          namaPart: nama,
          brandKompatibel: sp.sparepart?.brandKompatibel ?? '',
          produsen: sp.sparepart?.supplier ?? '',
          sumber: sp.sumberPart === 'PRODUSEN' ? 'PRODUSEN' : 'KATALOG',
        }),
      )
    }

    // 2) Item order-email produsen.
    for (const e of emailParts) {
      await catat(
        await catatBankKode({
          kode: e.kodePart,
          namaPart: e.namaPart,
          brandKompatibel: e.brand ?? '',
          sumber: 'ORDER',
        }),
      )
    }

    // 3) Katalog sparepart — semua kode yang pernah diinput (termasuk stok).
    for (const p of parts) {
      await catat(
        await catatBankKode({
          kode: p.kodePart,
          namaPart: p.namaPart,
          brandKompatibel: p.brandKompatibel,
          produsen: p.supplier,
          sumber: 'KATALOG',
        }),
      )
    }

    // 4) Permintaan order customer.
    for (const o of orders) {
      await catat(
        await catatBankKode({
          kode: o.kodePart,
          namaPart: o.namaPart,
          brandKompatibel: o.brand,
          sumber: 'ORDER',
        }),
      )
    }

    const total = await db.bankKode.count()
    await logAudit({
      aksi: 'SINKRON_BANK_KODE',
      entitas: 'bank_kode',
      deskripsi: `Sinkron bank kode: ${baru} kode baru, ${dilengkapi} dilengkapi dari ${serviceParts.length} part tiket + ${emailParts.length} order-email + ${parts.length} katalog + ${orders.length} order (total bank: ${total})`,
      aktor,
    })
    return NextResponse.json({ baru, dilengkapi, total })
  } catch (error) {
    console.error('BankKode sinkron error:', error)
    return NextResponse.json({ error: 'Gagal menyinkron bank kode' }, { status: 500 })
  }
}
