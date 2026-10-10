# AfterSales Pro — Versi Desktop Windows (MSI) & Integrasi AI (MCP)

Panduan lengkap membangun, memasang, dan menghubungkan AI assistant ke
aplikasi AfterSales Pro.

---

## 1. Versi Desktop Windows (file MSI)

Versi desktop membungkus aplikasi web (Next.js) ke dalam aplikasi Windows
native (Electron) dengan **database SQLite lokal** di folder data user.
Tidak butuh Node.js, web server, atau internet untuk beroperasi sehari-hari
(internet hanya untuk fitur Gateway Telegram/WhatsApp dan backup Google Sheets).

### 1.1 Cara A — Build otomatis via GitHub Actions (rekomendasi)

1. Push seluruh proyek ini ke repository GitHub.
2. Buka tab **Actions** → workflow **"Build Windows Installer (MSI)"** → **Run workflow**
   (workflow juga jalan otomatis saat push tag `v*`, mis. `v1.0.0`).
3. Tunggu build selesai (~5–10 menit), lalu unduh artifact
   **AfterSalesPro-Windows-Installer** — berisi:
   - `AfterSalesPro-1.0.0-x64.msi` ← installer utama (permintaan MSI)
   - `AfterSalesPro-Setup-1.0.0-x64.exe` ← alternatif NSIS

### 1.2 Cara B — Build lokal di Windows

Syarat: Node.js 20+ terinstal, Git, koneksi internet (unduh Electron).

```bat
git clone <repo-anda> && cd <repo>
npm install
node scripts/build-desktop.mjs
```

Hasil build ada di folder `dist/desktop/`.

### 1.3 Instalasi & first run

1. Jalankan `AfterSalesPro-1.0.0-x64.msi` → Next → pilih folder instalasi → Install.
2. Shortcut **AfterSales Pro** muncul di Desktop & Start Menu.
3. Saat pertama dibuka, aplikasi otomatis:
   - membuat database di `%APPDATA%\AfterSalesPro\data\aftersales.db`
     (dari template + 2 pengguna awal: `admin@aftersales.local` &
     `teknisi@aftersales.local`),
   - menjalankan sinkronisasi schema (`prisma db push`) — aman untuk upgrade,
   - memulai server lokal di `127.0.0.1` (port bebas mulai 34567),
   - menulis config MCP siap-pakai ke
     `%APPDATA%\AfterSalesPro\claude-desktop-mcp-config.json`.
4. Upgrade versi: jalankan MSI versi baru — data tetap aman (di folder data user).

### 1.4 Struktur teknis desktop

| Komponen | Lokasi / Nilai |
|---|---|
| Main process Electron | `electron/main.js` (preload: `electron/preload.js`) |
| Server aplikasi | Next.js standalone di `resources/app/standalone` |
| Database | `%APPDATA%\AfterSalesPro\data\aftersales.db` |
| Log server | `%APPDATA%\AfterSalesPro\server.log` |
| Config MCP Claude | `%APPDATA%\AfterSalesPro\claude-desktop-mcp-config.json` |
| appId / productName | `com.aftersalespro.desktop` / `AfterSales Pro` |
| MSI upgradeCode (tetap) | `0AC670DA-41E0-4A7D-9A37-B9840F7D15B4` |
| Konfigurasi builder | `electron-builder.yml` |

---

## 2. Dukungan AI via MCP (Model Context Protocol)

Aplikasi menyertakan **MCP server** (`mcp/server.mjs`, transport stdio) yang
mengekspos data & operasi AfterSales Pro kepada AI assistant seperti
**Claude Desktop**, Cursor, atau MCP client lain.

### 2.1 Daftar 19 tool MCP

