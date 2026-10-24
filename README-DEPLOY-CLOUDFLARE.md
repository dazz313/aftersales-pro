# AfterSales Pro — Deployment Server Sendiri + Cloudflare

Panduan menaruh AfterSales Pro (build produksi Next.js) di server sendiri
(VPS / on-prem) dan mengeksposnya dengan aman lewat Cloudflare.

Ringkas arsitektur:

```
Browser  ──HTTPS──▶  Cloudflare (edge)  ──HTTP/HTTPS──▶  Server origin
                        │                                   │
                   Tunnel or                          next start (port 3001)
                   Proxied DNS                              │
                                                      SQLite db/custom.db
```

---

## 1. Build & jalankan server produksi

```bash
npm ci
npx prisma generate
npm run build          # output standalone -> .next/standalone
npm run start          # menjalankan node .next/standalone/server.js
```

Set port/host lewat env (default Next.js `3000`; dev memakai `3001`):

```
PORT=3001
HOSTNAME=127.0.0.1    # biarkan localhost; publiknya lewat Cloudflare saja
```

> **SQLite = satu instance.** Jangan menjalankan beberapa replika terhadap
> `db/custom.db` yang sama (tidak ada load-balancing multi-node). Untuk
> ketersediaan, cukup andalkan restart otomatis (systemd/pm2) + backup.

### Contoh systemd (`/etc/systemd/system/aftersales.service`)

```ini
[Unit]
Description=AfterSales Pro
After=network.target

[Service]
WorkingDirectory=/opt/aftersales-pro
EnvironmentFile=/opt/aftersales-pro/.env
ExecStart=/usr/bin/node .next/standalone/server.js
Restart=always
RestartSec=5
User=aftersales

[Install]
WantedBy=multi-user.target
```

---

## 2. Environment produksi (lihat `.env.example`)

| Variabel | Wajib | Keterangan |
|---|---|---|
| `DATABASE_URL` | ✅ | Path **absolut** ke SQLite, mis. `file:/opt/aftersales-pro/db/custom.db` |
| `AUTH_SECRET` | ✅ | Secret acak panjang; server **menolak boot** di produksi bila kosong |
| `WEBHOOK_SECRET` | ⭐ | Bila kosong, server hanya **memperingatkan** — endpoint webhook jadi publik |
| `SESSION_COOKIE_SAMESITE` | ⭐ | `lax` untuk server sendiri yang diakses **top-level** (lebih aman/CSRF) |
| `PORT` / `HOSTNAME` | – | Port & bind address |

Generate secret:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## 3. Cloudflare: Tunnel atau Proxied DNS

### Opsi A — Cloudflare Tunnel (paling aman, direkomendasikan)

Origin **tidak perlu port publik** dan tidak bisa diakses langsung, sehingga
header IP dari Cloudflare tidak dapat dipalsukan.

```bash
cloudflared tunnel login
cloudflared tunnel create aftersales
cloudflared tunnel route dns aftersales app.contoh.co.id
```

`~/.cloudflared/config.yml`:

```yaml
tunnel: aftersales
credentials-file: /root/.cloudflared/<tunnel-id>.json
ingress:
  - hostname: app.contoh.co.id
    service: http://127.0.0.1:3001
  - service: http_status:404
```

