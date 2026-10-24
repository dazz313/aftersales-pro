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

test.describe('Proteksi CSRF', () => {
  test('mutasi dengan Origin asing → 403', async ({ request }) => {
    const res = await request.post('/api/service', {
      headers: { origin: 'https://penyerang.example' },
      data: { unitAssetId: 1, deskripsiKerusakan: 'percobaan csrf' },
    })
    expect(res.status()).toBe(403)
  })

  test('mutasi tanpa indikator lintas situs lolos CSRF → lanjut cek sesi (401)', async ({ request }) => {
    const res = await request.post('/api/service', {
      data: { unitAssetId: 1, deskripsiKerusakan: 'tanpa origin' },
    })
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

test.describe('Render bertahap daftar besar', () => {
  test('tabel tiket hanya merender 60 baris dulu, lalu bisa ditambah', async ({ page }) => {
    await page.goto('/login')
    await page.fill('#email', ADMIN.email)
    await page.fill('#password', ADMIN.password)
    await page.click('button[type="submit"]')
    await expect(page.getByRole('heading', { name: 'Dashboard KPI' })).toBeVisible()
    await page.getByRole('button', { name: /Proses Service/ }).first().click()
    await expect(page.getByRole('heading', { name: 'Proses Service' })).toBeVisible()

    // Seed E2E menyiapkan 70 tiket massal → daftar pasti melebihi satu blok.
    const info = page.getByText(/Menampilkan \d+ dari \d+ tiket/)
    await expect(info).toBeVisible()
    await expect(info).toContainText('Menampilkan 60 dari')

    const tombol = page.getByRole('button', { name: /Tampilkan lebih banyak/ })
    await expect(tombol).toBeVisible()
    await tombol.click()
    // Blok pertama (60 baris) sudah bertambah → keterangan "60 dari" tidak berlaku lagi.
    await expect(page.getByText(/Menampilkan 60 dari \d+ tiket/)).toBeHidden()
  })

  test('tabel unit di Master Data juga dirender bertahap', async ({ page }) => {
    await page.goto('/login')
    await page.fill('#email', ADMIN.email)
    await page.fill('#password', ADMIN.password)
    await page.click('button[type="submit"]')
    await expect(page.getByRole('heading', { name: 'Dashboard KPI' })).toBeVisible()
    await page.getByRole('button', { name: /Master Data/ }).first().click()
    await page.getByRole('button', { name: 'Unit Asset' }).click()
    await expect(page.getByRole('tab', { name: /Belum Ada Part/ })).toBeVisible()

    const info = page.getByText(/Menampilkan \d+ dari \d+ unit/)
    await expect(info).toBeVisible()
    await expect(info).toContainText('Menampilkan 60 dari')

    await page.getByRole('button', { name: /Tampilkan lebih banyak/ }).first().click()
    await expect(page.getByText(/Menampilkan 60 dari \d+ unit/)).toBeHidden()
  })
})

test.describe('Tampilan HP: tabel jadi kartu', () => {
  test('di layar HP tabel tiket berganti jadi kartu ringkas', async ({ page }) => {
    await page.goto('/login')
    await page.fill('#email', ADMIN.email)
    await page.fill('#password', ADMIN.password)
    await page.click('button[type="submit"]')
    await expect(page.getByRole('heading', { name: 'Dashboard KPI' })).toBeVisible()
    await page.getByRole('button', { name: /Proses Service/ }).first().click()
    await expect(page.getByRole('heading', { name: 'Proses Service' })).toBeVisible()

    // Desktop: tabel penuh yang tampil, kartu disembunyikan.
    await expect(page.getByTestId('tiket-tabel')).toBeVisible()
    await expect(page.getByTestId('tiket-cards')).toBeHidden()

    // Layar HP: tabel hilang, kartu ringkas muncul (tanpa geser horizontal).
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(page.getByTestId('tiket-cards')).toBeVisible()
    await expect(page.getByTestId('tiket-tabel')).toBeHidden()
    await expect(page.getByTestId('tiket-cards').getByRole('button').first()).toBeVisible()

    // Aksi tetap tersedia dari kartu (buka detail tiket).
    await page.getByTestId('tiket-cards').getByRole('button').first().click()
    await expect(page.getByRole('dialog')).toBeVisible()
  })
})

test.describe('Dashboard hidup', () => {
  test('kartu Ringkasan Progres & Tren tampil dan segmennya bisa drill-down', async ({ page }) => {
    await page.goto('/login')
    await page.fill('#email', ADMIN.email)
    await page.fill('#password', ADMIN.password)
    await page.click('button[type="submit"]')
    await expect(page.getByRole('heading', { name: 'Dashboard KPI' })).toBeVisible()

    await expect(page.getByText('Ringkasan Progres & Tren')).toBeVisible()
    await expect(page.getByText(/tiket FINISH dari \d+ tiket/)).toBeVisible()
    await expect(page.getByText('Tiket masuk 14 hari', { exact: true })).toBeVisible()

    // Klik segmen batang "Finish" → lompat ke Proses Service.
    await page.getByRole('button', { name: /Buka tiket Finish:/ }).click()
    await expect(page.getByRole('heading', { name: 'Proses Service' })).toBeVisible()
  })
})
