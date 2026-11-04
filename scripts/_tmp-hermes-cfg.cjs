const fs = require('fs')
const cfgPath = '/home/dazz/.hermes/config.yaml'
let cfg = fs.readFileSync(cfgPath, 'utf8')
cfg = cfg.replace(/^(\s*provider:\s*).*/m, '$1custom')
cfg = cfg.replace(/^(\s*base_url:\s*).*/m, '$1http://localhost:20128/v1')
cfg = cfg.replace(/^(\s*default:\s*).*/m, '$1kc/cohere/north-mini-code:free')
fs.writeFileSync(cfgPath, cfg)
console.log('Hermes config updated to use server 9router (localhost:20128)')
// Remove OPENAI_API_KEY from .env since server 9router has requireApiKey=false
let env = fs.readFileSync('/home/dazz/.hermes/.env', 'utf8')
env = env.replace(/^OPENAI_API_KEY=.*\n/m, '')
fs.writeFileSync('/home/dazz/.hermes/.env', env)
console.log('.env cleaned (server 9router needs no API key)')
// restart container
console.log('done')
