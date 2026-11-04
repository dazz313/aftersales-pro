const { DatabaseSync } = require('node:sqlite')
const db = new DatabaseSync('/home/dazz/.9router/db/data.sqlite')
const upd = db.prepare('UPDATE providerConnections SET isActive = ? WHERE provider = ?')
for (const [provider, active] of [['kiro', 1], ['openrouter', 1], ['gemini', 0], ['ollama', 0]]) {
  const r = upd.run(active, provider)
  console.log(`provider=${provider} isActive=${active} rows=${r.changes}`)
}
// validasi ulang
const rows = db.prepare('SELECT provider, authType, isActive, testStatus FROM providerConnections').all()
for (const r of rows) console.log('PROV:', JSON.stringify(r))
db.close()
