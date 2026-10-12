# Product Requirement Document (PRD)

## Systems Automation for After-Sales Operations & Inventory Management

---

## 1. Executive Summary & Context

### 1.1 Project Context
Sistem ini dirancang untuk mengotomatisasi operasional layanan *after-sales* hasil kerja sama antara penyedia jasa teknis/workshop dengan produsen. Fokus utama sistem adalah mempercepat alur kerja laporan barang rusak, pemantauan kunjungan toko, penelusuran unit berbasis barcode, pengelolaan stok sparepart titipan (konsinyasi), serta rekapitulasi klaim pembayaran secara akurat.

### 1.2 Key Objectives
1. **Otomasi Laporan & Komunikasi:** Integrasi WhatsApp Bot untuk menangkap laporan foto unit rusak dari toko/teknisi, memverifikasi ketersediaan sparepart, dan membuat tiket service secara otomatis.
2. **Visibilitas Field Operations:** Pelacakan kunjungan toko secara *real-time* menggunakan mekanisme scan barcode/QR code *onsite*.
3. **Traceability Unit & Garansi:** Pencatatan nomor seri, model unit, dan status garansi (*Garansi* vs *Non-Garansi*) yang terhubung ke database terpusat.
4. **Efisiensi Klaim Pembayaran:** Pembuatan Surat Tanda Terima Barang (STTB) otomatis serta ekspor rekap data klaim ke format Microsoft Excel (`.xlsx`) untuk dikirimkan ke produsen.
5. **Indikator Peringatan Dini (Alerts):** Notifikasi otomatis untuk SLA yang terlewati, toko yang terlambat dikunjungi, dan stok minimum sparepart.

---

## 2. User Roles & Access Matrix

| Role | Responsibility & Access Scope |
| :--- | :--- |
| **Teknisi Lapangan / Field Staff** | Mobile Web Access: Melakukan kunjungan toko, scan barcode unit, mengunggah foto laporan kerusakan onsite, melakukan pengambilan/pengembalian unit dengan STTB. |
| **Admin Workshop** | Web Dashboard Access: Memverifikasi *request service* dari WhatsApp, mengelola pembongkaran/pemasangan sparepart, mencetak STTB, mengunggah nota berstempel, dan melakukan klaim bulanan ke produsen. |
| **Managerial / Management** | Web Dashboard Access: Memantau indikator kinerja (SLA), grafik status service, kepatuhan jadwal kunjungan toko, serta visibilitas stok sparepart. |
| **Produsen / Manufacturer (Read-Only/Approval)** | Notification & Report Access: Menerima notifikasi otomatis permintaan sparepart via WhatsApp, melihat laporan klaim mingguan/bulanan. |

---

## 3. High-Level System Architecture & Workflow

### 3.1 Diagram Arsitektur
```
 [Toko / Teknisi] ---> (Kirim Foto & Deskripsi via WA Group)
                             |
                             v
              [WhatsApp Gateway / Webhook Engine]
                             |
                             v
               [Backend System & Database]
             /               |               \
            v                v                v
   [Cek Stok Sparepart] [Generate STTB] [Serial Number Lookup]
            \                |                /
             v               v               v
               [Dashboard & Cron Alerts Engine]
```

### 3.2 End-to-End Operational Workflow
1. **Laporan & Identifikasi Kerusakan:** Toko/teknisi mengunggah foto kerusakan ke WA Group Produsen dengan format tertentu. Bot membaca pesan, mengidentifikasi model & nomor seri, serta mengecek garansi.
2. **Pengecekan Kode & Stok Sparepart:** Sistem memeriksa ketersediaan part di database konsinyasi. 
   - Jika **Ready**: Stok dikunci (*reserved*), tiket service dibuat dengan status `PROSES`, dan link dokumen STTB (PDF) diterbitkan otomatis.
   - Jika **Kosong**: Sistem mengirim notifikasi permintaan sparepart ke pihak produsen.
3. **Penarikan Unit ke Workshop:** Teknisi membawa unit ke workshop menggunakan STTB berbasis QR Code.
4. **Perbaikan & Pengiriman Part Rusak:** Sparepart lama dilepas untuk dikembalikan ke produsen, part baru dipasang ke unit.
5. **Pengembalian Unit & Klaim:** Unit dikembalikan ke toko. Teknisi meminta stempel toko pada nota service, mengunggah buktinya ke sistem.
6. **Proses Claim Payment:** Admin melakukan rekap klaim bulanan. Sistem men-generate file Excel otomatis untuk penagihan biaya jasa/part ke produsen.

---

