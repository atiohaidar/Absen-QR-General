/**
 * ==============================================================================
 * SYNC LOG KEHADIRAN -> SHEET IKHWAN & AKHWAT (KUPON & MAKAN TRACKER)
 * ==============================================================================
 * Deskripsi:
 * - Script ini mendeteksi new row di sheet "Log Kehadiran" via trigger onChange.
 * - Memisahkan peserta ke tab "Ikhwan" atau "Akhwat" berdasarkan Jenis Kelamin.
 * - Menggunakan Composite Key (Ticket ID + Base ID Sesi / Tanggal):
 *   * Sesi/Tanggal yang sama: Scan IN & OUT memperbarui baris yang sama (1 baris).
 *   * Sesi/Tanggal yang berbeda: Otomatis MENAMBAH BARIS BARU untuk orang yang sama.
 * - Sesi IN  + Status BERHASIL/CHECKIN  -> Checklist "Ambil Kupon" + Timestamp
 * - Sesi OUT + Status CHECKOUT/BERHASIL -> Checklist "Ambil Makan" + Timestamp
 * - Status CHECKOUT_ANOMALI            -> Otomatis checklist KEDUA-DUANYA
 * - Status DIBATALKAN (Revert)         -> Hapus checklist & timestamp sesi terkait
 * - Dilengkapi LockService & PropertiesService (Anti race-condition & Anti duplicate).
 * ==============================================================================
 */

const SYNC_CONFIG = {
  SHEETS: {
    LOG: "Log Kehadiran",
    IKHWAN: "Ikhwan",
    AKHWAT: "Akhwat"
  },
  PROPERTY_KEY_LAST_ROW: "LAST_PROCESSED_LOG_ROW",
  
  // Header kolom sheet target (Ikhwan & Akhwat) - Disarankan ada Tanggal / Sesi
  TARGET_HEADERS: [
    "Ticket ID",
    "Nama",
    "Tanggal / Sesi",
    "Ambil Kupon",
    "Waktu ambil kupon",
    "Ambil makan",
    "Waktu ambil makan",
    "Status",
    "Jenis Kelamin",
    "No Whatsapp"
  ]
};

/**
 * ==============================================================================
 * 1. CUSTOM MENU & TRIGGER
 * ==============================================================================
 */

// Menambahkan menu di Google Spreadsheet agar bisa dijalankan via 1-klik tanpa buka Apps Script
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("⚡ Sync Kupon")
    .addItem("▶️ Proses Baris Baru Sekarang", "processNewLogKehadiran")
    .addItem("🔄 Proses Ulang Semua Log (Reset)", "reprocessAllLogs")
    .addSeparator()
    .addItem("📍 Cek Status Baris Terakhir (Pointer)", "checkPointerStatus")
    .addToUi();
}

/**
 * Trigger installable On change
 */
function handleSpreadsheetChange(e) {
  // Kalau user copas manual ke baris kosong, Google mengirim changeType 'EDIT'
  // Jadi kita proses apapun event-nya selama ada baris log baru.
  processNewLogKehadiran();
}

/**
 * ==============================================================================
 * 2. CORE PROCESSING LOGIC
 * ==============================================================================
 */
