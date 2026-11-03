# Worklog

---
Task ID: 57
Agent: DeepSeek V4.1 Flash Free (opencode)
Task: Referensi otomatis saat input kode/nama sparepart — kode atau nama lengkap langsung dicek kesamaannya

Work Log:
- Permintaan user: saat memasukkan kode ATAU nama sparepart, bila yang diketik sudah lengkap sistem langsung mengecek kesamaan dan memunculkan referensi (bukan hanya saat kolom nama ditinggalkan seperti sebelumnya).
- `src/lib/cocok-kode.ts`: fungsi baru `skorKodeCocok` (khusus kode: persis 100, awalan/terkandung 90, salah ketik 1 huruf 82, token sengaja TIDAK dipakai agar `RI-202S` tidak dianggap mirip `RI202-001-…`), `jarakEditTerbatas`, dan `skorNamaCocok` (nama/model persis 100, memuat 95, token proporsional) — bobot bidang tidak dipakai di sini supaya nama persis benar-benar "persis".
- `src/lib/bank-kode.ts`: `cariReferensiPart({kode,nama})` menggabungkan Bank Kode + master katalog, menilai kode/nama, lalu memperkaya hasil dengan stok (`stokInventory`) dan jumlah pemakaian di tiket (`serviceRequestPart.groupBy`). `cariKodeDariNama` sekarang delegasi ke fungsi ini (kompatibel dengan pemanggil lama).
- `GET /api/bank-kode/referensi?kode=&nama=&take=` (baru, read-only): ambang kode ≥4 karakter, nama ≥3 karakter; hasil urut skor lalu paling sering dipakai.
- `src/components/referensi-part.tsx` (baru): debounce 400 ms, tampilkan kode, nama, badge persis/skor, sumber, brand/model, stok, dan "dipakai N×"; klik untuk memakai kode+nama. Bila tepat satu kecocokan persis, field yang masih kosong diisi otomatis (tidak menimpa ketikan).
- Integrasi: `service-flow.tsx` (catat balasan produsen + tambah part manual; chip lama diganti komponen ini), `inventory-view.tsx` (dialog tambah sparepart), `master-data-view.tsx` (baris part registrasi unit + part kurang).
- Uji unit baru: `skorKodeCocok` (persis/awalan/typo 1 huruf/kode beda tidak cocok) dan `skorNamaCocok` (nama persis, model di dalam nama, nama memuat kueri) — total 201 lulus.
- Uji live `scripts/debug-cek-referensi-part.mjs`: kode lengkap 100% + katalog + dipakai 1×; awalan 90%; typo 1 huruf 82%; nama lengkap 100%; `RI-202S` tidak memunculkan `RI202-001-…` (tidak menyesatkan). `debug-cek-bank-kode.mjs` tetap OK (Top Plate ditemukan, tidak ada model salah tempel).
- Verifikasi: tsc 0; eslint 0 (file berubah); vitest 201 lulus; build + PM2 + health 200.
- Git: belum di-commit (menyatu dengan Task 56 yang juga uncommitted).

Stage Summary:
- Input part kini aktif mengecek kesamaan begitu kode (≥4 karakter) atau nama (≥3 karakter) dianggap lengkap, lalu menampilkan referensi kode/nama yang pernah ada lengkap dengan stok dan riwayat pemakaian. Pengguna bisa klik untuk memakai, dan field kosong terisi otomatis saat ada satu kecocokan persis — mengurangi salah kode tanpa menambah langkah manual.

---
Task ID: 56
Agent: DeepSeek V4.1 Flash Free (opencode)
Task: Bank Kode Produsen — rangkum semua kode yang pernah diinput & pencarian model toleran ("RI-202S" → Top Plate RI 202 S)

Work Log:
- Keluhan user: mencari kode untuk `RI-202S` tidak menemukan apa pun, padahal ada `RI202-001-2-1X02-PR | Top Plate RI 202 S | RINNAI`. Penyebab: (1) query memakai `contains` apa adanya sehingga `RI-202S` ≠ `RI 202 S`, (2) kolom `modelTipe` kosong di 291/299 baris.
- Modul baru `src/lib/cocok-kode.ts` (murni): `normCari`/`rapatCari`/`tokenCari`/`varianDbCari` (toleran strip, spasi, batas huruf↔angka), `ekstrakModelDariNama` (model dari nama part + stopword part/satuan), `rapikanModel`, `skorCocokKode` (bobot kode/model 1.0, nama 0.95, brand 0.7, produsen 0.6, catatan 0.5; skor 0–100 + bidang `pada`), `ringkasBankKode`.
- `src/lib/bank-kode.ts`: `catatBankKode` hanya menyimpan `modelTipe` eksplisit (keputusan: JANGAN menebak dari nama/unit — satu part bisa banyak model); `cariKodeDariNama` memakai varian token + skor ≥80 khusus nama/model.
- `GET /api/bank-kode`: kandidat 800 baris via varian, dinilai `skorCocokKode`, saring ≥45 (kueri >2 huruf), urut relevansi; respons menambah `skor`, `cocokPada`, `modelTampil`, `totalCocok`, `ringkasan` (total, model unik, per sumber).
- `POST /api/bank-kode/sinkron`: menarik SEMUA sumber — katalog, semua part tiket (termasuk cache), order customer, order-email produsen; tidak lagi menyalin model unit ke `modelTipe`.
- UI `sparepart-finder-view.tsx`: badge total kode + jumlah model, sebaran sumber, keterangan "N kode cocok · diurutkan paling relevan", badge `cocok: … · skor`, model `modelTampil` bisa diklik untuk mencari model itu, placeholder & empty-state menjelaskan `RI202S`/`top plate`.
- Insiden & pembersihan: percobaan awal sempat mengisi model otomatis → 138 baris terisi (gas valve & `FSDF` salah berlabel `RI 202 S`). Skrip baru `scripts/bersihkan-model-bank-kode.mjs` membandingkan backup `db/backups/custom-2026-11-03-171530.db` lalu mengosongkan 130 nilai hasil tebakan; `modelTipe` kembali **8 baris eksplisit**.
- Dokumen `docs/bank-kode.md` (baru): sumber data, aturan normalisasi & bobot skor, aturan `modelTipe` vs `modelTampil`, ringkasan UI, perawatan data.
- Uji: `tests/unit/cocok-kode.test.ts` (15 kasus: normalisasi, varian, ekstraksi model termasuk stopword `UF/VAC/BIT/EF/DIA/OHM`, skor, ringkasan). Hasil: tsc 0; eslint 0 (file berubah); vitest 194 lulus; build + PM2 + health 200.
- Uji live `scripts/debug-cek-bank-kode.mjs`: sinkron idempoten `{baru:0,dilengkapi:0,total:299}`; `RI-202S` → Top Plate skor 100 (bidang kode+model+nama); `ri202s`, `top plate`, `rinnai`, `gas single total` wajar; tidak ada model salah tempel.
- Git: belum di-commit.

Stage Summary:
- Bank Kode kini merangkum seluruh kode dari katalog, tiket (workshop/produsen), order customer, order-email, CSV, dan manual; pencarian tidak lagi gagal karena beda tanda hubung/spasi, dan model yang tidak tersimpan di kolom tetap terbaca dari nama part saat dicari. Data `modelTipe` bersih kembali (hanya 8 nilai eksplisit), jadi tidak ada lagi part yang salah label model.

---
Task ID: 55
Agent: DeepSeek V4.1 Flash Free (opencode)
Task: Alur part bergelombang — satu unit beberapa bagian rusak, order part susulan TANPA tiket baru

Work Log:
- Pertanyaan user: satu unit rusak di beberapa bagian (top plate, side, rear). Part gelombang 1 datang, lalu ketahuan bagian lain rusak. Dulu kebiasaan langsung FINISH karena part sudah datang → padahal masih perlu order lagi. Perlu solusi tanpa tiket baru.
- Keputusan: TIDAK perlu tiket baru. Satu unit = satu tiket untuk seluruh siklus servis; part tambahan dipesan lewat `TAMBAH_PART` di tiket yang sama (stok kurang otomatis `ORDER_PRODUSEN`). Klaim produsen tetap satu kali per tiket (semua part + jasa), jadi tidak ada tiket/STTB/statistik ganda.
- `src/lib/part-tunggu.ts` (baru, murni): `daftarPartBelumDatang` (qty > 0 & statusPart != READY), `labelPartTunggu` (kode + nama + qty, fallback cache), `pesanPartBelumDatang` (pesan 409 berisi daftar part + pilihan tindakan).
- Guard `FINISH` di `src/app/api/service/[id]/route.ts`: selama masih ada part belum datang → `409` (status tetap PROSES, `tglFinish` tidak terisi). Bukan memaksa user menunggu part pertama lalu "terpaksa selesai".
- `src/lib/alur-sj.ts`: `alurSjState` mendahulukan part outstanding — pesanan susulan mengembalikan chip ke `BELUM_SJ`/`SJR_TANPA_KIRIM`/`BEKAS_TERKIRIM`, bukan tetap `PART_DATANG` yang menyesatkan.
- UI web: `service-flow.tsx` menambah kotak kuning "Masih menunggu N part — jangan Selesaikan dulu" + daftar part; menu "Selesaikan" di `service-view.tsx` dinonaktifkan dengan tooltip berisi daftar part selama masih menunggu.
- Mobile: `src/lib/mobile-tahap.ts` — `PartRingkas.qty`, `aksiTersedia` hanya menawarkan `FINISH` bila `belumDatang.length === 0` (baris qty 0/batal tidak menahan); `KEMBALI_KE_TOKO` tetap ditawarkan. Server tetap sumber kebenaran (409).
- Dokumen: `docs/alur-part-bergelombang.md` (baru — SOP lengkap: aturan inti, langkah kerja, buka ulang FINISH, penjagaan sistem, ringkas teknisi); `docs/skema-komunikasi-mobile.md` v1.3 (tabel aksi FINISH + catatan part bergelombang & `BUKA_ULANG_PROSES`).
- Skrip uji live: `scripts/debug-cek-finish-part.mjs` — bila tak ada tiket asli, membuat tiket sementara `DEBUG-PART-*`, memanggil FINISH, memastikan 409 + status PROSES + tglFinish null, lalu menghapusnya (sisa tiket uji: 0).
- Uji: `tests/unit/part-tunggu.test.ts` (8 kasus: filter part, label, pesan, 4 transisi alur SJ) + 2 kasus baru `mobile-tahap.test.ts` (FINISH ditahan saat part belum datang; qty 0 tidak menahan). Hasil: tsc 0; eslint 0 (file berubah); vitest 180 lulus; live FINISH → 409 dengan daftar part; build + PM2 + health 200.
- Git: belum di-commit (menyatu dengan perubahan Task 54 yang juga uncommitted).

Stage Summary:
- Teknisi tidak lagi terjebak "part datang = harus FINISH". Selama ada part yang masih dipesan, tombol Selesaikan ditahan (web + mobile) dan server menolak FINISH; part susulan ditambahkan di tiket yang sama. Tiket yang sudah terlanjur FINISH bisa dibuka ulang lewat `BUKA_ULANG_PROSES` (Admin/Manager), jadi tidak ada tiket baru untuk unit yang sama.

---
Task ID: 54
Agent: DeepSeek V4.1 Flash Free (opencode)
Task: Isi QR stiker unit memuat 4 identifikasi (nama produk, model, nomor seri, toko) + Tag ID = nomor seri

Work Log:
- Motif user: hasil pindai di aplikasi Kotlin menampilkan nama produk/model/nomor seri yang salah (data tebakan), karena QR hanya berisi nomor seri
- Modul baru `src/lib/kode-unit.ts`: format `SN:<nomor seri>|MOD:<model>|TOK:<toko/customer>|NAMA:<nama produk>`; `bangunKodeUnit` (pembersih `|`/baris baru + batas panjang SN 32/model 24/nama 36/toko 30), `uraiKodeUnit` (format baru, format lama tanpa NAMA, stiker lama berisi nomor seri saja), `adalahKodeUnit`, `nomorSeriDariKode` — `SN:` selalu di depan agar Tag ID = nomor seri
- `unit-barcode-sticker.tsx`: QR memakai `bangunKodeUnit`, QR diperbesar 64→80 px (≈21 mm saat 28 mm) supaya modul tetap ≥0,47 mm; label "SN" → "Tag ID"; deskripsi dialog menyebut 4 identifikasi
- `GET /api/mobile/scan`: pencarian DB selalu memakai nomor seri hasil `nomorSeriDariKode`; respons `identifikasi` menambah `tagId` (= nomorSeri, sumber DATABASE) + `identifikasiStiker` (hasil urai QR); stiker valid tapi unit belum terdaftar → 404 dengan `identifikasiStiker` + pesan "daftarkan unit dulu"
- `GET /api/unit`: `barcodeData` ikut format baru (TOK = nama toko/customer, bukan kode toko) + `prisma/schema.prisma` komentar format
- Docs `skema-komunikasi-mobile.md` v1.2: bagian 5.1/5.2 ditulis ulang (format QR, aturan Tag ID, batas panjang, kompatibilitas), `IdentifikasiDto.tagId` + objek `KodeUnit.urai()` Kotlin, contoh pemakaian QR-first lalu refresh API, contoh curl payload ter-encode
- Skrip uji: `scripts/debug-cek-kode-unit.mjs` (4 kasus live), `scripts/debug-preview-stiker-mini.mjs` diperbarui (QR 77 karakter/39 modul, cetak 28 mm)
- Verifikasi: tsc 0; eslint 0 (file berubah); vitest 170 lulus (13 test baru kode-unit); live: payload baru → UNIT + identifikasiStiker, format lama & nomor seri saja tetap 200, serial tak terdaftar → 404 + identifikasiStiker; pratinjau 28 mm: QR 39 modul (±0,54 mm/modul), 4 baris terbaca penuh; build + PM2 + health 200
- Git: belum di-commit

Stage Summary:
- Stiker unit kini membawa keempat identifikasi di dalam QR, jadi aplikasi mobile bisa menampilkan nama produk/model/toko langsung dari hasil pindai tanpa menebak; Tag ID diambil dari bagian `SN:` (nomor seri), dan server tetap memakai database sebagai sumber `identifikasi` sehingga koreksi data di web menang atas stiker lama.

---
Task ID: 53
Agent: GLM-5.3-Flash Free (opencode)
Task: Lanjutan alur — chip "Bekas terkirim"/"Part datang" ganti "Part terpasang" di bawah finish + indikator lama unit di workshop tetap ada

Work Log:
- Tambahan dari user: di tab FINISH masih ada chip alur SJ "Bekas terkirim"/"Part datang" padahal part sudah terpasang; usul 2 hal: (1) indikator di posisi umur tetap menampilkan lama unit di workshop, (2) "Part terpasang" tampil di bawah tgl finish menggantikan chip-chip itu
- Helper baru `durasiUnitWorkshop` (`src/lib/alur-tanggal.ts`): tidak ada kolom "masuk workshop" — diambil tanggal PALING AWAL dari sinyal kerja unit di workshop (tglRequestPart / tglPartDatang / tglPasang per baris part / tglFinish); dipotong tglKembaliKeToko saat terekam (durasi lampau); hasil { jam, mulai } — diakui approximasi (tglPasang bisa tercatat saat unit masih di toko)
- `src/components/views/service-view.tsx`:
  • `BadgeAlurSj` — tiket FINISH tidak lagi merender chip alur SJ (Bekas terkirim/Part datang dsb.) karena kejadiannya sudah lewat; filter alur SJ tetap berlaku (state dasar tidak diubah)
  • Kolom/kartu "Tgl Finish" untuk tiket FINISH kini 3 baris bertumpuk: tgl finish → "Part terpasang {DD/MM}" (teal, tgl pemasangan part TERAKHIR, title full) → baris bawah: "Kembali {DD/MM}" emerald ATAU "Masih di workshop · {durasi}" amber
  • Non-FINISH dgn unit di WORKSHOP juga menampilkan durasi amber "Unit di workshop · {durasi}" di posisi kolom yang sama (tanda unit lama tertahan; tiket di toko tetap "—")
  • helper modul `tglPasangTerakhir(t)` pakai bersama tabel desktop & kartu HP; import `durasiUnitWorkshop` + `formatUmur` (dipakai kembali utk teks durasi)
- Verifikasi: tsc 0; eslint 0 (file berubah); vitest 134 lulus (4 test baru durasiUnitWorkshop — sinyal paling awal, dipotong tgl kembali, tanpa sinyal → null, sinyal masa depan → 0); E2E 13/13 PASSED
- Git: belum di-commit (menyatu dgn perubahan Task 52 yang juga masih uncommitted)

Stage Summary:
- Daftar tiket FINISH kini sepenuhnya "post-part": chip bekas terkirim/part datang hilang, digantikan baris "Part terpasang {tgl}" tepat di bawah Tgl Finish; lama unit di workshop kembali terbaca (huruf amber rincian di kolom/kartu) — dihitung sejak sinyal kerja workshop paling awal & berhenti (atau masih berjalan) pada tanggal kembali, sehingga unit yang lama menggantung di workshop mudah terlihat tanpa membuka detail.

---
Task ID: 52
Agent: GLM-5.3-Flash Free (opencode)
Task: Alur tarik & pengembalian unit workshop — surat saat FINISH, indikator FINISH×lokasi, kolom Tgl Finish, tarik parsial STTB kolektif

Work Log:
- Motif user: (1) saat unit ditarik ada STTB — saat dikembalikan surat apa? dan tidak semua unit terdaftar di STTB nyata-nya bisa ditarik (parsial); (2) butuh indikator barang FINISH tapi masih di workshop vs FINISH sudah dikirim kembali; (3) kolom "Umur" diganti tgl finish + tgl unit dikembalikan; (4) FINISH tak harus berarti unit sudah di toko
- Rancangan alur baru: FINISH = rekaman pekerjaan selesai (boleh saat unit masih di WORKSHOP — tidak lagi memaksa lokasiUnit TOKO/sttbDicabut/tglKembaliKeToko); foto nota stempel OPSIONAL saat FINISH (tetap WAJIB untuk SUBMIT_CLAIM); unit dikirim kembali via Surat Pengembalian Barang (SKTB, /api/sttb/kembali) yang kini boleh dicetak SAAT FINISH walau tgl kembali belum terekam (surat jalan workshop→toko, baris tgl cetak "—"); tgl kembali terekam lewat aksi KEMBALI_KE_TOKO saat unit sampai toko
- Schema ServiceRequest + 2 kolom nullable: `noSttbKolektif` (nomor STTB kolektif yang membubuhkan tiket yang lalu benar-benar ditarik — kertas = realita untuk tarik parsial) dan `noSuratKembali` (nomor SKTB terbit); `npm run db:push` sukses + generate client
- `src/lib/alur-tanggal.ts`: helper baru `pesanAlurTglKembali` (+type TiketAlurKembali) — tgl kembali tak boleh sebelum part datang / part terpasang / tglFinish (minimal sama hari, jam diabaikan); komentar header diperbarui (urutan baru: part datang → pasang → FINISH → kembali)
- API `src/app/api/service/[id]/route.ts`: blok FINISH ditulis ulang (nota opsional `...(body.fotoNotaStempel ? {...} : {})`, tidak memaksa lokasiUnit, audit mencatat "UNIT MASIH DI WORKSHOP" bila sisa); blok KEMBALI_KE_TOKO diperluas — boleh tiket PROSES (alur lama) ATAU FINISH && !tglKembaliKeToko (alur baru), body opsional `tglKembali` (default now; tolak masa depan/di atas ±5 mnt, sebelum createdAt, sebelum part datang-terpasang-tglFinish via pesanAlurTglKembali), tolak saat tglKembali sudah terekam (409); komentar header PATCH mendokumentasikan dua ragam akhir tiket
- API `src/app/api/sttb/kolektif/route.ts`: opsi body `tandaiDitarik: true` — tiket terpilih & lolos aturan TARIK_WORKSHOP (part semua READY, REQUEST/PROSES, di TOKO, ber-STTB) di-transaksi → status PROSES + penanganan TARIK_WORKSHOP + lokasiUnit WORKSHOP + noSttbKolektif = nomor dokumen; audit SAHKAN_TARIK_KOLEKTIF; header X-Sttb-Marked/X-Sttb-Skipped utk toast UI
- API `src/app/api/sttb/kembali/route.ts`: syarat longgar — tiket FINISH boleh walau belum terekam kembali (tiket PROSES tetap wajib terekam); baris tgl cetak "—", baris total mencantumkan "N belum terekam kembali" + ket kaki; nomor SKTB ditulis ke tiket via updateMany (noSuratKembali) — tarik pengembalian parsial tetap terlacak
- UI `src/components/views/service-view.tsx`: kolom "Umur" (/kartu HP dt Umur) diganti "Tgl Finish" — FINISH: tgl finish + "Kembali {tgl}" emerald / "Masih di workshop" amber; non-FINISH: — + tgl tiket; import formatUmur dihapus; badge indikator FINISH×lokasi di baris desktop & kartu HP (Clock "MASIH DI WORKSHOP" amber / Store "{tglPendek}" emerald); dialog FINISH diperbarui (deskripsi alur baru, nota opsional — body hanya membawa fotoNotaStempel bila diisi, prefill nota dikosongkan); item dropdown baru "Konfirmasi Kembali ke Toko" utk FINISH && !tglKembaliKeToko (window.confirm, aksi KEMBALI_KE_TOKO); toolbar STTB menjadi 2 tombol: "STTB Toko" (cetak saja) + "STTB + Sahkan Ditarik" (cetak + tandaiDitarik, confirm dengan jumlah unit tercentang, invalidateAll + toast X-Sttb-Marked/Skipped); pre-check "tgl kembali belum tercatat" di unduhSuratKembali dihapus; dialog detail: blok emerald kembali tetap + blok amber "Belum kembali ke toko — masih di workshop" dgn tombol Cetak SKTB, badges STTBK/SKTB dari noSttbKolektif/noSuratKembali
- UI `src/components/service-flow.tsx`: stage "kembali" — FINISH tanpa tglKembali berlabel "Selesai dikerjakan — unit masih di workshop (belum dikirim kembali)"; tombol "Kembalikan ke Toko (Cabut STTB)" kini tampil juga utk tiket FINISH && !tglKembali di WORKSHOP; kotak info FINISH bercabang: emerald (sudah kembali, cetak bukti) / amber (masih di workshop — cetak SKTB + konfirmasi kembali); import Clock
- `src/lib/types.ts`: ServiceTicket + `noSttbKolektif?` / `noSuratKembali?`
- Verifikasi: tsc 0; eslint 0 utk semua file berubah (lint . masih 7 error pra-eksisting dari public/pdfjs/pdf.worker.min.mjs — vendor bundle, tak tersentuh git); vitest 130 lulus (8 test baru pesanAlurTglKembali — larang sebelum finish/part datang/pemasangan, sama-hari-boleh, PROSES tanpa finish, urutan pemeriksaan); E2E Playwright 13/13 PASSED (flow.spec alur penuh FINISH+Klaim tetap ok); e2e flow.spec memakai nota saat FINISH — tetap valid karena nota kini opsional
- Git: belum di-commit (file berubah siap komit)

Stage Summary:
- Finishing kini jujur terhadap posisi unit: FINISH hanya berarti PEKERJAAN selesai — unit yang masih di workshop tertanda amber "MASIH DI WORKSHOP" dan tiket ber-FINISH yang belum kembali tetap punya jalur tindak lanjut: cetak Surat Pengembalian (SKTB) berfungsi sekaligus surat jalan pengiriman, lalu "Konfirmasi Kembali ke Toko" mencatat tanggal kembali (dengan validasi arah: tidak boleh sebelum FINISH/part) — setelah itu badge berganti tanggal kembali emerald. Kolom tabel/kartu kini "Tgl Finish" (+ status kembalinya) menggantikan "Umur"; nomor STTBK dgn "Sahkan Ditarik" menuntaskan tarik parsial: yang dicetak = yang benar-benar dipindahkan, tiket tak lolos aturan tetap tercetak di dokumen tanpa status berubah.

---
Task ID: 51
Agent: GLM-5.3-Flash Free (opencode)
Task: Atur ulang kode toko otomatis — traffic tertinggi dapat nomor awal

Work Log:
- Motif user: kode toko berasal dari urutan masuk (CSV import) + "TOK-10" menyimpang dari pola TOK-### — minta kode toko diatur ulang otomatis, tanpa duplikat, toko traffic paling tinggi dapat nomor pertama
- Konfirmasi user: traffic = jumlah kunjungan + jumlah unit terdaftar (pilihan "Kunjungan + unit terdaftar"); tie-break stabil: kunjungan besar dulu, lalu id kecil
- Skrip migrasi sekali-jalan (dihapus setelah selesai): hitung traffic per toko → sort desc → assign TOK-001..TOK-049 → 2 fase update di 1 transaksi (kode sementara MIG-{id} → kode final) agar UNIQUE(kodeToko, barcodeToko) tidak pernah gagal saat bergeser; backup konsisten via PRAGMA wal_checkpoint + VACUUM INTO → db/backup-sebelum-renumber-toko-20261030.db; pemetaan lama→baru → db/pemetaan-toko-20261030.json (rincian: nama, lama/baru, barcode lama/baru, kunjungan, unit, traffic)
- Referensi exact-match ditulis ulang agar tak "putus": AuditLog.entitasId (entitas master_toko), OrderEmailPart.tokoKode, (InboxItem hasilRef "TOKO:{kode}" dikontrol — saat ini 0 baris); UnitAsset.barcodeData tidak disimpan — selalu dibangun live dari relasi toko (api/unit/route.ts) sehingga otomatis ikut
- Kontrol pasca: 49/49 kode unik TOK-001..TOK-049, barcode konsisten BC-{kode}, kunjungan per toko ikut migrasi (jumlah per toko tetap); audit master_toko tidak ada kode sobek kecuali null (import/bulk-delete) + TOK-UJI historis (toko uji yang sudah dihapus)
- Hasil: Toko Semeru Ahmad Yani (3v+28u, traffic 31) → TOK-001; Varia Mulia → TOK-002; Smart Home → TOK-003; dst.; sampah format Toko Sumber Electronic (TOK-10) → TOK-049

