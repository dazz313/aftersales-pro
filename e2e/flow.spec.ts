import { test, expect, type APIRequestContext } from '@playwright/test'

const ADMIN = { email: 'e2e-admin@example.test', password: 'e2e-pass-123' }

/**
 * E2E ALUR BISNIS PENUH: tiket → PROSES → FINISH → klaim SUBMITTED → PAID → nota BASS.
 *
 * Langkah 1 login lewat UI (menetapkan cookie sesi pada konteks browser), lalu
 * rantai bisnis dijalankan lewat HTTP memakai sesi yang sama (page.request),
 * dan diakhiri verifikasi bahwa hasilnya benar-benar tampil di UI.
 */
test.describe.configure({ mode: 'serial' })

test('alur penuh: tiket → finish → klaim → nota', async ({ page }) => {
  test.setTimeout(120_000)

  // 1) Login lewat UI
  await page.goto('/login')
  await page.fill('#email', ADMIN.email)
  await page.fill('#password', ADMIN.password)
  await page.click('button[type="submit"]')
  await expect(page.getByRole('heading', { name: 'Dashboard KPI' })).toBeVisible()

  const api = page.request

  // 2) Ambil unit & sparepart hasil seed
  const unit = (await getJson(api, '/api/unit')).find(
    (u) => (u as { serialNumber?: string }).serialNumber === 'SN-E2E-001'
  ) as { id: number } | undefined
  expect(unit, 'unit seed SN-E2E-001 tersedia').toBeTruthy()

  const part = (await getJson(api, '/api/sparepart')).find(
    (p) => (p as { kodePart?: string }).kodePart === 'E2E-PART-01'
  ) as { id: number } | undefined
  expect(part, 'sparepart seed E2E-PART-01 tersedia').toBeTruthy()

  // 3) Buat tiket dengan part READY → otomatis PROSES + STTB terbit
  const create = await api.post('/api/service', {
    data: {
      unitAssetId: unit!.id,
      deskripsiKerusakan: 'E2E: kipas berbunyi kasar',
      customerType: 'PERORANGAN',
      klasifikasiGaransi: 'NON_GARANSI',
      biayaJasa: 75000,
      parts: [{ sparepartId: part!.id, qty: 2 }],
      aktor: 'E2E Test',
    },
  })
  expect(create.status(), await create.text()).toBe(201)
  const tiket = (await create.json()) as {
    id: number
    noTiket: string
    status: string
    noSttb: string | null
  }
  expect(tiket.status).toBe('PROSES')
  expect(tiket.noSttb, 'STTB terbit sejak request part').toBeTruthy()

  const patch = (data: Record<string, unknown>) => api.patch(`/api/service/${tiket.id}`, { data })

  // 4) FINISH — wajib menyertakan foto nota berstempel
  const finish = await patch({ aksi: 'FINISH', fotoNotaStempel: 'e2e/nota-stempel.png', aktor: 'E2E Test' })
  expect(finish.status(), await finish.text()).toBe(200)
  expect(((await finish.json()) as { status: string }).status).toBe('FINISH')

  // 5) Ajukan klaim → SUBMITTED
  const claim = await patch({ aksi: 'SUBMIT_CLAIM', aktor: 'E2E Test' })
  expect(claim.status(), await claim.text()).toBe(200)
  expect(((await claim.json()) as { statusKlaimProdusen: string }).statusKlaimProdusen).toBe('SUBMITTED')

  // 6) Klaim dibayar → PAID
  const paid = await patch({ aksi: 'MARK_PAID', aktor: 'E2E Test' })
  expect(paid.status(), await paid.text()).toBe(200)
  expect(((await paid.json()) as { statusKlaimProdusen: string }).statusKlaimProdusen).toBe('PAID')

  // 7) Nota BASS dari tiket (terisi otomatis dari data tiket + part terpakai)
  const notaRes = await api.post('/api/nota/dari-tiket', { data: { noTiket: tiket.noTiket } })
  expect(notaRes.status(), await notaRes.text()).toBe(201)
  const nota = (await notaRes.json()) as { nomorBass: string; noSeri: string | null; items: unknown[] }
  expect(nota.nomorBass).toBeTruthy()
  expect(nota.noSeri).toBe('SN-E2E-001')
  expect(nota.items.length, 'nota memuat part yang dipakai').toBeGreaterThan(0)

  // 8) Verifikasi di UI: tiket tampil di Proses Service
  await page.getByRole('button', { name: /Proses Service/ }).first().click()
  await page.getByPlaceholder('Cari no. tiket / serial / model / toko / part…').fill(tiket.noTiket)
  await expect(page.getByText(tiket.noTiket).first()).toBeVisible()

  // 9) Verifikasi di UI: nota tampil di layar Nota Servis BASS
  await page.getByRole('button', { name: /Nota Servis BASS/ }).first().click()
  await page.getByPlaceholder('Cari nomor BASS / nama / merk / model…').fill(nota.nomorBass)
  await expect(page.getByText(nota.nomorBass).first()).toBeVisible()
})

/** GET + parse JSON, gagal dengan pesan jelas bila status bukan 2xx. */
async function getJson(api: APIRequestContext, url: string): Promise<unknown[]> {
  const res = await api.get(url)
  expect(res.status(), `${url} -> ${res.status()}`).toBe(200)
  return (await res.json()) as unknown[]
}
