const { DatabaseSync } = require('node:sqlite')
const db = new DatabaseSync(process.env.HOME + '/.9router/db/data.sqlite', { readOnly: true })
const row = db.prepare('SELECT key FROM apiKeys WHERE isActive = 1 ORDER BY createdAt DESC LIMIT 1').get()
db.close()
const key = row.key
const fs = require('fs')
let env = fs.readFileSync('/home/dazz/.hermes/.env', 'utf8')
if (!/^OPENAI_API_KEY=/m.test(env)) {
  env = env.replace(/\n*$/, '\n') + `OPENAI_API_KEY=${key}\n`
} else {
  env = env.replace(/^OPENAI_API_KEY=.*/m, `OPENAI_API_KEY=${key}`)
}
fs.writeFileSync('/home/dazz/.hermes/.env', env)
console.log('OPENAI_API_KEY set (len:', key.length, ')')
// restart container
const { execSync } = require('child_process')
execSync('docker compose -f /home/dazz/aftersales-pro/docker-compose.hermes.yml up -d --force-recreate', { stdio: 'inherit' })
console.log('container restarted')
