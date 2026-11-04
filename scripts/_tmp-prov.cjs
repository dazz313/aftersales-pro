const { DatabaseSync } = require('node:sqlite')
const db = new DatabaseSync(process.env.HOME + '/.9router/db/data.sqlite', { readOnly: true })
const rows = db.prepare('SELECT provider, authType, name, isActive, data FROM providerConnections').all()
for (const x of rows) {
  let dd = {}
  try { dd = JSON.parse(x.data) } catch {}
  console.log(x.provider, '|', x.authType, '|', x.name, '| active:', x.isActive, '| testStatus:', dd.testStatus, '| defaultModel:', dd.defaultModel)
}
db.close()
// list available models from 9router
const http = require('http')
// fetch models via local api (no auth needed? try)
console.log('---')
console.log('done')