Alternatif di dalam repo: reverse proxy **Caddy** (lihat `Caddyfile`) yang
menangani TLS, lalu di-proxy Cloudflare (orange cloud) dengan firewall origin
**hanya** mengizinkan [IP range Cloudflare](https://www.cloudflare.com/ips/).

### Opsi B — Proxied DNS (orange cloud)

Setel A/AAAA ke IP server, aktifkan proxy, dan batasi firewall origin hanya
untuk range IP Cloudflare (agar tidak bisa dilewati dengan menyambung langsung).

---

## 4. Cookie sesi & CSRF

`sessionCookieOptions()` (src/lib/auth.ts) bersifat adaptif:

- **`auto` (default):** HTTPS → `SameSite=None; Secure; Partitioned`. Dipakai
  agar cookie tetap jalan bila app di-embed **iframe lintas situs**.
- **`lax` (disarankan untuk deployment ini):** `SameSite=Lax; Secure`.
  Proteksi CSRF tetap aktif. Login **tetap** berfungsi karena aplikasi punya
  fallback **Bearer token** di `localStorage` (dipakai saat cookie diblokir
  iframe). **Tetapkan `SESSION_COOKIE_SAMESITE=lax` di produksi.**
- `strict` / `none` tersedia bila perlu eksplisit.

> Karena di belakang Cloudflare protokol terlihat HTTPS, tanpa pengaturan ini
> cookie otomatis menjadi `SameSite=None` yang mematikan proteksi CSRF.
> Itulah alasan `SESSION_COOKIE_SAMESITE=lax` penting di sini.

**Lapisan kedua (selalu aktif):** middleware (`src/proxy.ts` +
`src/lib/csrf.ts`) menolak **403** setiap request mutasi (POST/PUT/PATCH/DELETE)
yang berasal dari situs lain, berdasarkan `Origin`/`Referer`/`Sec-Fetch-Site`.
Jadi meski cookie dalam mode `SameSite=None`, permintaan forge lintas situs
tetap ditolak. Request ber-`Authorization: Bearer` dan webhook eksternal
dikecualikan (webhook diamankan lewat `WEBHOOK_SECRET`).

---

## 5. IP klien asli

Untuk throttle login & jejak audit, aplikasi membaca IP asli via
`src/lib/client-ip.ts` dengan urutan: **`CF-Connecting-IP`** →
`X-Forwarded-For` (entri paling kiri) → `X-Real-IP`.

Agar dapat dipercaya, origin **tidak boleh** bisa diakses langsung (pakai
Tunnel atau firewall ke IP Cloudflare). Tanpa itu, klien bisa memalsukan header.

---

## 6. Webhook (WhatsApp / Telegram)

`/api/wa/webhook` dan `/api/telegram/webhook` bersifat publik begitu app
terekspos. Wajib:

1. Isi `WEBHOOK_SECRET` (pemanggil menyertakan `?secret=...` atau header
   `x-webhook-secret`).
2. Lindungi rute sensitif lain dengan **Cloudflare Access (Zero Trust)** —
   kecuali path webhook, yang harus dikecualikan agar tetap bisa dipanggil
   layanan pihak ketiga.

---

## 7. Batas Cloudflare yang perlu diperhatikan

| Batas | Nilai (paket umum) | Dampak di app ini |
|---|---|---|
| Timeout respons origin | ~100 detik (error 524) | **Backup ke Google Sheets, impor massal, restore DB, dan generate PDF** bisa melewati batas pada data besar |
| Ukuran body request | 100 MB | Aman — aplikasi sendiri membatasi restore upload **50 MB** |

Mitigasi timeout: jaga operasi berat tetap < 100s, jalankan di luar jam sibuk,
atau untuk operasi sangat besar akses origin di luar proxy (grey cloud) /
lewat Tunnel.

---

## 8. Header keamanan & HSTS

- App sudah mengirim `X-Content-Type-Options`, `Referrer-Policy`,
  `Permissions-Policy`, dan `Strict-Transport-Security` (HSTS 1 tahun).
- Sebaiknya **juga** aktifkan HSTS di sisi Cloudflare:
  **SSL/TLS → Edge Certificates → Enable HSTS**.
- Pertahankan mode SSL Cloudflare **Full (Strict)** dengan TLS valid di origin.

---

## 9. Monitoring

`GET /api/health` bersifat **publik** (tanpa login) dan mengembalikan status
server + database:

```json
{ "status": "ok", "database": "up", ... }
```

Gunakan untuk Health Check Cloudflare / uptime monitor (mis. UptimeRobot).

---

## 10. Checklist singkat produksi

- [ ] `AUTH_SECRET` acak panjang terisi
- [ ] `WEBHOOK_SECRET` terisi
- [ ] `SESSION_COOKIE_SAMESITE=lax`
- [ ] `DATABASE_URL` path absolut & folder `db/` ter-backup rutin
- [ ] Origin tidak dapat diakses langsung (Tunnel / firewall IP Cloudflare)
- [ ] Cloudflare SSL = **Full (Strict)**, HSTS aktif
- [ ] Cloudflare Access untuk rute sensitif; kecualikan path webhook
- [ ] `/api/health` dipasang di uptime monitor
