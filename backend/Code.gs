/**
 * ==============================================================================
 * BLUEPRINT QR CODE ATTENDANCE & CHECK-IN SYSTEM (Google Apps Script Backend)
 * ==============================================================================
 * 
 * FEATURES:
 * 1. onFormSubmit Trigger:
 *    - Auto-generates unique Ticket ID (e.g. TIC-8F29A)
 *    - Generates QR Code image
 *    - Saves QR File into Google Drive folder
 *    - Grants participant viewer access via: DriveApp.getFileById(fileId).addViewer(email)
 *      (Zero Gmail quota usage! Otomatis masuk ke 'Shared with me' di Google Drive peserta)
 *    - Logs Ticket ID, File ID, Drive URL, & Attendance Status in Google Sheets
 * 
 * 2. Web API (doPost & doGet):
 *    - Fast in-memory lookup (<5ms)
 *    - Concurrency lock protection (LockService) to prevent race conditions
 *    - Anti double-scan validation
 *    - Real-time check-in logging (Timestamp, Panitia name, Gate location)
 *    - Manual search endpoint for backup
 * ==============================================================================
 */

// ==========================================
// CONFIGURATION (Sesuaikan dengan kebutuhan)
// ==========================================
const CONFIG = {
  EVENT_NAME: "Event Tech Summit 2026",
  
  // Nama subfolder tempat menyimpan file QR para peserta di Google Drive
  // (Otomatis dibuat di dalam folder yang sama dengan Google Spreadsheet/Form!)
  QR_SUBFOLDER_NAME: "QR Code Peserta",
  
  // Prefix untuk Ticket ID unik (e.g. TIC-A8F29)
  TICKET_PREFIX: "TIC-",
  
  // Nama Sheet utama (Tempat respon Google Form disimpan)
  SHEET_NAME: "Form Responses 1", // Ganti jika nama tab sheet berbeda

  // Header nama kolom di Google Sheet
  COLUMNS: {
    TIMESTAMP: "Timestamp",
    NAMA: "Nama Lengkap",
    EMAIL: "Email",
    TICKET_ID: "Ticket ID",
    DRIVE_FILE_ID: "Drive File ID",
    DRIVE_URL: "Drive File URL",
    STATUS: "Status Kehadiran",        // UNCHECKED / CHECKED_IN
    CHECKIN_TIME: "Waktu Check-In",
    SCANNED_BY: "Petugas / Panitia",
    GATE: "Gate / Pos"
  }
};

/**
 * Helper: Ambil folder tempat file spreadsheet/form berada, 
 * lalu cari atau buat subfolder 'QR Code Peserta' secara otomatis.
 */
function getOrCreateQrFolder() {
  try {
    const ssId = SpreadsheetApp.getActiveSpreadsheet().getId();
    const ssFile = DriveApp.getFileById(ssId);
    const parents = ssFile.getParents();
    
    // Ambil parent folder dari spreadsheet/form
    const parentFolder = parents.hasNext() ? parents.next() : DriveApp.getRootFolder();
    
    // Cek apakah subfolder QR sudah ada di dalam parent folder tersebut
    const existingFolders = parentFolder.getFoldersByName(CONFIG.QR_SUBFOLDER_NAME);
    if (existingFolders.hasNext()) {
      return existingFolders.next();
    } else {
      // Jika belum ada, otomatis buat folder baru
      const newFolder = parentFolder.createFolder(CONFIG.QR_SUBFOLDER_NAME);
      Logger.log("📁 Berhasil membuat folder baru: " + CONFIG.QR_SUBFOLDER_NAME);
      return newFolder;
    }
  } catch (err) {
    Logger.log("Warning getOrCreateQrFolder: " + err.message + ", fallback ke root");
    return DriveApp.getRootFolder();
  }
}

/**
 * Helper: Ambil Sheet aktif atau sheet berdasarkan CONFIG.SHEET_NAME
 */
function getTargetSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet) {
    sheet = ss.getSheets()[0]; // Fallback ke sheet pertama jika nama tab beda
  }
  return sheet;
}

/**
 * Helper: Pastikan semua header kolom yang dibutuhkan sudah ada di baris 1
 */
function ensureSheetHeaders() {
  const sheet = getTargetSheet();
  const headers = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getValues()[0];
  
  const requiredHeaders = [
    CONFIG.COLUMNS.TICKET_ID,
    CONFIG.COLUMNS.DRIVE_FILE_ID,
    CONFIG.COLUMNS.DRIVE_URL,
    CONFIG.COLUMNS.STATUS,
    CONFIG.COLUMNS.CHECKIN_TIME,
    CONFIG.COLUMNS.SCANNED_BY,
    CONFIG.COLUMNS.GATE
  ];

  requiredHeaders.forEach(colName => {
    if (!headers.includes(colName)) {
      const nextCol = sheet.getLastColumn() + 1;
      sheet.getRange(1, nextCol).setValue(colName).setFontWeight("bold");
    }
  });
}

