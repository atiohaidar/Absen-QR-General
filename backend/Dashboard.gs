/**
 * ==============================================================================
 * EVENTPASS • MODULAR REALTIME DASHBOARD & ANALYTICS API (backend/Dashboard.gs)
 * ==============================================================================
 * 
 * Modul terpisah untuk menyajikan data analitik, statistik kehadiran,
 * arus kedatangan (velocity), perbandingan antar sesi, serta breakdown dinamis
 * berdasarkan sheet "Data Peserta".
 * 
 * PRINSIP ARSITEKTUR:
 * 1. ZERO LOCK: Operasi 100% read-only tanpa LockService agar tidak pernah
 *    menghambat atau mengantre di belakang proses scanning tiket di lapangan.
 * 2. CACHE-ENABLED: Menggunakan CacheService (TTL 30 detik) untuk menghemat
 *    kuota eksekusi Google Apps Script saat dashboard di-refresh berkali-kali.
 * 3. DYNAMIC COLUMN DETECTION: Otomatis membedakan kolom identitas, sesi presensi,
 *    dan dimensi kustom (Instansi, Divisi, Gender, Kategori Tiket, dsb).
 * ==============================================================================
 */

/**
 * Entry point utama yang dipanggil oleh doGet / doPost di Code.gs
 * @param {Object} e - Event parameter dari Apps Script
 * @param {Object} payload - Parameter/body request (action, forceRefresh, session, etc.)
 */
function handleDashboardRequest(e, payload) {
  const logger = (typeof ExecutionLogger === "function") 
    ? new ExecutionLogger("dashboardApi") 
    : { info: () => {}, warn: () => {}, error: () => {}, setSummary: () => {}, flush: () => {} };

  try {
    const params = payload || (e && e.parameter) || {};
    const action = params.action || "getDashboardData";
    const forceRefresh = String(params.forceRefresh).toLowerCase() === "true";
    const selectedSessionId = (params.sessionId || "").trim();
    const compareSessionId = (params.compareSessionId || "").trim();

    logger.info("Handling dashboard request", { action, forceRefresh, selectedSessionId });

    // 1. Cek CacheService jika forceRefresh tidak aktif
    const cacheKey = `dash_data_${selectedSessionId || "all"}_v2`;
    const cache = CacheService.getScriptCache();
    
    if (!forceRefresh) {
      try {
        const cachedJson = cache.get(cacheKey);
        if (cachedJson) {
          logger.info("Returning dashboard data from ScriptCache");
          const parsed = JSON.parse(cachedJson);
          parsed.cached = true;
          return createDashboardJsonResponse(parsed);
        }
      } catch (cacheErr) {
        // Cache miss / error baca cache, lanjutkan eksekusi normal
      }
    }

    // 2. Ambil data langsung dari sheet
    const ss = (typeof getSpreadsheet === "function") ? getSpreadsheet() : SpreadsheetApp.getActiveSpreadsheet();
    const dataPesertaSheetName = (typeof CONFIG !== "undefined" && CONFIG.SHEETS && CONFIG.SHEETS.DATA_PESERTA) 
      ? CONFIG.SHEETS.DATA_PESERTA 
      : "Data Peserta";
    
    const sheetPeserta = ss.getSheetByName(dataPesertaSheetName);
    if (!sheetPeserta) {
      return createDashboardJsonResponse({
        success: false,
        message: `Sheet '${dataPesertaSheetName}' tidak ditemukan.`
      });
    }

    // Ambil daftar sesi dari Master Sesi jika tersedia
    const masterSessions = (typeof getActiveSessions === "function") 
      ? getActiveSessions() 
      : fetchSessionsFromMasterSesi(ss);

    // 3. Olah data peserta & kalkulasi analitik
    const dashboardData = compileDashboardData(sheetPeserta, masterSessions, {
      selectedSessionId,
      compareSessionId,
      summaryOnly: (action === "getDashboardSummary")
    });

    dashboardData.success = true;
    dashboardData.cached = false;
    dashboardData.timestamp = new Date().toISOString();

    // 4. Simpan ke CacheService jika ukuran payload memungkinkan (<95KB)
    try {
      const jsonStr = JSON.stringify(dashboardData);
      if (jsonStr.length < 95000) {
        cache.put(cacheKey, jsonStr, 30); // 30 detik TTL
      }
    } catch (saveCacheErr) {
      // Abaikan jika payload melebihi limit kuota cache
    }

    logger.info("Dashboard data compiled successfully", {
      totalRows: dashboardData.meta.totalParticipants,
      sessionsCount: dashboardData.sessions.length
    });

    return createDashboardJsonResponse(dashboardData);

  } catch (err) {
    logger.error("Dashboard API Error: " + err.message, err.stack);
    return createDashboardJsonResponse({
      success: false,
      message: "Gagal memuat analitik dashboard: " + err.message
    });
  } finally {
    if (logger.flush) logger.flush();
  }
}

