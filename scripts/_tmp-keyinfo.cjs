const { DatabaseSync } = require('node:sqlite')
const db = new DatabaseSync(process.env.HOME + '/.9router/db/data.sqlite', { readOnly: true })
const rows = db.prepare('SELECT id, key, name, isActive FROM apiKeys').all()
for (const r of rows) {
  console.log('id:', r.id, 'name:', r.name, 'isActive:', r.isActive, 'keyLen:', r.key.length, 'prefix:', r.key.slice(0,6))
}
db.close()