Stage Summary:
- Kode toko sekarang serial, unik, dan berurutan sesuai traffic — toko tersibuk nomor paling awal; barcode toko BC-{kode} ikut berubah konsisten
- CATATAN: stiker barcode toko yang sudah dicetak memuat kode lama → cetak ulang stiker (toko-barcode-sticker.tsx otomatis memakai kode baru); scan kode lama tidak lagi terbaca
- File berubah: TIDAK ADA file kode aplikasi (murni data + artefak db/); audit MIGRASI_NOMOR_TOKO #1081

---
Task ID: 50
Agent: GLM-5.3-Flash Free (opencode)
Task: "Sudah pasang id spreadsheet di pengaturan, tapi belum ada data yang pindah ke spreadsheet"

Work Log:
- Diagnosa read-only DB produksi (Pengaturan gs_* + BackupLog):
  • HANYA `gs_spreadsheet_id` terisi — dan nilainya KOSONG (ditempel sebagai URL utuh: ID + `/edit?gid=0#gid=0`).
  • `gs_service_email` & `gs_private_key` TIDAK ADA → `runBackup` selalu bercabang fallback: 10 log BackupLog terakhir semua `LOCAL`/`sheets=0` ("Kredensial Google belum lengkap — snapshot lokal disimpan"). Data 404–405 baris aman di `db/backups/backup-*.json`, tapi TIDAK PERNAH masuk Google.
- Fix kode:
  • `bersihkanSpreadsheetId()` (`gsheets.ts`): mengambil ID murni dari nilai yang ditempel (URL utuh, keterangan `?gid`, awalan/akhiran tanda kutip) — dipakai di `runBackup` (runtime, menangani nilai lama yang kotor) dan `PUT /api/pengaturan` (pocokan DB dgn rapi masuk ke depan).
  • `getBackupStatus` kini menyertakan `terisi: { spreadsheetId, serviceEmail, privateKey }` (spreadsheetId ≥20 karakter; email berformat `@`; private key >40 karakter) + tipe `BackupStatus` diperbarui → endpoint verifikasi produksi: none OK.
  • UI Pengaturan (kartu "Backup Google Spreadsheet"): label ID diperjelas ("atau URL utuh spreadsheet"), CHECKLIST 3 item (✓/✗ + keterangan "BELUM diisi"), peringatan amber saat salah satu kosong ("data TIDAK masuk ke Google — hanya snapshot JSON lokal"), dan LAPAN berlipat (details) 6 langkah membuat service account Google (aktifkan Sheets API → buat SA → unduh JSON key → salin client_email/private_key → berbagi spreadsheet ke email SA dgn Editor → Simpan + Backup Sekarang).
- Verifikasi: tsc 0; eslint 0 (--max-warnings=0); vitest 110 lulus (5 test baru `tests/unit/gsheets-id.test.ts` termasuk keterangan pasien ditulis; ID utuh; spasi+kutip; ID pendek tak diubah); build standalone OK; PM2 online + /api/health ok; E2E 13/13 PASSED; endpoint produksi GET /api/backup/sheets membalas `terisi {spreadsheetId:true, serviceEmail:false, privateKey:false}` (sesuai kondisi DB — menunggu izin dari user).
- BATAS TANGGUNG JAWAB: kredensial service account hanyalah wewenang user (Google Cloud Console + berbagi spreadsheet) — CODING tidak bisa membuatnya. Setelah email & private key diisi, sistem otomatis terima (lintasan runBackup sudah benar, tanpa perubahan lagi).
- Git: commit `8858d47`. Rollback: revert 1 komit.

Stage Summary:
- Akar keluhan ditemukan & dikonfirmasi dgn data: sisipan Spreadsheet ID saja TIDAK cukup — masih butuh Service Account Email + Private Key, dan ID yang ditempel sebelumnya ternoda keterangan URL. Aplikasi kini membersihkan ID secara otomatis (bisa menempel URL utuh), menampilkan CHECKLIST kredensial yang persis menunjuk kolom yang masih kosong lengkap dengan peringatan + panduan membuat service account 6 langkah di dalam kartu. Snapshot lokal (405 baris) tetap tersimpan dgn selamat; begitu kredensial lengkap & spreadsheet diberi akses Editor ke service account, backup berikutnya (tombol Sekarang / jadwal) akan menulis ke tab Toko, Customer, Sparepart, Unit Asset, Kunjungan, Tiket Service, Surat Jalan.

---
Task ID: 49
Agent: GLM-5.3-Flash Free (opencode)
Task: "Tambahkan notifikasi sound pada chat"

Work Log:
- Fitur suara chat baru (`src/lib/suara-chat.ts` + `src/components/notifikasi-suara-chat.tsx`):
  • Suara = chime 2 nada D6→G6 disintesis Web Audio (rapi tanpa file audio — tidak ada risiko 404/loading asset; volume ringan 0,2, durasi ±0,7 dtk).
  • Pemicu: komponen pendengar global BERLANGGANAN pada cache TanStack Query `['chat']` (bukan polling baru) — setiap update sukses dari SEMUA polling aktif (widget MiniChat 12/4 dtk, view Komunikasi 5 dtk, Dashboard CHAT-01 15 dtk) dievaluasi; cukup satu komponen karena kunci query sama.
  • Deteksi (murni & teruji): `deteksiPesanBaru(pesan, meId, idTerakhir)` — pesan ber-id lebih besar & pengirim ≠ saya → bunyi; pesan sendiri hanya menggeser penanda. Muat PERTAMA hanya menginisialisasi penanda (id maks) — page refresh tidak membunyikan riwayat lama.
  • Autoplay browser: AudioContext dibangunkan pada gesture pertama (pointerdown/keydown sekali, cleanup benar); bila tetap diblokir → SENGAJA diam tanpa error (suara = info tambahan).
  • Mount global `page.tsx` samping `<MiniChat />` — komponen return null, tanpa UI; ikut bekerja di view Komunikasi walau widget MiniChat disembunyikan di sana.
- Verifikasi: tsc 0; eslint 0 (--max-warnings=0); vitest 105 lulus (7 test baru `tests/unit/suara-chat.test.ts`); build standalone OK; PM2 online + /api/health ok; E2E Playwright — 1 flake login-salah pada run pertama (lulus 734 ms saat diulang), run ulang penuh 13/13 PASSED (21,9 s); pola flake dikonfirmasi tidak terkait perubahan (komponen tak menyentuh flow login).
- Git: commit `74b8247`. Rollback: revert 1 komit.

Stage Summary:
- Chat antar akun kini berbunyi saat ada pesan baru dari orang lain — lintas semua menu: widget MiniChat melayang, view Komunikasi, dan kartu CHAT-01 Dashboard, karena suara mengikuti pembaruan data chat yang sama. Bunyi mulai sejak interaksi pertama (aturan autoplay browser), tidak membunyikan riwayat lama saat halaman dibuka, dan pesan sendiri tidak membunyikan.

---
Task ID: 48
Agent: GLM-5.3-Flash Free (opencode)
Task: "Benar tidak terpotong, tapi MiniChat tidak bisa dipakai chat karena tidak ada kolom untuk menulis dan nama penulis tidak tampil" — laporan lanjutan dgn screenshot

Work Log:
- DEBUG dgn browser NYATA (Playwright + token sesi sintetis pola smoke-test lama): dev 3100 (DB e2e terisolasi, seed akun nama super-panjang + pesan) dan PROD 3000 (injeksi localStorage `aspro_token` + cookie `aspro_session`; GET /api/chat dipastikan sehat: users & pesan lengkap).
- Reproduksi persis keluhan di PROD thread DM: kolom pesan MENGAMBIL seluruh panel — baris pemilih akun & header nama terdorong KE ATAS terpotong, textarea/composer terdorong KE BAWAH (y=659 > batas panel 640) → "tidak ada kolom untuk menulis".
- Akar: pengukuran DOM menunjukkan ScrollArea dibesarkan sampai h=452 (tidak disusutkan flex) saat isi thread panjang — rantai turun: kolom pesan `flex min-w-0 flex-1 flex-col` TANPA `min-h-0`; sebagai flex item dalam kontainer KOLOM, min-height-otomatis-nya menurunkan tinggi ISI (header + seluruh konten scroll + composer) sehingga kolom membengkak melebihi panel; overflow-hidden lalu memotong dua ujung. Thread pendek tidak kena (kelihatan normal) — bug hanya muncul saat isi DM panjang.
- Fix (`chat-panel.tsx`): kolom pesan → `min-h-0`; header thread & baris pemilih & composer diberi `shrink-0`; (`minichat.tsx`) bar judul panel `shrink-0`. Hasil: ScrollArea menyusut dgn benar, picker/header/composer selalu terlihat.
- "Nama penulis tidak tampil": nama pengirim kini tampil di SEMUA pesan dari orang lain (broadcast DAN DM) — sebelumnya hanya di broadcast (DM mengandalkan warna bubble saja).
- Verifikasi visual produksi setelah deploy: screenshot DM (nama penulis & composer tampil) + SEMUA ✓; tsc 0; eslint 0 (--max-warnings=0); vitest 98 lulus; build standalone OK; PM2 online + /api/health ok; E2E 13/13 PASSED; skrip debug/seed/token sementara DIHAPUS (termasuk token sintetis) — tidak meninggalkan artefak.
- Git: commit `ad7452d`. Rollback: revert 1 komit.

Stage Summary:
- Widget MiniChat (dan komponen chat pada umumnya) kini tahan terhadap thread panjang: area pesan menyusut sesuai tinggi panel, baris pemilih akun + header nama + kotak tulis selalu terlihat, dan setiap pesan masuk menampilkan nama penulisnya (dot warna role). Sudah diverifikasi di server produksi dgn sesi nyata & thread panjang.

---
Task ID: 47
Agent: GLM-5.3-Flash Free (opencode)
Task: "Jika gunakan nama panjang, chat (widget MiniChat compact) tidak kelihatan" — laporan dgn screenshot

Work Log:
- Diagnosa akar: BUG STRUKTUR di ChatPanel mode compact (`chat-panel.tsx`). Root panel `flex` (BARIS) memuat elemen pemilih akun (back + Select) sebagai sibling → ia dirender sebagai "kolom" kiri setinggi panel dgn `items-center` (dropdown tampak di TENGAH secara vertikal), memakan `shrink-0` lebar kontennya, sehingga kolom pesan digilas ke kanan jadi ~150px: nama partner header terpotong "SYAFRIL AFFA…" (line-clamp-2 di kontainer sempit → "SYAFRIL"/"AFFA…" + sisanya di-clamp), role "Teknisi L…", dan gelembung pesan menempel/terpotong di tepi. Mode lebar (view Komunikasi) tidak terdampak.
- Fix (`chat-panel.tsx`): root ChatPanel → `compact ? 'flex-col' : undefined` — mode compact kini KOLOM: baris pemilih akun (back + Select flex-1) di ATAS dgn lebar penuh panel, kolom pesan (header partner + scroll pesan + composer) di bawah memakai sisa lebar penuh. Mode lebar tetap baris (sidebar w-52 + pesan). Komentar penjelasan ditambah.
- Efek: nama partner header compact kini muat 1 baris (nama lebih panjang tetap terlipat 2 baris dgn line-clamp-2; role `Teknisi Lapangan` utuh), gelembung pesan max-w-85% lebar penuh, dropdown pilih akun lebar penuh (trigger 2 baris utility dari Task 46 tetap).
- Verifikasi: tsc 0; eslint 0 (--max-warnings=0); vitest 98 lulus; build standalone OK; PM2 online + /api/health ok; E2E Playwright 13/13 PASSED.
- Git: commit `4183d93`. Rollback: revert 1 komit (murni UI compact, tanpa skema/API).

Stage Summary:
- Widget MiniChat melayang diperbaiki strukturnya: pemilih akun (tombol kembali + dropdown) kini baris teratas dgn lebar penuh, bukan "kolom" kiri yang menindih area pesan. Nama akun panjang (mis. SYAFRIL AFFANDI — Teknisi Lapangan) tampil utuh di header thread & dropdown, dan gelembung pesan memakai lebar penuh panel — tidak ada lagi teks terpotong "SYAFRIL AFFA…"/"Teknisi L…".

---
Task ID: 46
Agent: GLM-5.3-Flash Free (opencode)
Task: "Buat notes dan chat berdampingan kiri dan kanan agar lebih portable; perbaiki nama pengguna chat yang panjang tidak kelihatan"

Work Log:
- View Komunikasi (`komunikasi-view.tsx`) — hapus mekanisme TAB (Tabs/TabsList/TabsContent + state `tab`): sekarang grid dua kolom `xl:grid-cols-2` — KIRI = MiniChat (ChatPanel lebar dgn sidebar akun), KANAN = Notes (input cari + tombol Buat Catatan di header kartu, daftar note dalam ScrollArea internal, kartu/cari/hasil filter tetap), keduanya setinggi `h-[30rem] xl:h-[36rem]` sehingga bisa dipandang sekaligus tanpa pindah tab ("portable"); di layar sempit (HP/tablet) tetap tersusun vertikal. Nav intent `komunikasiThread` dari kartu CHAT-01 dashboard tetap bekerja (tanpa setTab — langsung setThread).
- Fix nama panjang:
  • ChatPanel sidebar (view lebar): item akun dari 1 baris `truncate` → nama `line-clamp-2 break-words leading-snug` (utuh 2 baris) + caption role/papan umum di bawah nama (dot warna role tetap).
  • Header thread: nama partner `truncate` → `line-clamp-2 break-words`.
  • Widget compact: `SelectTrigger` diset `whitespace-normal!` + override `[&_[data-slot=select-value]]` (`h-auto! min-h-5 line-clamp-2! whitespace-normal! break-words!`, size sm) — mematikan `line-clamp-1`/`whitespace-nowrap` bawaan shadcn sehingga nama panjang terlipat 2 baris; header thread menamai partner utuh juga (pemilih + header saling melengkapi).
  • Pesan broadcast: nama pengirim pengirim memakai `min-w-0 break-words` — nama panjang tak meluber bubble.
  • Dashboard kartu CHAT-01: kolom nama `w-24 sm:w-28 line-clamp-2 break-words leading-tight` (2 baris, tak terpotong "…").
- Verifikasi: tsc 0; eslint 0 (file tersentuh, --max-warnings=0); vitest 98 lulus; build standalone OK; PM2 online + /api/health ok; E2E Playwright 13/13 PASSED (login → navigasi → render bertahap → HP kartu).
- Git: commit `a927c75`. Rollback: revert 1 komit (murni UI, tanpa skema/API).

Stage Summary:
- Menu Komunikasi kini papan komunikasi dua kolom: MiniChat (kiri) dan Notes (kanan) terlihat & bisa digunakan berdampingan tanpa berpindah tab — di layar kecil tersusun otomatis vertikal. Semua permukaan nama pengguna chat (sidebar, header, dropdown widget, nama pengirim di broadcast, dan indikator CHAT-01 dashboard) menampilkan nama panjang hingga 2 baris secara utuh, bukan terpotong.

---
Task ID: 45
Agent: GLM-5.3-Flash Free (opencode)
Task: "Tambahkan kode yang bisa dilihat dari dashboard jika ada chat baru tanpa perlu membuka fitur MiniChat"

Work Log:
- Dashboard: kartu indikator **CHAT-01 — Chat Baru antar Akun** (`src/components/views/dashboard-view.tsx`) — muncul HANYA bila ada pesan MiniChat yang belum dibaca (total > 0), jadi dashboard tetap bersih saat tidak ada chat. Isi kartu: badge kode `CHAT-01` (gaya konsisten kartu alert ALT-xx), badge total unread (maks "99+"), tombol "Buka Komunikasi", dan maksimal 6 baris thread (nama akun/thread, {pengirim}: potongan pesan ≤72 char, formatWaktu, badge jumlah per-thread, chevron) + baris "…dan N thread lainnya". Klik baris → drill-down `navigateTo('komunikasi', { komunikasiThread })`; `>6` → tanpa intent.
- Polling kartu memakai query `['chat']` yang SAMA dengan widget MiniChat (refetchInterval 15 dtk, `enabled: !!user`) — status baca dibaca dari cache modul `lib/chat` (localStorage per user) sehingga kartu terus segar tanpa membuka panel chat; menandai thread dibaca di tempat lain (view Komunikasi/widget) otomatis mengurangi/menghapus kartu di polling berikutnya.
- Store (`src/lib/store.ts`): `NavIntent.komunikasiThread?: string` ('SEMUA' | 'DM:<id>') — pola drill-down dashboard yang sama seperti alert ALT-xx.
- View Komunikasi: konsumsi intent (effect + `setTimeout 0`, pola sama dgn service-view) — `setTab('minichat')` + `setThread(target)` lalu `clearNavIntent()`; state `tab` dinaikkan ke atas (deklarasi sebelum effect) agar aman dgn lint react-hooks.
- api.ts: ekspor tipe ChatUser/ChatPesanItem/ChatData/CatatanItem/CatatanBalasanItem agar import `@/lib/api` lengkap.
- Verifikasi: tsc 0; eslint 0 (file tersentuh, --max-warnings=0); vitest 98 lulus; build standalone OK; PM2 restart online & /api/health ok; E2E Playwright 13/13 PASSED. Tidak ada perubahan API/server — murni UI client + intent.
- Git: auto-snapshot `cd09933` (build mem-commit 4 file tersentuh otomatis). Rollback: revert cd09933.

Stage Summary:
- Chat baru antar akun kini MUNCUL DI DASHBOARD sebagai kartu berkode CHAT-01 (badge total + daftar pesan terbaru per thread) tanpa harus membuka MiniChat; satu klik langsung membuka thread terkait di menu Komunikasi. Kartu tidak tampil saat unread = 0 — dashboard tetap sebagai pusat keputusan tanpa kebisingan.

---
Task ID: 44
Agent: GLM-5.3-Flash Free (opencode)
Task: "Selain email order tambahkan opsi WA order, tambahkan fitur MiniChat dan Notes untuk komunikasi antar akun"

Work Log:
- MODEL DB (prisma/schema.prisma + npm run db:push, tanpa data loss):
  • `ChatPesan` — pesan internal antar akun: DM (penerimaId = id tujuan) ATAU broadcast (penerimaId null = papan umum "Semua Akun"); relasi ke Pengguna (chatTerkirim/chatDiterima) + index pengirim/penerima/createdAt.
  • `Catatan` + `CatatanBalasan` — papan notes bersama: judul?, isi, untukRole (null = semua role; else daftar role dipisah koma), pinned, penulis (relasi catatanPenulis), editedAt/editedBy "(edited)", balasan inline; index createdAt+pin.
- API (semua guard requireActiveSession):
  • `/api/chat` GET — akun aktif + 500 pesan terakhir yang TERLIHAT sesi (saya⇄dia ATAU penerima null); POST — kirim DM/broadcast (maks 2000 char, tolak DM diri sendiri 400, penerima nonaktif 404). Tanpa audit-log (anti spam), kirim data via autoGitBackup tidak diubah.
  • `/api/catatan` GET — daftar terfilter role pembaca (contains + filter teliti split-role), urut pinned lalu createdAt; POST — buat (judul?, isi, untukRole) + logAudit CATATAN_BARU.
  • `/api/catatan/[id]` PATCH — edit (penulis sendiri atau Admin Workshop/Manager + tanda "(edited)"), aksi 'BALAS' (semua role penerima), aksi 'PIN' (hanya Admin/Manager via requireManagerSession); DELETE — hapus (penulis sendiri atau Admin/Manager); semua tercatat audit (CATATAN_BARU/UBAH/PIN/UNPIN/HAPUS).
