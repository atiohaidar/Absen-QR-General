# ⚡ EventPass • QR Code Attendance & Check-In Blueprint

Blueprint sistem presensi dan registrasi event berbasis **Google Form + Google Drive + Google Sheets + GitHub Pages Scanner**. 

Dirancang sebagai **reusable boilerplate / template** yang sangat modular, 100% serverless, zero hosting cost, dan anti-quota limit.

---

## 🎯 Architecture & Workflow

```
[Peserta Isi Google Form]
         │ (Submit: Nama & Email)
         ▼
[Google Spreadsheet] ──(Trigger: onFormSubmit)──┐
                                                 ▼
                              [1. Auto-detect Folder Google Form]
                                                 │
                              [2. Auto-create Subfolder 'QR Code Peserta']
                                                 │
                              [3. Generate Unique Ticket ID & QR Image]
                                                 │
                              [4. Save QR ke Folder Drive]
                                                 │
                              [5. DriveApp.getFileById().addViewer(email)]
                                 (Tanpa kuota email! Muncul di Drive peserta)
                                                 │
                              [6. Log Data ke Google Sheet]
                                                 │
┌────────────────────────────────────────────────┘
│
│ (Hari H Event)
▼
[Panitia Scanner di HP / Laptop] (Hosted on GitHub Pages)
         │
         │ Scan QR Code Kamera (html5-qrcode)
         ▼
[Fast POST Request ke Apps Script Web App]
         ├── 1. In-Memory Search (<2ms)
         ├── 2. Concurrency Lock (LockService - Anti Race Condition)
         ├── 3. Validasi: Belum Masuk / Sudah Pernah Masuk (Anti-Double Scan)
         └── 4. Update Status: CHECKED_IN, Timestamp, & Nama Panitia
         │
         ▼
[Instant Visual & Synthesized Audio Feedback]
  • ✅ HIJAU: Check-In Berhasil (Audio chord C5-E5 + Vibrate)
  • ⚠️ KUNING: Sudah Pernah Di-scan (Peringatan tiket duplikat)
  • ❌ MERAH: Tiket Tidak Dikenal
```

---

## 📁 Struktur Project

```text
absen qr/
├── index.html              # Frontend UI Scanner (GitHub Pages Ready)
├── css/
│   └── style.css           # Modern Dark-mode Glassmorphism Styling
├── js/
│   └── app.js              # Camera Scanner, Web Audio Synth, LocalStorage
├── backend/
│   ├── Code.gs             # Google Apps Script (onFormSubmit + Web API)
│   └── appsscript.json     # Manifest Apps Script (Timezone & Minimal Scopes)
├── constrain.md            # Constraint catatan teknis
└── README.md               # Dokumentasi lengkap setup
```

---

## 🚀 Panduan Setup (Hanya 5 Menit!)

### Bagian 1: Setup Google Form & Google Sheet

1. Buat **Google Form** baru dengan pertanyaan standar:
   - `Nama Lengkap` (Short answer, Required)
   - `Email` (Short answer, Required)
2. Buka tab **Responses** di Google Form, lalu klik icon hijau **Link to Sheets** (Create spreadsheet baru).
3. Di Google Spreadsheet yang terbuka, klik menu:
   👉 **Extensions** → **Apps Script**.

---

### Bagian 2: Pasang Script Backend

1. Di editor Apps Script:
   - Hapus semua isi file `Code.gs` default, lalu copy-paste isi file [`backend/Code.gs`](backend/Code.gs).
   - *(Opsional)* Aktifkan manifest di menu **Project Settings** (icon gerigi) → centang **Show "appsscript.json" manifest file in editor**, lalu ganti isinya dengan [`backend/appsscript.json`](backend/appsscript.json).
2. Sesuaikan konfigurasi nama event pada baris 25 di `Code.gs`:
   ```javascript
   const CONFIG = {
     EVENT_NAME: "Nama Event Kamu 2026",
     QR_SUBFOLDER_NAME: "QR Code Peserta",
     ...
   };
   ```
3. Klik tombol **Save** (icon disket).
4. Di dropdown fungsi bagian atas, pilih fungsi `testSetup` lalu klik **Run**:
   - Google akan meminta konfirmasi izin akses (Drive & Spreadsheet). Klik **Review permissions** → pilih akun Google Anda → **Advanced** → **Go to (unsafe)** → **Allow**.
   - Fungsi ini akan otomatis menambahkan header kolom baru: `Ticket ID`, `Drive File ID`, `Drive File URL`, `Status Kehadiran`, `Waktu Check-In`, `Petugas / Panitia`, dan `Gate / Pos`.

---

### Bagian 3: Pasang Trigger Otomatis (onFormSubmit)

