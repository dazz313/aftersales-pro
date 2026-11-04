const { execSync } = require('child_process')
try {
  const pids = execSync("ps aux | grep 'standalone/server.js' | grep -v grep | awk '{print $2}'", { encoding: 'utf8' }).trim().split('\n')
  console.log('pids:', pids)
  for (const pid of pids) {
    try {
      const cwd = execSync(`readlink /proc/${pid}/cwd`, { encoding: 'utf8' }).trim()
      console.log(pid, 'cwd=', cwd)
    } catch (e) { console.log(pid, 'cwd err', e.message) }
  }
} catch (e) { console.log('err', e.message) }
// check BUILD_ID served
const fs = require('fs')
console.log('standalone BUILD_ID:', fs.readFileSync('.next/standalone/.next/BUILD_ID','utf8').trim())
console.log('root BUILD_ID:', fs.readFileSync('.next/BUILD_ID','utf8').trim())
