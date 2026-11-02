import QRCode from 'qrcode'

const nama = [
  'Toko Semeru Ahmad Yani',
  'Toko Swalayan Jaya Bessi',
  'Toko Pelita Elektronik',
  'Toko Baruna Bangunan',
  'Toko Melati Bangunan',
]
for (const n of nama) {
  const svg = await QRCode.toString(n, { type: 'svg', width: 96, margin: 1 })
  const vb = svg.match(/viewBox="0 0 (\d+) (\d+)"/)
  console.log(JSON.stringify(n), '-> modul:', vb?.[1], 'px/modul:', vb ? (96 / Number(vb[1])).toFixed(2) : '?')
}
