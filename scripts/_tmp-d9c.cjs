const { DatabaseSync } = require('node:sqlite')
const p = process.env.HOME + '/.9router/db/data.sqlite'
const db = new DatabaseSync(p, { readOnly: true })
const rows = db.prepare('SELECT provider, authType, name, isActive, data FROM providerConnections').all()
console.log('providers:', rows.length)
for (const r of rows) {
  let d = {}
  try { d = JSON.parse(r.data) } catch {}
  console.log({ provider: r.provider, authType: r.authType, name: r.name, isActive: r.isActive, testStatus: d.testStatus })
}
const s = db.prepare('SELECT data FROM settings WHERE id=1').get()
const j = JSON.parse(s.data)
console.log('cavemanEnabled:', j.cavemanEnabled)
console.log('password set:', !!j.password)
console.log('requireApiKey:', j.requireApiKey)
db.close()
