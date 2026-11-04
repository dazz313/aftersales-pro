const fs = require('fs')
const cfgPath = '/home/dazz/.hermes/config.yaml'
let cfg = fs.readFileSync(cfgPath, 'utf8')
cfg = cfg.replace(/^(\s*default:\s*).*/m, '$1openrouter/openai/gpt-4o-mini')
fs.writeFileSync(cfgPath, cfg)
console.log('model.default updated to openrouter/openai/gpt-4o-mini')
const { execSync } = require('child_process')
execSync('docker compose -f /home/dazz/aftersales-pro/docker-compose.hermes.yml up -d --force-recreate', { stdio: 'inherit' })
console.log('restarted')
