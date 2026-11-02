# Skema Komunikasi Mobile (Kotlin) ⇄ Web After-Sales

Dokumen ini adalah kontrak komunikasi antara **aplikasi Android (Kotlin)** dan
**backend web (Next.js + Prisma)** untuk dua alur utama:

1. **Scan QR toko** → otomatis mencatat kunjungan (tersambung ke Field Ops).
2. **Scan QR produk/unit** → membaca tahap terakhir lalu memindahkan unit ke
   tahap berikutnya (kerjakan di toko, bawa ke workshop, finish, kirim balik ke toko).

Semua data tetap satu sumber: tabel yang sama dengan web (`MasterToko`,
`Kunjungan`, `UnitAsset`, `ServiceRequest`). Tidak ada database terpisah di HP.

---

## 1. Arsitektur

```mermaid
flowchart LR
  subgraph HP["Android (Kotlin)"]
    UI[Scan Kamera / ML Kit] --> REPO[Repository + Room Queue]
    REPO --> API[Retrofit + OkHttp]
  end
  subgraph WEB["Server Next.js :3000"]
    AUTH[/api/auth/*/]
    MOB[/api/mobile/scan/]
    KUN[/api/kunjungan/]
    SVC[/api/service/:id/]
    DB[(SQLite via Prisma)]
  end
  API -->|HTTPS JSON + Bearer JWT| AUTH
  API --> MOB
  API --> KUN
  API --> SVC
  AUTH --> DB
  MOB --> DB
  KUN --> DB
  SVC --> DB
```

| Lingkungan | Base URL | Catatan |
|---|---|---|
| Emulator Android | `http://10.0.2.2:3000` | `10.0.2.2` = localhost komputer host |
| HP fisik di LAN | `http://<IP-LAN-PC>:3000` | butuh `usesCleartextTraffic` saat uji |
| Produksi | `https://<domain-anda>` | wajib HTTPS |

> Untuk uji LAN, tambahkan `network_security_config.xml` yang mengizinkan
> cleartext hanya untuk IP lokal — jangan aktifkan cleartext global di produksi.

---

## 2. Autentikasi

### 2.1 Login

`POST /api/auth/login`

```json
{ "email": "dazz", "password": "••••••" }
```

`email` boleh **email atau username**. Respons sukses (`200`):

```json
{
  "ok": true,
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": { "id": 26, "nama": "Admin Workshop", "email": "...", "username": "dazz", "role": "ADMIN_WORKSHOP" }
}
```

- Token = JWT HS256, berlaku **7 hari** (`sub`, `nama`, `email`, `username`, `role`).
- Server juga mengirim cookie `aspro_session`, tetapi **mobile cukup memakai Bearer**.
- Simpan token di `EncryptedSharedPreferences`, bukan `SharedPreferences` biasa.

### 2.2 Memakai token

Semua endpoint tulis & endpoint mobile wajib mengirim:

```
Authorization: Bearer <token>
Content-Type: application/json
Accept: application/json
```

### 2.3 Sesi berakhir

| Kondisi | Respons | Tindakan mobile |
|---|---|---|
| Token tidak ada / kedaluwarsa | `401 { "error": "Tidak terautentikasi. Silakan login." }` | Hapus token → tampilkan layar login |
| Akun dinonaktifkan | `401 { "error": "Sesi berakhir atau akun nonaktif..." }` | Logout paksa |
| Role tidak berwenang | `403 { "error": "Akses ditolak: ..." }` | Sembunyikan aksi, jangan retry |

Tidak ada refresh token. Saat `401`, login ulang (token baru otomatis berlaku).

### 2.4 Role

`ADMIN_WORKSHOP`, `MANAGER`, `TEKNISI`, `PRODUSEN`.

- Scan kunjungan & ubah tahap tiket: **semua user aktif** (termasuk `TEKNISI`).
- Master data, hapus unit, koreksi part, klaim: `ADMIN_WORKSHOP`/`MANAGER`.
- Mobile sebaiknya menyembunyikan menu master untuk role `TEKNISI`.

