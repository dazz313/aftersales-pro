const fs = require('fs')
const cfgPath = '/home/dazz/.hermes/config.yaml'
let cfg = fs.readFileSync(cfgPath, 'utf8')
cfg = cfg.replace(/^(\s*default:\s*).*/m, '$1kr/claude-haiku-4.5')
fs.writeFileSync(cfgPath, cfg)
console.log('model.default updated to kr/claude-haiku-4.5')
// restart container
const { execSync } = require('child_process')
execSync('docker compose -f /home/dazz/aftersales-pro/docker-compose.hermes.yml up -d --force-recreate', { stdio: 'inherit' })
console.log('restarted')
