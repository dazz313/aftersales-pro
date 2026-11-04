const { execSync } = require('child_process')
const run = (cmd) => {
  try { return execSync(cmd, { encoding: 'utf8', timeout: 30000 }).trim() }
  catch (e) { return 'ERR: ' + (e.stderr || e.message) }
}
console.log('PM2 LIST 9router:')
console.log(run('pm2 jlist').split('\n').filter(l => l.includes('9router')).join('\n').slice(0, 1500))
console.log('=== LOG AUTH/ERROR terakhir (30 baris) ===')
console.log(run('pm2 logs 9router-server --lines 30 --nostream'))