---

## 3. Konvensi umum

- Body & respons: **JSON UTF-8**. Tanggal: **ISO-8601** (`2026-11-02T08:15:00.000Z`).
- Angka ID: integer. Semua nominal rupiah: number (bukan string).
- Sukses: `200` (GET/PATCH) atau `201` (POST create).
- Error selalu berbentuk `{ "error": "pesan siap tampil" }`.
- `409` = **aturan alur bisnis** (bukan bug): tampilkan pesan server apa adanya,
  jangan retry otomatis.
- `404` = kode tidak dikenal / data hilang.
- `429` = throttle login (10 gagal / 5 menit / IP).
- Timeout yang disarankan: connect 10 s, read 20 s (upload foto 60 s).

### Peta endpoint yang dipakai mobile

| Kebutuhan | Method & path | Auth |
|---|---|---|
| Login | `POST /api/auth/login` | publik |
| Profil sesi | `GET /api/auth/me` | publik (cookie/Bearer) |
| **Scan apa pun (toko/unit/tiket)** | `GET /api/mobile/scan?kode=...` | Bearer |
| Pratinjau toko (tanpa mencatat) | `GET /api/kunjungan/lookup?barcode=...` | Bearer |
| Catat kunjungan | `POST /api/kunjungan` | Bearer |
| Riwayat kunjungan | `GET /api/kunjungan` | Bearer |
| Daftar toko + status visit | `GET /api/toko` | Bearer |
| Daftar unit + tiket ringkas | `GET /api/unit` | Bearer |
| Daftar tiket lengkap | `GET /api/service` | Bearer |
| Detail tiket | `GET /api/service/{id}` | Bearer |
| **Ubah tahap tiket** | `PATCH /api/service/{id}` | Bearer |
| Notifikasi in-app | `GET /api/notifikasi` | Bearer |

> Hampir semua `/api/*` dilindungi lapisan proxy: tanpa `Authorization: Bearer`
> (atau cookie sesi) server membalas `401 {"error":"Tidak terautentikasi. Silakan login."}`.
> Request dengan Bearer otomatis lolos proteksi CSRF, jadi mobile tidak perlu
> mengirim `Origin`/`Referer`.

---

## 4. Alur 1 — Scan QR toko → catat kunjungan

### 4.1 Urutan

```mermaid
sequenceDiagram
  participant HP as Android
  participant API as Next.js
  participant DB as SQLite
  HP->>HP: kamera membaca QR (isi = NAMA TOKO)
  HP->>API: GET /api/mobile/scan?kode=Toko%20Andika
  API->>DB: cari barcodeToko / namaToko / kodeToko
  DB-->>API: MasterToko
  API-->>HP: tipe=TOKO + data toko + aksi CHECKIN
  HP->>API: POST /api/kunjungan {barcode, teknisiId, ...}
  API->>DB: INSERT Kunjungan + update tglVisitTerakhir
  API-->>HP: 201 data kunjungan
  HP->>HP: tampilkan "Kunjungan tercatat"
```

### 4.2 Respons scan toko

```json
{
  "ok": true,
  "tipe": "TOKO",
  "kode": "Toko Andika",
  "toko": {
    "id": 32, "kodeToko": "TOK-032", "namaToko": "Toko Andika",
    "alamat": "Jl. ...", "kontak": "08...",
    "latitude": -4.54, "longitude": 120.31,
    "frekuensiVisit": 14, "tglVisitTerakhir": "2026-10-20T03:00:00.000Z",
    "barcodeToko": "Toko Andika", "aktif": true, "modeSiklus": "REGULER"
  },
  "jumlahUnit": 12,
  "totalKunjungan": 8,
  "hariSejakVisit": 13,
  "visitTerlambat": false,
  "kunjunganTerakhir": { "waktu": "...", "teknisi": "Andi", "metode": "SCAN_BARCODE" },
  "aksiTersedia": [
    { "aksi": "CHECKIN", "label": "Catat Kunjungan", "endpoint": "POST /api/kunjungan" }
  ]
}
```

