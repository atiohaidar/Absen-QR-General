# ⚡ EventPass • QR Code Attendance & Multi-Session Check-In Blueprint

Blueprint sistem presensi dan registrasi event bertahap / multi-hari berbasis **Google Form + Google Drive + Google Sheets + GitHub Pages Scanner**. 

Peserta cukup **mendaftar 1 kali** dan mendapatkan **1 QR Code tetap** yang berlaku untuk seluruh rangkaian pertemuan/sesi acara. Dilengkapi fitur **pembatalan kehadiran (Undo / Cancel)** jika terjadi salah scan/salah orang.

---

## 🎯 Architecture 4-Sheet Blueprint

```
[Peserta Isi Google Form]
         │ (Submit: Nama Lengkap & Email)
         ▼
┌────────────────────────────────────────────────────────┐
│ 1. SHEET: "Form Responses 1" (RAW / TIDAK DIOTAK-ATIK) │
│    • Murni hanya nampung input asli dari Google Form:  │
│      [Timestamp | Nama Lengkap | Email]                │
└────────────────────────┬───────────────────────────────┘
                         │ (Trigger onFormSubmit)
                         ▼
┌────────────────────────────────────────────────────────┐
│ 2. GOOGLE DRIVE SUBFOLDER: "QR Code Peserta"           │
│    • Otomatis dibuat di folder yang sama dg Form/Sheet │
│    • DriveApp.getFileById(id).addViewer(email)         │
│      (0 Quota email! Muncul di Drive 'Shared with me') │
└────────────────────────┬───────────────────────────────┘
                         │
                         ▼
┌────────────────────────────────────────────────────────┐
│ 3. SHEET: "Master Sesi" (ADMIN CONFIGURATION)          │
│    • Admin mengatur sesi pertemuan yang aktif:         │
│      [ID Sesi | Nama Sesi | Tanggal | Status: AKTIF]   │
└────────────────────────┬───────────────────────────────┘
                         │
                         ▼
┌────────────────────────────────────────────────────────┐
│ 4. SHEET: "Data Peserta" (MATRIX PERFORMA KONSISTENSI) │
│    • Matrix kehadiran per sesi untuk seluruh peserta:  │
│      [Ticket ID | Nama | Email | Sesi 1 | Sesi 2 ...]  │
└────────────────────────▲───────────────────────────────┘
                         │
        (Setiap Panitia Scan di Scanner Web App)
                         │
                         ▼
┌────────────────────────────────────────────────────────┐
│ 5. SHEET: "Log Kehadiran" (AUDIT TRAIL TIMELINE)       │
│    • Catatan setiap aksi scan maupun PEMBATALAN:       │
│      [Timestamp | ID Sesi | Nama Sesi | Ticket ID |    │
│       Nama | Status Scan | Petugas | Gate |            │
│       Link Lokasi (Maps) | Perangkat | Keterangan]     │
└────────────────────────────────────────────────────────┘
```

---

## 📁 Struktur File Project

```text
absen qr/
├── index.html              # Frontend UI Scanner (GitHub Pages Ready)
├── css/
│   └── style.css           # Modern Clean UI (WCAG AA Contrast & Touch-Friendly)
├── js/
│   ├── state.js            # App State, DOM Element Cache, LocalStorage Helpers
│   ├── audio.js            # Web Audio API Synthesizer (Procedural Chime, Alert, Buzzer)
│   ├── api.js              # Network Client (12s Timeout AbortController, Auto-Retry, Error Handler)
│   ├── scanner.js          # Telegram-Style Dynamic AR Reticle Engine (BarcodeDetector + jsQR)
│   ├── ui.js               # Presentation Layer (Modals, Countdown Bar, Toast, History, Search)
│   └── app.js              # Main Coordinator & Bootstrap Entry Point
├── backend/
│   ├── Code.gs             # Google Apps Script (onFormSubmit + Multi-Session API + Revert + doGet)
│   └── appsscript.json     # Manifest Apps Script (Timezone Asia/Jakarta & Minimal Scopes)
├── constrain.md            # Constraint catatan teknis
└── README.md               # Dokumentasi lengkap setup
```

---

---

## 🚀 Panduan Setup Kilat (Hanya 2 Menit - Khusus Orang Awam)

Tidak perlu paham koding, tidak perlu setup Git/GitHub, dan tidak perlu atur trigger manual. Cukup ikuti 3 langkah berikut:

### Langkah 1: Buka & Buat Salinan Template Google Sheet
1. Buka link template master Google Sheet berikut di browser komputer Anda:
   *(Ganti ID Spreadsheet dengan Master Template Anda)*
   ```text
   https://docs.google.com/spreadsheets/d/<SPREADSHEET_ID>/copy
   ```
2. Klik tombol biru **"Make a copy"** (Buat Salinan).
   *Seluruh tab sheet, formula, dan script backend otomatis tersalin rapi ke Google Drive Anda!*

### Langkah 2: Jalankan 1-Click Setup dari Menu Toolbar
1. Di Google Sheets Anda, tunggu beberapa detik sampai muncul menu khusus di samping menu Help:
   👉 **`⚡ Presensi Event`**
2. Klik **`⚡ Presensi Event`** → **`🚀 1. Setup Otomatis (Inisialisasi & Pasang Trigger)`**.
   * Jika Google meminta izin akses (*Authorization Required*), klik **Continue** → pilih akun Google Anda → klik **Advanced** → klik **Go to... (unsafe)** → **Allow**.
   * Script akan **otomatis membuat tab Master Sesi, Data Peserta, Log Kehadiran, folder Drive QR, dan memasang trigger presensi** tanpa Anda perlu mengutak-atik menu alarm/triggers!
