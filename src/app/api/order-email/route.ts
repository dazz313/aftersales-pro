import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logAudit, generateNoTiketEmail } from '@/lib/audit'
import { autoGitBackup } from '@/lib/git-backup'
import { getActiveSession } from '@/lib/auth-server'

// POST /api/order-email — INPUT PART KURANG (kekurangan sparepart) per unit.
// Sekali simpan → LANGSUNG TERBIT kode service: tiket ServiceRequest berstatus
// "REQUEST_EMAIL" masuk daftar tiket service lengkap dengan baris part-nya, dan
// tiap part menempel ke tiket sebagai item email (PENDING) via OrderEmailPart.
// Di daftar tiket tersedia aksi Kirim Email & Upload Lampiran; data ini pula
// yang melengkapi tabel "Daftar Part yang Kurang" di PDF Detail Unit.
export async function POST(request: Request) {
  try {
    const session = await getActiveSession(request)
    if (!session) {
      return NextResponse.json({ error: 'Sesi berakhir atau akun nonaktif. Silakan login ulang.' }, { status: 401 })
    }

    const body = (await request.json().catch(() => null)) as {
      unitAssetId?: number
      catatan?: string
      aktor?: string
      rows?: { kodePart?: string; namaPart?: string; qty?: number }[]
    } | null
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Payload tidak valid' }, { status: 400 })
    }

    const unitAssetId = Number(body.unitAssetId)
    if (!Number.isFinite(unitAssetId) || unitAssetId <= 0) {
      return NextResponse.json({ error: 'Unit tidak valid' }, { status: 400 })
    }
    const unit = await db.unitAsset.findUnique({ where: { id: unitAssetId }, include: { toko: true } })
    if (!unit) return NextResponse.json({ error: 'Unit tidak ditemukan' }, { status: 404 })

    const masuk = Array.isArray(body.rows) ? body.rows.filter((r) => r && typeof r === 'object') : []
    if (masuk.length === 0) {
      return NextResponse.json({ error: 'Minimal satu part — kode & nama part wajib diisi' }, { status: 400 })
    }
    const bersih: { kodePart: string; namaPart: string; qty: number }[] = []
    for (let i = 0; i < masuk.length; i++) {
      const kode = (masuk[i].kodePart ?? '').trim().toUpperCase()
      const nama = (masuk[i].namaPart ?? '').trim()
      const qty = Number(masuk[i].qty)
      if (!kode || !nama) {
        return NextResponse.json({ error: `Baris ${i + 1}: kode & nama part wajib diisi` }, { status: 400 })
      }
      if (!(qty > 0) || !Number.isFinite(qty)) {
        return NextResponse.json({ error: `Baris ${i + 1}: jumlah harus lebih dari 0` }, { status: 400 })
      }
      if (bersih.some((b) => b.kodePart === kode)) {
        return NextResponse.json(
          { error: `Part ${kode} dimasukkan dua kali — gabungkan jumlahnya jadi satu baris` },
          { status: 409 }
        )
      }
      bersih.push({ kodePart: kode, namaPart: nama, qty: Math.floor(qty) })
    }

    // Kode service khusus tiket REQUEST EMAIL: SV-EM-YYYYMMDD-XXXX — pembeda
    // "order part via email" yang pendek & langsung dikenali; sekuens harian
    // sendiri, tidak mencampur nomor tiket service biasa (SV-YYYYMMDD-XXXX).
    const noTiket = await generateNoTiketEmail()
    const catatan = (body.catatan ?? '').trim()
    const aktor = body.aktor?.trim() || session.nama

    const hasil = await db.$transaction(async (tx) => {
      // Kode manual → daftarkan ke katalog bila belum ada (pola sama dgn input part tiket)
      const resolved: { spId: number; qty: number; kode: string; nama: string }[] = []
      for (const b of bersih) {
        let sp = await tx.masterSparepart.findUnique({ where: { kodePart: b.kodePart } })
        if (!sp) {
          sp = await tx.masterSparepart.create({
            data: {
              kodePart: b.kodePart,
              namaPart: b.namaPart,
              brandKompatibel: unit.merk || '-',
              supplier: 'PRODUSEN',
            },
          })
        }
        resolved.push({ spId: sp.id, qty: b.qty, kode: b.kodePart, nama: b.namaPart })
      }

      // Tiket REQUEST EMAIL — tampil di daftar tiket service berstatus "REQUEST EMAIL"
      const tiket = await tx.serviceRequest.create({
        data: {
          noTiket,
          unitAssetId: unit.id,
          status: 'REQUEST_EMAIL',
          sumberLaporan: 'MANUAL',
          tipeCustomer: unit.tokoId ? 'TOKO' : 'PERORANGAN',
          lokasiUnit: 'TOKO',
          penanganan: 'BELUM',
          deskripsiKerusakan: catatan || `Kekurangan part: ${resolved.map((r) => r.kode).join(', ')}`,
          biayaJasa: 0,
          parts: {
            create: resolved.map((r) => ({
              sparepartId: r.spId,
              qty: r.qty,
              statusPart: 'ORDER_PRODUSEN',
              statusKonfirmasi: 'MENUNGGU',
              sumberPart: 'PRODUSEN',
            })),
          },
        },
      })

      // Item email per part (PENDING) menempel ke tiket → dipakai aksi Kirim Email
      const items: { id: number; kodePart: string; namaPart: string; qty: number }[] = []
      for (const r of resolved) {
        const it = await tx.orderEmailPart.create({
          data: {
            kodePart: r.kode,
            namaPart: r.nama,
            qty: r.qty,
            unitAssetId: unit.id,
            serialNumber: unit.serialNumber || null,
            modelUnit: unit.modelUnit || null,
            tokoKode: unit.toko?.kodeToko ?? null,
            tokoNama: unit.toko?.namaToko ?? null,
            catatan: catatan || null,
            diinputOleh: aktor,
            status: 'PENDING',
            serviceRequestId: tiket.id,
          },
        })
        items.push(it)
      }

      return { tiket, items }
    })

    await logAudit({
      aksi: 'SUBMIT',
      entitas: 'order-email-part',
      entitasId: String(hasil.tiket.noTiket),
      deskripsi: `Input part kurang unit ${unit.serialNumber || unit.modelUnit || unit.id}: ${hasil.items
        .map((it) => `${it.kodePart} ×${it.qty}`)
        .join(', ')} — tiket ${hasil.tiket.noTiket} (REQUEST EMAIL) terbit otomatis`,
      aktor,
    })
    await autoGitBackup('INPUT_PART_KURANG', 'service_request', hasil.tiket.noTiket, aktor)

    return NextResponse.json(
      {
        ok: true,
        noTiket: hasil.tiket.noTiket,
        serviceRequestId: hasil.tiket.id,
        tersimpan: hasil.items.length,
        items: hasil.items.map((it) => ({ id: it.id, kodePart: it.kodePart, namaPart: it.namaPart, qty: it.qty })),
      },
      { status: 201 }
    )
  } catch (error) {
    console.error('Order email POST error:', error)
    return NextResponse.json({ error: 'Gagal menyimpan input part kurang' }, { status: 500 })
  }
}
