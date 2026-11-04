const { DatabaseSync } = require('node:sqlite')
const db = new DatabaseSync('db/custom.db', { readOnly: true })
const rows = db.prepare("SELECT kunci, nilai FROM Pengaturan WHERE kunci IN ('gateway_tg_token','gateway_tg_chat_id')").all()
const map = Object.fromEntries(rows.map(r => [r.kunci, r.nilai]))
db.close()
const token = map.gateway_tg_token
fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`).then(r=>r.json()).then(j=>{ console.log('webhook:', JSON.stringify(j.result)); return fetch(`https://api.telegram.org/bot${token}/getMe`) }).then(r=>r.json()).then(j=>console.log('bot:', j.result?.username)).catch(e=>console.log('ERR',e.message))
