import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { autoGitBackup } from '@/lib/git-backup'
import { requireActiveSession } from '@/lib/auth-server'
import { hitungBiayaNota } from '@/lib/nota'

/**
 * POST /api/nota/[id]/duplikat — duplikat nota lama jadi nota baru:
 * isi data konsumen/unit/pengaduan/suku cadang/biaya disalin, tanda tangan,
 * jam & status dikosongkan (nota menyegarkan). Nomor BASS otomatis terbit
 * (angka maksimum yang ada + 1) dan tetap bisa diedit manual di form.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const sesi = await requireActiveSession(request)
    if (sesi.denied || !sesi.session) return sesi.denied ?? NextResponse.json({ error: 'Sesi aktif dibutuhkan' }, { status: 401 })
    const session = sesi.session
    const { id } = await params
    const sumber = await db.nota.findUnique({ where: { id: Number(id) }, include: { items: true } })
    if (!sumber) return NextResponse.json({ error: 'Nota sumber tidak ditemukan' }, { status: 404 })

    // Nomor BASS baru: nominal maksimal + 1 (pad 6 digit); cepat unik.
    const semua = await db.nota.findMany({ select: { nomorBass: true } })
    const max = semua.reduce((acc, n) => Math.max(acc, Number(n.nomorBass) || 0), 0)
    let nomorBass = String(max + 1).padStart(6, '0')
    while (await db.nota.findUnique({ where: { nomorBass } })) {
      nomorBass = String(Number(nomorBass) + 1).padStart(6, '0')
    }

    const d = new Date()
    const p = (n: number) => String(n).padStart(2, '0')
    const hariIni = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
    const jamSekarang = `${p(d.getHours())}:${p(d.getMinutes())}`

    const nota = await db.nota.create({
      data: {
        nomorBass,
        lokasi: sumber.lokasi,
        tanggal: hariIni,
        jamMasuk: jamSekarang,
        nama: sumber.nama,
        alamat: sumber.alamat,
        telp: sumber.telp,
        hp: sumber.hp,
        merk: sumber.merk,
        lp: sumber.lp,
        model: sumber.model,
        noSeri: sumber.noSeri,
        tglBeli: sumber.tglBeli,
        garansi: sumber.garansi,
        pengaduan: sumber.pengaduan,
        kelengkapan: sumber.kelengkapan,
        penyebab: sumber.penyebab,
        perbaikan: sumber.perbaikan,
        biayaService: sumber.biayaService,
        biayaTransportasi: sumber.biayaTransportasi,
        ppnPersen: sumber.ppnPersen,
        // Tanda tangan, tanggal selesai/ambil & status DISEGARKAN — nota baru polos.
        // total: dihitung ulang dari data asal agar override manual reset.
        total: hitungBiayaNota({
          garansi: sumber.garansi,
          biayaService: sumber.biayaService,
          biayaTransportasi: sumber.biayaTransportasi,
          ppnPersen: sumber.ppnPersen,
          total: null,
          items: sumber.items,
        }).total,
        items: {
          create: sumber.items.map((it) => ({ kode: it.kode, nama: it.nama, harga: it.harga, qty: it.qty })),
        },
        status: 'draft',
      },
      include: { items: true },
    })

    await logAudit({
      aksi: 'DUPLICATE_NOTA',
      entitas: 'nota',
      entitasId: String(nota.id),
      deskripsi: `Nota BASS ${nota.nomorBass} diduplikat dari nota ${sumber.nomorBass} (${sumber.nama})`,
      aktor: session.nama,
    })
    await autoGitBackup('CREATE', 'nota', nota.nomorBass, session.nama)
    return NextResponse.json(nota, { status: 201 })
  } catch (error) {
    console.error('Nota DUPLICATE error:', error)
    return NextResponse.json({ error: 'Gagal menduplikasi nota' }, { status: 500 })
  }
}