Kode yang diterima: **nama toko** (QR baru), `BC-TOK-032` (stiker lama),
`TOK-032`, dan nama toko dengan huruf besar/kecil berbeda.

### 4.3 Catat kunjungan

`POST /api/kunjungan`

```json
{
  "barcode": "Toko Andika",
  "teknisiId": 5,
  "metodeCheckin": "SCAN_BARCODE",
  "tglKunjungan": "2026-11-02T08:15:00.000Z",
  "catatanStokRusak": "2 unit display berderit",
  "fotoOnsite": "data:image/jpeg;base64,..."
}
```

- `barcode` **atau** `tokoId` (wajib salah satu).
- `teknisiId` wajib (id user teknisi yang login; ambil dari `user.id` saat login).
- `tglKunjungan` opsional (backdate maksimal besok).
- `fotoOnsite` opsional (data URI/base64 — kompres ≤ 1 MB).

Respons `201`: objek `Kunjungan` + `toko` + `teknisi`.
Server otomatis memperbarui `tglVisitTerakhir` toko sehingga status Field Ops
(ON TRACK / TERLAMBAT) langsung berubah di web.

### 4.4 Anti dobel check-in (penting untuk offline)

Server **tidak** menolak check-in ganda. Aturan di mobile:

1. Tombol check-in hanya aktif sekali per hasil scan (single-flight).
2. Sebelum kirim, cek `GET /api/kunjungan` (100 terbaru): bila ada entri dengan
   `barcodeTerscan` sama, `teknisiId` sama, dan `tglKunjungan` dalam ±10 menit →
   anggap sudah tercatat.
3. Bila POST timeout (bukan 4xx), **jangan langsung retry**; lakukan langkah 2.
   Bila tidak ketemu, baru kirim ulang dengan `clientRequestId` yang sama di queue lokal.

---

## 5. Alur 2 — Scan QR produk → pindah tahap

### 5.1 Kode pada stiker unit

QR unit berisi **nomor seri** (`serialNumber`), mis. `SN-KPAS-2026-0001`.
Format lama `SN:xxx|MOD:yyy|TOK:zzz` juga masih dikenali (diambil bagian `SN:`).
Nomor tiket (`SVC-2611-0001`) juga bisa discan.

### 5.2 Identifikasi produk (4 komponen)

Stiker unit memuat **4 identifikasi utama**:

| Komponen | Sumber | Keterangan |
|---|---|---|
| Nama produk | `unit.nama` (fallback `modelUnit`) | nama panggilan unit |
| Model | `unit.modelUnit` | tipe/model unit |
| Nomor seri | `unit.serialNumber` | isi QR — kunci unik |
| Toko | `unit.toko.namaToko` | **otomatis** dari data unit / scan toko pertama |

`waktuScan` **tidak dicetak** di stiker (tidak mungkin diketahui sebelum discan).
Waktu scan dihasilkan saat pemindaian: server mengembalikannya di
`identifikasi.waktuScan`, dan aplikasi mobile boleh memakai waktu lokal perangkat.

QR hanya berisi **nomor seri** agar tetap pendek dan mudah dibaca saat stiker
dicetak mini. Ketiga data lain dikirim otomatis oleh `GET /api/mobile/scan`
sehingga aplikasi tidak perlu mengetik apa pun.

Stiker bisa dicetak dalam 3 ukuran (dropdown **Kertas**):

| Pilihan | Lebar stiker | Pemakaian |
|---|---|---|
| A4 | 44 mm | printer biasa |
| Label Thermal 58 mm | 36 mm | printer label portable |
| **Mini 28 mm** | 28 mm | label kecil / hemat tempat |

### 5.3 Urutan

