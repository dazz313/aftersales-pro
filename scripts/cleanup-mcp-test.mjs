/**
 * Cleanup data uji MCP — menghapus entri yang dibuat oleh scripts/test-mcp.mjs
 * Pemakaian: node scripts/cleanup-mcp-test.mjs <kodeToko> <custId> <partId> <kunjunganId>
 */
import { PrismaClient } from '@prisma/client'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const db = new PrismaClient()
const [kodeToko, custId, partId, kunjunganId] = process.argv.slice(2)

async function main() {
  console.log(`Membersihkan data uji: toko=${kodeToko} customer=${custId} sparepart=${partId} kunjungan=${kunjunganId}`)

  if (kunjunganId) {
    const r = await db.kunjungan.deleteMany({ where: { id: Number(kunjunganId) } })
    console.log(`- kunjungan dihapus: ${r.count}`)
  }
  if (kodeToko) {
    const r = await db.masterToko.deleteMany({ where: { kodeToko } })
    console.log(`- toko dihapus: ${r.count}`)
  }
  if (custId) {
    const r = await db.masterCustomer.deleteMany({ where: { id: Number(custId) } })
    console.log(`- customer dihapus: ${r.count}`)
  }
  if (partId) {
    const r = await db.masterSparepart.deleteMany({ where: { id: Number(partId) } })
    console.log(`- sparepart dihapus: ${r.count}`)
  }
  // Log audit & pesan gateway dari MCP AI (uji)
  const a = await db.auditLog.deleteMany({ where: { OR: [{ aktor: 'MCP AI' }, { aktor: { contains: 'MCP AI' } }] } })
  console.log(`- audit log MCP dihapus: ${a.count}`)
  const w = await db.waMessage.deleteMany({ where: { pengirim: 'MCP AI' } })
  console.log(`- pesan gateway MCP dihapus: ${w.count}`)
  const b = await db.backupLog.deleteMany({ where: { message: { contains: 'backup-mcp-' } } })
  console.log(`- backup log MCP dihapus: ${b.count}`)

  // File snapshot uji
  const dir = path.join(ROOT, 'db', 'backups')
  if (fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir)) {
      if (f.startsWith('backup-mcp-')) {
        fs.unlinkSync(path.join(dir, f))
        console.log(`- snapshot dihapus: ${f}`)
      }
    }
  }
  console.log('✓ Cleanup selesai')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
}).finally(() => db.$disconnect())
