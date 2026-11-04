import { Client } from 'ssh2'
const [local, remote] = process.argv.slice(2)
if (!local || !remote) { console.error('usage'); process.exit(1) }
const conn = new Client()
conn.on('ready', () => {
  conn.sftp((err, sftp) => {
    if (err) { console.error('SFTP ERROR:', err.message); conn.end(); process.exit(1) }
    sftp.fastPut(local, remote, (e) => {
      if (e) { console.error('UPLOAD ERROR:', e.message); conn.end(); process.exit(1) }
      console.log('UPLOAD OK:', remote)
      conn.end()
    })
  })
})
conn.on('error', (e) => { console.error('SSH ERROR:', e.message); process.exit(1) })
conn.connect({ host: '192.168.18.19', port: 22, username: 'dazz', password: 'blitar8479', readyTimeout: 20000 })