```mermaid
sequenceDiagram
  participant HP as Android
  participant API as Next.js
  HP->>API: GET /api/mobile/scan?kode=SN-KPAS-2026-0001
  API-->>HP: tipe=UNIT + unit + tiket + tahap + aksiTersedia
  alt aksi = TARIK_WORKSHOP
    HP->>API: PATCH /api/service/123 {aksi:"TARIK_WORKSHOP"}
    API-->>HP: 200 tiket PROSES, lokasiUnit WORKSHOP, noSttb terbit
  else aksi = FINISH
    HP->>API: PATCH /api/service/123 {aksi:"FINISH", fotoNotaStempel:"..."}
    API-->>HP: 200 tiket FINISH
  else aksi = KEMBALI_KE_TOKO
    HP->>API: PATCH /api/service/123 {aksi:"KEMBALI_KE_TOKO", tglKembali:"..."}
    API-->>HP: 200 lokasiUnit TOKO, STTB dicabut
  end
```

### 5.4 Respons scan unit

```json
{
  "ok": true,
  "tipe": "UNIT",
  "kode": "SN-KPAS-2026-0001",
  "unit": {
    "id": 91, "serialNumber": "SN-KPAS-2026-0001", "modelUnit": "Kipas Angin",
    "merk": "Miyako", "nama": "Kipas Ruang Tamu", "statusGaransi": "GARANSI",
    "kerusakanAwal": "Tidak mau berputar",
    "toko": { "id": 32, "kodeToko": "TOK-032", "namaToko": "Toko Andika" },
    "customer": null
  },
  "identifikasi": {
    "namaProduk": "Kipas Ruang Tamu",
    "model": "Kipas Angin",
    "nomorSeri": "SN-KPAS-2026-0001",
    "namaToko": "Toko Andika",
    "waktuScan": "2026-11-02T08:15:00.000Z"
  },
  "tiket": {
    "id": 123, "noTiket": "SVC-2611-0001", "status": "PROSES",
    "penanganan": "TARIK_WORKSHOP", "lokasiUnit": "WORKSHOP",
    "noSttb": "STTB-2611-0001", "tglFinish": null, "tglKembaliKeToko": null,
    "parts": [
      { "id": 1, "kodePart": "KP-001", "namaPart": "Kapasitor", "qty": 1,
        "statusPart": "READY", "statusKonfirmasi": "READY" }
    ]
  },
  "tahap": "DI_WORKSHOP",
  "tahapLabel": "Unit di workshop",
  "aksiTersedia": [
    { "aksi": "FINISH", "label": "Selesaikan (Finish)", "endpoint": "PATCH /api/service/123" },
    { "aksi": "KEMBALI_KE_TOKO", "label": "Kirim Balik ke Toko", "endpoint": "PATCH /api/service/123" }
  ]
}
```

Bila nomor seri dipakai beberapa unit:

```json
{ "ok": true, "tipe": "UNIT_GANDA", "pesan": "2 unit memakai nomor seri yang sama — pilih salah satu", "kandidat": [ ... ] }
```

Bila tidak dikenal: `404 { "ok": false, "tipe": "TIDAK_DIKENAL", "error": "..." }`.

### 5.5 State machine tahap

```mermaid
stateDiagram-v2
  [*] --> TERDAFTAR: unit registrasi, belum ada tiket
  TERDAFTAR --> REQUEST: tiket dibuat (web/scan)
  REQUEST --> REQUEST_EMAIL: part inden via email produsen
  REQUEST --> TUNGGU_PART: DAFTAR_TUNGGU_TOKO
  REQUEST --> PROSES_DI_TOKO: KERJAKAN_DI_TOKO
  REQUEST --> DI_WORKSHOP: TARIK_WORKSHOP
  TUNGGU_PART --> PROSES_DI_TOKO: KERJAKAN_DI_TOKO
  TUNGGU_PART --> DI_WORKSHOP: TARIK_WORKSHOP
  PROSES_DI_TOKO --> FINISH: FINISH
  DI_WORKSHOP --> FINISH: FINISH
  FINISH --> FINISH_DI_WORKSHOP: unit masih di workshop
  FINISH --> SELESAI_DI_TOKO: KEMBALI_KE_TOKO
  FINISH_DI_WORKSHOP --> SELESAI_DI_TOKO: KEMBALI_KE_TOKO
```