| Kategori | Tool | Fungsi |
|---|---|---|
| Ringkasan | `get_stats` | KPI: toko, customer, sparepart, unit, kunjungan bulan ini, tiket per status, klaim, stok kritis, kunjungan terlambat |
| Toko | `list_toko`, `get_toko`, `add_toko`, `update_toko` | Cari/detail (via id, kode, atau **barcode toko**)/tambah/perbarui — barcode `BC-{KODETOKO}` otomatis |
| Customer | `list_customer`, `add_customer` | Daftar & tambah customer |
| Sparepart | `list_sparepart`, `add_sparepart`, `update_sparepart` | Stok konsinyasi, filter stok kritis, kode `SP-###` otomatis |
| Unit | `list_unit`, `add_unit` | Unit asset + status garansi |
| Kunjungan | `record_kunjungan`, `list_kunjungan` | **Check-in via barcode toko** (sama dengan scan di aplikasi) + notifikasi Gateway |
| Service | `list_service` | Tiket service request (REQUEST/PROSES/FINISH) |
| Gateway | `send_gateway_message`, `set_gateway_config` | Kirim notifikasi WhatsApp/Telegram; atur kredensial bot |
| Backup | `run_backup` | Backup data bersama: Google Sheets bila app jalan, atau snapshot JSON lokal |
| Audit | `list_audit` | Jejak aktivitas terbaru |

Semua aksi tulis tercatat di **Audit Log** dengan aktor `MCP AI`.

### 2.2 Setup di Claude Desktop (versi desktop terinstal)

Cara termudah — setelah aplikasi desktop diinstal:

1. Buka **Pengaturan → Desktop Windows & AI (MCP)** → klik **Salin Config
   Claude Desktop** (path sudah pasti, memakai runtime bawaan aplikasi —
   tidak butuh Node.js terinstal).
2. Buka file `%APPDATA%\Claude\claude_desktop_config.json`
   (Claude Desktop → File → Settings → Developer → Edit Config).
3. Tempel bagian `"mcpServers": { ... }` dari hasil salinan, simpan.
4. Restart Claude Desktop → ikon palang/perkakas muncul →
   tool **aftersales-pro** tersedia.

### 2.3 Setup di Claude Desktop (mode web/proyek, butuh Node.js)

```json
{
  "mcpServers": {
    "aftersales-pro": {
      "command": "node",
      "args": ["C:\\path\\ke\\proyek\\mcp\\server.mjs"],
      "env": { "DATABASE_URL": "file:C:\\path\\ke\\proyek\\db\\custom.db" }
    }
  }
}
```

Contoh lengkap: `mcp/claude-desktop-config.example.json`.

### 2.4 Menjalankan server MCP manual (opsional)

```bash
node mcp/server.mjs                                  # default db/custom.db
DATABASE_URL=file:/abs/path/db.db node mcp/server.mjs # path khusus
npm run mcp:test                                     # uji end-to-end 19 tool
```

### 2.5 Contoh perintah untuk AI

- *"Berapa toko yang kunjungannya sudah terlambat?"* → `get_stats`
- *"Tambahkan toko Baraya Elektronik di Makassar dengan kontak 08123456789"* → `add_toko`
- *"Check-in kunjungan di toko barcode BC-TOK-003, catatan: stok filter oli rusak"* → `record_kunjungan`
- *"Sparepart mana yang stoknya kritis?"* → `list_sparepart (lowStockOnly)`
- *"Kirim pengingat ke grup Telegram bahwa visit minggu ini dimulai Senin"* → `send_gateway_message`
- *"Backup data sekarang"* → `run_backup`

---

## 3. Pemecahan masalah

| Gejala | Solusi |
|---|---|
| Window blank saat first run | Periksa `%APPDATA%\AfterSalesPro\server.log`; pastikan antivirus tidak memblokir aplikasi |
| Port bentrok | Aplikasi otomatis mencari port bebas (34567–34617); pastikan tidak diblokir firewall lokal |
| MCP tidak muncul di Claude | Pastikan path `ASPRO_DB_PATH` benar; jalankan `node mcp/server.mjs` manual untuk lihat error; restart Claude Desktop |
| Backup Google Sheets gagal | Isi kredensial di Pengaturan → Backup; fallback otomatis: snapshot JSON di folder `backups` |
| MSI ditolak SmartScreen | Klik *More info* → *Run anyway* (installer belum ditandatangani certificate) |
