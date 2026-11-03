# Bank Kode Produsen — pencatatan & pencarian kode sparepart

Dokumen ini menjelaskan cara kerja **Bank Kode Produsen** di menu *Lacak Sparepart*:
apa yang dicatat, bagaimana pencocokan dilakukan, dan cara merawat datanya.

---

## 1. Tujuan

Bank Kode adalah satu tempat untuk **semua kode sparepart yang pernah masuk aplikasi**,
sehingga teknisi/admin tidak perlu membuka tiket lama satu per satu saat butuh kode.

Sumber yang ditarik saat **Sinkronkan**:

| Sumber     | Asal data                                                        |
|------------|------------------------------------------------------------------|
| `KATALOG`  | Master sparepart (stok & katalog workshop)                       |
| `PRODUSEN` | Baris part di tiket service yang berasal dari balasan produsen    |
| `WORKSHOP` | Part yang ditambahkan manual saat proses service                 |
| `ORDER`    | Permintaan order customer **dan** item order-email ke produsen    |
| `CSV`      | Import CSV kode baru rilis produsen                              |
| `MANUAL`   | Input manual lewat form "Tambah kode"                            |

Sinkron bersifat **idempoten**: aman ditekan kapan pun. Baris yang sudah ada tidak
ditimpa dengan data kosong — hanya kolom yang masih kosong yang dilengkapi.

---

## 2. Pencarian yang toleran (inti perbaikan)

Masalah lama: mencari `RI-202S` **tidak menemukan** `Top Plate RI 202 S`, karena:

1. data tersimpan memakai **spasi** (`RI 202 S`) sedangkan yang dicari memakai **strip**;
2. kolom `modelTipe` sebagian besar **kosong** (baris lama/CSV).

Perbaikan ada di `src/lib/cocok-kode.ts`:

- `normCari` — UPPERCASE, semua pemisah (`- / . , ( )`) jadi spasi, spasi dirapatkan.
- `rapatCari` — versi tanpa spasi (`RI202S`).
- `tokenCari` — memecah batas huruf↔angka (`RI-202S` → `RI`, `202`, `S`).
- `varianDbCari` — variasi kata kunci untuk query database (`RI 202 S`, `RI202S`, token).
- `ekstrakModelDariNama` — mengambil model dari nama part saat kolom model kosong
  (`Top Plate RI 202 S` → `RI 202 S`), dengan daftar kata yang **bukan** model
  (ASSY, CASE, PLATE, UF, VAC, BIT, EF, DIA, OHM, dll.).
- `skorCocokKode` — skor 0–100 per baris + daftar bidang yang cocok.

### Bobot skor

| Bidang      | Bobot | Catatan                                        |
|-------------|-------|------------------------------------------------|
| `kode`      | 1.00  | kode persis = 100                              |
| `model`     | 1.00  | `modelTipe` atau hasil ekstraksi nama           |
| `namaPart`  | 0.95  | pencarian kata kunci nama part                 |
| `brand`     | 0.70  | "rinnai", "miyako"                             |
| `produsen`  | 0.60  | supplier                                       |
| `catatan`   | 0.50  | catatan bebas                                  |

Aturan: cocok persis = 100; kueri termuat di nilai = 96/94; kecocokan token
proporsional = 55–100. Pencarian normal menyaring **≥ 45** dan mengurutkan
paling relevan; kueri 1–2 huruf tidak disaring.

Contoh hasil nyata:

```
q="RI-202S"
100 [kode,model,nama] RI202-001-2-1X02-PR | Top Plate RI 202 S | model=RI 202 S
 94 [kode,model,nama] RI202-002-2-P      | SIDE PANEL RHS RI-202
 85 [kode,model,nama] RI52-201-2-5-1X01-PR | Top Plate RI-522 S
```

---

## 3. Aturan kolom `modelTipe`

`modelTipe` **hanya** diisi bila memang diberikan eksplisit (CSV atau input manual).

Sistem **tidak** menyalin model unit tiket/order-email ke kolom ini, karena satu
part bisa dipakai banyak model — penyalinan otomatis pernah mengotori 138 baris
(mis. gas valve & `FSDF` diberi label `RI 202 S`).

Untuk tampilan & pencarian, model dihitung saat dibaca (`modelTampil`):

```
modelTampil = modelTipe (bila ada)  ||  ekstrakModelDariNama(namaPart)
```

Jadi `RI-202S` tetap menemukan `Top Plate RI 202 S` walau kolom modelnya kosong,
tanpa menulis tebakan ke database.

---

## 4. Ringkasan di UI

Header kartu Bank Kode menampilkan:

- **total kode terdaftar**;
- **jumlah model unik** (dihitung dari `modelTipe` atau nama part);
- **sebaran sumber** (`KATALOG 133 · CSV 154 · WORKSHOP 10 · …`);
- saat mencari: jumlah kode cocok + keterangan "diurutkan paling relevan".

Tiap baris hasil menampilkan badge `cocok: kode, model, nama · skor`, model yang
bisa **diklik** untuk mencari semua kode model tersebut, brand/produsen, dan sumber.

---

## 5. Perawatan data

- Tekan **Sinkronkan** setelah impor CSV atau setelah banyak tiket baru, agar kode
  dari tiket/order-email ikut masuk.
- Bila `modelTipe` terlanjur terisi otomatis dan ingin dikembalikan ke nilai
  eksplisit, jalankan (dry-run dulu):

  ```bash
  node scripts/bersihkan-model-bank-kode.mjs            # lihat ringkasan
  node scripts/bersihkan-model-bank-kode.mjs --terapkan # pulihkan dari backup
  ```

  Skrip membandingkan dengan backup `db/backups/custom-2026-11-03-171530.db`
  dan hanya mempertahankan nilai yang memang eksplisit.

- Uji live pencarian & sinkron:

  ```bash
  node scripts/debug-cek-bank-kode.mjs
  ```

  Skrip memastikan `RI-202S` menemukan Top Plate dan tidak ada model salah tempel.

---

## 6. Berkas terkait

| Berkas | Isi |
|--------|-----|
| `src/lib/cocok-kode.ts` | normalisasi, ekstraksi model, skor, ringkasan (murni) |
| `src/lib/bank-kode.ts` | `catatBankKode` (upsert aman), `cariKodeDariNama` |
| `src/app/api/bank-kode/route.ts` | GET pencarian + skor + ringkasan, POST manual |
| `src/app/api/bank-kode/sinkron/route.ts` | tarik semua sumber kode |
| `src/app/api/bank-kode/cari-nama/route.ts` | saran kode otomatis saat mengetik nama part |
| `src/components/views/sparepart-finder-view.tsx` | UI Bank Kode |
| `tests/unit/cocok-kode.test.ts` | 15+ kasus pencocokan & ekstraksi model |
| `scripts/debug-cek-bank-kode.mjs` | uji live |
| `scripts/bersihkan-model-bank-kode.mjs` | pemulihan `modelTipe` dari backup |