## 4. Functional Specifications

### Modul 1: Master Data Management
* **1.1 Master Store & Customer**
  * Pencatatan profil toko (Nama, Alamat, Kontak, Frekuensi Kunjungan Rutin).
  * Pengelompokan status unit: **Garansi** vs **Non-Garansi**.
* **1.2 Master Barcode / Unit Asset**
  * Modul cetak stiker Barcode/QR Code unik. Format: `SN:[serial_number]|MOD:[model_unit]|TOK:[kode_toko]`.
  * Integrasi pemindai barcode kamera pada perangkat seluler teknisi.
* **1.3 Master Employee & User Management**
  * Manajemen peran pengelola (Admin, Teknisi, Manager).
  * Pemetaan wilayah kerja teknisi ke toko tertentu.

### Modul 2: Service Management Engine
* **2.1 Request Service:** Integrasi WA Bot untuk pembacaan foto & teks laporan kerusakan, otomatisasi nomor tiket.
* **2.2 Process Service:** Pembuatan Surat Tanda Terima Barang (STTB) PDF, manajemen penarikan unit, tracking part rusak ke produsen.
* **2.3 Finish Service:** Konfirmasi pengembalian unit, unggah foto nota service berstempel toko, tanda tangan digital/bukti fisik.

### Modul 3: Consignment Inventory (Spareparts)
* **3.1 Sparepart Stock Control:** Pencatatan stok sparepart titipan produsen, *reserve stock* otomatis saat tiket service terbuat.
* **3.2 Reorder Point Alert:** Peringatan otomatis saat stok sparepart berada di bawah ambang batas minimum.

### Modul 4: Claim Service & Reporting
* **4.1 Claim Verification:** Verifikasi tiket service `FINISH` yang sudah dilengkapi bukti stempel toko.
* **4.2 Excel Export Engine:** Ekspor batch data klaim ke format `.xlsx` sesuai templat standar produsen.

### Modul 5: Dashboard & Automated Alert System
* **5.1 KPI Dashboard:** Ringkasan jumlah tiket aktif (`REQUEST`, `PROSES`, `FINISH`), total klaim pending, dan grafik tren kerusakan per model.
* **5.2 System Alert Engine:** Notifikasi harian via WhatsApp/Dashboard untuk SLA terlambat dan toko yang terlambat dikunjungi.

### Modul 6: System Settings & Security
* Profile Perusahaan, *Audit Activity Logs* (pencatatan setiap perubahan status data), serta fungsi *Backup & Restore Database* harian.

---

## 5. Database Schema (Relational SQL Data Model)

```sql
-- 1. Master Store Table
CREATE TABLE master_toko (
    id INT PRIMARY KEY AUTO_INCREMENT,
    kode_toko VARCHAR(50) UNIQUE NOT NULL,
    nama_toko VARCHAR(150) NOT NULL,
    alamat TEXT,
    frekuensi_visit INT DEFAULT 14, -- Siklus kunjungan dalam hari
    tgl_visit_terakhir DATETIME,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. Master Customer Table
CREATE TABLE master_customer (
    id INT PRIMARY KEY AUTO_INCREMENT,
    nama VARCHAR(150) NOT NULL,
    no_wa VARCHAR(20),
    alamat TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. Master Sparepart Table
CREATE TABLE master_sparepart (
    id INT PRIMARY KEY AUTO_INCREMENT,
    kode_part VARCHAR(50) UNIQUE NOT NULL,
    nama_part VARCHAR(150) NOT NULL,
    stok_konsinyasi INT DEFAULT 0,
    reorder_limit INT DEFAULT 5,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 4. Unit Asset / Barcode Table
CREATE TABLE unit_asset (
    id INT PRIMARY KEY AUTO_INCREMENT,
    serial_number VARCHAR(100) UNIQUE NOT NULL,
    model_unit VARCHAR(100) NOT NULL,
    toko_id INT,
    customer_id INT,
    status_garansi ENUM('GARANSI', 'NON_GARANSI') NOT NULL,
    tgl_pembelian DATE,
    FOREIGN KEY (toko_id) REFERENCES master_toko(id),
    FOREIGN KEY (customer_id) REFERENCES master_customer(id)
);

-- 5. Onsite Store Visit Table
CREATE TABLE kunjungan (
    id INT PRIMARY KEY AUTO_INCREMENT,
    toko_id INT NOT NULL,
    teknisi_id INT NOT NULL,
    tgl_kunjungan DATETIME DEFAULT CURRENT_TIMESTAMP,
    foto_onsite VARCHAR(255),
    catatan_stok_rusak TEXT,
    FOREIGN KEY (toko_id) REFERENCES master_toko(id)
);

-- 6. Service Request Main Table
CREATE TABLE service_request (
    id INT PRIMARY KEY AUTO_INCREMENT,
    no_tiket VARCHAR(50) UNIQUE NOT NULL,
    unit_asset_id INT NOT NULL,
    status ENUM('REQUEST', 'PROSES', 'FINISH') DEFAULT 'REQUEST',
    no_sttb VARCHAR(50),
    foto_kerusakan_wa VARCHAR(255),
    foto_nota_stempel VARCHAR(255),
    status_klaim_produsen ENUM('DRAFT', 'SUBMITTED', 'PAID') DEFAULT 'DRAFT',
    tgl_klaim DATETIME,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (unit_asset_id) REFERENCES unit_asset(id)
);

-- 7. Service Request Sparepart Junction Table
CREATE TABLE service_request_part (
    id INT PRIMARY KEY AUTO_INCREMENT,
    service_request_id INT NOT NULL,
    sparepart_id INT NOT NULL,
    qty INT DEFAULT 1,
    status_part ENUM('READY', 'ORDER_PRODUSEN') DEFAULT 'READY',
    FOREIGN KEY (service_request_id) REFERENCES service_request(id),
    FOREIGN KEY (sparepart_id) REFERENCES master_sparepart(id)
);
```