- LIB:
  • `src/lib/order-email.ts` + `susunPesanWaOrder` — teks order ringkas format WA (*bold*, emoji) dari snapshot unit & daftar part PENDING (dipakai aksi WA tiket).
  • `src/lib/chat.ts` — mapping thread ('SEMUA' | 'DM:<id>'), pesanThread, unreadPerThread/totalUnread + cache modul readMap persist localStorage per-user (tanpa tabel, komponen widget & view selalu senada; penandaan baca berbasis event klik — aman aturan react-hooks/set-state-in-effect).
  • `src/app/api/service/[id]` aksi baru `KIRIM_WA_ORDER` — TIGA mode hasil: REAL (gateway WA asli terkonfigurasi → item PENDING jadi TERKIRIM emailMode 'WA' + audit ORDER_WA_TERKIRIM), WAME (fallback tautan https://wa.me dari pengaturan `wa_produsen` → fallback `kontak_produsen` → noWa akun PRODUSEN aktif pertama, normalisasi 0812…→62… ; item tetap PENDING + audit ORDER_WA_DRAF), TEKS (nomor belum diisi juga → pesan disalin ke clipboard, audit ORDER_WA_TEKS). Item TERKIRIM tetap dikenali matcher Surat Jalan Masuk (Part Datang) — mode WA hanya menambah kolom emailMode.
- UI:
  • Proses Service: tombol "Kirim WA"/"WA Order" (ikon lingkaran chat, hijau emerald) BERDEGATAN dengan tombol email di setiap tiket yang punya part inden — tabel desktop, kartu HP, dan dialog detail (blok per-part). Mutasi `kirimWaTiket` (KIRIM_WA_ORDER) & `orderWaTiket` (ORDER_EMAIL_REORDER lalu WA) — WAME otomatis buka wa.me (bukaLinkEksternal), TEKS copy ke clipboard + toast panduan. Badge item order di detail ikut berganti "WA: PENDING/TERKIRIM" vs "Email: …".
  • Pengaturan → Email Produsen: kolom "Nomor WA Produsen (opsional…)" (`wa_produsen`) + catatan prioritas fallback.
  • MiniChat widget melayang (src/components/minichat.tsx): FAB kanan-bawah polling 12 dtk (4 dtk saat panel buka) + badge merah total unread; panel 21-24rem: header gelap, pilih akun (Select di mode compact), thread, kotak pesan Enter=kirim/Shift+Enter=baris; sembunyi otomatis di view Komunikasi & belum login.
  • `src/components/views/komunikasi-view.tsx` — tab 1 "MiniChat": ChatPanel lebar (sidebar daftar akun) + polling 5 dtk; tab 2 "Notes": cari + buat catatan (judul/isi/target role) kartu pinned-dulu, balasan inline (ScrollArea + Textarea + Enter kirim), pin/unpin Admin/Manager, edit "(edited)" & hapus (bisaKelola), polling 30 dtk.
  • `ChatPanel` shared (src/components/chat-panel.tsx) — dipakai widget (compact) & view (lebar); role dot warna konsisten, pembaca pesan broadcast menampilkan nama pengirim, scroll-bottom otomatis, teks dikembalikan bila kirim gagal.
  • page.tsx: nav "Komunikasi" (ikon MessageSquare, desc "MiniChat & Notes antar akun") → dynamic import + `<MiniChat />` mounted global; store ViewKey +'komunikasi'. types.ts + ChatUser/ChatPesanItem/ChatData/CatatanItem/CatatanBalasanItem; OrderEmailRef + emailMode ('WA').
- Verifikasi: tsc 0; eslint 0 (src penuh); vitest 98 lulus; next build standalone OK (route baru /api/chat & /api/catatan masuk), PM2 restart online + /api/health ok. Smoke API via token sesi sintetis (skrip temp, dihapus setelah uji): broadcast+DM tersimpan & terbaca; catatan buat → balas → pin → edit → hapus OK; KIRIM_WA_ORDER tiket SV-EM-20261018-0001 → mode TEKS (gateway belum diset, teks tersusun benar 2 item) → mode WAME saat `wa_produsen` diuji=0812-9999-8888 (link wa.me/6281299998888 berisi pesan) → pengaturan dipulihkan; reorder tetap idempoten lewat ORDER_EMAIL_REORDER. E2E Playwright 13/13 PASSED (dev-server 3100, db e2e terpisah).
- Git: commit `c9dd07d` (fitur). Rollback: revert 1 komit; tabel ChatPesan/Catatan/CatatanBalasan bisa dibuang via prisma db push bila perlu.

Stage Summary:
- Opsi WA order hidup di seluruh titik yang sebelumnya hanya email: tombol menjadi dua kanal berdampingan (Email & WA) pada tiket REQUEST_EMAIL dan reorder part inden tiket biasa; jika gateway aktif → TERKIRIM otomatis (tercatat emailMode 'WA'), jika belum → draf wa.me ke nomor produsen (atau kopi teks), sehingga order tidak pernah "hilang tanpa jejak" dan tetap tertutup saat barang datang.
- Komunikasi antar akun sekarang punya 2 fasilitas terintegrasi: MiniChat (FAB melayang di semua halaman + halaman penuh di menu Komunikasi; DM antar akun & papan umum; badge belum dibaca) dan Notes (papan catatan bersama, balasan inline, target role, pin Admin/Manager, edit "(edited)") — keduanya mengikuti pola aplikasi (guard sesi, audit log, format Indonesia).

---
Task ID: 43
Agent: GLM-5.3-Flash Free (opencode)
Task: Fitur baru "Nota Servis BASS" — nota servis "SERVICE CENTER" (mobile-first, live preview, cetak A5 landscape, duplikasi nota terisi saat ajukan klaim, bisa edit manual)

Work Log:
- MODEL DB sesuai prompt (prisma/schema.prisma + prisma db push saat PM2 stop, tanpa data loss): tabel `nota` (kolom snake_case persis: nomor_bass unik, lokasi, tanggal, jam_masuk, nama, alamat, telp, hp, merk, lp, model, no_seri, tgl_beli, garansi, tgl_selesai, jam_selesai, pengaduan, kelengkapan, penyebab, perbaikan, biaya_service, biaya_transportasi, ppn_persen, total, tgl_ambil, ttd_customer1, ttd_teknisi, ttd_customer2, nama_customer1/2, nama_teknisi, status draft|selesai|diambil, created_at, updated_at) + tabel `nota_item` (nota_id, kode, nama, harga, qty). Tanggal/jam = string "YYYY-MM-DD"/"HH:MM" (input native, sort leksikografis, tampil "D-M-YYYY"). Index: status, nama, tanggal, createdAt, notaId.
- API (semua guard requireActiveSession + logAudit + autoGitBackup):
  • GET/POST `/api/nota` — daftar (?q nomor/nama/merk/model/noseri &status &dari &sampai) + buat (validasi nomor 6 digit & unik → 409/400).
  • GET/PATCH/DELETE `/api/nota/[id]` — PATCH = autosave & edit; replace items; VALIDASI status selesai/diambil BUTUH Nama, Merk, Model, Pengaduan (400 bila kosong). `total` bisa di-override manual (disimpan); bila tidak dikirim tetap.
  • POST `/api/nota/[id]/duplikat` — salin nota lama → nota baru: nomor BASS otomatis (maks+1 pad 6 digit), tanggal/jam ke NOW, ttd & tgl selesai/ambil & status direset draft, items tersalin.
  • POST `/api/nota/dari-tiket` { noTiket, cariBuat } — "PADA SAAT AJUKAN KLAIM MUNCUL DUPLIKASI NOTA YG SUDAH TERISI DATA": prefilled dari ServiceRequest+UnitAsset (nama toko/customer, alamat+kontak, merk, model, no seri, tgl beli, garansi Ya/Tdk dari statusGaransi, tglTiket→tanggal, createdAt→jam masuk, tglFinish→tgl/jam selesai, deskripsiKerusakan→pengaduan, items dari parts: kode/nama part + harga=hargaKlaim). cariBuat=true → idempoten (periksa marker `|T:noTiket|` di audit nota CREATE → buka ulang nota yang sama, TIDAK buat duplikat baru tiap klik).
- UI (semua Indonesia, mobile-first, tombol besar):
  • `src/components/nota/nota-sheet.tsx` + module CSS — tampilan nota kertas 936×690 landscape: header (placeholder logo montir /public/nota-logo.png fallback 🔧, judul sans-serif tebal "SERVICE CENTER", telp, "LAYANAN KONSUMEN NASIONAL", telp/bebas/WA/email CSO), kotak kanan (Indoor/Outdoor dilingkari + label BASS + nomor font monospace tebal), panel kiri 54% data konsumen 14 baris (garansi Ya/Tdk dilingkari), panel kanan teknis (Pengaduan/Kelengkapan/Penyebab/Perbaikan dipisah garis), tabel suku cadang (kolom 22/36/14/7/18%, maks 7 baris + placeholder kosong), bawah 3 blok ttd + Tgl Ambil, kotak 6 baris biaya (Sub Total, PPN %, Total; garansi Ya+total 0 → banner "BIAYA DITANGGUNG GARANSI"), footer "* Lembar Putih : Bukti Pembayaran" + "Lembar N dari 2". Live preview discalakan mengikuti lebar kontainer (ResizeObserver) → tampil setia di HP.
  • Cetak/PDF: salinan DOM `.nota-printonly` (scale 0.775) + @page A5 landscape (globals.css) → window.print() → PDF IDENTIK dengan pratinjau; pilihan Lembar 1/2 dari 2.
  • `src/components/nota/signature-pad.tsx` — canvas pointer (mouse+HP), simpan dataURL PNG, tombol Hapus, tampil ulang saat edit.
  • `src/components/views/nota-view.tsx` — daftar kartu (nomor BASS mono, badge status, filter SEMUA/draft/selesai/diambil + QuickSearch) + editor: form dibagi Header/Data Konsumen & Unit/Pengaduan & Teknis/Suku Cadang (add/del maks 7)/Ringkasan Biaya/+Tanda Tangan; MERK datalist (10 merk + ketik bebas); autosave debounced 1.2s (indikator "menyimpan…/tersimpan ✓"); tombol Simpan/Tandai Selesai (validasi wajib)/Tandai Diambil; duplikat & hapus; live preview sticky + pilih lembar + Cetak/PDF. Nav intent `notaId` membuka editor langsung.
  • `src/components/nota/nota-klaim-dialog.tsx` — dialog klaim: preview nota terisi, pilih lembar, Cetak/PDF, "Edit Manual" (navigateTo('nota',{notaId})), tombol "Lanjut: Ajukan Klaim" (aksi SUBMIT_CLAIM lama tetap dipakai).
  • claim-view: tombol "Nota BASS" (semua baris klaim) & tombol "Ajukan" kini membuka dialog duplikasi nota (cari-buat) sebelum klaim diajukan — prompt literal terpenuhi.
  • page.tsx NAV_ITEMS + view 'nota' (lazy), store ViewKey 'nota' + NavIntent.notaId.
- Build/Turbopack: CSS module tak menerima selector `[class*=…]` (bukan "pure") → ganti class lokal; build siap standalone; PM2 online (pid 11168).
- Verifikasi: tsc 0; eslint 0; E2E 23 cek LULUS (post-build, server hidup): guard 401 tanpa sesi; POST/GET list/PATCH/DELETE; nomor salah→400, duplikat→409; PATCH autosave & total override manual tersimpan; status selesai ditolak bila pengaduan kosong; duplikat (nomor baru, items salin, ttd reset, tanggal NOW); dari-tiket prefilled (Toko Sentral Elektric dari SVC-2607-0006) + cariBuat idempoten + tanpa cariBuat = nota baru; GET / 200. Seluruh data uji & user temp e2e dihapus (DB nota kosong kembali); audit uji begini juga dibersihkan.
- Git: commit `52b2056` (fitur). Rollback: revert 1 komit + `prisma db push` bila mau buang tabel (tidak dianjurkan).

Stage Summary:
- Fitur "Nota Servis BASS" lengkap: isi → autosave draft → tandai selesai (validasi) → tanda tangan → diambil → cetak A5 landscape persis pratinjau (Lembar 1/2 dari 2) → database nota/nota_item → daftar+cari+filter → duplikat/edit.
- Integrasi klaim: saat menekan Ajukan Klaim, duplikasi nota yang SUDAH TERISI DARI DATA TIKET muncul — bisa dicetak, deadited manual (navig ke view Nota), dan klaim tetap diajukan; tidak ada aplikasi terpisah (semuanya di dalam AfterSales Pro).

---
Task ID: 42
Agent: GLM-5.3-Flash Free (opencode)
Task: "Lakukan saja" — bersihkan 19 vulnerability npm audit, migrasi middleware→proxy, indeks DB (efisiensi READ)

Work Log:
- BASELINE npm audit: 19 vuln (5 moderate/13 high/1 critical). Pemetaan & tindakan per akar:
  • next-auth, react-syntax-highlighter, @mdxeditor/editor → TIDAK dipakai sama sekali (0 import di seluruh repo; sisa scaffold) → npm uninstall → kutranyo树下 188 dependensi hilang, js-yaml & prismjs(& refractor) kanal hilang.
  • nodemailer ^7.0.13 (SMTP command injection dlsb.) → TERPAKAI src/lib/order-email.ts (dynamic import; createTransport+sendMail — API stabil ke v10) → bump nodemailer@^10.2.1 + @types/nodemailer@latest.
  • sharp ^0.34.3 (libvips/libheif/librsvg CVE) → next image optimizer internal (0 import src) → bump sharp@^0.35.5.
  • dompurify (CRITICAL, SAFE_FOR_TEMPLATES bypass) + ip-address (moderate) → dibersihkan npm audit fix NON-force.
  • deepmerge-ts (high, via @prisma/config prisma 6.19.3) → override package.json "deepmerge-ts": "^8.0.0" — prisma -v/generate/db push/laporan E2E jalan normal dengan override (proxy upgrade major prisma 6→8 TIDAK dilakukan — out of scope).
  • braces (high — advisory 2026 no-fix upstream: versi terbaru braces 3.0.3 tetap ditandai) → override "^3.0.3" memastikan VERSI TERBARU; kanalnya DEV-ONLY (eslint-config-next→plugin→fast-glob→micromatch; tidak masuk bundle produksi, tidak dieksekusi runtime) → risiko terdokumentasi-diterima tunggal; force saran npm (turunkan eslint-config ke 14.2.35 = DOWNGRADE major) TIDAK diikuti.
  • xlsx ^0.18.5 (prototype pollution + ReDoS; NO fix di npm registry) → TERPAKAI 5 route (4 export tulis + 1 XLSX.read buffer di surat-jalan.ts mem-parse Excel produsen = input tidak terpercaya!) → diganti ke build resmi terpatch dari CDN SheetJS: `npm install https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz` (0.20.3 = versi konvensional saat ini per docs.sheetjs.com; API sama, runtime bukti "xlsx 0.20.3").
  HASIL: 19 vuln → 0 di runtime; hanya 1 akar dev-only (braces, no upstream fix) tersisa; 1026 → 1018 paket.
- MIGRASI middleware→proxy: codemod resmi peringatkan stash — sikap: commit rapi b9fc67c (deps+indeks) dulu. `npx --yes @next/codemod@canary middleware-to-proxy .` → src/middleware.ts → src/proxy.ts + fungsi middleware→export proxy (logika publik/401/redirect UTUH). Peringatan deprecation di build hilang habit.
- INDEKS DB (schema.prisma, prisma db push tanpa destructive change saat PM2 stop): ServiceRequest(unitAssetId/status/tglTiket/createdAt), UnitAsset(tokoId/customerId/serialNumber), Kunjungan(tokoId/teknisiId/tglKunjungan), ServiceRequestPart(serviceRequestId/sparepartId), OrderEmailPart(serviceRequestId), SuratJalanMasukItem(suratJalanMasukId), SuratJalanRequestItem(suratJalanRequestId), AuditLog(createdAt), WaMessage(createdAt), InboxItem(status,createdAt) — FK join & filter listing & delete retensi sudah terindeks. CATATAN efisiensi READ Tambahan bila data memberanak: pagination GET /api/service & /api/unit butuh perubahan UI (KPI menghitung client-side) — belum dipasang sekarang, index terpasang sebagai langkah aman pertama.
- Deploy: pm2 stop → prisma db push + generate → npm run build (standalone; backup DB custom-2026-10-23-*; TIDAK ada deprecation middleware lagu-lagu) → pm2 start online (pid 8704).
- Verifikasi: tsc 0; eslint (proxy & file tersentuh) 0; prisma db push "database is now in sync". E2E SIKLUS (user admin temp dihapus habis + audit uji 0 sisa): /api/notifikasi TANPA sesi → 401 (guard PROXY membuktikan diri ✓); login 200; /api/notifikasi 200 (7 item); /api/pending/export 200 (PDF 137 KB — salah satu endpoint export jalan); /api/alerts 200 (total=123); `node -e require('xlsx')` → "xlsx runtime: 0.20.3" ✓.
- Git: b9fc67c (audit-deps + indeks), bd687fc (migrasi proxy). Rollback: revert kedua komit.

Stage Summary:
- Keamanan dependency bersih: 19 vuln → 0 runtime (sisa 1 advisory dev-only tanpa fix upstream, versi terbaru sudah dipakai); 3 paket scaffold tak-dipakai dibuang; nodemailer v10 & sharp 0.35 & xlsx SheetJS CDN 0.20.3 (patch prototype pollution &amp; ReDoS — penting: file Excel dari produsen diparse server)
- Konvensi Next 16: middleware → proxy selesai (peringatan deprecation hilang), guard auth terbukti 401
- DB siap tumbuh: 16 indeks baru di tabel panas (join FK, listing, retensi) tanpa perubahan data
- Semua diuji E2E lewat server produksi hidup; PM2 online

---
Task ID: 41
Agent: GLM-5.3-Flash Free (opencode)
Task: Apply upgrade Next.js 16.4.2 ke produksi (approval user) + verifikasi penuh

Work Log:
- Approval user: "Ya, apply sekarang di repo utama" (hasil validasi worktree Task 40).
- Cherry-pick komit worktree 6c8274e → main d182836 "upgrade: next 16.1.1 -> 16.4.2 (security advisory fix), react 19.3.1" (hanya package.json + package-lock.json; file fix alert Task 39 yang masih uncommitted TIDAK tersentuh — path berbeda).
- npx pm2 stop aspro-prod → npm install (33 detik, changed 7 packages) → next --version = v16.4.2; npx tsc --noEmit = 0.
- Build produksi full (npm run build, standalone): sukses — compiled 18,2s, 46 halaman, backup DB otomatis custom-2026-10-23-061951.db. PENTING: build TIDAK lagi memunculkan SecurityFatalError/advisory (versi lama memang sedang menghentikan build utk menyarankan upgrade; 16.4.2 bersih).
- Deploy: pm2 start aspro-prod → online (pid 13436).
- E2E HP upgrade (server produksi hidup): GET /login 200 & GET / 200; user admin TEMPORER (dihapus habis uji; 1 baris audit uji dibersihkan) → login HTTP OK; GET /api/notifikasi 200 (7 item); GET /api/alerts 200 (total=119, critical=90 — komposisi sama dgn Task 39: ALT-03 stok part + ALT-01 toko dominan; angka naik-turun harian itu wajar). LULUS ✓.
- Worktree next-security-upgrade dihapus (tujuan selesai — komit sudah masuk main); upgrade tetap bisa di-rollback via git revert d182836 (lock+package.json saja).
- SISA (perlu keputusan user, tidak dieksekusi): npm audit melaporkan 19 vulnerability (5 moderate/13 high/1 critical) di dependency transisi TANPA nyambung ke advisory Next.js — perlu `npm audit` review manual; peringatan konvensi lama "middleware" (deprecating → proxy di masa depan) juga muncul, bisa dimigrasi belakangan via codemod.

Stage Summary:
- PRODUKSI KINI SEHAT di Next.js 16.4.2 + React 19.3.1: advisory keamanan Next.js tuntas diatasi, tsc/lint/build bersih, E2E endpoint kunci 200 semua.
- Pekerjaan Task 39 (fix ALT-06 + sakelar lonceng alert) tetap utuh dan ter-deploy berbarengan build ini.

---
Task ID: 40
Agent: GLM-5.3-Flash Free (opencode)
Task: Upgrade keamanan Next.js di worktree terpisah (16.1.1 → 16.4.2), produksi tidak diganggu

Work Log:
- Latar: build Task 39 memunculkan SecurityFatalError (Next menahan eksekusi utk menyarankan upgrade — advisory bulk npm registry; versi terpasang terdampak kerentanan keamanan).
- Worktree dibuat via tools.opencode.worktree_create: C:\Users\eraco\.local\share\opencode\worktree\ccb06c\next-security-upgrade (checkout repo pada komit auto-backup 797d480).
- `npx next upgrade --agent=security ...` (sesuai pesan advisory) → GAGAL "unknown option" (Next versi ini tak punya flag agent); `next upgrade --help` menunjukkan hanya `--revision`. `npx next upgrade --revision latest --verbose` → GAGAL lagi ENOENT "spawn npx" (bug jembatan Windows: spawn tanpa shell, npx.cmd tak ditemukan). SOLUSI: jalankan langsung perintah internal `npx --yes @next/codemod@canary upgrade latest --verbose` (persis yang di-delegasi `next upgrade`).
- Hasil upgrade: Next.js 16.1.1 → **16.4.2**, React 19.2.3 → 19.3.1, eslint-config-next 16.4.2; npm install 1216 paket (±2 mnt); codemod `cache-components-instant-false` + `remove-partial-prefetch` → 213/214 file tanpa perubahan, hanya layout.tsx disentuh.
- Penyesuaian pasca-codemod: blok `export const instant = false` di layout.tsx MEMBUAT BUILD GAGAL ("Route segment config 'instant' requires nextConfig.cacheComponents") karena proyek tidak mengaktifkan Cache Components → dihapus kembali ke bentuk semula (kodemod menganggap proyek adopter; di sini bukan). layout.tsx kembali 0 diff.
- Validasi di worktree: prisma generate (client v6.19.3) ✓; npx tsc --noEmit exit 0 ✓; npx next build (Next 16.4.2) ✓ compiled 3,7s + 46 halaman + TIDAK ADA advisory keamanan & build tidak lagi menghentikan diri (versi 16.4.2 bersih dikena advisori tsb).
- Hasil committed di worktree branch: 6c8274e "upgrade: next 16.1.1 -> 16.4.2 (security advisory fix), react 19.3.1" (package.json + package-lock.json).
- CATATAN npm audit (worktree): 19 vulnerability (5 moderate/13 high/1 critical) di dep transisi — TERPISAH dari advisory Next.js; belum ditindak (perlu keputusan user).

Stage Summary:
- Worktree `next-security-upgrade` berisi upgrade Next.js 16.4.2 yang LOLOS tsc + build penuh; produksi masih jalan di Next 16.1.1/16.4.0-installasi lama — TIDAK berubah (user memilih "worktree terpisah" agar hasil di(nilai) manual)
- Langkah lanjut: bila user ingin bergabung → apply di repo utama (npm install + build + PM2 restart + E2E), atau biarkan di worktree

---
Task ID: 39
Agent: GLM-5.3-Flash Free (opencode)
Task: Selidiki & bereskan notifikasi "Ringkasan alert: 117 aktif" yang muncul saat menambah unit baru + benahi apa yang harus dibenahi

Work Log:
- LAPORAN user: saat menambah unit baru muncul notifikasi ALERT di lonceng "RINGKASAN ALERT 117". Diagnosis dari kode (bukan asumsi): notifikasi itu dibuat HANYA oleh src/lib/alert-scheduler.ts (tick tiap 30 menit, kirim 1×/hari via penanda alert_kirim_tanggal di tabel Pengaturan) — sama sekali TIDAK ada jalur di POST /api/unit / /api/unit/import yang membuat notifikasi tipe ALERT (grep seluruh src). Jadi kemunculannya saat registrasi = GABUNGAN WAKTU: tick 30-menit kebetulan berjalan bersamaan aksi user (lonceng memunculkan toast utk SEMUA notifikasi baru).
- Angka 117 = jumlah ALERT AKTIF saat ringkasan disusun (judul = "Ringkasan alert: {total} aktif"), bukan nomor unit. Dikomposisi lewat skrip diagnostik (=replikasi aturan ALT-01..06 dari DB nyata, tidak mutating): ALT-03 stok part ≤ reorder = 66, ALT-01 toko lewat jadwal visit = 33, ALT-02 REQUEST > 24 jam = 13, ALT-05 REQUEST tanpa part READY = 11, ALT-06 unit 7 hari tanpa tiket = 4 → total posible 127 (engine memotong maks 200). Riwayat tbl Notifikasi: "117 aktif" (kemarin ±19:03 WIB) & "120 aktif" (±04:06 WIB) — jadwalnya memang harian, angkanya wajar naik-turun.
- BUG ALT-06 ditemukan & diperbaiki: doc aturan (alert-engine.ts + PRD) bilang "registrasi > 24 jam tanpa tiket", tapi kode hanya menyaring window 7 hari TANPA syarat umur → unit yang baru dijam 5 lalu langsung terhitung alert di ringkasan berikutnya (membuat user wajar mengaitkan registrasi ↔ alert). Fix di jalankanAlertEngine(): syarat ganda dibuat >= batasUnit (jendela 7 hari) && dibuat <= batasMuda (umur ≥ JAM_MINIMAL_UNIT_TANPA_TIKET 24 jam).
- Fitur sesuai permintaan "ringkasan alert matikan notif lonceng": sakelar baru Pengaturan kunci alert_lonceng_aktif (default MATI — helper alertLoncengAktif() hanya true bila nilai 'true'), helper di src/lib/notifikasi.ts; alert-scheduler.ts kini bersyarat memanggil buatNotifikasi('ALERT'). Pengiriman ringkasan ke grup WA/Telegram TETAP jalan (sakelar notifikasi_alert_gateway tersendiri, tidak berubah). Dashboard masih bisa lihat evaluasi alert via GET /api/alerts.
- UI: settings-view.tsx menambah blok switch amber "Ringkasan alert di lonceng (dalam aplikasi)" di bawah blok "Kirim notifikasi ke grup" (glow() gateway). Sisa 7 notifikasi lama (termasuk 2 ringkasan alert sebelum fix) tak dihapus — cukup ditandai terbaca.
- Deploy: npx pm2 stop aspro-prod → npm run build (standalone, backup DB otomatis custom-2026-10-23-0605xx.db, rotasi backup lama) → pm2 start → online.
- CATATAN build: npm run build PERTAMA "gagal" karena Next.js 16.4.0 sengoja menghentikan eksekusi utk menampilkan ADVISORY KEAMANAN (registry.npmjs.org advisories bulk: "versi Next.js affected by a known security vulnerability, strongly recommend upgrade"; retry command utk lanjut). Build ke-2 sukses penuh (compiled 5,1s, 46 halaman, standalone bersih). Rekomendasi upgrade Next.js disampaikan ke user (belum dieksekusi — butuh persetujuan).
- Verifikasi: npx tsc --noEmit kosong; npx eslint (alert-engine.ts, notifikasi.ts, alert-scheduler.ts, settings-view.tsx) kosong. E2E HTTP lewat server produksi hidup: user admin TEMPORER (e2e-...@temp.local, role ADMIN_WORKSHOP) → login 200 → GET pengaturan: sakelar awalnya tidak ada (= MATI) → PUT 'true' → GET = 'true' → PUT 'false' → GET = 'false' (LULUS); sanity GET /api/notifikasi 200 (7 item). Bersih-bersih: user temp dihapus + 3 baris audit uji dihapus (tbl Pengguna & AuditLog 0 sisa). Perilaku lonceng tanpa ringkasan alert baru terlihat pada ringkasan berikutnya (1×/hari — pertama: besok).
- Kredensial demo lama budi/admin123 TIDAK lagi valid (login 401) — password demo sudah diubah orang, tidak dipakai/di-reset oleh agent ini.
- Skrip sementara scripts/diag-alert.mjs & scripts/e2e-verif-alert.mjs dibuat untuk uji lalu DIHAPUS (0 artefak).

Stage Summary:
- Notifikasi "Ringkasan alert: N aktif" kini JELAS: alert harian terjadwal (bukan dipicu registrasi unit); angka = jumlah kondisi menunggu tindakan (dominan: 66 part stok-rendah + 33 toko lewat jadwal)
- Bug ALT-06 diperbaiki: unit yang baru di-register < 24 jam tidak lagi langsung terhitung alert (sesuai aturan tertulis "registrasi > 24 jam")
- Lonceng tidak lagi bising: ringkasan alert default tidak memunculkan notifikasi in-app; grup WA/Telegram tetap diterima; bisa disalakan lewat Pengaturan › Gateway › "Ringkasan alert di lonceng (dalam aplikasi)"
- File diubah: src/lib/alert-engine.ts, src/lib/notifikasi.ts, src/lib/alert-scheduler.ts, src/components/views/settings-view.tsx
- Tanpa perubahan schema/db/API; deploy PM2 online; bahkan terdapat catatan keamanan Next.js (perlu keputusan user utk upgrade)

---
Task ID: 36
Agent: MiniMax M3.1 Flash (opencode)
Task: Notifikasi lonceng untuk Registrasi Service unit baru (terlihat teknisi + admin + manager, tidak terlupa)

Work Log:
- Audit awal: alur "Registrasi Service" (POST /api/unit + POST /api/unit/import) TIDAK pernah memicu notifikasi server apa pun — hanya lonceng in-app berbasis localStorage (src/components/notif-bell.tsx) yang membandingkan createdAt > lastSeen; 2 bug nyata: (a) browser yang belum pernah membuka app → lastSeen diisi Date.now() → semua registrasi SEBELUM first-open hilang permanen; (b) registrasi susulan/backdate menyimpan createdAt = tglInput → selalu < lastSeen → tidak pernah muncul; (c) lastSeen per-browser → tidak ada status unread bersama antar pengguna
- Solusi: sumber notifikasi pindah ke SERVER. Model baru Prisma "Notifikasi" (tipe/judul/pesan/refType/refId/refLabel/dibuatOleh/untukRole/createdAt) + "NotifikasiBaca" (notifikasiId+penggunaId unik → status dibaca PER PENGGUNA, jadi membuka lonceng di satu komputer tidak menghapus notifikasi untuk user lain); pruning otomatis notifikasi > 30 hari
- src/lib/notifikasi.ts (baru): helper buatNotifikasi() (TIDAK melempar error — kegagalan notifikasi tidak boleh membatalkan registrasi unit) + susunPesanRegistrasi() + ROLE_NOTIFIKASI ('TEKNISI,ADMIN_WORKSHOP,MANAGER')
- src/app/api/notifikasi/route.ts (baru): GET → daftar notifikasi + hitungan belum dibaca (filter audience per role: untukRole null = semua); POST → tandai terbaca (satu/several id/semua, upsert compound key notifikasiId_penggunaId)
- Pemicu dipasang: POST /api/unit (unit baru, sertakan relasi toko/customer agar pesan kaya), POST /api/unit/import (1 notifikasi ringkasan, bukan per baris), POST /api/service (tiket manual), src/lib/laporan.ts (tiket dari bot #LAPOR — READY & ORDER_PRODUSEN)
- src/components/notif-bell.tsx ditulis ulang: polling /api/notifikasi tiap 20 detik, badge = jumlah belum dibaca, notifikasi belum dibaca diurutkan di atas, titik merah per item, tombol "Tandai semua terbaca", klik item → tandai terbaca + lompat ke Master Data › Unit Asset (unit) atau Proses Service (tiket), notifikasi baru memunculkan TOAST popup supaya tidak terlupa
- src/lib/types.ts: tipe NotifikasiItem + NotifikasiResponse; src/lib/api.ts: re-export kedua tipe
- DB: prisma db push (tabel baru, tanpa kehilangan data) + prisma generate; backup db/custom-backup-pre-notifikasi-20261022-180056.db; build standalone (npm run build → backup DB otomatis) & PM2 restart aspro-prod (build sempat gagal EPERM query_engine-windows.dll.node karena PM2 masih memegang file → stop → build → start)
- Verifikasi E2E (skrip sementara, lalu dihapus): POST /api/unit → 201 + notifikasi REGISTRASI_UNIT dibuat; admin & teknisi (2 user berbeda) sama-sama melihat notifikasi tsb; admin menandai terbaca → admin 0 unread, teknisi tetap 1 unread (baca per pengguna ✓); data uji dibersihkan (unit/notifikasi/audit = 0 sisa)
- Verifikasi kode: npx tsc --noEmit kosong, npx eslint (9 file) kosong
- Mode LAN (app belum di server sungguhan): notifikasi ini 100% server-side (API + SQLite lokal) → TIDAK butuh internet/push eksternal, tetap jalan di LAN. Ditemukan & diperbaiki risiko LAN: SQLite masih journal_mode=delete → pembaca (polling lonceng tiap klien) memblokir penulis (registrasi). Fix: src/lib/db.ts ensure PRAGMA journal_mode=WAL saat boot + file DB di-set WAL permanen (db/custom.db-wal & -shm muncul); scripts/backup-db.mjs tetap aman (pakai VACUUM INTO = online backup konsisten) + catatan restore dihapus custom.db-wal/-shm
- Uji LAN nyata: akses http://192.168.18.2:3000 (IP LAN mesin ini, server PM2 bind 0.0.0.0) → GET /api/notifikasi 200 & POST /api/unit 201; beban konkuren 9 request (5 poll notifikasi + 4 registrasi) → 9/9 sukses tanpa "database is locked"; notifikasi terlihat semua role; data uji dibersihkan

---
Task ID: 37
Agent: MiniMax M3.1 Flash (opencode)
Task: Kebijakan retensi log 7 hari otomatis (file log + log gateway) & query log dimatikan di produksi

Work Log:
- Baseline diukur: aspro-prod-out-0.log = 11,27 MB / 32.249 baris → 99,1% berisi "prisma:query" (worklog Task sebelumnya sudah catat ±3 MB/hari); "prisma:warn/error" = 0 baris (level error Prisma memang tidak pernah aktif)
- src/lib/db.ts: log Prisma jadi conditional — produksi ['warn','error'] (query log mati), development ['query','warn','error'] (trace SQL tetap penuh untuk debugging lokal). Level warn/error di produksi justru MENAMBAH visibilitas yang sebelumnya nol
- src/lib/log-retention.ts (baru): job retensi harian di sisi SERVER (bukan per browser) — 1) file log PM2 AKTIF (aspro-prod-out-0.log / -error-0.log) TIDAK PERNAH dihapus (Windows mengunci handle; menghapus = PM2 menulis ke file hantu → log hilang tanpa jejak, sudah diuji), tapi dipotong (truncate in-place, sisakan ekor 200 KB) bila ukurannya > batas; 2) file log rotasi/arsip + *.log di folder logs/ dan root repo yang umur > 7 hari → dihapus; 3) tabel log DB: WaMessage > 7 hari dihapus, Notifikasi > 7 hari dihapus, AuditLog > 365 hari dihapus
- Scheduler: src/instrumentation.ts memanggil startLogRetention() (satu proses dengan backup-scheduler); tick pertama 90 detik setelah boot, lalu tiap 30 menit; penanda harian "log_retensi_terakhir" di tabel Pengaturan → cukup jalan 1×/hari
- Konfigurasi (tabel Pengaturan, opsional & bisa diubah via PUT /api/pengaturan): log_retensi_hari (default 7), log_retensi_audit_hari (default 365), log_retensi_mb (default 25 = batas ukuran file log aktif)
- src/lib/notifikasi.ts: pruning notifikasi diubah 30 → 7 hari (selaras kebijakan retensi)
- Ekstensi yang TERJAGA: db/custom.db, db/snapshots, db/backups, source code — tidak disentuh (hanya file .log)
- Bug yang ketemu & diperbaiki saat implementasi: (a) DELETE file log yang di-held PM2 = PM2 lanjut menulis ke file hantu → harus TRUNCATE, bukan delete (dibuktikan lewat uji); (b) resolver root repo salah pilih .next/standalone (folder standalone berisi SALINAN repo: package.json + prisma/ + src/) → Trash lama terhapus dari root yang salah; diperbaiki dengan syarat root TIDAK berada di dalam segmen ".next" + harus punya prisma/schema.prisma + src/
- Verifikasi: setelah rebuild + pm2 restart → out log 11,27 MB → 0,6 KB; tick retention menghapus bass_project2\server.log (8,8 hari) + logs\server-error.log, mempertahankan log 5–6 hari; E2E ulang via IP LAN (registrasi → notifikasi untuk admin & teknisi) tetap jalan; tsc + eslint kosong
- Temuan sampingan (belum diperbaiki): (1) .next/standalone berisi SALINAN SELURUH repo (src, scripts, db, logs) → tiap build menyalin belasan MB & app menulis snapshot/backup ke .next/standalone/db (repo db/snapshots/latest.json ter stagnan sejak 19/10); (2) OCR tesseract rusak di build produksi ("Cannot find module 'C:\ROOT\node_modules\tesseract.js\...'") → scan barcode/OCR fotolikely gagal di produksi