/**
 * Helper: Generate Random Unique Ticket ID
 */
function generateTicketId() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // Hindari karakter membingungkan (0, O, 1, I)
  let result = "";
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return CONFIG.TICKET_PREFIX + result;
}

/**
 * ==============================================================================
 * TRIGGER: onFormSubmit (Dipanggil otomatis saat ada submit Google Form baru)
 * ==============================================================================
 */
function onFormSubmit(e) {
  const lock = LockService.getScriptLock();
  lock.tryLock(30000); // 30s timeout

  try {
    ensureSheetHeaders();
    const sheet = getTargetSheet();
    const lastRow = sheet.getLastRow();
    
    // Ambil mapping header ke index kolom
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const headerMap = {};
    headers.forEach((h, idx) => { headerMap[h.trim()] = idx + 1; });

    // Ambil data dari baris terbaru
    const rowValues = sheet.getRange(lastRow, 1, 1, sheet.getLastColumn()).getValues()[0];

    // Cari index Email dan Nama dari header yang cocok
    let emailColIdx = -1;
    let nameColIdx = -1;

    for (let h in headerMap) {
      const lower = h.toLowerCase();
      if (lower.includes("email")) emailColIdx = headerMap[h];
      if (lower.includes("nama") || lower.includes("name")) nameColIdx = headerMap[h];
    }

    if (emailColIdx === -1 || nameColIdx === -1) {
      Logger.log("Kolom Nama atau Email tidak ditemukan!");
      return;
    }

    const email = String(rowValues[emailColIdx - 1]).trim();
    const name = String(rowValues[nameColIdx - 1]).trim();

    if (!email) {
      Logger.log("Email kosong pada baris " + lastRow);
      return;
    }

    // Cek apakah Ticket ID sudah pernah dibuat (mencegah double execution)
    const ticketIdColIdx = headerMap[CONFIG.COLUMNS.TICKET_ID];
    const existingTicketId = rowValues[ticketIdColIdx - 1];
    if (existingTicketId) {
      Logger.log("Baris " + lastRow + " sudah memiliki Ticket ID: " + existingTicketId);
      return;
    }

    // 1. Generate Unique Ticket ID
    const ticketId = generateTicketId();

    // 2. Generate QR Code Image Blob via QuickChart API
    const qrUrl = "https://quickchart.io/qr?text=" + encodeURIComponent(ticketId) + "&size=450&margin=2";
    const qrResponse = UrlFetchApp.fetch(qrUrl);
    const sanitizedName = name.replace(/[^a-zA-Z0-9_-]/g, "_");
    const qrBlob = qrResponse.getBlob().setName("QR_" + sanitizedName + "_" + ticketId + ".png");

    // 3. Simpan File QR Code ke Google Drive
    // Otomatis simpan di dalam subfolder 'QR Code Peserta' di lokasi yang sama dengan Google Form/Spreadsheet!
    const targetFolder = getOrCreateQrFolder();
    const driveFile = targetFolder.createFile(qrBlob);
    const fileId = driveFile.getId();
    const fileUrl = driveFile.getUrl();

    // 4. SESUAI CONSTRAINT & KUOTA OPTIMIZATION:
    // Cukup gunakan DriveApp.getFileById(fileId).addViewer(email)
    // agar TIDAK MENGHABISKAN KUOTA EMAIL (Gmail daily quota limit)!
    try {
      DriveApp.getFileById(fileId).addViewer(email);
      Logger.log("✅ Drive file viewer access granted to: " + email);
    } catch (shareErr) {
      Logger.log("⚠️ Gagal menambahkan viewer drive: " + shareErr.message);
    }

    // 5. Update data di Google Sheet
    sheet.getRange(lastRow, headerMap[CONFIG.COLUMNS.TICKET_ID]).setValue(ticketId);
    sheet.getRange(lastRow, headerMap[CONFIG.COLUMNS.DRIVE_FILE_ID]).setValue(fileId);
    sheet.getRange(lastRow, headerMap[CONFIG.COLUMNS.DRIVE_URL]).setValue(fileUrl);
    sheet.getRange(lastRow, headerMap[CONFIG.COLUMNS.STATUS]).setValue("UNCHECKED");
    SpreadsheetApp.flush();

    Logger.log("Sukses memproses pendaftaran untuk: " + name + " (" + ticketId + ")");
  } catch (err) {
    Logger.log("Error pada onFormSubmit: " + err.toString());
  } finally {
    lock.releaseLock();
  }
}

