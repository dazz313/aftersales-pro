/**
 * Backfill barcodeToko untuk semua toko existing.
 * Format barcode per toko: BC-{KODETOKO} — unik per toko, dipindai teknisi saat kunjungan.
 */
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

async function main() {
  const tokos = await db.masterToko.findMany({ where: { barcodeToko: '' } })
  for (const t of tokos) {
    const barcode = `BC-${t.kodeToko.toUpperCase()}`
    await db.masterToko.update({ where: { id: t.id }, data: { barcodeToko: barcode } })
    console.log(`✓ ${t.kodeToko} → ${barcode}`)
  }
  console.log(`Selesai: ${tokos.length} toko di-backfill`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
