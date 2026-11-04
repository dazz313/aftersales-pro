const fs = require('fs')
const key = fs.readFileSync('/tmp/hermes-key.txt', 'utf8').trim()
if (!key) { console.error('no key'); process.exit(1) }

// Update .env
let env = fs.readFileSync('/home/dazz/.hermes/.env', 'utf8')
if (!/^OPENAI_API_KEY=/m.test(env)) {
  env = env.replace(/\n*$/, '\n') + `OPENAI_API_KEY=${key}\n`
} else {
  env = env.replace(/^OPENAI_API_KEY=.*/m, `OPENAI_API_KEY=${key}`)
}
fs.writeFileSync('/home/dazz/.hermes/.env', env)
console.log('OPENAI_API_KEY set in .env')

// Update config.yaml
let cfg = fs.readFileSync('/home/dazz/.hermes/config.yaml', 'utf8')
// provider
cfg = cfg.replace(/^(\s*provider:\s*).*/m, '$1custom')
// base_url
if (/base_url:/m.test(cfg)) {
  cfg = cfg.replace(/^(\s*base_url:\s*).*/m, '$1http://eracool.local:20128/v1')
} else {
  // add under model block if missing
}
// default model
cfg = cfg.replace(/^(\s*default:\s*).*/m, '$1kc/cohere/north-mini-code:free')
fs.writeFileSync('/home/dazz/.hermes/config.yaml', cfg)
console.log('config.yaml updated (provider=custom, base_url=9router, default=cohere)')

// cleanup
fs.unlinkSync('/tmp/hermes-key.txt')
console.log('done')
