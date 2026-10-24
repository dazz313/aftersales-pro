import { defineConfig, devices } from '@playwright/test'
import path from 'node:path'

/**
 * Konfigurasi E2E (Playwright) — menguji alur nyata lewat browser.
 *
 * Memakai DATABASE SQLITE TERPISAH (e2e/.tmp/e2e.db) yang dibuat & di-seed
 * otomatis oleh e2e/prepare-db.mjs, sehingga TIDAK menyentuh db/custom.db
 * milik pengembangan. Server dev dijalankan otomatis oleh Playwright.
 */
const DB_FILE = path.resolve(process.cwd(), 'e2e/.tmp/e2e.db').replace(/\\/g, '/')
const DATABASE_URL = `file:${DB_FILE}`
const PORT = 3100

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 90_000,
  expect: { timeout: 20_000 },
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `node e2e/prepare-db.mjs && npx next dev -p ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: { DATABASE_URL },
  },
})
