// SEMENTARA — verifikasi kolom kerusakanAwal (hapus setelah uji)
const { PrismaClient } = require('@prisma/client')
const d = new PrismaClient()
d.unitAsset
  .findFirst({ select: { id: true, kerusakanAwal: true } })
  .then((r) => { console.log('KOLUM-OK', JSON.stringify(r)); return d.$disconnect() })
  .catch((e) => { console.error('ERR', String(e).slice(0, 300)); return d.$disconnect() })