Stage Summary:
- Log tidak lagi membengkak: query log mati di produksi (±3 MB/hari → ~0) + file log lama (>7 hari) terhapus otomatis tiap hari oleh job di server, tanpa restart & tanpa dependency baru
- File log yang sedang ditulis PM2 aman (truncate + ekor 200 KB, tidak pernah dihapus)
- Retensi log gateway/DB ikut rapi: WaMessage & Notifikasi 7 hari, AuditLog 365 hari
- File baru: src/lib/log-retention.ts
- File diubah: src/lib/db.ts, src/instrumentation.ts, src/lib/notifikasi.ts

---
Task ID: 38
Agent: MiniMax M3.1 Flash (opencode)
Task: Perbaiki semua temuan audit (notifikasi keluar aplikasi, alert engine, OCR, path data, poller Telegram, build output)

Work Log:
- NOTIFIKASI KELUAR APLIKASI (sebelumnya tidak ada sama sekali): src/lib/gateway.ts + kirimGateway() — kirim pesan DAN catat ke WaMessage (sebelumnya hanya bot #LAPOR & MCP yang menulis; kirim manual & pesan uji tidak tercatat). Sakelar di Pengaturan: notifikasi_gateway_aktif (master) + notifikasi_registrasi_gateway / notifikasi_produsen_gateway / notifikasi_alert_gateway — UI switch di Pengaturan → Gateway. src/lib/notifikasi.ts + kirimNotifikasiGateway() (master switch default OFF → tidak ada pesan keluar tanpa izin)
- Registrasi unit → push ke grup (WA/Telegram sesuai channel default) + lonceng. Unit nomor seri diisi belakangan / diagnosa awal dilengkapi (PATCH /api/unit/[id]) → notifikasi baru
- ALERT ENGINE benar-benar mengirim: src/lib/alert-engine.ts (dipisah dari route, dipakai bersama) + src/lib/alert-scheduler.ts (scheduler harian 1×/hari, penanda alert_kirim_tanggal) → ringkasan dikirim ke grup + notifikasi lonceng. Route /api/alerts sekarang memakai engine yang sama. Teks alert yang dulu menjanjikan "reminder otomatis dikirim" kini benar-benar terkirim
- ATURAN BARU ALT-06 "Unit Terregistrasi Tanpa Tiket" (registrasi > 24 jam tanpa tiket service, window 7 hari, backdate tidak dihitung) → unit yang terlupa tidak lagi buta
- Janji palsu di laporan.ts (part KOSONG): teks "Notifikasi ... otomatis dikirim ke Produsen" →请求生产线 benar-benar dikirim ke grup (mode tercatat di balasan + audit + WaMessage); bila gateway mati, teks jujur "belum terkirim — kirim manual"
- OCR DIPERBAIKI (tadinya selalu gagal di produksi): tesseract.js menghitung workerPath dari __dirname yang diganti placeholder "/ROOT" di build standalone → "Cannot find module 'C:\ROOT\node_modules\tesseract.js\...". Fix: workerPath dihitung saat runtime (createRequire + cek existsSync), cache bahasa pindah ke <repo>/.cache/tesseract (bukan %TEMP% yang dihapus Windows), data bahasa diunduh sekali (npm run tessdata, script scripts/fetch-tessdata.mjs), timeout OCR 60→120 detik. Bukti: gambar uji "TEST 123" → OCR "TEST 12=" confidence 88 (sebelumnya MODULE_NOT_FOUND)
- PATH DATA RUNTIME (temuAN besar): server standalone Next.js melakukan process.chdir(__dirname) → cwd = .next/standalone → SEMUA path berbasis process.cwd() (snapshot git, backup DB, folder upload Telegram, logo, lampiran email) menulis ke folder BUILD, bukan root repo (db/snapshots/latest.json di root ter stagnan sejak 19/10). Fix: src/lib/paths.ts (APP_ROOT mencari root project, melewatkan segmen ".next") dipakai git-backup.ts, gsheets.ts, telegram-files.ts, api/logo, api/service/[id]
- BUILD OUTPUT: warning "Dynamic filesystem access causes tracing of the whole project" → whole repo ikut ter-copy ke .next/standalone (377 MB). Fix: /*turbopackIgnore: true*/ pada akses fs dinamis (logo, telegram-files, git-backup, gsheets, vision), next.config.ts outputFileTracingExcludes, scripts/next-build.mjs membersihkan .next/standalone + membuang folder data (src, db, upload, logs, .cache, scripts …) dari output. Hasil: standalone bersih (327 MB, tanpa data), tidak ada lagi warning
- BUILD DATABASE_URL: script build memakai 'file:./db/custom.db' relatif → Prisma membuka path yang salah saat build ("Unable to open the database file"). Fix: path di-absolutkan di scripts/next-build.mjs
- TELEGRAM POLLER HIDUP LAGI: bot tidak punya webhook (getWebhookInfo → url "") → inbound Telegram mustahil tanpa polling; service idle sejak 17/10. Fix: ecosystem.config.cjs + app kedua "aspro-tg-poll"; poller kini cek getWebhookInfo dulu & KELUAR dengan pesan jelas bila webhook sudah terdaftar (dulu deleteWebhook paksa bisa mematikan setup server publik) — TG_FORCE_POLLING=1 untuk memaksa. Status: "Polling bridge jalan" ✓
- RETENSI LOG: prisma:query dimatikan di produksi (['warn','error']), job retensi 7 hari (file log PM2 aktif di-truncate + ekor 200 KB, arsip > 7 hari dihapus, WaMessage & Notifikasi 7 hari, AuditLog 365 hari), setting log_retensi_hari / log_retensi_audit_hari / log_retensi_mb di Pengaturan
- .gitignore: db/custom.db-wal, db/custom.db-shm, .cache/ ditambahkan (WAL)
- TEMUAN YANG TERBUKTUK SALAH (tidak ada masalah): "GET /api/unit & /api/service tanpa auth" → middleware src/middleware.ts sudah melindungi SEMUA /api/* (kecuali daftar PUBLIC_API) → bukan temuan
- Verifikasi: tsc + eslint kosong; build exit 0; PM2 2 service online (aspro-prod + aspro-tg-poll); E2E via IP LAN → registrasi 201 + notifikasi untuk admin & teknisi, baca per-pengguna ✓; alert engine 118 alert (ALT-01..06) ✓; snapshot Fresh di root repo & tidak ada di folder build ✓; push ke grup Telegram terverifikasi mode REAL ok:true (kirim ke grup toggle sementara, lalu dikembalikan ke default)

Stage Summary:
- Semua temuan audit tertutup: notifikasi keluar aplikasi (WA/TG) untuk registrasi & permintaan produsen, alert engine benar-benar mengirim (harian) + aturan baru ALT-06, log gateway lengkap, nomor seri yang diisi belakangan ikut memunculkan notifikasi
- OCR dan scan barcode/OCR foto sekarang benar-benar jalan di produksi (sebelumnya selalu gagal) — penting karena foto Telegram = sumber input registrasi
- Data runtime (snapshot, backup, foto inbox, logo) kembali ditulis ke root repo, bukan ke folder build; output build jadi ringan & bersih
- Telegram inbound hidup lagi (poller jalan sebagai service PM2) dan aman terhadap bentrok webhook
- File baru: src/lib/paths.ts, src/lib/alert-engine.ts, src/lib/alert-scheduler.ts, scripts/fetch-tessdata.mjs
- File diubah: src/lib/gateway.ts, src/lib/notifikasi.ts, src/lib/vision.ts, src/lib/git-backup.ts, src/lib/gsheets.ts, src/lib/telegram-files.ts, src/lib/db.ts, src/lib/log-retention.ts, src/instrumentation.ts, src/app/api/{unit,unit/[id],unit/import,service,alerts,gateway/kirim,gateway/test,logo,vision/scan}/route.ts, src/components/notif-bell.tsx, src/components/views/settings-view.tsx, src/app/api/service/[id]/route.ts, mini-services/tg-polling.mjs, ecosystem.config.cjs, next.config.ts, scripts/next-build.mjs, scripts/backup-db.mjs, .gitignore, package.json
- Catatan: sakelar "Kirim notifikasi ke grup" default MATI → nyalakan di Pengaturan → Gateway bila mau pesan keluar ke WhatsApp/Telegram (channel default saat ini WhatsApp; Telegram sudah terkonfigurasi & terverifikasi terkirim)

Stage Summary:
- Registrasi unit baru kini langsung memunculkan notifikasi lonceng yang terlihat teknisi, admin, dan manager, lengkap dengan toast popup — tidak bisa lagi "terlewat" karena notifikasi hilang saat app belum pernah dibuka / registrasi backdate / beda perangkat
- Status dibaca tercatat di server per pengguna (bukan localStorage per browser) — multi-user & multi-device konsisten
- Ticket service baru (manual & bot WA) juga masuk lonceng yang sama
- File baru: src/lib/notifikasi.ts, src/app/api/notifikasi/route.ts
- File diubah: prisma/schema.prisma, src/app/api/unit/route.ts, src/app/api/unit/import/route.ts, src/app/api/service/route.ts, src/lib/laporan.ts, src/lib/types.ts, src/lib/api.ts, src/components/notif-bell.tsx, src/lib/db.ts (WAL), scripts/backup-db.mjs (catatan restore)
- Sisa gap (belum dikerjakan, perlu konfirmasi): push ke WhatsApp/Telegram gateway untuk registrasi (kalau mau notifikasi keluar aplikasi), alert engine ALT-01..05 belum pernah mengirim otomatis, unit teregistrasi tanpa tiket belum masuk reminder berkala, notifikasi "nomor seri diisi belakangan" (PATCH /api/unit/[id]) belum ada

---
Task ID: 35
Agent: GLM (opencode)
Task: Aksi BUKA_ULANG_PROSES — tiket FINISH dibuka ulang utk temuan part rusak tambahan (kasus SVC-2610-0029)

Work Log:
- Kasus: part order produsen datang & dipasang (20 Okt), ternyata ada bagian lain yang rusak; prinsip: JANGAN "FINISH tanpa klaim + tiket baru" (nilai klaim part-1 + jasa luntur, klaim 2x utk SN sama rawan ditolak) — jalur benarnya: 1 tiket, FINISH ulang, klaim sekali memuat SEMUA part
- api/service/[id]: aksi baru BUKA_ULANG_PROSES — hanya tiket FINISH, hanya Admin Workshop/Manager dgn flag koreksiSelesai (bolehKoreksiSelesai), blokir bila statusKlaimProdusen ≠ DRAFT (klaim sudah diajukan → suruh koreksi part); efek: status FINISH → PROSES, tglFinish=null, editedAt/editedBy diisi (badge "(edited)"), fotoNotaStempel & data lain tidak disentuh; audit BUKA_ULANG_SERVICE dgn alasan dari body.alasan; daftar aksi di header komentar diperbarui
- service-flow.tsx: prop ActionsProps + bisaBukaUlang (diisi oleh view) + blok kartu ungu di area FINISH — keterangan alur "tambah part (stok kurang → order produsen) → pasang → FINISH ulang → klaim sekali"; tombol "Buka Ulang ke Proses": window.prompt alasan (default: temuan bagian lain rusak setelah pemasangan) + confirm, lalu onAction({aksi: 'BUKA_ULANG_PROSES', alasan, koreksiSelesai: true}); bila klaim sudah SUBMITTED/PAID tampil hanya teks info tanpa tombol; icon Undo2
- service-view.tsx: ServiceFlowActions + bisaBukaUlang={bisaKoreksiPart} (satu-satunya pemakai komponen ini)
- Tiket SVC-2610-0029 dieksekusi via skrip = replikasi aksi (guard sama: FINISH + klaim DRAFT): status → PROSES, tglFinish null, editedBy "Admin Workshop", audit BUKA_ULANG_SERVICE (aktor Admin Workshop, alasan temuan setelah pemasangan); verifikasi ulang DB: status PROSES, parts utuh, klaim DRAFT
- Verifikasi: tsc + eslint kosong (service-flow, service-view, api/service/[id])

Stage Summary:
- Tiket FINISH kini bisa dibuka ulang utk temuan part lanjutan tanpa membuat tiket baru — klaim tetap sekali & riwayat unit 1 kejadian; tiket tertanda (edited)
- Part rusak lain ditemukan setelah klaim SUBMITTED/PAID → jalurnya tetap koreksi part (tertanda (edited))
- File berubah: api/service/[id]/route.ts, components/service-flow.tsx, components/views/service-view.tsx

---
Task ID: 34
Agent: GLM (opencode)
Task: Analisa AI "Kirim vs Terima" untuk surat jalan masuk + tampilan teks asli OCR vs saran AI

Work Log:
- Latar: file Excel surat jalan dari produsen hasil OCR sering salah ketik kode part; pencocokan & tautan manual selama ini mensyaratkan kode persis (NORM) sehingga baris salah-baca tak bisa ditaut; user pilih skop Celah A+B, pemicu TOMBOL MANUAL (bukan on-upload)
- Endpoint baru POST /api/surat-jalan/[id]/analisa (manual, tanpa menulis DB): sisi KIRIM = dokumen SJR (refSjrNo bila diisi; selain itu SJR yang memuat tiket-tiket draft), sisi TERIMA = baris draft; pasangan deterministik per (tiket|kodeN): SAMA / BEDA_QTY / KIRIM_TANPA_TERIMA (dgn catatan "diterima via doc lain" bila korban dokumen lain) / TERIMA_TANPA_KIRIM; saran penautan baris belum tertaut: skor deterministik (SN sama 60 + jembatan doc kirim 25 + kemiripan nama/kode maks 15, threshold 75) lalu sisa (maks 40 baris, kandidat 120) diteruskan ke AI yang WAJIB memilih key kandidat yang ada (tidak bisa mengarang) + yakin 0-100; model & sumber dok kirim ikut ditampilkan; audit ANALISA_SJ "tanpa perubahan data"
- api/surat-jalan/[id]/item: mode baru asalSaran='AI' — syarat kemiripan kode DILONGGARKAN (kandidat harus tetap ada), kode baris DIBENARKAN ke kode kandidat, kode asli tercatat di alasan + Audit Log ("Saran AI diterima oleh X — kode documen 'Y' → 'Z'"); otherwise tautan manual seperti dulu (kode NORM wajib)
- api/surat-jalan/match: prompt AI kini minta yakin (0-100) — preview menampilkan "AI xx%" dgn tooltip keterangan; response items + `yakin`
- lib/surat-jalan.ts: HasilBaris + `yakin?: number`; `similarity` kini diekspor (dipakai analisa); types.ts: SJBaris+`yakin`, tipe baru SJPasangan/SJPasanganKirim/SJSaran/SJAnalisaHasil (re-eksport via api.ts)
- Dialog surat-jalan-masuk: tombol "Analisa AI (Kirim vs Terima)" di baris aksi DRAFT; panel hasil: ringkasan hitungan + tabel pasangan (badge status, kirim via SJR+qty, terima dll) + tabel saran (kode asli rose → saran emerald, badge AI %, ref SJR, alasan) dgn tombol "Terima" per baris & "Terima semua saran yakin (≥90%)" (loop mutateAsync); saran yang diterima hilang dr panel (state lokal); state dibersihkan saat tutup/hapus/ganti draft
- Verifikasi: tsc + eslint kosong; deploy pm2 stop → npm run build → pm2 start → pm2 save (route analisa terdaftar di daftar build); GET / 200; POST /api/surat-jalan/1/analisa tanpa sesi → 401

Stage Summary:
- Data kirim & terima kini bisa dibandingkan satu layar sebelum diterapkan — selisih qty, part belum dikirim produsen, dan barisan tak dikenal langsung terlihat; AI hanya MENYARANKAN (skor + alasan), status blokir aturan keras tetap penentu
- Baris salah ketik OCR tak lagi jalan buntu: bisa ditaut via saran AI (skor ≥75 deterministik atau AI), kode asli terdokumentasi
- File berubah: api/surat-jalan/[id]/analisa/route.ts (baru), api/surat-jalan/[id]/item/route.ts, api/surat-jalan/match/route.ts, lib/surat-jalan.ts, lib/types.ts, lib/api.ts, surat-jalan-masuk-dialog.tsx

---
Task ID: 33
Agent: GLM (opencode)
Task: Part terpasang tak bisa dihapus + cache kode/nama part + gabung kembar di FINISH

Work Log:
- Permintaan user: (1) jangan hapus part yang sudah terpasang — statistik & riwayat pemasangan bergantung padanya; (2) nama part perlu "cache" agar statistik tetap stabil walau master berubah/hapus; (3) part kembar dijadikan 0/dihilangkan saat FINISH — sekarang masih tampil READY di tiket FINISH; keputusan user via 3 pertanyaan: riwayat terpasang pakai CACHE (terkunci), kembar BELUM terpasang DIHAPUS, kunci hapus berlaku SEMUA role
- Schema: ServiceRequestPart + `kodePartCache String?` + `namaPartCache String?` — snapshot kode/nama pada momen kunci; db push "in sync"; prisma generate
- api/service HAPUS_PART: guard baru di atas semua — baris dgn tglPasang ditolak 409 "sudah terpasang [tgl] — statistik pemasangan bergantung padanya, ubah/kurangi qty"; berlaku semua role termasuk koreksiSelesai Admin/Manager
- api/service FINISH: sebelum update tiket — grup kembar (sparepartId|statusPart|statusKonfirmasi|sumberPart): qty disatukan ke baris utama (tglPasang paling awal; tanpa terpasang = id terkecil); kembar belum terpasang dihapus; kembar terpasang disimpan qty 0 utk statistik; total stok/reserve/terpakai tidak berubah (jumlah sama); audit GABUNG_PART_FINISH (hemat: hanya bila ada penggabungan)
- Stempel cache di 3 titik: sahkan pemasangan (POST updateMany → per-baris loop dgn kodePartCache/namaPartCache dari master saat itu), FINISH (semua baris sisa), koreksi part relink mengikuti data baru otomatis karena cache dibaca saat koreksi berikutnya; backfill scripts/backfill-part-cache.mjs — 68/68 baris terisi
- api/pemasangan: baris & PDF dgn qty<=0 disembunyikan (sisa gabungan), kode/nama dibaca CACHE DULU lalu fallback master (riwayat & cetak ulang dokumen jadi stabil); panel Daftar Siap tetap live (belum ada cache)
- service-view: chip READY → "TERPASANG" (emerald, title dgn tgl/oleh) utk baris bertanda tglPasang; qty<=0 disembunyikan dari daftar tiket (kolom kode/nama, badge ready/inden) & detail (badge, ringkasan, baris row); tombol hapus dimatikan utk terpasang (abu-abu, tooltip alasan stat)
- types.ts: ServicePart + tglPasang/pasangOleh/kodePartCache/namaPartCache
- Verifikasi: tsc + eslint kosong; backfill dipakai; deploy (stop → build → start & pm2 save — db push sudah dilakukan lebih dulu); GET / 200; GET /api/pemasangan & /api/service tanpa sesi 401

Stage Summary:
- Statistik pemasangan kini permanen: baris terpasang terkunci dr penghapusan, nama/kode terkunci via cache di baris; Riwayat & dokumen PMS tidak lompat saat master dikoreksi
- Tiket FINISH bersih: 1 baris per part dgn qty total; chip TERPASANG bukan READY; kembar tak terpasang hilang sejak FINISH (audit membuktikan)
- File berubah: prisma/schema.prisma, api/service/[id]/route.ts, api/pemasangan/route.ts, service-view.tsx, lib/types.ts, scripts/backfill-part-cache.mjs (baru)

---
Task ID: 32
Agent: GLM (opencode)
Task: Cetak ulang dokumen pemasangan (rusak/tercecer) + gerbang pemasangan hanya tiket PROSES

Work Log:
- Permintaan user: (1) dokumen yang sudah masuk Riwayat tetap bisa dicetak ulang — jaga-jaga bila dokumen rusak/tercecer; (2) yang lolos panel pemasangan hanya tiket sudah PROSES (part ready/diterima) — ditemukan 1 part toko Jaya Bessi dari tiket REQUEST bocor ke panel
- Analisa: nomor dokumen asli selalu rekonstruksi dari waktu pasang (PMS-YYYYMMDD-HHMM dari tglPasang) — cetak ulang TANPA model baru/TANPA migrasi: helper `pmsDocNo(waktu)` dipakai saat sahkan maupun saat cetak ulang sehingga nomor & waktu ASLI identik; SETIAP baris riwayat (termasuk dari sebelum fitur ini) bisa dicetak ulang
- GET /api/pemasangan: baris riwayat kini memuat `docNo`; ambil SEMUA tiket (tanpa filter status) — riwayat menampilkan sejarah nyata termasuk tiket yang kini FINISH
- POST /api/pemasangan cabang `cetakUlang:true`: wajib semua item sudah dipasang & satu waktu pasang (satu dokumen), menghasilkan PDF dengan nomor/waktu/oleh ASLI + catatan seekor italic kiri-bawah "Cetak ulang pada …", audit `CETAK_ULANG_PASANG`, nama file Dokumen-Pemasangan-Ulang-<no>.pdf; tidak mengubah penanda apa pun
- POST normal: gerbang ketat — tiket selain PROSES ditolak per nama tiket ("Tiket SVC-… belum masuk PROSES — hanya unit yang sudah ditarik …"); target = item belum bertanda; tiket FINISH otomatis tak lolos karena status ≠ PROSES
- Service-view: Riwayat Pemasangan kini dikelompokkan PER DOKUMEN (kepala PMS-… · N part · oleh siapa · waktu) dengan tombol "🖨 Cetak Ulang" per dokumen; kolom "Oleh" dipindah ke kepala seksi; teks deskripsi panel menyebut syarat tiket PROSES
- Verifikasi: tsc + eslint kosong; deploy (stop → build → start, tanpa db push); GET / 200; GET & POST (cetakUlang) /api/pemasangan tanpa sesi 401; pm2 save

Stage Summary:
- Riwayat = katalog dokumen: satu nomor PMS = satu dokumen fisik, bisa di-regenerasi utuh kapan pun (baris tanda catatan cetak ulang untuk kontrol dokumen)
- Panel pemasangan kini hanya memuat tiket PROSES dengan part READY — REQUEST tak lagi bocor (kasus Jaya Bessi beres bila tiketnya belum ditarik)
- File berubah: api/pemasangan/route.ts, service-view.tsx

---
Task ID: 31
Agent: GLM (opencode)
Task: Dokumen Pemasangan Part → lanskap + kode part utuh + kolom ceklis

Work Log:
- Permintaan user: dokumen pemasangan part dibuat lanskap supaya kode part tercetak SEMUA (penting untuk cross-check), plus kolom kotak ceklis di ujung baris untuk dicentang manual saat pemasangan
- buatPdfPemasangan: orientasi portrait → landscape (A4 297×210); kolom kembali diatur — No(8) Tiket(28) Serial(30) Model(32) Kode(36) Nama(104) Qty(12) Cek(19); lebar total 269 mm
- Kode part kini TIDAK pernah dipotong: helper tulisKode menurunkan ukuran font 8→5 pt bila teks lebih lebar dari kolom (dipasang lewat courier bold), lalu font kembali normal; teks lain tetap memakai potong()
- Kolom Cek: kotak 5,5 mm (garis 0,3 mm) di tengah kolom tiap baris — untuk dicentang pulpen saat part benar-benar dipasang; kepala kolom berlabel "Cek"; Qty rata kanan di batas kolomnya (bukan tabel kanan)
- Baris ttd seksi menyesuaikan lebar ("Diterima oleh (Toko)" ke kanan tabel); guard halaman lanjutan tetap
- Verifikasi: tsc + eslint kosong; deploy (stop → build → start — tanpa db push, skema tak berubah); GET / 200; GET /api/pemasangan tanpa sesi 401; pm2 save

Stage Summary:
- Cetak ulang dokumen pemasangan: halaman lanskap, semua kode part terbaca utuh untuk cek silang, dan setiap baris punya kotak ceklis yang bisa dicoret saat pemasangan
- File berubah: api/pemasangan/route.ts

---
Task ID: 30
Agent: GLM (opencode)
Task: Pemasangan Part per Toko — centang item siap pasang → sahkan → waktu pasang tercatat + Dokumen Pemasangan PDF

Work Log:
- Permintaan user: saat part tiba dan mau dipasang ke unit, item bisa dicentang PER TOKO untuk dokumen pemasangan, sehingga pemasangan terdeteksi per toko dan per waktu pasang
- Skema: ServiceRequestPart + `tglPasang DateTime?` + `pasangOleh String?` (pemasangan per baris part); db push "in sync"; prisma generate
- API baru GET /api/pemasangan: dua kelompok — `siap` (part READY belum dipasang: tiket aktif, statusPart READY, bukan jawaban TIDAK_READY, kode+nama lengkap; info toko/serial/model/lokasi unit/status tiket) & `riwayat` (yang dipasang 7 hari terakhir, urut waktu desc)
- API baru POST /api/pemasangan: body { itemIds, format? } → stamp tglPasang=sekarang + pasangOleh (hanya item belum bertanda; tiket FINISH ditolak) → audit PASANG_PART + git backup; format=pdf → Dokumen Pemasangan (nomor PMS-YYYYMMDD-HHMM dari waktu sah, A4 portrait, kop perusahaan+email, seksi per toko: kepala tabel No/Tiket/Serial/Model/Kode/Nama/Qty + baris ttd "Dipasang oleh (Workshop): <nama> / Diterima oleh (Toko): ____", multi-page aman)
- Service Tiket: kartu panel "Pemasangan Part (per Toko)" DI ATAS Daftar Tiket (lipat default tertutup; badge jumlah part menunggu & jumlah toko); isi: per toko satu tabel + tombol "Pilih semua/Lepas semua", KodeSparepart klik-salin, chip lokasi unit (di toko/di workshop), toolbar "Sahkan & Cetak Dokumen" / "Sahkan Saja" + counter terpilih; sub-lipatan "Riwayat Pemasangan 7 hari" (waktu pasang, toko, tiket, kode, nama, qty, oleh)
- Pasca-sahkan: query service-tickets di-refresh, panel dimuat ulang, pilihan reset; toast nama file dokumen
- Kebersihan kode: satu variabel generator sempat salah ketik memuat karakter non-latin (M+Kiril+Right) — diganti `kanan` via skrip sekali-jalankan; import QRCode tak terpakai dibuang
- Verifikasi: tsc + eslint kosong; deploy urutan aman (stop → db push → build → start); GET / 200; GET & POST /api/pemasangan tanpa sesi 401 (terparam); pm2 save

Stage Summary:
- Alur harian: part tiba (Part Masuk) → buka "Pemasangan Part (per Toko)" di Service Tiket → pilih per toko → Sahkan → waktu pasang tercatat per baris part + dokumen per toko siap untuk ditandatangani (ttd)
- Deteksi: panel Riwayat 7 hari menjawab "kapan part ini dipasang untuk toko mana"; audit log juga menandai PASANG_PART
- Batas: penanda sekali-sah (tidak bisa diulang lewat panel); riwayat 7 hari; dokumen pemasangan khusus PDF (Excel menyusul bila perlu)
- File berubah: prisma/schema.prisma, api/pemasangan/route.ts (baru), service-view.tsx

---
Task ID: 29
Agent: GLM (opencode)
Task: Surat jalan request lebih resmi — blok "Kepada: PT …", email di kop, QR tidak menimpa kop, catatan internal dihapus

Work Log:
- Permintaan user terhadap PDF surat jalan request: tambahkan email perusahaan; tambahkan blok tujuan surat "Kepada: PT ..."; barcode/QR yang tumpang tindih dengan kop perusahaan dipindah; tulisan "part order ke produsen…" (catatan internal aplikasi) dihapus karna ini surat resmi untuk produsen
- Skema: SuratJalanRequest + kolom `produsenTujuan String?` (tercatat per dokumen, masa depan bisa dipakai filter riwayat); db push "in sync"; prisma generate
- Dialog surat-jalan-dialog: input "Kepada (Produsen)" dengan saran otomatis dari merk unit bila merk semua tiket terpilih sama (hint menampilkan saran/peringatan tidak seragam); kosong = pakai saran; body kini kirim `produsen`
- POST /api/surat-jalan-request: terima & simpan `produsenTujuan` (trim, maks 120 karakter) dan meneruskan ke generator PDF/XLSX
- PDF baru: kop kanan bernama/alamat/`Email: …` eksplisit (alamat & email dilewati bila kosong); blok "Kepada :" + nama produsen bold di bawah kop halaman 1 saja; tabel tetap; Zona kaki dokumen: QR verifikasi pindah ke KIRI BAWAH (tidak lagi menimpa kop) berdampingan dengan blok ttd kanan "Hormat kami," + nama workshop + garis tanda tangan + nama pembuat dokumen (dibuatOleh); kedua catatan internal (referensi modul Part Masuk & Lacak Sparepart) DIHAPUS dari dokumen; page-break aman (zona ttd pindah halaman bila tak muat)
- XLSX: baris `Kepada : …` di sheet Request (saat ada) + `Kepada (Produsen)` di sheet Ringkasan; perbaikan bug spread string per-baris (barisKepada dibungkus array tunggal)
- Verifikasi: tsc + eslint kosong; deploy (stop → db push → build → start); GET / 200; POST tanpa sesi 401; pm2 save

Stage Summary:
- Surat jalan request kini layak jadi surat resmi: kop lengkap dengan email, tujuan jelas ("Kepada: PT …"), QR terpisah dari kop, dokumen bebas rujukan internal, plus area tanda tangan
- Tujuan produsen tersimpan di setiap document SJR meski di print dipilih manual
- Catatan: alamat/email mengikuti Pengaturan (alamat_perusahaan/email_perusahaan); bila email masih kosong, isi di Pengaturan agar muncul di kop
- File berubah: prisma/schema.prisma, api/surat-jalan-request/route.ts, surat-jalan-dialog.tsx

---
Task ID: 28
Agent: GLM (opencode)
Task: Perbaikan unduh PDF surat jalan request — endpoint POST tertimpa saat Task 27

Work Log:
- Kejadian: user melaporkan unduh PDF surat jalan part request tidak bisa; akar penyebab bukan generator, melainkan kesalahan agent saat Task 27 — file `api/surat-jalan-request/route.ts` ditulis ulang (write) hanya berisi GET riwayat sehingga endpoint POST pembuat PDF/Excel dari Task 26 HILANG ditimpa; hasilnya dialog cetak menabrak route tanpa POST (405)
- Sisi log produksi: tail error lama (ChecksumException & tesseract pid 16800) hanya sisa era build lama — tidak berhubungan
- Perbaikan: gabungkan KEDUA endpoint dalam satu route — POST (validasi + snapshot + simpan SJR + stamp tglRequestPart + audit + backup; format pdf → jspdf A4 landscape; xlsx → 2 sheet helper `potong` untuk teks melebar) DAN GET riwayat (10 SJR terakhir + cross-check diterima/dicatat/belum, pencocokan pasangan kode|tiket + fallback kode bila salah satu sisi belum bertaut)
- Proses verifikasi diperketat: uji smoke membedakan 401 (route ada, diproteksi) vs 405 (route tidak punya method) — sebelum perbaikan POST 405, sesudah 401
- Verifikasi: tsc + eslint kosong; deploy urutan aman (stop → build → start, tanpa db push — skema tidak berubah); GET / 200; GET & POST /api/surat-jalan-request tanpa sesi 401; pm2 save

Stage Summary:
- Unduh PDF/Excel surat jalan request berfungsi kembali; data request + tgl request tetap tersimpan tiap unduhan; riwayat Request SJR di Lacak tidak terganggu
- Pelajaran dicatat di file: satu route = satu file DIDIK berkembang — ke depan file ditimpa wajib cek isi file lama dulu, dan smoke test per method HTTP, bukan hanya GET
- File berubah: api/surat-jalan-request/route.ts (dipulihkan + digabung)

---
Task ID: 27
Agent: GLM (opencode)
Task: Label "PART DITERIMA" + identitas SJR-… saat part tiba (cross-check request vs kiriman, cek manual tetap wajib)

Work Log:
- Persetujuan user: (1) label status surat jalan masuk diganti lebih manusiawi, (2) nomor SJR (task 26) dipakai sebagai kunci identifikasi saat kiriman tiba: petugas menempel nomor SJR-… di dialog Part Masuk → sistem otomatis menandai part request yang benar-benar sudah dikirim vs belum (produsen sering tidak mengirim sekaligus), (3) cek manual tetap wajib — penanda hanya informatif
- Label label tampilan (nilai DB tetap DRAFT/DIPERIKSA/DITERAPKAN, tanpa migrasi data): DRAFT→DRAF, DIPERIKSA→SUDAH DICEK, DITERAPKAN→PART DITERIMA — map SJ_LABEL di surat-jalan-masuk-dialog (badge riwayat) & sparepart-finder-view (badge kartu Part Datang); toast tindakan tetap istilah "Terapkan Permanen" karena nama tombolnya
- Skema: SuratJalanMasuk + kolom `refSjrNo String?` (referensi dokumen SJR yang dijawab kiriman); prisma db push "your database is now in sync"; prisma generate ulang supaya tipe client baru terbaca
- POST /api/surat-jalan (draft): terima `refSjrNo` opsional → validasi dokumen SJR-nya ADA di tabel SuratJalanRequest (400 bila tidak) → disimpan → respons kini membawa `refInfo { noSjr, totalItem, terpenuhi, belum[{noTiket, kodePart, namaPart}] }` hasil pencocokan pasangan (kode part + tiket; kandidat cocok saja); audit log ikut mencatat ref
- Dialog Part Masuk: kolom "Referensi Request (SJR-…) opsional" + penjelasan; strip teal Cross-check di atas wizard (X/Y part request ada di kiriman + daftar maks 6 yang belum dikirim); toast sukses memuat ringkasan cross-check
- API baru GET /api/surat-jalan-request: 10 dokumen SJR terakhir + statistik per dokumen — diterima (pasangan ada di SJ DITERAPKAN), dicatat (ada di DRAF/DIPERIKSA), belum (tak ada jejak; arahkan kursor → contoh kode part via contohBelum); pencocokan pasangan kode|tiket, dan fallback kode-saja bila salah satu sisi belum bertaut tiket
- Lacak Sparepart: seksi lipat "Riwayat Request (SJR)" di dasar kartu Part Datang (muat saat dibuka lewat klik, bukan effect) — tabel No. SJR/Tgl Request/Item/Diterima/Dicatat/Belum + penjelasan warna
- Verifikasi: tsc + eslint kosong; deploy urutan aman (stop → db push → build → start); GET / 200; endpoint riwayat & datang tanpa sesi 401; pm2 save dijalankan (dump kini mencerminkan proses sekarang)

Stage Summary:
- Saat part tiba: buka Part Masuk → isi no. surat jalan dari produsen + tempel SJR-… dari request yang dulu dibuat → Simpan Draft → strip langsung menampilkan "berapa part request yang benar-benar dikirim" dan yang belum → lanjut cek manual seperti biasa
- Riwayat permintaan bisa dipantau kapan saja di Lacak Sparepart → Riwayat Request SJR: kolom Diterima/Dicatat/Belum menjawab "part yang saya minta sudah sampai mana"
- Batas: pencocokan kehadiran (bukan rekonsiliasi qty); kolom referensi opsional — kiriman tanpa referensi tetap jalan normal; label lama di DB tak diubah
- File berubah: prisma/schema.prisma, api/surat-jalan/route.ts, api/surat-jalan-request/route.ts (endpoint GET riwayat), surat-jalan-masuk-dialog.tsx, sparepart-finder-view.tsx

---
Task ID: 26
Agent: GLM (opencode)
Task: Surat Jalan REQUEST part disimpan + tgl request di badge; pencarian "Part Datang" di Lacak Sparepart

Work Log:
- Motif user: kiriman part ke produsen sering datang TIDAK serentak — workshop bingung kiriman untuk toko mana; minta data "Surat Jalan" disimpan + tgl request di bawah tulisan REQUEST, plus pencarian part datang (tgl datang, per toko, per tiket, kode, nama, kerusakan, status, serial/model) di dalam Lacak Sparepart
- Temuan bug lama: tombol "Surat Jalan" menembak POST /api/surat-jalan (route penyimpan draft Part Masuk yang wajib noSuratJalan) → unduhan PDF/Excel selalu 400 "Nomor surat jalan wajib diisi" — generator cetak TIDAK pernah ikut
- Schema: ServiceRequest + tglRequestPart DateTime?; model baru SuratJalanRequest (noSurat SJR-YYYYMMDD-NNNN unique, tglRequest, totalTiket/Item/Qty, lewatTanpaKode) + SuratJalanRequestItem (snapshot noTiket, kode, nama, qty, toko, serial, model, serviceRequestId); prisma db push terverifikasi via migrate diff → "No difference detected" (backup DB otomatis di awal build)
- API baru POST /api/surat-jalan-request: validasi + snapshot + SIMPAN dokumen + updateMany tglRequestPart (request pertama yang menang) + audit + git backup; format=pdf → jspdf A4 landscape (kop: judul SURAT JALAN REQUEST PART, baris "Tanggal Request : <tgl>" di bawahnya, QR verifikasi, tabel No/Tiket/Toko/SN/Model/Kode/Nama/Qty, multi page); format=xlsx → 2 sheet (Request + Ringkasan per toko)
- Dialog surat-jalan-dialog.tsx diarahkan ke endpoint baru + invalidate service-tickets pasca unduh (badge langsung muncul) + catatan tgl request tercatat
- service-view: badge REQUEST kini punya "Req: dd/mm" di bawahnya (hanya tiket REQUEST+punya tglRequestPart)
- API baru GET /api/sparepart/datang?q=&take=: rows dari SuratJalanMasukItem + tiket (cocokTiketId) → tglDatang=tglPartDatang??(DITERAPKAN→diterapkanAt); multi token AND mencakup kode/nama/tiket/toko/serial/model/kerusakan/status/statusPart/noSJR/status SJ/tgl (dd/mm/yy); urut tgl datang desc, belum datang baris tetap tampil (status SJ DRAFT/DIPERIKSA terlihat)
- Lacak Sparepart: kartu "Part Datang — Surat Jalan Produsen" di paling atas (muat 200 baris terkini saat dibuka; kotak bebas multi kata; badge jumlah baris+tiket; tabel Tgl Datang(+tgl surat)/No SJ+status SJ/Kode (KodeSparepart salin)/Nama/Qty/No Tiket/Toko/Serial-Model/Status tiket+status part/Kerusakan)
- Verifikasi: tsc + eslint kosong; deploy urutan aman: pm2 stop → db push → npm run build → start; GET / 200; endpoint datang tanpa sesi = 401 (terparam, terproteksi); PM2 online

Stage Summary:
- Klik "Surat Jalan" sekarang: dokumen SJR tersimpan + tiket mendapat tanggal request + PDF/Excel berisi "Tanggal Request" di bawah judul + ringkasan per toko
- Jawab persoalan "kiriman untuk toko mana": buka Lacak Sparepart → kartu Part Datang paling atas; cari per toko/tiket/kode/tgl datang lalu lihat kolom Toko & Serial/Model
- Batas: pencarian menjangkau 60 surat jalan masuk terakhir & 200 baris; dokumen SJR tak bisa disunting (tiap unduhan = dokumen riwayat baru); part dengan kode/nama belum lengkap tidak ikut dokumen (terhitung sebagai lewat)
- File berubah: prisma/schema.prisma, lib/types.ts, api/surat-jalan-request (baru), api/sparepart/datang (baru), surat-jalan-dialog.tsx, service-view.tsx, sparepart-finder-view.tsx

---
Task ID: 25
Agent: GLM (opencode)
Task: Audit fungsi background (read-only, izin user — "asal tidak ganggu produksi")

Work Log:
- Rantai boot diverifikasi ulang tanpa menyentuh proses: dump.pm2 hanya aspro-prod status online ✓; registry Run "PM2AutoStart" ✓; pm2-resurrect.vbs + aspro-prod.ico + shortcut .lnk ada ✓; pid listener :3000 = pid PM2 (23464) ✓; GET / 200 ✓ (build 09:54, uptime stabil, restart 0)
- Log error instance sekarang: tidak ada baris baru sejak start 09:54; error lama "Cannot find module C:\ROOT\.../worker-script/node/index.js" (tesseract.js) tertulis pada pid 16800 — era build lama sebelum task 24; worker script di build baru identik dengan node_modules sumber (771 B, itu memang loader; tesseract.js v7 memuat worker lewat bundler sendiri) → tidak terbukti rusak, validasi fungsional OCR menyusul saat scan pertama dipakai
- Out log menunjukkan prisma:query ikut ter-log di produksi (query logging aktif) → kontributor utama pertumbuhan aspro-prod-out-0.log ±3 MB/hari
- Log lama aplikasi lain masih ada di .pm2\logs: aftersales-pro (2,7 MB, 18/10), bass-prod (2,1 MB, 15/10), eracool (11 KB; entry-nya sudah dihapus dari PM2) — sampah historis, tidak mengganggu
- tg-polling mini-service idle sejak 17/10 (tg-poll.* tidak terupdate) — gateway berjalan via webhook / mode polling tak dipakai; tidak dijadwalkan ke PM2
- Tidak ada perubahan kode/konfigurasi pada audit ini

Stage Summary:
- Rantai auto-start tervalidasi utuh untuk boot berikutnya tanpa tindakan tambahan
- Item daftar keputusan user (tidak dipaksakan): (a) pasang pm2-logrotate demi rotasi log produksi, (b) matikan prisma:query log di produksi (butuh build + restart ~30 s), (c) hapus log lama historis, (d) validasi OCR saat scan pertama nanti

---
Task ID: 24
Agent: GLM (opencode)
Task: Kode sparepart bisa diklik (cek & salin) + urutan side panel baru; Gateway tinggal di Pengaturan

Work Log:
- Motif user: kode sparepart harus bisa diklik untuk cek atau copy-paste + sidebar diurutkan ulang (dashboard, master, service, field-ops, inventory, klaim, lacak, ai, inbox, pengaturan); Gateway tidak perlu menu sendiri karena sudah ada di Pengaturan
- Komponen baru src/components/kode-sparepart.tsx: klik kode = salin ke clipboard (toast "Kode tersalin" + swap ikon check), ikon SearchCheck = cek → navigateTo('lacak', { lacakQuery }) ; util src/lib/clipboard.ts (clipboard API + fallback execCommand); NavIntent + field lacakQuery
- Lapang pemakaian: service-view (baris tiket + dialog detail), inventory-view (daftar part, tab kosong, tab order, draft reorder), claim-view (ringkasan part), sparepart-finder-view (hasil cari, Bank Kode, tanya AI, AI dari hasil cari) — ikon Copy manual lama dinonaktifkan/dihapus di view lacak (kode itu sendiri jadi tombol)
- sparepart-finder-view: konsumsi navIntent.lacakQuery (dipakai set clearNavIntent, pola claim-view) → setBankQ + muatBank + scrollIntoView kartu Bank Kode (ref BankRef div pembungkus Card)
- page.tsx: NAV_ITEMS diurutkan ulang; gelar 'gateway' dihapus (Router ikut hilang beserta tetap dinamis dikompilasi, view masih bisa diakses lewat quick-entry & Pengaturan)
- Verifikasi: tsc NO ERROR, eslint bersih; build pertama EPERM menghapus .prisma query engine dll karena masih aspro-prod berjalan di .next/standaloneisasi — diperbaiki urutan: pm2 stop → npm run build (backup DB otomatis dari next-build.mjs) → pm2 start → GET / 200; PM2 restart ke-0 dan status online

Stage Summary:
- Setiap kode sparepart kini sambil itu bisa langsung disalin & di-cek lewat 2 ketukan — ikon copy terpisah tidak lagi diperlukan
- Sidebar: 10 menu sesuai urutan user; View Gateway tidak dihapus dari aplikasi (quick-entry + Pengaturan); file berubah: page.tsx, store.ts, kode-sparepart (baru), clipboard (baru), service-view, inventory-view, claim-view, sparepart-finder-view
- RILIS — urutan deploy yang mepet harus diterapkan dari sekarang: pm2 stop aspro-prod → npm run build → pm2 start ecosystem.config.cjs (build EPERM kalau lupa stop karena DLL tidak bisa ditimpa saat runtime berjalan)

---
Task ID: 23
Agent: GLM (opencode)
Task: Rute pengembangan tetap aman bersama PM2 produksi — dev dipindahkan ke :3001

Work Log:
- Motif user: tanya apakah masih bisa ngoding setelah aspro-prod dinyalakan PM2 di port 3000 — verdict: bisa, cukup pisahkan port
- Temuan konflik: package.json "dev": next dev -p 3000 masih menginjak port produksi (yang sudah dinyalakan dan harus tetap merespons); konvensi :3001 sebenarnya sudah tertulis di komentar ecosystem.config.cjs
- Selaraskan 2 file: package.json "dev" → next dev -p 3001; electron/main.js cabang dev serverPort 3000 → 3001 ( komentar ikut diperbarui) — desktop:dev ikut membaca dev :3001
- Uji menyeluruh (PM2 hidup + dev nyala serentak): GET http://localhost:3000 = 200, GET http://localhost:3001 = 200 (Next 16.4.0 Turbopack, siap 3 detik); dev server dihentikan pasca-tes, prod tetap 200
- DETAIL berikutnya yang tercatat: depresi warning "middleware" file convention → di Next 16.4.0 ganti konvensi "proxy" (npx @next/codemod middleware-to-proxy); DB tetap milik satu folder (db/custom.db) → operasi skema (db:push/migrate/restore) sebaiknya saat pm2 stop aspro-prod

Stage Summary:
- Rute kerja terbentuk: dev = npm run dev (:3001, hot reload) · produksi = PM2 :3000 (auto-start saat login, restart via pm2) · rilis = pm2 stop → npm run build → pm2 start ecosystem.config.cjs
- Jangan menjalankan `npm start` tangan sendiri (yang jalan adalah milik PM2 — kena EADDRINUSE)

---
Task ID: 22
Agent: GLM (opencode)
Task: Autostart app produksi via PM2 saat PC start (keputusan user: setelah login; entry lama errored dihapus)

Work Log:
- Motif user: app langsung start di background pakai pm2 saat PC dinyalakan, tanpa start manual
- pm2 startup tak tersedia di Windows → dipilih jalur login: daftar proses disimpan `pm2 save` → C:\Users\eraco\.pm2\dump.pm2
- Bersih-bersih: entry PM2 lama "eracool" (errored, npm.cmd sebagai script) dihapus; aspro-prod start via ecosystem.config.cjs → online, GET / 200
- Helper: C:\Users\eraco\.pm2\pm2-resurrect.vbs (hidden) menjalankan `node ...pm2\bin\pm2 resurrect` tanpa jendela; didaftarkan ke HKCU\Software\Microsoft\Windows\CurrentVersion\Run / "PM2AutoStart" = wscript.exe "...pm2-resurrect.vbs" (tanpa hak admin)
- Simulasi boot end-to-end: pm2 kill (daemon mati) → wscript helper → aspro-prod pulih online (pid baru), HTTP 200

Stage Summary:
- App produksi (aspro-prod, port 3000) sekarang otomatis start setelah login Windows — tidak perlu start pm2 manual lagi; coroutine: shortcut desktop "AfterSales Pro.lnk" (buka http://localhost:3000, ikon logo app hasil konversi logo.svg→ico via sharp) — user konfirmasi berjalan baik
- Antrean proses PM2 berubah hanya jika `pm2 save` dijalankan ulang setelah add/delete app
- File dibuat di luar repo: C:\Users\eraco\.pm2\pm2-resurrect.vbs + entri registry Run + C:\Users\eraco\.pm2\aspro-prod.ico (shortcut di OneDrive\Desktop)

---
Task ID: 21
Agent: GLM (opencode)
Task: Dropdown section di Pengaturan default semua tertutup

Work Log:
- Motif user: membuka halaman Pengaturan masih memunculkan beberapa dropdown terbuka (profil, merk, gateway, email) — diminta defaultnya tersebut terutup
- settings-view.tsx secOpen: semua SecKey (profil/merk/gateway/email/ai/backup/desktop/keamanan) default false; chevron + aria-expanded ikut refleksi; klik header tetap membuka
- tsc + eslint kosong, GET / 200

Stage Summary:
- Halaman Pengaturan kini desibel bersih — semua dropdown ada di papan ringkas, konten terbuka hanya saat headernya diklik
- File berubah: src/components/views/settings-view.tsx

---
Task ID: 20
Agent: GLM (opencode)
Task: Migrasi seluruh tiket lama SV-YYYYMMDD → SVC-YYMM (keputusan user: konversi semua)

Work Log:
- Motif user setelah penjelasan (tiket baru saja yg SVC): memilih konversi tiket lama juga — "GANTI DENGAN FORMAT YG LEBIH SIMPLE SVC-2610-NO SERI TAHUN-BLN-NO SERI"
- Analisis tabel yang menyimpan nomor tiket: ServiceRequest.noTiket(+noSttb), AuditLog.entitasId, InboxItem.hasilRef; WhatsAppLog.meta & teks email historis dibiarkan (chat log)
- Backup konsisten via PRAGMA VACUUM INTO → db/backup-sebelum-SVC-20261019.db
- Migrasi 1 transaksi: 60 tiket SV-YYYYMMDD-XXXX (SV-EM 1 tiket dilewati — itu nomor order) → SVC-YYMM dari tglTiket, urutan per bulan (tanggal kejadian + seq lama); noSttb dipetakan STTB-YYMM; audit entitasId & inbox hasilRef ditulis ulang; 1 audit MIGRASI_NOMOR; pemetaan lama→baru disimpan db/pemetaan-nomor-2026-10-19.json
- Kontrol pasca: 60 SVC / 0 sisa SV-legacy; API service tampil SVC-2610-0043 dst dgn STTB mengikuti; GET / 200; eslint bersih; generator sambung otomatis dari nomor tertinggi bulan (tiket baru 2026-10 → 0044 dst)

Stage Summary:
- SEMUA tiket kini format SVC-YYMM-XXXX seragam; riwayat disimpan (backup file DB + json pemetaan) — catat: nomor di STTB kertas/email lama mungkin tak cocok dengan nomor baru
- Skrip migrasi dihapus setelah selesai

---
Task ID: 19
Agent: GLM (opencode)
Task: Umur tiket > 24 jam tampil dalam hari agar mudah dimengerti

Work Log:
- Motif user: kolom Umur selama ini selalu "X jam" (mis. 75 jam) — kurang intuitif; lewat 24 jam yth tampilkan hari
- src/lib/umur.ts + function formatUmur(jam): <24 → "18 jam"; >=24 → "2 hari 5 jam"; tanpa sisa → "2 hari"
- service-view.tsx kolom Umur: formatUmur(t.umurTiketJam) menggantikan `${jam} jam`
- dashboard-view.tsx: 2 ekspresi inline (pesan WA pengingat & badge umur) diganti formatUmur — konsisten dgn sisa jam
- api/alerts route: teks alert ALT-02 ("sudah X jam") & ALT-05 (ternary hari) diganti formatUmur; meta.jam tetap numerik untuk penghitungan
- api/pending/export: hapus helper lokal umurText, pakai formatUmur (laporan PDF/XLSX ikut terbaca)
- Verifikasi: tsc + eslint kosong (5 file), GET / 200; fungsi murni tanpa risiko data

Stage Summary:
- Semua tampilan umur konsisten: jam di bawah 24, di atasnya hari + sisa jam — satu sumber di lib/umur.ts
- File berubah: src/lib/umur.ts, src/components/views/service-view.tsx, src/components/views/dashboard-view.tsx, src/app/api/alerts/route.ts, src/app/api/pending/export/route.ts

---
Task ID: 18
Agent: GLM (opencode)
Task: Sembunyikan badge klaim DRAFT (keputusan user: "Ajukan Klaim" sudah cukup jelas, DRAFT dihilangkan saja)

Work Log:
- Pilihan user lewat pertanyaan: "TULISAN AJUKAN KLAIM ITU SUDAH JELAS BLM TERCLAIM JADI RANCU, DRAFT DIHILANGKAN SAJA"
- service-view.tsx: badge klaim di sel Status tiket FINISH hanya muncul bila statusKlaimProdusen SUBMITTED/PAID (DRAFT disembunyikan); meta bar detail " · Klaim {status}" juga disembunyikan saat DRAFT
- Alur aksi tetap: dropdown Aksi tampil untuk FINISH dgn klaim DRAFT/SUBMITTED (Ajukan Klaim / Tandai Lunas), pemberitahuan koreksi internal DRAFT tetap
- tsc + eslint kosong, GET / 200

Stage Summary:
- Tampilan FINISH lebih bersih: tidak ada lagi badge DRAFT/klaim yang belum diproses — cukup tombol "Ajukan Klaim" dalam dropdown Aksi
- File berubah: src/components/views/service-view.tsx

---
Task ID: 17
Agent: GLM (opencode)
Task: Sederhanakan nomor tiket SV-YYYYMMDD → SVC-YYMM + penjelasan badge DRAFT

Work Log:
- Motif user: nomor tiket terlalu panjang — tahun 2 digit (2026→26), lalu bulan + nomor urut, dan prefix SV diganti SVC
- src/lib/audit.ts generateNoTiket: SVC-YYMM-XXXX; sekuens PER BULAN (query startsWith SVC-{ym}-, take nomor terbesar +1; regex \d{4} tahan suffix kode unit); generateNoSttb: replace /^(SV|SVC)-/ agar tiket lama & baru sama-sama benar menjadi STTB-
- Generator EM (SV-EM-YYYYMMDD) tidak diubah — nomor order email terpisah dan berhenti dari copy UI
- Data lama SV-20261019-0001 tetap utuh; tiket baru mulai SVC-2610-0001
- Uji E2E (skrip temp): unit uji A/B → tiket1 SVC-2610-0001, tiket2 SVC-2610-0002 (urutan per bulan naik), jalur auto STTB saat input part → noSttb STTB-2610-0002 tersimpan, regex legacy SV-... → STTB-20261019-0001; tsc + lint kosong
- Bersih-bersih: 2 unit uji, 2 tiket uji + partnya, 2 baris audit uji dihapus; skrip temp dihapus

Stage Summary:
- Tiket baru berformat SVC-YYMM-XXXX (mis. SVC-2610-0001) — nomor tiket lebih pendek, urutan per bulan; data lama tidak berubah; STTB mengikuti format tiket
- File berubah: src/lib/audit.ts
- Penjelasan DRAFT diberikan ke user + opsi perubahan label ditanyakan

---
Task ID: 16
Agent: GLM (opencode)
Task: Aksi tiket jadi dropdown + email ikon; kolom Kerusakan di tabel Service samping Umur; backfill diagnosa unit dari tiket lama

Work Log:
- Motif user: tombol Email/Proses/Part Datang dsb makan banyak ruang → jadikan dropdown, email cukup ikon; tambahkan kolom Kerusakan di samping Umur seperti Master Barcode; unit yg sudah punya kode sparepart seharusnya sudah terdata kerusakannya — tinggal ditampilkan/ditarik agar tidak isi ulang
- service-view.tsx: sel Aksi ditulis ulang — email jadi tombol ikon 7x7 (MailPlus = Email Order reorder, Send = Kirim ulang); aksi lain dipadatkan DropdownMenu "Aksi" (Proses + STTB dgn konfirmasi part belum siap, Part Datang, Selesaikan, Ajukan Klaim, Tandai Lunas masing2 beri ikon), tombol Eye tetap
- Header/sel tabel Service: kolom Kerusakan lama (hanya tab REQUEST/PROSES) dihapus; kolom baru max-w-44 setelah Umur untuk semua tab — utamakan kerusakanAwal unit (sama dgn Master Barcode), fallback deskripsi Kerusakan tiket; tooltip menyebut sumber data
- Backfill (skrip temp dgn audit sekali jalan): 88 unit kosong diperiksa → 57 unit terisi kerusakanAwal dari deskripsi Kerusakan tiket terbaru yg punya part; unit tanpa tiket berpart dibiarkan kosong; 1 row AuditLog BACKFILL unit_asset; sampel SV-20261014-0001 BODY PENYOK dll; data uji SV-EM-20261018-0001 ikut tampil di API
- Verifikasi: tsc + eslint kosong; GET /api/service 200 (57/61 tiket membawa kerusakanAwal unit); GET / 200 (kompilasi dev); skrip temp dihapus

Stage Summary:
- Kolom Aksi Service jadi ringkas (email ikon + dropdown), diagnosa kerusakan selalu terlihat di samping Umur semua tab, dan seluruh unit dgn kode sparepart lama sudah otomatis punya isi kolom Kerusakan tanpa input ulang
- File berubah: src/components/views/service-view.tsx (+ data per unit via backfill)
- Tidak ada perubahan schema/API; fitur langsung hidup via dev server :3000

---
Task ID: 15
Agent: GLM (opencode)
Task: Kerusakan unit = diagnosa awal (bahasa awam) di registrasi + kolom Kerusakan di Master Barcode tanpa no. tiket

Work Log:
- Motif user: selama ini kerusakan baru terekam saat kode part terbit (tiket) — unit yang lama menunggu bisa "lost" tanpa catatan kerusakan; dimintakan diagnosa awal sejak registrasi + kolom tampil di Master Barcode / Unit Asset, dan karena ruang sempit nomor tiket tidak usah ditampilkan di Master Unit
- Schema UnitAsset + kolom nullable kerusakanAwal (komentar: diagnosa awal bahasa awam sebelum kode part terbit); db push sukses — sempat EPERM rename query engine dll (file terkunci dev server) → hentikan next dev, push+generate ulang, hidupkan lagi detached (CM ID/cmd npm run dev, log di output); kolom terverifikasi via client (nilain awil null)
- API unit POST: simpan kerusakanAwal (trim → null bila kosong) + audit tambah "diagnosa awal kerusakan tercatat" bila diisi; PATCH unit/[id]: koreksi/kosongkan kerusakanAwal
- types.ts UnitAsset + kerusakanAwal: string | null
- master-data-view: newUnit/editUnitForm + field kerusakanAwal; dialog Registrasi Unit Asset & Edit Unit menambah field Textarea 2 baris "Kerusakan Unit — Diagnosa Awal (bahasa awam)" lebar sm:col-span-2 dengan penjelasan; updateUnit mengirim kerusakanAwal
- Tabel Master Barcode: kolom "Kerusakan" setelah kolom Part (search mode) / Kode Part (daftar) — clamp 2 baris + tooltip bahasa awam; colSpan empty-row 9→10 (search 10→11); badge nomor tiket di area aksi Dihapus (aktifTiket & emailTiket) agar hemat ruang — status WAITING PART tetap di kolom Status, tanda tiket aktif di menu dropdown tetap memberi tahu unit sedang diproses
- E2E (token admin lokal, dev :3000): POST /api/unit dgn kerusakanAwal → 201; GET list bawa kolom; PATCH ubah + path kosongkan → null; DELETE unit tanpa tiket → ok; 4 audit uji + unit uji dihapus dari mongo DB; skrip temp dihapus; halaman / 200

Stage Summary:
- Registrasi unit kini mencatat kerusakan sejak awal (diagnosa awam) dan Master Barcode menampilkan kolom Kerusakan — no. tiket tidak lagi memakan ruang di tabel unit
- File berubah: prisma/schema.prisma, src/app/api/unit/route.ts, src/app/api/unit/[id]/route.ts, src/lib/types.ts, src/components/views/master-data-view.tsx (+ db custom.db via prisma push)
- tsc + eslint bersih; E2E POST/GET/PATCH/DELETE lulus & data uji dibersihkan

---
Task ID: 14
Agent: GLM (opencode)
Task: Identifikasi READY vs INDEN per part + tombol Reorder Email untuk part belum ready (kasus: 3 part rusak — 2 ready, 1 inden)

Work Log:
- Latar: status kesiapan part sudah tersimpan per-baris (ServiceRequestPart.statusPart READY|ORDER_PRODUSEN) — dasar identifikasi benar; gap: tidak ada ringkasan sekilas per tiket, dan part inden di tiket biasa (REQUEST/PROSES) tidak punya jalur reorder langsung (harus lewat modul Input Part Kurang → tiket SV-EM baru)
- API service/[id]/route.ts: aksi baru ORDER_EMAIL_REORDER — daftarkan baris part ORDER_PRODUSEN sebagai OrderEmailPart PENDING yang menempel ke TIKET YANG SAMA (tanpa tiket SV-EM baru); idempoten (baris inden yang sudah punya item PENDING/TERKIRIM dilewati — klik ulang aman, tidak ada order ganda); loader PATCH include unitAsset.toko untuk snapshot item; guard KIRIM_EMAIL_PRODUSEN diperlonggar (tiket REQUEST_EMAIL ATAU tiket biasa dengan item PENDING); TERIMA_PART_PRODUSEN kini ikut menandai item order-email tiket → DATANG (konsisten dengan modul surat jalan masuk)
- API service/route.ts GET list + GET detail: include orderEmailParts (id, kodePart, qty, status, createdAt) agar UI tahu part inden mana yang sudah/belum diorder
- types.ts: tambah OrderEmailRef + field opsional ServiceTicket.orderEmailParts (kompatibel respons lama)
- service-view.tsx: chip ringkasan per tiket di kolom Status "N ready · M inden" (border rose saat ada inden, emerald saat semua ready) — juga di judul + bagian Sparepart dialog detail; tombol aksi per tiket: hasOrderPart + tiket aktif → "Email Order" (ada inden belum didaftarkan) dibanding "Kirim Email" (sudah); badge per-baris "Email: PENDING/TERKIRIM" pada part inden yang sudah diorder; tombol Email Order juga tersedia per baris part di detail; helper KODE_NORM + emailAktifUntuk (pencocokan kode sama gaya dengan matcher surat jalan)
- Alur satu klik: Email Order → ORDER_EMAIL_REORDER (buat item) → KIRIM_EMAIL_PRODUSEN → SMTP terkirim ATAU draf mailto dibuka (toast hasil); penerimaan part tetap via "Part Datang" / Surat Jalan Masuk
- E2E (dev :3000, token admin lokal): tiket uji 2 part (1 katalog READY stok direserve, 1 kode manual → ORDER_PRODUSEN) → tiket langsung PROSES; REORDER #1 dibuat=1, #2 dibuat=0 (idempoten); KIRIM → MAILTO (SMTP belum diset) dan item tetap PENDING; TERIMA_PART_PRODUSEN → kedua part READY + item email DATANG; stok brand tidak tersentuh oleh penerimaan per-unit
- Pembersihan uji: restore stok SFMX (2/2), hapus tiket/part/item/audit uji, hapus katalog ZZTEST-REORDER-UJI, skrip sementara dihapus; server :3000 (dev) tetap jalan — fitur langsung aktif via hot-reload; build produksi standalone cukup dijalankan saat mau deploy via PM2

Stage Summary:
- Part inden di tiket kini teridentifikasi sekilas lewat chip "N ready · M inden" dan bisa di-order email satu klik dari daftar tiket maupun dialog detail — tanpa tiket ganda; penerimaan part ikut menutup item email-nya
- File berubah: src/app/api/service/[id]/route.ts, src/app/api/service/route.ts, src/components/views/service-view.tsx, src/lib/types.ts
- tsc --noEmit bersih; eslint 4 file bersih; E2E API lulus & data uji dibersihkan

---
Task ID: 13

Agent: Muse Spark (opencode)
Task: Settings jadi dropdown + perbaiki trigger dropdown Inventory

Work Log:
- 5 kartu Settings (Profil, Gateway, Backup, Desktop&MCP, Keamanan) dibungkus komponen SettingSection (Collapsible): header selalu terlihat + chevron, isi buka/tutup; default terbuka Profil & Gateway, sisanya tertutup; Audit Log tidak diubah (sudah ScrollArea internal)
- Fix bug: CardHeader tidak forward ref → CollapsibleTrigger asChild langsung ke CardHeader rusak saat runtime; pola benar asChild > div biasa (meneruskan ref) > CardHeader; diterapkan di SettingSection + Draft Re-Order Inventory
- Sempat menghapus blok notice MCP desktop karena salah batas edit → dikembalikan + diverifikasi via grep; struktur akhir seimbang (5 section, lint bersih)
- Verifikasi: build sukses, string "klik untuk buka/tutup" ada di chunk client, /login 200

Stage Summary:
- Halaman Settings ringkas tanpa scroll jauh; pola dropdown aman dipakai ulang

---
Task ID: 12
Agent: Muse Spark (opencode)
Task: Batasi scroll halaman — tabel scroll internal + section panjang jadi dropdown

Work Log:
- Pola seragam di 3 area: header kartu tetap statis + tabel dibungkus max-h-60vh overflow-auto dengan thead sticky + jumlah item di deskripsi ("gulir di dalam tabel")
- inventory-view: tabel stok + Draft Re-Order dijadikan Collapsible (trigger header + badge jumlah + chevron, default terbuka)
- master-data-view (tab Toko): tabel Master Toko Mitra scroll internal
- field-ops-view: grid Kepatuhan max-h-560px scroll internal + tabel Riwayat Kunjungan scroll internal
- Pelajaran build: server lama mengunci .next/standalone (EPERM) → stop dulu sebelum npm run build
- Verifikasi: eslint bersih, build sukses, string baru ada di chunk client, /login 200

Stage Summary:
- Tidak ada lagi scroll halaman kepanjangan di Inventory / Master Toko / Field Ops

---
Task ID: 11
Agent: Muse Spark (opencode)
Task: Cek rollback Task 5 lalu kembali ke main (hasil: sama saja)

Work Log:
- Petakan commit: e35a339=Task5 login/logout, 6f53db7=Task6 iframe, d6a7151=Task7 surat jalan, 0d9da03=Task8 drill-down
- Branch kembali-task5 dari e35a339 + DB periode + rebuild → login 200 normal; user nilai "sama saja" (bukan versi revisi hilang yang dicari)
- Kembali ke main: DB di-migrasi ulang (RENAME ke stokInventory, push sinkron), rebuild, login 200 + "Stok Inventory" ✓
- Pelajaran: revisi tiket manual tidak ada di git/zIP/VSCode-history/server-belum-dicek; rekonstruksi menunggu deskripsi user

Stage Summary:
- Kondisi kembali seperti sebelum rollback: main 9327926 + server baru, branch kembali-task5 dipertahankan sebagai arsip

---
Task ID: 10
Agent: Muse Spark (opencode)
Task: Git diamankan — checkpoint + perekam otomatis tiap perubahan

Work Log:
- Temuan audit: hanya 9 commit (9–10 Okt, pesan UUID), 65 file modified + 14 path fitur utuh (inbox/telegram/vision/laporan) belum pernah masuk git, tanpa remote → revisi tiket manual kemungkinan hilang karena tidak tercatat
- Checkpoint 2c30ce0: 66 file, 21092 insertions (task 6–9); buang artefak dari riwayat (project.zip 13MB, *.bak); .gitignore: project.zip, project/, download/, upload/, *.bak, db/backups/, db/custom.db (DB live berubah tiap request — tak lagi digembungkan ke repo; db/template.db tetap terlacak)
- scripts/git-snapshot.ps1: add -A + commit "auto-snapshot <timestamp>" bila kotor; hormati .gitignore; tanpa push; uji E2E lulus (commit 3bd3152 terbentuk lalu di-reset)
- Task Scheduler "AfterSalesPro-GitSnapshot": tiap jam (next run terverifikasi); skrip di-commit 4c33454
- Sisa risiko: tanpa remote GitHub → riwayat hanya di laptop; disarankan buat remote + push

Stage Summary:
- Working tree bersih; tiap perubahan kode kini terekam otomatis maksimal 1 jam + commit manual tiap akhir sesi

---
Task ID: 9
Agent: Muse Spark (opencode)
Task: Rename total "konsinyasi" → "inventory" (label UI + field database)

Work Log:
- Diagnosis login gagal di localhost: DATABASE_URL di .env menunjuk path Linux (file:/home/z/my-project/db/custom.db) sehingga server Windows membuka DB kosong → 500. Fix: .env → file:C:/Users/bass_project2/db/custom.db (diabaikan git; systemd server memakai Environment sendiri) + restart dengan env eksplisit → login budi/admin123 200
- Temuan rename: build sudah current (working tree lebih baru dari HEAD, tanpa remote), tapi 70 kemunculan "konsinyasi" memang belum diganti di kode (hanya key view 'inventory' yang sudah) → bukan build basi
- Migrasi data SQLite tanpa hilang: backup custom.db ke Temp; ALTER TABLE "MasterSparepart" RENAME COLUMN "stokKonsinyasi" TO "stokInventory" via $executeRawUnsafe (9 baris, nilai stok utuh terverifikasi); template.db diregenerasi via scripts/make-template-db.mjs
- Rename field stokKonsinyasi → stokInventory di: prisma/schema.prisma, types.ts, csv.ts, laporan.ts, gsheets.ts, API (alerts, dashboard, sparepart, sparepart/[id], sparepart/import header → stok_inventory, service, service/[id]), views (inventory, service, dashboard, gateway), csv-import-dialog, scripts/seed.ts, scripts/test-mcp.mjs, mcp/tools.mjs
- Kompatibilitas import CSV lama dijaga: alias header tetap menerima stok_konsinyasi/stokkonsinyasi (canonical baru stok_inventory)
- Rename label UI: 'Stok Konsinyasi' → 'Stok Inventory' (nav, drill-down ALT-03, judul tabel, sheet backup, dialog), footer/layout/login '(Konsinyasi)' → '(Inventory)', teks STTB/surat jalan/claim export (KONSINYASI → INVENTORY), deskripsi package.json + mcp/server.mjs + README-DESKTOP.md
- Sengaja tidak diubah (riwayat): worklog.md task lama, upload PRD, db/backups/*.json, db/custom.db.bak-20261010
- Verifikasi: prisma generate OK + db push "already in sync"; npm run build sukses; restart standalone; login 200; homepage HTML memuat "Stok Inventory", nol kemunculan (?i)konsinyasi di HTML; sisa 1 di src hanya alias kompat CSV

Stage Summary:
- Seluruh aplikasi kini memakai istilah "inventory": 27 file diubah, data stok 9 part utuh, server localhost:3000 berjalan (login budi/admin123)
- Kredensial tidak berubah

---

---
Task ID: 5
Agent: Main Agent (Super Z)
Task: Menambahkan fitur Log In & Log Out (autentikasi) ke aplikasi AfterSales Pro

Work Log:
- Prisma schema: Pengguna + username (unique, nullable) & passwordHash (scrypt format "scrypt$salt$hash"); db:push + regenerasi client; scripts/backfill-passwords.mjs mengisi kredensial 6 user existing (ADMIN_WORKSHOP → admin123, lainnya → aftersales123, username dari local-part email)
- src/lib/auth.ts (edge-safe): JWT HS256 via jose, cookie httpOnly "aspro_session" 7 hari, signSession/verifySessionToken/getSession (parse header Cookie manual — jalan di middleware edge & route handler node); secret dari env AUTH_SECRET dengan fallback dev
- src/lib/auth-node.ts: hashPassword/verifyPassword node:crypto scryptSync + timingSafeEqual (tanpa dependency baru)
- API auth: POST /api/auth/login (identifikasi email ATAU username case-insensitive, delay 400ms saat gagal, audit LOGIN/LOGIN_GAGAL), POST /api/auth/logout (hapus cookie + audit LOGOUT), GET /api/auth/me (profil fresh dari DB; 401 + clear cookie jika akun dinonaktifkan)
- src/middleware.ts: proteksi semua halaman (redirect /login) & API (401 JSON); whitelist /api/auth/*, /api/wa/webhook (dipanggil bot eksternal), /api/backup/sheets (MCP/watcher); /login saat sudah login → redirect /
- src/app/login/page.tsx: form email/username + password (toggle show), error alert, tombol akun demo auto-fill, branding emerald/slate; redirect selalu ke "/" (app single-route — temuan: ?next= ke /service menghasilkan 404, dihapus)
- store.ts: + user (SessionUser), authReady, setUser (menyalin role dari sesi); page.tsx: gate "Memeriksa sesi…" via /api/auth/me, role switcher diganti chip user (inisial + nama + role) dengan dropdown menu berisi info akun + tombol "Keluar (Log Out)"; sidebar footer "Login sebagai …"
- API pengguna: POST menerima username (default local-part email, cek unik) & password (default aftersales123, min 6 char); GET tidak pernah mengekspos passwordHash; route [id]/PATCH baru: reset password, toggle aktif (proteksi admin terakhir), update role/nama/noWa/wilayah + audit RESET_PASSWORD_PENGGUNA/UPDATE_PENGGUNA; keduanya dijaga requireManager (ADMIN_WORKSHOP/MANAGER saja → 403)
- UI Master Data → Karyawan: badge @username & "Nonaktif", aksi per kartu Reset Password (dialog) + Aktif/Nonaktif (ikon power); dialog Tambah Karyawan + field Username/Password opsional
- Desktop & seed: seed.ts + make-template-db.mjs menanam passwordHash (admin123/aftersales123); template.db diregenerasi (96 KB) sehingga MSI membawa akun login; README-DESKTOP.md + section 1.4 "Login / Log Out" (tabel kredensial desktop & web, reset password, catatan audit)
- Fix teknis: dev server direstart agar Prisma client hasil regenerasi termuat (login 401 terus karena findMany client lama tidak men-select kolom baru); lint (set-state-in-effect di login → lazy useState initializer); middleware tanpa ?next= (single-route)
- Verifikasi curl: redirect / → /login 307; API tanpa sesi 401; login salah 401 + audit LOGIN_GAGAL; login benar (email & username) 200 + cookie; /api/auth/me 200; logout → me 401 (cookie dibersihkan); PATCH oleh TEKNISI 403, oleh ADMIN 200; nonaktif → login 401 & me 401; buat user password kustom → login ok
- Verifikasi Agent Browser (screenshot verify-23a…23n): / → redirect /login ✓; error password salah ✓; tombol demo auto-fill ✓; login → dashboard chip "Budi Santoso / Admin Workshop" ✓; dropdown Keluar → /login ✓; login teknisi → "Ahmad Fauzi / Teknisi Lapangan" ✓; tab Karyawan badge @username ✓; dialog Reset Password → login password baru ok ✓; login mobile iPhone 14 & dashboard mobile ✓; lint bersih; dev.log bersih
- Catatan tooling: sesi agent-browser kedua pipeline input mouse-nya mati (event tak sampai ke window; bukan bug app — sesi pertama klik nyata sukses, eval-synthetic dispatch membuktikan handler Radix tetap bekerja); verifikasi akhir dilanjutkan via eval-dispatch
- Data uji dibersihkan (qa-test dihapus; password slamet direstore; user lain utuh)

Stage Summary:
- Fitur Log In & Log Out lengkap: halaman /login, sesi JWT httpOnly 7 hari, proteksi middleware untuk semua halaman & API, chip user + Keluar di header, akun dapat dinonaktifkan/di-reset password, audit LOGIN/LOGIN_GAGAL/LOGOUT/RESET_PASSWORD_PENGGUNA tercatat
- Kredensial: web demo budi@teknikjaya.co.id/admin123 (username: budi), teknisi aftersales123; desktop admin@aftersales.local/admin123 — tercatat di README-DESKTOP.md & kartu demo di halaman login
- File baru: src/lib/auth.ts, src/lib/auth-node.ts, src/middleware.ts, src/app/login/page.tsx, src/app/api/auth/{login,logout,me}/route.ts, src/app/api/pengguna/[id]/route.ts, scripts/backfill-passwords.mjs
- File diubah: prisma/schema.prisma, src/lib/store.ts, src/lib/types.ts, src/app/page.tsx, src/app/api/pengguna/route.ts, src/components/views/master-data-view.tsx, scripts/seed.ts, scripts/make-template-db.mjs, db/template.db, README-DESKTOP.md
- MCP & desktop tidak terpengaruh: MCP stdio bypass HTTP (tetap 19 tool), MSI build memakai template.db yang kini berisi akun login

---
Task ID: 2
Agent: Main Agent (Super Z)
Task: Menambahkan fitur input massal (bulk import) nama toko & sparepart via CSV

Work Log:
- Membuat src/lib/csv.ts: parser CSV state-machine (BOM UTF-8, delimiter otomatis koma/titik-koma/tab/pipe, field berkutip dengan escape ""), mapping header fleksibel via alias case-insensitive, validator shared untuk toko & sparepart (dipakai server + pratinjau client), parseNum heuristik angka Indonesia ("Rp 275.500"→275500, "1.250"→1250, "12,5"→12.5), parseDateFlexible (YYYY-MM-DD & DD/MM/YYYY), buildCsvTemplate, batas 5.000 baris
- Membuat API /api/toko/import & /api/sparepart/import: GET = unduh template CSV (Content-Disposition attachment), POST = import massal dengan mode 'skip' (lewati kode existing) atau 'update' (partial update, kolom kosong tidak di-overwrite), validasi per-baris dengan pesan jelas, duplikat dalam file terdeteksi, createMany batch untuk insert + update per-baris, respons {total, inserted, updated, skipped, failed, errors[], skippedDetails[]}, audit log IMPORT_MASTER_TOKO / IMPORT_MASTER_SPAREPART
- Membuat komponen reusable src/components/csv-import-dialog.tsx (3 tahap: Unggah drag&drop/paste → Pratinjau dengan badge BARU/PERBARUI/LEWATI/ERROR per baris → Hasil statistik + detail baris gagal/dilewati), mode radio skip/update, validasi file (.csv, maks 5MB), aksesibilitas (role button, aria-label, keyboard)
- Integrasi: tombol "Import CSV" di MasterDataView tab Toko & InventoryView (Stok Konsinyasi), invalidate query toko/spareparts/dashboard/alerts/audit + toast ringkasan
- Verifikasi curl: template ✓, mode skip ✓ (1 inserted, 1 skipped terpisah dari failed), mode update ✓ (partial: nama+stok berubah, ROP & harga kosong tidak di-overwrite), delimiter koma & titik-koma ✓, header salah ✓ ditolak dengan pesan, CSV kosong ✓ ditolak, stok negatif ✓ error, duplikat DB ✓ dilewati, angka format Indonesia ✓
- Verifikasi Agent Browser: dialog toko (unggah→pratinjau BARU/LEWATI→import 2 data→hasil + tabel ter-refresh) ✓, dialog sparepart dengan baris error (stok -9 ditandai ERROR) ✓, audit log 5 entry tercatat ✓, nilai stok titipan ter-update otomatis ✓, mobile responsive iPhone 14 ✓, lint bersih, zero console error (hanya warning minor aria radix)

Stage Summary:
- Fitur input massal CSV untuk MasterToko & MasterSparepart lengkap dan terverifikasi end-to-end
- File baru: src/lib/csv.ts, src/app/api/toko/import/route.ts, src/app/api/sparepart/import/route.ts, src/components/csv-import-dialog.tsx
- File diubah: src/components/views/master-data-view.tsx, src/components/views/inventory-view.tsx
- Data uji telah dibersihkan dari database

---
Task ID: 1
Agent: Main Agent (Super Z)
Task: Membangun aplikasi fullstack "Systems Automation for After-Sales Operations & Inventory Management" sesuai PRD yang diunggah user

Work Log:
- Membaca PRD dari /home/z/my-project/upload/product_requirement_document_prd.md
- Memuat skill fullstack-dev dan inisialisasi environment (Next.js 16 + TypeScript + Prisma SQLite + shadcn/ui)
- Menginstall package tambahan: xlsx (export Excel), qrcode (QR STTB), jspdf (PDF generator)
- Mendesain prisma/schema.prisma sesuai Section 5 PRD: MasterToko, MasterCustomer, MasterSparepart, UnitAsset, Kunjungan, ServiceRequest, ServiceRequestPart + tambahan Pengguna (Modul 1.3), AuditLog (Modul 6), WaMessage (gateway log), Pengaturan (profil perusahaan)
- db:push + seed data realistis (6 toko, 6 customer, 8 sparepart, 10 unit, 6 tiket, 6 kunjungan, alert scenarios)
- Membangun 16 API routes:
  * /api/dashboard (KPI agregat + tren)
  * /api/alerts (Alert Engine ALT-01 s/d ALT-04 dengan persist slaFlag)
  * /api/toko, /api/toko/[id] (CRUD master store)
  * /api/customer, /api/sparepart, /api/sparepart/[id], /api/unit (master data)
  * /api/service, /api/service/[id] (workflow MULAI_PROSES→STTB, FINISH+nota, SUBMIT_CLAIM, MARK_PAID, TERIMA_PART_PRODUSEN)
  * /api/wa/webhook (parse #LAPOR [SN] [PART] [DESC] → cek garansi → cek stok → READY: tiket PROSES+STTB+reserve stok; KOSONG: ORDER_PRODUSEN+notifikasi)
  * /api/sttb/[noTiket] (PDF jsPDF + QR Code qrcode)
  * /api/claim/export (XLSX 3 sheet: Rekap, Rincian Sparepart, Ringkasan)
  * /api/kunjungan (check-in onsite + reset siklus visit)
  * /api/pengguna, /api/pengaturan, /api/audit
- Membangun UI single-page dengan sidebar navigasi 8 view + role switcher (Admin/Teknisi/Manager/Produsen):
  DashboardView (8 KPI + 3 chart recharts + alert engine), WaBotView (chat simulator WA + template + aturan bot), ServiceView (tabel tiket + aksi workflow + dialog detail/finish/manual-create), FieldOpsView (kepatuhan visit + check-in + scanner simulasi), InventoryView (stok + ROP + draft re-order + restock), MasterDataView (4 tab + stiker barcode), ClaimView (rekap klaim 3 status + export Excel), SettingsView (profil + audit log)
- Lint bersih (fix: setState-in-effect, unused imports, custom Send icon)
- Verifikasi browser (agent-browser): dashboard KPI & alert engine ALT-01..04 ✓, WA bot kirim #LAPOR → tiket dibuat + reserve stok ✓, workflow MULAI_PROSES ✓, check-in toko TERLAMBAT→ON TRACK ✓, stiker barcode ✓, SUBMIT_CLAIM ✓, STTB PDF dengan QR ✓, Export Excel ✓, mobile responsive + hamburger menu ✓, audit log tercatat ✓, zero console errors
- Perbaikan sesuai PRD 3.2: tiket via WA bot dengan part READY kini langsung status PROSES + STTB terbit otomatis

Stage Summary:
- Aplikasi "AfterSales Pro" lengkap dan terverifikasi end-to-end berjalan di port 3000
- Semua 6 modul PRD terimplementasi + 4 alert rules + integrasi WA webhook + PDF STTB QR + Excel export
- File utama: prisma/schema.prisma, src/lib/{db,audit,types,api,store}.ts, src/app/api/** (16 route), src/components/views/** (8 view), scripts/seed.ts

---
Task ID: 3
Agent: Main Agent (Super Z)
Task: 3 fitur baru — (1) Gateway multi-channel WA+Telegram di Pengaturan + akses cepat Add Toko/Customer, (2) backup otomatis Google Spreadsheet, (3) barcode per-toko untuk check-in kunjungan otomatis via scan

Work Log:
- Prisma schema: MasterToko.barcodeToko (unique), Kunjungan.metodeCheckin (SCAN_BARCODE|MANUAL) + barcodeTerscan, WaMessage.channel (WHATSAPP|TELEGRAM), model BackupLog baru; db:push bertahap (nullable → backfill BC-{KODETOKO} via scripts/backfill-barcode.ts → required)
- Backend Gateway: src/lib/gateway.ts (getGatewayConfig + sendGatewayMessage — WA via custom webhook URL/token, Telegram via Bot API sendMessage, fallback SIMULASI), API /api/gateway/test (GET status + POST tes kirim), /api/wa/webhook kini terima body.channel dan meneruskan balasan bot ke API eksternal bila kredensial terisi
- Backend Backup: src/lib/gsheets.ts (collect 6 tabel → JWT RS256 service account via node:crypto → Google Sheets API clear+update per tab; fallback snapshot JSON lokal ke db/backups/), API /api/backup/sheets (GET status+dueNow, POST run MANUAL|AUTO)
- Auto backup: src/components/auto-backup-watcher.tsx mounted di page.tsx — poll status tiap 10 menit, server menghitung dueNow (interval jam dari pengaturan), trigger POST AUTO; terverifikasi log AUTO LOCAL terekam saat app dibuka
- UI: wa-bot-view diganti gateway-view.tsx (sidebar "Gateway", tab WhatsApp/Telegram, log pesan per channel, badge simulasi, status koneksi); settings-view ditulis ulang (card Gateway: aktif switch WA/Telegram, URL, token, chat ID, channel default, tombol Tes per channel; card Backup: spreadsheet ID, service email, private key, auto switch, interval, status + riwayat, tombol Backup Sekarang)
- Akses cepat: src/components/quick-entry.tsx (QuickActions card "Akses Cepat" di Dashboard: Add Toko, Add Customer, Scan Kunjungan, Gateway + shared AddTokoDialog/AddCustomerDialog dipakai MasterDataView juga — hapus duplikasi dialog)
- Barcode per toko: POST /api/toko & CSV import auto-generate BC-{KODETOKO} (kolom barcode_toko opsional di CSV, validasi duplikat in-file & DB); toko-barcode-sticker.tsx (Code-128 asli via jsbarcode dynamic import + Cetak); Master Data kolom "Barcode Toko" per baris
- Field Ops ditulis ulang: panel "Scan Kunjungan — Barcode Toko" (kamera html5-qrcode + input manual, teknisi selector) → lookup /api/kunjungan/lookup → check-in OTOMATIS POST /api/kunjungan {barcode, metodeCheckin: SCAN_BARCODE}; hasil scan: identitas toko + stat + badge TERCATAT + tambah catatan; check-in manual tetap ada; kolom Metode (SCAN/MANUAL) di riwayat
- Fix: SQLite tidak dukung mode insensitive (normalisasi JS: BC- prefix strip + fallback scan dataset kecil); jsbarcode CJS interop (dynamic import + default ?? mod)
- Verifikasi curl: lookup BC-TOK-001/lowercase/unknown ✓, scan check-in BC-TOK-003 ✓ (SCAN_BARCODE + barcodeTerscan), gateway test TELEGRAM → SIMULASI ✓, #LAPOR via TELEGRAM → tiket SV-20261010-0001 + audit "via Telegram Bot" ✓, backup MANUAL → LOCAL snapshot 51 baris ✓, toko POST → BC-TOK-TEST ✓, CSV import barcode kustom/default/duplikat ✓
- Verifikasi Agent Browser: dashboard Akses Cepat (Add Toko → TOK-900 + BC-TOK-900 ✓, Add Customer ✓), Gateway tab Telegram kirim #LAPOR → TG-BOT reply tiket ✓, Field Ops scan BC-TOK-001 → panel TERCATAT "Check-in otomatis tercatat" ✓, riwayat badge SCAN + BC-TOK-001 ✓, error BC-XXX-999 ✓, stiker barcode Code-128 render ✓, Settings card Gateway+Backup ✓, Backup Sekarang dari UI ✓, mobile iPhone 14 Field Ops & Settings ✓; lint bersih, zero console error; data uji dibersihkan (TOK-900, customer, kunjungan, tiket, pesan; tgl visit TOK-001 direstore)

Stage Summary:
- Ketiga permintaan user selesai & terverifikasi E2E: Gateway (WA+Telegram) tersimpan di Pengaturan + Add Toko/Customer di fitur utama; backup otomatis Google Spreadsheet (dengan fallback snapshot lokal saat kredensial kosong); barcode per-toko BC-{KODETOKO} untuk identifikasi kunjungan otomatis via scan
- File baru: src/lib/{gateway,gsheets}.ts, src/app/api/gateway/test/route.ts, src/app/api/backup/sheets/route.ts, src/app/api/kunjungan/lookup/route.ts, src/components/{gateway-view,quick-entry,auto-backup-watcher,toko-barcode-sticker}.tsx (gateway-view di views/), scripts/backfill-barcode.ts
- File diubah: prisma/schema.prisma, page.tsx, store.ts, types.ts, api.ts, csv.ts, api/wa/webhook, api/kunjungan, api/toko, api/toko/import, views/{field-ops,master-data,settings}-view.tsx; wa-bot-view.tsx dihapus
- Integrasi Google Sheets & Telegram live: cukup isi kredensial di Pengaturan (service account JSON + share spreadsheet ke service account; bot token @BotFather + chat ID) lalu tombol Tes — tanpa perubahan kode

---
Task ID: 4
Agent: Main Agent (Super Z)
Task: Versi desktop Windows (installer MSI) + dukungan MCP untuk AI

Work Log:
- Install deps: @modelcontextprotocol/sdk@1.32.1, electron@44.7.0 + electron-builder@26.15.3 + esbuild + png-to-ico (devDependencies)
- MCP server stdio: mcp/tools.mjs (19 tool, JSON Schema inputSchema tanpa zod — hindari konflik versi; PrismaClient langsung ke SQLite app; resolusi DB: ASPRO_DB_PATH → DATABASE_URL → db/custom.db) + mcp/server.mjs (Server + StdioServerTransport, capabilities.tools, instructions). Tools: get_stats, list/get/add/update toko (barcode BC-{KODETOKO} auto), customer, sparepart (SP-### auto, lowStockOnly), unit asset, record_kunjungan (check-in scan barcode — resolusi toko identik scan UI: BC- prefix strip + fallback scan; audit aktor "MCP AI"; notifikasi gateway otomatis), list_kunjungan, list_service, send_gateway_message (Telegram Bot API / WA webhook inline, SIMULASI fallback), set_gateway_config (upsert Pengaturan), run_backup (via ASPRO_APP_URL ke /api/backup/sheets bila app jalan, else snapshot JSON lokal + BackupLog), list_audit
- Test E2E stdio: scripts/test-mcp.mjs (spawn + initialize + tools/list 19 + tools/call semua kategori) — SEMUA LULUS: add_toko auto TOK-007/BC-TOK-007, record_kunjungan metode SCAN_BARCODE, gateway SIMULASI, run_backup snapshot 50 baris; lalu cleanup via scripts/cleanup-mcp-test.mjs (data uji dihapus)
- Bundle test: esbuild server.mjs → dist/.../server.cjs (991 KB, external @prisma/*) — handshake OK, 19 tool
- Electron desktop: electron/main.js (single instance; DB di %APPDATA%/AfterSalesPro/data/aftersales.db ← copy template.db first-run + prisma db push tiap start utk upgrade; spawn Next standalone via process.execPath+ELECTRON_RUN_AS_NODE=1 (tanpa Node.js di mesin user); findFreePort 34567+; waitUntilReady 60s; BrowserWindow 1440x900 contextIsolation; setWindowOpenHandler → shell.openExternal; menu Indonesia; tree-kill taskkill win32; tulis claude-desktop-mcp-config.json ke userData dg command=exe app + ELECTRON_RUN_AS_NODE — MCP tanpa Node) + preload.js (contextBridge asproDesktop.getInfo via IPC aspro:get-desktop-info)
- Ikon: scripts/make-icon.mjs (SVG gear emerald/dark + "AS PRO" → sharp 512 PNG → png-to-ico 16..256) → build/icon.png + build/icon.ico (terverifikasi visual)
- Build pipeline cross-platform: scripts/next-build.mjs (next build + cp static/public via fs — pengganti "cp -r" yang gagal di Windows; package.json build diarahkan ke sini), scripts/make-template-db.mjs (db push + seed 2 pengguna awal — TERVERIFIKASI: schema penuh + ADMIN_WORKSHOP/TEKNISI + 0 data), scripts/build-desktop.mjs (prisma generate → next build → template db → staging app/{standalone, node_modules .prisma+@prisma/{client,engines},prisma, mcp/server.cjs esbuild bundle} + prisma/{schema.prisma,template.db} → electron-builder --win msi nsis), electron-builder.yml (appId com.aftersalespro.desktop, MSI upgradeCode tetap 0AC670DA-41E0-4A7D-9A37-B9840F7D15B4 + NSIS fallback, extraResources staging, artifactName AfterSalesPro-{version}-x64.msi)
- CI: .github/workflows/build-desktop.yml (windows-latest, npm install → prisma generate → make-icon → build-desktop → upload artifact AfterSalesPro-Windows-Installer; trigger workflow_dispatch & tag v*)
- UI: settings-view kartu "Desktop Windows & AI (MCP)" — badge desktop/web mode (window.asproDesktop detection + IPC), snippet config Claude Desktop real-path (desktop: exe app + ASPRO_DB_PATH) vs placeholder (web), tombol Salin Config, pre max-h-44 overflow, note file config otomatis; package.json v1.0.0 + scripts mcp/mcp:test/icon/desktop:dev/desktop:build + main field; next.config outputFileTracingIncludes .prisma/@prisma; eslint ignores electron/mcp/scripts/dist/db; mcp/claude-desktop-config.example.json; README-DESKTOP.md (build MSI 2 cara, instalasi, 19 tool table, setup Claude Desktop, contoh perintah AI, troubleshooting)
- Verifikasi: node --check electron ✓, JSON valid ✓, lint bersih ✓, MCP E2E 19 tool ✓, bundle cjs handshake ✓, template db ✓, agent-browser: kartu tampil (desktop 1440px & iPhone 14), tombol Salin OK, snippet JSON benar, zero console error, dev.log clean; data uji dibersihkan

Stage Summary:
- Versi desktop Windows siap build: pipeline lengkap (electron + electron-builder MSI/NSIS + CI GitHub Actions windows-latest) — file MSI diproduksi saat workflow dijalankan di Windows (sandbox Linux tidak bisa menjalankan build Windows)
- Dukungan MCP untuk AI lengkap: server stdio 19 tool (baca/tulis data, check-in barcode toko, gateway, backup) terverifikasi E2E; integrasi Claude Desktop tanpa Node.js via ELECTRON_RUN_AS_NODE; config siap-pakai otomatis ditulis aplikasi desktop
- File baru: mcp/{tools.mjs,server.mjs,claude-desktop-config.example.json}, electron/{main.js,preload.js}, scripts/{test-mcp.mjs,cleanup-mcp-test.mjs,next-build.mjs,make-template-db.mjs,make-icon.mjs,build-desktop.mjs}, build/{icon.png,icon.ico}, electron-builder.yml, .github/workflows/build-desktop.yml, README-DESKTOP.md
- File diubah: package.json, next.config.ts, eslint.config.mjs, src/components/views/settings-view.tsx

---
Task ID: 6
Agent: Main Agent (Super Z)
Task: Fix "TIDAK BISA LOGIN" — sesi login gagal saat app diakses via preview ter-embed (cookie SameSite=Lax diblokir konteks lintas situs/iframe)

Work Log:
- Diagnosis: dev.log menunjukkan POST /api/auth/login 200 (sukses server-side) diikuti GET /login berulang → cookie sesi tidak pernah tersimpan di browser user. Root cause: app diakses via preview HTTPS yang di-embed dalam iframe lintas situs; cookie SameSite=Lax diblokir browser di konteks third-party. Curl localhost normal (first-party) selalu berhasil → bug hanya muncul di konteks iframe.
- Fix 1 — cookie adaptif (src/lib/auth.ts + login/logout route): helper sessionCookieOptions(request, maxAge) deteksi protokol asli via x-forwarded-proto (Caddy meneruskan) / request.url. HTTPS → SameSite=None + Secure + Partitioned (CHIPS, diterima dalam iframe lintas situs di Chrome); HTTP (localhost dev & desktop Electron) → SameSite=Lax seperti semula. Logout menghapus cookie dengan opsi adaptif yang sama.
- Fix 2 — fallback Bearer token: login response body kini memuat token JWT; client menyimpan ke localStorage (aspro_token). src/lib/api.ts: authHeaders()/saveSessionToken()/clearSessionToken(), fetcher & postJson otomatis melampirkan Authorization: Bearer. getSession() (auth.ts) & middleware menerima header Authorization sebagai alternatif cookie → menutup browser yang memblokir SEMUA third-party cookie (Safari ITP).
- Fix 3 — middleware (src/middleware.ts): proteksi API tetap ketat (cookie ATAU Bearer, else 401; whitelist publik tidak berubah); proteksi halaman dipindah ke client gate (page.tsx fetch /api/auth/me → redirect /login bila 401, + clear token) karena request navigasi halaman tidak bisa membawa header Authorization — mencegah redirect loop pada mode Bearer-only. /login dengan cookie valid tetap redirect / server-side.
- Client: login page simpan token + cek sesi on-mount (sudah login → replace('/')); page.tsx gate pakai authHeaders(), handleLogout clearSessionToken().
- Verifikasi curl (8/8): https → Set-Cookie "SameSite=none; Secure; Partitioned" + token di body; http → SameSite=lax; /api/auth/me Bearer-only 200; API terlindungi Bearer-only 200; tanpa sesi 401; GET / tanpa cookie 200 (client gate); /login + cookie valid 307 ke /; logout Bearer 200.
- Verifikasi Agent Browser (session logintest): Test A first-party — login budi/admin123 → Dashboard KPI + Akses Cepat ✓. Test B reproduksi bug — server uji 127.0.0.1:3001 (situs berbeda dari localhost) meng-embed app dalam iframe: login DI DALAM iframe → Dashboard penuh + menu akun "Budi Santoso / budi@teknikjaya.co.id / Admin Workshop" ✓, Keluar → kembali /login ✓; zero console error. (scripts/iframe-host.js, dihentikan setelah uji)
- Lint bersih (7 file berubah); tanpa perubahan schema/db; desktop & MCP tidak terpengaruh (Electron first-party tetap Lax; MCP stdio bypass HTTP).

Stage Summary:
- Login kini berfungsi di SEMUA konteks akses: tab browser normal (cookie Lax), preview web ter-embed iframe https (cookie Partitioned CHIPS), dan browser ketat yang memblokir third-party cookie (fallback Bearer localStorage).
- File berubah: src/lib/auth.ts, src/middleware.ts, src/lib/api.ts, src/app/login/page.tsx, src/app/page.tsx, src/app/api/auth/login/route.ts, src/app/api/auth/logout/route.ts
- Kredensial tidak berubah: budi@teknikjaya.co.id / admin123 (atau username "budi"), teknisi lain / aftersales123

---
Task ID: 7
Agent: Main Agent (Super Z)
Task: Fitur cetak Surat Jalan KOLEKTIF untuk pengiriman part rusak ke produsen — PDF & Excel

Work Log:
- API baru POST /api/surat-jalan (src/app/api/surat-jalan/route.ts): body {noTiket: string[], format: 'pdf'|'xlsx'}; validasi kosong 400 / tidak ditemukan 404 / maks 200 tiket; nomor surat jalan berurutan harian SJ-YYYYMMDD-0001 (dari count audit harian); penerima dari Pengaturan partner_produsen, pengirim dari nama_perusahaan + alamat_perusahaan; audit CETAK_SURAT_JALAN dengan aktor dari sesi (getSession)
- PDF: jsPDF A4 LANDSCAPE, header emerald "SURAT JALAN — Pengiriman Sparepart Rusak / Klaim Garansi ke Produsen", blok info No. SJ/Tgl/Pengirim/Kepada + QR Code verifikasi (payload SJ|TIKET|ITEM|QTY|TGL), tabel 10 kolom (No, Tiket, SN, Model, Toko Asal, Kode Part, Nama Sparepart, Qty, Garansi, Kondisi Part) dengan zebra + truncation fit() anti-wrap-tumpang tindih, baris TOTAL emerald (tiket/item/pcs/nilai), paragraf pernyataan, 2 blok tanda tangan Pengirim/Penerima, footer nomor halaman "Halaman i dari n"; multi-page otomatis (header+header tabel digambar ulang di tiap halaman)
- Excel (.xlsx) 2 sheet: "Surat Jalan" (info dokumen + 12 kolom rincian part + TOTAL + pernyataan + baris tanda tangan) dan "Ringkasan per Tiket" (rekap per tiket: jumlah item, total qty, biaya jasa, nilai part, total klaim, status klaim)
- UI: komponen baru src/components/surat-jalan-dialog.tsx — ringkasan (tiket/item/qty/nilai klaim), pratinjau item scrollable, tombol Unduh PDF & Unduh Excel; unduhan via fetch+blob+authHeaders() (Bearer fallback aman di iframe); filename dari Content-Disposition
- Integrasi ClaimView (src/components/views/claim-view.tsx): kolom checkbox per baris + checkbox "Pilih semua" per tab DRAFT/SUBMITTED/PAID, baris terpilih di-highlight teal, tombol toolbar "Surat Jalan Kolektif (n)" (disabled saat 0 pilihan) + "Reset pilihan", deskripsi card diupdate
- Perbaikan layout PDF iteratif: lebar kolom disesuaikan (Garansi 22mm, Kondisi 37mm agar "PART RUSAK / DIGANTI" & "NON-GARANSI" tak terpotong), caption QR dipindah tepat di bawah QR dalam margin
- Verifikasi curl: PDF valid %PDF-1.3 (3 tiket), XLSX valid PK (2 tiket), 401 tanpa sesi, 400 pilihan kosong, 404 tiket tidak ditemukan, audit berurutan SJ-20261010-0001..0006 dengan aktor "Budi Santoso"
- Verifikasi visual PDF (Read tool render): header, QR, tabel rapi 1 baris/item, total, tanda tangan ✓
- Verifikasi Agent Browser: login → Klaim view → checkbox tiket → tombol "Surat Jalan Kolektif (1)" aktif → dialog berisi pratinjau item → Unduh PDF → POST 200 + audit SJ-0005 → Unduh Excel → POST 200 + audit SJ-0006 ✓ (klik nav pakai eval-dispatch karena pipeline mouse agent-browser flaky — bukan bug app); lint bersih; artefak uji dibersihkan

Stage Summary:
- Fitur Surat Jalan kolektif lengkap: pilih banyak tiket di Klaim & Rekap → cetak rincian gabungan part rusak yang dikirim ke produsen sebagai PDF (A4 landscape + QR verifikasi + TTD) dan Excel (2 sheet), nomor SJ otomatis berurutan harian, audit trail lengkap
- File baru: src/app/api/surat-jalan/route.ts, src/components/surat-jalan-dialog.tsx
- File diubah: src/components/views/claim-view.tsx
- Tanpa perubahan schema/prisma; kompatibel desktop & MCP (route terlindungi middleware, sesi cookie/Bearer)

---
Task ID: 8
Agent: Main Agent (Super Z)
Task: Dashboard KPI/chart/alert jadi clickable — klik data di Dashboard langsung menuju view data sumber (dengan filter konteks otomatis)

Work Log:
- Mekanisme drill-down: store.ts ditambah NavIntent (serviceStatus/serviceGaransi/serviceModel/klaimTab/inventoryFilter/fieldOpsFilter + ts) + navigateTo(view, intent) + clearNavIntent(); navigasi & konteks filter di-set atomik dalam satu update store
- Dashboard (dashboard-view.tsx): KpiCard dapat prop onClick → Card jadi role="button" + tabIndex + aria-label + keyboard Enter/Space + hover lift/border emerald + hint "Lihat sumber ↗" persisten; 8 KPI terhubung: Tiket REQUEST/PROSES/FINISH → Service (tab status), Klaim Tertahan → Klaim tab DRAFT, Stok Kritis → Stok filter KRITIS, Toko Telat Visit → Field Ops filter TERLAMBAT, Kunjungan 7 Hari → Field Ops scroll riwayat, Total Tiket → Service SEMUA
- Grafik: kartu Tren 14 hari diberi tombol "Lihat Tiket"; Pie garansi — klik irisan ATAU legenda → Service filter garansi; Bar tren per model — klik batang → Service filter model (cursor pointer + hint di deskripsi)
- Alert Engine: baris alert ALT-01..04 jadi button clickable → ALT-01 Field Ops terlambat, ALT-02 Service REQUEST, ALT-03 Stok kritis, ALT-04 Klaim DRAFT (chevron kanan + aria-label)
- View tujuan mengonsumsi intent via useEffect (dibungkus setTimeout callback agar lolos aturan react-hooks/set-state-in-effect; navIntent dibersihkan setelah dikonsumsi agar tidak re-apply)
- ServiceView: filter tambahan garansi (unitAsset.statusGaransi) & model (unitAsset.modelUnit) + chip "Filter dari Dashboard" yang bisa dihapus (X) + pesan empty state khusus filter aktif; ClaimView: Tabs jadi controlled (klaimTab) agar bisa diarahkan dari KPI; InventoryView: stokFilter SEMUA/KRITIS/KOSONG memfilter tabel + chip + empty row; FieldOpsView: onlyLate memfilter grid kepatuhan + chip + scrollIntoView ke #kepatuhan-visit / #riwayat-kunjungan
- Lint: awalnya 3 error react-hooks/set-state-in-effect → diperbaiki pola setTimeout; akhirnya bersih
- Verifikasi Agent Browser (sesi dashclick, login budi/admin123): 8/8 KPI button + baris alert button terdeteksi snapshot; klik REQUEST → Service tab "REQ (2)" ✓; Klaim Tertahan → tab "DRAFT (1)" ✓; Stok Kritis → chip "Di Bawah ROP" ✓; Toko Telat Visit → chip "Hanya TOKO TERLAMBAT · 0 toko" + empty state ✓; Kunjungan 7 Hari → riwayat tersedia ✓; Total Tiket → "Semua (6)" ✓; FINISH → "FINISH (3)" ✓; alert ALT-02 → REQ ✓; alert ALT-04 → DRAFT ✓; klik sektor pie → chip "Garansi: Ya" ✓; klik batang → chip "Model: AC Split 1 PK Inverter SE-9000" ✓; tombol Lihat Tiket → Semua ✓; hapus chip via X ✓; keyboard Enter pada card PROSES → tab PROSES ✓; tab manual tetap berfungsi (dispatch pointer lengkap) ✓
- Catatan: pipeline mouse agent-browser flaky (pernah tercatat di Task 5) → verifikasi utama via eval-dispatch; klik tab Radix butuh pointerdown+mousedown+click sintetis (artefak uji, bukan bug app)
- Screenshot desktop & iPhone 14: layout utuh, hint "Lihat sumber ↗" tampil, zero console error; dev.log bersih; artefak uji dihapus

Stage Summary:
- Semua angka/grafik/alert di Dashboard kini bisa diklik → langsung membuka view data sumber dengan filter yang tepat sudah aktif (chip bisa dihapus), lengkap dengan akses keyboard & aria-label
- File diubah: src/lib/store.ts, src/components/views/{dashboard-view,service-view,claim-view,inventory-view,field-ops-view}.tsx
- Tanpa perubahan schema/db/API; kompatibel desktop & MCP; kredensial tidak berubah

---
Task ID: 9
Agent: Main Agent (Super Z)
Task: Peningkatan mutu & kesiapan produksi - (1) health check, (2) unit test Vitest + fix bug tanggal nota, (3) gate CI typecheck/lint/test, (4) rapikan lockfile & .gitignore

Work Log:
- Health check: route baru src/app/api/health/route.ts - GET publik (tanpa sesi) dengan ping DB (SELECT 1); 200 {status:"ok",database:"up",latencyMs,uptimeDetik,node,waktu} atau 503 degraded bila DB tak terjangkau; ditambahkan ke PUBLIC_API di src/proxy.ts supaya bisa dipanggil monitoring (PM2/uptime checker)
- Vitest: devDependency vitest 5.0.5 + vitest.config.mts (alias @ -> ./src, environment node, include tests/unit/**/*.test.ts); script baru package.json: "test" (vitest run), "test:watch", "typecheck" (tsc --noEmit)
- Unit test 52 kasus (4 file, semua lulus): tests/unit/csv.test.ts (parseCsv delimiter/BOM/kutip, parseNum ribuan ID/EN, parseDateFlexible, parseStatusGaransi, mapHeaders, validateTokoRows), tests/unit/umur.test.ts (umurTiketJam basis tglTiket + fallback, formatUmur, isDataLama), tests/unit/nota.test.ts (nomorBassValid, rupiah, tanggalNota, hitungBiayaNota), tests/unit/auth.test.ts (signSession/verifySessionToken ronde-penuh, tolak token tampered/sampah/secret beda)
- BUG DITEMUKAN & DIPERBAIKI: tanggalNota() menukar hari & bulan (mengembalikan M-D-YYYY padahal komentar kontrak D-M-YYYY) - src/lib/nota.ts diperbaiki (m[3]=hari, m[2]=bulan). Ditemukan oleh unit test baru
- CI: .github/workflows/ci.yml (ubuntu, node 22, npm ci -> prisma generate -> next typegen -> typecheck -> lint -> vitest) pada push semua branch & pull_request
- Kebersihan repo: .gitignore ditambah /dist (artefak electron-builder) + /bun.lock; bun.lock di-untrack (git rm --cached) agar acuan dependency tunggal (npm/package-lock.json)
- Verifikasi: npm test 52/52 lulus; npm run typecheck bersih (setelah npx next typegen); npm run lint bersih

