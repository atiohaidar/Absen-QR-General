/**
 * ==============================================================================
 * WEBHOOK API: KUPON & AMBIL MAKAN TRACKER (IKHWAN & AKHWAT)
 * ==============================================================================
 * Endpoint Web App ini menerima data scan presensi via HTTP POST:
 * 1. Menentukan target tab ("Ikhwan" / "Akhwat") dari kolom Jenis Kelamin (atau Gate).
 * 2. Auto-Migrasi Kolom: Otomatis menambahkan kolom "Tanggal / Sesi" jika belum ada.
 * 3. Case-Insensitive Composite Key (Ticket ID + Base ID Sesi):
 *    - Tanggal/Sesi sama -> update baris yang sama.
 *    - Tanggal/Sesi beda -> buat baris baru untuk peserta yang sama.
 * 4. Logika Sesi & Status:
 *    - Sesi IN  (BERHASIL / CHECKIN)    -> Centang "Ambil Kupon" + Waktu Scan
 *    - Sesi OUT (CHECKOUT / BERHASIL)   -> Centang "Ambil Makan" + Waktu Scan
 *    - CHECKOUT_ANOMALI                 -> Centang KEDUA-DUANYA sekaligus!
 *    - DIBATALKAN                       -> Uncheck & reset waktu ke formula circular
 * 5. Formula circular cadangan (titik koma):
 *    =IF(C2=TRUE; IF(D2<>""; D2; NOW()); "")
 * 6. Multi-Format Date Parser: Mendukung ISO date, space-separated, dan DD/MM/YYYY.
 * ==============================================================================
 */

const WEBHOOK_CONFIG = {
  SHEETS: {
    LOG: "Log Kehadiran",
    IKHWAN: "Ikhwan",
    AKHWAT: "Akhwat"
  },
  // Ubah ke true jika ingin webhook ini JUGA menulis ke sheet Log Kehadiran.
  // Biarkan false jika Code.gs sudah menulis ke Log Kehadiran secara terpisah.
  RECORD_TO_LOG_SHEET: false,

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
 * Custom Menu saat spreadsheet dibuka
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("⚡ Webhook Kupon")
    .addItem("🧪 Jalankan Test Lokal (Dummy IN & OUT)", "testWebhookLocally")
    .addToUi();
}

/**
 * ==============================================================================
 * 1. HTTP GET (HEALTH CHECK & INFO)
 * ==============================================================================
 */
function doGet(e) {
  return createJsonResponse({
    status: "ok",
    service: "Webhook Kupon & Makan Tracker",
    timestamp: new Date().toISOString(),
    message: "Endpoint Web App siap menerima payload HTTP POST."
  });
}

/**
 * ==============================================================================
 * 2. HTTP POST (RECEIVER UTAMA SCAN PRESENSI)
 * ==============================================================================
 */
