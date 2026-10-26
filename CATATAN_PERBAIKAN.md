# Catatan Perjalanan Perbaikan Sistem Presensi & Sinkronisasi Kupon

Dokumen ini merangkum rentetan kendala teknis yang dihadapi dan langkah perbaikannya, mulai dari sinkronisasi spreadsheet eksternal, bug ganjil pada data, investigasi scan ganda, penyesuaian UI mobile, hingga pembersihan cache aplikasi.

---

## 1. Masalah Awal: Kebutuhan Tab Kupon & Konsumsi

### Konteks
Aplikasi presensi utama mencatat log kehadiran di spreadsheet induk pada tab `Log Kehadiran`. Kebutuhannya adalah memisahkan data tersebut ke sheet terpisah untuk panitia konsumsi:
* Tab **Ikhwan** (peserta laki-laki)
* Tab **Akhwat** (peserta perempuan)

Aturan pencatatannya:
* Scan **IN** (Masuk): mencentang kolom *Ambil Kupon* dan mencatat timestamp pengambilan kupon.
* Scan **OUT** (Keluar/Makan): mencentang kolom *Ambil makan* dan mencatat timestamp pengambilan makanan.
* Scan **DIBATALKAN**: membatalkan status kupon/makan dan menghapus centang terkait.
* Scan **CHECKOUT_ANOMALI**: mencentang kedua kolom sekaligus karena peserta langsung keluar tanpa melalui alur masuk yang normal.

---

## 2. Kendala 1: Trigger Apps Script yang Tidak Bekerja (onChange / onEdit)

### Masalah
Rancangan awal mencoba memanfaatkan trigger `onChange` atau `onEdit` di spreadsheet target. Logikanya, setiap kali backend utama menambahkan baris ke sheet `Log Kehadiran`, trigger di sheet target akan membaca baris baru lalu memperbarui tab `Ikhwan` atau `Akhwat`.

Namun saat diuji, baris di `Log Kehadiran` berhasil bertambah, tetapi tab kupon sama sekali tidak bergerak.

### Penyebab
Google Apps Script secara sengaja membatasi trigger event. Perubahan data yang dilakukan secara terprogram melalui script lain (misalnya lewat `SpreadsheetApp.openById().appendRow()`) **tidak akan pernah memicu** trigger `onEdit` maupun `onChange` pada spreadsheet tujuan.

### Solusi
Arsitektur diubah dari model trigger pasif menjadi **Webhook HTTP POST (`doPost`)**:
1. Menulis script Webhook di spreadsheet target (`Code_Webhook_Kupon.gs`).
2. Script tersebut di-deploy sebagai Web App.
3. Backend utama mengirim payload JSON langsung ke Webhook URL setiap kali ada pemindaian masuk.

---

## 3. Kendala 2: Error Formula dan Locale Spreadsheet

### Masalah
Saat mencoba mengisi timestamp secara otomatis menggunakan rumus formula:
1. Muncul error: `timeCell.setFormulaLocal is not a function`.
2. Setelah diganti ke `setValue("=IF(...)")`, muncul error formula `#ERROR!` pada sel spreadsheet.

### Penyebab
* Objek `Range` di Google Apps Script tidak memiliki fungsi bernama `setFormulaLocal`. Penulisan rumus langsung menggunakan `setValue()` atau `setFormula()`.
* Spreadsheet menggunakan locale Indonesia. Format rumus lokal Indonesia mewajibkan pemisah parameter berupa titik koma (`;`), bukan koma (`,`). Penggunaan koma menyebabkan parser Google Sheets gagal membaca formula.

### Solusi
1. Menggunakan `setValue()` dengan string formula yang disesuaikan.
2. Mengubah formula menjadi:
   ```text
   =IF(C2=TRUE; IF(D2<>""; D2; NOW()); "")
   ```
   Rumus ini sekaligus berfungsi mengunci timestamp agar tidak berubah-ubah saat sheet di-refresh (circular fallback).

---

## 4. Kendala 3: Kolom WhatsApp Terisi Tanggal Pendaftaran

### Masalah
Di tab target, kolom `No Whatsapp` malah berisi tanggal dan jam pendaftaran peserta, bukannya nomor telepon.

### Penyebab
Script mencari indeks kolom WhatsApp berdasarkan pencocokan teks sederhana: `header.includes("wa")`.
Header kolom pendaftaran di Google Form bernama `"Waktu Daftar"`. Karena kata `"Waktu"` diawali huruf `"wa"`, script salah mendeteksi `"Waktu Daftar"` sebagai kolom WhatsApp.