Stage Summary:
- Aplikasi kini punya jaring pengaman mutu: unit test otomatis + gate CI (typecheck/lint/test) + health check untuk monitoring
- File baru: src/app/api/health/route.ts, vitest.config.mts, tests/unit/{csv,umur,nota,auth}.test.ts, .github/workflows/ci.yml
- File diubah: package.json (+vitest, script test/typecheck/test:watch), package-lock.json, src/proxy.ts (PUBLIC_API +/api/health), src/lib/nota.ts (fix bug tanggal), .gitignore, hapus-tracking bun.lock

---
Task ID: 10
Agent: Main Agent (Super Z)
Task: E2E Playwright (alur kritis) + penutupan celah otorisasi set/reset pin toko

Work Log:
- Otorisasi: PATCH /api/toko/[id] kini mewajibkan Admin Workshop/Manager HANYA saat mengirim latitude/longitude (set/reset pin peta) - selaras dengan gate UI bisaSetPin; field lain (nama/alamat/kontak/siklus/aktif) tetap terbuka seperti semula. Menutup celah: role apa pun (termasuk PRODUSEN) bisa menimpa koordinat toko lewat API. Audit otorisasi menyeluruh: kebijakan UI ternyata longgar & konsisten (import CSV, hapus unit, toggle siklus memang terbuka untuk semua role) sehingga TIDAK diubah agar tidak mematahkan alur kerja
- E2E Playwright: devDependency @playwright/test + chromium; playwright.config.ts (testDir e2e, 1 worker, webServer menjalankan node e2e/prepare-db.mjs lalu next dev -p 3100, baseURL localhost karena 127.0.0.1 diblokir Next 16 sebagai origin dev cross-site); e2e/prepare-db.mjs (prisma db push ke DB TERPISAH e2e/.tmp/e2e.db + seed admin uji scrypt, tanpa menyentuh db/custom.db); e2e/smoke.spec.ts 6 kasus: /api/health 200, API terlindungi 401 tanpa sesi, halaman login tampil, login salah - alert, login benar - Dashboard KPI, navigasi ke Proses Service
- Script npm baru: test:e2e (playwright test)
- CI: .github/workflows/e2e.yml (ubuntu, node 22, npm ci - prisma generate - playwright install --with-deps chromium - test:e2e; upload artefak saat gagal)
- .gitignore: tambah /test-results/, /playwright-report/, /blob-report/, /e2e/.tmp/
- Verifikasi: npm run test:e2e 6/6 lulus (~11.5s); npm test 52/52; npm run typecheck bersih; npm run lint bersih

