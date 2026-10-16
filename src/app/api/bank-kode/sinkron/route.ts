import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { requireActiveSession } from '@/lib/auth-server'
import { catatBankKode } from '@/lib/bank-kode'

// POST /api/bank-kode/sinkron — tarik SEMUA kode yang pernah diinput di aplikasi
// (katalog sparepart, balasan produsen di tiket, order customer) ke Bank Kode.
// Idempoten: aman dijalankan kapan pun, baris lama tidak ditimpa.
export async function POST(request: Request) {
  try {
    const { denied } = await requireActiveSession(request)
    if (denied) return denied
    const body = (await request.json().catch(() => ({}))) as { aktor?: string }
    const aktor = String(body.aktor ?? 'SYSTEM')

    const [parts, produsenParts, orders] = await Promise.all([
      db.masterSparepart.findMany(),
      db.serviceRequestPart.findMany({
        where: { sumberPart: 'PRODUSEN' },
        include: { sparepart: true },
      }),
      db.permintaanOrder.findMany({ select: { kodePart: true, namaPart: true, brand: true } }),
    ])

    let baru = 0
    let dilengkapi = 0
    for (const p of parts) {
      const r = await catatBankKode({
        kode: p.kodePart,
        namaPart: p.namaPart,
        brandKompatibel: p.brandKompatibel,
        produsen: p.supplier,
        sumber: 'KATALOG',
      })
      if (r === 'baru') baru++
      else if (r === 'dilengkapi') dilengkapi++
    }
    for (const sp of produsenParts) {
      if (!sp.sparepart) continue
      const r = await catatBankKode({
        kode: sp.sparepart.kodePart,
        namaPart: sp.sparepart.namaPart,
        brandKompatibel: sp.sparepart.brandKompatibel,
        produsen: sp.sparepart.supplier,
        sumber: 'PRODUSEN',
      })
      if (r === 'baru') baru++
      else if (r === 'dilengkapi') dilengkapi++
    }
    for (const o of orders) {
      const r = await catatBankKode({ kode: o.kodePart, namaPart: o.namaPart, brandKompatibel: o.brand, sumber: 'ORDER' })
      if (r === 'baru') baru++
      else if (r === 'dilengkapi') dilengkapi++
    }

    const total = await db.bankKode.count()
    await logAudit({
      aksi: 'SINKRON_BANK_KODE',
      entitas: 'bank_kode',
      deskripsi: `Sinkron bank kode: ${baru} kode baru, ${dilengkapi} dilengkapi dari ${parts.length} katalog + ${produsenParts.length} balasan produsen + ${orders.length} order (total bank: ${total})`,
      aktor,
    })
    return NextResponse.json({ baru, dilengkapi, total })
  } catch (error) {
    console.error('BankKode sinkron error:', error)
    return NextResponse.json({ error: 'Gagal menyinkron bank kode' }, { status: 500 })
  }
}
