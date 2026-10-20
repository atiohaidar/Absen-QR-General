/**
 * ==============================================================================
 * BLUEPRINT QR CODE ATTENDANCE SYSTEM (MULTI-SESSION & REVERT CAPABLE)
 * ==============================================================================
 * 
 * 4-SHEET ARCHITECTURE:
 * 1. "Form Responses 1" -> Raw submission data dari Google Form (IMMUTABLE, TIDAK DIOTAK-ATIK)
 * 2. "Master Sesi"      -> Daftar sesi pertemuan yang diatur oleh Admin [ID Sesi | Nama Sesi | Tanggal | Status]
 * 3. "Data Peserta"     -> Master data peserta & matrix kehadiran per sesi [Ticket ID | Nama | Email | Sesi 1 | Sesi 2 ...]
 * 4. "Log Kehadiran"    -> Audit trail catatan setiap scan [Timestamp | Sesi | Ticket ID | Nama | Status | Panitia | Keterangan]
 * 
 * FITUR UTAMA:
 * - 1 QR Code berlaku untuk seluruh sesi acara (Multi-Session Matrix)
 * - Auto-detect folder & auto-create folder 'QR Code Peserta' di Google Drive
 * - DriveApp.getFileById(fileId).addViewer(email) (Zero email quota usage!)
 * - Dukungan Check-In & PEMBATALAN KEHADIRAN (Cancel / Undo Check-In)
 * - In-memory lookup ultra-fast (<3ms) & Concurrency LockService
 * ==============================================================================
 */

const CONFIG = {
  EVENT_NAME: "Event Tech Series 2026",
  QR_SUBFOLDER_NAME: "QR Code Peserta",
  TICKET_PREFIX: "TIC-",
  
  SHEETS: {
    RAW_FORM: "Form Responses 1",
    MASTER_SESI: "Master Sesi",
    DATA_PESERTA: "Data Peserta",
    LOG_KEHADIRAN: "Log Kehadiran"
  }
};

/**
 * ==============================================================================
 * HELPER: INISIALISASI STRUKTUR 4 SHEET
 * ==============================================================================
 */
function getSpreadsheet() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function getOrCreateSheet(sheetName) {
  const ss = getSpreadsheet();
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
  }
  return sheet;
}

/**
 * Setup header kolom di seluruh sheet yang dibutuhkan
 */
function ensureAllSheetsSetup() {
  const ss = getSpreadsheet();

  // 1. Sheet Master Sesi
  const sheetSesi = getOrCreateSheet(CONFIG.SHEETS.MASTER_SESI);
  if (sheetSesi.getLastRow() === 0) {
    sheetSesi.appendRow(["ID Sesi", "Nama Sesi", "Tanggal Pelaksanaan", "Status"]);
    sheetSesi.getRange(1, 1, 1, 4).setFontWeight("bold").setBackground("#e2e8f0");
    // Tambahkan 3 contoh sesi awal
    sheetSesi.appendRow(["SESI-01", "Pertemuan 1 - Pembukaan & Onboarding", formatDateOnly(new Date()), "AKTIF"]);
    sheetSesi.appendRow(["SESI-02", "Pertemuan 2 - Workshop Inti", formatDateOnly(new Date(Date.now() + 86400000)), "AKTIF"]);
    sheetSesi.appendRow(["SESI-03", "Pertemuan 3 - Evaluasi & Penutupan", formatDateOnly(new Date(Date.now() + 172800000)), "AKTIF"]);
  }

  // 2. Sheet Data Peserta
  const sheetPeserta = getOrCreateSheet(CONFIG.SHEETS.DATA_PESERTA);
  if (sheetPeserta.getLastRow() === 0) {
    const headers = ["Ticket ID", "Nama Lengkap", "Email", "Drive File ID", "Drive File URL", "Waktu Daftar"];
    sheetPeserta.appendRow(headers);
    sheetPeserta.getRange(1, 1, 1, headers.length).setFontWeight("bold").setBackground("#e2e8f0");
  }

  // 3. Sheet Log Kehadiran
  const sheetLog = getOrCreateSheet(CONFIG.SHEETS.LOG_KEHADIRAN);
  if (sheetLog.getLastRow() === 0) {
    const logHeaders = ["Timestamp Log", "ID Sesi", "Nama Sesi", "Ticket ID", "Nama Peserta", "Status Scan", "Petugas / Panitia", "Gate", "Keterangan"];
    sheetLog.appendRow(logHeaders);
    sheetLog.getRange(1, 1, 1, logHeaders.length).setFontWeight("bold").setBackground("#e2e8f0");
  }
}

