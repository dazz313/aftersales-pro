/**
 * Seed data untuk Sistem After-Sales & Inventory Management
 * Berdasarkan PRD: Systems Automation for After-Sales Operations & Inventory Management
 */
import { PrismaClient } from '@prisma/client'
import { randomBytes, scryptSync } from 'node:crypto'

const prisma = new PrismaClient()

/** Hash password scrypt (format sama dengan src/lib/auth-node.ts) */
function hashPassword(plain: string): string {
  const salt = randomBytes(16)
  const hash = scryptSync(plain, salt, 64)
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`
}
const PW_ADMIN = hashPassword('admin123')
const PW_DEFAULT = hashPassword('aftersales123')

function daysAgo(n: number): Date {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d
}

async function main() {
  console.log('🌱 Seeding database...')

  // Reset urutan tabel (urutan penting karena FK)
  await prisma.auditLog.deleteMany()
  await prisma.waMessage.deleteMany()
  await prisma.serviceRequestPart.deleteMany()
  await prisma.serviceRequest.deleteMany()
  await prisma.kunjungan.deleteMany()
  await prisma.unitAsset.deleteMany()
  await prisma.masterSparepart.deleteMany()
  await prisma.masterCustomer.deleteMany()
  await prisma.masterToko.deleteMany()
  await prisma.pengguna.deleteMany()
  await prisma.pengaturan.deleteMany()

  // ============ PENGATURAN / PROFILE PERUSAHAAN ============
  await prisma.pengaturan.createMany({
    data: [
      { kunci: 'nama_perusahaan', nilai: 'CV. Teknik Jaya Abadi Workshop' },
      { kunci: 'alamat_perusahaan', nilai: 'Jl. Industri Raya No. 45, Kawasan Industri MM2100, Bekasi, Jawa Barat 17520' },
      { kunci: 'telepon_perusahaan', nilai: '021-8990-1234' },
      { kunci: 'email_perusahaan', nilai: 'service@teknikjaya.co.id' },
      { kunci: 'partner_produsen', nilai: 'PT. Sinar Elektronik Mandiri (Produsen)' },
      { kunci: 'sla_jam_request', nilai: '24' },
      { kunci: 'batas_hari_klaim', nilai: '7' },
    ],
  })

  // ============ PENGGUNA / KARYAWAN ============
  const admin = await prisma.pengguna.create({
    data: { nama: 'Budi Santoso', email: 'budi@teknikjaya.co.id', username: 'budi', kodeTeknisi: 'TKN-001', passwordHash: PW_ADMIN, role: 'ADMIN_WORKSHOP', noWa: '6281234567890' },
  })
  const teknisi1 = await prisma.pengguna.create({
    data: { nama: 'Ahmad Fauzi', email: 'ahmad@teknikjaya.co.id', username: 'ahmad', kodeTeknisi: 'TKN-002', passwordHash: PW_DEFAULT, role: 'TEKNISI', noWa: '6281234567891', wilayahKerja: 'Jakarta Timur' },
  })
  const teknisi2 = await prisma.pengguna.create({
    data: { nama: 'Slamet Riyadi', email: 'slamet@teknikjaya.co.id', username: 'slamet', kodeTeknisi: 'TKN-003', passwordHash: PW_DEFAULT, role: 'TEKNISI', noWa: '6281234567892', wilayahKerja: 'Bekasi' },
  })
  const teknisi3 = await prisma.pengguna.create({
    data: { nama: 'Joko Prasetyo', email: 'joko@teknikjaya.co.id', username: 'joko', kodeTeknisi: 'TKN-004', passwordHash: PW_DEFAULT, role: 'TEKNISI', noWa: '6281234567893', wilayahKerja: 'Tangerang' },
  })
  await prisma.pengguna.create({
    data: { nama: 'Ir. Hartono Wijaya', email: 'hartono@teknikjaya.co.id', username: 'hartono', passwordHash: PW_DEFAULT, role: 'MANAGER', noWa: '6281234567894' },
  })
  await prisma.pengguna.create({
    data: { nama: 'PT. Sinar Elektronik Mandiri', email: 'service@sinaelektronik.co.id', username: 'produsen', passwordHash: PW_DEFAULT, role: 'PRODUSEN', noWa: '6281234567895' },
  })
  console.log('✅ Pengguna:', 6, '(login: email/username + password)')

  // ============ MASTER TOKO ============
  const tokoList = await Promise.all(
    [
      { kodeToko: 'TOK-001', namaToko: 'Toko Elektronik Maju Jaya', alamat: 'Jl. Mangga Dua Raya No. 12, Jakarta Pusat', kontak: '021-600-1122', frekuensiVisit: 7, tglVisitTerakhir: daysAgo(3) },
      { kodeToko: 'TOK-002', namaToko: 'Elektronik Berkah Sentosa', alamat: 'Jl. Raya Bekasi Km. 25, Bekasi Timur', kontak: '021-880-2233', frekuensiVisit: 14, tglVisitTerakhir: daysAgo(20) }, // TERLAMBAT (ALT-01)
      { kodeToko: 'TOK-003', namaToko: 'CV. Cahaya Elektronik', alamat: 'Jl. Pemuda No. 88, Rawamangun, Jakarta Timur', kontak: '021-475-3344', frekuensiVisit: 14, tglVisitTerakhir: daysAgo(10) },
      { kodeToko: 'TOK-004', namaToko: 'Toko Sumber Rejeki Audio', alamat: 'Jl. Juanda No. 5, Depok, Jawa Barat', kontak: '021-750-4455', frekuensiVisit: 30, tglVisitTerakhir: daysAgo(12) },
      { kodeToko: 'TOK-005', namaToko: 'Giant Elektronik Mall', alamat: 'Jl. Daan Mogot KM 18, Jakarta Barat', kontak: '021-550-5566', frekuensiVisit: 7, tglVisitTerakhir: daysAgo(9) }, // TERLAMBAT (ALT-01)
      { kodeToko: 'TOK-006', namaToko: 'Toserba Elektronik Nusantara', alamat: 'Jl. Ahmad Yani No. 210, Tangerang', kontak: '021-910-6677', frekuensiVisit: 14, tglVisitTerakhir: daysAgo(2) },
    ].map((t) => prisma.masterToko.create({ data: t }))
  )
  console.log('✅ Master Toko:', tokoList.length)

  // ============ MASTER CUSTOMER ============
  const customerList = await Promise.all(
    [
      { nama: 'Bpk. Hendra Gunawan', noWa: '6282111122233', alamat: 'Perum Green Garden Blok C2 No. 5, Jakarta Barat' },
      { nama: 'Ibu Siti Maryam', noWa: '6282111122244', alamat: 'Jl. Cempaka Putih Tengah XXI No. 30, Jakarta Pusat' },
      { nama: 'Kafe Kopi Kina (Kapten Arif)', noWa: '6282111122255', alamat: 'Jl. Kemang Selatan No. 8, Jakarta Selatan' },
      { nama: 'Bpk. Rudi Hartanto', noWa: '6282111122266', alamat: 'Jl. Delima Raya No. 17, Bekasi' },
      { nama: 'Warung Makan Bu Tini', noWa: '6282111122277', alamat: 'Jl. Raya Bogor KM 30, Cibinong' },
      { nama: 'Bpk. Darmawan Yusuf', noWa: '6282111122288', alamat: 'Jl. Cikini Raya No. 44, Jakarta Pusat' },
    ].map((c) => prisma.masterCustomer.create({ data: c }))
  )
  console.log('✅ Master Customer:', customerList.length)

  // ============ MASTER SPAREPART (INVENTORY) ============
  // 5 komponen utama: kodePart, namaPart, brandKompatibel, stokJual + stokGaransi, supplier
  const sparepartList = await Promise.all(
    [
      { kodePart: 'PRT-CMP-01', namaPart: 'Kompresor 1/2 PK R134a', brandKompatibel: 'Samsung, LG', supplier: 'PT Sinar Elektronik', stokJual: 6, stokGaransi: 2, stokInventory: 8, reorderLimit: 3, hargaKlaim: 850000 },
      { kodePart: 'PRT-CMP-02', namaPart: 'Kompresor 1 PK R32 Inverter', brandKompatibel: 'Daikin, Panasonic', supplier: 'PT Sinar Elektronik', stokJual: 2, stokGaransi: 0, stokInventory: 2, reorderLimit: 4, hargaKlaim: 1450000 }, // ROP ALERT (ALT-03)
      { kodePart: 'PRT-FAN-11', namaPart: 'Motor Fan Indoor 30W', brandKompatibel: 'Sharp, Polytron', supplier: 'CV Sparepart Jaya', stokJual: 12, stokGaransi: 3, stokInventory: 15, reorderLimit: 5, hargaKlaim: 320000 },
      { kodePart: 'PRT-PCB-A4', namaPart: 'PCB Main AC Split 1 PK', brandKompatibel: 'Samsung', supplier: 'PT Sinar Elektronik', stokJual: 0, stokGaransi: 0, stokInventory: 0, reorderLimit: 2, hargaKlaim: 780000 }, // KOSONG
      { kodePart: 'PRT-THR-07', namaPart: 'Thermistor NTC 10K', brandKompatibel: 'Universal', supplier: 'CV Sparepart Jaya', stokJual: 20, stokGaransi: 5, stokInventory: 25, reorderLimit: 10, hargaKlaim: 45000 },
      { kodePart: 'PRT-REM-U2', namaPart: 'Remote Universal AC', brandKompatibel: 'Universal', supplier: 'Toko Grosir Elektro', stokJual: 4, stokGaransi: 0, stokInventory: 4, reorderLimit: 5, hargaKlaim: 85000 }, // ROP ALERT (ALT-03)
      { kodePart: 'PRT-KPT-3D', namaPart: 'Kapasitor 35uF 450V', brandKompatibel: 'LG, Aqua', supplier: 'CV Sparepart Jaya', stokJual: 15, stokGaransi: 3, stokInventory: 18, reorderLimit: 6, hargaKlaim: 65000 },
      { kodePart: 'PRT-ESP-09', namaPart: 'Evaaporator Coil 9000BTU', brandKompatibel: 'Daikin', supplier: 'PT Sinar Elektronik', stokJual: 1, stokGaransi: 0, stokInventory: 1, reorderLimit: 2, hargaKlaim: 950000 }, // ROP ALERT (ALT-03)
    ].map((s) => prisma.masterSparepart.create({ data: s }))
  )
  console.log('✅ Master Sparepart:', sparepartList.length)

  // ============ UNIT ASSET (dengan serial number) ============
  const unitList = await Promise.all(
    [
      { serialNumber: 'SN-ACSP-2023-00101', modelUnit: 'AC Split 1 PK Inverter SE-9000', tokoId: tokoList[0].id, customerId: customerList[0].id, statusGaransi: 'GARANSI', tglPembelian: daysAgo(200) },
      { serialNumber: 'SN-ACSP-2023-00102', modelUnit: 'AC Split 1 PK Inverter SE-9000', tokoId: tokoList[0].id, customerId: customerList[1].id, statusGaransi: 'NON_GARANSI', tglPembelian: daysAgo(800) },
      { serialNumber: 'SN-ACSP-2024-00203', modelUnit: 'AC Split 1/2 PK SE-5000', tokoId: tokoList[1].id, customerId: customerList[2].id, statusGaransi: 'GARANSI', tglPembelian: daysAgo(120) },
      { serialNumber: 'SN-ACSP-2024-00204', modelUnit: 'AC Split 1/2 PK SE-5000', tokoId: tokoList[1].id, customerId: customerList[3].id, statusGaransi: 'GARANSI', tglPembelian: daysAgo(90) },
      { serialNumber: 'SN-CWAS-2022-00311', modelUnit: 'Chest Freezer 300L CF-30', tokoId: tokoList[2].id, customerId: customerList[4].id, statusGaransi: 'NON_GARANSI', tglPembelian: daysAgo(1100) },
      { serialNumber: 'SN-CWAS-2024-00312', modelUnit: 'Chest Freezer 200L CF-20', tokoId: tokoList[2].id, customerId: customerList[5].id, statusGaransi: 'GARANSI', tglPembelian: daysAgo(60) },
      { serialNumber: 'SN-MESC-2023-00421', modelUnit: 'Mesin Cuci Front Load 8kg FL-80', tokoId: tokoList[3].id, customerId: customerList[0].id, statusGaransi: 'GARANSI', tglPembelian: daysAgo(300) },
      { serialNumber: 'SN-MESC-2023-00422', modelUnit: 'Mesin Cuci Top Load 7kg TL-70', tokoId: tokoList[4].id, customerId: customerList[1].id, statusGaransi: 'NON_GARANSI', tglPembelian: daysAgo(700) },
      { serialNumber: 'SN-ACSP-2024-00531', modelUnit: 'AC Split 1 PK Inverter SE-9000', tokoId: tokoList[5].id, customerId: customerList[2].id, statusGaransi: 'GARANSI', tglPembelian: daysAgo(45) },
      { serialNumber: 'SN-ACSP-2024-00532', modelUnit: 'AC Standing Floor 5PK SF-500', tokoId: tokoList[5].id, customerId: customerList[3].id, statusGaransi: 'GARANSI', tglPembelian: daysAgo(30) },
    ].map((u) => prisma.unitAsset.create({ data: u }))
  )
  console.log('✅ Unit Asset:', unitList.length)

  // ============ SERVICE REQUEST ============
  // Tiket 1: PROSES dengan part READY (dari WA bot)
  const tiket1 = await prisma.serviceRequest.create({
    data: {
      noTiket: 'SV-20261008-0001',
      unitAssetId: unitList[0].id,
      status: 'PROSES',
      noSttb: 'STTB-20261008-0001',
      sumberLaporan: 'KUNJUNGAN',
      lokasiUnit: 'WORKSHOP',
      penanganan: 'TARIK_WORKSHOP',
      deskripsiKerusakan: 'AC tidak dingin, kompresor mati total saat dinyalakan',
      slaFlag: false,
      biayaJasa: 150000,
      createdAt: daysAgo(2),
      parts: {
        create: [{ sparepartId: sparepartList[0].id, qty: 1, statusPart: 'READY', statusKonfirmasi: 'READY' }],
      },
    },
  })
  // kurangi stok karena sudah direserve
  await prisma.masterSparepart.update({ where: { id: sparepartList[0].id }, data: { stokJual: { decrement: 1 }, stokInventory: { decrement: 1 } } })

  // Tiket 2: REQUEST melewati SLA 24 jam (ALT-02) — part tidak ready, teregistrasi & simpan di toko
  const tiket2 = await prisma.serviceRequest.create({
    data: {
      noTiket: 'SV-20261007-0002',
      unitAssetId: unitList[4].id,
      status: 'REQUEST',
      sumberLaporan: 'LAPORAN_TOKO',
      lokasiUnit: 'TOKO',
      penanganan: 'TUNGGU_PART_TOKO',
      deskripsiKerusakan: 'Freezer tidak membekui, evaporator berbunyi aneh',
      slaFlag: false,
      biayaJasa: 200000,
      createdAt: daysAgo(3),
      parts: {
        create: [{ sparepartId: sparepartList[7].id, qty: 1, statusPart: 'ORDER_PRODUSEN', statusKonfirmasi: 'TIDAK_READY' }],
      },
    },
  })

  // Tiket 3: FINISH > 7 hari, klaim masih DRAFT (ALT-04)
  const tiket3 = await prisma.serviceRequest.create({
    data: {
      noTiket: 'SV-20260925-0003',
      unitAssetId: unitList[6].id,
      status: 'FINISH',
      noSttb: 'STTB-20260925-0003',
      sumberLaporan: 'LAPORAN_CUSTOMER',
      lokasiUnit: 'TOKO',
      penanganan: 'TARIK_WORKSHOP',
      sttbDicabut: true,
      tglKembaliKeToko: daysAgo(10),
      deskripsiKerusakan: 'Mesin cuci tidak bisa drainase, air keluar lambat',
      fotoNotaStempel: 'nota-stempel-sv-0003.jpg',
      biayaJasa: 180000,
      tglFinish: daysAgo(9),
      createdAt: daysAgo(12),
      parts: {
        create: [{ sparepartId: sparepartList[4].id, qty: 1, statusPart: 'READY' }],
      },
    },
  })

  // Tiket 4: FINISH, klaim SUBMITTED
  const tiket4 = await prisma.serviceRequest.create({
    data: {
      noTiket: 'SV-20260920-0004',
      unitAssetId: unitList[7].id,
      status: 'FINISH',
      noSttb: 'STTB-20260920-0004',
      deskripsiKerusakan: 'Mesin cuci bergetar hebat saat spin, bearing rusak',
      fotoNotaStempel: 'nota-stempel-sv-0004.jpg',
      biayaJasa: 220000,
      tglFinish: daysAgo(14),
      statusKlaimProdusen: 'SUBMITTED',
      tglKlaim: daysAgo(10),
      createdAt: daysAgo(18),
      parts: {
        create: [{ sparepartId: sparepartList[6].id, qty: 2, statusPart: 'READY' }],
      },
    },
  })

  // Tiket 5: FINISH, klaim PAID
  const tiket5 = await prisma.serviceRequest.create({
    data: {
      noTiket: 'SV-20260905-0005',
      unitAssetId: unitList[2].id,
      status: 'FINISH',
      noSttb: 'STTB-20260905-0005',
      deskripsiKerusakan: 'AC bocor dari unit indoor, selang drain tersumbat',
      fotoNotaStempel: 'nota-stempel-sv-0005.jpg',
      biayaJasa: 120000,
      tglFinish: daysAgo(28),
      statusKlaimProdusen: 'PAID',
      tglKlaim: daysAgo(20),
      createdAt: daysAgo(32),
      parts: {
        create: [{ sparepartId: sparepartList[2].id, qty: 1, statusPart: 'READY' }],
      },
    },
  })

  // Tiket 6: REQUEST baru (hari ini, belum lewat SLA)
  const tiket6 = await prisma.serviceRequest.create({
    data: {
      noTiket: 'SV-20261009-0006',
      unitAssetId: unitList[8].id,
      status: 'REQUEST',
      deskripsiKerusakan: 'AC baru dibeli sudah bermasalah, remote tidak merespon',
      biayaJasa: 100000,
      createdAt: daysAgo(0),
      parts: {
        create: [{ sparepartId: sparepartList[5].id, qty: 1, statusPart: 'ORDER_PRODUSEN' }],
      },
    },
  })
  console.log('✅ Service Request:', 6)

  // ============ KUNJUNGAN TOKO ============
  await prisma.kunjungan.createMany({
    data: [
      { tokoId: tokoList[0].id, teknisiId: teknisi1.id, tglKunjungan: daysAgo(3), catatanStokRusak: 'Ditemukan 2 unit AC display kipas berbunyi, direkomendasikan servis rutin.' },
      { tokoId: tokoList[2].id, teknisiId: teknisi2.id, tglKunjungan: daysAgo(10), catatanStokRusak: 'Kondisi stok display baik. 1 freezer lama perlu pemeriksaan.' },
      { tokoId: tokoList[3].id, teknisiId: teknisi1.id, tglKunjungan: daysAgo(12), catatanStokRusak: 'Semua unit demo normal. Pelanggan minta jadwal pemasangan baru.' },
      { tokoId: tokoList[5].id, teknisiId: teknisi3.id, tglKunjungan: daysAgo(2), catatanStokRusak: 'Kunjungan rutin, tidak ada temuan kerusakan.' },
      { tokoId: tokoList[4].id, teknisiId: teknisi3.id, tglKunjungan: daysAgo(9), catatanStokRusak: '1 unit mesin cuci display perlu penggantian kapasitor.' },
      { tokoId: tokoList[1].id, teknisiId: teknisi2.id, tglKunjungan: daysAgo(20), catatanStokRusak: 'Kunjungan terakhir, beberapa unit perlu pengecekan berkala.' },
    ],
  })
  console.log('✅ Kunjungan:', 6)

  // ============ WA MESSAGE (contoh riwayat) ============
  await prisma.waMessage.createMany({
    data: [
      { pengirim: 'TOK-001 (Maju Jaya)', tipe: 'IN', pesan: '#LAPOR SN-ACSP-2023-00101 PRT-CMP-01 AC tidak dingin, kompresor mati total', meta: JSON.stringify({ noTiket: tiket1.noTiket }) },
      { pengirim: 'WA-BOT', tipe: 'OUT', pesan: `Tiket #${tiket1.noTiket} Berhasil Terbuat. Part READY (Kompresor 1/2 PK R134a). Link STTB: /api/sttb/${tiket1.noSttb}`, meta: JSON.stringify({ noTiket: tiket1.noTiket, aksi: 'TIKET_DIBUAT' }) },
      { pengirim: 'TOK-002 (Berkah Sentosa)', tipe: 'IN', pesan: '#LAPOR SN-CWAS-2022-00311 PRT-ESP-09 Freezer tidak membekui', meta: JSON.stringify({ noTiket: tiket2.noTiket }) },
      { pengirim: 'WA-BOT', tipe: 'OUT', pesan: `Tiket #${tiket2.noTiket} Terbuat. Part KOSONG (Evaaporator Coil 9000BTU). Menunggu pengiriman sparepart dari produsen.`, meta: JSON.stringify({ noTiket: tiket2.noTiket, aksi: 'PART_ORDER_PRODUSEN' }) },
    ],
  })
  console.log('✅ WA Messages:', 4)

  // ============ AUDIT LOG AWAL ============
  await prisma.auditLog.createMany({
    data: [
      { aksi: 'SEED_DATABASE', entitas: 'SYSTEM', deskripsi: 'Inisialisasi database dengan data contoh PRD After-Sales', aktor: 'SYSTEM' },
      { aksi: 'CREATE_SERVICE_REQUEST', entitas: 'service_request', entitasId: tiket1.noTiket, deskripsi: 'Tiket dibuat otomatis via WA Bot', aktor: 'WA-BOT' },
      { aksi: 'UPDATE_STATUS', entitas: 'service_request', entitasId: tiket1.noTiket, deskripsi: 'Status: REQUEST → PROSES (STTB diterbitkan)', aktor: admin.nama },
      { aksi: 'CREATE_SERVICE_REQUEST', entitas: 'service_request', entitasId: tiket2.noTiket, deskripsi: 'Tiket dibuat, part ORDER_PRODUSEN (stok kosong)', aktor: 'WA-BOT' },
      { aksi: 'SUBMIT_CLAIM', entitas: 'service_request', entitasId: tiket4.noTiket, deskripsi: 'Klaim diajukan ke produsen', aktor: admin.nama },
    ],
  })
  console.log('✅ Audit Logs: 5')
  console.log('🎉 Seeding selesai!')
}

main()
  .catch((e) => {
    console.error('❌ Seed error:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