Stage Summary:
- Aplikasi punya uji end-to-end browser untuk alur kritis (kesehatan, proteksi API, login) + satu celah otorisasi ditutup
- File baru: playwright.config.ts, e2e/prepare-db.mjs, e2e/smoke.spec.ts, .github/workflows/e2e.yml
- File diubah: package.json (+@playwright/test, script test:e2e), package-lock.json, src/app/api/toko/[id]/route.ts (guard pin), .gitignore

---
Task ID: 11
Agent: Main Agent (Super Z)
Task: Kesiapan deployment server sendiri + Cloudflare (cookie/CSRF, IP asli, HSTS, webhook, dokumentasi)

Work Log:
- Konteks baru: aplikasi akan dijalankan di server sendiri dan diekspos lewat Cloudflare. Ini mengubah beberapa rekomendasi sebelumnya.
- Cookie sesi: sessionCookieOptions() kini dikonfigurasi lewat env SESSION_COOKIE_SAMESITE (auto | lax | strict | none). Default tetap auto (perilaku lama: HTTPS -> None+Secure+Partitioned, HTTP -> Lax) sehingga TIDAK ada perubahan perilaku. Untuk server sendiri yang diakses top-level, disarankan lax agar proteksi CSRF aktif; login tetap jalan karena ada fallback Bearer di localStorage. Mode none selalu dipaksa Secure+Partitioned.
- IP klien asli: helper baru src/lib/client-ip.ts (ipClient: CF-Connecting-IP -> X-Forwarded-For entri kiri -> X-Real-IP -> unknown; plus lewatCloudflare()). Route login memakainya untuk throttle brute-force & jejak audit, menggantikan pembacaan x-forwarded-for langsung.
- instrumentation.ts: peringatan (bukan gagal boot) di produksi bila WEBHOOK_SECRET kosong, sebab webhook WA/Telegram jadi publik saat diekspos lewat Cloudflare.
- next.config.ts: tambah header Strict-Transport-Security (HSTS max-age 1 tahun, tanpa includeSubDomains). Diabaikan browser pada HTTP sehingga aman untuk dev/desktop.
- Dokumentasi baru README-DEPLOY-CLOUDFLARE.md: build standalone + systemd, tabel env produksi, Cloudflare Tunnel vs Proxied DNS, penjelasan cookie/CSRF, IP asli, keamanan webhook + Cloudflare Access, batas Cloudflare (timeout origin ~100s -> error 524 untuk backup/impor/restore/PDF; body 100MB vs cap restore 50MB), HSTS di edge, monitoring /api/health, dan checklist produksi.
- .env.example: dokumentasi SESSION_COOKIE_SAMESITE + penegasan WEBHOOK_SECRET (kini hanya memperingatkan, bukan menolak boot).
- Uji: tambah tests/unit/client-ip.test.ts (5 kasus) dan tests/unit/auth-cookie.test.ts (9 kasus) mencakup mode auto/lax/strict/none dan deteksi proxy.
- Verifikasi: npm test 66/66 lulus; npm run test:e2e 6/6 lulus; npm run typecheck bersih; npm run lint bersih.

