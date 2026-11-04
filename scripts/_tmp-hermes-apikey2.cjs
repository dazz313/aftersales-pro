const fs = require('fs')
const cfgPath = '/home/dazz/.hermes/config.yaml'
let cfg = fs.readFileSync(cfgPath, 'utf8')
// Add api_key after the active base_url line (2-space indent)
cfg = cfg.replace(/^(\s+base_url: http:\/\/localhost:20128\/v1\n)/m, '$1  api_key: "sk-615efdec25862032-3it1k0-b5a6113a"\n')
fs.writeFileSync(cfgPath, cfg)
console.log('done')
// verify
const lines = cfg.split('\n')
const idx = lines.findIndex(l => l.includes('base_url: http://localhost:20128'))
console.log(lines.slice(idx, idx+3).join('\n').replace(/sk-[a-zA-Z0-9-]+/, 'sk-***'))
