import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

/**
 * Konfigurasi pengujian AfterSales Pro (Vitest).
 * - Alias `@` → ./src agar tes bisa mengimpor modul aplikasi seperti kode biasa.
 * - environment "node" karena unit test menyasar modul murni (tanpa DOM/DB).
 * Jalankan: `npm test` (sekali) atau `npm run test:watch`.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
  },
})