3. *(Opsional)* Jika belum punya Google Form pendaftaran:
   Klik **`⚡ Presensi Event`** → **`📝 2. Buat Google Form Pendaftaran Otomatis`**. Form pendaftaran langsung jadi dan otomatis terhubung!

### Langkah 3: Aktifkan API & Bagikan ke Panitia
1. Di Google Sheets, klik menu **Extensions** → **Apps Script**.
2. Klik tombol biru **Deploy** (kanan atas) → **New deployment**.
3. Klik icon gear ⚙️ di samping *Select type* → pilih **Web app**.
4. Atur:
   - **Execute as:** `Me (akun Anda)`
   - **Who has access:** `Anyone` *(Wajib Anyone agar scanner HP bisa akses)*
5. Klik **Deploy**, lalu salin **Web App URL** (`https://script.google.com/macros/s/.../exec`).
6. Kembali ke Google Sheets, klik menu **`⚡ Presensi Event`** → **`🔗 3. Buka / Bagikan Link Scanner Panitia`**.
7. Tempel Web App URL Anda, lalu klik **Buat Link Siap Pakai** & **Salin Link**.
8. Bagikan link tersebut ke WhatsApp panitia. Selesai! Panitia langsung buka di HP dan langsung siap scan!

---

## 🛠️ Panduan Manual / Developer (Bagi yang Ingin Buat dari Nol)

Jika Anda ingin membuat dari spreadsheet kosong:
1. Buat Google Sheet baru.
2. Buka **Extensions** → **Apps Script**.
3. Salin isi [`backend/Code.gs`](backend/Code.gs) dan isi [`backend/appsscript.json`](backend/appsscript.json) (aktifkan show manifest di Project Settings).
4. Klik **Save**, reload Google Sheet, lalu gunakan menu **`⚡ Presensi Event`** seperti panduan di atas.
5. Deploy Frontend ke GitHub Pages / Vercel jika ingin custom domain sendiri.

#### ⚡ Format Link Zero-Config Panitia
Link panitia menggunakan parameter `?q=` agar HP panitia langsung terhubung otomatis tanpa ketik URL lagi:
```text
https://<scanner-url>/?q=https://script.google.com/macros/s/.../exec&panitia=Budi&gate=Gate+1
```

---

## 💡 Cara Penggunaan di Hari H

1. **Pilih Sesi Acara:**
   Di bagian atas scanner, terdapat dropdown:
   `📍 [ Pertemuan 1 - Pembukaan ▾ ] [🔄]`
   * Panitia tinggal pilih sesi pertemuan hari ini.
   * Jika admin baru saja menambahkan sesi baru di sheet `Master Sesi`, klik tombol icon `🔄` untuk sinkronisasi seketika.
2. **Scan QR Code Peserta:**
   * Arahkan kamera ke QR tiket peserta.
   * Layar menampilkan kartu konfirmasi data peserta & suara chime sukses.
3. **Membatalkan Kehadiran (Jika Salah Orang):**
   * **Dari Pop-up Hasil Scan:** Klik tombol merah **"Batalkan Kehadiran (Salah Orang)"**.
   * **Dari Tab Riwayat:** Klik tombol **"Batalkan"** pada nama peserta yang bersangkutan.
   * Data kehadiran di sheet `Data Peserta` otomatis dihapus kembali, dan catatan pembatalan dicatat di `Log Kehadiran`.
4. **Registrasi Cepat OTS (Bagi yang Tidak Punya HP / HP Mati):**
   * Buka tab **Daftar OTS**.
   * Masukkan **Nama Lengkap** *(Wajib)*, No. WhatsApp/Email *(Opsional)*, dan Catatan *(Opsional)*.
   * Klik **Daftarkan & Langsung Check-In**.
   * Sistem otomatis membuatkan ID (`TIC-OTS-XXXX`), menyimpannya di Google Drive & sheet `Data Peserta`, dan **langsung menandai peserta HADIR** di sesi hari ini!
   * Di pertemuan berikutnya, jika orang tersebut datang lagi, panitia cukup mencari namanya di tab **Cari Manual** tanpa perlu daftar ulang.
5. **Cari Manual:**
   Gunakan tab **Cari Manual** untuk mencari nama peserta online maupun peserta OTS, lalu klik Check In.
6. **Audit Keamanan & Lokasi Presensi (Zero-Lag GPS & Device Log):**
   * Setiap kali panitia melakukan scan, pembatalan, atau pendaftaran OTS, sistem secara otomatis mencatat **Link Google Maps** koordinat GPS panitia dan **Tipe Perangkat/Browser** (misal: `Android • Chrome (Mobile)`) ke sheet `Log Kehadiran`.
   * Berjalan 100% di latar belakang (*asynchronous*), tanpa jeda/loading sama sekali saat proses scanning berlangsung (0ms latency).
   * Panitia dapat memeriksa status GPS dan deteksi perangkat melalui panel **Pengaturan ⚙️**.

---

## 📊 Cara Melihat Konsistensi Peserta di Google Sheets
Buka tab **Data Peserta**:
* Setiap sesi memiliki kolomnya sendiri (misal: `Sesi: Pertemuan 1`, `Sesi: Pertemuan 2`).
* Anda dapat menambahkan kolom kalkulasi sederhana di Google Sheets:
  * **Total Hadir:** `=COUNTIF(D2:Z2, "HADIR*")`
  * **% Konsistensi:** `=COUNTIF(D2:Z2, "HADIR*") / 3 * 100%`

---

## 📄 Lisensi
MIT License. Bebas digunakan dan disesuaikan untuk berbagai event, seminar, workshop, pelatihan, maupun komunitas.
