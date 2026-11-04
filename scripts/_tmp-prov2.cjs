const { DatabaseSync } = require('node:sqlite')
const db = new DatabaseSync(process.env.HOME + '/.9router/db/data.sqlite', { readOnly: true })
const rows = db.prepare('SELECT provider, authType, name, isActive, data FROM providerConnections').all()
for (const x of rows) {
  let dd = {}
  try { dd = JSON.parse(x.data) } catch {}
  console.log(x.provider, '|', x.authType, '|', x.name, '| active:', x.isActive, '| testStatus:', dd.testStatus)
}
db.close()
// models with openrouter prefix
const { DatabaseSync: D2 } = require('node:sqlite')
const db2 = new D2(process.env.HOME + '/.9router/db/data.sqlite', { readOnly: true })
const key = db2.prepare('SELECT key FROM apiKeys WHERE isActive=1 LIMIT 1').get().key
db2.close()
const http = require('http')
// fetch models
const req = require('http').get('http://127.0.0.1:20128/v1/models', { headers: { Authorization: 'Bearer ' + key } }, res => {
  let d = ''
  res.on('data', c => d += c)
  res.on('end', () => {
    try {
      const j = JSON.parse(d)
      const ids = (j.data || []).map(m => m.id).filter(Boolean)
      const or = ids.filter(i => i.startsWith('openrouter/'))
      console.log('openrouter models:', or.slice(0, 15).join(', '))
      console.log('total:', ids.length)
    } catch (e) { console.log('parse err', e.message, d.slice(0, 200)) }
  })
})
req.on('error', e => console.log('req err', e.message))
req.setTimeout(30000, () => { req.destroy(); console.log('timeout') })
