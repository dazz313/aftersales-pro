const fs = require('fs')
const cfgPath = '/home/dazz/.hermes/config.yaml'
let cfg = fs.readFileSync(cfgPath, 'utf8')
// Uncomment/set api_key
if (/api_key:/m.test(cfg)) {
  cfg = cfg.replace(/^(\s*#\s*api_key:.*\n)/m, '')
  cfg = cfg.replace(/^(\s*api_key:\s*).*/m, '$1"sk-615efdec25862032-3it1k0-b5a6113a"')
} else {
  // add after base_url line
  cfg = cfg.replace(/^(base_url:.*\n)/m, '$1  api_key: "sk-615efdec25862032-3it1k0-b5a6113a"\n')
}
fs.writeFileSync(cfgPath, cfg)
console.log('api_key set in config.yaml')
const lines = cfg.split('\n')
const idx = lines.findIndex(l => l.trim() === 'model:')
console.log(lines.slice(idx, idx+12).join('\n').replace(/sk-[a-zA-Z0-9-]+/, 'sk-***'))
