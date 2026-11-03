# Alur Part Bergelombang — Satu Unit, Satu Tiket

> Pertanyaan yang dijawab dokumen ini: **"Part pertama sudah datang, tapi ternyata
> ada bagian lain yang rusak (mis. top plate sudah datang, rear plate baru ketahuan
> rusak). Harus bikin tiket baru atau tidak?"**
>
> **Tidak.** Satu unit = satu tiket untuk seluruh siklus servisnya. Part tambahan
> dipesan di tiket yang sama, dan tiket baru boleh FINISH setelah **semua** part
> datang (READY) dan dipasang.

---

## 1. Aturan inti

| Kejadian | Yang benar | Yang salah |
|---|---|---|
| Part gelombang 1 datang | Tandai **Part Baru Diterima** → pasang | Langsung **Selesaikan (FINISH)** |
| Ketahuan bagian lain rusak | **Tambah sparepart** di tiket yang sama | Bikin tiket baru untuk unit yang sama |
| Part gelombang 2 datang | **Part Baru Diterima** lagi → pasang | Menunggu tanpa mencatat |
| Semua part sudah READY & terpasang | Baru **Selesaikan (FINISH)** | — |

Alasannya: klaim ke produsen diajukan **sekali per tiket** dan memuat semua part +
jasa. Kalau dipecah ke tiket baru, unit yang sama punya dua nomor tiket, statistik
pemakaian part terbelah, dan surat jalan/STTB jadi ganda.

---

## 2. Langkah kerja (tiket masih PROSES)

1. Buka **Proses Service** → pilih tiket unit.
2. Panel **Tambah sparepart** → pilih dari katalog atau tulis kode + nama baru
   (kode baru otomatis masuk katalog). Qty sesuai kebutuhan.
3. Simpan. Bila stok brand tidak cukup, baris otomatis berstatus
   **ORDER_PRODUSEN** (order ke produsen) — bukan error.
4. Kirim order ke produsen lewat **Email Order** / **WA Order** (atau surat jalan
   bila alurnya manual).
5. Saat part tiba: tombol **Part Baru Diterima (N)** → status part jadi READY.
6. Pasang part, lalu **Selesaikan** (nota stempel + TTD; nota boleh menyusul).
7. Klaim produsen diajukan **sekali** setelah FINISH, memuat seluruh part.

> Bila part susulan ternyata **tidak jadi dipakai** (produsen tidak punya, unit
> sudah normal), hapus barisnya lewat **Hapus Part** — baris yang sudah terpasang
> tidak bisa dihapus (koreksi qty saja).

---

## 3. Kalau sudah terlanjur FINISH

Jangan buat tiket baru. Gunakan **Buka Ulang ke Proses** (Admin Workshop/Manager):

1. Kartu tiket FINISH → panel ungu **"Ada bagian lain yang rusak temuan setelah
   pemasangan?"** → **Buka Ulang ke Proses** (isi alasan; tercatat di Audit Log).
2. Status kembali **PROSES**, tanggal selesai dibatalkan, tiket ditandai *(edited)*.
3. Tambah part, order, tunggu datang, pasang.
4. **Selesaikan** lagi. Klaim tetap satu kali dan memuat semua part.

Bila klaim sudah **SUBMITTED/PAID**, tiket tidak bisa dibuka ulang — part tambahan
dicatat lewat **koreksi part** (tertanda *(edited)*) agar jejaknya tetap ada.

---

## 4. Penjagaan di sistem (sejak perubahan ini)

- **FINISH ditolak** (`409`) selama masih ada baris part `ORDER_PRODUSEN` dengan
  qty > 0. Pesan menyebut kode/nama part yang ditunggu + pilihan tindakan
  (tambah part / hapus baris / tunggu datang).
- Tombol **Selesaikan** di menu Aksi dinonaktifkan selama masih menunggu part,
  dengan tooltip berisi daftar part.
- Kartu tiket PROSES menampilkan kotak kuning **"Masih menunggu N part — jangan
  Selesaikan dulu"** beserta daftar partnya.
- Chip alur surat jalan kembali ke **"Bekas terkirim" / "SJ dibuat" / "Belum
  dibuatkan SJ"** saat ada pesanan susulan — tidak lagi menampilkan
  **"Part datang"** yang menyesatkan.
- Logika bersama: `src/lib/part-tunggu.ts` (dipakai API + UI, ada unit test).

---

## 5. Ringkas untuk teknisi

> Part datang ≠ pekerjaan selesai.
> Part datang = **pasang part itu**, lalu cek lagi unitnya.
> Masih ada yang rusak? **Tambah part di tiket yang sama.**
> Selesaikan hanya kalau **semua** part sudah datang dan terpasang.