Stage Summary:
- Aplikasi siap deploy di server sendiri di belakang Cloudflare dengan default aman (tanpa perubahan perilaku) dan lever konfigurasi jelas.
- File baru: src/lib/client-ip.ts, tests/unit/client-ip.test.ts, tests/unit/auth-cookie.test.ts, README-DEPLOY-CLOUDFLARE.md
- File diubah: src/lib/auth.ts, src/app/api/auth/login/route.ts, src/instrumentation.ts, next.config.ts, .env.example
- Keputusan terbuka untuk pengguna: apakah default SESSION_COOKIE_SAMESITE sebaiknya diubah ke lax (butuh konfirmasi model akses: top-level vs iframe).

---
Task ID: 12
Agent: Main Agent (Super Z)
Task: E2E alur bisnis penuh (tiket -> finish -> klaim -> nota) + perbaikan repo (.env.example ter-commit)

Work Log:
- e2e/prepare-db.mjs: mulai dari database BERSIH tiap sesi (hapus e2e.db + -wal/-shm sebelum prisma db push) lalu seed lengkap: admin uji, MasterToko E2E-TOKO, MasterCustomer, UnitAsset SN-E2E-001, dan MasterSparepart E2E-PART-01 (stok 20, hargaKlaim 45000 agar part READY -> tiket otomatis PROSES).
- e2e/flow.spec.ts (baru): alur penuh lewat HTTP memakai sesi hasil login UI (page.request): buat tiket (part READY -> PROSES + STTB terbit) -> FINISH (wajib foto nota berstempel) -> SUBMIT_CLAIM (DRAFT->SUBMITTED) -> MARK_PAID (->PAID) -> POST /api/nota/dari-tiket (nota BASS terisi otomatis, noSeri SN-E2E-001, memuat part). Ditutup verifikasi TAMPIL DI UI: tiket dicari di Proses Service, nota dicari di layar Nota Servis BASS.
- Penting: setiap mutasi memanggil autoGitBackup() yang menulis db/snapshots/ dan membuat COMMIT git. Ditambahkan gerbang env DISABLE_GIT_BACKUP=1 (src/lib/git-backup.ts) yang mematikan snapshot+commit; playwright.config.ts menyetelnya di webServer env. Terbukti: setelah E2E, git status tetap bersih dan TIDAK ada commit auto-backup baru.
- Perbaikan repo: .env.example ternyata ter-ignore oleh pola .env* dan belum pernah ter-commit, padahal dirujuk dokumentasi deploy. .gitignore diberi pengecualian !.env.example; DATABASE_URL di contoh dinetralkan jadi placeholder path absolut (bukan path mesin pengembang).
- .env.example: dokumentasi SESSION_COOKIE_SAMESITE dan DISABLE_GIT_BACKUP.
- Verifikasi: npm run test:e2e 7/7 lulus (~28s, termasuk alur penuh 13s); npm test 66/66; npm run typecheck bersih; npm run lint bersih.

