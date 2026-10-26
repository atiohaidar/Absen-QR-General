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
    EVENT_NAME: "Bukber Rutin MSU",
    QR_SUBFOLDER_NAME: "QR Code Peserta",
    TICKET_PREFIX: "BUKBER_MSU_",
    SCANNER_URL: "https://atiohaidar.github.io/Absen-QR-General/",
    
    // Tampilan Caption QR Code (QuickChart)
    QR_FONT_FAMILY: "Roboto",
    QR_FONT_SIZE: 18,
    QR_FONT_COLOR: "1e293b",
    
    // Integrasi Realtime ke Google Spreadsheet Eksternal (Enriched Audit Log)
    EXTERNAL_SYNC: {
      ENABLED: true, // Ubah ke true untuk mengaktifkan sinkronisasi realtime
      SPREADSHEET_ID: "xxx", // Masukkan ID atau Link Spreadsheet target (misal: "1abcXYZ...")
      SHEET_NAME: "Log Kehadiran", // Nama tab di spreadsheet target
      ONLY_SUCCESSFUL_SCANS: false, // Jika true, hanya mencatat scan BERHASIL/CHECKOUT (abaikan duplikat / gagal)
          WEBHOOK_URL: "https://script.google.com/macros/s/xxx-xxx/exec" // 👈 Tambahkan ini

    },
    
    SHEETS: {
      RAW_FORM: "Form Responses 1",
      RAW_FORM_ID: "Jawaban Formulir 1",
      MASTER_SESI: "Master Sesi",
      DATA_PESERTA: "Data Peserta",
      LOG_KEHADIRAN: "Log Kehadiran",
      LOG_EKSEKUSI: "Log Eksekusi"
    }
  };

  /**
  * ==============================================================================
  * HELPER: INISIALISASI STRUKTUR SHEET & LOG EXECUTION
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
      sheetSesi.appendRow(["ID Sesi", "Nama Sesi", "Tanggal Pelaksanaan", "Status", "Tipe Presensi"]);
      sheetSesi.getRange(1, 1, 1, 5).setFontWeight("bold").setBackground("#e2e8f0");
      // Tambahkan 3 contoh sesi awal
      sheetSesi.appendRow(["SESI-01", "Pertemuan 1 - Pembukaan & Onboarding", formatDateOnly(new Date()), "AKTIF", "SINGLE"]);
      sheetSesi.appendRow(["SESI-02", "Pertemuan 2 - Workshop Inti", formatDateOnly(new Date(Date.now() + 86400000)), "AKTIF", "CHECK_IN_OUT"]);
      sheetSesi.appendRow(["SESI-03", "Pertemuan 3 - Evaluasi & Penutupan", formatDateOnly(new Date(Date.now() + 172800000)), "AKTIF", "SINGLE"]);
    } else {
      // Auto-migration: Tambahkan kolom Tipe Presensi jika belum ada
      const lastCol = sheetSesi.getLastColumn();
      if (lastCol > 0) {
        const currentHeaders = sheetSesi.getRange(1, 1, 1, lastCol).getValues()[0];
        const hasTypeCol = currentHeaders.some(h => {
          const s = String(h).toLowerCase();
          return s.includes("tipe") || s.includes("mode");
        });
        if (!hasTypeCol) {
          sheetSesi.getRange(1, lastCol + 1).setValue("Tipe Presensi").setFontWeight("bold").setBackground("#e2e8f0");
        }
      }

      // Auto-validation: Pasang dropdown opsi Status (AKTIF, RUTIN, NONAKTIF, SELESAI)
      try {
        const rule = SpreadsheetApp.newDataValidation()
          .requireValueInList(["AKTIF", "RUTIN", "NONAKTIF", "SELESAI"], true)
          .setAllowInvalid(true)
          .build();
        sheetSesi.getRange("D2:D100").setDataValidation(rule);
      } catch (valErr) {}
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
              sheetPeserta.getRange(r, 3).setFormula(`=IF(A${r}=""; ""; COUNTIF(D${r}:ZZ${r}; "HADIR*"))`);
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

    // 4. Sheet Log Eksekusi (Audit Trail Lifecycle Eksekusi Sistem - Model A)
    const sheetLogEksekusi = getOrCreateSheet(CONFIG.SHEETS.LOG_EKSEKUSI);
    ensureLogEksekusiHeaders(sheetLogEksekusi);
  }

  /**
   * Helper: Inisialisasi Header & Format Sheet Log Eksekusi (Model A: 1 Baris per Eksekusi)
   */
  function ensureLogEksekusiHeaders(sheet) {
    if (sheet.getLastRow() === 0) {
      const headers = [
        "Timestamp",
        "Execution ID",
        "Context / Action",
        "Status",
        "Durasi (ms)",
        "User / Client",
        "Ringkasan",
        "Detail Log"
      ];
      sheet.appendRow(headers);
      sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold").setBackground("#e2e8f0");
      sheet.setFrozenRows(1);

      try {
        sheet.setColumnWidth(1, 155); // Timestamp
        sheet.setColumnWidth(2, 175); // Execution ID
        sheet.setColumnWidth(3, 140); // Context / Action
        sheet.setColumnWidth(4, 90);  // Status
        sheet.setColumnWidth(5, 90);  // Durasi (ms)
        sheet.setColumnWidth(6, 130); // User / Client
        sheet.setColumnWidth(7, 240); // Ringkasan
        sheet.setColumnWidth(8, 400); // Detail Log
      } catch (wErr) {}
    }
  }

  /**
   * Helper: Mencegah spreadsheet membengkak dengan auto-pruning baris log lama jika melebihi batas
   */
  function pruneOldLogsIfNeeded(sheet, maxRows) {
    try {
      const limit = maxRows || 1000;
      const lastRow = sheet.getLastRow();
      if (lastRow > limit + 100) {
        const deleteCount = lastRow - limit;
        if (deleteCount > 0) {
          sheet.deleteRows(2, deleteCount);
        }
      }
    } catch (e) {
      Logger.log("Prune log error: " + e.message);
    }
  }

  /**
   * ==============================================================================
   * SYSTEM EXECUTION LOGGER (MODEL A: 1 ROW PER EXECUTION)
   * ==============================================================================
   * Mengumpulkan step logs selama eksekusi di memory, lalu menuliskan tepat 1 baris
   * ke tab 'Log Eksekusi' saat flush() dipanggil (di blok finally).
   */
  /**
   * Global pointer ke ExecutionLogger yang sedang aktif di context thread ini
   */
  let currentActiveLogger = null;

  class ExecutionLogger {
    constructor(context, meta) {
      this.id = "EXE-" + Utilities.formatDate(new Date(), "GMT+7", "yyMMdd-HHmmss") + "-" + Math.floor(Math.random() * 900 + 100);
      this.startTime = new Date();
      this.context = context || "UNKNOWN";
      this.meta = meta || {};
      this.logs = [];
      this.status = "SUCCESS";
      this.summary = "";
      currentActiveLogger = this;
      this.log("START", `Starting [${this.id}] Context: ${this.context}`);
    }

    log(level, message, data) {
      const elapsed = new Date().getTime() - this.startTime.getTime();
      let entry = `[+${elapsed}ms] [${level.toUpperCase()}] ${message}`;
      if (data !== undefined && data !== null) {
        try {
          entry += " " + (typeof data === "object" ? JSON.stringify(data) : String(data));
        } catch (e) {
          entry += " [Unserializable data]";
        }
      }
      this.logs.push(entry);
      try {
        Logger.log(`[${this.context}] ${entry}`);
      } catch (e) {}
    }

    info(msg, data) { this.log("INFO", msg, data); }
    warn(msg, data) {
      this.log("WARN", msg, data);
      if (this.status !== "ERROR") this.status = "WARNING";
    }
    error(msg, data) {
      this.log("ERROR", msg, data);
      this.status = "ERROR";
    }
    success(msg, data) { this.log("SUCCESS", msg, data); }

    setSummary(summary) {
      this.summary = summary;
    }

    setStatus(status) {
      this.status = status;
    }

    flush() {
      try {
        const endTime = new Date();
        const durationMs = endTime.getTime() - this.startTime.getTime();
        this.log("END", `Finished with status=${this.status} in ${durationMs}ms`);

        const ss = getSpreadsheet();
        const sheet = getOrCreateSheet(CONFIG.SHEETS.LOG_EKSEKUSI);
        ensureLogEksekusiHeaders(sheet);

        const timestampStr = formatFullDateTime(this.startTime);
        const actionStr = this.meta.action || this.context;
        const userStr = this.meta.user || this.meta.scannedBy || this.meta.client || "-";
        const summaryStr = this.summary || (this.status === "SUCCESS" ? "OK" : (this.status === "ERROR" ? "Failed" : "Completed"));
        const fullLogText = this.logs.join("\n");

        sheet.appendRow([
          timestampStr,
          this.id,
          actionStr,
          this.status,
          durationMs,
          userStr,
          summaryStr,
          fullLogText
        ]);

        const lastRow = sheet.getLastRow();
        const statusCell = sheet.getRange(lastRow, 4);
        if (this.status === "SUCCESS") {
          statusCell.setBackground("#dcfce7").setFontColor("#15803d").setFontWeight("bold");
        } else if (this.status === "ERROR") {
          statusCell.setBackground("#fee2e2").setFontColor("#b91c1c").setFontWeight("bold");
        } else if (this.status === "WARNING") {
          statusCell.setBackground("#fef9c3").setFontColor("#a16207").setFontWeight("bold");
        }

        pruneOldLogsIfNeeded(sheet, 1000);
      } catch (flushErr) {
        Logger.log("[ExecutionLogger flush error]: " + flushErr.message);
      } finally {
        if (currentActiveLogger === this) {
          currentActiveLogger = null;
        }
      }
    }
  }

  /**
   * Global Universal Logger helper (Function-hoisted agar aman dipanggil dari mana saja):
   * Mengirim log ke ExecutionLogger aktif jika ada transaksi yang berjalan (doPost, doGet, onFormSubmit, dll.),
   * sehingga otomatis terakumulasi dan tertulis di sheet 'Log Eksekusi'.
   * Jika tidak ada ExecutionLogger aktif, fallback ke Logger.log bawaan Apps Script.
   */
  function sysLog(level, msg, data) {
    if (currentActiveLogger) {
      if (level === "info") currentActiveLogger.info(msg, data);
      else if (level === "warn") currentActiveLogger.warn(msg, data);
      else if (level === "error") currentActiveLogger.error(msg, data);
      else if (level === "success") currentActiveLogger.success(msg, data);
      else currentActiveLogger.log(level, msg, data);
    } else {
      try {
        Logger.log(`[${String(level || "LOG").toUpperCase()}] ${msg}` + (data ? " " + JSON.stringify(data) : ""));
      } catch (e) {
        Logger.log(`[${String(level || "LOG").toUpperCase()}] ${msg}`);
      }
    }
  }
  sysLog.info = function(msg, data) { sysLog("info", msg, data); };
  sysLog.warn = function(msg, data) { sysLog("warn", msg, data); };
  sysLog.error = function(msg, data) { sysLog("error", msg, data); };
  sysLog.success = function(msg, data) { sysLog("success", msg, data); };

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
      if (s.includes("email")) emailCol = idx;
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
        sysLog.info("Notice checking parent access: " + accessErr.message);
      }

      // Jika parent folder publik, isolasi folder QR ke My Drive Root agar peserta tidak bisa jelajahi parent
      if (isParentPublic) {
        sysLog.warn("⚠️ Parent folder bersifat PUBLIK. Untuk privasi peserta, folder QR dialihkan ke Root My Drive.");
        parentFolder = DriveApp.getRootFolder();
      }

      const existing = parentFolder.getFoldersByName(CONFIG.QR_SUBFOLDER_NAME);
      let targetFolder;
      if (existing.hasNext()) {
        targetFolder = existing.next();
      } else {
        targetFolder = parentFolder.createFolder(CONFIG.QR_SUBFOLDER_NAME);
        sysLog.success("📁 Folder baru dibuat: " + CONFIG.QR_SUBFOLDER_NAME);
      }

      // Kunci akses folder agar selalu PRIVATE (Restricted / Dibatasi)
      try {
        targetFolder.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
      } catch (shareErr) {
        sysLog.info("Folder setSharing notice: " + shareErr.message);
      }

      return targetFolder;
    } catch (err) {
      sysLog.warn("Folder error: " + err.message + ", fallback ke root");
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

  /**
   * Helper: Generate URL QR Code QuickChart dengan caption Nama Acara & font Roboto modern
   */
  function buildQrCodeUrl(ticketId) {
    const captionText = CONFIG.EVENT_NAME || ticketId;
    const fontFamily = CONFIG.QR_FONT_FAMILY || "Roboto";
    const fontSize = CONFIG.QR_FONT_SIZE || 18;
    const fontColor = CONFIG.QR_FONT_COLOR || "1e293b";

    return "https://quickchart.io/qr?text=" + encodeURIComponent(ticketId) +
      "&size=450&margin=2" +
      "&caption=" + encodeURIComponent(captionText) +
      "&captionFontFamily=" + encodeURIComponent(fontFamily) +
      "&captionFontSize=" + fontSize +
      "&captionFontColor=" + fontColor;
  }

  function formatDateOnly(d) {
    return Utilities.formatDate(d, Session.getScriptTimeZone(), "yyyy-MM-dd");
  }

  function formatFullDateTime(d) {
    return Utilities.formatDate(d, Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
  }

  /**
   * SMART HYBRID DRIVE SHARING (AUTO-FALLBACK):
   * 1. Cek sisa kuota email harian (MailApp.getRemainingDailyQuota()).
   * 2. Jika kuota > 10: Berikan akses viewer DENGAN notifikasi email resmi Google Drive (sendNotificationEmail: true).
   * 3. Jika kuota <= 10 ATAU jika notifikasi gagal/limit: Otomatis FALLBACK ke SILENT SHARE (sendNotificationEmail: false)
   *    agar pendaftaran peserta tetap sukses masuk ke Google Drive tanpa error.
   */
  function grantDriveViewerSmart(fileId, email) {
    if (!email || !fileId || fileId === "-") return false;
    const cleanEmail = email.trim();

    // Cek ketersediaan kuota email
    let remainingQuota = 0;
    try {
      remainingQuota = MailApp.getRemainingDailyQuota();
    } catch (e) {
      remainingQuota = 0;
    }

    // Beri batas pengaman: jika sisa kuota > 10, kita coba kirim email notifikasi
    const shouldTryNotify = (remainingQuota > 10);

    // 1. Coba Drive API v3
    if (typeof Drive !== "undefined" && Drive.Permissions && typeof Drive.Permissions.create === "function") {
      if (shouldTryNotify) {
        try {
          Drive.Permissions.create(
            {
              role: "reader",
              type: "user",
              emailAddress: cleanEmail
            },
            fileId,
            {
              sendNotificationEmail: true
            }
          );
          sysLog.success(`[Drive API v3] Shared WITH email notification to: ${cleanEmail} (Sisa Kuota: ${remainingQuota})`);
          return { success: true, notified: true };
        } catch (notifyErr) {
          sysLog.warn(`Gagal kirim notif email (${notifyErr.message}), auto-fallback ke Silent Share.`);
        }
      }

      // Fallback ke Silent Share (sendNotificationEmail: false)
      try {
        Drive.Permissions.create(
          {
            role: "reader",
            type: "user",
            emailAddress: cleanEmail
          },
          fileId,
          {
            sendNotificationEmail: false
          }
        );
        sysLog.success(`[Drive API v3] Shared SILENT (no email) to: ${cleanEmail}`);
        return { success: true, notified: false };
      } catch (silentErr) {
        const msg = silentErr.message || "";
        if (msg.toLowerCase().includes("already") || msg.toLowerCase().includes("exists")) {
          return { success: true, notified: false };
        }
        throw silentErr;
      }
    }

    // 2. Coba Drive API v2
    if (typeof Drive !== "undefined" && Drive.Permissions && typeof Drive.Permissions.insert === "function") {
      if (shouldTryNotify) {
        try {
          Drive.Permissions.insert(
            {
              role: "reader",
              type: "user",
              value: cleanEmail
            },
            fileId,
            {
              sendNotificationEmails: true
            }
          );
          sysLog.success(`[Drive API v2] Shared WITH email notification to: ${cleanEmail}`);
          return { success: true, notified: true };
        } catch (notifyErr2) {
          sysLog.warn(`Drive v2 notif gagal (${notifyErr2.message}), fallback ke silent.`);
        }
      }

      try {
        Drive.Permissions.insert(
          {
            role: "reader",
            type: "user",
            value: cleanEmail
          },
          fileId,
          {
            sendNotificationEmails: false
          }
        );
        sysLog.success(`[Drive API v2] Shared SILENT to: ${cleanEmail}`);
        return { success: true, notified: false };
      } catch (silentErr2) {
        const msg = silentErr2.message || "";
        if (msg.toLowerCase().includes("already") || msg.toLowerCase().includes("exists")) {
          return { success: true, notified: false };
        }
        throw silentErr2;
      }
    }

    // 3. Fallback standard DriveApp
    DriveApp.getFileById(fileId).addViewer(cleanEmail);
    sysLog.success(`[DriveApp fallback] Viewer granted to: ${cleanEmail}`);
    return { success: true, notified: false };
  }

  // Alias agar kompatibel ke seluruh pemanggilan kode
  const grantDriveViewerSilent = grantDriveViewerSmart;

  /**
  * ==============================================================================
  * TRIGGER: onFormSubmit (MEMBACA DATA FORM TANPA MENGOTAK-ATIK FORM RESPONSES 1)
  * ==============================================================================
  */
  function onFormSubmit(e) {
    const logger = new ExecutionLogger("onFormSubmit");
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
      
      if (!sheetRaw || targetRow <= 1) {
        logger.warn("Form sheet not found or empty targetRow");
        logger.setSummary("Form Kosong / Baris Tidak Valid");
        return;
      }

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
        logger.error("Kolom Nama atau Email tidak ditemukan di Form Responses");
        logger.setSummary("Error: Header Form Kurang Nama/Email");
        return;
      }

      const name = String(rawData[nameIdx] || "").trim();
      const email = String(rawData[emailIdx] || "").trim();
      const regTimestamp = rawData[timeIdx] ? formatFullDateTime(new Date(rawData[timeIdx])) : formatFullDateTime(new Date());

      logger.meta.user = `${name} (${email})`;

      if (!email || !name) {
        logger.warn("Form submission missing name or email", { name, email });
        logger.setSummary("Submit Dilewati: Nama/Email Kosong");
        return;
      }

      // 2. Cek apakah peserta sudah pernah ada di sheet "Data Peserta" (berdasarkan email)
      const sheetPeserta = getOrCreateSheet(CONFIG.SHEETS.DATA_PESERTA);
      const { emailCol } = getPesertaFieldIndices(sheetPeserta);
      const pesertaData = sheetPeserta.getDataRange().getValues();
      
      for (let r = 1; r < pesertaData.length; r++) {
        if (String(pesertaData[r][emailCol]).trim().toLowerCase() === email.toLowerCase()) {
          logger.warn(`Email ${email} sudah terdaftar sebelumnya di Data Peserta`);
          logger.setSummary(`Dilewati (Duplikat Email): ${name}`);
          return;
        }
      }

      // 3. Generate Ticket ID & QR Code Image (DILAKUKAN TANPA MENAHAN SCRIPT LOCK AGAR SCANNER TIDAK TERGANGGU)
      const ticketId = generateTicketId();
      let fileId = "-";
      let fileUrl = "-";

      try {
        const qrUrl = buildQrCodeUrl(ticketId);
        const qrResponse = UrlFetchApp.fetch(qrUrl, { muteHttpExceptions: true });
        if (qrResponse.getResponseCode() === 200) {
          const sanitizedName = name.replace(/[^a-zA-Z0-9_-]/g, "_");
          const qrBlob = qrResponse.getBlob().setName("QR_" + sanitizedName + "_" + ticketId + ".png");

          // 4. Simpan ke Google Drive folder
          const targetFolder = getOrCreateQrFolder();
          const driveFile = targetFolder.createFile(qrBlob);
          fileId = driveFile.getId();
          fileUrl = driveFile.getUrl();

          // 5. SESUAI CONSTRAINT: Share akses file ke peserta secara SILENT tanpa kirim email notifikasi!
          try {
            grantDriveViewerSilent(fileId, email);
            logger.info("Drive file viewer granted to: " + email);
          } catch (shareErr) {
            logger.warn("Drive viewer warning: " + shareErr.message);
          }
        }
      } catch (qrErr) {
        logger.warn("QR generation warning: " + qrErr.message);
      }

      // 6. Masukkan data ke sheet "Data Peserta" dengan Smart Dynamic Column Mapping
      const nextRow = sheetPeserta.getLastRow() + 1;
      const formulaTotal = `=IF(A${nextRow}=""; ""; COUNTIF(D${nextRow}:ZZ${nextRow}; "HADIR*"))`;

      // Kumpulkan seluruh jawaban form dalam map (lowercase key)
      const formAnswers = {};
      rawHeaders.forEach((h, idx) => {
        const title = String(h || "").trim();
        if (title) {
          formAnswers[title.toLowerCase()] = String(rawData[idx] || "").trim();
        }
      });

      const lastCol = sheetPeserta.getLastColumn();
      const pHeaders = sheetPeserta.getRange(1, 1, 1, lastCol).getValues()[0];
      const attendeeRowData = new Array(pHeaders.length).fill("");

      pHeaders.forEach((h, idx) => {
        const headerStr = String(h || "").trim();
        const lower = headerStr.toLowerCase();

        if (lower.includes("ticket") || lower === "id" || lower.includes("id tiket")) {
          attendeeRowData[idx] = ticketId;
        } else if (lower.includes("nama")) {
          attendeeRowData[idx] = name;
        } else if (lower.includes("total") || lower.includes("jumlah")) {
          attendeeRowData[idx] = formulaTotal;
        } else if (lower.includes("email")) {
          attendeeRowData[idx] = email;
        } else if (lower.includes("drive file id") || lower === "file id") {
          attendeeRowData[idx] = fileId;
        } else if (lower.includes("drive file url") || lower === "file url") {
          attendeeRowData[idx] = fileUrl;
        } else if (lower.includes("waktu daftar") || lower === "timestamp" || lower.includes("tanggal")) {
          attendeeRowData[idx] = regTimestamp;
        } else if (lower.startsWith("sesi:") || (lower.includes("[") && lower.includes("]"))) {
          attendeeRowData[idx] = "";
        } else {
          // Kolom custom (misal Fakultas, Jenis Kelamin, No HP, dll)
          let matchedAns = formAnswers[lower];
          if (matchedAns === undefined) {
            const foundKey = Object.keys(formAnswers).find(k => k.includes(lower) || lower.includes(k));
            if (foundKey && formAnswers[foundKey] !== undefined) {
              matchedAns = formAnswers[foundKey];
            }
          }
          attendeeRowData[idx] = matchedAns || "";
        }
      });

      const lock = LockService.getScriptLock();
      if (lock.tryLock(8000)) {
        try {
          sheetPeserta.appendRow(attendeeRowData);
          logger.success("Sukses mendaftarkan peserta baru via Form: " + name + " (" + ticketId + ")");
          logger.setSummary(`Form Sukses: ${name} (${ticketId})`);
        } finally {
          lock.releaseLock();
        }
      } else {
        logger.warn("Lock timeout saat append row peserta baru, append tanpa lock");
        sheetPeserta.appendRow(attendeeRowData);
        logger.setSummary(`Form Sukses (No Lock): ${name} (${ticketId})`);
      }

    } catch (err) {
      logger.error("Error onFormSubmit: " + err.message, err.stack);
      logger.setSummary("Form Error: " + err.message);
    } finally {
      logger.flush();
    }
  }

  /**
  * ==============================================================================
  * HELPER: SESI RUTIN & MANAJEMEN KOLOM SESI DI SHEET "DATA PESERTA"
  * ==============================================================================
  */

  let _routineSessionsCache = null;

  /**
   * Helper: Mengambil ID murni sesi tanpa embel-embel tanggal (_2026-10-25) atau mode (_IN / _OUT)
   */
  function extractBaseSessionId(sessionId) {
    if (!sessionId) return "";
    let id = String(sessionId).trim();
    // Hapus suffix tanggal (_2026-10-25 atau _20261025)
    id = id.replace(/_\d{4}-?\d{2}-?\d{2}.*$/i, "");
    // Hapus suffix mode (_IN atau _OUT)
    id = id.replace(/_(IN|OUT)$/i, "");
    return id.trim().toUpperCase();
  }

  /**
   * Helper: Mengambil daftar ID Sesi yang berstatus 'RUTIN' di sheet Master Sesi (In-memory cached)
   */
  function getRoutineSessionIds() {
    if (_routineSessionsCache !== null) return _routineSessionsCache;
    const set = new Set();
    try {
      const sheetSesi = getOrCreateSheet(CONFIG.SHEETS.MASTER_SESI);
      const data = sheetSesi.getDataRange().getValues();
      for (let i = 1; i < data.length; i++) {
        const rowId = String(data[i][0] || "").trim().toUpperCase();
        const status = String(data[i][3] || "").trim().toUpperCase();
        if (rowId && status === "RUTIN") {
          set.add(rowId);
        }
      }
    } catch (e) {
      sysLog.info("getRoutineSessionIds notice: " + e.message);
    }
    _routineSessionsCache = set;
    return set;
  }

  /**
   * Helper: Cek apakah ID Sesi merupakan sesi berstatus RUTIN (mendukung format baseId, baseId_IN, baseId_2026-10-25, dll)
   */
  function checkIsRoutineSession(sessionId) {
    if (!sessionId) return false;
    const baseId = extractBaseSessionId(sessionId);
    return getRoutineSessionIds().has(baseId);
  }

  /**
   * Helper: Resolusi ID & Nama Sesi Efektif
   * - Mode RUTIN:
   *     - Jika ada tag _IN / _OUT: [BASEID_YYYY-MM-DD_IN] / [BASEID_YYYY-MM-DD_OUT]
   *     - Jika mode SINGLE: [BASEID_YYYY-MM-DD]
   *     - Nama sesi menyematkan mode dan tanggal, e.g. "Workshop Inti (Masuk) (25/10/2026)"
   * - Mode REGULER:
   *     - Jika ada tag _IN / _OUT: [BASEID_IN] / [BASEID_OUT]
   *     - Nama sesi menyematkan mode, e.g. "Workshop Inti (Masuk)"
   */
  function resolveEffectiveSession(rawSessionId, rawSessionName) {
    const sId = (rawSessionId || "SESI-01").trim();
    const sName = (rawSessionName || sId).trim();
    const baseId = extractBaseSessionId(sId);

    // Deteksi jika ada tag _IN atau _OUT
    const isOut = /_OUT$/i.test(sId);
    const isIn = /_IN$/i.test(sId);
    const modeSuffix = isOut ? "_OUT" : (isIn ? "_IN" : "");
    const modeLabel = isOut ? " (Keluar)" : (isIn ? " (Masuk)" : "");

    if (checkIsRoutineSession(sId)) {
      const todayIso = Utilities.formatDate(new Date(), "GMT+7", "yyyy-MM-dd");
      const todayDisplay = Utilities.formatDate(new Date(), "GMT+7", "dd/MM/yyyy");

      // Target ID untuk Mode Rutin selalu menyematkan tanggal hari ini
      let effectiveId = sId;
      if (!sId.includes(todayIso)) {
        effectiveId = modeSuffix ? `${baseId}_${todayIso}${modeSuffix}` : `${baseId}_${todayIso}`;
      }

      let cleanName = sName.replace(/\s*\(\d{1,2}\/\d{1,2}\/\d{4}\)/g, "").replace(/\s*\((Masuk|Keluar)\)/gi, "").trim();
      const effectiveName = `${cleanName}${modeLabel} (${todayDisplay})`;

      return {
        id: effectiveId,
        name: effectiveName,
        isRoutine: true,
        baseId: baseId,
        modeSuffix: modeSuffix,
        todayIso: todayIso,
        todayDisplay: todayDisplay
      };
    }

    let cleanName = sName.replace(/\s*\((Masuk|Keluar)\)/gi, "").trim();
    const effectiveName = `${cleanName}${modeLabel}`;

    return {
      id: sId,
      name: effectiveName,
      isRoutine: false,
      baseId: baseId,
      modeSuffix: modeSuffix
    };
  }

  /**
   * Helper: Mencari index kolom sesi di sheet "Data Peserta" (1-based, atau -1 jika tidak ada).
   * Operasi READ-ONLY (aman untuk pencarian peserta, pembatalan, validasi) tanpa pernah membuat kolom baru secara tidak sengaja.
   */
  function findSessionColumn(sheetPeserta, sessionId, sessionName) {
    const resolved = resolveEffectiveSession(sessionId, sessionName);
    const targetId = resolved.id;
    const isRoutine = resolved.isRoutine;
    const baseId = resolved.baseId;
    const todayIso = resolved.todayIso;
    const modeSuffix = resolved.modeSuffix;

    const lastCol = Math.max(1, sheetPeserta.getLastColumn());
    const headers = sheetPeserta.getRange(1, 1, 1, lastCol).getValues()[0];

    // Prioritas 1: Cari yang persis mengandung [targetId]
    for (let c = 0; c < headers.length; c++) {
      const h = String(headers[c] || "");
      if (h.includes(`[${targetId}]`)) {
        return c + 1;
      }
    }

    // Prioritas 2: Khusus untuk sesi Rutin SINGLE (tanpa _IN / _OUT), cek jika ada kolom [BASEID_YYYY-MM-DD]
    if (isRoutine && !modeSuffix) {
      const combinedRoutineId = `${baseId}_${todayIso}`;
      for (let c = 0; c < headers.length; c++) {
        const h = String(headers[c] || "");
        if (h.includes(`[${combinedRoutineId}]`)) {
          return c + 1;
        }
      }
    }

    return -1;
  }

  /**
   * Helper: Ambil atau buat kolom sesi di sheet "Data Peserta".
   * UNTUK MODE RUTIN:
   * 1. Jika mode IN/OUT: Dipisah menjadi 2 kolom harian: [BASEID_YYYY-MM-DD_IN] dan [BASEID_YYYY-MM-DD_OUT].
   * 2. Jika mode SINGLE: Kolom harian [BASEID_YYYY-MM-DD].
   * 3. TIDAK AKAN PERNAH salah masuk ke kolom sesi biasa lama (e.g. [SESI-02] atau [SESI-02_IN])!
   * 4. Jika belum ada kolom untuk hari/mode ini, otomatis buat kolom baru ke samping kanan dengan warna kuning lembut (#fef08a).
   */
  function getOrCreateSessionColumn(sheetPeserta, sessionId, sessionName) {
    const existingColIdx = findSessionColumn(sheetPeserta, sessionId, sessionName);
    if (existingColIdx > 0) {
      return existingColIdx;
    }

    const resolved = resolveEffectiveSession(sessionId, sessionName);
    const targetId = resolved.id;
    const targetName = resolved.name;
    const isRoutine = resolved.isRoutine;

    // Jika belum ada, buat kolom baru di samping kanan
    const lastCol = Math.max(1, sheetPeserta.getLastColumn());
    const newColIdx = lastCol + 1;
    const colHeaderTitle = `Sesi: ${targetName} [${targetId}]`;
    const bgColor = isRoutine ? "#fef08a" : "#dbeafe"; // Soft yellow untuk rutin, soft blue untuk reguler

    sheetPeserta.getRange(1, newColIdx)
      .setValue(colHeaderTitle)
      .setFontWeight("bold")
      .setBackground(bgColor);

    return newColIdx;
  }

  /**
   * Helper: Ambil daftar kolom dinamis (custom fields) dari sheet "Data Peserta".
   * Mengecualikan kolom sistem: ID Tiket, Nama, Total Kehadiran, Kontak/Email, File ID, File URL, Tanggal, dan Kolom Sesi [SESI-XX].
   * Mendeteksi otomatis dropdown validation jika ada di spreadsheet.
   */
  function getCustomFields(sheetPeserta) {
    const lastCol = Math.max(1, sheetPeserta.getLastColumn());
    const headers = sheetPeserta.getRange(1, 1, 1, lastCol).getValues()[0];
    const customFields = [];

    let validations = null;
    try {
      if (sheetPeserta.getLastRow() >= 2) {
        validations = sheetPeserta.getRange(2, 1, 1, lastCol).getDataValidations()[0];
      }
    } catch (e) {
      sysLog.info("Validation read notice: " + e.message);
    }

    headers.forEach((h, idx) => {
      const headerStr = String(h || "").trim();
      const lower = headerStr.toLowerCase();
      if (!headerStr) return;

      const isTicket = lower.includes("ticket") || lower === "id" || lower.includes("id tiket");
      const isName = lower.includes("nama");
      const isTotal = lower.includes("total") || lower.includes("jumlah");
      const isContact = lower.includes("email");
      const isDriveId = lower.includes("drive file id") || lower === "file id";
      const isDriveUrl = lower.includes("drive file url") || lower === "file url";
      const isTime = lower.includes("waktu") || lower === "timestamp" || lower.includes("tanggal");
      const isSession = lower.startsWith("sesi:") || (lower.includes("[") && lower.includes("]"));

      if (!isTicket && !isName && !isTotal && !isContact && !isDriveId && !isDriveUrl && !isTime && !isSession) {
        let fieldType = "text";
        let options = [];

        if (validations && validations[idx]) {
          try {
            const rule = validations[idx];
            if (rule && rule.getCriteriaType() === SpreadsheetApp.DataValidationCriteria.VALUE_IN_LIST) {
              fieldType = "select";
              options = rule.getCriteriaValues()[0] || [];
            }
          } catch (err) {
            sysLog.info("Validation parse error: " + err.message);
          }
        }

        customFields.push({
          name: headerStr,
          label: headerStr,
          type: fieldType,
          options: options,
          colIdx: idx
        });
      }
    });

    return customFields;
  }

  /**
  * Helper: Ambil sesi berstatus AKTIF atau RUTIN dari sheet "Master Sesi"
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
      const rawType = String(row[4] || "SINGLE").trim().toUpperCase();
      const type = (rawType.includes("OUT") || rawType.includes("CHECK_IN_OUT") || rawType.includes("IN_OUT")) 
        ? "CHECK_IN_OUT" 
        : "SINGLE";

      if (id && (status === "AKTIF" || status === "RUTIN")) {
        const isRoutine = (status === "RUTIN");
        const todayDateStr = formatDateOnly(new Date());
        const effectiveDate = isRoutine ? todayDateStr : date;
        const label = `${name} (${effectiveDate || id})`;

        sessions.push({
          id: id,
          name: name,
          date: effectiveDate,
          status: status,
          isRoutine: isRoutine,
          type: type,
          label: label
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

    const todayIso = Utilities.formatDate(new Date(), "GMT+7", "yyyy-MM-dd");
    const attendees = [];

    for (let r = 1; r < pesertaData.length; r++) {
      const tId = String(pesertaData[r][ticketCol] || "").trim();
      if (!tId) continue;

      const sessionsMap = {};
      sessionCols.forEach(sc => {
        const val = String(pesertaData[r][sc.colIdx] || "").trim();
        if (val.startsWith("HADIR") || val.startsWith("CHECKOUT")) {
          const parsedVal = val.replace(/^(HADIR|CHECKOUT)\s*-\s*/, "").trim() || val;
          sessionsMap[sc.sessionId] = parsedVal;

          // Jika kolom ini adalah kolom harian untuk sesi rutin pada hari ini, map juga ke base sessionId dan varian _IN/_OUT secara presisi
          if (sc.sessionId.includes(todayIso)) {
            const baseId = extractBaseSessionId(sc.sessionId);
            const isOutCol = /_OUT$/i.test(sc.sessionId);
            const isInCol = /_IN$/i.test(sc.sessionId);
            if (isOutCol) {
              sessionsMap[`${baseId}_OUT`] = parsedVal;
            } else if (isInCol) {
              sessionsMap[`${baseId}_IN`] = parsedVal;
            } else {
              sessionsMap[baseId] = parsedVal;
            }
          }
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
    const logger = new ExecutionLogger("doGet");
    try {
      ensureAllSheetsSetup();
      const action = (e && e.parameter && e.parameter.action) || "status";
      logger.meta.action = action;

      // ACTION 0: DASHBOARD REALTIME ANALYTICS (Zero-Lock)
      if (action === "getDashboardData" || action === "getDashboardSummary") {
        if (typeof handleDashboardRequest === "function") {
          return handleDashboardRequest(e, e.parameter);
        }
      }

      if (action === "getSessions") {
        const sessions = getActiveSessions();
        const sheetPeserta = getOrCreateSheet(CONFIG.SHEETS.DATA_PESERTA);
        const customFields = getCustomFields(sheetPeserta);
        logger.info(`getSessions returned ${sessions.length} sessions, ${customFields.length} custom fields`);
        logger.setSummary(`getSessions: ${sessions.length} sesi, ${customFields.length} custom fields`);
        return createJsonResponse({
          success: true,
          status: "OK",
          sessions: sessions,
          customFields: customFields,
          timestamp: new Date().toISOString()
        });
      }

      if (action === "getAttendees") {
        const sheetPeserta = getOrCreateSheet(CONFIG.SHEETS.DATA_PESERTA);
        const attendees = buildAttendeesList(sheetPeserta);
        logger.info(`getAttendees returned ${attendees.length} attendees`);
        logger.setSummary(`getAttendees: ${attendees.length} attendees`);
        return createJsonResponse({
          success: true,
          attendees: attendees,
          count: attendees.length,
          timestamp: new Date().toISOString()
        });
      }

      logger.info("Health check ping: ONLINE");
      logger.setSummary("Health check: ONLINE");
      return createJsonResponse({
        success: true,
        status: "ONLINE",
        app: "EventPass Google Apps Script API",
        timeZone: Session.getScriptTimeZone(),
        activeSessions: getActiveSessions(),
        timestamp: new Date().toISOString()
      });
    } catch (err) {
      logger.error("doGet error: " + err.message);
      logger.setSummary("doGet Error: " + err.message);
      return createJsonResponse({
        success: false,
        status: "ERROR",
        message: "Health check error: " + err.message
      });
    } finally {
      logger.flush();
    }
  }

  /**
  * ==============================================================================
  * WEB API: doPost (Check-In, Cancel/Undo Check-In, Search, & Register OTS)
  * ==============================================================================
  */
  function doPost(e) {
    const logger = new ExecutionLogger("doPost");
    try {
      ensureAllSheetsSetup();

      let payload = {};
      if (e && e.postData && e.postData.contents) {
        try {
          payload = JSON.parse(e.postData.contents);
          logger.info("Payload received", { action: payload.action, ticketId: payload.ticketId, sessionId: payload.sessionId });
        } catch (jsonErr) {
          logger.error("Invalid JSON payload: " + jsonErr.message);
          logger.setSummary("Invalid JSON payload");
          return createJsonResponse({ success: false, message: "Invalid JSON payload" });
        }
      } else {
        logger.warn("No postData contents received");
      }

      const action = payload.action || "checkIn";
      logger.meta.action = action;
      logger.meta.user = payload.scannedBy || payload.operator || "-";

      const sheetPeserta = getOrCreateSheet(CONFIG.SHEETS.DATA_PESERTA);
      const sheetLog = getOrCreateSheet(CONFIG.SHEETS.LOG_KEHADIRAN);

      // ============================================================================
      // 1. READ-ONLY ACTIONS (PARALEL, ZERO LOCK — TIDAK MENGUNCI & TIDAK DIKUNCI)
      // ============================================================================

      // ACTION A: GET ACTIVE SESSIONS
      if (action === "getSessions") {
        const sessions = getActiveSessions();
        const customFields = getCustomFields(sheetPeserta);
        logger.info(`getSessions returned ${sessions.length} sessions, ${customFields.length} custom fields`);
        logger.setSummary(`getSessions: ${sessions.length} sesi, ${customFields.length} custom fields`);
        return createJsonResponse({
          success: true,
          sessions: sessions,
          customFields: customFields
        });
      }

      // ACTION A2: GET ALL ATTENDEES (For Offline Local Pre-Caching & Instant Mode)
      if (action === "getAttendees") {
        const attendees = buildAttendeesList(sheetPeserta);
        logger.info(`getAttendees returned ${attendees.length} attendees`);
        logger.setSummary(`getAttendees: ${attendees.length} attendees`);
        return createJsonResponse({
          success: true,
          attendees: attendees,
          count: attendees.length,
          timestamp: new Date().toISOString()
        });
      }

      // ACTION A3: GET DASHBOARD ANALYTICS (Realtime Zero-Lock Analytics)
      if (action === "getDashboardData" || action === "getDashboardSummary") {
        if (typeof handleDashboardRequest === "function") {
          return handleDashboardRequest(e, payload);
        }
      }

      // ACTION B: SEARCH PESERTA (Manual Search by Name/Email/Ticket)
      if (action === "search") {
        const query = (payload.query || "").toLowerCase().trim();
        const rawSessionId = (payload.sessionId || "SESI-01").trim();
        const rawSessionName = (payload.sessionName || rawSessionId).trim();
        const resolvedSession = resolveEffectiveSession(rawSessionId, rawSessionName);
        const sessionId = resolvedSession.id;
        const sessionName = resolvedSession.name;

        if (!query) {
          logger.info("Search empty query");
          logger.setSummary("Search: query kosong");
          return createJsonResponse({ success: true, results: [] });
        }

        const pesertaData = sheetPeserta.getDataRange().getValues();
        const { ticketCol, nameCol, emailCol } = getPesertaFieldIndices(sheetPeserta);
        const baseId = extractBaseSessionId(rawSessionId);
        
        // Cek kolom IN, OUT, dan Single secara presisi agar status hadir/keluar akurat
        const inColIdx = findSessionColumn(sheetPeserta, `${baseId}_IN`, rawSessionName);
        const outColIdx = findSessionColumn(sheetPeserta, `${baseId}_OUT`, rawSessionName);
        const singleColIdx = findSessionColumn(sheetPeserta, baseId, rawSessionName);
        const results = [];

        for (let r = 1; r < pesertaData.length; r++) {
          const row = pesertaData[r];
          const tId = String(row[ticketCol] || "");
          const tName = String(row[nameCol] || "");
          const tEmail = String(row[emailCol] || "");

          if (tId.toLowerCase().includes(query) || tName.toLowerCase().includes(query) || tEmail.toLowerCase().includes(query)) {
            const inVal = inColIdx > 0 ? String(row[inColIdx - 1] || "").trim() : "";
            const outVal = outColIdx > 0 ? String(row[outColIdx - 1] || "").trim() : "";
            const singleVal = singleColIdx > 0 ? String(row[singleColIdx - 1] || "").trim() : "";

            const hasIn = inVal.startsWith("HADIR") || singleVal.startsWith("HADIR");
            const hasOut = outVal.startsWith("CHECKOUT") || singleVal.startsWith("CHECKOUT");

            let status = "BELUM_HADIR";
            if (hasOut) status = "CHECKOUT";
            else if (hasIn) status = "HADIR";

            const statusDetail = hasOut ? outVal : (hasIn ? inVal : (singleVal || "Belum Absen"));

            results.push({
              ticketId: tId,
              name: tName,
              email: tEmail,
              hasIn: hasIn,
              hasOut: hasOut,
              inTime: inVal.replace(/^HADIR\s*-\s*/, "") || "",
              outTime: outVal.replace(/^CHECKOUT\s*-\s*/, "") || "",
              status: status,
              statusDetail: statusDetail,
              sessionId: sessionId,
              sessionName: sessionName
            });
          }
          if (results.length >= 20) break; // Limit 20 hasil teratas
        }

        logger.info(`Search "${query}" matched ${results.length} rows`);
        logger.setSummary(`Search "${query}": ${results.length} hasil`);
        return createJsonResponse({ success: true, results: results });
      }

      // ============================================================================
      // 2. MUTATION ACTIONS (CHECK-IN, CANCEL, OTS) -> MEMERLUKAN EXCLUSIVE LOCK
      // ============================================================================
      const lock = LockService.getScriptLock();
      let lockReleased = false;
      let lockAcquiredAt = 0;
      const releaseLockOnce = () => {
        if (!lockReleased) {
          try {
            lock.releaseLock();
            const lockHeldMs = lockAcquiredAt ? (Date.now() - lockAcquiredAt) : 0;
            logger.info(`[LOCK] 🔓 ScriptLock DILEPAS setelah ditahan ${lockHeldMs}ms (Micro-Locking selesai). Antrean lain sekarang bebas masuk!`);
          } catch (e) {
            sysLog.info("Notice releasing lock: " + e.message);
          }
          lockReleased = true;
        }
      };

      const lockWaitStart = Date.now();
      if (!lock.tryLock(27000)) {
        const lockWaitMs = Date.now() - lockWaitStart;
        logger.warn(`[LOCK] ❌ ScriptLock busy / timeout setelah antre ${lockWaitMs}ms`);
        logger.setSummary("Server Busy (Lock Timeout)");
        return createJsonResponse({
          success: false,
          status: "SERVER_BUSY",
          message: "Server sibuk memproses antrean presensi, silakan ulangi sesaat lagi."
        });
      }
      lockAcquiredAt = Date.now();
      const lockWaitMs = lockAcquiredAt - lockWaitStart;
      logger.info(`[LOCK] 🔒 Berhasil memperoleh ScriptLock setelah antre ${lockWaitMs}ms. Memulai critical section presensi.`);

      try {
        const pesertaData = sheetPeserta.getDataRange().getValues();
        const mapsUrl = (payload.mapsUrl || "-").trim();
        const deviceInfo = (payload.deviceInfo || "-").trim();

        // -------------------------------------------------------------
        // ACTION C: CHECK-IN SESI TERTENTU
        // -------------------------------------------------------------
        if (action === "checkIn" || action === "scan") {
          const ticketId = (payload.ticketId || "").trim();
          const rawSessionId = (payload.sessionId || "SESI-01").trim();
          const rawSessionName = (payload.sessionName || rawSessionId).trim();
          const resolvedSession = resolveEffectiveSession(rawSessionId, rawSessionName);
          const sessionId = resolvedSession.id;
          const sessionName = resolvedSession.name;
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
          let attendeeRowData = null;
          const { ticketCol, nameCol, emailCol } = getPesertaFieldIndices(sheetPeserta);

          for (let r = 1; r < pesertaData.length; r++) {
            if (String(pesertaData[r][ticketCol]).toUpperCase() === ticketId.toUpperCase()) {
              foundRow = r + 1; // 1-based row index
              attendeeName = pesertaData[r][nameCol] || "Peserta";
              attendeeEmail = pesertaData[r][emailCol] || "-";
              attendeeRowData = pesertaData[r];
              break;
            }
          }

          // Skenario 1: Tiket Tidak Ditemukan
          if (foundRow === -1) {
            releaseLockOnce();
            sheetLog.appendRow([nowStr, sessionId, sessionName, ticketId, "-", "TIDAK_VALID", scannedBy, gate, mapsUrl, deviceInfo, "ID tidak terdaftar di sistem"]);
            forwardLogToExternalSpreadsheet({
              timestamp: nowStr,
              sessionId: sessionId,
              sessionName: sessionName,
              ticketId: ticketId,
              attendeeName: "-",
              status: "TIDAK_VALID",
              scannedBy: scannedBy,
              gate: gate,
              mapsUrl: mapsUrl,
              deviceInfo: deviceInfo,
              notes: "ID tidak terdaftar di sistem"
            }, null, pesertaData[0]);

            logger.warn(`Ticket not registered: ${ticketId}`);
            logger.setSummary(`Tiket Tidak Terdaftar: ${ticketId}`);
            return createJsonResponse({
              success: false,
              status: "NOT_FOUND",
              message: `Tiket "${ticketId}" TIDAK TERDAFTAR dalam sistem!`
            });
          }

          // Ambil kolom sesi untuk sesi ini
          const sessionColIdx = getOrCreateSessionColumn(sheetPeserta, sessionId, sessionName);
          const existingStatus = String(sheetPeserta.getRange(foundRow, sessionColIdx).getValue() || "").trim();

          const scanMode = (payload.scanMode || (sessionId.endsWith("_OUT") ? "OUT" : "IN")).toUpperCase();
          const isAnomaly = !!payload.isAnomaly;
          const anomalyReason = (payload.anomalyReason || "").trim();

          // Skenario 2: Tiket Sudah Pernah Di-scan di Sesi Ini (Double Scan)
          const isAlreadyIn = existingStatus.startsWith("HADIR");
          const isAlreadyOut = existingStatus.startsWith("CHECKOUT");

          if ((scanMode === "OUT" && isAlreadyOut) || (scanMode !== "OUT" && isAlreadyIn)) {
            releaseLockOnce();
            const dupType = (scanMode === "OUT") ? "DUPLIKAT_CHECKOUT" : "DUPLIKAT";
            const dupMsg = (scanMode === "OUT") 
              ? `TIKET SUDAH CHECK-OUT untuk sesi "${sessionName}"!`
              : `TIKET SUDAH DIGUNAKAN untuk sesi "${sessionName}"!`;

            sheetLog.appendRow([nowStr, sessionId, sessionName, ticketId, attendeeName, dupType, scannedBy, gate, mapsUrl, deviceInfo, `Sudah absen sebelumnya: ${existingStatus}`]);
            forwardLogToExternalSpreadsheet({
              timestamp: nowStr,
              sessionId: sessionId,
              sessionName: sessionName,
              ticketId: ticketId,
              attendeeName: attendeeName,
              status: dupType,
              scannedBy: scannedBy,
              gate: gate,
              mapsUrl: mapsUrl,
              deviceInfo: deviceInfo,
              notes: `Sudah absen sebelumnya: ${existingStatus}`
            }, attendeeRowData, pesertaData[0]);

            logger.warn(`Duplicate scan: ${ticketId} (${attendeeName}) mode=${scanMode}`);
            logger.setSummary(`Duplikat: ${attendeeName} (${ticketId})`);
            return createJsonResponse({
              success: false,
              status: (scanMode === "OUT") ? "ALREADY_CHECKED_OUT" : "ALREADY_CHECKED_IN",
              message: dupMsg,
              attendee: {
                ticketId: ticketId,
                name: attendeeName,
                email: attendeeEmail,
                sessionName: sessionName,
                firstCheckInTime: existingStatus.replace(/^(HADIR|CHECKOUT)\s*-\s*/, "").trim() || "Sebelumnya",
                scannedBy: scannedBy
              }
            });
          }

          // Skenario 3: Presensi Berhasil (Check-In atau Check-Out)!
          let statusValue = "";
          let logStatus = "";
          let logDesc = "";
          let resStatus = "";
          let resMsg = "";

          if (scanMode === "OUT") {
            statusValue = isAnomaly ? `CHECKOUT (ANOMALI${anomalyReason ? ': ' + anomalyReason : ''}) - ${nowStr}` : `CHECKOUT - ${nowStr}`;
            logStatus = isAnomaly ? "CHECKOUT_ANOMALI" : "CHECKOUT";
            logDesc = isAnomaly ? `Checkout: ${anomalyReason || "Tanpa Check-in"}` : "Presensi kepulangan tercatat";
            resStatus = "CHECKED_OUT";
            resMsg = isAnomaly ? `Check-out berhasil dicatat (Anomali: ${anomalyReason || "Tanpa Check-In"})!` : `Check-out berhasil dicatat untuk ${sessionName}!`;
          } else {
            statusValue = `HADIR - ${nowStr}`;
            logStatus = "BERHASIL";
            logDesc = "Presensi tercatat";
            resStatus = "CHECKED_IN";
            resMsg = `Presensi berhasil dicatat untuk ${sessionName}!`;
          }

          sheetPeserta.getRange(foundRow, sessionColIdx).setValue(statusValue);
          SpreadsheetApp.flush();
          releaseLockOnce(); // Micro-Locking: Lepas lock segera setelah status hadir tertulis!
          
          // Catat di sheet Log Kehadiran dengan Link Google Maps & Device Info di luar lock
          sheetLog.appendRow([nowStr, sessionId, sessionName, ticketId, attendeeName, logStatus, scannedBy, gate, mapsUrl, deviceInfo, logDesc]);

          forwardLogToExternalSpreadsheet({
            timestamp: nowStr,
            sessionId: sessionId,
            sessionName: sessionName,
            ticketId: ticketId,
            attendeeName: attendeeName,
            status: logStatus,
            scannedBy: scannedBy,
            gate: gate,
            mapsUrl: mapsUrl,
            deviceInfo: deviceInfo,
            notes: logDesc
          }, attendeeRowData, pesertaData[0]);

          logger.success(`Presensi sukses: ${ticketId} (${attendeeName}) -> ${resStatus} on ${sessionName}`);
          logger.setSummary(`${resStatus}: ${attendeeName} (${ticketId})`);

          return createJsonResponse({
            success: true,
            status: resStatus,
            isAnomaly: isAnomaly,
            scanMode: scanMode,
            message: resMsg,
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
          const externalLogsToForward = [];
          const nowStr = formatFullDateTime(new Date());

          // Build in-memory index map for O(1) lightning lookup
          const ticketMap = new Map();
          for (let r = 1; r < pesertaData.length; r++) {
            const tId = String(pesertaData[r][ticketCol] || "").toUpperCase().trim();
            if (tId) {
              ticketMap.set(tId, {
                row: r + 1,
                name: pesertaData[r][nameCol] || "Peserta",
                email: pesertaData[r][emailCol] || "-",
                rowData: pesertaData[r]
              });
            }
          }

          // Cache session columns
          const sessionColMap = new Map();

          for (let i = 0; i < scans.length; i++) {
            const scan = scans[i];
            const ticketId = String(scan.ticketId || "").trim();
            const upperTicketId = ticketId.toUpperCase();
            const rawSessionId = (scan.sessionId || "SESI-01").trim();
            const rawSessionName = (scan.sessionName || rawSessionId).trim();
            const resolvedSession = resolveEffectiveSession(rawSessionId, rawSessionName);
            const sessionId = resolvedSession.id;
            const sessionName = resolvedSession.name;
            const scannedBy = (scan.scannedBy || "Panitia").trim();
            const gate = (scan.gate || "Pintu Masuk").trim();
            const scanMapsUrl = (scan.mapsUrl || mapsUrl || "-").trim();
            const scanDevice = (scan.deviceInfo || deviceInfo || "-").trim();
            const scanMode = (scan.scanMode || (sessionId.endsWith("_OUT") ? "OUT" : "IN")).toUpperCase();
            const isAnomaly = !!scan.isAnomaly;
            const anomalyReason = (scan.anomalyReason || "").trim();

            let scanTime = (scan.clientTime || "").trim();
            if (!scanTime) {
              scanTime = nowStr;
            } else if (!scanTime.includes("-")) {
              scanTime = formatDateOnly(new Date()) + " " + scanTime;
            }

            if (!sessionColMap.has(sessionId)) {
              sessionColMap.set(sessionId, getOrCreateSessionColumn(sheetPeserta, sessionId, sessionName));
            }
            const sessionColIdx = sessionColMap.get(sessionId);

            if (!ticketMap.has(upperTicketId)) {
              // Tiket Tidak Ditemukan / Sudah Dihapus Admin di Sheets!
              logRowsToAppend.push([scanTime, sessionId, sessionName, ticketId, "-", "TIDAK_VALID", scannedBy, gate, scanMapsUrl, scanDevice, "ID tidak terdaftar / dihapus"]);
              externalLogsToForward.push({
                logEntry: {
                  timestamp: scanTime,
                  sessionId: sessionId,
                  sessionName: sessionName,
                  ticketId: ticketId,
                  attendeeName: "-",
                  status: "TIDAK_VALID",
                  scannedBy: scannedBy,
                  gate: gate,
                  mapsUrl: scanMapsUrl,
                  deviceInfo: scanDevice,
                  notes: "ID tidak terdaftar / dihapus"
                },
                attendeeRowData: null
              });
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
            const isAlreadyIn = existingStatus.startsWith("HADIR");
            const isAlreadyOut = existingStatus.startsWith("CHECKOUT");

            if ((scanMode === "OUT" && isAlreadyOut) || (scanMode !== "OUT" && isAlreadyIn)) {
              const dupType = (scanMode === "OUT") ? "DUPLIKAT_CHECKOUT" : "DUPLIKAT";
              logRowsToAppend.push([scanTime, sessionId, sessionName, ticketId, attendeeName, dupType, scannedBy, gate, scanMapsUrl, scanDevice, `Sudah absen sebelumnya: ${existingStatus}`]);
              externalLogsToForward.push({
                logEntry: {
                  timestamp: scanTime,
                  sessionId: sessionId,
                  sessionName: sessionName,
                  ticketId: ticketId,
                  attendeeName: attendeeName,
                  status: dupType,
                  scannedBy: scannedBy,
                  gate: gate,
                  mapsUrl: scanMapsUrl,
                  deviceInfo: scanDevice,
                  notes: `Sudah absen sebelumnya: ${existingStatus}`
                },
                attendeeRowData: attendeeInfo.rowData
              });
              results.push({
                ticketId: ticketId,
                status: (scanMode === "OUT") ? "ALREADY_CHECKED_OUT" : "ALREADY_CHECKED_IN",
                message: (scanMode === "OUT") ? `Tiket sudah check-out di sesi ${sessionName}` : `Tiket sudah terdata hadir di sesi ${sessionName}`,
                attendee: {
                  ticketId: ticketId,
                  name: attendeeName,
                  email: attendeeEmail,
                  sessionName: sessionName,
                  firstCheckInTime: existingStatus.replace(/^(HADIR|CHECKOUT)\s*-\s*/, "").trim() || "Sebelumnya",
                  scannedBy: scannedBy
                }
              });
            } else {
              let statusValue = "";
              let logStatus = "";
              let logDesc = "";
              let resStatus = "";
              let resMsg = "";

              if (scanMode === "OUT") {
                statusValue = isAnomaly ? `CHECKOUT (ANOMALI${anomalyReason ? ': ' + anomalyReason : ''}) - ${scanTime}` : `CHECKOUT - ${scanTime}`;
                logStatus = isAnomaly ? "CHECKOUT_ANOMALI" : "CHECKOUT";
                logDesc = isAnomaly ? `Checkout: ${anomalyReason || "Tanpa Check-in"}` : "Presensi kepulangan tercatat";
                resStatus = "CHECKED_OUT";
                resMsg = `Check-out berhasil dicatat untuk ${sessionName}!`;
              } else {
                statusValue = `HADIR - ${scanTime}`;
                logStatus = "BERHASIL";
                logDesc = "Presensi tercatat";
                resStatus = "CHECKED_IN";
                resMsg = `Presensi berhasil dicatat untuk ${sessionName}!`;
              }

              sheetPeserta.getRange(foundRow, sessionColIdx).setValue(statusValue);
              logRowsToAppend.push([scanTime, sessionId, sessionName, ticketId, attendeeName, logStatus, scannedBy, gate, scanMapsUrl, scanDevice, logDesc]);
              externalLogsToForward.push({
                logEntry: {
                  timestamp: scanTime,
                  sessionId: sessionId,
                  sessionName: sessionName,
                  ticketId: ticketId,
                  attendeeName: attendeeName,
                  status: logStatus,
                  scannedBy: scannedBy,
                  gate: gate,
                  mapsUrl: scanMapsUrl,
                  deviceInfo: scanDevice,
                  notes: logDesc
                },
                attendeeRowData: attendeeInfo.rowData
              });
              results.push({
                ticketId: ticketId,
                status: resStatus,
                isAnomaly: isAnomaly,
                scanMode: scanMode,
                message: resMsg,
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

          // Flush dan lepas lock segera setelah semua status peserta terupdate
          SpreadsheetApp.flush();
          releaseLockOnce();

          // Append all log rows in a single batch (di luar lock)
          if (logRowsToAppend.length > 0) {
            const startRow = sheetLog.getLastRow() + 1;
            sheetLog.getRange(startRow, 1, logRowsToAppend.length, logRowsToAppend[0].length).setValues(logRowsToAppend);
          }

          // Sinkronisasi realtime ke spreadsheet eksternal jika diaktifkan
          if (externalLogsToForward.length > 0) {
            forwardBatchLogsToExternalSpreadsheet(externalLogsToForward, pesertaData[0]);
          }

          logger.info(`Batch check-in processed ${scans.length} scans`);
          logger.setSummary(`Batch Check-In: ${scans.length} data`);

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
          const rawSessionId = (payload.sessionId || "").trim();
          const rawSessionName = (payload.sessionName || rawSessionId).trim();
          const resolvedSession = resolveEffectiveSession(rawSessionId, rawSessionName);
          const sessionId = resolvedSession.id;
          const sessionName = resolvedSession.name;
          const cancelledBy = (payload.cancelledBy || payload.scannedBy || "Panitia").trim();
          const reason = (payload.reason || "Dibatalkan oleh panitia").trim();
          const nowStr = formatFullDateTime(new Date());

          if (!ticketId || !sessionId) {
            logger.warn("Cancel check-in missing ticketId or sessionId");
            logger.setSummary("Cancel Gagal: Parameter Kurang");
            return createJsonResponse({ success: false, message: "Ticket ID dan Session ID wajib diisi untuk pembatalan." });
          }

          // Cari baris peserta
          let foundRow = -1;
          let attendeeName = "";
          let attendeeRowData = null;
          const { ticketCol: cancelTicketCol, nameCol: cancelNameCol } = getPesertaFieldIndices(sheetPeserta);

          for (let r = 1; r < pesertaData.length; r++) {
            if (String(pesertaData[r][cancelTicketCol]).toUpperCase() === ticketId.toUpperCase()) {
              foundRow = r + 1;
              attendeeName = pesertaData[r][cancelNameCol] || "Peserta";
              attendeeRowData = pesertaData[r];
              break;
            }
          }

          if (foundRow === -1) {
            logger.warn(`Cancel failed, attendee not found: ${ticketId}`);
            logger.setSummary(`Cancel Gagal: Tiket ${ticketId} Tidak Ditemukan`);
            return createJsonResponse({ success: false, message: "Peserta tidak ditemukan." });
          }

          // Ambil kolom sesi jika ada (jangan buat kolom baru saat cancel)
          const sessionColIdx = findSessionColumn(sheetPeserta, sessionId, sessionName);
          if (sessionColIdx > 0) {
            // Kosongkan status di sheet Data Peserta (Revert kembali)
            sheetPeserta.getRange(foundRow, sessionColIdx).setValue("");
            SpreadsheetApp.flush();
          }
          releaseLockOnce(); // Micro-Locking: Lepas lock setelah cell di sheet peserta dikosongkan

          // Catat event pembatalan di sheet Log Kehadiran dengan Link Google Maps & Device Info
          sheetLog.appendRow([nowStr, sessionId, sessionName, ticketId, attendeeName, "DIBATALKAN", cancelledBy, payload.gate || "-", mapsUrl, deviceInfo, reason]);

          forwardLogToExternalSpreadsheet({
            timestamp: nowStr,
            sessionId: sessionId,
            sessionName: sessionName,
            ticketId: ticketId,
            attendeeName: attendeeName,
            status: "DIBATALKAN",
            scannedBy: cancelledBy,
            gate: payload.gate || "-",
            mapsUrl: mapsUrl,
            deviceInfo: deviceInfo,
            notes: reason
          }, attendeeRowData, pesertaData[0]);

          logger.info(`Cancelled check-in for ${ticketId} (${attendeeName}) on ${sessionName}`);
          logger.setSummary(`Batal: ${attendeeName} (${ticketId})`);

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
          const rawSessionId = (payload.sessionId || "SESI-01").trim();
          const rawSessionName = (payload.sessionName || rawSessionId).trim();
          const resolvedSession = resolveEffectiveSession(rawSessionId, rawSessionName);
          const sessionId = resolvedSession.id;
          const sessionName = resolvedSession.name;
          const scannedBy = (payload.scannedBy || "Panitia").trim();
          const gate = (payload.gate || "Pintu Masuk").trim();
          const nowStr = formatFullDateTime(new Date());

          if (!name) {
            logger.warn("OTS Registration missing participant name");
            logger.setSummary("OTS Gagal: Nama Kosong");
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
            const qrUrl = buildQrCodeUrl(ticketId);
            const qrResponse = UrlFetchApp.fetch(qrUrl, { muteHttpExceptions: true });
            if (qrResponse.getResponseCode() === 200) {
              const sanitizedName = name.replace(/[^a-zA-Z0-9_-]/g, "_");
              const qrBlob = qrResponse.getBlob().setName("QR_OTS_" + sanitizedName + "_" + ticketId + ".png");

              const targetFolder = getOrCreateQrFolder();
              const driveFile = targetFolder.createFile(qrBlob);
              fileId = driveFile.getId();
              fileUrl = driveFile.getUrl();

              // Jika kontak merupakan email, berikan viewer access secara silent
              if (contact && contact.includes("@")) {
                try {
                  grantDriveViewerSilent(fileId, contact);
                } catch (e) {
                  sysLog.warn("Viewer share error: " + e.message);
                }
              }
            }
          } catch (err) {
            sysLog.warn("QR Drive save error: " + err.message);
          }

          const email = (payload.email || payload.contact || "").trim();
          const effectiveContact = email || "-";
          const nextOtsRow = sheetPeserta.getLastRow() + 1;
          const otsFormulaTotal = `=IF(A${nextOtsRow}=""; ""; COUNTIF(D${nextOtsRow}:ZZ${nextOtsRow}; "HADIR*"))`;

          // Pastikan kolom sesi untuk sesi aktif sudah ada
          const sessionColIdx = getOrCreateSessionColumn(sheetPeserta, sessionId, sessionName);

          const lastCol = sheetPeserta.getLastColumn();
          const pHeaders = sheetPeserta.getRange(1, 1, 1, lastCol).getValues()[0];
          const otsRowData = new Array(pHeaders.length).fill("");
          const otsCustom = payload.customFields || {};

          pHeaders.forEach((h, idx) => {
            const headerStr = String(h || "").trim();
            const lower = headerStr.toLowerCase();

            if (lower.includes("ticket") || lower === "id" || lower.includes("id tiket")) {
              otsRowData[idx] = ticketId;
            } else if (lower.includes("nama")) {
              otsRowData[idx] = name;
            } else if (lower.includes("total") || lower.includes("jumlah")) {
              otsRowData[idx] = otsFormulaTotal;
            } else if (lower.includes("email")) {
              otsRowData[idx] = effectiveContact;
            } else if (lower.includes("drive file id") || lower === "file id") {
              otsRowData[idx] = fileId;
            } else if (lower.includes("drive file url") || lower === "file url") {
              otsRowData[idx] = fileUrl;
            } else if (lower.includes("waktu daftar") || lower === "timestamp" || lower.includes("tanggal")) {
              otsRowData[idx] = nowStr;
            } else if (lower.startsWith("sesi:") || (lower.includes("[") && lower.includes("]"))) {
              otsRowData[idx] = (idx === sessionColIdx - 1) ? `HADIR - ${nowStr}` : "";
            } else {
              // Kolom custom (misal Jenis Kelamin, Fakultas, Instansi, dsb)
              let val = otsCustom[headerStr];
              if (val === undefined) {
                const foundKey = Object.keys(otsCustom).find(k => k.toLowerCase() === lower || lower.includes(k.toLowerCase()));
                if (foundKey && otsCustom[foundKey] !== undefined) {
                  val = otsCustom[foundKey];
                }
              }
              if (!val && (lower.includes("catatan") || lower.includes("asal") || lower.includes("keterangan"))) {
                val = notes;
              }
              otsRowData[idx] = val || "";
            }
          });

          // Buat baris baru di Data Peserta
          sheetPeserta.appendRow(otsRowData);
          const newRowIdx = sheetPeserta.getLastRow();

          // Pastikan cell di kolom sesi terisi status HADIR
          const statusValue = `HADIR - ${nowStr}`;
          sheetPeserta.getRange(newRowIdx, sessionColIdx).setValue(statusValue);
          SpreadsheetApp.flush();
          releaseLockOnce(); // Micro-Locking: Lepas lock setelah baris OTS baru tertulis

          // 4. Catat di Log Kehadiran dengan Link Google Maps & Device Info (di luar lock)
          sheetLog.appendRow([nowStr, sessionId, sessionName, ticketId, name, "BERHASIL (OTS)", scannedBy, gate, mapsUrl, deviceInfo, notes]);

          forwardLogToExternalSpreadsheet({
            timestamp: nowStr,
            sessionId: sessionId,
            sessionName: sessionName,
            ticketId: ticketId,
            attendeeName: name,
            status: "BERHASIL (OTS)",
            scannedBy: scannedBy,
            gate: gate,
            mapsUrl: mapsUrl,
            deviceInfo: deviceInfo,
            notes: notes
          }, otsRowData, pHeaders);

          logger.success(`Registered OTS participant: ${ticketId} (${name}) on ${sessionName}`);
          logger.setSummary(`OTS Baru: ${name} (${ticketId})`);

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

        logger.warn(`Unknown action requested: ${action}`);
        logger.setSummary(`Action Unknown: ${action}`);
        return createJsonResponse({ success: false, message: `Action "${action}" tidak dikenali.` });

      } finally {
        releaseLockOnce();
      }

    } catch (err) {
      logger.error("Server error: " + err.message, err.stack);
      logger.setSummary("Server Error: " + err.message);
      return createJsonResponse({ success: false, message: "Server error: " + err.message });
    } finally {
      logger.flush();
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
    let adminUser = "-";
    try { adminUser = Session.getActiveUser().getEmail() || "Admin"; } catch (e) {}
    const logger = new ExecutionLogger("testInitSheets", { user: adminUser, action: "testInitSheets" });
    try {
      logger.info("Initializing all sheets and system configurations");
      ensureAllSheetsSetup();
      logger.setSummary("Init Sheets Sukses");
      logger.success("Semua sheet berhasil diinisialisasi!");
    } catch (err) {
      logger.error("testInitSheets error: " + err.message);
      logger.setSummary("Init Gagal: " + err.message);
    } finally {
      logger.flush();
    }
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
      sysLog.info("onOpen ensure notice: " + e.message);
    }

    SpreadsheetApp.getUi()
      .createMenu('⚡ Presensi Event')
      .addItem('🚀 1. Setup Otomatis (Inisialisasi & Pasang Trigger)', 'autoSetupEverything')
      .addItem('📝 2. Buat Google Form Pendaftaran Otomatis', 'autoCreateGoogleForm')
      .addItem('📥 3. Impor Peserta Lama dari Form Responses', 'syncExistingFormResponses')
      .addSeparator()
      .addItem('🔗 4. Buka / Bagikan Link Scanner Panitia', 'showPanitiaLinkModal')
      .addItem('📊 5. Periksa Status Sistem', 'showSystemStatus')
      .addSeparator()
      .addItem('🔄 6. Cek & Kirim Ulang Akses Drive Peserta', 'checkAndRetryDriveSharing')
      .addSeparator()
      .addItem('🛠️ 7. Rapikan Baris Data yang Bergeser (Auto-Fix Columns)', 'fixShiftedParticipantRows')
      .addItem('📜 8. Bersihkan Log Eksekusi Lama', 'clearExecutionLogs')
      .addSeparator()
      .addItem('🌐 9. Hubungkan / Test Spreadsheet Eksternal', 'promptConfigureExternalSync')
      .addToUi();
  }

  /**
   * Helper / Menu: Membersihkan baris data di sheet Log Eksekusi
   */
  function clearExecutionLogs() {
    const ui = SpreadsheetApp.getUi();
    const sheet = getSpreadsheet().getSheetByName(CONFIG.SHEETS.LOG_EKSEKUSI);
    if (!sheet || sheet.getLastRow() <= 1) {
      ui.alert("Log Kosong", "Sheet 'Log Eksekusi' masih kosong.", ui.ButtonSet.OK);
      return;
    }
    const count = sheet.getLastRow() - 1;
    const res = ui.alert("Bersihkan Log Eksekusi", `Apakah Anda yakin ingin menghapus seluruh riwayat log eksekusi (${count} baris)?`, ui.ButtonSet.YES_NO);
    if (res === ui.Button.YES) {
      sheet.deleteRows(2, count);
      ui.alert("Selesai", "Seluruh data riwayat log eksekusi berhasil dibersihkan.", ui.ButtonSet.OK);
    }
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

    let adminUser = "-";
    try { adminUser = Session.getActiveUser().getEmail() || "Admin"; } catch (e) {}
    const logger = new ExecutionLogger("syncExistingFormResponses", { user: adminUser, action: "syncExistingFormResponses" });

    try {
      logger.info("Starting sync of existing form responses");
      // 1. Cari tab form responses
      const sheetRaw = ss.getSheetByName(CONFIG.SHEETS.RAW_FORM) ||
                      ss.getSheetByName(CONFIG.SHEETS.RAW_FORM_ID) ||
                      ss.getSheets().find(s => {
                        const n = s.getName();
                        return n.startsWith("Form Responses") || n.startsWith("Jawaban Formulir");
                      }) ||
                      ss.getSheets()[0];

      if (!sheetRaw || sheetRaw.getLastRow() <= 1) {
        logger.info("No responses found in raw form sheet");
        logger.setSummary("Data Respon Kosong");
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
        logger.warn("Could not find Name or Email column in form responses");
        logger.setSummary("Kolom Tidak Ditemukan");
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
          const qrUrl = buildQrCodeUrl(ticketId);
          const qrResponse = UrlFetchApp.fetch(qrUrl, { muteHttpExceptions: true });
          if (qrResponse.getResponseCode() === 200) {
            const sanitizedName = name.replace(/[^a-zA-Z0-9_-]/g, "_");
            const qrBlob = qrResponse.getBlob().setName("QR_" + sanitizedName + "_" + ticketId + ".png");
            const driveFile = targetFolder.createFile(qrBlob);
            fileId = driveFile.getId();
            fileUrl = driveFile.getUrl();

            try {
              grantDriveViewerSilent(fileId, email);
            } catch (e) {}
          }
        } catch (e) {
          sysLog.warn("QR warning: " + e.message);
        }

        const nextSyncRow = sheetPeserta.getLastRow() + 1;
        const syncFormulaTotal = `=IF(A${nextSyncRow}=""; ""; COUNTIF(D${nextSyncRow}:ZZ${nextSyncRow}; "HADIR*"))`;

        // Kumpulkan seluruh jawaban form dalam map (lowercase key)
        const rowFormAnswers = {};
        rawHeaders.forEach((h, hIdx) => {
          const title = String(h || "").trim();
          if (title) {
            rowFormAnswers[title.toLowerCase()] = String(row[hIdx] || "").trim();
          }
        });

        const syncHeaders = sheetPeserta.getRange(1, 1, 1, sheetPeserta.getLastColumn()).getValues()[0];
        const syncRowData = new Array(syncHeaders.length).fill("");

        syncHeaders.forEach((h, sIdx) => {
          const headerStr = String(h || "").trim();
          const lower = headerStr.toLowerCase();

          if (lower.includes("ticket") || lower === "id" || lower.includes("id tiket")) {
            syncRowData[sIdx] = ticketId;
          } else if (lower.includes("nama")) {
            syncRowData[sIdx] = name;
          } else if (lower.includes("total") || lower.includes("jumlah")) {
            syncRowData[sIdx] = syncFormulaTotal;
          } else if (lower.includes("email")) {
            syncRowData[sIdx] = email;
          } else if (lower.includes("drive file id") || lower === "file id") {
            syncRowData[sIdx] = fileId;
          } else if (lower.includes("drive file url") || lower === "file url") {
            syncRowData[sIdx] = fileUrl;
          } else if (lower.includes("waktu daftar") || lower === "timestamp" || lower.includes("tanggal")) {
            syncRowData[sIdx] = regTimestamp;
          } else if (lower.startsWith("sesi:") || (lower.includes("[") && lower.includes("]"))) {
            syncRowData[sIdx] = "";
          } else {
            let matchedAns = rowFormAnswers[lower];
            if (matchedAns === undefined) {
              const foundKey = Object.keys(rowFormAnswers).find(k => k.includes(lower) || lower.includes(k));
              if (foundKey && rowFormAnswers[foundKey] !== undefined) {
                matchedAns = rowFormAnswers[foundKey];
              }
            }
            syncRowData[sIdx] = matchedAns || "";
          }
        });

        sheetPeserta.appendRow(syncRowData);

        existingEmails.add(email.toLowerCase());
        importedCount++;
      }

      logger.setSummary(`Impor Form: ${importedCount} baru, ${skippedCount} dilewati`);
      logger.success(`Form import completed: ${importedCount} new attendees added, ${skippedCount} skipped`);

      ui.alert(
        "Impor Data Selesai!",
        `✅ Berhasil mengimpor & membuat QR untuk: ${importedCount} peserta baru.\n⏭️ Dilewati (karena sudah terdaftar): ${skippedCount} peserta.`,
        ui.ButtonSet.OK
      );

    } catch (err) {
      logger.error("syncExistingFormResponses error: " + err.message);
      logger.setSummary("Gagal Impor Form: " + err.message);
      ui.alert("Gagal Impor Data", "Terjadi kesalahan: " + err.message, ui.ButtonSet.OK);
    } finally {
      logger.flush();
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
   * Helper / Tool: Memperbaiki otomatis baris di sheet Data Peserta yang kolomnya sempat bergeser
   * Akibat penyisipan kolom custom manual (misal Email masuk ke kolom Fakultas / Jenis Kelamin).
   */
  function fixShiftedParticipantRows() {
    const ui = SpreadsheetApp.getUi();
    let adminUser = "-";
    try { adminUser = Session.getActiveUser().getEmail() || "Admin"; } catch (e) {}
    const logger = new ExecutionLogger("fixShiftedRows", { user: adminUser, action: "fixShiftedParticipantRows" });

    try {
      logger.info("Starting auto-fix for shifted participant rows");
      const sheetPeserta = getOrCreateSheet(CONFIG.SHEETS.DATA_PESERTA);
      const lastRow = sheetPeserta.getLastRow();
      const lastCol = sheetPeserta.getLastColumn();

      if (lastRow <= 1 || lastCol === 0) {
        logger.info("Sheet Data Peserta is empty, nothing to fix");
        logger.setSummary("Data Kosong");
        ui.alert("Tidak Ada Data", "Sheet Data Peserta masih kosong.", ui.ButtonSet.OK);
        return;
      }

      const headers = sheetPeserta.getRange(1, 1, 1, lastCol).getValues()[0];
      const emailColIdx = headers.findIndex(h => String(h).toLowerCase().includes("email"));
      const fileIdColIdx = headers.findIndex(h => String(h).toLowerCase().includes("drive file id") || String(h).toLowerCase() === "file id");
      const fileUrlColIdx = headers.findIndex(h => String(h).toLowerCase().includes("drive file url") || String(h).toLowerCase() === "file url");
      const regTimeColIdx = headers.findIndex(h => String(h).toLowerCase().includes("waktu daftar") || String(h).toLowerCase().includes("timestamp"));

      if (emailColIdx === -1 || fileIdColIdx === -1) {
        logger.warn("Required header 'Email' or 'Drive File ID' not found");
        logger.setSummary("Gagal: Header Tidak Lengkap");
        ui.alert("Gagal", "Kolom 'Email' atau 'Drive File ID' tidak ditemukan di header.", ui.ButtonSet.OK);
        return;
      }

      const dataRange = sheetPeserta.getRange(2, 1, lastRow - 1, lastCol);
      const values = dataRange.getValues();
      let fixedCount = 0;

      for (let r = 0; r < values.length; r++) {
        const row = values[r];
        const actualEmail = String(row[emailColIdx] || "").trim();

        // Deteksi apakah kolom email saat ini bukan berisi email (misal berisi link drive atau timestamp)
        // DAN cari apakah email tersasar di kolom sebelumnya (misal kolom D atau E)
        if (!actualEmail.includes("@")) {
          let misplacedEmailIdx = -1;
          let misplacedEmailVal = "";

          for (let c = 2; c < lastCol; c++) {
            const cellVal = String(row[c] || "").trim();
            if (cellVal.includes("@") && cellVal.includes(".")) {
              misplacedEmailIdx = c;
              misplacedEmailVal = cellVal;
              break;
            }
          }

          if (misplacedEmailIdx !== -1 && misplacedEmailIdx !== emailColIdx) {
            const misplacedFileId = String(row[misplacedEmailIdx + 1] || "").trim();
            const misplacedFileUrl = String(row[misplacedEmailIdx + 2] || "").trim();
            const misplacedRegTime = String(row[misplacedEmailIdx + 3] || "").trim();

            // Pindahkan ke kolom yang benar
            row[emailColIdx] = misplacedEmailVal;
            if (fileIdColIdx !== -1 && misplacedFileId) row[fileIdColIdx] = misplacedFileId;
            if (fileUrlColIdx !== -1 && misplacedFileUrl) row[fileUrlColIdx] = misplacedFileUrl;
            if (regTimeColIdx !== -1 && misplacedRegTime) row[regTimeColIdx] = misplacedRegTime;

            // Kosongkan kolom yang tadinya salah terisi jika posisinya sebelum kolom email
            if (misplacedEmailIdx < emailColIdx) row[misplacedEmailIdx] = "";
            if (misplacedEmailIdx + 1 < emailColIdx) row[misplacedEmailIdx + 1] = "";
            if (misplacedEmailIdx + 2 < emailColIdx) row[misplacedEmailIdx + 2] = "";
            if (misplacedEmailIdx + 3 < emailColIdx) row[misplacedEmailIdx + 3] = "";

            // Pastikan formula Total Hadir di kolom C
            const rowNum = r + 2;
            row[2] = `=IF(A${rowNum}=""; ""; COUNTIF(D${rowNum}:ZZ${rowNum}; "HADIR*"))`;

            fixedCount++;
          }
        }
      }

      if (fixedCount > 0) {
        dataRange.setValues(values);
        logger.setSummary(`Dirapikan: ${fixedCount} baris`);
        logger.success(`Successfully fixed ${fixedCount} shifted participant rows`);
        ui.alert("Berhasil Merapikan Data!", `✅ Sebanyak ${fixedCount} baris data peserta yang bergeser berhasil dirapikan kembali ke kolom aslinya.`, ui.ButtonSet.OK);
      } else {
        logger.setSummary("Data Sudah Rapi");
        logger.info("All rows already aligned with headers");
        ui.alert("Data Sudah Rapi", "Seluruh baris peserta sudah berada di kolom yang sesuai.", ui.ButtonSet.OK);
      }
    } catch (err) {
      logger.error("fixShiftedParticipantRows error: " + err.message);
      logger.setSummary("Gagal: " + err.message);
      ui.alert("Gagal", "Terjadi kesalahan: " + err.message, ui.ButtonSet.OK);
    } finally {
      logger.flush();
    }
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

  /**
   * Helper: Ekstrak ID file Google Drive dari ID langsung atau link URL
   */
  function extractDriveFileId(val) {
    if (!val || typeof val !== "string") return "";
    const str = val.trim();
    if (str === "-" || str === "") return "";
    if (!str.includes("/") && !str.includes(".")) return str;
    const match = str.match(/\/d\/([a-zA-Z0-9_-]+)/) || str.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    return match ? match[1] : str;
  }

  /**
   * Cek & Kirim Ulang Akses Viewer Google Drive Peserta
   * - Tanpa perlu menambah kolom baru (tidak merusak struktur sheet / matrix sesi)
   * - Mendukung input baris mulai (Start Row) & jumlah baris (Batch Count)
   * - Memberikan jeda waktu (sleep) agar tidak terkena burst limit
   * - Menambahkan Cell Note kecil di kolom Email untuk kemudahan audit
   */
  function checkAndRetryDriveSharing() {
    const ui = SpreadsheetApp.getUi();
    const ss = getSpreadsheet();
    const sheetPeserta = ss.getSheetByName(CONFIG.SHEETS.DATA_PESERTA);

    if (!sheetPeserta) {
      ui.alert("Sheet Tidak Ditemukan", `Sheet '${CONFIG.SHEETS.DATA_PESERTA}' belum tersedia.`, ui.ButtonSet.OK);
      return;
    }

    const lastRow = sheetPeserta.getLastRow();
    if (lastRow < 2) {
      ui.alert("Data Kosong", "Belum ada data peserta di sheet 'Data Peserta'.", ui.ButtonSet.OK);
      return;
    }

    // Default baris mulai: ambil baris sel aktif jika valid, atau default ke 2
    let defaultStartRow = 2;
    try {
      const activeRow = sheetPeserta.getActiveCell().getRow();
      if (activeRow >= 2 && activeRow <= lastRow) {
        defaultStartRow = activeRow;
      }
    } catch (e) {}

    // Prompt 1: Baris Mulai
    const promptStart = ui.prompt(
      "Mulai dari Baris Berapa?",
      `Masukkan nomor baris awal yang ingin diperiksa:\n(Tersedia baris 2 sampai ${lastRow})`,
      ui.ButtonSet.OK_CANCEL
    );

    if (promptStart.getSelectedButton() !== ui.Button.OK) return;
    let startRow = parseInt(promptStart.getResponseText().trim(), 10);
    if (isNaN(startRow) || startRow < 2 || startRow > lastRow) {
      startRow = defaultStartRow;
    }

    // Prompt 2: Jumlah Baris (Batch Size)
    const promptBatch = ui.prompt(
      "Jumlah Baris yang Diproses?",
      `Masukkan berapa baris yang ingin dicek/dikirim:\n(Saran: 15 - 30 baris per batch agar aman dari limit Google Drive)`,
      ui.ButtonSet.OK_CANCEL
    );

    if (promptBatch.getSelectedButton() !== ui.Button.OK) return;
    let batchCount = parseInt(promptBatch.getResponseText().trim(), 10);
    if (isNaN(batchCount) || batchCount <= 0) {
      batchCount = 20;
    }

    const endRow = Math.min(lastRow, startRow + batchCount - 1);
    const numRows = endRow - startRow + 1;

    let adminUser = "-";
    try {
      adminUser = Session.getActiveUser().getEmail() || "Admin";
    } catch (e) {}

    const logger = new ExecutionLogger("checkAndRetryDriveSharing", {
      action: "batchShareDrive",
      user: adminUser
    });

    try {
      logger.info(`Starting batch share check: rows ${startRow} to ${endRow} (${numRows} rows)`);

      // Ambil data rentang [startRow .. endRow], minimal 6 kolom (A:F)
      const rangeData = sheetPeserta.getRange(startRow, 1, numRows, 6).getValues();

      let alreadyCount = 0;
      let newlySharedCount = 0;
      let skippedCount = 0;
      let failedCount = 0;
      let hitLimit = false;
      let lastProcessedRow = startRow;

      for (let i = 0; i < rangeData.length; i++) {
        const currentRow = startRow + i;
        lastProcessedRow = currentRow;
        const row = rangeData[i];

        const ticketId = String(row[0] || "").trim();
        const name = String(row[1] || "").trim();
        const email = String(row[3] || "").trim();
        const rawFileId = String(row[4] || "").trim();
        const rawFileUrl = String(row[5] || "").trim();

        const fileId = extractDriveFileId(rawFileId) || extractDriveFileId(rawFileUrl);

        // Jika email atau fileId tidak valid, lewati
        if (!email || !email.includes("@") || !fileId || fileId === "-") {
          skippedCount++;
          logger.info(`Row ${currentRow} skipped: invalid email or fileId`);
          continue;
        }

        try {
          const driveFile = DriveApp.getFileById(fileId);
          const viewers = driveFile.getViewers().map(u => u.getEmail().toLowerCase());
          const hasAccess = viewers.includes(email.toLowerCase());

          const emailCell = sheetPeserta.getRange(currentRow, 4);

          if (hasAccess) {
            alreadyCount++;
            emailCell.setNote("✅ Akses Drive: Sudah Aktif");
            logger.info(`Row ${currentRow} (${name}): Access already active`);
          } else {
            // Coba berikan akses viewer secara smart (dengan notif email jika ada kuota, atau silent jika mepet)
            try {
              const shareResult = grantDriveViewerSmart(fileId, email);
              newlySharedCount++;
              const noteText = (shareResult && shareResult.notified)
                ? "✅ Akses Drive: Dibagikan + Notif Email (" + new Date().toLocaleDateString("id-ID") + ")"
                : "✅ Akses Drive: Dibagikan (Silent / Drive Only) (" + new Date().toLocaleDateString("id-ID") + ")";
              emailCell.setNote(noteText);
              logger.info(`Row ${currentRow} (${name} - ${email}): Shared successfully`);

              // Jeda 1.2 detik agar tidak kena burst rate limit Google Drive
              Utilities.sleep(1200);
            } catch (shareErr) {
              failedCount++;
              const errMsg = shareErr.message || "";
              emailCell.setNote("⚠️ Akses Drive Gagal: " + errMsg);
              logger.error(`Row ${currentRow} (${name}) share error: ${errMsg}`);

              if (errMsg.toLowerCase().includes("limit") || errMsg.toLowerCase().includes("exceeded")) {
                hitLimit = true;
                logger.warn(`STOP at row ${currentRow} due to Drive quota limit`);
                break; // Hentikan loop agar tidak menambah error spam
              }
            }
          }
        } catch (fileErr) {
          failedCount++;
          logger.error(`Row ${currentRow} read error: ${fileErr.message}`);
        }
      }

      // Tampilkan rangkuman hasil
      const summary = [
        "📊 HASIL PENGECEKAN AKSES DRIVE",
        "------------------------------------------",
        `• Rentang Baris: ${startRow} s/d ${lastProcessedRow} (dari total ${lastRow})`,
        `• Sudah Punya Akses Sebelumnya: ${alreadyCount} peserta`,
        `• Baru Saja Berhasil Dibagikan: ${newlySharedCount} peserta`,
        `• Dilewati (Email/File Kosong): ${skippedCount} peserta`,
        `• Gagal / Tertahan: ${failedCount} peserta`,
        "------------------------------------------",
        hitLimit
          ? `⚠️ PERHATIAN: Kuota Google Drive harian/burst limit tercapai di baris ${lastProcessedRow}.\nSilakan lanjutkan kembali nanti mulai dari baris ${lastProcessedRow}.`
          : "✅ Selesai! Tidak ada kendala kuota pada rentang ini."
      ].join("\n");

      logger.setSummary(`Drive Share: Baris ${startRow}-${lastProcessedRow} (${newlySharedCount} baru, ${alreadyCount} aktif, ${skippedCount} dilewati, ${failedCount} gagal)`);
      if (hitLimit) logger.warn("Drive quota limit reached");

      ui.alert("Laporan Akses Drive", summary, ui.ButtonSet.OK);
    } catch (err) {
      logger.error("checkAndRetryDriveSharing exception: " + err.message);
      logger.setSummary("Batch Share Error: " + err.message);
    } finally {
      logger.flush();
    }
  }

  /**
   * ==============================================================================
   * INTEGRASI FORWARDING LOG REALTIME KE SPREADSHEET EKSTERNAL (DYNAMIC FIELDS)
   * ==============================================================================
   */

  /**
   * Helper: Ekstrak Spreadsheet ID dari ID murni ataupun URL lengkap Google Spreadsheet
   */
  function extractSpreadsheetId(input) {
    if (!input || typeof input !== "string") return "";
    const trimmed = input.trim();
    const match = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    return match ? match[1] : trimmed;
  }

  /**
   * Helper: Mengambil konfigurasi integrasi eksternal (dari CONFIG atau ScriptProperties)
   */
  function getExternalSyncConfig() {
    const cfg = (CONFIG && CONFIG.EXTERNAL_SYNC) ? Object.assign({}, CONFIG.EXTERNAL_SYNC) : {};
    try {
      const props = PropertiesService.getScriptProperties();
      const propId = props.getProperty("EXTERNAL_SPREADSHEET_ID");
      const propSheet = props.getProperty("EXTERNAL_SHEET_NAME");
      const propEnabled = props.getProperty("EXTERNAL_SYNC_ENABLED");
      if (propId) cfg.SPREADSHEET_ID = propId;
      if (propSheet) cfg.SHEET_NAME = propSheet;
      if (propEnabled !== null && propEnabled !== undefined) {
        cfg.ENABLED = propEnabled === "true";
      } else if (cfg.SPREADSHEET_ID && String(cfg.SPREADSHEET_ID).trim().length > 5) {
        // Jika SPREADSHEET_ID sudah diisi (misal di CONFIG), otomatis aktifkan
        cfg.ENABLED = true;
      }
    } catch (e) {
      sysLog.info("getExternalSyncConfig notice: " + e.message);
    }
    return cfg;
  }

  /**
   * Mengirimkan satu data log scan secara realtime ke Google Spreadsheet lain.
   */
  function forwardLogToExternalSpreadsheet(logEntry, attendeeRowData, pHeaders) {
    if (!logEntry) return;
    forwardBatchLogsToExternalSpreadsheet([{ logEntry: logEntry, attendeeRowData: attendeeRowData }], pHeaders);
  }

  /**
   * Mengirimkan antrean log scan (batch / single) secara realtime ke Google Spreadsheet target,
   * diperkaya (enriched) secara dinamis dengan kolom-kolom profil peserta dari sheet 'Data Peserta'.
   * 
   * FITUR UNGGULAN:
   * 1. 100% Fail-safe: jika spreadsheet target error/offline/kuota habis, proses absen panitia tetap sukses tanpa delay.
   * 2. High Performance Batch Write: membuka spreadsheet eksternal hanya 1 kali untuk seluruh antrean scan.
   * 3. Dynamic Columns: Otomatis membaca semua kolom pertanyaan form dari 'Data Peserta' dan menyinkronkannya ke sheet target.
   * 4. Auto Header Setup: Jika sheet target masih kosong atau baru, otomatis membuat header dan format tabel secara rapi.
   */
  function forwardBatchLogsToExternalSpreadsheet(items, pHeaders) {
          

    if (!items || !items.length) return;
    const cfg = getExternalSyncConfig();
    if (!cfg || !cfg.ENABLED) {
      return;
    }

    // Kirim realtime ke Webhook Kupon & Makan
      if (cfg.WEBHOOK_URL) {
        try {
          const webhookPayload = items.map(item => {
            const entry = item.logEntry || {};
            const attendeeData = item.attendeeRowData || [];
            const res = Object.assign({}, entry);

            // Ekstrak profil jenis kelamin, WA, dan status dari Data Peserta
            if (pHeaders && Array.isArray(pHeaders)) {
              pHeaders.forEach((h, idx) => {
                const key = String(h || "").trim().toLowerCase();
                const val = attendeeData[idx];
                if (key.includes("kelamin") || key.includes("gender")) res.jenisKelamin = val;
                if (key.includes("Nomor Whatsapp") || key.includes("whatsapp") || key.includes("telepon")) res.noWhatsapp = val;
                if (key === "status" || key.includes("status peserta")) res.statusPeserta = val;
              });
            }
            return res;
          });

          UrlFetchApp.fetch(cfg.WEBHOOK_URL, {
            method: "post",
            contentType: "application/json",
            payload: JSON.stringify(webhookPayload),
            muteHttpExceptions: true
          });
          sysLog.info("[WEBHOOK KUPON] Berhasil mengirim scan ke Webhook");
        } catch (wErr) {
          sysLog.warn("[WEBHOOK KUPON WARN] Gagal forward webhook: " + wErr.message);
        }
      }
    const rawId = cfg.SPREADSHEET_ID || "";
    const targetSpreadsheetId = extractSpreadsheetId(rawId);
    if (!targetSpreadsheetId) {
      sysLog.warn("[EXTERNAL SYNC] Diaktifkan tapi SPREADSHEET_ID masih kosong.");
      return;
    }

    try {
      const targetSs = SpreadsheetApp.openById(targetSpreadsheetId);
      const targetSheetName = (cfg.SHEET_NAME || "Log Kehadiran Lengkap").trim();
      let targetSheet = targetSs.getSheetByName(targetSheetName);

      // Kumpulkan kolom profil dinamis dari sheet Data Peserta
      const profileHeadersToAutoInclude = [];
      if (pHeaders && Array.isArray(pHeaders)) {
        pHeaders.forEach(h => {
          const headerStr = String(h || "").trim();
          if (!headerStr) return;
          const lowerH = headerStr.toLowerCase();

          // Filter: Kolom matriks sesi, file ID/URL Drive internal, dan rumus Total Hadir
          const isSessionCol = lowerH.startsWith("sesi:") || (lowerH.includes("[") && lowerH.includes("]"));
          const isInternalDrive = lowerH.includes("drive file id") || lowerH.includes("drive file url");
          const isTotalFormula = lowerH.includes("total hadir") || lowerH.includes("jumlah hadir");

          if (!isSessionCol && !isInternalDrive && !isTotalFormula) {
            const isStandardLogCol = ["ticket id", "id tiket", "nomor tiket", "nama peserta", "nama lengkap", "nama"].includes(lowerH);
            if (!isStandardLogCol && !profileHeadersToAutoInclude.includes(headerStr)) {
              profileHeadersToAutoInclude.push(headerStr);
            }
          }
        });
      }

      // Jika sheet target belum ada, buat sheet baru secara otomatis
      if (!targetSheet) {
        targetSheet = targetSs.insertSheet(targetSheetName);
      }

      const defaultBaseHeaders = [
        "Timestamp Log",
        "ID Sesi",
        "Nama Sesi",
        "Ticket ID",
        "Nama Peserta",
        "Status Scan",
        "Petugas / Panitia",
        "Gate",
        "Link Lokasi (Maps)",
        "Perangkat",
        "Keterangan"
      ];

      // Jika sheet masih baru/kosong, buat header awal
      if (targetSheet.getLastRow() === 0) {
        const initialHeaders = defaultBaseHeaders.concat(profileHeadersToAutoInclude);
        targetSheet.appendRow(initialHeaders);
        targetSheet.getRange(1, 1, 1, initialHeaders.length).setFontWeight("bold").setBackground("#e2e8f0");
        try { targetSheet.setFrozenRows(1); } catch (fErr) {}
      }

      // Baca header sheet target saat ini (Dynamic column mapping)
      let targetLastCol = targetSheet.getLastColumn();
      let targetHeaders = targetSheet.getRange(1, 1, 1, Math.max(1, targetLastCol)).getValues()[0];

      // Auto-append kolom baru jika di Data Peserta ada kolom profil baru yang belum ada di targetHeaders
      profileHeadersToAutoInclude.forEach(newColName => {
        const exists = targetHeaders.some(th => String(th).trim().toLowerCase() === newColName.toLowerCase());
        if (!exists) {
          const nextCol = targetSheet.getLastColumn() + 1;
          targetSheet.getRange(1, nextCol).setValue(newColName).setFontWeight("bold").setBackground("#e2e8f0");
          targetHeaders.push(newColName);
        }
      });

      const rowsToAppend = [];

      items.forEach(item => {
        const logEntry = item.logEntry;
        const attendeeRowData = item.attendeeRowData;
        if (!logEntry) return;

        // Filter jika hanya ingin mencatat scan yang sukses
        if (cfg.ONLY_SUCCESSFUL_SCANS) {
          const statusUpper = String(logEntry.status || "").toUpperCase();
          const isSuccess = statusUpper.startsWith("BERHASIL") || statusUpper.startsWith("CHECK") || statusUpper.startsWith("HADIR");
          if (!isSuccess) return;
        }

        const dataMap = {};
        const logFields = {
          "timestamp": logEntry.timestamp,
          "timestamp log": logEntry.timestamp,
          "waktu": logEntry.timestamp,
          "waktu scan": logEntry.timestamp,
          "id sesi": logEntry.sessionId,
          "kode sesi": logEntry.sessionId,
          "nama sesi": logEntry.sessionName,
          "sesi": logEntry.sessionName,
          "ticket id": logEntry.ticketId,
          "id tiket": logEntry.ticketId,
          "nomor tiket": logEntry.ticketId,
          "nama peserta": logEntry.attendeeName,
          "nama lengkap": logEntry.attendeeName,
          "nama": logEntry.attendeeName,
          "status scan": logEntry.status,
          "status": logEntry.status,
          "petugas / panitia": logEntry.scannedBy,
          "petugas": logEntry.scannedBy,
          "panitia": logEntry.scannedBy,
          "gate": logEntry.gate,
          "pintu": logEntry.gate,
          "link lokasi (maps)": logEntry.mapsUrl,
          "lokasi": logEntry.mapsUrl,
          "maps": logEntry.mapsUrl,
          "perangkat": logEntry.deviceInfo,
          "device": logEntry.deviceInfo,
          "keterangan": logEntry.notes,
          "catatan": logEntry.notes
        };

        Object.keys(logFields).forEach(k => {
          dataMap[k.toLowerCase()] = (logFields[k] !== undefined && logFields[k] !== null) ? String(logFields[k]) : "";
        });

        if (attendeeRowData && pHeaders && Array.isArray(pHeaders)) {
          pHeaders.forEach((h, idx) => {
            const headerStr = String(h || "").trim();
            if (!headerStr) return;
            const val = (attendeeRowData[idx] !== undefined && attendeeRowData[idx] !== null) ? String(attendeeRowData[idx]) : "";
            dataMap[headerStr.toLowerCase()] = val;
          });
        }

        const rowValues = targetHeaders.map(h => {
          const colKey = String(h || "").trim().toLowerCase();
          if (dataMap[colKey] !== undefined) {
            return dataMap[colKey];
          }
          const matchedKey = Object.keys(dataMap).find(k => k.includes(colKey) || colKey.includes(k));
          return matchedKey ? dataMap[matchedKey] : "";
        });

        rowsToAppend.push(rowValues);
      });

      if (rowsToAppend.length > 0) {
        const startRow = targetSheet.getLastRow() + 1;
        targetSheet.getRange(startRow, 1, rowsToAppend.length, targetHeaders.length).setValues(rowsToAppend);
        sysLog.success(`[EXTERNAL SYNC] Berhasil mengirim ${rowsToAppend.length} baris log ke '${targetSheetName}'`);
      }
    } catch (err) {
      sysLog.error(`[EXTERNAL SYNC ERROR] Gagal sync ke spreadsheet eksternal: ${err.message}`);
    }
  }

  /**
   * Menu: Uji coba koneksi dan kirim sampel log ke Spreadsheet Eksternal
   */
  function testExternalSpreadsheetSync() {
    const ui = SpreadsheetApp.getUi();
    const cfg = getExternalSyncConfig();
    const rawId = cfg.SPREADSHEET_ID || "";
    const spreadsheetId = extractSpreadsheetId(rawId);

    if (!spreadsheetId) {
      ui.alert(
        "Spreadsheet Belum Dikonfigurasi",
        "ID Spreadsheet target belum diisi.\n\n" +
        "Silakan masukkan ID atau Link Google Spreadsheet target via Menu '⚡ Presensi Event' -> '9. Hubungkan / Test Spreadsheet Eksternal' atau di CONFIG.EXTERNAL_SYNC.",
        ui.ButtonSet.OK
      );
      return;
    }

    let adminUser = "-";
    try { adminUser = Session.getActiveUser().getEmail() || "Admin"; } catch (e) {}
    const logger = new ExecutionLogger("testExternalSync", { user: adminUser, action: "testExternalSpreadsheetSync" });

    try {
      logger.info(`Testing connection to target spreadsheet ID: ${spreadsheetId}`);
      const targetSs = SpreadsheetApp.openById(spreadsheetId);
      const targetTitle = targetSs.getName();
      logger.info(`Successfully opened spreadsheet: "${targetTitle}"`);

      const sheetPeserta = getOrCreateSheet(CONFIG.SHEETS.DATA_PESERTA);
      const pHeaders = sheetPeserta.getRange(1, 1, 1, Math.max(1, sheetPeserta.getLastColumn())).getValues()[0];

      let sampleRow = null;
      if (sheetPeserta.getLastRow() > 1) {
        sampleRow = sheetPeserta.getRange(2, 1, 1, pHeaders.length).getValues()[0];
      }

      forwardLogToExternalSpreadsheet({
        timestamp: formatFullDateTime(new Date()),
        sessionId: "TEST-01",
        sessionName: "Test Integrasi Sesi",
        ticketId: sampleRow ? sampleRow[0] : "TIC-TEST-999",
        attendeeName: sampleRow ? sampleRow[1] : "Peserta Uji Coba",
        status: "TEST_KONEKSI",
        scannedBy: "Admin / Tester",
        gate: "Pintu Utama",
        mapsUrl: "https://maps.google.com",
        deviceInfo: "Apps Script Diagnostic Test",
        notes: "Baris uji coba integrasi log realtime dengan profil lengkap"
      }, sampleRow, pHeaders);

      logger.setSummary(`Koneksi Sukses: "${targetTitle}"`);
      logger.success("Test row successfully dispatched to external spreadsheet");

      ui.alert(
        "✅ Koneksi Berhasil!",
        `Berhasil terhubung ke spreadsheet:\n"${targetTitle}"\n\n` +
        `Satu baris data tes berhasil dikirim ke tab '${cfg.SHEET_NAME || "Log Kehadiran Lengkap"}' beserta profil dinamis peserta dari sheet 'Data Peserta'.`,
        ui.ButtonSet.OK
      );
    } catch (err) {
      logger.error("testExternalSpreadsheetSync error: " + err.message);
      logger.setSummary("Koneksi Gagal: " + err.message);
      ui.alert(
        "❌ Gagal Terhubung",
        `Gagal mengakses spreadsheet target (${spreadsheetId}):\n\n${err.message}\n\n` +
        "Pastikan:\n1. ID atau Link URL spreadsheet sudah benar.\n2. Akun Google Anda memiliki akses Edit ke spreadsheet target tersebut.",
        ui.ButtonSet.OK
      );
    } finally {
      logger.flush();
    }
  }

  /**
   * Menu UI: Dialog input untuk mengonfigurasi ID Spreadsheet target
   */
  function promptConfigureExternalSync() {
    const ui = SpreadsheetApp.getUi();
    const cfg = getExternalSyncConfig();
    const currentId = cfg.SPREADSHEET_ID || "";
    const currentSheet = cfg.SHEET_NAME || "Log Kehadiran Lengkap";

    const promptRes = ui.prompt(
      "🌐 Konfigurasi Integrasi Spreadsheet Eksternal",
      `Masukkan URL atau ID Google Spreadsheet target:\n(Saat ini: ${currentId ? currentId.substring(0, 30) + "..." : "Belum disetel"})\n\nKetik 'OFF' untuk menonaktifkan sinkronisasi.`,
      ui.ButtonSet.OK_CANCEL
    );

    if (promptRes.getSelectedButton() !== ui.Button.OK) return;

    const inputVal = (promptRes.getResponseText() || "").trim();
    if (!inputVal) return;

    const props = PropertiesService.getScriptProperties();

    if (inputVal.toUpperCase() === "OFF") {
      props.setProperty("EXTERNAL_SYNC_ENABLED", "false");
      ui.alert("Integrasi Dinonaktifkan", "Pengiriman log ke spreadsheet eksternal dinonaktifkan.", ui.ButtonSet.OK);
      return;
    }

    const cleanId = extractSpreadsheetId(inputVal);
    props.setProperty("EXTERNAL_SPREADSHEET_ID", cleanId);
    props.setProperty("EXTERNAL_SHEET_NAME", currentSheet);
    props.setProperty("EXTERNAL_SYNC_ENABLED", "true");

    const testConfirm = ui.alert(
      "Konfigurasi Berhasil Disimpan!",
      `Target Spreadsheet ID: ${cleanId}\nTab Target: ${currentSheet}\nStatus: AKTIF (Realtime)\n\nApakah Anda ingin langsung mencoba tes koneksi sekarang?`,
      ui.ButtonSet.YES_NO
    );

    if (testConfirm === ui.Button.YES) {
      testExternalSpreadsheetSync();
    }
  }