Agar setiap ada pendaftar baru tiketnya langsung dibuat dan di-share ke Google Drive:
1. Di sidebar kiri Apps Script, klik menu **Triggers** (icon jam / alarm).
2. Klik tombol **+ Add Trigger** (di pojok kanan bawah).
3. Atur pengaturannya sebagai berikut:
   - **Choose which function to run:** `onFormSubmit`
   - **Choose which deployment should run:** `Head`
   - **Select event source:** `From spreadsheet`
   - **Select event type:** `On form submit`
4. Klik **Save**.

---

### Bagian 4: Deploy Web App API

Agar Scanner di GitHub Pages bisa berkomunikasi dengan Google Sheets:
1. Di pojok kanan atas Apps Script, klik tombol biru **Deploy** → **New deployment**.
2. Klik icon gear di samping *Select type* → pilih **Web app**.
3. Isi konfigurasi:
   - **Description:** `Attendance API v1`
   - **Execute as:** `Me (email anda)`
   - **Who has access:** `Anyone` *(Wajib Anyone agar scanner panitia bisa akses)*.
4. Klik **Deploy**.
5. **PENTING:** Salin / Copy **Web App URL** yang dihasilkan (formatnya: `https://script.google.com/macros/s/.../exec`).

---

### Bagian 5: Deploy Frontend ke GitHub Pages

1. Push seluruh folder project ini ke repository GitHub Anda:
   ```bash
   git init
   git add .
   git commit -m "feat: initial EventPass QR Scanner blueprint"
   git branch -M main
   git remote add origin https://github.com/USERNAME/REPO_NAME.git
   git push -u origin main
   ```
2. Buka repository di GitHub:
   👉 **Settings** → **Pages** → Source: **Deploy from a branch** → Branch: `main` / `root` → Klik **Save**.
3. Tunggu 1 menit, GitHub Pages Anda sudah live di URL: `https://USERNAME.github.io/REPO_NAME/`.

---

## 📱 Cara Penggunaan di Hari H (Untuk Panitia)

1. Buka URL GitHub Pages di browser HP atau tablet (Chrome / Safari / Firefox).
2. Pertama kali buka, klik icon **Settings ⚙️** di pojok kanan atas:
   - Masukkan **Nama Panitia** (misal: *Budi*).
   - Masukkan **Gate / Pos** (misal: *Gate Utama*).
   - Masukkan **Google Apps Script Web App URL** yang disalin pada Bagian 4.
   - Klik **Test Koneksi**, lalu klik **Simpan Pengaturan**.
   *(Pengaturan ini otomatis tersimpan di HP panitia via `localStorage`, tidak akan hilang meskipun halaman di-refresh).*
3. Izinkan akses kamera browser.
4. Arahkan kamera ke QR Code peserta:
   - Sistem akan memproses dalam hitungan milidetik.
   - Muncul kartu konfirmasi data peserta & suara notifikasi.
   - Dalam 2.5 detik, sistem otomatis siap memindai peserta berikutnya tanpa perlu klik apapun!
5. **Jika HP peserta mati / QR rusak:**
   - Buka tab **Cari Manual**.
   - Panitia cukup ketik nama atau email peserta, lalu klik tombol **Check In**.
6. Buka tab **Riwayat** untuk melihat ringkasan orang-orang yang sudah berhasil di-scan oleh perangkat tersebut.

---

## 💡 Fitur Unggulan Blueprint

1. **Hemat Kuota Email (0 Quota Usage):**
   Menggunakan `DriveApp.getFileById(fileId).addViewer(email)`. File QR otomatis muncul di folder *"Dibagikan dengan saya (Shared with me)"* di Google Drive peserta tanpa memotong jatah pengiriman email harian akun Google Anda.
2. **Auto-Organized Folder:**
   Script otomatis mendeteksi folder Google Form Anda dan membuat subfolder `QR Code Peserta` di samping file Spreadsheet secara otomatis.
3. **Anti Double-Scan (Fraud Prevention):**
   Mencegah peserta membagikan tiket yang sama ke temannya. Jika tiket di-scan dua kali, scanner akan langsung berbunyi peringatan dan menampilkan waktu check-in pertama beserta nama gate pemeriksanya.
4. **Bypass CORS Google Apps Script:**
   Menggunakan metode payload `text/plain` terenkapsulasi JSON sehingga request dari GitHub Pages tidak terbentur preflight CORS browser.
5. **Synthesized Web Audio:**
   Efek suara beep & buzzer dihasilkan langsung oleh audio synthesizer bawaan browser (Web Audio API), tanpa perlu koneksi internet untuk download file `.mp3`.

---

## 📄 Lisensi
MIT License. Bebas digunakan dan dimodifikasi untuk segala jenis acara dan keperluan komersial maupun non-komersial.