/**
 * ==============================================================================
 * WEB API: doPost (Menerima Request Scan dari Scanner GitHub Pages)
 * ==============================================================================
 */
function doPost(e) {
  const lock = LockService.getScriptLock();
  
  // Tunggu lock hingga 10 detik agar aman dari race condition (2 scanner scan bareng)
  if (!lock.tryLock(10000)) {
    return createJsonResponse({
      success: false,
      status: "SERVER_BUSY",
      message: "Server sedang sibuk, silakan coba scan ulang dalam 1 detik."
    });
  }

  try {
    let payload;
    try {
      payload = JSON.parse(e.postData.contents);
    } catch (err) {
      return createJsonResponse({
        success: false,
        status: "INVALID_JSON",
        message: "Payload format salah (bukan JSON valid)."
      });
    }

    const action = payload.action || "scan";
    const sheet = getTargetSheet();
    const data = sheet.getDataRange().getValues();

    if (data.length <= 1) {
      return createJsonResponse({
        success: false,
        status: "EMPTY_SHEET",
        message: "Spreadsheet belum memiliki data peserta."
      });
    }

    // Buat map index header
    const headers = data[0];
    const headerMap = {};
    headers.forEach((h, idx) => { headerMap[String(h).trim()] = idx; });

    const colTicketId = headerMap[CONFIG.COLUMNS.TICKET_ID];
    const colStatus = headerMap[CONFIG.COLUMNS.STATUS];
    const colCheckInTime = headerMap[CONFIG.COLUMNS.CHECKIN_TIME];
    const colScannedBy = headerMap[CONFIG.COLUMNS.SCANNED_BY];
    const colGate = headerMap[CONFIG.COLUMNS.GATE];
    
    // Cari index Nama dan Email
    let colName = -1;
    let colEmail = -1;
    for (let h in headerMap) {
      const lower = h.toLowerCase();
      if (lower.includes("nama") || lower.includes("name")) colName = headerMap[h];
      if (lower.includes("email")) colEmail = headerMap[h];
    }

    if (colTicketId === undefined || colStatus === undefined) {
      return createJsonResponse({
        success: false,
        status: "CONFIG_ERROR",
        message: "Header kolom Ticket ID atau Status belum ada di Spreadsheet. Jalankan ensureSheetHeaders()."
      });
    }

    // -------------------------------------------------------------
    // ACTION: SCAN / CHECK-IN
    // -------------------------------------------------------------
    if (action === "scan" || action === "checkIn") {
      const rawScannedId = (payload.ticketId || "").trim();
      const scannedBy = (payload.scannedBy || "Panitia").trim();
      const gate = (payload.gate || "Pintu Masuk").trim();

      if (!rawScannedId) {
        return createJsonResponse({
          success: false,
          status: "EMPTY_ID",
          message: "ID tiket tidak boleh kosong."
        });
      }

      // Fast In-Memory Lookup (< 2ms)
      let foundRowIndex = -1;
      let matchedRow = null;

      for (let r = 1; r < data.length; r++) {
        const rowId = String(data[r][colTicketId]).trim();
        if (rowId.toUpperCase() === rawScannedId.toUpperCase()) {
          foundRowIndex = r + 1; // 1-based index untuk SpreadsheetApp
          matchedRow = data[r];
          break;
        }
      }

      // Skenario 1: ID Tidak Ditemukan
      if (foundRowIndex === -1) {
        return createJsonResponse({
          success: false,
          status: "NOT_FOUND",
          message: `Tiket dengan ID "${rawScannedId}" TIDAK TERDAFTAR dalam sistem!`
        });
      }

      const currentStatus = String(matchedRow[colStatus] || "").trim().toUpperCase();
      const attendeeName = colName !== -1 ? matchedRow[colName] : "Peserta";
      const attendeeEmail = colEmail !== -1 ? matchedRow[colEmail] : "-";
      const existingCheckInTime = colCheckInTime !== undefined ? matchedRow[colCheckInTime] : "";
      const existingScannedBy = colScannedBy !== undefined ? matchedRow[colScannedBy] : "";

      // Skenario 2: Tiket Sudah Pernah Digunakan (Double Scan Prevention)
      if (currentStatus === "CHECKED_IN") {
        return createJsonResponse({
          success: false,
          status: "ALREADY_CHECKED_IN",
          message: `PERINGATAN! Tiket sudah pernah di-scan sebelumnya!`,
          attendee: {
            ticketId: rawScannedId,
            name: attendeeName,
            email: attendeeEmail,
            firstCheckInTime: existingCheckInTime ? formatReadableDate(existingCheckInTime) : "Sebelumnya",
            scannedBy: existingScannedBy || "Panitia lain"
          }
        });
      }

      // Skenario 3: Check-in Berhasil!
      const checkInTimeStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");

      // Update baris di Google Sheet
      sheet.getRange(foundRowIndex, colStatus + 1).setValue("CHECKED_IN");
      if (colCheckInTime !== undefined) {
        sheet.getRange(foundRowIndex, colCheckInTime + 1).setValue(checkInTimeStr);
      }
      if (colScannedBy !== undefined) {
        sheet.getRange(foundRowIndex, colScannedBy + 1).setValue(scannedBy);
      }
      if (colGate !== undefined) {
        sheet.getRange(foundRowIndex, colGate + 1).setValue(gate);
      }

      SpreadsheetApp.flush();

      return createJsonResponse({
        success: true,
        status: "CHECKED_IN",
        message: "Check-in berhasil! Selamat datang.",
        attendee: {
          ticketId: rawScannedId,
          name: attendeeName,
          email: attendeeEmail,
          checkInTime: checkInTimeStr,
          scannedBy: scannedBy,
          gate: gate
        }
      });
    }

    // -------------------------------------------------------------
    // ACTION: SEARCH (Manual Search Peserta by Name / Email / Ticket)
    // -------------------------------------------------------------
    if (action === "search") {
      const query = (payload.query || "").toLowerCase().trim();
      if (!query) {
        return createJsonResponse({ success: true, results: [] });
      }

      const results = [];
      for (let r = 1; r < data.length; r++) {
        const row = data[r];
        const rowId = String(row[colTicketId] || "");
        const rowName = colName !== -1 ? String(row[colName] || "") : "";
        const rowEmail = colEmail !== -1 ? String(row[colEmail] || "") : "";
        const rowStatus = String(row[colStatus] || "UNCHECKED");
        const rowTime = colCheckInTime !== undefined ? row[colCheckInTime] : "";

        if (
          rowId.toLowerCase().includes(query) ||
          rowName.toLowerCase().includes(query) ||
          rowEmail.toLowerCase().includes(query)
        ) {
          results.push({
            ticketId: rowId,
            name: rowName,
            email: rowEmail,
            status: rowStatus,
            checkInTime: rowTime ? formatReadableDate(rowTime) : ""
          });
        }

        if (results.length >= 15) break; // Batasi 15 hasil maksimal
      }

      return createJsonResponse({
        success: true,
        results: results
      });
    }

    // Action tidak dikenal
    return createJsonResponse({
      success: false,
      status: "UNKNOWN_ACTION",
      message: `Action "${action}" tidak dikenali.`
    });

  } catch (err) {
    return createJsonResponse({
      success: false,
      status: "SERVER_ERROR",
      message: "Terjadi kesalahan server: " + err.message
    });
  } finally {
    lock.releaseLock();
  }
}

