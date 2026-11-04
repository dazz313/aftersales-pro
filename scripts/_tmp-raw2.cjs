const { DatabaseSync } = require('node:sqlite')
const db = new DatabaseSync(process.env.HOME + '/.9router/db/data.sqlite', { readOnly: true })
const row = db.prepare('SELECT key FROM apiKeys WHERE isActive = 1 ORDER BY createdAt DESC LIMIT 1').get()
db.close()
const key = row.key
const base = 'http://127.0.0.1:20128/v1'
const model = process.argv[2]
fetch(base + '/chat/completions', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
  body: JSON.stringify({ model, messages: [{ role: 'user', content: 'Balas hanya: OK' }], temperature: 0, max_tokens: 20 }),
  signal: AbortSignal.timeout(120000),
}).then(async r => {
  const t = await r.text()
  console.log('status:', r.status, 'ct:', r.headers.get('content-type'), 'len:', t.length)
  console.log('RAW:', t.slice(0, 600))
}).catch(e => console.log('ERR', e.name, e.message))
