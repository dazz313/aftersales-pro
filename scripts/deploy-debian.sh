#!/bin/bash
# Deploy AfterSales Pro ke Debian 12 (dijalankan DI SERVER sebagai root/sudo)
# ---------------------------------------------------------------------------
# Pemakaian:
#   1. Salin kode ke server:  rsync -avz --exclude node_modules --exclude .next ./ user@server:/opt/aspro/
#   2. SSH ke server, jalankan:  sudo bash /opt/aspro/scripts/deploy-debian.sh
#   3. Arahkan DNS A api.eracool.id ke IP server ini
#   4. Caddy otomatis menerbitkan HTTPS (butuh port 80/443 terbuka)
set -euo pipefail

APP_DIR=/opt/aspro
APP_PORT=3000
APP_HOST=api.eracool.id
DATA_DIR=/home/z/my-project/db
SERVICE_USER=aspro

echo "==> 1. Dependensi sistem"
apt-get update -qq
apt-get install -y -qq curl ca-certificates gnupg sqlite3 debian-keyring debian-archive-keyring apt-transport-https > /dev/null

if ! command -v node > /dev/null 2>&1; then
  echo "==> 2. Install Node.js 22 LTS"
  mkdir -p /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" > /etc/apt/sources.list.d/nodesource.list
  apt-get update -qq
  apt-get install -y -qq nodejs
else
  echo "==> 2. Node sudah ada: $(node --version)"
fi

if ! command -v caddy > /dev/null 2>&1; then
  echo "==> 3. Install Caddy"
  curl -fsSL 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  echo "deb [signed-by=/usr/share/keyrings/caddy-stable-archive-keyring.gpg] https://dl.cloudsmith.io/public/caddy/stable/deb/debian any-version main" > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq
  apt-get install -y -qq caddy
else
  echo "==> 3. Caddy sudah ada"
fi

echo "==> 4. User + folder data"
id -u "$SERVICE_USER" > /dev/null 2>&1 || useradd -r -m -s /usr/sbin/nologin "$SERVICE_USER"
mkdir -p "$DATA_DIR"
touch "$DATA_DIR/custom.db"
chown -R "$SERVICE_USER:$SERVICE_USER" "$DATA_DIR" "$APP_DIR"

echo "==> 5. Install dependensi aplikasi"
cd "$APP_DIR"
npm install --no-audit --no-fund
npm install --no-audit --no-fund @zxing/library tesseract.js
chown -R "$SERVICE_USER:$SERVICE_USER" "$APP_DIR"

echo "==> 6. Migrasi database"
sudo -u "$SERVICE_USER" env DATABASE_URL="file:$DATA_DIR/custom.db" npx prisma db push

echo "==> 7. Seed default penampungan Telegram (idempoten)"
sudo -u "$SERVICE_USER" env DATABASE_URL="file:$DATA_DIR/custom.db" node -e "
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();
(async () => {
  await db.pengaturan.upsert({ where: { kunci: 'inbox_folder_kunjungan' }, update: {}, create: { kunci: 'inbox_folder_kunjungan', nilai: 'upload/telegram-kunjungan' } });
  await db.pengaturan.upsert({ where: { kunci: 'inbox_folder_service' }, update: {}, create: { kunci: 'inbox_folder_service', nilai: 'upload/telegram-service' } });
  await db.pengaturan.upsert({ where: { kunci: 'inbox_mode' }, update: {}, create: { kunci: 'inbox_mode', nilai: 'TAHAN' } });
  console.log('seed OK');
  await db.\$disconnect();
})().catch(async (e) => { console.error(e.message); process.exit(1) });
"

echo "==> 8. Build produksi"
sudo -u "$SERVICE_USER" npm run build

echo "==> 9. Service systemd (aspro, port $APP_PORT)"
cat > /etc/systemd/system/aspro.service <<EOF
[Unit]
Description=AfterSales Pro
After=network.target

[Service]
Type=simple
User=$SERVICE_USER
WorkingDirectory=$APP_DIR
Environment=NODE_ENV=production
Environment=DATABASE_URL=file:$DATA_DIR/custom.db
ExecStart=/usr/bin/node $APP_DIR/.next/standalone/server.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now aspro
sleep 5
systemctl is-active --quiet aspro && echo "    aspro RUNNING" || { echo "    aspro GAGAL — cek: journalctl -u aspro -n 50"; exit 1; }

echo "==> 10. Caddy vhost $APP_HOST"
if ! grep -q "$APP_HOST" /etc/caddy/Caddyfile 2>/dev/null; then
  cat >> /etc/caddy/Caddyfile <<EOF

$APP_HOST {
	reverse_proxy localhost:$APP_PORT
}
EOF
fi
systemctl reload caddy

echo ""
echo "SELESAI. Verifikasi dari laptop:"
echo "  curl.exe -m 15 -s \"https://$APP_HOST/api/telegram/webhook\""
echo "Lalu daftarkan webhook bot ke: https://$APP_HOST/api/telegram/webhook"