### Solusi
Memperketat pencarian header dengan menambahkan blacklist untuk kata `"waktu"` dan menggunakan regular expression berbasis batas kata (`\b`):
```javascript
const isWa = !header.includes("waktu") && 
             (/whatsapp|\bwa\b|no\.?\s*wa|nomor\s*wa|telp|telepon|phone|\bhp\b/i.test(header));
```

---

## 5. Kendala 4: Investigasi Scan Ganda (Duplicate Check-In)

### Masalah
Di lapangan, terkadang satu kali scan di browser terbaca dua kali di server. Baris pertama tercatat sukses, lalu beberapa detik kemudian muncul request kedua yang ditolak sistem dengan status `DUPLIKAT`.

Contoh dari execution log backend:
* `13:36:12` - Eksekusi #1: durasi 11.363 ms (sukses)
* `13:36:25` - Eksekusi #2: durasi 7.649 ms (duplikat)

### Penyebab
1. Backend utama menjalankan dua tugas berat berturut-turut: mengirim Webhook eksternal dan menulis langsung ke spreadsheet lain. Saat *cold start*, proses ini memakan waktu ~11,3 detik.
2. Di sisi frontend (`js/api.js`), request HTTP dikawal oleh `AbortController` dengan batas timeout:
   ```javascript
   const DEFAULT_TIMEOUT_MS = 12000; // 12 detik
   ```
3. Waktu eksekusi backend (~11,3 detik) ditambah latensi jaringan internet membuat total waktu melampaui 12 detik.
4. Browser menganggap request timeout (tanda silang merah `(X) exec` di Network DevTools).
5. Mekanisme `postJsonWithRetry` di frontend kemudian otomatis mencoba mengirim ulang (retry).
6. Request pertama sebenarnya sudah selesai dicatat di sheet backend. Maka ketika request retry tiba, backend menolaknya sebagai data duplikat.

### Solusi
1. Menaikkan timeout frontend di `js/api.js` dari **12 detik** menjadi **25 detik** (`DEFAULT_TIMEOUT_MS = 25000`).
2. Menerapkan lazy-loading pencarian sheet pada Webhook backend untuk memangkas waktu eksekusi.

---

## 6. Kendala 5: Urusan Git & Sinkronisasi Branch

### Masalah
Perubahan timeout di `js/api.js` perlu segera online di production (karena web app diakses panitia via browser dari branch `main`), sementara pengerjaan lokal sedang berada di branch `lanjutan` yang memiliki commit fitur lain yang belum siap di-merge penuh.

### Langkah Penanganan
1. Perubahan `js/api.js` di-commit di branch `lanjutan` (`8e157ae`).
2. Switch ke branch `main`, melakukan pull versi remote terbaru.
3. Melakukan `cherry-pick` commit `8e157ae` langsung ke branch `main` (`98c8c22`).
4. Push `main` ke remote repository.
5. Mengembalikan working tree lokal ke branch `lanjutan`.

---

## 7. Kendala 6: Tampilan Mode Scan yang Terpotong di Layar HP

### Masalah
Pada layar handphone atau saat jendela browser dipersempit, tombol pemilihan mode presensi (Masuk vs Keluar) terpotong. Tombol "Masuk (Check-In)" memakan hampir seluruh lebar layar, sementara tombol "Keluar (Check-Out)" terdorong ke kanan hingga teksnya terpotong menjadi `Keluar (Check-...`.

### Penyebab
Elemen di dalam satu tombol terlalu banyak:
* Ada dot indicator (`.mode-dot`)
* Ada ikon SVG arah pintu
* Teks label panjang (`Masuk (Check-In)`)
* Badge status tambahan (`✓ AKTIF`) yang memakan lebar horizontal sekitar 60px

### Solusi
1. Menghapus dot indicator dan badge `✓ AKTIF`. Status aktif sudah sangat kontras melalui warna latar (hijau zamrud untuk Masuk, amber untuk Keluar) dan teks putih.
2. Memperpendek label:
   * Di layar HP (`≤ 540px`): hanya menampilkan teks **Masuk** dan **Keluar** beserta ikon SVG.
   * Di layar desktop: teks pelengkap `(Check-In)` dan `(Check-Out)` tetap ditampilkan secara responsif.
3. Mengatur CSS flexbox menjadi `flex: 1 1 50%` dengan `min-width: 0` agar kedua tombol selalu terbagi rata 50% tanpa pernah keluar dari batas layar.

---

## 8. Kendala 7: Bahaya Tercampurnya Cache Antar Acara dan Antar Sesi

