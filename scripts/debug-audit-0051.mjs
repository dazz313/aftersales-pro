// Baca Audit Log entry untuk SVC-2610-0051 (mode readonly di DB).
const { DatabaseSync } = await import('node:sqlite')
const db = new DatabaseSync('db\\custom.db', { readOnly: true })
const rows = db.prepare("SELECT aksi, deskripsi, aktor, createdAt FROM AuditLog WHERE entitasId = 'SVC-2610-0051' ORDER BY id DESC LIMIT 20").all()
for (const r of rows) console.log(r.createdAt, '|', r.aksi, '|', (r.deskripsi || '').slice(0, 160), '|| oleh', r.aktor)
db.close()