function doPost(e) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) {
    return createJsonResponse({
      status: "error",
      message: "Server sibuk memproses antrean scan lain. Coba beberapa saat lagi."
    });
  }

  try {
    let rawPayload = {};

    // 1. Parsing payload (bisa JSON raw body, text/plain, atau form-urlencoded)
    if (e && e.postData && e.postData.contents) {
      try {
        rawPayload = JSON.parse(e.postData.contents);
      } catch (parseErr) {
        rawPayload = e.parameter || {};
      }
    } else if (e && e.parameter) {
      rawPayload = e.parameter;
    }

    // Ekstrak items (mendukung single object, array, atau { items: [...] })
    let rawItems = [];
    if (Array.isArray(rawPayload)) {
      rawItems = rawPayload;
    } else if (rawPayload.items && Array.isArray(rawPayload.items)) {
      rawItems = rawPayload.items;
    } else if (Object.keys(rawPayload).length > 0) {
      rawItems = [rawPayload];
    }

    if (rawItems.length === 0) {
      return createJsonResponse({
        status: "ignored",
        message: "Tidak ada data scan yang diterima."
      });
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const logSheet = WEBHOOK_CONFIG.RECORD_TO_LOG_SHEET ? ss.getSheetByName(WEBHOOK_CONFIG.SHEETS.LOG) : null;

    // Cache internal per sheet agar hanya me-load sheet yang BENAR-BENAR dibutuhkan (Lazy Loading)
    const contextCache = {};
    function getContext(isAkhwat) {
      const sheetName = isAkhwat ? WEBHOOK_CONFIG.SHEETS.AKHWAT : WEBHOOK_CONFIG.SHEETS.IKHWAN;
      if (!contextCache[sheetName]) {
        const sheet = getOrCreateTargetSheet(ss, sheetName);
        const targetCache = loadTargetSheetIndex(sheet);
        const colMap = mapTargetColumns(sheet);
        contextCache[sheetName] = { sheet, targetCache, colMap };
      }
      return contextCache[sheetName];
    }

    const processedResults = [];

    // 2. Loop setiap item scan
    for (let i = 0; i < rawItems.length; i++) {
      const rawItem = rawItems[i];
      if (!rawItem) continue;

      // Unpack & normalisasi payload
      const normalized = normalizeScanPayload(rawItem);
      const ticketId   = normalized.ticketId;
      if (!ticketId) continue;

      const namaPeserta  = normalized.namaPeserta;
      const idSesi       = normalized.idSesi;
      const namaSesi     = normalized.namaSesi;
      const statusScan   = normalized.statusScan;
      const statusPeserta= normalized.statusPeserta;
      const jenisKelamin = normalized.jenisKelamin;
      const noWhatsapp   = normalized.noWhatsapp;
      const timestampLog = normalized.timestamp;

      // Base ID Sesi (menghilangkan _IN / _OUT / -IN / -OUT)
      const baseSession = getBaseSession(idSesi);

      // Composite Key UPPERCASE agar tahan terhadap perbedaan huruf besar/kecil
      const compositeKey = (baseSession ? `${ticketId}_${baseSession}` : ticketId).toUpperCase();

      // Routing Sheet target secara Lazy (hanya buka sheet yang relevan)
      const isAkhwat = isFemaleGender(jenisKelamin);
      const ctx = getContext(isAkhwat);
      const targetSheet = ctx.sheet;
      const targetCache = ctx.targetCache;
      const colMap = ctx.colMap;

      // Deteksi Sesi & Status
      const sessionType  = detectSessionType(idSesi, statusScan);
      const isAnomalyOut = statusScan.includes("ANOMALI");
      const isSuccessIn  = (sessionType === "IN") && (statusScan === "BERHASIL" || statusScan === "SUKSES" || statusScan === "CHECKIN");
      const isSuccessOut = (sessionType === "OUT") && (statusScan === "CHECKOUT" || statusScan === "BERHASIL" || statusScan === "SUKSES" || isAnomalyOut);
      const isCanceled   = statusScan.includes("BATAL") || statusScan.includes("CANCEL");

      // Huruf kolom dinamis
      const kuponCheckLetter = getColumnLetter(colMap.kupon > 0 ? colMap.kupon : (colMap.sesi > 0 ? 4 : 3));
      const kuponTimeLetter  = getColumnLetter(colMap.waktuKupon > 0 ? colMap.waktuKupon : (colMap.sesi > 0 ? 5 : 4));
      const makanCheckLetter = getColumnLetter(colMap.makan > 0 ? colMap.makan : (colMap.sesi > 0 ? 6 : 5));
      const makanTimeLetter  = getColumnLetter(colMap.waktuMakan > 0 ? colMap.waktuMakan : (colMap.sesi > 0 ? 7 : 6));

      // Cek apakah data sudah ada di target sheet
      if (!targetCache.ticketMap.hasOwnProperty(compositeKey)) {
        // --- BUAT BARIS BARU ---
        const nextRow = targetSheet.getLastRow() + 1;
        const formulaKupon = buildTimestampFormula(kuponCheckLetter, kuponTimeLetter, nextRow);
        const formulaMakan = buildTimestampFormula(makanCheckLetter, makanTimeLetter, nextRow);

        let ambilKupon = false;
        let waktuKupon = formulaKupon;
        let ambilMakan = false;
        let waktuMakan = formulaMakan;

        if (isAnomalyOut) {
          ambilKupon = true;
          waktuKupon = formatTimestamp(timestampLog);
          ambilMakan = true;
          waktuMakan = formatTimestamp(timestampLog);
        } else if (isSuccessIn) {
          ambilKupon = true;
          waktuKupon = formatTimestamp(timestampLog);
        } else if (isSuccessOut) {
          ambilMakan = true;
          waktuMakan = formatTimestamp(timestampLog);
        }

        const targetHeaders = targetSheet.getRange(1, 1, 1, targetSheet.getLastColumn()).getValues()[0];
        const newRowValues = targetHeaders.map(h => {
          const s = String(h).toLowerCase();
          if (s.includes("ticket") || s.includes("tiket")) return ticketId;
          if (s === "nama" || s.includes("nama peserta")) return namaPeserta;
          if (s.includes("sesi") || s.includes("tanggal") || s.includes("date")) return baseSession;
          if ((s.includes("waktu") || s.includes("jam") || s.includes("time")) && s.includes("kupon")) return waktuKupon;
          if (s.includes("kupon")) return ambilKupon;
          if ((s.includes("waktu") || s.includes("jam") || s.includes("time")) && s.includes("makan")) return waktuMakan;
          if (s.includes("makan")) return ambilMakan;
          if (s.includes("jenis kelamin") || s.includes("gender")) return jenisKelamin;
          if (!s.includes("waktu") && (s.includes("whatsapp") || s.includes("no wa") || s.includes("nomor wa") || s.includes("telepon") || s.includes("phone") || s.includes("hp") || /\bwa\b/i.test(s))) return noWhatsapp;
          if (s === "status" || s.includes("status peserta")) return statusPeserta;
          return "";
        });

        targetSheet.appendRow(newRowValues);
        const newRowIndex = targetSheet.getLastRow();

        if (colMap.kupon > 0) targetSheet.getRange(newRowIndex, colMap.kupon).insertCheckboxes();
        if (colMap.makan > 0) targetSheet.getRange(newRowIndex, colMap.makan).insertCheckboxes();
        if (colMap.waktuKupon > 0) targetSheet.getRange(newRowIndex, colMap.waktuKupon).setNumberFormat("dd/MM/yyyy HH:mm:ss");
        if (colMap.waktuMakan > 0) targetSheet.getRange(newRowIndex, colMap.waktuMakan).setNumberFormat("dd/MM/yyyy HH:mm:ss");

        targetCache.ticketMap[compositeKey] = newRowIndex;
        processedResults.push({ ticketId, action: "INSERT", row: newRowIndex, sheet: isAkhwat ? "Akhwat" : "Ikhwan" });

      } else {
        // --- UPDATE BARIS EXISTING ---
        const targetRow = targetCache.ticketMap[compositeKey];

        if (isAnomalyOut) {
          if (colMap.kupon > 0) targetSheet.getRange(targetRow, colMap.kupon).setValue(true);
          if (colMap.waktuKupon > 0) {
            const timeCell = targetSheet.getRange(targetRow, colMap.waktuKupon);
            const val = timeCell.getValue();
            const hasFormula = Boolean(timeCell.getFormula());
            if (!val || hasFormula) {
              timeCell.setValue(formatTimestamp(timestampLog));
            }
            timeCell.setNumberFormat("dd/MM/yyyy HH:mm:ss");
          }
          if (colMap.makan > 0) targetSheet.getRange(targetRow, colMap.makan).setValue(true);
          if (colMap.waktuMakan > 0) {
            targetSheet.getRange(targetRow, colMap.waktuMakan).setValue(formatTimestamp(timestampLog)).setNumberFormat("dd/MM/yyyy HH:mm:ss");
          }

        } else if (sessionType === "IN") {
          // Update Checkbox Kupon
          if (colMap.kupon > 0) {
            const checkCell = targetSheet.getRange(targetRow, colMap.kupon);
            if (isSuccessIn) checkCell.setValue(true);
            else if (isCanceled) checkCell.setValue(false);
          }
          // Update Waktu Kupon
          if (colMap.waktuKupon > 0) {
            const timeCell = targetSheet.getRange(targetRow, colMap.waktuKupon);
            if (isSuccessIn) {
              timeCell.setValue(formatTimestamp(timestampLog)).setNumberFormat("dd/MM/yyyy HH:mm:ss");
            } else if (isCanceled) {
              timeCell.setValue(buildTimestampFormula(kuponCheckLetter, kuponTimeLetter, targetRow)).setNumberFormat("dd/MM/yyyy HH:mm:ss");
            }
          }

        } else if (sessionType === "OUT") {
          // Update Checkbox Makan
          if (colMap.makan > 0) {
            const checkCell = targetSheet.getRange(targetRow, colMap.makan);
            if (isSuccessOut) checkCell.setValue(true);
            else if (isCanceled) checkCell.setValue(false);
          }
          // Update Waktu Makan
          if (colMap.waktuMakan > 0) {
            const timeCell = targetSheet.getRange(targetRow, colMap.waktuMakan);
            if (isSuccessOut) {
              timeCell.setValue(formatTimestamp(timestampLog)).setNumberFormat("dd/MM/yyyy HH:mm:ss");
            } else if (isCanceled) {
              timeCell.setValue(buildTimestampFormula(makanCheckLetter, makanTimeLetter, targetRow)).setNumberFormat("dd/MM/yyyy HH:mm:ss");
            }
          }
        }

        processedResults.push({ ticketId, action: "UPDATE", row: targetRow, sheet: isAkhwat ? "Akhwat" : "Ikhwan" });
      }

      // (Opsional) Catat ke tab Log Kehadiran jika diaktifkan
      if (logSheet) {
        logSheet.appendRow([
          formatTimestamp(timestampLog),
          idSesi,
          namaSesi,
          ticketId,
          namaPeserta,
          statusScan,
          normalized.petugas,
          normalized.gate || (isAkhwat ? "Akhwat" : "Ikhwan"),
          normalized.mapsUrl,
          normalized.deviceInfo,
          normalized.notes,
          normalized.email,
          normalized.waktuDaftar,
          statusPeserta,
          jenisKelamin,
          normalized.nim,
          noWhatsapp
        ]);
      }
    }

    try {
      ss.toast(`Berhasil memproses ${processedResults.length} data via POST Webhook!`, "⚡ Webhook Sukses", 3);
    } catch (tErr) {}

    return createJsonResponse({
      status: "success",
      message: `Berhasil memproses ${processedResults.length} data scan.`,
      results: processedResults
    });

  } catch (err) {
    Logger.log("❌ Error di doPost: " + err.toString());
    return createJsonResponse({
      status: "error",
      message: err.message || err.toString()
    });
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
 * Menormalisasi payload input baik dari JSON flat maupun struktur Code.gs
 */
function normalizeScanPayload(raw) {
  const entry = raw.logEntry || raw;
  const data = Object.assign({}, raw, entry);

  // Ambil profil dari attendeeRowData jika tersedia (format Code.gs)
  if (raw.attendeeRowData && raw.pHeaders && Array.isArray(raw.pHeaders)) {
    raw.pHeaders.forEach((h, idx) => {
      const key = String(h || "").trim().toLowerCase();
      const val = raw.attendeeRowData[idx];
      if (key.includes("kelamin") || key.includes("gender")) data.jenisKelamin = val;
      if (!key.includes("waktu") && (key.includes("whatsapp") || key.includes("no wa") || key.includes("nomor wa") || key.includes("telepon") || key.includes("phone") || key.includes("hp") || /\bwa\b/i.test(key))) data.noWhatsapp = val;
      if (key === "status" || key.includes("status peserta")) data.statusPeserta = val;
      if (key === "nim") data.nim = val;
      if (key.includes("email")) data.email = val;
    });
  }

  // Fallback: Jika jenis kelamin tidak diisi tapi ada info Gate, ambil dari Gate
  let gender = String(data.jenisKelamin || data.gender || data["Jenis Kelamin"] || data.jenis_kelamin || "").trim();
  const gateInfo = String(data.gate || data["Gate"] || "").trim();
  if (!gender && gateInfo) {
    gender = gateInfo;
  }

  return {
    ticketId:      String(data.ticketId || data["Ticket ID"] || data.idTiket || data.nomorTiket || "").trim(),
    namaPeserta:   String(data.namaPeserta || data.attendeeName || data.nama || data["Nama"] || data.namaLengkap || "").trim(),
    idSesi:        String(data.idSesi || data.sessionId || data["ID Sesi"] || data.kodeSesi || "").trim(),
    namaSesi:      String(data.namaSesi || data.sessionName || data["Nama Sesi"] || data.sesi || "").trim(),
    statusScan:    String(data.statusScan || data.status || data["Status Scan"] || "BERHASIL").toUpperCase().trim(),
    statusPeserta: String(data.statusPeserta || data.statusProfile || data["Status"] || data.kategori || "").trim(),
    jenisKelamin:  gender,
    noWhatsapp:    String(data.noWhatsapp || data.noWa || data.whatsapp || data["No Whatsapp"] || data.telepon || "").trim(),
    timestamp:     data.timestamp || data["Timestamp Log"] || data.waktu || new Date(),
    petugas:       String(data.petugas || data.scannedBy || data["Petugas / Panitia"] || "Scanner").trim(),
    gate:          gateInfo,
    mapsUrl:       String(data.mapsUrl || data["Link Lokasi (Maps)"] || "").trim(),
    deviceInfo:    String(data.deviceInfo || data["Perangkat"] || "").trim(),
    notes:         String(data.notes || data["Keterangan"] || "").trim(),
    email:         String(data.email || data["Email"] || "").trim(),
    waktuDaftar:   String(data.waktuDaftar || data["Waktu Daftar"] || "").trim(),
    nim:           String(data.nim || data["NIM"] || "").trim()
  };
}

function createJsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function getBaseSession(idSesi) {
  let s = String(idSesi || "").trim();
  s = s.replace(/[_-](IN|OUT)$/i, "");
  return s;
}

function detectSessionType(idSesi, statusScan) {
  const upper = String(idSesi || "").toUpperCase();
  const statusUpper = String(statusScan || "").toUpperCase();

  if (statusUpper === "CHECKOUT" || statusUpper.includes("CHECKOUT") || upper.endsWith("_OUT") || upper.includes("_OUT_") || upper.includes("KELUAR")) {
    return "OUT";
  }
  if (statusUpper === "CHECKIN" || upper.endsWith("_IN") || upper.includes("_IN_") || upper.includes("MASUK")) {
    return "IN";
  }
  return "UNKNOWN";
}

function isFemaleGender(genderString) {
  const s = String(genderString).toLowerCase();
  return s.includes("perempuan") || s.includes("akhwat") || s.includes("wanita") || s === "p";
}

/**
 * Format timestamp yang tangguh terhadap format ISO, spasi, dan DD/MM/YYYY
 */
function formatTimestamp(val) {
  if (!val) return "";
  if (val instanceof Date) {
    return Utilities.formatDate(val, Session.getScriptTimeZone() || "Asia/Jakarta", "dd/MM/yyyy HH:mm:ss");
  }

  let d = new Date(val);
  // Tangani format "YYYY-MM-DD HH:mm:ss" dengan mengganti spasi menjadi "T"
  if (isNaN(d.getTime()) && typeof val === "string") {
    d = new Date(val.replace(" ", "T"));
  }

  if (!isNaN(d.getTime())) {
    return Utilities.formatDate(d, Session.getScriptTimeZone() || "Asia/Jakarta", "dd/MM/yyyy HH:mm:ss");
  }

  // Jika sudah berupa format teks (misal 22/10/2026 16:54:39), kembalikan langsung
  return String(val);
}

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

function buildTimestampFormula(checkColLetter, timeColLetter, rowNum) {
  return `=IF(${checkColLetter}${rowNum}=TRUE; IF(${timeColLetter}${rowNum}<>""; ${timeColLetter}${rowNum}; NOW()); "")`;
}

function mapTargetColumns(sheet) {
  const lastCol = sheet.getLastColumn();
  const headers = lastCol > 0 ? sheet.getRange(1, 1, 1, lastCol).getValues()[0] : [];
  
  const map = {
    ticket: 1,
    nama: 2,
    sesi: -1,
    kupon: -1,
    waktuKupon: -1,
    makan: -1,
    waktuMakan: -1,
    status: -1,
    gender: -1,
    wa: -1
  };

  headers.forEach((h, idx) => {
    const s = String(h).toLowerCase();
    const col1 = idx + 1;
    if (s.includes("ticket") || s.includes("tiket")) map.ticket = col1;
    else if (s === "nama" || s.includes("nama peserta")) map.nama = col1;
    else if (s.includes("sesi") || s.includes("tanggal") || s.includes("date")) map.sesi = col1;
    else if ((s.includes("waktu") || s.includes("jam") || s.includes("time")) && s.includes("kupon")) map.waktuKupon = col1;
    else if (s.includes("kupon")) map.kupon = col1;
    else if ((s.includes("waktu") || s.includes("jam") || s.includes("time")) && s.includes("makan")) map.waktuMakan = col1;
    else if (s.includes("makan")) map.makan = col1;
    else if (s.includes("jenis kelamin") || s.includes("gender")) map.gender = col1;
    else if (!s.includes("waktu") && (s.includes("whatsapp") || s.includes("no wa") || s.includes("nomor wa") || s.includes("telepon") || s.includes("phone") || s.includes("hp") || /\bwa\b/i.test(s))) map.wa = col1;
    else if (s === "status" || s.includes("status peserta")) map.status = col1;
  });

  // Fallback defaults jika header belum dibuat lengkap
  if (map.kupon === -1) map.kupon = (map.sesi > 0 ? 4 : 3);
  if (map.waktuKupon === -1) map.waktuKupon = (map.sesi > 0 ? 5 : 4);
  if (map.makan === -1) map.makan = (map.sesi > 0 ? 6 : 5);
  if (map.waktuMakan === -1) map.waktuMakan = (map.sesi > 0 ? 7 : 6);

  return map;
}

/**
 * Pastikan sheet target ada & otomatis migrasi kolom "Tanggal / Sesi" jika belum ada
 */
function getOrCreateTargetSheet(ss, sheetName) {
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
  }

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(WEBHOOK_CONFIG.TARGET_HEADERS);
    const headerRange = sheet.getRange(1, 1, 1, WEBHOOK_CONFIG.TARGET_HEADERS.length);
    headerRange.setFontWeight("bold").setBackground("#0f766e").setFontColor("#ffffff");
    sheet.setFrozenRows(1);
  } else {
    // Auto-Migrasi: Jika sheet sudah ada tapi kolom 'Tanggal / Sesi' belum ada, sisipkan otomatis!
    const lastCol = sheet.getLastColumn();
    if (lastCol > 0) {
      const currentHeaders = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
      const hasSesiCol = currentHeaders.some(h => /sesi|tanggal|date/i.test(String(h)));
      if (!hasSesiCol) {
        // Sisipkan kolom Tanggal / Sesi di kolom 3 (setelah kolom Nama)
        sheet.insertColumnAfter(2);
        sheet.getRange(1, 3).setValue("Tanggal / Sesi")
             .setFontWeight("bold")
             .setBackground("#0f766e")
             .setFontColor("#ffffff");
        Logger.log(`ℹ️ Kolom 'Tanggal / Sesi' otomatis ditambahkan ke sheet '${sheetName}'.`);
      }
    }
  }

  return sheet;
}

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
        // Simpan composite key dalam UPPERCASE agar lookup case-insensitive
        const key = (sesi ? `${ticketId}_${sesi}` : ticketId).toUpperCase();
        ticketMap[key] = r + 2;
      }
    }
  }
  return { sheet, ticketMap };
}

