import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { autoGitBackup } from '@/lib/git-backup'
import { requireActiveSession } from '@/lib/auth-server'

/**
 * POST /api/nota/dari-tiket
 * Body: { noTiket, cariBuat?: boolean }
 *
 * "Pada saat ajukan klaim, muncul duplikasi nota yang SUDAH TERISI DATA dan
 * bisa edit manual" — endpoint ini menerjemahkan tiket service (ServiceRequest)
 * menjadi nota BASS terisi: nama toko/customer, merk, model, no seri, tgl beli,
 * garansi, tanggal tiket, pengaduan, kelengkapan, dan suku cadang yang dipakai
 * (harga satuan = hargaKlaim part). Semua kolom tetap boleh diedit manual di
 * form nota setelahnya.
 *
 * cariBuat=true: bila nota klaim untuk tiket ini pernah dibuat (di Aquarius
 * audit log), pakai ulang nota itu — tidak membuat duplikat baru setiap kali
 * tombol "Ajukan" ditekan berulang.
 */
export async function POST(request: Request) {
  try {
    const sesi = await requireActiveSession(request)
    if (sesi.denied || !sesi.session) return sesi.denied ?? NextResponse.json({ error: 'Sesi aktif dibutuhkan' }, { status: 401 })
    const session = sesi.session
    const body = (await request.json()) as { noTiket?: unknown; cariBuat?: unknown }
    const noTiket = String(body.noTiket ?? '').trim()
    if (!noTiket) return NextResponse.json({ error: 'noTiket wajib diisi' }, { status: 400 })

    const tiket = await db.serviceRequest.findFirst({
      where: { noTiket },
      include: {
        parts: { include: { sparepart: { select: { kodePart: true, namaPart: true, hargaKlaim: true } } } },
      },
    })
    if (!tiket) return NextResponse.json({ error: `Tiket ${noTiket} tidak ditemukan` }, { status: 404 })

    // --- Cari ulang nota klaim tiket ini bila pernah dibuat ---
    if (body.cariBuat === true) {
      const marker = `|T:${noTiket}|`
      const audit = await db.auditLog.findFirst({
        where: { entitas: 'nota', aksi: 'CREATE_NOTA', deskripsi: { contains: marker } },
        orderBy: { createdAt: 'desc' },
      })
      const idLama = audit?.entitasId ? Number(audit.entitasId) : NaN
      if (Number.isInteger(idLama)) {
        const notaLama = await db.nota.findUnique({ where: { id: idLama }, include: { items: true } })
        if (notaLama) return NextResponse.json({ ...notaLama, dibuatBaru: false })
      }
    }

    // --- Nomor BASS baru: nominal maksimal + 1 (pad 6 digit) ---
    const semua = await db.nota.findMany({ select: { nomorBass: true } })
    const max = semua.reduce((acc, n) => Math.max(acc, Number(n.nomorBass) || 0), 0)
    let nomorBass = String(max + 1).padStart(6, '0')
    while (await db.nota.findUnique({ where: { nomorBass } })) {
      nomorBass = String(Number(nomorBass) + 1).padStart(6, '0')
    }

    // --- Prefilled dari data tiket & unit ---
    const unit = tiket ? await db.unitAsset.findUnique({ where: { id: tiket.unitAssetId }, include: { toko: true, customer: true } }) : null
    const toko = unit?.toko ?? null
    const customer = unit?.customer ?? null
    const po = (dt: Date | null | undefined) => {
      if (!dt) return null
      const d = new Date(dt)
      const p = (n: number) => String(n).padStart(2, '0')
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
    }
    const pt = (dt: Date | null | undefined) => {
      if (!dt) return null
      const d = new Date(dt)
      const p = (n: number) => String(n).padStart(2, '0')
      return `${p(d.getHours())}:${p(d.getMinutes())}`
    }
    const kelengkapan = tiket.parts
      .filter((p) => p.sparepart)
      .map((p) => `${p.sparepart?.kodePart ?? ''} ${p.sparepart?.namaPart ?? ''} ×${p.qty}`.trim())
      .join('\n')

    const nota = await db.nota.create({
      data: {
        nomorBass,
        lokasi: 'Indoor',
        tanggal: po(tiket.tglTiket),
        jamMasuk: pt(tiket.createdAt),
        nama: toko?.namaToko ?? customer?.nama ?? unit?.nama ?? '',
        alamat: toko?.alamat ?? null,
        telp: toko?.kontak ?? null,
        hp: null,
        merk: unit?.merk ?? null,
        lp: null,
        model: unit?.modelUnit ?? null,
        noSeri: unit?.serialNumber ?? null,
        tglBeli: po(unit?.tglPembelian ?? null),
        garansi: unit && unit.statusGaransi === 'NON_GARANSI' ? 'Tdk' : 'Ya',
        tglSelesai: po(tiket.tglFinish),
        jamSelesai: pt(tiket.tglFinish),
        pengaduan: tiket.deskripsiKerusakan || unit?.kerusakanAwal || null,
        kelengkapan: kelengkapan || null,
        penyebab: null,
        perbaikan: null,
        biayaService: tiket.biayaJasa ?? 0,
        items: {
          create: tiket.parts
            .filter((p) => p.sparepart)
            .map((p) => ({
              kode: p.sparepart?.kodePart ?? null,
              nama: p.sparepart?.namaPart ?? null,
              harga: p.sparepart?.hargaKlaim ?? 0,
              qty: p.qty,
            })),
        },
        status: 'draft',
      },
      include: { items: true },
    })

    await logAudit({
      entitas: 'nota',
      aksi: 'CREATE_NOTA',
      entitasId: String(nota.id),
      deskripsi: `Nota BASS ${nota.nomorBass} dibuat dari klaim tiket ${noTiket} |T:${noTiket}| — ${nota.nama}`,
      aktor: session.nama,
    })
    await autoGitBackup('CREATE', 'nota', nota.nomorBass, session.nama)
    return NextResponse.json({ ...nota, dibuatBaru: true }, { status: 201 })
  } catch (error) {
    console.error('Nota dari-tiket error:', error)
    return NextResponse.json({ error: 'Gagal membuat nota dari tiket' }, { status: 500 })
  }
}
