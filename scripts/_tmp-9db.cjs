const { DatabaseSync } = require('node:sqlite')
const db = new DatabaseSync('/home/dazz/.9router/db/data.sqlite', { readOnly: true })
const rows = db.prepare('SELECT provider, authType, name, isActive, data FROM providerConnections').all()
for (const r of rows) {
  let d = {}
  try { d = JSON.parse(r.data) } catch {}
  console.log('PROV:', JSON.stringify({ provider: r.provider, authType: r.authType, name: r.name, isActive: r.isActive, keys: Object.keys(d), testStatus: d.testStatus, hasApiKey: !!(d.apiKey || d.api_key || d.key), baseUrl: d.baseUrl || d.base_url }))
}
console.log('--- API KEYS ---')
try {
  const keys = db.prepare('SELECT id, name, isActive, createdAt, data FROM apiKeys').all()
  for (const k of keys) console.log('KEY:', JSON.stringify({ id: k.id, name: k.name, isActive: k.isActive, createdAt: k.createdAt, data: k.data?.slice(0, 80) }))
} catch (e) { console.log('apiKeys err', e.message) }
console.log('--- SETTINGS ---')
try {
  const s = db.prepare('SELECT data FROM settings WHERE id=1').get()
  const j = JSON.parse(s.data)
  console.log(JSON.stringify({ cavemanEnabled: j.cavemanEnabled, password: !!j.password, requireApiKey: j.requireApiKey, port: j.port, baseUrl: j.baseUrl }, null, 2))
} catch (e) { console.log('settings err', e.message) }
db.close()