/**
 * Mengolah isi sheet "Data Peserta" menjadi struktur analitik komprehensif
 */
function compileDashboardData(sheetPeserta, masterSessions, options) {
  const lastRow = sheetPeserta.getLastRow();
  const lastCol = sheetPeserta.getLastColumn();

  if (lastRow < 1 || lastCol < 1) {
    return {
      meta: { eventName: getEventName(), totalParticipants: 0 },
      columns: [],
      sessions: [],
      sessionSummaries: {},
      attendees: []
    };
  }

  // Baca seluruh data sekaligus (1 batch API call)
  const rawValues = sheetPeserta.getRange(1, 1, lastRow, lastCol).getValues();
  const headers = rawValues[0] || [];

  // Analisis Peran Setiap Kolom
  const columnSchema = analyzeColumnSchema(sheetPeserta, headers);
  
  // Deteksi Kolom-Kolom Sesi
  const sessionColumns = [];
  headers.forEach((h, idx) => {
    const headerStr = String(h || "").trim();
    const match = headerStr.match(/\[([A-Za-z0-9_-]+)\]/);
    if (match) {
      const rawId = match[1];
      const isOut = /_OUT$/i.test(rawId);
      const isIn = /_IN$/i.test(rawId);
      const baseId = rawId.replace(/_(IN|OUT)$/i, "").replace(/_\d{4}-?\d{2}-?\d{2}.*$/i, "");
      
      sessionColumns.push({
        colIdx: idx,
        fullHeader: headerStr,
        rawSessionId: rawId,
        baseSessionId: baseId,
        isOut: isOut,
        isIn: isIn
      });
    }
  });

  // Gabungkan daftar sesi dari Master Sesi dan Kolom Sesi yang ada di sheet
  const sessionMap = new Map();
  masterSessions.forEach(s => {
    sessionMap.set(s.id, {
      id: s.id,
      name: s.name || s.id,
      date: s.date || "",
      status: s.status || "AKTIF",
      type: s.type || "SINGLE"
    });
  });

  sessionColumns.forEach(sc => {
    if (!sessionMap.has(sc.baseSessionId)) {
      // Buat entri fallback jika sesi belum ada di Master Sesi
      const cleanName = sc.fullHeader.replace(/^Sesi:\s*/i, "").replace(/\s*\[.*\]$/, "").trim();
      sessionMap.set(sc.baseSessionId, {
        id: sc.baseSessionId,
        name: cleanName || sc.baseSessionId,
        date: "",
        status: "AKTIF",
        type: (sc.isIn || sc.isOut) ? "CHECK_IN_OUT" : "SINGLE"
      });
    }
  });

  const allSessions = Array.from(sessionMap.values());

  // Tentukan sesi acuan utama (Default ke sesi pertama atau yang dipilih)
  const activeSessionId = options.selectedSessionId || (allSessions.length > 0 ? allSessions[0].id : "");
  const compareSessionId = options.compareSessionId || "";

  // Penampung data analitik
  const sessionSummaries = {};
  allSessions.forEach(s => {
    sessionSummaries[s.id] = {
      sessionId: s.id,
      sessionName: s.name,
      totalRegistered: 0,
      attended: 0,
      checkedOut: 0,
      absent: 0,
      rate: 0,
      hourlyArrivals: {} // { "07:00": 5, "07:15": 12, ... }
    };
  });

  const attendees = [];
  const dimensionAggregates = {}; // { [dimName]: { [categoryVal]: { total: 0, attended: 0 } } }

  // Inisialisasi dimension aggregates
  columnSchema.dimensions.forEach(dim => {
    dimensionAggregates[dim.name] = {};
  });

  const todayIso = Utilities.formatDate(new Date(), "GMT+7", "yyyy-MM-dd");

  // Iterasi data peserta (Row 2 sampai selesai)
  for (let r = 1; r < rawValues.length; r++) {
    const row = rawValues[r];
    const ticketId = String(row[columnSchema.ticketCol] || "").trim();
    if (!ticketId) continue; // Skip baris kosong

    const name = String(row[columnSchema.nameCol] || "Peserta").trim();
    const email = columnSchema.emailCol >= 0 ? String(row[columnSchema.emailCol] || "-").trim() : "-";
    const phone = columnSchema.phoneCol >= 0 ? String(row[columnSchema.phoneCol] || "-").trim() : "-";
    const totalHadirVal = columnSchema.totalCol >= 0 ? Number(row[columnSchema.totalCol]) || 0 : 0;

    // Kumpulkan field dimensi kustom
    const customData = {};
    columnSchema.dimensions.forEach(dim => {
      const val = String(row[dim.colIdx] || "").trim() || "Tidak Diisi";
      customData[dim.name] = val;

      if (!dimensionAggregates[dim.name][val]) {
        dimensionAggregates[dim.name][val] = { total: 0, attendedInActive: 0 };
      }
      dimensionAggregates[dim.name][val].total++;
    });

    // Evaluasi status kehadiran per sesi
    const attendeeSessions = {};
    allSessions.forEach(s => {
      sessionSummaries[s.id].totalRegistered++;

      // Cari kolom yang berkorespondensi dengan sesi ini
      let inVal = "";
      let outVal = "";
      let singleVal = "";

      sessionColumns.forEach(sc => {
        if (sc.baseSessionId === s.id || sc.rawSessionId.includes(s.id)) {
          // Periksa juga apakah cocok dengan format tanggal harian (sesi rutin)
          const isDateMatch = !sc.rawSessionId.includes("_20") || sc.rawSessionId.includes(todayIso);
          if (isDateMatch) {
            const cellVal = String(row[sc.colIdx] || "").trim();
            if (sc.isOut) outVal = cellVal;
            else if (sc.isIn) inVal = cellVal;
            else singleVal = cellVal;
          }
        }
      });

      const hasIn = inVal.startsWith("HADIR") || singleVal.startsWith("HADIR");
      const hasOut = outVal.startsWith("CHECKOUT") || singleVal.startsWith("CHECKOUT");

      let status = "BELUM_HADIR";
      let checkInTime = "";
      let checkOutTime = "";

      if (hasOut) {
        status = "CHECKOUT";
        checkOutTime = outVal.replace(/^CHECKOUT\s*-\s*/, "").trim() || singleVal.replace(/^CHECKOUT\s*-\s*/, "").trim();
      } else if (hasIn) {
        status = "HADIR";
        checkInTime = inVal.replace(/^HADIR\s*-\s*/, "").trim() || singleVal.replace(/^HADIR\s*-\s*/, "").trim();
      }

      if (hasIn || hasOut) {
        sessionSummaries[s.id].attended++;
        if (hasOut) sessionSummaries[s.id].checkedOut++;

        // Catat hourly check-in timeline jika ada timestamp
        const timeToBucket = checkInTime || checkOutTime;
        if (timeToBucket) {
          const timeSlot = normalizeTimeSlot(timeToBucket);
          if (timeSlot) {
            sessionSummaries[s.id].hourlyArrivals[timeSlot] = (sessionSummaries[s.id].hourlyArrivals[timeSlot] || 0) + 1;
          }
        }
      }

      attendeeSessions[s.id] = {
        status: status,
        checkInTime: checkInTime,
        checkOutTime: checkOutTime,
        rawIn: inVal || singleVal,
        rawOut: outVal
      };
    });

    // Update dimension attended count untuk activeSession
    const isActiveAttended = activeSessionId && attendeeSessions[activeSessionId] && attendeeSessions[activeSessionId].status !== "BELUM_HADIR";
    if (isActiveAttended) {
      columnSchema.dimensions.forEach(dim => {
        const val = customData[dim.name];
        if (dimensionAggregates[dim.name] && dimensionAggregates[dim.name][val]) {
          dimensionAggregates[dim.name][val].attendedInActive++;
        }
      });
    }

    if (!options.summaryOnly) {
      attendees.push({
        ticketId: ticketId,
        name: name,
        email: email,
        phone: phone,
        totalHadir: totalHadirVal,
        custom: customData,
        sessions: attendeeSessions
      });
    }
  }

  // Hitung persentase kehadiran per sesi
  allSessions.forEach(s => {
    const summary = sessionSummaries[s.id];
    summary.absent = Math.max(0, summary.totalRegistered - summary.attended);
    summary.rate = summary.totalRegistered > 0 
      ? Math.round((summary.attended / summary.totalRegistered) * 1000) / 10 
      : 0;
  });

  // Komparasi Antar Sesi (jika compareSessionId dipilih)
  let sessionComparison = null;
  if (activeSessionId && compareSessionId && activeSessionId !== compareSessionId) {
    let bothAttended = 0;
    let onlyActive = 0;
    let onlyCompare = 0;
    let neither = 0;

    attendees.forEach(att => {
      const act = att.sessions[activeSessionId] && att.sessions[activeSessionId].status !== "BELUM_HADIR";
      const cmp = att.sessions[compareSessionId] && att.sessions[compareSessionId].status !== "BELUM_HADIR";

      if (act && cmp) bothAttended++;
      else if (act && !cmp) onlyActive++;
      else if (!act && cmp) onlyCompare++;
      else neither++;
    });

    sessionComparison = {
      activeSessionId,
      compareSessionId,
      bothAttended,
      onlyActive,      // Peserta Baru di Sesi Ini
      onlyCompare,     // Peserta Sesi Kemarin yang Drop / Belum Hadir
      neither
    };
  }

  return {
    meta: {
      eventName: getEventName(),
      totalParticipants: rawValues.length - 1,
      activeSessionId: activeSessionId,
      compareSessionId: compareSessionId
    },
    columns: columnSchema.allColumns,
    dimensions: columnSchema.dimensions,
    detectedGenderCol: columnSchema.genderColName,
    sessions: allSessions,
    sessionSummaries: sessionSummaries,
    dimensionAggregates: dimensionAggregates,
    sessionComparison: sessionComparison,
    attendees: attendees
  };
}

