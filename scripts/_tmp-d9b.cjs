const { DatabaseSync } = require('node:sqlite')
const db = new DatabaseSync(process.env.HOME + '/.nvm/versions/node/v26.13.0/lib/node_modules/9router/db/data.sqlite', { readOnly: true })
const rows = db.prepare('SELECT provider, authType, name, isActive, data FROM providerConnections').all()
for (const r of rows) {
  let d = {}
  try { d = JSON.parse(r.data) } catch {}
  console.log({ provider: r.provider, authType: r.authType, name: r.name, isActive: r.isActive, testStatus: d.testStatus, defaultModel: d.defaultModel })
}
db.close()
// settings
const db2 = new DatabaseSync(process.env.HOME + '/.nvm/versions/node/v26.13.0/lib/node_modules/9router/db/data.sqlite', { readOnly: true })
const s = db2.prepare('SELECT data FROM settings WHERE id=1').get()
const j = JSON.parse(s.data)
console.log('cavemanEnabled:', j.cavemanEnabled)
console.log('password set:', !!j.password)
console.log('requireApiKey:', j.requireApiKey)
db2.close()
