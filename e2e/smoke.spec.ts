import { test, expect } from '@playwright/test'

const ADMIN = { email: 'e2e-admin@example.test', password: 'e2e-pass-123' }

test.describe('Kesehatan & proteksi API', () => {
  test('GET /api/health → 200 ok', async ({ request }) => {
    const res = await request.get('/api/health')
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('ok')
    expect(body.database).toBe('up')
  })

  test('API terlindungi tanpa sesi → 401', async ({ request }) => {
    const res = await request.get('/api/service')
    expect(res.status()).toBe(401)
  })
})

test.describe('Autentikasi', () => {
  test('halaman login tampil', async ({ page }) => {
    await page.goto('/login')
    await expect(page.getByRole('heading', { name: 'Masuk ke Akun Anda' })).toBeVisible()
  })

  test('login dengan kredensial salah → pesan kesalahan', async ({ page }) => {
    await page.goto('/login')
    await page.fill('#email', 'salah@example.test')
    await page.fill('#password', 'salah-salah-salah')
    await page.click('button[type="submit"]')
    await expect(page.getByRole('alert')).toBeVisible()
    await expect(page).toHaveURL(/\/login$/)
  })

  test('login benar → dashboard muncul', async ({ page }) => {
    await page.goto('/login')
    await page.fill('#email', ADMIN.email)
    await page.fill('#password', ADMIN.password)
    await page.click('button[type="submit"]')
    await expect(page.getByRole('heading', { name: 'Dashboard KPI' })).toBeVisible()
  })

  test('setelah login bisa berpindah ke Proses Service', async ({ page }) => {
    await page.goto('/login')
    await page.fill('#email', ADMIN.email)
    await page.fill('#password', ADMIN.password)
    await page.click('button[type="submit"]')
    await expect(page.getByRole('heading', { name: 'Dashboard KPI' })).toBeVisible()
    await page.getByRole('button', { name: /Proses Service/ }).first().click()
    await expect(page.getByRole('heading', { name: 'Proses Service' })).toBeVisible()
  })
})