/**
 * Deteksi cerdas peran setiap kolom pada header "Data Peserta"
 */
function analyzeColumnSchema(sheetPeserta, headers) {
  let ticketCol = 0;
  let nameCol = 1;
  let totalCol = -1;
  let emailCol = -1;
  let phoneCol = -1;

  const dimensions = [];
  const allColumns = [];

  // Cek dropdown validation jika ada di spreadsheet
  let validations = null;
  try {
    if (sheetPeserta.getLastRow() >= 2) {
      validations = sheetPeserta.getRange(2, 1, 1, headers.length).getDataValidations()[0];
    }
  } catch (e) {
    // Abaikan error validasi
  }

  headers.forEach((h, idx) => {
    const rawHeader = String(h || "").trim();
    if (!rawHeader) return;

    const lower = rawHeader.toLowerCase();
    let role = "dimension"; // Default kategori pengelompokan

    const isTicket = lower.includes("ticket") || lower === "id" || lower.includes("id tiket");
    const isName = lower.includes("nama") && !lower.includes("instansi");
    const isTotal = lower.includes("total") || lower.includes("jumlah hadir");
    const isEmail = lower.includes("email");
    const isPhone = lower.includes("wa") || lower.includes("whatsapp") || lower.includes("hp") || lower.includes("telepon") || lower.includes("kontak");
    const isDrive = lower.includes("drive") || lower.includes("file id") || lower.includes("file url");
    const isTimestamp = lower.includes("timestamp") || lower.includes("waktu daftar") || lower.includes("tanggal daftar");
    const isSession = lower.startsWith("sesi:") || (lower.includes("[") && lower.includes("]"));

    if (isTicket) {
      ticketCol = idx;
      role = "ticketId";
    } else if (isName && nameCol === 1) {
      nameCol = idx;
      role = "name";
    } else if (isTotal) {
      totalCol = idx;
      role = "totalHadir";
    } else if (isEmail) {
      emailCol = idx;
      role = "email";
    } else if (isPhone) {
      phoneCol = idx;
      role = "phone";
    } else if (isDrive || isTimestamp) {
      role = "systemIgnore";
    } else if (isSession) {
      role = "session";
    }

    let validationOptions = [];
    if (validations && validations[idx]) {
      try {
        const rule = validations[idx];
        if (rule && rule.getCriteriaType() === SpreadsheetApp.DataValidationCriteria.VALUE_IN_LIST) {
          validationOptions = rule.getCriteriaValues()[0] || [];
        }
      } catch (valErr) {}
    }

    const colObj = {
      index: idx,
      name: rawHeader,
      role: role,
      options: validationOptions
    };

    allColumns.push(colObj);

    if (role === "dimension") {
      dimensions.push({
        colIdx: idx,
        name: rawHeader,
        options: validationOptions
      });
    }
  });

  // Deteksi cerdas kolom Gender jika ada
  let genderColName = "";
  dimensions.forEach(d => {
    const l = d.name.toLowerCase();
    if (!genderColName && (l.includes("gender") || l.includes("jenis kelamin") || l.includes("kelamin") || l.includes("ikhwan") || l.includes("pria") || l === "l/p")) {
      genderColName = d.name;
    }
  });

  return {
    ticketCol,
    nameCol,
    totalCol,
    emailCol,
    phoneCol,
    genderColName,
    dimensions,
    allColumns
  };
}

