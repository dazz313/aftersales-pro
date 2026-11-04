const { DatabaseSync } = require('node:sqlite')
const db = new DatabaseSync(process.env.HOME + '/.9router/db/data.sqlite', { readOnly: true })
const row = db.prepare('SELECT key FROM apiKeys WHERE isActive = 1 ORDER BY createdAt DESC LIMIT 1').get()
db.close()
const key = row.key
const base = 'http://127.0.0.1:20128/v1'
fetch(base + '/models', { headers: { Authorization: 'Bearer ' + key } }).then(async r => {
  const t = await r.text()
  const j = JSON.parse(t)
  const ids = (j.data || []).map(m => m.id).filter(Boolean)
  console.log('total models:', ids.length)
  console.log('gemini:', ids.filter(i => i.startsWith('gemini/')).slice(0, 10).join(', '))
  console.log('ollama:', ids.filter(i => i.startsWith('ollama/') || i.startsWith('ol/')).slice(0, 10).join(', '))
  console.log('gc (gemini-cli):', ids.filter(i => i.startsWith('gc/')).slice(0, 5).join(', '))
}).catch(e => console.log('ERR', e.message))