### Masalah
Aplikasi mengandalkan `localStorage` untuk mempercepat pencarian data peserta dan mendukung pemindaian offline. Namun muncul risiko nyata:
* Jika panitia mengganti URL Apps Script (misalnya berpindah ke acara atau spreadsheet baru), data peserta dari acara lama masih tersimpan di cache lokal.
* Jika panitia berganti sesi, hasil pencarian atau status centang dari sesi sebelumnya bisa membingungkan operator.

### Solusi
1. **Fungsi Pembersihan Total (`purgeAllEventData`)**:
   Dijalankan otomatis setiap kali URL backend berganti (baik melalui modal Pengaturan maupun parameter URL `?q=...`):
   * Menghapus cache peserta (`absen_cached_attendees`).
   * Menghapus cache daftar sesi (`absen_cached_sessions`).
   * Mengosongkan riwayat pemindaian lokal (`absen_history`).
   * Menghapus antrean offline (`absen_sync_queue`) agar tidak terkirim ke spreadsheet acara baru.
   * Mereset counter dan tampilan antarmuka sebelum mengunduh data baru dari backend.
2. **Penanganan Pergantian Sesi**:
   Saat operator memilih sesi lain di dropdown:
   * Input pencarian dan daftar hasil pencarian manual langsung dikosongkan.
   * Progress bar loading di bagian atas aktif.
   * Aplikasi otomatis mengambil status kehadiran terbaru peserta khusus untuk sesi yang baru dipilih.
3. **Penyatuan Tombol Refresh Sesi**:
   Tombol putar refresh sesi di bagian atas sekarang sekaligus menyinkronkan database peserta terbaru.

---

## 9. Kendala 8: Input Kontak OTS Menggabungkan Email & WhatsApp (Kolom Tertimpa)

### Masalah
Form pendaftaran di tempat (OTS) pada antarmuka frontend sebelumnya hanya menyediakan satu kolom input gabungan: `No. WhatsApp / Email (Opsional)`. Pada saat bersamaan, backend memasukkan kata kunci `"whatsapp"`, `"no hp"`, `"kontak"`, dan `"email"` ke dalam kategori tunggal `isContact`:
* Jika spreadsheet memiliki kolom terpisah untuk `Email` dan `No WhatsApp`, backend mengisi kedua kolom tersebut dengan teks yang sama persis sehingga data saling bertumpuk/tertimpa.
* Kolom WhatsApp juga disembunyikan dari daftar `customFields` dinamis, sehingga tidak dapat diisi secara mandiri.

### Solusi
1. **Pemisahan Input di Frontend (`index.html` & `js/state.js`)**:
   Input statis bawaan form OTS disederhanakan menjadi khusus `Email (Opsional)` (`ots-email`).
2. **Dynamic WhatsApp Field via Backend (`backend/Code.gs` & `bukber.gs`)**:
   Kategori `isContact` di backend diubah hanya mendeteksi `"email"`. Kolom `No WhatsApp` / `Nomor HP` secara otomatis diperlakukan sebagai kolom kustom dinamis yang dirender ke form OTS **hanya jika** kolom tersebut memang ada di spreadsheet panitia.
3. **Mapping Data Presisi**:
   Data input email hanya mengisi kolom email di sheet `Data Peserta`, sedangkan input WhatsApp/HP masuk melalui parameter kolom dinamis (`customFields`) tanpa merusak data kolom lainnya.

---

## 10. Kendala 9: Antrean Macet Server Busy (Lock Timeout) saat Pemindaian Serentak

### Masalah
Untuk mencegah pemindaian ganda (double-checkin), backend menggunakan `LockService.getScriptLock()`. Namun sebelumnya, seluruh rangkaian proses—mulai dari pembacaan data, penulisan kehadiran peserta, penambahan baris audit di `Log Kehadiran`, hingga sinkronisasi antar-file ke spreadsheet eksternal (`forwardLogToExternalSpreadsheet`) dan pengiriman webhook—dijalankan **di dalam lock**:
* Operasi pembukaan spreadsheet eksternal dan webhook memakan waktu 2.000ms – 4.000ms.
* Akibatnya, satu proses pemindaian menahan kunci selama 4–6 detik.
* Jika 3–4 panitia memindai tiket dalam waktu yang hampir bersamaan di gate berbeda, antrean request melebihi toleransi `tryLock(15000)` (15 detik) dan memicu kegagalan sistemik dengan pesan:
  `Server sibuk memproses antrean presensi, silakan ulangi sesaat lagi (Server Busy / Lock Timeout)`.

