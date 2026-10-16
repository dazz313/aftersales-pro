/**
 * PM2 ecosystem — AfterSales Pro (mode produksi stabil).
 * Produksi: node .next/standalone/server.js (hasil `npm run build`).
 * Pengembangan tetap di :3001 via `npx next dev -p 3001` (di luar PM2).
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
      max_restarts: 10,
    },
  ],
}
