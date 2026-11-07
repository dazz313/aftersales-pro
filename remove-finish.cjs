const fs = require('fs')
const p = 'src/components/views/service-view.tsx'
let s = fs.readFileSync(p, 'utf8')
const marker = '{formatWaktu(t.tglTiket)}</span>'
const i = s.indexOf(marker)
console.log('marker idx', i)
if (i >= 0) {
  let start = s.lastIndexOf('\r\n', i) + 2
  let end = s.indexOf('\r\n', i) + 2
  console.log('line:', JSON.stringify(s.slice(start, end)))
  s = s.slice(0, start) + s.slice(end)
  fs.writeFileSync(p, s)
  console.log('removed line')
}