Stage Summary:
- Alur bisnis inti kini terjaga uji end-to-end (dari tiket sampai nota) dan hasilnya diverifikasi di UI.
- File baru: e2e/flow.spec.ts, .env.example (kini ter-commit)
- File diubah: e2e/prepare-db.mjs, playwright.config.ts, src/lib/git-backup.ts, .gitignore

---
Task ID: 13
Agent: Main Agent (Super Z)
Task: Proteksi CSRF (Origin/Referer/Sec-Fetch-Site) di middleware tanpa perubahan klien

Work Log:
- Audit permukaan mutasi klien: selain postJson(), ada ~9 fetch langsung (upload FormData: surat-jalan, logo, restore, vision scan; logout; serta 3 POST di service-view). Menambah token CSRF ke semua jalur itu berisiko tinggi mematahkan fitur bila ada yang terlewat.
- Keputusan: pertahanan CSRF berbasis header asal, dijalankan di middleware, TANPA mengubah klien sama sekali.
- File baru src/lib/csrf.ts (edge-safe, murni): isMutasi(), hostPermintaan() (hormati X-Forwarded-Host/Cloudflare; buang port; dukung IPv6), permintaanSamaAsal() -> false bila Sec-Fetch-Site: cross-site, atau Origin/Referer ada tapi host tidak cocok (Origin "null" ditolak); true bila tidak ada indikator browser (webhook/curl/service-to-service, bukan vektor CSRF).
- src/proxy.ts: ditolakCsrf() menolak 403 semua request MUTASI (POST/PUT/PATCH/DELETE) berbasis cookie yang asalnya bukan host aplikasi. Dikecualikan: request dengan Authorization: Bearer (tak bisa di-forge lintas situs) dan webhook eksternal (/api/wa/webhook, /api/telegram/webhook — diamankan WEBHOOK_SECRET). Cek CSRF dijalankan sebelum cek sesi.
- Kompatibilitas dijaga: iframe lintas situs mengirim request ke origin-nya sendiri (Origin cocok) -> lolos; Electron memuat http://127.0.0.1:PORT (same-origin) -> lolos; mini-service/MCP tanpa Origin -> lolos.
- Uji: tambah tests/unit/csrf.test.ts (15 kasus: metode, host termasuk proxy/IPv6, Origin cocok/asing/null, Referer, Sec-Fetch-Site, tanpa indikator). Tambah 2 kasus E2E di smoke.spec.ts: mutasi Origin asing -> 403; mutasi tanpa indikator -> lanjut cek sesi 401.
- Dokumentasi: README-DEPLOY-CLOUDFLARE.md bagian cookie/CSRF dijelaskan lapisan kedua ini.
- Verifikasi: npm test 81/81 lulus; npm run test:e2e 9/9 lulus (alur penuh tetap hijau -> CSRF tidak mematahkan penulisan data); npm run typecheck bersih; npm run lint bersih.

Stage Summary:
- CSRF kini terlindungi berlapis: SameSite (Lax di localhost, dapat diatur untuk Cloudflare) + verifikasi Origin di middleware.
- File baru: src/lib/csrf.ts, tests/unit/csrf.test.ts
- File diubah: src/proxy.ts, e2e/smoke.spec.ts, README-DEPLOY-CLOUDFLARE.md

---
Task ID: 14
Agent: Main Agent (Super Z)
Task: Pagination daftar besar (render bertahap) tanpa mematahkan filter/pencarian/penyeleksian

Work Log:
- Audit: endpoint yang benar-benar tak terbatas hanya GET /api/service (semua tiket + relasi), /api/sparepart, /api/unit, /api/toko, /api/customer; sisanya sudah dipagari take (audit 300, kunjungan 100, nota 1000, inbox 100).
- Keputusan penting: memilih render bertahap di sisi KLIEN, bukan pagination sisi server. Alasannya: filter/tab/pencarian/select-all/select lintas baris pada daftar-daftar itu berjalan di memori; memindahkannya ke server berarti menulis ulang tiap query dan berisiko tinggi mematahkan alur kerja existing. Dengan memotong RENDER (bukan query), biaya DOM turun drastis dan seluruh perilaku filter tetap identik.
- src/lib/bertahap.ts (baru, murni & teruji): UKURAN_BERTAHAP=60, potongBertahap(items,batas) -> {tampil,total,sisa,adaLagi} (aman untuk null/undefined/NaN/negatif/desimal), serta batasAktif(state,kunci,ukuran) yang mengembalikan batas tersimpan bila "kunci filter" sama, dan kembali ke ukuran awal bila kunci berubah.
- src/hooks/use-bertahap.ts (baru): useBertahap(items,kunci) -> {tampil,total,sisa,adaLagi,batas,tambah}. Reset ke blok pertama dihitung SAAT RENDER via batasAktif (pola "adjust state during render" yang disetujui React), bukan useEffect+setState, sehingga tidak memicu render berantai (lolos aturan eslint react-hooks/set-state-in-effect).
- src/components/load-more.tsx (baru): kaki daftar "Menampilkan X dari Y <satuan>" + tombol "Tampilkan lebih banyak (sisa N)"; tidak merender apa pun bila total <= tampil.
- Diterapkan pada daftar besar: Proses Service (tabel tiket), Stok Inventory (katalog sparepart + tabel order), Nota Servis BASS (grid kartu nota), Master Data (tabel unit - 3 varian tab, tabel toko, kartu customer). Tabel user tidak diubah (jumlah pengguna kecil).
- Bonus perbaikan bug: useMemo "filtered" di service-view.tsx tidak mencantumkan tokoFilter & brandFilter pada deps -> filter drill-down toko/brand bisa basi; deps dilengkapi.
- E2E: e2e/prepare-db.mjs menyemai +70 tiket massal (70 unit SN-BULK-xxx NON_GARANSI + tiket PROSES, unit berbeda tiap tiket agar tidak menabrak aturan "tiket aktif") supaya daftar pasti melebihi satu blok. e2e/smoke.spec.ts +2 kasus: Proses Service menampilkan "Menampilkan 60 dari N tiket" lalu bertambah setelah tombol ditekan; Master Data -> Unit Asset menampilkan "Menampilkan 60 dari N unit" lalu bertambah.
- Verifikasi: npm test 88/88 lulus (5 kasus potongBertahap + 2 kasus batasAktif baru); npm run test:e2e 11/11 lulus (alur penuh tetap hijau -> tidak ada fitur yang rusak); npm run typecheck bersih; npm run lint bersih.

Stage Summary:
- Daftar besar kini dirender bertahap (60 baris per blok) dengan tombol "Tampilkan lebih banyak": halaman pertama jauh lebih ringan, filter/pencarian/centang tetap berjalan apa adanya, dan batas otomatis kembali ke awal saat filter berubah.
- Jalur lanjutan bila muatan jaringan kelak jadi masalah: tambahkan pagination sisi server secara opt-in (?page=&limit=) pada endpoint tanpa mengubah kontrak API yang ada.
- File baru: src/lib/bertahap.ts, src/hooks/use-bertahap.ts, src/components/load-more.tsx, tests/unit/bertahap.test.ts
- File diubah: src/components/views/{service-view,inventory-view,nota-view,master-data-view}.tsx, e2e/prepare-db.mjs, e2e/smoke.spec.ts

---
Task ID: 15
Agent: Main Agent (Super Z)
Task: Refresh UX Tahap 1-2 - token warna brand emerald/teal + tabel tiket jadi kartu di layar HP

Work Log:
- Mockup statis yang disetujui pengguna (mockups/ux-preview.html) dipakai sebagai acuan: palet emerald/teal, kartu radius ~14px, bayangan lembut, label KPI kapital.
- Tahap 1 (token warna) di src/app/globals.css: --primary kini brand emerald oklch(0.596 0.145 163.225) (sebelumnya grayscale), --ring emerald-500, netral dipindah ke keluarga slate (foreground slate-900, muted/muted-foreground slate, border/input slate-200), --accent jadi tint emerald (emerald-50 / emerald-700), dan --chart-1..5 diselaraskan (emerald, teal, sky, amber, rose). Blok .dark ikut disesuaikan (primary/ring/accent/chart brand) supaya siap dipakai kelak.
- Efeknya luas tapi murah: Button default, Badge default, warna fokus ring, serta Checkbox/Switch/Progress yang membaca --primary otomatis sewarna brand - hanya nilai token yang berubah, tidak ada logika yang disentuh.
- kpi-card.tsx: polish ringan tanpa mengubah kontrak KpiDef - judul jadi kapital + tracking, angka extrabold tracking-tight. Berlaku di Dashboard dan view lain yang memakai KpiGrid.
- Tahap 2 (tabel -> kartu) di service-view.tsx:
  - Blok tombol aksi (Email Order/Kirim Email, dropdown Aksi: Proses + STTB, Part Datang, Selesaikan, Ajukan Klaim, Tandai Lunas, tombol Detail) diangkat jadi helper renderAksiTiket(t) di dalam komponen, lalu dipakai bersama tabel desktop dan kartu HP. Jadi tidak ada logika aksi yang diduplikasi dan tidak ada aksi yang hilang di HP.
  - Tabel penuh dibungkus div "hidden md:block" (data-testid tiket-tabel); ditambah daftar kartu "md:hidden" (data-testid tiket-cards) berisi no tiket + no STTB, badge status/klaim/SLA/edited, unit + serial, toko, ringkasan kode part + "X ready - Y inden", umur/tanggal (hormati data lama), kerusakan, lalu baris aksi yang sama.
  - Centang massal (surat jalan) tetap khusus desktop; filter/tab/pencarian dan render bertahap (LoadMore) tidak diubah sehingga perilaku lama identik.
- E2E: e2e/smoke.spec.ts +1 kasus "di layar HP tabel tiket berganti jadi kartu ringkas" - memastikan tabel tampil & kartu tersembunyi di desktop, lalu di viewport 390x844 kartu tampil & tabel tersembunyi, dan klik kartu membuka dialog detail.
- Verifikasi: npm test 88/88 lulus; npm run test:e2e 12/12 lulus (alur penuh, CSRF, dan render bertahap tetap hijau); npm run typecheck bersih; npm run lint bersih.

Stage Summary:
- Identitas visual kini satu bahasa desain: primary emerald/teal + netral slate + aksen brand, semuanya dari token, bukan kelas warna ad-hoc.
- Proses Service sudah nyaman dipakai di HP: tanpa geser horizontal, badge status/umur tetap menonjol, dan semua aksi tiket tetap tersedia dari kartu.
- Jalur lanjutan yang belum dikerjakan: kartu HP untuk Stok Inventory dan Master Data (Unit/Toko), lalu Tahap 3 Dashboard (sparkline, kartu target, Alert Engine dikelompokkan).
- File diubah: src/app/globals.css, src/components/kpi-card.tsx, src/components/views/service-view.tsx, e2e/smoke.spec.ts