/**
 * Normalisasi format waktu (e.g. "07:14:22" atau "7:14") menjadi slot 15-menit atau 30-menit
 * Output contoh: "07:15"
 */
function normalizeTimeSlot(timeStr) {
  if (!timeStr) return null;
  // Deteksi format jam:menit
  const match = String(timeStr).match(/(\d{1,2}):(\d{2})/);
  if (!match) return null;

  let hour = parseInt(match[1], 10);
  let minute = parseInt(match[2], 10);

  // Bulatkan ke slot 15 menit terdekat
  let slotMin = Math.floor(minute / 15) * 15;
  const pad = (n) => String(n).padStart(2, "0");

  return `${pad(hour)}:${pad(slotMin)}`;
}

/**
 * Helper: Ambil daftar sesi langsung dari tab "Master Sesi" jika ada
 */
function fetchSessionsFromMasterSesi(ss) {
  const masterSheetName = (typeof CONFIG !== "undefined" && CONFIG.SHEETS && CONFIG.SHEETS.MASTER_SESI)
    ? CONFIG.SHEETS.MASTER_SESI
    : "Master Sesi";

  const sheetSesi = ss.getSheetByName(masterSheetName);
  if (!sheetSesi || sheetSesi.getLastRow() < 2) {
    return [];
  }

  const values = sheetSesi.getDataRange().getValues();
  const sessions = [];

  for (let r = 1; r < values.length; r++) {
    const sId = String(values[r][0] || "").trim();
    if (!sId) continue;
    sessions.push({
      id: sId,
      name: String(values[r][1] || sId).trim(),
      date: String(values[r][2] || "").trim(),
      status: String(values[r][3] || "AKTIF").trim().toUpperCase(),
      type: String(values[r][4] || "SINGLE").trim().toUpperCase()
    });
  }

  return sessions;
}

/**
 * Helper: Ambil nama event
 */
function getEventName() {
  if (typeof CONFIG !== "undefined" && CONFIG.EVENT_NAME) {
    return CONFIG.EVENT_NAME;
  }
  try {
    return SpreadsheetApp.getActiveSpreadsheet().getName();
  } catch (e) {
    return "Event Attendance System";
  }
}

/**
 * Helper: Output JSON response
 */
function createDashboardJsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