/**
 * Helper: Ambil atau buat subfolder 'QR Code Peserta' di Google Drive
 */
function getOrCreateQrFolder() {
  try {
    const ssId = getSpreadsheet().getId();
    const ssFile = DriveApp.getFileById(ssId);
    const parents = ssFile.getParents();
    const parentFolder = parents.hasNext() ? parents.next() : DriveApp.getRootFolder();
    
    const existing = parentFolder.getFoldersByName(CONFIG.QR_SUBFOLDER_NAME);
    if (existing.hasNext()) {
      return existing.next();
    } else {
      const newFolder = parentFolder.createFolder(CONFIG.QR_SUBFOLDER_NAME);
      Logger.log("📁 Folder baru dibuat: " + CONFIG.QR_SUBFOLDER_NAME);
      return newFolder;
    }
  } catch (err) {
    Logger.log("Folder error: " + err.message + ", fallback ke root");
    return DriveApp.getRootFolder();
  }
}

function generateTicketId() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let res = "";
  for (let i = 0; i < 6; i++) {
    res += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return CONFIG.TICKET_PREFIX + res;
}

function formatDateOnly(d) {
  return Utilities.formatDate(d, Session.getScriptTimeZone(), "yyyy-MM-dd");
}

function formatFullDateTime(d) {
  return Utilities.formatDate(d, Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
}

/**
 * ==============================================================================
 * TRIGGER: onFormSubmit (MEMBACA DATA FORM TANPA MENGOTAK-ATIK FORM RESPONSES 1)
 * ==============================================================================
 */
function onFormSubmit(e) {
  try {
    ensureAllSheetsSetup();
    const ss = getSpreadsheet();
    
    // 1. Ambil data mentah dari Form Responses 1 (HANYA BACA, TIDAK DIUBAH)
    let sheetRaw = ss.getSheetByName(CONFIG.SHEETS.RAW_FORM);
    if (!sheetRaw) {
      sheetRaw = ss.getSheets()[0]; // Fallback ke sheet pertama
    }
    
    const lastRawRow = sheetRaw.getLastRow();
    if (lastRawRow <= 1) return;

    const rawHeaders = sheetRaw.getRange(1, 1, 1, sheetRaw.getLastColumn()).getValues()[0];
    const rawData = sheetRaw.getRange(lastRawRow, 1, 1, sheetRaw.getLastColumn()).getValues()[0];

    // Cari kolom Nama dan Email di form
    let nameIdx = -1;
    let emailIdx = -1;
    let timeIdx = 0;

    rawHeaders.forEach((h, idx) => {
      const lower = String(h).toLowerCase();
      if (lower.includes("nama") || lower.includes("name")) nameIdx = idx;
      if (lower.includes("email")) emailIdx = idx;
      if (lower.includes("timestamp")) timeIdx = idx;
    });

    if (nameIdx === -1 || emailIdx === -1) {
      Logger.log("Kolom Nama atau Email tidak ditemukan di Form Responses!");
      return;
    }

    const name = String(rawData[nameIdx] || "").trim();
    const email = String(rawData[emailIdx] || "").trim();
    const regTimestamp = rawData[timeIdx] ? formatFullDateTime(new Date(rawData[timeIdx])) : formatFullDateTime(new Date());

    if (!email || !name) return;

    // 2. Cek apakah peserta sudah pernah ada di sheet "Data Peserta" (berdasarkan email)
    const sheetPeserta = getOrCreateSheet(CONFIG.SHEETS.DATA_PESERTA);
    const pesertaData = sheetPeserta.getDataRange().getValues();
    
    for (let r = 1; r < pesertaData.length; r++) {
      if (String(pesertaData[r][2]).trim().toLowerCase() === email.toLowerCase()) {
        Logger.log("Peserta dengan email " + email + " sudah terdaftar di Data Peserta.");
        return;
      }
    }

    // 3. Generate Ticket ID & QR Code Image (DILAKUKAN TANPA MENAHAN SCRIPT LOCK AGAR SCANNER TIDAK TERGANGGU)
    const ticketId = generateTicketId();
    let fileId = "-";
    let fileUrl = "-";

    try {
      const qrUrl = "https://quickchart.io/qr?text=" + encodeURIComponent(ticketId) + "&size=450&margin=2";
      const qrResponse = UrlFetchApp.fetch(qrUrl, { muteHttpExceptions: true });
      if (qrResponse.getResponseCode() === 200) {
        const sanitizedName = name.replace(/[^a-zA-Z0-9_-]/g, "_");
        const qrBlob = qrResponse.getBlob().setName("QR_" + sanitizedName + "_" + ticketId + ".png");

        // 4. Simpan ke Google Drive folder
        const targetFolder = getOrCreateQrFolder();
        const driveFile = targetFolder.createFile(qrBlob);
        fileId = driveFile.getId();
        fileUrl = driveFile.getUrl();

        // 5. SESUAI CONSTRAINT: Share akses file ke peserta tanpa kuota email!
        try {
          DriveApp.getFileById(fileId).addViewer(email);
          Logger.log("✅ Drive file viewer granted to: " + email);
        } catch (shareErr) {
          Logger.log("⚠️ Drive viewer error: " + shareErr.message);
        }
      }
    } catch (qrErr) {
      Logger.log("QR generation warning: " + qrErr.message);
    }

    // 6. Masukkan data ke sheet "Data Peserta" dengan lock singkat (hanya untuk penulisan baris)
    const lock = LockService.getScriptLock();
    if (lock.tryLock(8000)) {
      try {
        sheetPeserta.appendRow([
          ticketId,
          name,
          email,
          fileId,
          fileUrl,
          regTimestamp
        ]);
        Logger.log("✅ Sukses menambahkan peserta baru: " + name + " (" + ticketId + ")");
      } finally {
        lock.releaseLock();
      }
    } else {
      Logger.log("⚠️ Lock timeout saat append row peserta baru, mengabaikan lock.");
      sheetPeserta.appendRow([
        ticketId,
        name,
        email,
        fileId,
        fileUrl,
        regTimestamp
      ]);
    }

  } catch (err) {
    Logger.log("Error onFormSubmit: " + err.message);
  }
}

/**
 * ==============================================================================
 * HELPER: AMBIL ATAU BUAT KOLOM SESI DI SHEET "DATA PESERTA"
 * ==============================================================================
 */
function getOrCreateSessionColumn(sheetPeserta, sessionId, sessionName) {
  const headers = sheetPeserta.getRange(1, 1, 1, sheetPeserta.getLastColumn()).getValues()[0];
  const colHeaderTitle = `Sesi: ${sessionName} [${sessionId}]`;

  // Cari apakah kolom ini sudah ada
  for (let c = 0; c < headers.length; c++) {
    if (String(headers[c]).includes(`[${sessionId}]`)) {
      return c + 1; // 1-based index
    }
  }

  // Jika belum ada, buat kolom sesi baru
  const newColIdx = sheetPeserta.getLastColumn() + 1;
  sheetPeserta.getRange(1, newColIdx)
    .setValue(colHeaderTitle)
    .setFontWeight("bold")
    .setBackground("#dbeafe"); // Soft blue header
  
  return newColIdx;
}

/**
 * ==============================================================================
 * WEB API: doGet (Health check & Ambil Daftar Sesi Aktif)
 * ==============================================================================
 */
function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) || "getSessions";
  
  if (action === "getSessions") {
    ensureAllSheetsSetup();
    const sessions = getActiveSessions();
    return createJsonResponse({
      success: true,
      sessions: sessions,
      timestamp: new Date().toISOString()
    });
  }

  return createJsonResponse({
    success: true,
    message: "EventPass Multi-Session Attendance API is Online!",
    event: CONFIG.EVENT_NAME
  });
}