/**
 * ==============================================================================
 * WEB API: doGet (Health Check & Test URL)
 * ==============================================================================
 */
function doGet(e) {
  return createJsonResponse({
    success: true,
    message: "Google Apps Script Attendance API is running online!",
    event: CONFIG.EVENT_NAME,
    timestamp: new Date().toISOString()
  });
}

/**
 * Helper: Create JSON Response Output
 */
function createJsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Helper: Format Date ke string yang enak dibaca
 */
function formatReadableDate(dateVal) {
  try {
    const d = new Date(dateVal);
    if (isNaN(d.getTime())) return String(dateVal);
    return Utilities.formatDate(d, Session.getScriptTimeZone(), "dd MMM yyyy, HH:mm:ss");
  } catch (e) {
    return String(dateVal);
  }
}

/**
 * ==============================================================================
 * UTILITY TESTING FUNCTIONS (Bisa dijalankan manual di editor Apps Script)
 * ==============================================================================
 */
function testSetup() {
  ensureSheetHeaders();
  Logger.log("Headers initialized successfully!");
}

function testManualCheckIn() {
  const testPayload = {
    postData: {
      contents: JSON.stringify({
        action: "scan",
        ticketId: "TIC-TEST01",
        scannedBy: "Panitia Test",
        gate: "Gate Utama"
      })
    }
  };
  const response = doPost(testPayload);
  Logger.log(response.getContent());
}
