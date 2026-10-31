// Pulihkan marker koreksi SVC-2610-0051 ke kondisi awal (editedAt NULL) —
// riwayat Audit membuktikan sebelum pengujian tiket ini belum pernah dikoreksi.
const { DatabaseSync } = await import('node:sqlite')
const db = new DatabaseSync('db\\custom.db')
db.exec('PRAGMA busy_timeout = 5000')
const info = db.prepare('UPDATE ServiceRequest SET editedAt = NULL, editedBy = NULL WHERE noTiket = ?').run('SVC-2610-0051')
console.log('baris terpulihara:', info.changes)
const cek = db.prepare('SELECT editedAt, editedBy, tglPartDatang FROM ServiceRequest WHERE noTiket = ?').get('SVC-2610-0051')
console.log(cek)
db.close()