### Solusi
1. **Penerapan Pola Micro-Locking**:
   Lingkup penahanan lock dipersingkat menjadi seminimal mungkin:
   * Kunci eksklusif `LockService` hanya digunakan untuk memvalidasi tiket dan menulis status `HADIR`/`CHECKOUT` ke baris peserta di sheet `Data Peserta`.
   * Setelah perubahan cell ditulis dan disinkronkan via `SpreadsheetApp.flush()`, **kunci langsung dilepaskan detik itu juga (`releaseLockOnce()`)**.
   * Durasi penahanan kunci turun drastis dari **~4.500ms menjadi < 300ms** (kapasitas antrean melonjak hingga 15x lipat).
2. **Audit Logging & External Forwarding di Luar Lock**:
   Pencatatan riwayat scan ke tab `Log Kehadiran`, pengiriman log ke spreadsheet eksternal, dan webhook kupon dijalankan **di luar blok lock**. Operasi logging yang memakan waktu tidak lagi menahan atau memblokir pemindaian panitia lain.
3. **Penyelarasan Timeout (27 Detik)**:
   * Backend: Batas waktu tunggu antrean `tryLock` dinaikkan ke **27.000ms (27 detik)**.
   * Frontend (`js/api.js`): Batas toleransi request jaringan dinaikkan menjadi **27.000ms (`DEFAULT_TIMEOUT_MS = 27000`)** agar selaras penuh dengan backend.
4. **Audit Durasi Lock**:
   Menambahkan pencatatan waktu antrean lock (`lockWaitMs`) dan waktu penahanan lock (`lockHeldMs`) ke dalam execution logger agar performa konkurensi terpantau transparan.

---

## 11. Kendala 10: Pencarian Manual Lambat & Tidak Menggunakan Database Sync Lokal

### Masalah
Fitur pencarian manual peserta (berdasarkan Nama, Email, atau ID Tiket) sebelumnya selalu mengirim request jaringan `action: search` ke Google Apps Script:
* Google Apps Script harus membaca ulang seluruh range data peserta (`getDataRange().getValues()`) dan melakukan pencarian baris per baris di server, memakan waktu 2–4 detik.
* Fitur pencarian gagal total jika koneksi internet panitia di lapangan tidak stabil atau offline, padahal data semua peserta sudah tersimpan di browser dari tombol **Sync Database**.

### Solusi
1. **Cache-First Instant Search (`js/app.js`)**:
   Fungsi `performSearch()` diubah menjadi memprioritaskan pencarian langsung dari memori lokal HP (`ns.state.cachedAttendees` di `localStorage`).
   * Waktu pencarian turun menjadi **< 5 milidetik (instan)** tanpa loading spinner.
   * Mendukung pencarian saat offline atau di area dengan sinyal lemah.
2. **Live Typing Debounce**:
   Menambahkan listener otomatis saat operator mengetik minimal 2 karakter (debounce 250ms), sehingga hasil pencarian otomatis muncul tanpa harus menekan tombol "Cari" atau tombol Enter.
3. **Smart Fallback ke Server**:
   Pencarian ke server Google Apps Script hanya dijalankan sebagai fallback jika data sama sekali tidak ditemukan di memori lokal atau jika cache lokal masih kosong.

---

## Ringkasan Akhir Status Sistem

| Bagian | Kondisi Awal | Kondisi Sekarang |
| :--- | :--- | :--- |
| **Sinkronisasi Tab Kupon** | Mengandalkan trigger `onChange` (tidak jalan) | Webhook `doPost` mandiri dengan auto-migration kolom |
| **Pencocokan Kolom WA** | Header "Waktu Daftar" terbaca sebagai WhatsApp | Regex presisi dengan blacklist kata "waktu" |
| **Formula Timestamp** | Error locale koma dan circular reference | Formula titik koma `;` sesuai locale Indonesia |
| **Stabilitas Scan & Lock** | Lock ditahan 4-6 detik, sering timeout 15s | **Micro-Locking (< 300ms)**, log di luar lock, timeout 27s |
| **Input Kontak OTS** | Input gabungan menimpa kolom Email & WA | Input Email mandiri, kolom WhatsApp dinamis otomatis |
| **Pencarian Manual** | Lambat 2-4s nembak GAS, gagal saat offline | **Cache-First Instant (< 5ms)** dari sync lokal + live debounce |
| **Tampilan Mobile** | Tombol mode terpotong di HP | UI ringkas, flex 50-50, bersih tanpa elemen berulang |
| **Manajemen Cache** | Rentan kontaminasi data saat ganti link/sesi | Auto-purge menyeluruh saat URL berubah & auto-refresh per sesi |
