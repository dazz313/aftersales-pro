/**
 * Helper uji mobile: login ke API lalu cetak token Bearer.
 *
 * Bukan "API secret" — token di sini adalah JWT sesi yang diterbitkan
 * POST /api/auth/login (berlaku 7 hari). AUTH_SECRET di .env hanya kunci
 * penanda tangan di server dan TIDAK boleh dipasang di aplikasi Android.
 *
 * Pakai:
 *   node scripts/mobile-token.mjs <email-atau-username> <password> [kode-uji] [base-url]
 *
 * Contoh:
 *   node scripts/mobile-token.mjs dazz RAHASIA
 *   node scripts/mobile-token.mjs dazz RAHASIA 2603128725B
 *   node scripts/mobile-token.mjs dazz RAHASIA "Toko Andika" http://127.0.0.1:3000
 *
 * Alternatif lewat env (agar password tidak tersimpan di riwayat shell):
 *   $env:MOBILE_EMAIL="dazz"; $env:MOBILE_PASS="RAHASIA"; node scripts/mobile-token.mjs
 */

const [emailArg, passArg, kodeArg, baseArg] = process.argv.slice(2)
const email = emailArg ?? process.env.MOBILE_EMAIL ?? ''
const password = passArg ?? process.env.MOBILE_PASS ?? ''
const kode = kodeArg ?? process.env.MOBILE_KODE ?? ''
const base = (baseArg ?? process.env.BASE_URL ?? 'http://localhost:3000').replace(/\/+$/, '')

if (!email || !password) {
  console.error('Pemakaian: node scripts/mobile-token.mjs <email-atau-username> <password> [kode-uji] [base-url]')
  process.exit(1)
}

/** Baca klaim JWT tanpa verifikasi — hanya untuk menampilkan masa berlaku. */
function klaim(token) {
  try {
    const payload = token.split('.')[1]
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  } catch {
    return null
  }
}

const res = await fetch(`${base}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
  body: JSON.stringify({ email, password }),
})

const body = await res.json().catch(() => null)
if (!res.ok || !body?.token) {
  console.error(`Login gagal (${res.status}): ${body?.error ?? 'tanpa pesan'}`)
  if (res.status === 429) console.error('Terlalu banyak percobaan gagal — tunggu 5 menit atau pakai akun lain.')
  process.exit(1)
}

const c = klaim(body.token)
const kedaluwarsa = c?.exp ? new Date(c.exp * 1000).toLocaleString('id-ID') : 'tidak diketahui'

console.log('Login OK')
console.log('  user      :', `${body.user?.nama} (${body.user?.role})`)
console.log('  id        :', body.user?.id)
console.log('  kedaluwarsa:', kedaluwarsa, '(7 hari)')
console.log('')
console.log('Token Bearer (tempel ke aplikasi / header Authorization):')
console.log(body.token)
console.log('')
console.log('Header siap pakai:')
console.log(`Authorization: Bearer ${body.token}`)
console.log('')
console.log('Base URL per skenario:')
console.log('  HP via USB (adb reverse) : http://127.0.0.1:3000')
console.log('  Emulator Android Studio  : http://10.0.2.2:3000')
console.log('  HP & PC satu Wi-Fi       : http://<IP-LAN-PC>:3000')
console.log(`  (sekarang diuji ke       : ${base})`)

if (kode) {
  console.log('')
  const r = await fetch(`${base}/api/mobile/scan?kode=${encodeURIComponent(kode)}`, {
    headers: { Authorization: `Bearer ${body.token}`, Accept: 'application/json' },
  })
  const j = await r.json().catch(() => null)
  console.log(`Uji scan ${JSON.stringify(kode)} -> ${r.status} ${j?.tipe ?? j?.error ?? ''}`)
  if (j?.identifikasi) console.log('  identifikasi:', JSON.stringify(j.identifikasi))
  if (j?.tahap) console.log('  tahap:', j.tahap, `(${j.tahapLabel ?? '-'})`)
  if (j?.aksiTersedia?.length) console.log('  aksi:', j.aksiTersedia.map((a) => a.aksi).join(', '))
}