---

## 6. Technical Specifications: WhatsApp Bot Integration

### 6.1 Interactive Command Standard
Laporan dilaporkan ke WA Group Produsen menggunakan format terstruktur:
`#LAPOR [Nomor_Seri] [Kode_Sparepart] [Deskripsi_Kerusakan]` *(dilengkapi dengan melampirkan foto unit/part)*

### 6.2 WhatsApp Bot Processing Rules
1. **Penerimaan Pesan:** Webhook WA Gateway mengirim data *payload* (teks & gambar) ke Backend Server.
2. **Serial & Warranty Check:** Sistem mencari `serial_number` pada tabel `unit_asset`. Menentukan status garansi dan lokasi toko asal.
3. **Pengecekan Stok Part:**
   - **Jika Part Available (`stok_konsinyasi` > 0):**
     * Kurangi stok dan catat pada `service_request_part`.
     * Buat draft STTB (PDF) dengan QR Code unik.
     * Balas di WA Group: *"Tiket #[No_Tiket] Berhasil Terbuat. Part READY. Link STTB: [URL_STTB]"*
   - **Jika Part Out of Stock:**
     * Ubah status part ke `ORDER_PRODUSEN`.
     * Balas di WA Group: *"Tiket #[No_Tiket] Terbuat. Part KOSONG. Menunggu pengiriman sparepart dari produsen."*

---

## 7. Dashboard Alerts & Cron Job Business Rules

Sistem menjalankan proses *background job* berkala untuk mendeteksi kondisi abnormal:

| Kode Rule | Nama Indikator | Trigger Condition | Otomasi Aksi Sistem |
| :--- | :--- | :--- | :--- |
| **ALT-01** | Toko Melewati Jadwal Kunjungan | `TODAY() - tgl_visit_terakhir > frekuensi_visit` | Mengirimkan pesan ringkasan harian via WA ke Manager berisi daftar toko yang terlambat dikunjungi. |
| **ALT-02** | SLA Sparepart Pending | Status `REQUEST` > 24 jam tanpa konfirmasi ketersediaan part | Menandai tiket dengan *flag* Merah di Dashboard dan mengirim reminder otomatis ke kontak Produsen. |
| **ALT-03** | Low Stock Sparepart (ROP) | `stok_konsinyasi <= reorder_limit` | Menampilkan indikator stok kritis di Dashboard dan men-generate draft formulir Re-Order Sparepart. |
| **ALT-04** | Potential Unclaimed Revenue | Status `FINISH` > 7 hari tetapi status klaim masih `DRAFT` | Menampilkan widget total estimasi dana klaim yang tertahan pada Dashboard Admin Workshop. |

---

## 8. Non-Functional Requirements

1. **Performansi:** Respon WA Bot dalam membalas laporan pesan < 5 detik.
2. **Reliabilitas:** Sistem *automatic daily database backup* ke cloud storage.
3. **Kompatibilitas Tampilan:** Aplikasi Web bersifat *Mobile Responsive* agar mudah diakses teknisi menggunakan ponsel di lapangan.
4. **Keamanan:** Menerapkan HTTPS, otentikasi token API untuk WA Gateway, serta enkripsi kata sandi pengguna.