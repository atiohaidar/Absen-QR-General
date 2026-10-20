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
│      [Timestamp | Sesi | Ticket ID | Status: BERHASIL/ │
│       DUPLIKAT/DIBATALKAN | Panitia | Gate | Alasan]   │
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

## 🚀 Panduan Setup Singkat (5 Menit)

### 1. Buat Google Form & Google Sheet
1. Buat **Google Form** dengan pertanyaan:
   - `Nama Lengkap` (Short answer, Wajib)
   - `Email` (Short answer, Wajib)
2. Di tab Responses Google Form, klik icon hijau **Link to Sheets** untuk membuat spreadsheet baru.

### 2. Pasang Script Backend
1. Di Google Sheets, klik menu **Extensions** → **Apps Script**.
2. Salin isi [`backend/Code.gs`](backend/Code.gs) ke file `Code.gs` di editor Apps Script.
3. *(Opsional)* Pada menu **Project Settings** (icon gear), centang *Show "appsscript.json" manifest file in editor*, lalu salin isi [`backend/appsscript.json`](backend/appsscript.json).
4. Klik **Save** (icon disket).
5. Pada dropdown fungsi di bagian atas, pilih `testInitSheets`, lalu klik **Run**:
   - Berikan izin akses Google (Drive & Spreadsheet).
   - Script akan otomatis membuat tab **Master Sesi**, **Data Peserta**, dan **Log Kehadiran** dengan rapi.

### 3. Pasang Trigger Otomatis
1. Di sidebar kiri Apps Script, klik menu **Triggers** (icon alarm).
2. Klik tombol **+ Add Trigger** (kanan bawah).
3. Atur:
   - Function: `onFormSubmit`
   - Deployment: `Head`
   - Event source: `From spreadsheet`
   - Event type: `On form submit`
4. Klik **Save**.

### 4. Deploy Web App API
1. Klik tombol biru **Deploy** → **New deployment**.
2. Pilih jenis **Web app**.
3. Atur:
   - Execute as: **Me**
   - Who has access: **Anyone** *(Wajib Anyone agar bisa diakses scanner)*.
4. Klik **Deploy**, lalu salin **Web App URL** (format: `https://script.google.com/macros/s/.../exec`).

### 5. Deploy Frontend ke GitHub Pages
1. Push project ini ke repository GitHub Anda.
2. Buka repo di GitHub: **Settings** → **Pages** → Source: **Deploy from a branch** (`main` / `root`) → Klik **Save**.
3. Buka URL GitHub Pages di browser HP atau laptop.
4. Masuk ke menu **Pengaturan ⚙️**:
   - Masukkan **Nama Panitia** (misal: *Budi*).
   - Masukkan **Gate** (misal: *Gate Utama*).
   - Masukkan **Apps Script API URL** yang disalin di langkah sebelumnya.
   - Klik **Simpan Pengaturan**.

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