/**
 * ==============================================================================
 * 4. TESTER FUNCTION (UNTUK TEST LANGSUNG DARI APPS SCRIPT TARGET)
 * ==============================================================================
 */
function testWebhookLocally() {
  const dummyEvent = {
    postData: {
      contents: JSON.stringify([
        {
          ticketId: "BUKBER_MSU_TEST_01",
          namaPeserta: "Tio Haidar (Local Test IN)",
          jenisKelamin: "Laki-laki",
          idSesi: "BUKBER_SENIN_KAMIS_2026-10-25_IN",
          namaSesi: "Buka Bersama Rutin (25/10/2026)",
          statusScan: "BERHASIL",
          statusPeserta: "Dosen/Pegawai",
          noWhatsapp: "628190000000"
        },
        {
          ticketId: "BUKBER_MSU_TEST_01",
          namaPeserta: "Tio Haidar (Local Test OUT)",
          jenisKelamin: "Laki-laki",
          idSesi: "BUKBER_SENIN_KAMIS_2026-10-25_OUT",
          namaSesi: "Buka Bersama Rutin (25/10/2026)",
          statusScan: "CHECKOUT",
          statusPeserta: "Dosen/Pegawai",
          noWhatsapp: "628190000000"
        }
      ])
    }
  };

  const response = doPost(dummyEvent);
  Logger.log("Hasil Response: " + response.getContent());
}