function processNewLogKehadiran() {
  const lock = LockService.getScriptLock();
  // Tunggu maksimal 15 detik jika ada proses scan lain yang sedang berjalan
  if (!lock.tryLock(15000)) {
    Logger.log("⚠️ Proses lain sedang berjalan. Task ini dilewati.");
    return;
  }

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const logSheet = ss.getSheetByName(SYNC_CONFIG.SHEETS.LOG);
    if (!logSheet) {
      Logger.log("❌ Sheet " + SYNC_CONFIG.SHEETS.LOG + " tidak ditemukan!");
      return;
    }

    const lastLogRow = logSheet.getLastRow();
    if (lastLogRow <= 1) {
      Logger.log("ℹ️ Sheet Log Kehadiran masih kosong (hanya header).");
      return;
    }

    const scriptProps = PropertiesService.getScriptProperties();
    let lastProcessedRow = parseInt(scriptProps.getProperty(SYNC_CONFIG.PROPERTY_KEY_LAST_ROW) || "1", 10);

    // Jika tidak ada baris baru
    if (lastLogRow <= lastProcessedRow) {
      Logger.log("ℹ️ Tidak ada baris baru. Last processed row: " + lastProcessedRow);
      return;
    }

    // Pastikan sheet Ikhwan & Akhwat sudah ada dan punya header
    const ikhwanSheet = getOrCreateTargetSheet(ss, SYNC_CONFIG.SHEETS.IKHWAN);
    const akhwatSheet = getOrCreateTargetSheet(ss, SYNC_CONFIG.SHEETS.AKHWAT);

    // Ambil data baris baru saja (dari lastProcessedRow + 1 s.d lastLogRow)
    const numRowsToProcess = lastLogRow - lastProcessedRow;
    const logRange = logSheet.getRange(lastProcessedRow + 1, 1, numRowsToProcess, logSheet.getLastColumn());
    const newLogs = logRange.getValues();

    // Mapping header sheet log untuk mendapatkan indeks kolom secara dinamis
    const logHeaders = logSheet.getRange(1, 1, 1, logSheet.getLastColumn()).getValues()[0];
    const colIdx = mapLogHeaders(logHeaders);

    // Load data existing di target sheets untuk fast in-memory lookup dengan Composite Key
    const ikhwanData = loadTargetSheetIndex(ikhwanSheet);
    const akhwatData = loadTargetSheetIndex(akhwatSheet);

    Logger.log(`Memproses ${newLogs.length} log baru (Row ${lastProcessedRow + 1} - ${lastLogRow})...`);

    // Proses tiap log baris demi baris
    for (let i = 0; i < newLogs.length; i++) {
      const row = newLogs[i];

      const timestampLog = row[colIdx.timestamp] || new Date();
      const idSesi       = String(row[colIdx.idSesi] || "").trim();
      const ticketId     = String(row[colIdx.ticketId] || "").trim();
      const namaPeserta  = String(row[colIdx.nama] || "").trim();
      const statusScan   = String(row[colIdx.statusScan] || "").toUpperCase().trim();
      const statusPeserta= String(row[colIdx.statusPeserta] || "").trim();
      const jenisKelamin = String(row[colIdx.jenisKelamin] || "").trim();
      const noWhatsapp   = String(row[colIdx.noWa] || "").trim();

      if (!ticketId) continue;

      // Base ID Sesi (menghilangkan _IN / _OUT) untuk membedakan sesi/tanggal
      const baseSession = getBaseSession(idSesi);

      // Composite Key: Ticket ID + Base ID Sesi
      // Contoh: "BUKBER_MSU_TPPGMF_BUKBER_SENIN_KAMIS_2026-10-25"
      const compositeKey = baseSession ? `${ticketId}_${baseSession}` : ticketId;

      // Tentukan target sheet berdasarkan Jenis Kelamin
      const isAkhwat = isFemaleGender(jenisKelamin);
      const targetSheet = isAkhwat ? akhwatSheet : ikhwanSheet;
      const targetCache = isAkhwat ? akhwatData : ikhwanData;
      const colMap = mapTargetColumns(targetSheet);

      // Deteksi Tipe Sesi (IN = Ambil Kupon, OUT = Ambil Makan)
      const sessionType = detectSessionType(idSesi, statusScan);

      // Status boolean & waktu update
      const isAnomalyOut = statusScan.includes("ANOMALI");
      const isSuccessIn  = (sessionType === "IN") && (statusScan === "BERHASIL" || statusScan === "SUKSES" || statusScan === "CHECKIN");
      const isSuccessOut = (sessionType === "OUT") && (statusScan === "CHECKOUT" || statusScan === "BERHASIL" || statusScan === "SUKSES" || isAnomalyOut);
      
      // Deteksi pembatalan (DIBATALKAN, BATAL, CANCEL, dsb)
      const isCanceled   = statusScan.includes("BATAL") || statusScan.includes("CANCEL");

      // Cek apakah (Peserta + Sesi ini) sudah ada di sheet target
      if (!targetCache.ticketMap.hasOwnProperty(compositeKey)) {
        // --- BARIS BARU (Peserta baru / Sesi tanggal baru) ---
        // Persiapkan kolom huruf untuk formula dinamis
        const nextRow = targetSheet.getLastRow() + 1;
        const kuponCheckLetter = colMap.kupon > 0 ? getColumnLetter(colMap.kupon) : "C";
        const kuponTimeLetter  = colMap.waktuKupon > 0 ? getColumnLetter(colMap.waktuKupon) : "D";
        const makanCheckLetter = colMap.makan > 0 ? getColumnLetter(colMap.makan) : "E";
        const makanTimeLetter  = colMap.waktuMakan > 0 ? getColumnLetter(colMap.waktuMakan) : "F";

        const formulaKupon = buildTimestampFormula(kuponCheckLetter, kuponTimeLetter, nextRow);
        const formulaMakan = buildTimestampFormula(makanCheckLetter, makanTimeLetter, nextRow);

        if (isAnomalyOut) {
          // CHECKOUT_ANOMALI: langsung checklist dua-duanya
          ambilKupon = true;
          waktuKupon = formatTimestamp(timestampLog);
          ambilMakan = true;
          waktuMakan = formatTimestamp(timestampLog);
        } else if (isSuccessIn) {
          ambilKupon = true;
          waktuKupon = formatTimestamp(timestampLog);
          ambilMakan = false;
          waktuMakan = formulaMakan; // Pasang formula jika makan masih kosong
        } else if (isSuccessOut) {
          ambilKupon = false;
          waktuKupon = formulaKupon; // Pasang formula jika kupon masih kosong
          ambilMakan = true;
          waktuMakan = formatTimestamp(timestampLog);
        } else {
          // Default: pasang formula di kedua cell waktu
          waktuKupon = formulaKupon;
          waktuMakan = formulaMakan;
        }

        // Susun nilai baris baru sesuai urutan header target sheet
        const targetHeaders = targetSheet.getRange(1, 1, 1, targetSheet.getLastColumn()).getValues()[0];
        const newRowValues = targetHeaders.map(h => {
          const s = String(h).toLowerCase();
          if (s.includes("ticket") || s.includes("tiket")) return ticketId;
          if (s === "nama" || s.includes("nama peserta")) return namaPeserta;
          if (s.includes("sesi") || s.includes("tanggal") || s.includes("date")) return baseSession;
          if (s.includes("waktu ambil kupon") || s.includes("waktu kupon")) return waktuKupon;
          if (s.includes("kupon")) return ambilKupon;
          if (s.includes("waktu ambil makan") || s.includes("waktu makan")) return waktuMakan;
          if (s.includes("makan")) return ambilMakan;
          if (s.includes("jenis kelamin") || s.includes("gender")) return jenisKelamin;
          if (!s.includes("waktu") && (s.includes("whatsapp") || s.includes("no wa") || s.includes("nomor wa") || s.includes("telepon") || s.includes("phone") || s.includes("hp") || /\bwa\b/i.test(s))) return noWhatsapp;
          if (s === "status" || s.includes("status peserta")) return statusPeserta;
          return "";
        });

        targetSheet.appendRow(newRowValues);
        const newRowIndex = targetSheet.getLastRow();

        // Pasang checkbox validation pada kolom Kupon & Makan
        if (colMap.kupon > 0) targetSheet.getRange(newRowIndex, colMap.kupon).insertCheckboxes();
        if (colMap.makan > 0) targetSheet.getRange(newRowIndex, colMap.makan).insertCheckboxes();

        // Format cell waktu menjadi dd/MM/yyyy HH:mm:ss
        if (colMap.waktuKupon > 0) targetSheet.getRange(newRowIndex, colMap.waktuKupon).setNumberFormat("dd/MM/yyyy HH:mm:ss");
        if (colMap.waktuMakan > 0) targetSheet.getRange(newRowIndex, colMap.waktuMakan).setNumberFormat("dd/MM/yyyy HH:mm:ss");

        // Update in-memory cache dengan composite key
        targetCache.ticketMap[compositeKey] = newRowIndex;
      } else {
        // --- BARIS SUDAH ADA (Update status di sesi/tanggal yang sama) ---
        const targetRow = targetCache.ticketMap[compositeKey];
        const kuponCheckLetter = colMap.kupon > 0 ? getColumnLetter(colMap.kupon) : "C";
        const kuponTimeLetter  = colMap.waktuKupon > 0 ? getColumnLetter(colMap.waktuKupon) : "D";
        const makanCheckLetter = colMap.makan > 0 ? getColumnLetter(colMap.makan) : "E";
        const makanTimeLetter  = colMap.waktuMakan > 0 ? getColumnLetter(colMap.waktuMakan) : "F";

        if (isAnomalyOut) {
          if (colMap.kupon > 0) targetSheet.getRange(targetRow, colMap.kupon).setValue(true);
          if (colMap.waktuKupon > 0) {
            const timeCell = targetSheet.getRange(targetRow, colMap.waktuKupon);
            const val = timeCell.getValue();
            if (!val || String(val).startsWith("=")) timeCell.setValue(formatTimestamp(timestampLog));
            timeCell.setNumberFormat("dd/MM/yyyy HH:mm:ss");
          }
          if (colMap.makan > 0) targetSheet.getRange(targetRow, colMap.makan).setValue(true);
          if (colMap.waktuMakan > 0) {
            targetSheet.getRange(targetRow, colMap.waktuMakan).setValue(formatTimestamp(timestampLog)).setNumberFormat("dd/MM/yyyy HH:mm:ss");
          }

        } else if (sessionType === "IN") {
          if (colMap.kupon > 0 && colMap.waktuKupon > 0) {
            const checkCell = targetSheet.getRange(targetRow, colMap.kupon);
            const timeCell  = targetSheet.getRange(targetRow, colMap.waktuKupon);

            if (isSuccessIn) {
              checkCell.setValue(true);
              timeCell.setValue(formatTimestamp(timestampLog)).setNumberFormat("dd/MM/yyyy HH:mm:ss");
            } else if (isCanceled) {
              checkCell.setValue(false);
              // Kembalikan ke formula otomatis jika dibatalkan (menggunakan setValue dengan titik koma)
              timeCell.setValue(buildTimestampFormula(kuponCheckLetter, kuponTimeLetter, targetRow)).setNumberFormat("dd/MM/yyyy HH:mm:ss");
            }
          }
        } else if (sessionType === "OUT") {
          if (colMap.makan > 0 && colMap.waktuMakan > 0) {
            const checkCell = targetSheet.getRange(targetRow, colMap.makan);
            const timeCell  = targetSheet.getRange(targetRow, colMap.waktuMakan);

            if (isSuccessOut) {
              checkCell.setValue(true);
              timeCell.setValue(formatTimestamp(timestampLog)).setNumberFormat("dd/MM/yyyy HH:mm:ss");
            } else if (isCanceled) {
              checkCell.setValue(false);
              // Kembalikan ke formula otomatis jika dibatalkan (menggunakan setValue dengan titik koma)
              timeCell.setValue(buildTimestampFormula(makanCheckLetter, makanTimeLetter, targetRow)).setNumberFormat("dd/MM/yyyy HH:mm:ss");
            }
          }
        }
      }
    }

    // Simpan pointer row terakhir yang sudah berhasil diproses
    scriptProps.setProperty(SYNC_CONFIG.PROPERTY_KEY_LAST_ROW, String(lastLogRow));
    Logger.log("✅ Berhasil memproses log sampai baris: " + lastLogRow);

    // Tampilkan notifikasi popup langsung di Google Sheets
    try {
      ss.toast(`Berhasil memproses ${newLogs.length} baris log baru ke Ikhwan/Akhwat!`, "⚡ Sync Kupon Sukses", 4);
    } catch (e) {}

  } catch (error) {
    Logger.log("❌ Error saat memproses log kehadiran: " + error.toString());
    try {
      SpreadsheetApp.getActiveSpreadsheet().toast(`Error: ${error.message}`, "❌ Sync Gagal", 6);
    } catch (e) {}
  } finally {
    lock.releaseLock();
  }
}

