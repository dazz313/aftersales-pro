# Instalasi Hermes Agent di Server (Docker)

## Prasyarat
- Docker & Docker Compose sudah terpasang di server (`192.168.18.19`).
- User `dazz` **belum** bisa menjalankan Docker (bukan anggota grup `docker`).
  Admin/root perlu menjalankan **sekali**:
  ```
  sudo usermod -aG docker dazz
  ```
  lalu user `dazz` re-login SSH (`exit` lalu SSH lagi) agar grup baru aktif.
  Verifikasi: `docker ps` tidak lagi "permission denied".

## Langkah instalasi (setelah akses docker aktif)
```bash
cd ~/aftersales-pro
mkdir -p ~/.hermes
# 1) Setup wizard (interaktif, sekali saja)
HERMES_UID=$(id -u) HERMES_GID=$(id -g) docker compose -f docker-compose.hermes.yml run --rm hermes setup
# 2) Jalankan gateway di background
HERMES_UID=$(id -u) HERMES_GID=$(id -g) docker compose -f docker-compose.hermes.yml up -d
# 3) Cek status & log
docker ps
docker compose -f docker-compose.hermes.yml logs -f
```

## Port
- 8642: gateway API (OpenAI-compatible)
- 9119: dashboard web
Jangan bentrok dengan 3000 (AfterSales Pro) dan 20128 (9router).

## Data persisten
Semua konfigurasi, API key, session, skill, memory tersimpan di `~/.hermes` (mount `/opt/data`). Backup folder ini secara berkala.

## Upgrade
```bash
docker compose -f docker-compose.hermes.yml pull
docker compose -f docker-compose.hermes.yml up -d
```

## Catatan keamanan
- Dashboard default hanya localhost. Untuk akses remote, gunakan SSH tunnel:
  `ssh -L 9119:localhost:9119 dazz@192.168.18.19`
- Jangan expose port 9119 ke internet tanpa autentikasi.
- API server (8642) mati by default; aktifkan hanya bila perlu (set API_SERVER_KEY min 8 char).
