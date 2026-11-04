const m = require('/home/dazz/aftersales-pro/.next/build-manifest.json')
const p = m.pages['/'] || m.pages['/index'] || Object.keys(m.pages)[0]
console.log('page entry:', p)
console.log('chunks:', JSON.stringify(p).slice(0, 400))
// check if 2x3mdayw4 in build-manifest
const txt = JSON.stringify(m)
console.log('build-manifest has 2x3mdayw4:', txt.includes('2x3mdayw4'))
