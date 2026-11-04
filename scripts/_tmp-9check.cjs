const { execSync } = require('child_process')
const run = (cmd) => {
  try { return execSync(cmd, { encoding: 'utf8', timeout: 30000 }).trim() }
  catch (e) { return 'ERR: ' + (e.stderr || e.message) }
}
console.log('=== PM2 STATUS 9router ===')
console.log(run('pm2 jlist 2>/dev/null').slice(0, 200))
console.log('=== HEALTH via 127.0.0.1:20128 ===')
console.log(run('source ~/.nvm/nvm.sh; curl -s -m 10 -o /dev/null -w "HTTP %{http_code}\\n" http://127.0.0.1:20128/api/health'))
console.log('=== PM2 LOGS 9router (tail) ===')
console.log(run('pm2 logs 9router-server --lines 30 --nostream').slice(-2500))
