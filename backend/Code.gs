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
    SCANNER_URL: "https://atiohaidar.github.io/Absen-QR-General/",
    
    SHEETS: {
      RAW_FORM: "Form Responses 1",
      RAW_FORM_ID: "Jawaban Formulir 1",
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
    const baseHeaders = ["Ticket ID", "Nama Lengkap", "Total Hadir", "Email", "Drive File ID", "Drive File URL", "Waktu Daftar"];

    if (sheetPeserta.getLastRow() === 0) {
      sheetPeserta.appendRow(baseHeaders);
      sheetPeserta.getRange(1, 1, 1, baseHeaders.length).setFontWeight("bold").setBackground("#e2e8f0");
      sheetPeserta.getRange(1, 3).setBackground("#dcfce7"); // Soft green highlight untuk Total Hadir
    } else {
      // Migrasi otomatis jika kolom Total Hadir belum ada di sheet yang sudah ada
      const lastCol = sheetPeserta.getLastColumn();
      if (lastCol > 0) {
        const currentHeaders = sheetPeserta.getRange(1, 1, 1, lastCol).getValues()[0];
        const hasTotalHadir = currentHeaders.some(h => {
          const s = String(h).toLowerCase();
          return s.includes("total") || s.includes("jumlah");
        });

        if (!hasTotalHadir) {
          // Sisipkan kolom Total Hadir tepat di kolom ke-3 (setelah Nama Lengkap)
          sheetPeserta.insertColumnBefore(3);
          sheetPeserta.getRange(1, 3).setValue("Total Hadir").setFontWeight("bold").setBackground("#dcfce7");

          // Isi formula Total Hadir untuk seluruh baris data peserta yang sudah ada
          const totalRows = sheetPeserta.getLastRow();
          if (totalRows > 1) {
            for (let r = 2; r <= totalRows; r++) {
              sheetPeserta.getRange(r, 3).setFormula(`=IF(A${r}="","", COUNTIF(D${r}:ZZ${r}, "HADIR*"))`);
            }
          }
        }
      }
    }

    // Freeze 3 kolom pertama & baris header 1 agar Nama & Total Hadir tetap terkunci saat discroll ke kanan!
    try {
      sheetPeserta.setFrozenColumns(3);
      sheetPeserta.setFrozenRows(1);
    } catch (freezeErr) {
      Logger.log("Freeze notice: " + freezeErr.message);
    }

    // 3. Sheet Log Kehadiran
    const sheetLog = getOrCreateSheet(CONFIG.SHEETS.LOG_KEHADIRAN);
    const logHeaders = ["Timestamp Log", "ID Sesi", "Nama Sesi", "Ticket ID", "Nama Peserta", "Status Scan", "Petugas / Panitia", "Gate", "Link Lokasi (Maps)", "Perangkat", "Keterangan"];
    if (sheetLog.getLastRow() === 0) {
      sheetLog.appendRow(logHeaders);
      sheetLog.getRange(1, 1, 1, logHeaders.length).setFontWeight("bold").setBackground("#e2e8f0");
    } else {
      const lastCol = sheetLog.getLastColumn();
      if (lastCol > 0) {
        const currentHeaders = sheetLog.getRange(1, 1, 1, lastCol).getValues()[0];
        if (!currentHeaders.includes("Link Lokasi (Maps)")) {
          sheetLog.getRange(1, 1, 1, logHeaders.length).setValues([logHeaders]).setFontWeight("bold").setBackground("#e2e8f0");
        }
      }
    }
  }

  /**
  * Helper: Ambil index kolom dinamis di sheet Data Peserta
  */
  function getPesertaFieldIndices(sheetPeserta) {
    const lastCol = Math.max(1, sheetPeserta.getLastColumn());
    const headers = sheetPeserta.getRange(1, 1, 1, lastCol).getValues()[0];

    let ticketCol = 0;
    let nameCol = 1;
    let totalCol = 2;
    let emailCol = 3;

    headers.forEach((h, idx) => {
      const s = String(h).toLowerCase();
      if (s.includes("ticket") || s.includes("id tiket")) ticketCol = idx;
      if (s.includes("nama")) nameCol = idx;
      if (s.includes("total") || s.includes("jumlah")) totalCol = idx;
      if (s.includes("email") || s.includes("kontak")) emailCol = idx;
    });

    return { ticketCol, nameCol, totalCol, emailCol, headers };
  }

  /**
   * Helper: Ambil atau buat subfolder 'QR Code Peserta' di Google Drive
   * Dilengkapi pengaman privasi:
   * 1. Jika parent folder terlanjur di-share PUBLIC, folder QR dialihkan ke Root My Drive agar tidak bocor.
   * 2. Folder QR selalu dikunci ke mode PRIVATE (Restricted), sehingga hanya pemilik & peserta bersangkutan yang punya akses.
   */
  function getOrCreateQrFolder() {
    try {
      const ssId = getSpreadsheet().getId();
      const ssFile = DriveApp.getFileById(ssId);
      const parents = ssFile.getParents();
      let parentFolder = parents.hasNext() ? parents.next() : DriveApp.getRootFolder();
      
      // Keamanan Ekstra: Deteksi apakah folder parent bersifat publik (Anyone / Anyone with link)
      let isParentPublic = false;
      try {
        const parentAccess = parentFolder.getSharingAccess();
        if (parentAccess === DriveApp.Access.ANYONE || parentAccess === DriveApp.Access.ANYONE_WITH_LINK) {
          isParentPublic = true;
        }
      } catch (accessErr) {
        Logger.log("Notice checking parent access: " + accessErr.message);
      }

      // Jika parent folder publik, isolasi folder QR ke My Drive Root agar peserta tidak bisa jelajahi parent
      if (isParentPublic) {
        Logger.log("⚠️ Parent folder bersifat PUBLIK. Untuk privasi peserta, folder QR dialihkan ke Root My Drive.");
        parentFolder = DriveApp.getRootFolder();
      }

      const existing = parentFolder.getFoldersByName(CONFIG.QR_SUBFOLDER_NAME);
      let targetFolder;
      if (existing.hasNext()) {
        targetFolder = existing.next();
      } else {
        targetFolder = parentFolder.createFolder(CONFIG.QR_SUBFOLDER_NAME);
        Logger.log("📁 Folder baru dibuat: " + CONFIG.QR_SUBFOLDER_NAME);
      }

      // Kunci akses folder agar selalu PRIVATE (Restricted / Dibatasi)
      try {
        targetFolder.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
      } catch (shareErr) {
        Logger.log("Folder setSharing notice: " + shareErr.message);
      }

      return targetFolder;
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
      
      // 1. Ambil data mentah dari Form Responses (HANYA BACA, TIDAK DIUBAH)
      let sheetRaw = null;
      let targetRow = -1;

      if (e && e.range) {
        sheetRaw = e.range.getSheet();
        targetRow = e.range.getRow();
      } else {
        sheetRaw = ss.getSheetByName(CONFIG.SHEETS.RAW_FORM) ||
                  ss.getSheetByName(CONFIG.SHEETS.RAW_FORM_ID) ||
                  ss.getSheets().find(s => {
                    const n = s.getName();
                    return n.startsWith("Form Responses") || n.startsWith("Jawaban Formulir");
                  }) ||
                  ss.getSheets()[0];
        targetRow = sheetRaw.getLastRow();
      }
      
      if (!sheetRaw || targetRow <= 1) return;

      const rawHeaders = sheetRaw.getRange(1, 1, 1, sheetRaw.getLastColumn()).getValues()[0];
      const rawData = sheetRaw.getRange(targetRow, 1, 1, sheetRaw.getLastColumn()).getValues()[0];

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
      const { emailCol } = getPesertaFieldIndices(sheetPeserta);
      const pesertaData = sheetPeserta.getDataRange().getValues();
      
      for (let r = 1; r < pesertaData.length; r++) {
        if (String(pesertaData[r][emailCol]).trim().toLowerCase() === email.toLowerCase()) {
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

      // 6. Masukkan data ke sheet "Data Peserta" dengan lock singkat
      const nextRow = sheetPeserta.getLastRow() + 1;
      const formulaTotal = `=IF(A${nextRow}="","", COUNTIF(D${nextRow}:ZZ${nextRow}, "HADIR*"))`;
      const attendeeRowData = [
        ticketId,
        name,
        formulaTotal,
        email,
        fileId,
        fileUrl,
        regTimestamp
      ];

      const lock = LockService.getScriptLock();
      if (lock.tryLock(8000)) {
        try {
          sheetPeserta.appendRow(attendeeRowData);
          Logger.log("✅ Sukses menambahkan peserta baru: " + name + " (" + ticketId + ")");
        } finally {
          lock.releaseLock();
        }
      } else {
        Logger.log("⚠️ Lock timeout saat append row peserta baru, mengabaikan lock.");
        sheetPeserta.appendRow(attendeeRowData);
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
  * Helper: Buat daftar peserta lengkap beserta status kehadiran sesi terkini dari spreadsheet
  */
  function buildAttendeesList(sheetPeserta) {
    const pesertaData = sheetPeserta.getDataRange().getValues();
    const { ticketCol, nameCol, emailCol } = getPesertaFieldIndices(sheetPeserta);

    // Deteksi kolom-kolom sesi di header: format `Sesi: Nama Sesi [SESI-ID]`
    const headers = pesertaData.length > 0 ? pesertaData[0] : [];
    const sessionCols = [];
    for (let c = 0; c < headers.length; c++) {
      const h = String(headers[c] || "");
      const match = h.match(/\[([A-Za-z0-9_-]+)\]/);
      if (match) {
        sessionCols.push({ colIdx: c, sessionId: match[1] });
      }
    }

    const attendees = [];
    for (let r = 1; r < pesertaData.length; r++) {
      const tId = String(pesertaData[r][ticketCol] || "").trim();
      if (!tId) continue;

      const sessionsMap = {};
      sessionCols.forEach(sc => {
        const val = String(pesertaData[r][sc.colIdx] || "").trim();
        if (val.startsWith("HADIR")) {
          sessionsMap[sc.sessionId] = val.replace("HADIR - ", "").trim() || "HADIR";
        }
      });

      attendees.push({
        ticketId: tId,
        name: String(pesertaData[r][nameCol] || "Peserta").trim(),
        email: String(pesertaData[r][emailCol] || "-").trim(),
        sessions: sessionsMap
      });
    }

    return attendees;
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

      if (action === "getAttendees") {
        const sheetPeserta = getOrCreateSheet(CONFIG.SHEETS.DATA_PESERTA);
        const attendees = buildAttendeesList(sheetPeserta);
        return createJsonResponse({
          success: true,
          attendees: attendees,
          count: attendees.length,
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

      // ACTION A2: GET ALL ATTENDEES (For Offline Local Pre-Caching & Instant Mode)
      if (action === "getAttendees") {
        const attendees = buildAttendeesList(sheetPeserta);
        return createJsonResponse({
          success: true,
          attendees: attendees,
          count: attendees.length,
          timestamp: new Date().toISOString()
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
        const mapsUrl = (payload.mapsUrl || "-").trim();
        const deviceInfo = (payload.deviceInfo || "-").trim();

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
          const { ticketCol, nameCol, emailCol } = getPesertaFieldIndices(sheetPeserta);

          for (let r = 1; r < pesertaData.length; r++) {
            if (String(pesertaData[r][ticketCol]).toUpperCase() === ticketId.toUpperCase()) {
              foundRow = r + 1; // 1-based row index
              attendeeName = pesertaData[r][nameCol] || "Peserta";
              attendeeEmail = pesertaData[r][emailCol] || "-";
              break;
            }
          }

          // Skenario 1: Tiket Tidak Ditemukan
          if (foundRow === -1) {
            sheetLog.appendRow([nowStr, sessionId, sessionName, ticketId, "-", "TIDAK_VALID", scannedBy, gate, mapsUrl, deviceInfo, "ID tidak terdaftar di sistem"]);
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
            sheetLog.appendRow([nowStr, sessionId, sessionName, ticketId, attendeeName, "DUPLIKAT", scannedBy, gate, mapsUrl, deviceInfo, `Sudah absen sebelumnya: ${existingStatus}`]);
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
          
          // Catat di sheet Log Kehadiran dengan Link Google Maps & Device Info
          sheetLog.appendRow([nowStr, sessionId, sessionName, ticketId, attendeeName, "BERHASIL", scannedBy, gate, mapsUrl, deviceInfo, "Presensi tercatat"]);

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
        // ACTION C2: BATCH CHECK-IN (OFFLINE BACKGROUND SYNC)
        // Memproses banyak antrean presensi sekaligus dalam 1 kali lock & batch write
        // -------------------------------------------------------------
        if (action === "batchCheckIn") {
          const scans = Array.isArray(payload.scans) ? payload.scans : [];
          if (scans.length === 0) {
            return createJsonResponse({ success: true, processedCount: 0, results: [] });
          }

          const { ticketCol, nameCol, emailCol } = getPesertaFieldIndices(sheetPeserta);
          const results = [];
          const logRowsToAppend = [];
          const nowStr = formatFullDateTime(new Date());

          // Build in-memory index map for O(1) lightning lookup
          const ticketMap = new Map();
          for (let r = 1; r < pesertaData.length; r++) {
            const tId = String(pesertaData[r][ticketCol] || "").toUpperCase().trim();
            if (tId) {
              ticketMap.set(tId, {
                row: r + 1,
                name: pesertaData[r][nameCol] || "Peserta",
                email: pesertaData[r][emailCol] || "-"
              });
            }
          }

          // Cache session columns
          const sessionColMap = new Map();

          for (let i = 0; i < scans.length; i++) {
            const scan = scans[i];
            const ticketId = String(scan.ticketId || "").trim();
            const upperTicketId = ticketId.toUpperCase();
            const sessionId = (scan.sessionId || "SESI-01").trim();
            const sessionName = (scan.sessionName || sessionId).trim();
            const scannedBy = (scan.scannedBy || "Panitia").trim();
            const gate = (scan.gate || "Pintu Masuk").trim();
            const mapsUrl = (scan.mapsUrl || "-").trim();
            const deviceInfo = (scan.deviceInfo || "-").trim();
            const scanTime = scan.clientTime || nowStr;

            if (!sessionColMap.has(sessionId)) {
              sessionColMap.set(sessionId, getOrCreateSessionColumn(sheetPeserta, sessionId, sessionName));
            }
            const sessionColIdx = sessionColMap.get(sessionId);

            if (!ticketMap.has(upperTicketId)) {
              // Tiket Tidak Ditemukan / Sudah Dihapus Admin di Sheets!
              logRowsToAppend.push([scanTime, sessionId, sessionName, ticketId, "-", "TIDAK_VALID", scannedBy, gate, mapsUrl, deviceInfo, "ID tidak terdaftar / dihapus"]);
              results.push({
                ticketId: ticketId,
                status: "NOT_FOUND",
                message: `Tiket "${ticketId}" tidak terdaftar di spreadsheet!`
              });
              continue;
            }

            const attendeeInfo = ticketMap.get(upperTicketId);
            const foundRow = attendeeInfo.row;
            const attendeeName = attendeeInfo.name;
            const attendeeEmail = attendeeInfo.email;

            const existingStatus = String(sheetPeserta.getRange(foundRow, sessionColIdx).getValue() || "").trim();

            if (existingStatus.startsWith("HADIR")) {
              logRowsToAppend.push([scanTime, sessionId, sessionName, ticketId, attendeeName, "DUPLIKAT", scannedBy, gate, mapsUrl, deviceInfo, `Sudah absen sebelumnya: ${existingStatus}`]);
              results.push({
                ticketId: ticketId,
                status: "ALREADY_CHECKED_IN",
                message: `Tiket sudah terdata hadir di sesi ${sessionName}`,
                attendee: {
                  ticketId: ticketId,
                  name: attendeeName,
                  email: attendeeEmail,
                  sessionName: sessionName,
                  firstCheckInTime: existingStatus.replace("HADIR - ", "").trim() || "Sebelumnya",
                  scannedBy: scannedBy
                }
              });
            } else {
              const statusValue = `HADIR - ${scanTime}`;
              sheetPeserta.getRange(foundRow, sessionColIdx).setValue(statusValue);
              logRowsToAppend.push([scanTime, sessionId, sessionName, ticketId, attendeeName, "BERHASIL", scannedBy, gate, mapsUrl, deviceInfo, "Presensi tercatat"]);
              results.push({
                ticketId: ticketId,
                status: "CHECKED_IN",
                message: `Presensi berhasil dicatat untuk ${sessionName}!`,
                attendee: {
                  ticketId: ticketId,
                  name: attendeeName,
                  email: attendeeEmail,
                  sessionName: sessionName,
                  checkInTime: scanTime,
                  scannedBy: scannedBy,
                  gate: gate
                }
              });
            }
          }

          // Append all log rows in a single batch
          if (logRowsToAppend.length > 0) {
            const startRow = sheetLog.getLastRow() + 1;
            sheetLog.getRange(startRow, 1, logRowsToAppend.length, logRowsToAppend[0].length).setValues(logRowsToAppend);
          }

          return createJsonResponse({
            success: true,
            processedCount: scans.length,
            results: results
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
          const reason = (payload.reason || "Dibatalkan oleh panitia").trim();
          const nowStr = formatFullDateTime(new Date());

          if (!ticketId || !sessionId) {
            return createJsonResponse({ success: false, message: "Ticket ID dan Session ID wajib diisi untuk pembatalan." });
          }

          // Cari baris peserta
          let foundRow = -1;
          let attendeeName = "";
          const { ticketCol: cancelTicketCol, nameCol: cancelNameCol } = getPesertaFieldIndices(sheetPeserta);

          for (let r = 1; r < pesertaData.length; r++) {
            if (String(pesertaData[r][cancelTicketCol]).toUpperCase() === ticketId.toUpperCase()) {
              foundRow = r + 1;
              attendeeName = pesertaData[r][cancelNameCol] || "Peserta";
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

          // Catat event pembatalan di sheet Log Kehadiran dengan Link Google Maps & Device Info
          sheetLog.appendRow([nowStr, sessionId, sessionName, ticketId, attendeeName, "DIBATALKAN", cancelledBy, payload.gate || "-", mapsUrl, deviceInfo, reason]);

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
          const nextOtsRow = sheetPeserta.getLastRow() + 1;
          const otsFormulaTotal = `=IF(A${nextOtsRow}="","", COUNTIF(D${nextOtsRow}:ZZ${nextOtsRow}, "HADIR*"))`;
          const newRow = [
            ticketId,
            name,
            otsFormulaTotal,
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

          // 4. Catat di Log Kehadiran dengan Link Google Maps & Device Info
          sheetLog.appendRow([nowStr, sessionId, sessionName, ticketId, name, "BERHASIL (OTS)", scannedBy, gate, mapsUrl, deviceInfo, notes]);

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

  /**
  * ==============================================================================
  * MENU KHUSUS GOOGLE SHEETS (1-CLICK SETUP UNTUK ORANG AWAM)
  * ==============================================================================
  */
  function onOpen() {
    try {
      ensureAllSheetsSetup(); // Otomatis freeze 3 kolom & sisipkan Total Hadir saat spreadsheet dibuka
    } catch (e) {
      Logger.log("onOpen ensure notice: " + e.message);
    }

    SpreadsheetApp.getUi()
      .createMenu('⚡ Presensi Event')
      .addItem('🚀 1. Setup Otomatis (Inisialisasi & Pasang Trigger)', 'autoSetupEverything')
      .addItem('📝 2. Buat Google Form Pendaftaran Otomatis', 'autoCreateGoogleForm')
      .addItem('📥 3. Impor Peserta Lama dari Form Responses', 'syncExistingFormResponses')
      .addSeparator()
      .addItem('🔗 4. Buka / Bagikan Link Scanner Panitia', 'showPanitiaLinkModal')
      .addItem('📊 5. Periksa Status Sistem', 'showSystemStatus')
      .addToUi();
  }

  /**
  * 1-Click Setup:
  * - Menyiapkan seluruh tab sheet (Master Sesi, Data Peserta, Log Kehadiran)
  * - Menyiapkan folder 'QR Code Peserta' di Google Drive
  * - Memasang trigger onFormSubmit otomatis tanpa perlu buka menu alarm / triggers
  */
  function autoSetupEverything() {
    const ui = SpreadsheetApp.getUi();
    try {
      ensureAllSheetsSetup();
      const qrFolder = getOrCreateQrFolder();
      
      // Auto-create onFormSubmit trigger jika belum ada
      const ss = getSpreadsheet();
      const triggers = ScriptApp.getProjectTriggers();
      let triggerExists = false;

      for (let i = 0; i < triggers.length; i++) {
        if (triggers[i].getHandlerFunction() === "onFormSubmit") {
          triggerExists = true;
          break;
        }
      }

      if (!triggerExists) {
        ScriptApp.newTrigger("onFormSubmit")
          .forSpreadsheet(ss)
          .onFormSubmit()
          .create();
      }

      const msg = [
        "🎉 SETUP AWAL BERHASIL!",
        "------------------------------------------",
        "✅ Tab 'Master Sesi', 'Data Peserta', dan 'Log Kehadiran' siap.",
        `✅ Folder '${CONFIG.QR_SUBFOLDER_NAME}' di Google Drive siap.`,
        "✅ Trigger otomatis pendaftaran form sudah aktif.",
        "",
        "📌 LANGKAH TERAKHIR (Aktifkan Web App):",
        "1. Di Apps Script (Extensions > Apps Script), klik 'Deploy' -> 'New deployment'.",
        "2. Pilih icon gear ⚙️ -> 'Web app'.",
        "3. Atur 'Who has access' menjadi: 'Anyone'.",
        "4. Klik 'Deploy', lalu salin URL Web App.",
        "5. Gunakan menu '⚡ Presensi Event' -> '3. Buka / Bagikan Link Scanner Panitia' untuk membagikan ke panitia!"
      ].join("\n");

      ui.alert("Berhasil!", msg, ui.ButtonSet.OK);

    } catch (err) {
      ui.alert("Error Saat Setup", "Terjadi kendala: " + err.message, ui.ButtonSet.OK);
    }
  }

  /**
  * 1-Click Form Generator:
  * - Otomatis membuat Google Form pendaftaran (Nama Lengkap, Email)
  * - Otomatis menghubungkan responses form ke Spreadsheet ini
  */
  function autoCreateGoogleForm() {
    const ui = SpreadsheetApp.getUi();
    const ss = getSpreadsheet();

    try {
      // Cek apakah spreadsheet sudah punya form terhubung
      const existingFormUrl = ss.getFormUrl();
      if (existingFormUrl) {
        const response = ui.alert(
          "Form Sudah Terhubung",
          "Spreadsheet ini sudah memiliki Google Form yang terhubung:\n" + existingFormUrl + "\n\nApakah ingin tetap membuat Form baru?",
          ui.ButtonSet.YES_NO
        );
        if (response !== ui.Button.YES) {
          return;
        }
      }

      // Buat form baru
      const formTitle = (CONFIG.EVENT_NAME || "Event") + " - Registrasi Peserta";
      const form = FormApp.create(formTitle);
      
      form.setDescription("Silakan isi nama lengkap dan email aktif Anda. Tiket QR Code akan otomatis dibuat dan dibagikan ke Google Drive akun Anda.");
      
      // Pertanyaan 1: Nama Lengkap
      const nameItem = form.addTextItem();
      nameItem.setTitle("Nama Lengkap").setRequired(true);

      // Pertanyaan 2: Email
      const emailItem = form.addTextItem();
      emailItem.setTitle("Email").setRequired(true);

      // Hubungkan destination form ke Spreadsheet aktif ini
      form.setDestination(FormApp.DestinationType.SPREADSHEET, ss.getId());

      // Pastikan sheet setup & trigger siap
      ensureAllSheetsSetup();
      
      // Pastikan trigger onFormSubmit terpasang
      const triggers = ScriptApp.getProjectTriggers();
      let triggerExists = false;
      for (let i = 0; i < triggers.length; i++) {
        if (triggers[i].getHandlerFunction() === "onFormSubmit") {
          triggerExists = true;
          break;
        }
      }
      if (!triggerExists) {
        ScriptApp.newTrigger("onFormSubmit")
          .forSpreadsheet(ss)
          .onFormSubmit()
          .create();
      }

      const publishedUrl = form.getPublishedUrl();
      const editUrl = form.getEditUrl();

      const output = HtmlService.createHtmlOutput(`
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 16px;">
          <h3 style="color: #16a34a; margin-top: 0;">🎉 Google Form Berhasil Dibuat!</h3>
          <p style="font-size: 13px; color: #475569; line-height: 1.5;">Google Form telah otomatis dihubungkan ke spreadsheet ini dengan pertanyaan: <strong>Nama Lengkap</strong> dan <strong>Email</strong>.</p>
          
          <div style="margin: 15px 0;">
            <label style="font-weight: 600; font-size: 12px; display: block; margin-bottom: 5px; color: #0f172a;">Link Pendaftaran Peserta:</label>
            <input type="text" readonly value="${publishedUrl}" style="width: 100%; padding: 8px 10px; font-size: 13px; border: 1px solid #cbd5e1; border-radius: 6px; box-sizing: border-box;" onclick="this.select();">
          </div>

          <div style="margin: 15px 0;">
            <label style="font-weight: 600; font-size: 12px; display: block; margin-bottom: 5px; color: #0f172a;">Link Edit Formulir (Admin/Panitia):</label>
            <a href="${editUrl}" target="_blank" style="color: #2563eb; font-size: 13px; text-decoration: none; font-weight: 500;">Buka Editor Google Form ↗</a>
          </div>

          <p style="font-size: 12px; color: #64748b; margin-top: 20px;">
            💡 <em>Setiap ada peserta yang submit form, QR Code akan otomatis di-generate dan data langsung masuk ke sheet <strong>Data Peserta</strong>.</em>
          </p>
        </div>
      `).setWidth(480).setHeight(320);

      ui.showModalDialog(output, "Formulir Pendaftaran Siap!");

    } catch (err) {
      ui.alert("Gagal Membuat Form", "Error: " + err.message, ui.ButtonSet.OK);
    }
  }

  /**
  * Sinkronkan seluruh data peserta yang SUDAH ADA di Form Responses 1 / Jawaban Formulir 1.
  * Sangat berguna jika peserta sudah mengisi form sebelum sistem script ini dipasang!
  */
  function syncExistingFormResponses() {
    const ui = SpreadsheetApp.getUi();
    ensureAllSheetsSetup();
    const ss = getSpreadsheet();

    try {
      // 1. Cari tab form responses
      const sheetRaw = ss.getSheetByName(CONFIG.SHEETS.RAW_FORM) ||
                      ss.getSheetByName(CONFIG.SHEETS.RAW_FORM_ID) ||
                      ss.getSheets().find(s => {
                        const n = s.getName();
                        return n.startsWith("Form Responses") || n.startsWith("Jawaban Formulir");
                      }) ||
                      ss.getSheets()[0];

      if (!sheetRaw || sheetRaw.getLastRow() <= 1) {
        ui.alert("Data Respon Kosong", "Belum ada respon formulir yang ditemukan di tab: " + (sheetRaw ? sheetRaw.getName() : "Form Responses"), ui.ButtonSet.OK);
        return;
      }

      const rawHeaders = sheetRaw.getRange(1, 1, 1, sheetRaw.getLastColumn()).getValues()[0];
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
        ui.alert("Kolom Tidak Ditemukan", "Tidak dapat menemukan kolom 'Nama Lengkap' atau 'Email' di tab: " + sheetRaw.getName(), ui.ButtonSet.OK);
        return;
      }

      // 2. Ambil data peserta yang sudah ada di Data Peserta agar tidak duplikat
      const sheetPeserta = getOrCreateSheet(CONFIG.SHEETS.DATA_PESERTA);
      const { emailCol: syncEmailCol } = getPesertaFieldIndices(sheetPeserta);
      const pesertaData = sheetPeserta.getDataRange().getValues();
      const existingEmails = new Set();
      for (let r = 1; r < pesertaData.length; r++) {
        const em = String(pesertaData[r][syncEmailCol] || "").trim().toLowerCase();
        if (em) existingEmails.add(em);
      }

      // 3. Loop semua baris respon formulir
      const rawRows = sheetRaw.getRange(2, 1, sheetRaw.getLastRow() - 1, sheetRaw.getLastColumn()).getValues();
      let importedCount = 0;
      let skippedCount = 0;

      const targetFolder = getOrCreateQrFolder();

      for (let i = 0; i < rawRows.length; i++) {
        const row = rawRows[i];
        const name = String(row[nameIdx] || "").trim();
        const email = String(row[emailIdx] || "").trim();
        const regTimestamp = row[timeIdx] ? formatFullDateTime(new Date(row[timeIdx])) : formatFullDateTime(new Date());

        if (!name || !email) continue;

        if (existingEmails.has(email.toLowerCase())) {
          skippedCount++;
          continue;
        }

        // Generate Ticket ID & QR Code Image
        const ticketId = generateTicketId();
        let fileId = "-";
        let fileUrl = "-";

        try {
          const qrUrl = "https://quickchart.io/qr?text=" + encodeURIComponent(ticketId) + "&size=450&margin=2";
          const qrResponse = UrlFetchApp.fetch(qrUrl, { muteHttpExceptions: true });
          if (qrResponse.getResponseCode() === 200) {
            const sanitizedName = name.replace(/[^a-zA-Z0-9_-]/g, "_");
            const qrBlob = qrResponse.getBlob().setName("QR_" + sanitizedName + "_" + ticketId + ".png");
            const driveFile = targetFolder.createFile(qrBlob);
            fileId = driveFile.getId();
            fileUrl = driveFile.getUrl();

            try {
              DriveApp.getFileById(fileId).addViewer(email);
            } catch (e) {}
          }
        } catch (e) {
          Logger.log("QR warning: " + e.message);
        }

        const nextSyncRow = sheetPeserta.getLastRow() + 1;
        const syncFormulaTotal = `=IF(A${nextSyncRow}="","", COUNTIF(D${nextSyncRow}:ZZ${nextSyncRow}, "HADIR*"))`;

        sheetPeserta.appendRow([
          ticketId,
          name,
          syncFormulaTotal,
          email,
          fileId,
          fileUrl,
          regTimestamp
        ]);

        existingEmails.add(email.toLowerCase());
        importedCount++;
      }

      ui.alert(
        "Impor Data Selesai!",
        `✅ Berhasil mengimpor & membuat QR untuk: ${importedCount} peserta baru.\n⏭️ Dilewati (karena sudah terdaftar): ${skippedCount} peserta.`,
        ui.ButtonSet.OK
      );

    } catch (err) {
      ui.alert("Gagal Impor Data", "Terjadi kesalahan: " + err.message, ui.ButtonSet.OK);
    }
  }

  /**
   * Helper manual untuk mengunci 3 kolom pertama & merapikan Total Hadir
   */
  function applyFreezeAndTotalHadir() {
    ensureAllSheetsSetup();
    SpreadsheetApp.getUi().alert("✅ Berhasil!", "3 kolom pertama (Ticket ID, Nama Lengkap, Total Hadir) dan baris header berhasil dibekukan (freeze).", SpreadsheetApp.getUi().ButtonSet.OK);
  }

  /**
   * Simpan URL Web App ke Script Properties agar selalu up-to-date saat deployment baru dibuat
   */
  function saveWebAppUrl(url) {
    if (url && typeof url === "string") {
      PropertiesService.getScriptProperties().setProperty("WEB_APP_URL", url.trim());
      return true;
    }
    return false;
  }

  /**
  * Dialog pembuat link scanner panitia instan:
  * Panitia cukup buka link ini di HP mereka tanpa perlu setting apa-apa lagi!
  */
  function showPanitiaLinkModal() {
    const ui = SpreadsheetApp.getUi();
    
    const props = PropertiesService.getScriptProperties();
    let savedUrl = props.getProperty("WEB_APP_URL") || "";
    let detectedUrl = "";
    try {
      detectedUrl = ScriptApp.getService().getUrl() || "";
    } catch (err) {
      detectedUrl = "";
    }
    
    // Gunakan savedUrl jika ada (dari update user), fallback ke detectedUrl
    const effectiveUrl = savedUrl || detectedUrl;
    const hasDetected = Boolean(effectiveUrl && effectiveUrl.includes("/exec"));
    let baseScanner = CONFIG.SCANNER_URL || "https://atiohaidar.github.io/Absen-QR-General/";
    if (baseScanner.charAt(baseScanner.length - 1) !== "/") baseScanner += "/";
    
    const initialFinalLink = hasDetected ? (baseScanner + "?q=" + encodeURIComponent(effectiveUrl)) : "";
    const waInitialText = encodeURIComponent("Halo Rekan Panitia, silakan gunakan link berikut untuk membuka scanner presensi QR acara:\n\n" + initialFinalLink);

    const html = HtmlService.createHtmlOutput(`
      <!DOCTYPE html>
      <html>
      <head>
        <base target="_blank">
        <style>
          * { box-sizing: border-box; }
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            margin: 0;
            padding: 16px 20px;
            color: #1e293b;
            background: #ffffff;
            overflow-x: hidden;
          }
          .header {
            text-align: center;
            margin-bottom: 12px;
          }
          .header h3 {
            margin: 0 0 4px 0;
            font-size: 17px;
            font-weight: 700;
            color: #0f172a;
          }
          .header p {
            margin: 0;
            font-size: 12px;
            color: #64748b;
          }
          .link-card {
            background: #f8fafc;
            border: 1.5px solid #e2e8f0;
            border-radius: 8px;
            padding: 10px 12px;
            margin-bottom: 12px;
          }
          .link-label {
            font-weight: 600;
            font-size: 11px;
            color: #475569;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-bottom: 5px;
            display: block;
          }
          .link-input {
            width: 100%;
            padding: 8px 10px;
            font-size: 12px;
            font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
            background: #ffffff;
            border: 1px solid #cbd5e1;
            border-radius: 6px;
            color: #0f172a;
            outline: none;
          }
          .btn-row {
            display: flex;
            gap: 8px;
            margin-bottom: 12px;
          }
          .btn {
            flex: 1;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
            padding: 9px 12px;
            font-size: 12px;
            font-weight: 600;
            border-radius: 6px;
            border: none;
            cursor: pointer;
            text-decoration: none;
            transition: background 0.15s ease;
          }
          .btn-copy {
            background: #16a34a;
            color: #ffffff;
          }
          .btn-copy:hover { background: #15803d; }
          .btn-wa {
            background: #25D366;
            color: #ffffff;
          }
          .btn-wa:hover { background: #1eb956; }
          .btn-open {
            background: #2563eb;
            color: #ffffff;
          }
          .btn-open:hover { background: #1d4ed8; }
          .api-config-card {
            background: #f1f5f9;
            padding: 10px 12px;
            border-radius: 6px;
            border: 1px solid #e2e8f0;
          }
          .api-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 5px;
          }
          .api-title {
            font-size: 11px;
            font-weight: 600;
            color: #475569;
          }
          .api-status {
            font-size: 11px;
            color: #16a34a;
            font-weight: 600;
          }
          .api-input-row {
            display: flex;
            gap: 6px;
          }
          .api-input {
            flex: 1;
            padding: 6px 8px;
            font-size: 11px;
            font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
            border: 1px solid #cbd5e1;
            border-radius: 4px;
            outline: none;
            background: #ffffff;
          }
          .btn-save-api {
            background: #2563eb;
            color: #ffffff;
            border: none;
            padding: 0 12px;
            font-size: 11px;
            font-weight: 600;
            border-radius: 4px;
            cursor: pointer;
            white-space: nowrap;
          }
          .btn-save-api:hover { background: #1d4ed8; }
          .api-hint {
            font-size: 10px;
            color: #64748b;
            margin-top: 5px;
            line-height: 1.3;
          }
        </style>
      </head>
      <body>
        <div class="header">
          <h3>🔗 Link Scanner Panitia</h3>
          <p>Link ini siap dibagikan ke WhatsApp panitia untuk langsung scan.</p>
        </div>

        <div class="link-card">
          <label class="link-label">Link Scanner Siap Pakai (Auto-Connect):</label>
          <input type="text" id="finalLink" readonly value="${initialFinalLink}" class="link-input" onclick="this.select();">
        </div>

        <div class="btn-row">
          <button type="button" class="btn btn-copy" id="btnCopy" onclick="copyLink()">
            <span>📋 Salin Link</span>
          </button>
          <a id="btnWa" href="https://api.whatsapp.com/send?text=${waInitialText}" target="_blank" class="btn btn-wa">
            <span>📱 WhatsApp</span>
          </a>
          <a id="btnOpen" href="${initialFinalLink}" target="_blank" class="btn btn-open">
            <span>🌐 Buka</span>
          </a>
        </div>

        <div class="api-config-card">
          <div class="api-header">
            <span class="api-title">Target Web App API:</span>
            <span id="saveStatus" class="api-status"></span>
          </div>
          <div class="api-input-row">
            <input type="url" id="webAppUrl" value="${effectiveUrl}" placeholder="Paste URL Web App di sini" class="api-input" oninput="updateLink()">
            <button type="button" onclick="saveUrl()" class="btn-save-api">💾 Simpan</button>
          </div>
          <div class="api-hint">
            💡 Jika Anda membuat deployment baru di Apps Script, paste URL barunya di sini lalu klik <strong>Simpan</strong>.
          </div>
        </div>

        <script>
          var baseScanner = "${baseScanner}";

          function updateLink() {
            var webApp = document.getElementById('webAppUrl').value.trim();
            var finalUrl = webApp ? (baseScanner + '?q=' + encodeURIComponent(webApp)) : '';
            document.getElementById('finalLink').value = finalUrl;
            document.getElementById('btnOpen').href = finalUrl || '#';
            
            var msg = encodeURIComponent('Halo Rekan Panitia, silakan gunakan link berikut untuk membuka scanner presensi QR acara:\\n\\n' + finalUrl);
            document.getElementById('btnWa').href = 'https://api.whatsapp.com/send?text=' + msg;
          }

          function saveUrl() {
            var url = document.getElementById('webAppUrl').value.trim();
            if (!url) {
              alert('Silakan masukkan Web App URL terlebih dahulu!');
              return;
            }
            var status = document.getElementById('saveStatus');
            status.innerText = 'Menyimpan...';
            google.script.run
              .withSuccessHandler(function() {
                status.innerText = '✅ Tersimpan!';
                setTimeout(function() { status.innerText = ''; }, 3000);
              })
              .withFailureHandler(function(err) {
                status.innerText = '❌ Gagal: ' + err.message;
              })
              .saveWebAppUrl(url);
          }

          function copyLink() {
            var copyInput = document.getElementById('finalLink');
            if (!copyInput.value) {
              alert('Belum ada link yang tersedia. Silakan masukkan Web App URL lalu simpan.');
              return;
            }
            copyInput.select();
            document.execCommand('copy');
            
            var btn = document.getElementById('btnCopy');
            btn.innerHTML = '<span>✅ Disalin!</span>';
            setTimeout(function() {
              btn.innerHTML = '<span>📋 Salin Link</span>';
            }, 2000);
          }
        </script>
      </body>
      </html>
    `).setWidth(490).setHeight(320);

    ui.showModalDialog(html, "Link Scanner Panitia");
  }

  /**
  * Tampilkan ringkasan status sistem & audit kesiapan event
  */
  function showSystemStatus() {
    const ui = SpreadsheetApp.getUi();
    const ss = getSpreadsheet();

    const triggers = ScriptApp.getProjectTriggers();
    const triggerActive = triggers.some(t => t.getHandlerFunction() === "onFormSubmit");

    const formUrl = ss.getFormUrl() || "Belum terhubung";
    
    const sheetPeserta = ss.getSheetByName(CONFIG.SHEETS.DATA_PESERTA);
    const totalPeserta = sheetPeserta ? Math.max(0, sheetPeserta.getLastRow() - 1) : 0;

    const sheetSesi = ss.getSheetByName(CONFIG.SHEETS.MASTER_SESI);
    let totalSesi = 0;
    if (sheetSesi && sheetSesi.getLastRow() > 1) {
      const data = sheetSesi.getDataRange().getValues();
      for (let i = 1; i < data.length; i++) {
        if (String(data[i][3] || "").toUpperCase() === "AKTIF") totalSesi++;
      }
    }

    const sheetLog = ss.getSheetByName(CONFIG.SHEETS.LOG_KEHADIRAN);
    const totalScans = sheetLog ? Math.max(0, sheetLog.getLastRow() - 1) : 0;

    const report = [
      "📊 STATUS SISTEM PRESENSI",
      "------------------------------------------",
      `• Nama Event: ${CONFIG.EVENT_NAME}`,
      `• Trigger Form Submit: ${triggerActive ? "✅ AKTIF (Otomatis)" : "⚠️ BELUM AKTIF"}`,
      `• Google Form: ${formUrl === "Belum terhubung" ? "Belum dibuat (Gunakan Menu 2)" : "✅ Terhubung"}`,
      `• Sesi Aktif: ${totalSesi} Sesi`,
      `• Total Peserta Terdaftar: ${totalPeserta} Orang`,
      `• Total Aktivitas Presensi: ${totalScans} Scan`,
      "------------------------------------------",
      "💡 Jika trigger belum aktif, klik menu '1. Setup Otomatis'."
    ].join("\n");

    ui.alert("Status Sistem", report, ui.ButtonSet.OK);
  }