/**
 * ==============================================================================
 * 3. HELPER FUNCTIONS
 * ==============================================================================
 */

/**
 * Ekstrak Base ID Sesi dengan menghilangkan suffix _IN atau _OUT
 * Contoh: "BUKBER_SENIN_KAMIS_2026-10-25_IN" -> "BUKBER_SENIN_KAMIS_2026-10-25"
 */
function getBaseSession(idSesi) {
  let s = String(idSesi || "").trim();
  s = s.replace(/_(IN|OUT)$/i, "");
  return s;
}

/**
 * Deteksi apakah sesi bertipe IN atau OUT
 * Bisa mendeteksi dari ID Sesi (_IN / _OUT) atau langsung dari Status Scan (CHECKOUT)
 */
function detectSessionType(idSesi, statusScan) {
  const upper = String(idSesi || "").toUpperCase();
  const statusUpper = String(statusScan || "").toUpperCase();

  // Prioritas deteksi OUT / Ambil Makan
  if (statusUpper === "CHECKOUT" || statusUpper.includes("CHECKOUT") || upper.endsWith("_OUT") || upper.includes("_OUT_") || upper.includes("KELUAR")) {
    return "OUT";
  }

  // Deteksi IN / Ambil Kupon
  if (statusUpper === "CHECKIN" || upper.endsWith("_IN") || upper.includes("_IN_") || upper.includes("MASUK")) {
    return "IN";
  }

  return "UNKNOWN";
}

