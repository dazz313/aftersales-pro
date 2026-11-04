const r1 = await fetch('http://127.0.0.1:20128/api/health')
console.log('HEALTH 9router:', r1.status, await r1.text())

const r2 = await fetch('http://127.0.0.1:20128/v1/models', { headers: { Authorization: 'Bearer sk-615efdec25862032-3it1k0-b5a6113a' } })
console.log('MODELS 9router:', r2.status, (await r2.text()).slice(0, 120))
