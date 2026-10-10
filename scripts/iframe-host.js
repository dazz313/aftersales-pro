/**
 * Server uji lintas-situs (cross-site iframe).
 * Berjalan di 127.0.0.1:3001 dan meng-embed aplikasi (localhost:3000) dalam
 * iframe — Chrome memperlakukan 127.0.0.1 dan localhost sebagai DUA SITUS
 * BERBEDA, sehingga mereproduksi konteks "preview ter-embed" yang memblokir
 * cookie SameSite=Lax. Dipakai untuk membuktikan fix login (Partitioned cookie
 * + fallback Bearer).
 */
const http = require('http')

const HTML = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Host Lintas Situs — Uji Iframe AfterSales Pro</title>
<style>html,body{margin:0;height:100%;background:#0f172a}iframe{width:100%;height:100%;border:0}</style>
</head>
<body>
<iframe id="app-frame" src="http://localhost:3000/login"></iframe>
</body>
</html>`

http
  .createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(HTML)
  })
  .listen(3001, '127.0.0.1', () => console.log('iframe host ready: http://127.0.0.1:3001/'))