/**
 * Deteksi apakah jenis kelamin perempuan / akhwat
 */
function isFemaleGender(genderString) {
  const s = String(genderString).toLowerCase();
  return s.includes("perempuan") || s.includes("akhwat") || s.includes("wanita") || s === "p";
}

/**
 * Format timestamp log agar rapi (DD/MM/YYYY HH:mm:ss)
 */
function formatTimestamp(val) {
  if (!val) return "";
  const d = (val instanceof Date) ? val : new Date(val);
  if (isNaN(d.getTime())) return String(val);
  
  return Utilities.formatDate(d, Session.getScriptTimeZone() || "Asia/Jakarta", "dd/MM/yyyy HH:mm:ss");
}

/**
 * Konversi angka kolom (1, 2, 3...) menjadi huruf kolom ("A", "B", "C"...)
 */
function getColumnLetter(colIndex) {
  let letter = "";
  let temp = colIndex;
  while (temp > 0) {
    let mod = (temp - 1) % 26;
    letter = String.fromCharCode(65 + mod) + letter;
    temp = Math.floor((temp - mod) / 26);
  }
  return letter;
}

/**
 * Membuat formula waktu circular static (Locale Indonesia menggunakan titik koma):
 * =IF(C2=TRUE; IF(D2<>""; D2; NOW()); "")
 */
