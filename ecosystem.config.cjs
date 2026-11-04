/**
 * PM2 ecosystem — AfterSales Pro (mode produksi stabil).
 * Produksi: node .next/standalone/server.js (hasil `npm run build`).
 * Pengembangan tetap di :3001 via `npx next dev -p 3001` (di luar PM2).
 *
 * Service kedua: aspro-tg-poll — bridge inbound Telegram (long polling).
 * Wajib di mode LAN/desktop (tidak ada URL publik → webhook Telegram tak
 * bisa dipakai). Bot dimatikan otomatis bila ternyata sudah terdaftar
 * webhook (lihat mini-services/tg-polling.mjs).
 */
module.exports = {
  apps: [
    {
      name: 'aspro-prod',
      script: './.next/standalone/server.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: '3000',
      },
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      min_uptime: '10s',
      max_restarts: 50,
    },
    {
      name: 'aspro-tg-poll',
      script: './mini-services/tg-polling.mjs',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        APP_URL: 'http://localhost:3000',
      },
      autorestart: true,
      watch: false,
      max_memory_restart: '256M',
      min_uptime: '30s',
      max_restarts: 5,
    },
  ],
}
