const r = await fetch('http://127.0.0.1:20128/api/health')
const t = await r.text()
console.log('status:', r.status)
console.log('body:', t.slice(0, 200))