### 5.6 Tabel aksi `PATCH /api/service/{id}`

Body selalu `{ "aksi": "<NAMA>", "aktor": "mobile:<nama teknisi>", ...field }`.
`aktor` opsional tetapi **sangat disarankan** agar Audit Log jelas.

| Aksi | Dari status | Efek | Field tambahan | Error khas |
|---|---|---|---|---|
| `DAFTAR_TUNGGU_TOKO` | `REQUEST` | `penanganan=TUNGGU_PART_TOKO`, unit tetap di toko | – | `409` bukan REQUEST |
| `KERJAKAN_DI_TOKO` | `REQUEST` / `PROSES`+`BELUM` | `PROSES`, `DI_TOKO`, `lokasi=TOKO`, STTB terbit | – | `409` ada part belum READY |
| `TARIK_WORKSHOP` | `REQUEST` / `PROSES`+`BELUM` | `PROSES`, `TARIK_WORKSHOP`, `lokasi=WORKSHOP`, STTB terbit | – | `409` ada part belum READY |
| `FINISH` | `PROSES` | `status=FINISH`, `tglFinish` | `tglFinish?`, `fotoNotaStempel?`, `tandaTanganDigital?` | `409` bukan PROSES; `400` tanggal tidak valid |
| `KEMBALI_KE_TOKO` | `PROSES` / `FINISH` | `lokasi=TOKO`, `sttbDicabut=true`, `tglKembaliKeToko` | `tglKembali?` | `409` sudah pernah; `400` tanggal di masa depan |
| `MULAI_PROSES` | `REQUEST` | `PROSES` + STTB (langsung tarik workshop) | – | `409` belum ada part READY |
| `KIRIM_PART_RUSAK` | `PROSES` | catat `noSuratJalan` | `noSuratJalan` (wajib) | `400` kosong |

Contoh FINISH:

```http
PATCH /api/service/123
Authorization: Bearer <token>
Content-Type: application/json

{
  "aksi": "FINISH",
  "aktor": "mobile:Budi",
  "tglFinish": "2026-11-02T09:30:00.000Z",
  "fotoNotaStempel": "data:image/jpeg;base64,..."
}
```

Respons: objek `ServiceRequest` terbaru (termasuk `status`, `lokasiUnit`,
`penanganan`, `noSttb`, `tglFinish`, `tglKembaliKeToko`).

> **Penting:** `FINISH` tidak otomatis berarti unit sudah di toko. Setelah
> `FINISH`, panggil `KEMBALI_KE_TOKO` saat unit benar-benar sampai toko.
> Jika unit dikerjakan di toko (`KERJAKAN_DI_TOKO`), `KEMBALI_KE_TOKO` tetap
> boleh dipakai untuk mencatat unit selesai/serah terima.

### 5.7 Aturan tanggal (ditegakkan server)

- `tglFinish` tidak boleh di masa depan dan tidak boleh lebih awal dari
  `tglPartDatang`, part terpasang, atau `tglKembaliKeToko` (minimal sama hari).
- `tglKembali` tidak boleh di masa depan / sebelum tiket dibuat / sebelum `tglFinish`.
- Format salah → `400` dengan pesan yang bisa langsung ditampilkan.

Mobile sebaiknya mengirim waktu **lokal perangkat dalam ISO-8601 dengan zona**
(`2026-11-02T09:30:00+08:00`) atau UTC (`...Z`). Jangan mengirim tanggal tanpa jam.

---

## 6. Sinkronisasi Field Ops

Saat aplikasi dibuka / tarik-to-refresh:

```mermaid
sequenceDiagram
  participant HP as Android
  participant API as Next.js
  HP->>API: GET /api/toko
  API-->>HP: 49 toko + visitTerlambat + hariSejakVisit
  HP->>API: GET /api/kunjungan
  API-->>HP: 100 kunjungan terbaru
  HP->>API: GET /api/notifikasi
  API-->>HP: notifikasi + belumDibaca
  HP->>HP: simpan ke Room (cache offline)
```