function buildTimestampFormula(checkColLetter, timeColLetter, rowNum) {
  return `=IF(${checkColLetter}${rowNum}=TRUE; IF(${timeColLetter}${rowNum}<>""; ${timeColLetter}${rowNum}; NOW()); "")`;
}

/**
 * Memetakan indeks header Log Kehadiran secara fleksibel
 */
function mapLogHeaders(headers) {
  const map = {
    timestamp: 0,
    idSesi: 1,
    namaSesi: 2,
    ticketId: 3,
    nama: 4,
    statusScan: 5,
    statusPeserta: 13,
    jenisKelamin: 14,
    noWa: 16
  };

  headers.forEach((h, idx) => {
    const s = String(h).toLowerCase();
    if (s.includes("timestamp")) map.timestamp = idx;
    else if (s.includes("id sesi")) map.idSesi = idx;
    else if (s.includes("nama sesi")) map.namaSesi = idx;
    else if (s.includes("ticket id") || s.includes("tiket")) map.ticketId = idx;
    else if (s.includes("nama peserta") || s === "nama") map.nama = idx;
    else if (s.includes("status scan")) map.statusScan = idx;
    else if (s.includes("jenis kelamin") || s.includes("gender")) map.jenisKelamin = idx;
    else if (!s.includes("waktu") && (s.includes("whatsapp") || s.includes("no wa") || s.includes("nomor wa") || s.includes("no telp") || s.includes("telepon") || s.includes("phone") || s.includes("hp") || /\bwa\b/i.test(s))) map.noWa = idx;
    else if (s === "status" || s.includes("status peserta")) map.statusPeserta = idx;
  });

  return map;
}

/**
 * Memetakan kolom di sheet target (Ikhwan/Akhwat) secara dinamis
 */
