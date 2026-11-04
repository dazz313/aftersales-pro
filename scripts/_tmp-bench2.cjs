const { DatabaseSync } = require('node:sqlite')
const db = new DatabaseSync(process.env.HOME + '/.9router/db/data.sqlite', { readOnly: true })
const row = db.prepare('SELECT key FROM apiKeys WHERE isActive = 1 ORDER BY createdAt DESC LIMIT 1').get()
db.close()
const key = row.key
const base = 'http://127.0.0.1:20128/v1'
const model = process.argv[2]
const t0 = Date.now()
fetch(base + '/chat/completions', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
  body: JSON.stringify({ model, messages: [{ role: 'user', content: 'Balas hanya: OK' }], temperature: 0, max_tokens: 20 }),
  signal: AbortSignal.timeout(120000),
}).then(async r => {
  const t = await r.text()
  console.log(model, '->', r.status, Date.now()-t0, 'ms')
  console.log(t.slice(0, 200))
}).catch(e => console.log(model, 'ERR', e.name, e.message, Date.now()-t0, 'ms'))