- `GET /api/toko` → array `MasterToko` + `jumlahUnit`, `visitTerlambat`, `hariSejakVisit`.
- `GET /api/kunjungan` → 100 kunjungan terbaru (desc), sudah termasuk `toko` & `teknisi`.
- `GET /api/notifikasi` → `{ items, belumDibaca, total }` (maks 50).
- `GET /api/unit` → semua unit + `barcodeData` (`SN:...|MOD:...|TOK:...`) + tiket ringkas.

Urutan prioritas offline: toko → unit → tiket → kunjungan.

---

## 7. Strategi offline & retry

1. **Room DB** menyimpan antrean aksi: `{ id, tipe, endpoint, body, status, percobaan, createdAt }`.
2. Aksi tulis (`POST /api/kunjungan`, `PATCH /api/service`) masuk antrean dulu,
   UI optimistis, lalu worker mengirim saat online.
3. **Jangan retry** untuk `400`, `401`, `403`, `404`, `409` — tandai `GAGAL_PERMANEN`
   dan tampilkan alasan.
4. Retry hanya untuk `5xx`, timeout, dan error jaringan: backoff eksponensial
   `1 s → 2 s → 4 s → 8 s → 30 s` (maks 5 percobaan).
5. Aksi tahap bersifat **idempoten secara alur**: mengulang `FINISH`/`KEMBALI_KE_TOKO`
   yang sudah sukses akan dijawab `409` — perlakukan `409` pada replay sebagai
   "sudah tercatat", lalu sinkronkan ulang state.
6. Foto disimpan sebagai file di storage internal + URI di antrean; unggah
   base64 hanya saat mengirim.

---

## 8. Keamanan

- Token JWT disimpan di `EncryptedSharedPreferences`; jangan pernah di log.
- Wajib HTTPS di produksi. Untuk uji LAN, whitelist IP di `network_security_config`.
- Jangan menaruh `AUTH_SECRET`, password DB, atau token gateway di APK.
- Sembunyikan aksi berdasarkan role; server tetap menolak (`403`) bila dipaksa.
- Validasi hasil scan: batasi panjang kode (mis. ≤ 120 karakter), tolak karakter kontrol.
- Logout: hapus token + bersihkan cache Room yang berisi data pelanggan.

---

## 9. Contoh implementasi Kotlin (Retrofit + OkHttp)

```kotlin
// build.gradle.kts
// implementation("com.squareup.retrofit2:retrofit:2.11.0")
// implementation("com.squareup.retrofit2:converter-moshi:2.11.0")
// implementation("com.squareup.okhttp3:logging-interceptor:4.12.0")

data class LoginRequest(val email: String, val password: String)
data class LoginResponse(val ok: Boolean, val token: String, val user: UserDto)
data class UserDto(val id: Int, val nama: String, val email: String, val role: String)

data class ScanResponse(
    val ok: Boolean,
    val tipe: String,              // TOKO | UNIT | UNIT_GANDA | TIKET | TIDAK_DIKENAL
    val kode: String,
    val toko: TokoDto? = null,
    val unit: UnitDto? = null,
    val identifikasi: IdentifikasiDto? = null,
    val tiket: TiketDto? = null,
    val tahap: String? = null,
    val tahapLabel: String? = null,
    val aksiTersedia: List<AksiDto> = emptyList(),
    val kandidat: List<UnitDto> = emptyList(),
    val error: String? = null,
)

data class IdentifikasiDto(
    val namaProduk: String,
    val model: String,
    val nomorSeri: String,
    val namaToko: String?,
    val waktuScan: String,         // ISO-8601 dari server
)

data class AksiDto(val aksi: String, val label: String, val endpoint: String? = null)

data class CheckinRequest(
    val barcode: String,
    val teknisiId: Int,
    val metodeCheckin: String = "SCAN_BARCODE",
    val tglKunjungan: String? = null,
    val catatanStokRusak: String? = null,
    val fotoOnsite: String? = null,
)

data class AksiTiketRequest(
    val aksi: String,
    val aktor: String? = null,
    val tglFinish: String? = null,
    val tglKembali: String? = null,
    val fotoNotaStempel: String? = null,
)

interface AsproApi {
    @POST("api/auth/login")
    suspend fun login(@Body body: LoginRequest): LoginResponse

    @GET("api/mobile/scan")
    suspend fun scan(@Query("kode") kode: String): ScanResponse

    @POST("api/kunjungan")
    suspend fun checkin(@Body body: CheckinRequest): Response<Unit>

    @PATCH("api/service/{id}")
    suspend fun aksiTiket(@Path("id") id: Int, @Body body: AksiTiketRequest): Response<Unit>
}

class AuthInterceptor(private val tokenProvider: () -> String?) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): okhttp3.Response {
        val token = tokenProvider()
        val req = chain.request().newBuilder().apply {
            if (!token.isNullOrBlank()) header("Authorization", "Bearer $token")
            header("Accept", "application/json")
        }.build()
        return chain.proceed(req)
    }
}
```