/**
 * Helper: Ambil sesi berstatus AKTIF dari sheet "Master Sesi"
 */
function getActiveSessions() {
  const sheetSesi = getOrCreateSheet(CONFIG.SHEETS.MASTER_SESI);
  const data = sheetSesi.getDataRange().getValues();
  const sessions = [];

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const id = String(row[0] || "").trim();
    const name = String(row[1] || "").trim();
    const date = row[2] ? formatDateOnly(new Date(row[2])) : "";
    const status = String(row[3] || "AKTIF").trim().toUpperCase();

    if (id && status === "AKTIF") {
      sessions.push({
        id: id,
        name: name,
        date: date,
        status: status,
        label: `${name} (${date || id})`
      });
    }
  }

  return sessions;
}

/**
 * ==============================================================================
 * WEB API: doGet (DIAGNOSTIK, HEALTH CHECK & SINKRONISASI SESI)
 * ==============================================================================
 */
function doGet(e) {
  try {
    ensureAllSheetsSetup();
    const action = (e && e.parameter && e.parameter.action) || "status";

    if (action === "getSessions") {
      return createJsonResponse({
        success: true,
        status: "OK",
        sessions: getActiveSessions(),
        timestamp: new Date().toISOString()
      });
    }

    return createJsonResponse({
      success: true,
      status: "ONLINE",
      app: "EventPass Google Apps Script API",
      timeZone: Session.getScriptTimeZone(),
      activeSessions: getActiveSessions(),
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    return createJsonResponse({
      success: false,
      status: "ERROR",
      message: "Health check error: " + err.message
    });
  }
}

/**
 * ==============================================================================
 * WEB API: doPost (Check-In, Cancel/Undo Check-In, Search, & Register OTS)
 * ==============================================================================
 */
function doPost(e) {
  try {
    ensureAllSheetsSetup();

    let payload = {};
    if (e && e.postData && e.postData.contents) {
      try {
        payload = JSON.parse(e.postData.contents);
      } catch (jsonErr) {
        return createJsonResponse({ success: false, message: "Invalid JSON payload" });
      }
    }

    const action = payload.action || "checkIn";
    const sheetPeserta = getOrCreateSheet(CONFIG.SHEETS.DATA_PESERTA);
    const sheetLog = getOrCreateSheet(CONFIG.SHEETS.LOG_KEHADIRAN);

    // ============================================================================
    // 1. READ-ONLY ACTIONS (PARALEL, ZERO LOCK — TIDAK MENGUNCI & TIDAK DIKUNCI)
    // ============================================================================

    // ACTION A: GET ACTIVE SESSIONS
    if (action === "getSessions") {
      return createJsonResponse({
        success: true,
        sessions: getActiveSessions()
      });
    }

    // ACTION B: SEARCH PESERTA (Manual Search by Name/Email/Ticket)
    if (action === "search") {
      const query = (payload.query || "").toLowerCase().trim();
      const sessionId = (payload.sessionId || "SESI-01").trim();
      const sessionName = (payload.sessionName || sessionId).trim();

      if (!query) {
        return createJsonResponse({ success: true, results: [] });
      }

      const pesertaData = sheetPeserta.getDataRange().getValues();
      const sessionColIdx = getOrCreateSessionColumn(sheetPeserta, sessionId, sessionName);
      const results = [];

      for (let r = 1; r < pesertaData.length; r++) {
        const row = pesertaData[r];
        const tId = String(row[0] || "");
        const tName = String(row[1] || "");
        const tEmail = String(row[2] || "");
        const currentSessionStatus = String(row[sessionColIdx - 1] || "");

        if (tId.toLowerCase().includes(query) || tName.toLowerCase().includes(query) || tEmail.toLowerCase().includes(query)) {
          const isHadir = currentSessionStatus.startsWith("HADIR");
          results.push({
            ticketId: tId,
            name: tName,
            email: tEmail,
            status: isHadir ? "HADIR" : "BELUM_HADIR",
            statusDetail: currentSessionStatus || "Belum Absen",
            sessionId: sessionId,
            sessionName: sessionName
          });
        }
        if (results.length >= 20) break; // Limit 20 hasil teratas
      }

      return createJsonResponse({ success: true, results: results });
    }

    // ============================================================================
    // 2. MUTATION ACTIONS (CHECK-IN, CANCEL, OTS) -> MEMERLUKAN EXCLUSIVE LOCK
    // ============================================================================
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(15000)) {
      return createJsonResponse({
        success: false,
        status: "SERVER_BUSY",
        message: "Server sibuk memproses antrean presensi, silakan ulangi sesaat lagi."
      });
    }

    try {
      const pesertaData = sheetPeserta.getDataRange().getValues();

      // -------------------------------------------------------------
      // ACTION C: CHECK-IN SESI TERTENTU
      // -------------------------------------------------------------
      if (action === "checkIn" || action === "scan") {
        const ticketId = (payload.ticketId || "").trim();
        const sessionId = (payload.sessionId || "SESI-01").trim();
        const sessionName = (payload.sessionName || sessionId).trim();
        const scannedBy = (payload.scannedBy || "Panitia").trim();
        const gate = (payload.gate || "Pintu Masuk").trim();
        const nowStr = formatFullDateTime(new Date());

        if (!ticketId) {
          return createJsonResponse({ success: false, message: "ID Tiket tidak boleh kosong." });
        }

        // Cari baris peserta di Data Peserta
        let foundRow = -1;
        let attendeeName = "";
        let attendeeEmail = "";

        for (let r = 1; r < pesertaData.length; r++) {
          if (String(pesertaData[r][0]).toUpperCase() === ticketId.toUpperCase()) {
            foundRow = r + 1; // 1-based row index
            attendeeName = pesertaData[r][1] || "Peserta";
            attendeeEmail = pesertaData[r][2] || "-";
            break;
          }
        }

        // Skenario 1: Tiket Tidak Ditemukan
        if (foundRow === -1) {
          sheetLog.appendRow([nowStr, sessionId, sessionName, ticketId, "-", "TIDAK_VALID", scannedBy, gate, "ID tidak terdaftar di sistem"]);
          return createJsonResponse({
            success: false,
            status: "NOT_FOUND",
            message: `Tiket "${ticketId}" TIDAK TERDAFTAR dalam sistem!`
          });
        }

        // Ambil kolom sesi untuk sesi ini
        const sessionColIdx = getOrCreateSessionColumn(sheetPeserta, sessionId, sessionName);
        const existingStatus = String(sheetPeserta.getRange(foundRow, sessionColIdx).getValue() || "").trim();

        // Skenario 2: Tiket Sudah Pernah Di-scan di Sesi Ini (Double Scan)
        if (existingStatus.startsWith("HADIR")) {
          sheetLog.appendRow([nowStr, sessionId, sessionName, ticketId, attendeeName, "DUPLIKAT", scannedBy, gate, `Sudah absen sebelumnya: ${existingStatus}`]);
          return createJsonResponse({
            success: false,
            status: "ALREADY_CHECKED_IN",
            message: `TIKET SUDAH DIGUNAKAN untuk sesi "${sessionName}"!`,
            attendee: {
              ticketId: ticketId,
              name: attendeeName,
              email: attendeeEmail,
              sessionName: sessionName,
              firstCheckInTime: existingStatus.replace("HADIR - ", "").trim() || "Sebelumnya",
              scannedBy: scannedBy
            }
          });
        }

        // Skenario 3: Check-In Berhasil!
        const statusValue = `HADIR - ${nowStr}`;
        sheetPeserta.getRange(foundRow, sessionColIdx).setValue(statusValue);
        
        // Catat di sheet Log Kehadiran
        sheetLog.appendRow([nowStr, sessionId, sessionName, ticketId, attendeeName, "BERHASIL", scannedBy, gate, "Presensi tercatat"]);

        return createJsonResponse({
          success: true,
          status: "CHECKED_IN",
          message: `Presensi berhasil dicatat untuk ${sessionName}!`,
          attendee: {
            ticketId: ticketId,
            name: attendeeName,
            email: attendeeEmail,
            sessionName: sessionName,
            checkInTime: nowStr,
            scannedBy: scannedBy,
            gate: gate
          }
        });
      }

      // -------------------------------------------------------------
      // ACTION D: BATALKAN KEHADIRAN (CANCEL / UNDO CHECK-IN)
      // -------------------------------------------------------------
      if (action === "cancelCheckIn" || action === "undo") {
        const ticketId = (payload.ticketId || "").trim();
        const sessionId = (payload.sessionId || "").trim();
        const sessionName = (payload.sessionName || sessionId).trim();
        const cancelledBy = (payload.cancelledBy || payload.scannedBy || "Panitia").trim();
        const reason = (payload.reason || "Dibatalkan oleh panitia (nama/identitas tidak cocok)").trim();
        const nowStr = formatFullDateTime(new Date());

        if (!ticketId || !sessionId) {
          return createJsonResponse({ success: false, message: "Ticket ID dan Session ID wajib diisi untuk pembatalan." });
        }

        // Cari baris peserta
        let foundRow = -1;
        let attendeeName = "";

        for (let r = 1; r < pesertaData.length; r++) {
          if (String(pesertaData[r][0]).toUpperCase() === ticketId.toUpperCase()) {
            foundRow = r + 1;
            attendeeName = pesertaData[r][1] || "Peserta";
            break;
          }
        }

        if (foundRow === -1) {
          return createJsonResponse({ success: false, message: "Peserta tidak ditemukan." });
        }

        // Ambil kolom sesi
        const sessionColIdx = getOrCreateSessionColumn(sheetPeserta, sessionId, sessionName);
        
        // Kosongkan status di sheet Data Peserta (Revert kembali)
        sheetPeserta.getRange(foundRow, sessionColIdx).setValue("");

        // Catat event pembatalan di sheet Log Kehadiran
        sheetLog.appendRow([nowStr, sessionId, sessionName, ticketId, attendeeName, "DIBATALKAN", cancelledBy, payload.gate || "-", reason]);

        return createJsonResponse({
          success: true,
          status: "CANCELLED",
          message: `Kehadiran ${attendeeName} pada ${sessionName} berhasil dibatalkan.`,
          attendee: {
            ticketId: ticketId,
            name: attendeeName
          }
        });
      }

      // -------------------------------------------------------------
      // ACTION E: REGISTRASI CEPAT ON-THE-SPOT (OTS / WALK-IN)
      // -------------------------------------------------------------
      if (action === "registerOts" || action === "ots") {
        const name = (payload.name || "").trim();
        const contact = (payload.contact || "").trim();
        const notes = (payload.notes || "Walk-In OTS").trim();
        const sessionId = (payload.sessionId || "SESI-01").trim();
        const sessionName = (payload.sessionName || sessionId).trim();
        const scannedBy = (payload.scannedBy || "Panitia").trim();
        const gate = (payload.gate || "Pintu Masuk").trim();
        const nowStr = formatFullDateTime(new Date());

        if (!name) {
          return createJsonResponse({ success: false, message: "Nama lengkap peserta wajib diisi." });
        }

        // 1. Generate Unique Ticket ID dengan prefix OTS
        const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
        let randomPart = "";
        for (let i = 0; i < 4; i++) {
          randomPart += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        const ticketId = "TIC-OTS-" + randomPart;

        // 2. Generate QR Code Image & simpan di Drive
        let fileId = "-";
        let fileUrl = "-";
        try {
          const qrUrl = "https://quickchart.io/qr?text=" + encodeURIComponent(ticketId) + "&size=450&margin=2";
          const qrResponse = UrlFetchApp.fetch(qrUrl, { muteHttpExceptions: true });
          if (qrResponse.getResponseCode() === 200) {
            const sanitizedName = name.replace(/[^a-zA-Z0-9_-]/g, "_");
            const qrBlob = qrResponse.getBlob().setName("QR_OTS_" + sanitizedName + "_" + ticketId + ".png");

            const targetFolder = getOrCreateQrFolder();
            const driveFile = targetFolder.createFile(qrBlob);
            fileId = driveFile.getId();
            fileUrl = driveFile.getUrl();

            // Jika kontak merupakan email, berikan viewer access
            if (contact && contact.includes("@")) {
              try {
                DriveApp.getFileById(fileId).addViewer(contact);
              } catch (e) {
                Logger.log("Viewer share error: " + e.message);
              }
            }
          }
        } catch (err) {
          Logger.log("QR Drive save error: " + err.message);
        }

        // 3. Masukkan ke sheet Data Peserta
        const effectiveContact = contact || "OTS (Tanpa HP)";
        const newRow = [
          ticketId,
          name,
          effectiveContact,
          fileId,
          fileUrl,
          nowStr
        ];

        // Ambil kolom sesi untuk sesi aktif
        const sessionColIdx = getOrCreateSessionColumn(sheetPeserta, sessionId, sessionName);
        
        // Buat baris baru di Data Peserta
        sheetPeserta.appendRow(newRow);
        const newRowIdx = sheetPeserta.getLastRow();

        // Langsung tandai HADIR di sesi aktif!
        const statusValue = `HADIR - ${nowStr}`;
        sheetPeserta.getRange(newRowIdx, sessionColIdx).setValue(statusValue);

        // 4. Catat di Log Kehadiran
        sheetLog.appendRow([nowStr, sessionId, sessionName, ticketId, name, "BERHASIL (OTS)", scannedBy, gate, notes]);

        return createJsonResponse({
          success: true,
          status: "CHECKED_IN",
          message: `Registrasi OTS berhasil! ${name} langsung tercatat hadir pada ${sessionName}.`,
          attendee: {
            ticketId: ticketId,
            name: name,
            email: effectiveContact,
            sessionName: sessionName,
            checkInTime: nowStr,
            scannedBy: scannedBy,
            gate: gate,
            isOts: true
          }
        });
      }

      return createJsonResponse({ success: false, message: `Action "${action}" tidak dikenali.` });

    } finally {
      lock.releaseLock();
    }

  } catch (err) {
    return createJsonResponse({ success: false, message: "Server error: " + err.message });
  }
}

function createJsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Utility test manual di editor Apps Script
 */
function testInitSheets() {
  ensureAllSheetsSetup();
  Logger.log("Semua sheet berhasil diinisialisasi!");
}