function mapTargetColumns(sheet) {
  const lastCol = sheet.getLastColumn();
  const headers = lastCol > 0 ? sheet.getRange(1, 1, 1, lastCol).getValues()[0] : [];
  
  const map = {
    ticket: 1,
    nama: 2,
    sesi: -1,
    kupon: 3,
    waktuKupon: 4,
    makan: 5,
    waktuMakan: 6,
    status: 7,
    gender: 8,
    wa: 9
  };

  headers.forEach((h, idx) => {
    const s = String(h).toLowerCase();
    const col1 = idx + 1; // 1-based index
    if (s.includes("ticket") || s.includes("tiket")) map.ticket = col1;
    else if (s === "nama" || s.includes("nama peserta")) map.nama = col1;
    else if (s.includes("sesi") || s.includes("tanggal") || s.includes("date")) map.sesi = col1;
    else if (s.includes("waktu ambil kupon") || s.includes("waktu kupon")) map.waktuKupon = col1;
    else if (s.includes("kupon")) map.kupon = col1;
    else if (s.includes("waktu ambil makan") || s.includes("waktu makan")) map.waktuMakan = col1;
    else if (s.includes("makan")) map.makan = col1;
    else if (s.includes("jenis kelamin") || s.includes("gender")) map.gender = col1;
    else if (!s.includes("waktu") && (s.includes("whatsapp") || s.includes("no wa") || s.includes("nomor wa") || s.includes("telepon") || s.includes("phone") || s.includes("hp") || /\bwa\b/i.test(s))) map.wa = col1;
    else if (s === "status") map.status = col1;
  });

  return map;
}

/**
 * Pastikan sheet target (Ikhwan / Akhwat) sudah ada & memiliki header
 */
function getOrCreateTargetSheet(ss, sheetName) {
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
  }

  // Jika masih kosong, buat header baris 1
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(SYNC_CONFIG.TARGET_HEADERS);
    const headerRange = sheet.getRange(1, 1, 1, SYNC_CONFIG.TARGET_HEADERS.length);
    headerRange.setFontWeight("bold")
               .setBackground("#0f766e")
               .setFontColor("#ffffff");
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/**
 * Load index (Ticket ID + Base ID Sesi) -> Row Number untuk target sheet
 */
function loadTargetSheetIndex(sheet) {
  const ticketMap = {};
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();

  if (lastRow > 1 && lastCol > 0) {
    const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    const colTicket = headers.findIndex(h => /ticket|tiket/i.test(String(h)));
    const colSesi   = headers.findIndex(h => /sesi|tanggal|date/i.test(String(h)));

    const values = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
    for (let r = 0; r < values.length; r++) {
      const ticketId = String(values[r][colTicket >= 0 ? colTicket : 0] || "").trim();
      const sesi     = colSesi >= 0 ? String(values[r][colSesi] || "").trim() : "";

      if (ticketId) {
        // Key bisa berupa "TICKET_SESI" atau cuma "TICKET" jika belum ada kolom sesi
        const key = sesi ? `${ticketId}_${sesi}` : ticketId;
        ticketMap[key] = r + 2; // Row number di sheet (1-based index)
      }
    }
  }
  return { sheet, ticketMap };
}

/**
 * ==============================================================================
 * 4. UTILITIES / ADMIN TOOLS
 * ==============================================================================
 */

/**
 * Jalankan ini jika ingin me-reset pointer dan memproses ulang SEMUA log dari awal
 */
function reprocessAllLogs() {
  PropertiesService.getScriptProperties().deleteProperty(SYNC_CONFIG.PROPERTY_KEY_LAST_ROW);
  Logger.log("🔄 Pointer di-reset! Menjalankan proses ulang...");
  try {
    SpreadsheetApp.getActiveSpreadsheet().toast("Pointer direset. Memproses ulang dari baris awal...", "🔄 Reset & Sync", 3);
  } catch (e) {}
  processNewLogKehadiran();
}

/**
 * Cek status pointer baris terakhir yang sudah diproses
 */
function checkPointerStatus() {
  const currentPointer = PropertiesService.getScriptProperties().getProperty(SYNC_CONFIG.PROPERTY_KEY_LAST_ROW) || "Belum ada pointer (Row 1)";
  const msg = "📍 Pointer saat ini berada di baris: " + currentPointer;
  Logger.log(msg);
  try {
    SpreadsheetApp.getUi().alert("Status Pointer", msg, SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (e) {
    SpreadsheetApp.getActiveSpreadsheet().toast(msg, "Status Pointer", 5);
  }
}