Contoh pemakaian:

```kotlin
val hasil = api.scan(kodeDariKamera) // "Toko Andika" atau "SN-KPAS-2026-0001"

when (hasil.tipe) {
    "TOKO" -> {
        api.checkin(
            CheckinRequest(
                barcode = hasil.kode,
                teknisiId = sesi.user.id,
                catatanStokRusak = catatan.ifBlank { null },
            )
        )
        // tampilkan nama toko + alamat + koordinat
    }
    "UNIT", "TIKET" -> {
        val tiket = hasil.tiket ?: return
        val aksi = pilihAksi(hasil.aksiTersedia) // mis. TARIK_WORKSHOP
        api.aksiTiket(tiket.id, AksiTiketRequest(aksi = aksi.aksi, aktor = "mobile:${sesi.user.nama}"))
    }
    else -> tampilkanError(hasil.error ?: "Kode tidak dikenali")
}
```

> `PATCH` di Retrofit butuh `@PATCH` dari Retrofit 2.6+ (sudah tersedia di 2.11).

---

## 10. Uji cepat dengan curl

```bash
# 1) login
curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"dazz","password":"RAHASIA"}'

# 2) scan toko (ganti TOKEN)
curl -s "http://localhost:3000/api/mobile/scan?kode=Toko%20Andika" \
  -H "Authorization: Bearer TOKEN"

# 3) scan unit
curl -s "http://localhost:3000/api/mobile/scan?kode=SN-KPAS-2026-0001" \
  -H "Authorization: Bearer TOKEN"

# 4) check-in
curl -s -X POST http://localhost:3000/api/kunjungan \
  -H "Authorization: Bearer TOKEN" -H "Content-Type: application/json" \
  -d '{"barcode":"Toko Andika","teknisiId":5,"metodeCheckin":"SCAN_BARCODE"}'

# 5) tarik ke workshop
curl -s -X PATCH http://localhost:3000/api/service/123 \
  -H "Authorization: Bearer TOKEN" -H "Content-Type: application/json" \
  -d '{"aksi":"TARIK_WORKSHOP","aktor":"mobile:Budi"}'
```

---

## 11. Ringkasan keputusan desain

| Keputusan | Alasan |
|---|---|
| Satu endpoint scan (`/api/mobile/scan`) | HP tidak perlu tahu apakah kode itu toko, unit, atau tiket |
| Penulisan memakai endpoint web yang ada | Satu sumber aturan bisnis, tidak ada logika ganda |
| `aksiTersedia` dikirim server | Tombol di HP selalu sesuai state & guard server |
| `409` = aturan bisnis | Mobile tidak retry, cukup tampilkan pesan |
| QR toko berisi nama toko | Hasil scan langsung terbaca manusia; kode lama tetap didukung |
| QR unit berisi nomor seri | Unik per unit, ringkas, tahan lama |

---

_Versi dokumen: 1.0 — 2 November 2026._
