# 🏛️ Arsitektur & Lessons Learned: Membangun Web App Berbasis Google Sheets

Dokumen ini merangkum seluruh **arsitektur inti, logika kritis, dan lessons learned** dari pengembangan sistem presensi QR code ini. Tujuannya adalah agar developer lain yang ingin membangun aplikasi berbasis **Google Sheets + Google Apps Script (GAS) + Web App Frontend** tidak perlu mengulang proses trial & error dari nol.

---

## 📑 Daftar Isi
1. [Realita Google Sheets Sebagai Database: Kelebihan & Batasan](#1-realita-google-sheets-sebagai-database)
2. [Arsitektur 4-Sheet (Immutable vs State vs Audit Log)](#2-arsitektur-4-sheet)
3. [Arsitektur Hybrid: Sat-Set 0.05s Instant Scan & Offline Queue](#3-arsitektur-hybrid-instant-scan--offline-queue)
4. [Manajemen Konkurensi & LockService](#4-manajemen-konkurensi--lockservice)
5. [Trik Distribusi QR 0 Kuota Email via Google Drive](#5-trik-distribusi-qr-0-kuota-email-via-google-drive)
6. [Gotchas & Best Practices Deployment Web App Google Apps Script](#6-gotchas--best-practices-deployment-web-app)
7. [Standardisasi Waktu & Konsistensi Data](#7-standardisasi-waktu--konsistensi-data)
8. [Audit Trail & Operasional Multi-Gate](#8-audit-trail--operasional-multi-gate)
9. [Arsitektur Check-In & Check-Out Dinamis dengan Deteksi Anomali](#9-arsitektur-check-in--check-out-dinamis-dengan-deteksi-anomali)
10. [Mode Rutin: Presensi Harian Otomatis Per Tanggal](#10-mode-rutin-presensi-harian-otomatis-per-tanggal)
11. [Integrasi Realtime Spreadsheet Eksternal](#11-integrasi-realtime-spreadsheet-eksternal)
12. [Dynamic Custom Fields: Registrasi OTS & Google Form Self-Healing](#12-dynamic-custom-fields-registrasi-ots--google-form-self-healing)
13. [Dual-Column Search Semantics & Rekonsiliasi Cache Lokal](#13-dual-column-search-semantics--rekonsiliasi-cache-lokal)

---

## 1. Realita Google Sheets Sebagai Database

Menggunakan Google Sheets sebagai backend database memiliki daya tarik yang sangat besar:
* **Gratis** tanpa biaya server/database bulanan (AWS/GCP/Postgres).
* **UI Human-Friendly**: Panitia atau staf non-teknis bisa langsung melihat, mengedit, memfilter, atau mencetak data presensi secara langsung di browser tanpa butuh admin panel custom.
* **Ekosistem Google**: Terintegrasi native dengan Google Form, Google Drive, dan Gmail.

### ⚠️ Batasan Utama yang Wajib Diantisipasi
| Batasan | Dampak di Dunia Nyata | Solusi Rekayasa |
| :--- | :--- | :--- |
| **Latensi HTTP Tinggi** | Request ke Apps Script Web App butuh **1.5s – 3.5s** per request. Jika ada 500 orang antre, scanner akan sangat lambat (macet di gate). | **Hybrid Client Caching**: Lookup lokal di memori HP (0.05s), lalu sync background secara berkala. |
| **Race Conditions** | Jika 2 gate men-scan orang berbeda di detik yang sama, keduanya bisa menimpa baris yang sama atau menghasilkan nomor baris salah. | **Script LockService**: Wajib gunakan lock saat menulis ke sheet. |
| **Kuota Eksekusi & Email** | Free Gmail hanya 100 email/hari. Apps Script max runtime 6 menit/eksekusi. | **Drive File Sharing**: Gantikan pengiriman attachment email dengan `DriveApp.addViewer()`. |
| **CORS & Redirect 302** | Google Apps Script selalu me-redirect HTTP POST dengan status `302 Moved Temporarily`. | Frontend client harus handle redirect dan menggunakan body JSON stringified. |

---

## 2. Arsitektur 4-Sheet

Jangan pernah mencampur input mentah form, konfigurasi sesi, matrix kehadiran, dan riwayat scan dalam satu sheet! Gunakan pemisahan tanggung jawab (*Separation of Concerns*):

```
┌────────────────────────────────────────────────────────┐
│ 1. SHEET: "Form Responses 1" (IMMUTABLE RAW INPUT)     │
│    • Dibuat otomatis oleh Google Form.                 │
│    • JANGAN diedit, diformat, atau diberi formula!     │
└────────────────────────┬───────────────────────────────┘
                         │ onFormSubmit Trigger
                         ▼
┌────────────────────────────────────────────────────────┐
│ 2. SHEET: "Master Sesi" (ADMIN CONFIGURATION)          │
│    • Tempat admin menambah pertemuan/sesi acara.       │
│    • Kolom: [ID Sesi | Nama Sesi | Tanggal | Status]   │
└────────────────────────┬───────────────────────────────┘
                         │
                         ▼
┌────────────────────────────────────────────────────────┐
│ 3. SHEET: "Data Peserta" (SINGLE SOURCE OF TRUTH)      │
│    • Menyimpan registri peserta + kolom sesi dinamis.  │
│    • Kolom: [Ticket ID | Nama | Total Hadir | Email |  │
│              Drive ID | Drive URL | Sesi 1 | Sesi 2..] │
│    • Formula Total Hadir:                              │
│      =IF(A2="","", COUNTIF(G2:ZZ2, "HADIR*"))         │
└────────────────────────┬───────────────────────────────┘
                         │
                         ▼
┌────────────────────────────────────────────────────────┐
│ 4. SHEET: "Log Kehadiran" (APPEND-ONLY AUDIT TRAIL)    │
│    • Buku besar setiap percobaan scan (Sukses/Gagal).  │
│    • Kolom: [Timestamp | ID Sesi | Nama Sesi |         │
│              Ticket ID | Nama | Status Scan |          │
│              Petugas | Gate | Lokasi Maps |            │
│              Perangkat | Keterangan]                   │
└────────────────────────────────────────────────────────┘
```

### 💡 Golden Rule: Header Kolom Sesi Dinamis
Di sheet `Data Peserta`, tambahkan ID sesi di header kolom dengan format:  
`Sesi: Nama Sesi [SESI-ID]` (Contoh: `Sesi: Pembukaan [SESI-01]`).  
Dengan format ini, script backend bisa mendeteksi kolom sesi secara dinamis melalui regex `h.match(/\[([A-Za-z0-9_-]+)\]/)`, sehingga admin bebas menambah sesi baru di Google Sheets tanpa harus merombak kode program!

---

## 3. Arsitektur Hybrid: Instant Scan & Offline Queue

Ini adalah inovasi terpenting untuk mengatasi latensi 2 detik Google Sheets.

### Alur Kerja (Workflows):
1. **Pre-Caching Saat Buka Web App**:
   * Frontend men-download seluruh daftar peserta via API `getAttendees` dan menyimpannya di `localStorage.absen_cached_attendees`.
   * Strukturnya berupa dictionary dengan key uppercase `TICKET_ID`:
     ```json
     {
       "TIC-ABC123": {
         "name": "Budi Santoso",
         "email": "budi@email.com",
         "checkedInSessions": {
           "SESI-01": "2026-10-20 08:30:00"
         }
       }
     }
     ```
2. **Saat Scan Berlangsung (0.05 Detik)**:
   * **Cek Duplikasi**: Cek apakah `checkedInSessions[currentSessionId]` sudah ada. Jika ya &rarr; Tampilkan modal kuning **SUDAH ABSEN**.
   * **Cek Validitas**: Cek apakah `ticketId` ada di memori. Jika ya &rarr; Tampilkan modal hijau **CHECK-IN BERHASIL** seketika!
   * **Simpan ke Queue**: Masukkan payload scan ke `localStorage.absen_sync_queue`.
3. **Background Batch Sync (Auto-Flush)**:
   * Background runner membaca `absen_sync_queue` tiap 3–5 detik.
   * Ambil maksimal 15 scan sekaligus dan kirimkan dalam 1 request `batchCheckIn`.
   * Backend mengunci sheet (`LockService`), memvalidasi tiket, menulis kehadiran ke `Data Peserta`, dan menulis seluruh log ke `Log Kehadiran` dalam 1 operasi batch (`setValues`).
4. **Self-Healing Rollback**:
   * Jika ternyata admin spreadsheet telah menghapus tiket tersebut dari sheet, response server akan mengembalikan status `NOT_FOUND`.
   * HP otomatis me-rollback status di riwayat lokal menjadi `REJECTED_BY_SERVER` dan menghapus tiket dari cache memori lokal.
5. **Audit Trail Percobaan Duplikat**:
   * Percobaan scan duplikat **tetap di-push ke sync queue** dengan flag `isDuplicate: true`.
   * Dengan cara ini, sheet `Log Kehadiran` tetap memiliki catatan lengkap siapa saja yang mencoba scan ulang, jam berapa, di gate mana, dan siapa panitianya.

---

## 4. Manajemen Konkurensi & LockService

Google Apps Script berjalan di lingkungan multi-user. Jika beberapa panitia melakukan scan serentak di gate yang berbeda tanpa locking, data akan hilang atau baris akan saling menimpa (*race conditions*).

```javascript
// CONTOH PATTERN LOCKSERVICE YANG AMAN & BENAR
function safeBatchCheckIn(scans) {
  const lock = LockService.getScriptLock();
  
  // 1. Coba dapatkan lock maksimal 8-10 detik
  if (!lock.tryLock(8000)) {
    return createJsonResponse({
      success: false,
      message: "Server sibuk memproses presensi lain. Antrean akan dicoba otomatis."
    });
  }

  try {
    // 2. Kritis: Seluruh pembacaan dan penulisan spreadsheet dilakukan DI DALAM lock
    const sheetPeserta = getOrCreateSheet(CONFIG.SHEETS.DATA_PESERTA);
    const sheetLog = getOrCreateSheet(CONFIG.SHEETS.LOG_KEHADIRAN);
    
    // 3. Batch Read & Batch Write (JANGAN appendRow di dalam for loop!)
    // Gunakan setValues() untuk efisiensi hingga 50x lipat
    if (logRowsToAppend.length > 0) {
      const startRow = sheetLog.getLastRow() + 1;
      sheetLog.getRange(startRow, 1, logRowsToAppend.length, logRowsToAppend[0].length)
              .setValues(logRowsToAppend);
    }
  } finally {
    // 4. Selalu lepaskan lock di block finally
    lock.releaseLock();
  }
}
```

### ⚠️ Anti-Pattern Kritis LockService:
> **JANGAN PERNAH menahan lock saat memanggil API luar!**  
> Misalnya: Mengambil gambar QR dari QuickChart atau mengirim email. Jika API luar lambat (misal 5 detik), seluruh scanner di seluruh gate akan ikut membeku (*freeze*). Lakukan fetch API luar **sebelum** mengambil lock, atau simpan file tanpa lock, baru ambil lock untuk menulis ke Sheet!

---

## 5. Trik Distribusi QR 0 Kuota Email via Google Drive

Mengirim tiket QR code lewat email via Apps Script (`GmailApp.sendEmail`) memiliki batas kuota harian:
* Akun Gmail Gratis: **100 email / 24 jam**.
* Akun Google Workspace: **1.500 email / 24 jam**.

Untuk event dengan ratusan atau ribuan pendaftar, kuota email akan langsung habis dan sistem berhenti bekerja.

### Solusi: Drive Viewer Sharing
```javascript
// 1. Simpan gambar QR Code ke subfolder Google Drive
const targetFolder = getOrCreateQrFolder();
const driveFile = targetFolder.createFile(qrBlob);
const fileId = driveFile.getId();

// 2. Beri hak akses Viewer langsung ke email pendaftar
// 🚀 INI MEMAKAI 0 KUOTA EMAIL!
DriveApp.getFileById(fileId).addViewer(emailPeserta);
```
**Mengapa trik ini sangat efektif?**
1. Tidak mengurangi kuota email harian sama sekali (unlimited).
2. Tiket QR code otomatis muncul di Google Drive peserta pada tab **"Shared with me" (Dibagikan dengan saya)**.
3. Link URL file Drive tetap tersimpan di sheet `Data Peserta` sehingga panitia bisa mengirim ulang link via WhatsApp jika diperlukan.

---

## 6. Gotchas & Best Practices Deployment Web App

Saat men-deploy Google Apps Script sebagai Web API:

1. **Pengaturan Hak Akses**:
   * *Execute as*: **Me (pemilik script)**.
   * *Who has access*: **Anyone** (*Bukan "Anyone with Google Account"*, agar panitia tidak perlu login akun Google saat membuka web app).
2. **Handling Redirect 302**:
   * Google Apps Script Web App **selalu mengembalikan HTTP 302 redirect** ke subdomain `script.googleusercontent.com`.
   * Frontend `fetch()` harus mengizinkan redirect (default browser sudah `redirect: "follow"`).
   * Request body berupa string JSON `JSON.stringify(payload)` dikirim dengan header `text/plain;charset=utf-8` untuk mencegah browser mengirim request preflight `OPTIONS` yang sering ditolak oleh Apps Script.
3. **Graceful Fallback**:
   * Jika backend Apps Script belum sempat di-*Deploy New Version* oleh admin, frontend akan mendeteksi response `Action "batchCheckIn" tidak dikenali`.
   * Sistem secara otomatis beralih (*auto-fallback*) ke `checkIn` sekuensial satu per satu agar antrean scan panitia tidak pernah macet (*zero stuck items*).

---

## 7. Standardisasi Waktu & Konsistensi Data

Masalah klasik sistem presensi adalah perbedaan zona waktu dan format tanggal:
* **Browser Client**: `new Date().toLocaleTimeString()` menghasilkan format lokal perangkat (bisa berupa `4:28:14 PM` pada perangkat US, atau `16:28:14` pada perangkat Indonesia).
* **Server Apps Script**: `Session.getScriptTimeZone()` mengikuti zona waktu spreadsheet (misalnya `Asia/Jakarta`).

### Standar yang Wajib Diterapkan:
1. Simpan selalu timestamp dalam format **ISO lokal standar**:  
   `YYYY-MM-DD HH:mm:ss` (Contoh: `2026-10-20 16:28:14`).
2. Jangan hanya menyimpan jam saja tanpa tanggal! Hal ini penting agar log tetap akurat jika acara berlangsung multi-hari atau melewati tengah malam.
3. Format ringkas seperti `16:28` hanya digunakan untuk **tampilan UI visual di layar HP panitia**, bukan untuk isi sel di database.

---

## 8. Audit Trail & Operasional Multi-Gate

Untuk mencegah kecurangan dan mempermudah investigasi salah scan di lapangan, setiap baris di sheet `Log Kehadiran` harus merekam metadata operasional lengkap:

| Kolom | Contoh Nilai | Kegunaan |
| :--- | :--- | :--- |
| **Timestamp Log** | `2026-10-20 16:28:14` | Waktu persis scan dilakukan. |
| **ID Sesi** | `SESI-01` | Membedakan kehadiran antar sesi pertemuan. |
| **Ticket ID** | `TIC-TUGADG` | Identifier unik peserta. |
| **Status Scan** | `BERHASIL` / `DUPLIKAT` / `TIDAK_VALID` / `DIBATALKAN` | Filter cepat di spreadsheet untuk melihat anomali. |
| **Petugas / Panitia**| `Rian (Panitia Gate 1)` | Mengetahui panitia yang bertanggung jawab. |
| **Gate** | `Pintu Masuk Utama` | Mengetahui pintu/pos tempat scan dilakukan. |
| **Link Lokasi (Maps)**| `https://maps.google.com/?q=-6.2,106.8` | Bukti koordinat GPS perangkat panitia saat men-scan. |
| **Perangkat** | `Android (Samsung SM-A525F) • Chrome` | Audit perangkat jika terjadi kecurigaan double scanner. |

---

## 9. Arsitektur Check-In & Check-Out Dinamis dengan Deteksi Anomali

Tidak semua kepanitiaan membutuhkan sistem Check-In dan Check-Out (banyak acara hanya memerlukan sekali scan). Sistem didesain **hybrid & backward-compatible**:

### A. Konfigurasi di Sheet "Master Sesi"
* Kolom ke-5: `Tipe Presensi`.
* Nilai:
  * `SINGLE` (atau kosong): Sesi biasa (1x scan masuk langsung tercatat hadir).
  * `CHECK_IN_OUT`: Mengaktifkan mode presensi 2 fase (Masuk & Keluar).
* Jika bertipe `CHECK_IN_OUT`, backend secara dinamis mengelola 2 kolom:
  * `Sesi: Nama (Masuk) [SESI-ID_IN]`
  * `Sesi: Nama (Keluar) [SESI-ID_OUT]`

### B. Proteksi Total Hadir
* Formula Total Hadir di Google Sheets: `=IF(A2=""; ""; COUNTIF(D2:ZZ2; "HADIR*"))`.
* Status masuk dicatat sebagai `HADIR - <waktu>`, sedangkan status kepulangan dicatat sebagai `CHECKOUT - <waktu>`.
* Dengan demikian, kolom keluar **tidak akan menduplikasi hitungan kehadiran total peserta** di dashboard Google Sheets!

### C. Alur Deteksi Anomali (Checkout Tanpa Check-In)
1. **Pre-Check di Client (0.05s)**: Ketika operator berada di mode `CHECK-OUT`, sistem memeriksa apakah tiket memiliki data kehadiran di sesi `[SESI-ID_IN]`.
2. **Warning Dialog**: Jika peserta belum check-in, scanner memunculkan dialog peringatan: *"Peserta belum Check-In! Tetap Check-Out?"*
3. **Audit Trail**: Jika operator menekan "Tetap Check-Out", sistem mencatat status `CHECKOUT_ANOMALI` di sheet `Log Kehadiran` lengkap dengan alasan panitia (misal: "Lolos gate masuk / terlambat").

---

## 10. Mode Rutin: Presensi Harian Otomatis Per Tanggal

Untuk kegiatan berulang (misalnya kelas harian, magang harian, atau pesantren kilat), membuat baris sesi baru setiap hari di "Master Sesi" sangat merepotkan.

### A. Konsep Status `RUTIN`
* Admin cukup mendefinisikan 1 baris sesi di sheet `Master Sesi` dengan kolom **Status = `RUTIN`**.
* Saat scan berlangsung pada hari berjalan, backend otomatis menggenerasi kolom tanggal `YYYY-MM-DD`:
  * Jika sesi `SINGLE`: Kolom `Sesi: Nama Sesi [SESI-ID_YYYY-MM-DD]`.
  * Jika sesi `CHECK_IN_OUT`: Otomatis memecah menjadi 2 kolom harian:
    * `Sesi: Nama Sesi (Masuk) [SESI-ID_YYYY-MM-DD_IN]`
    * `Sesi: Nama Sesi (Keluar) [SESI-ID_YYYY-MM-DD_OUT]`

### B. Proteksi Anti Phantom Column
* Aksi pembacaan data (`search` atau `getAttendees`) bersifat **Read-Only**:
  * Menggunakan helper `findSessionColumn(sheetPeserta, sessionId, false)`.
  * Jika kolom hari ini belum ada karena belum ada peserta yang hadir, helper tidak akan membuat kolom kosong secara sembarangan (*no phantom column generation*). Kolom baru hanya terbuat saat ada aksi penulisan mutasi (`batchCheckIn` / `checkIn`).

---

## 11. Integrasi Realtime Spreadsheet Eksternal

Banyak organisasi memiliki dashboard pusat atau spreadsheet terpisah untuk analitik / pelaporan publik, tanpa ingin membuka akses ke database utama presensi.

### A. Non-Blocking Realtime Forwarding
* Setiap kali scan berhasil dicatat di `Log Kehadiran`, backend memanggil:
  `forwardLogToExternalSpreadsheet(logEntry, attendeeData)`.
* Dijalankan di dalam blok `try-catch` terisolasi: **Jika spreadsheet target eksternal error, lambat, atau izinnya dicabut, proses presensi utama di gate TETAP BERJALAN 100% SUKSES.**

### B. Penyimpanan Kredensial via `PropertiesService`
* Mengapa Spreadsheet ID eksternal tidak di-hardcode di file `Code.gs`?
  * Agar ketika kode program di-update atau di-pull dari Git, konfigurasi target sheet milik pengguna tidak ter-overwrite menjadi kosong.
  * Menu `⚡ Presensi Event -> 9. Hubungkan / Test Spreadsheet Eksternal` menyimpan ID ke Google Cloud Script Properties (`PropertiesService.getScriptProperties()`), yang bertahan lintas deployment.

---

## 12. Dynamic Custom Fields: Registrasi OTS & Google Form Self-Healing

Database peserta sering kali memiliki kolom tambahan kustom (*Custom Fields*) seperti *Jenis Kelamin*, *Divisi*, *Asal Instansi*, atau *Ukuran Kaos*.

### A. Auto-Discovery Header & Dropdown Validation
* Backend membaca seluruh header di sheet `Data Peserta`.
* Semua kolom di luar kolom sistem inti diidentifikasi sebagai **Custom Fields**.
* Helper `getCustomFields()` memeriksa validasi data Google Sheets (`DataValidationCriteria.VALUE_IN_LIST`).
* Jika ada dropdown list di sheet, frontend web app otomatis me-render elemen `<select>` dengan opsi pilihan yang persis sama. Jika teks biasa, di-render sebagai input teks.

### B. Dynamic Row Mapping & Auto-Fix Shifted Rows
* **Pendaftaran OTS**: Backend mengalokasikan array baris sepanjang total kolom sheet dan memetakan nilai form OTS persis ke indeks kolom yang sesuai.
* **Auto-Fix Baris Bergeser (`fixShiftedParticipantRows`)**: Jika admin sempat menyisipkan kolom baru di tengah-tengah sheet yang menyebabkan data tergeser (misal email masuk ke kolom instansi), fungsi auto-fix ini secara cerdas mendeteksi format email/link drive dan mengembalikannya ke posisi header yang semestinya.

---

## 13. Dual-Column Search Semantics & Rekonsiliasi Cache Lokal

Pada mode presensi `CHECK_IN_OUT`, pencarian manual peserta (*Cari Manual*) sering menghadapi inkonsistensi status jika hanya memeriksa satu kolom.

### A. Dual Column Live Inspection
* Saat operator melakukan pencarian di mode `OUT`, backend tidak hanya mengecek kolom keluar, tetapi sekaligus memeriksa kolom `IN` dan `OUT`:
  * `hasIn: true, hasOut: false` &rarr; Status: **Sudah Check-In** (Siap Check-Out).
  * `hasIn: false, hasOut: false` &rarr; Status: **Belum Check-In** (Tombol Check-Out ditandai merah: **Check Out (Anomali)**).
  * `hasIn: true, hasOut: true` &rarr; Status: **Sudah Check-Out**.

### B. Auto-Pruning Stale Cache & Dedicated Cache Clear Button
* Jika admin mengedit status kehadiran peserta secara manual di Google Sheets, cache `localStorage` di HP operator bisa menjadi *stale* (usang).
* Setiap kali pencarian live server dilakukan, respon server otomatis menimpa dan membersihkan (*pruning*) status lokal yang kadaluwarsa.
* Disediakan tombol **"Bersihkan Cache Lokal"** di modal Pengaturan dan tab Riwayat untuk mereset memori HP secara aman tanpa menghapus antrean offline yang belum tersinkron.

---

## 🎯 Kesimpulan
Dengan memadukan **Google Sheets sebagai reactive database** dan **Web App Frontend sebagai edge-cache scanner**, kita mendapatkan sistem yang menggabungkan:
1. **Kecepatan ekstrim (0.05s)** layaknya sistem enterprise berbasis Redis/Postgres.
2. **Kemudahan operasional & nol biaya server** khas Google Sheets.
3. **Ketahanan offline** yang aman dari gangguan koneksi internet di lapangan.
4. **Fleksibilitas sesi**: Bebas memilih sesi `SINGLE`, `CHECK_IN_OUT`, maupun `RUTIN` harian tanpa saling bentrok.
5. **Skalabilitas Data**: Integrasi eksternal realtime, custom fields dinamis untuk OTS, dan rekonsiliasi data otomatis.
