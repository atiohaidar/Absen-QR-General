/**
 * ==============================================================================
 * EVENTPASS • SIMPLIFIED DASHBOARD CONTROLLER (js/dashboard.js)
 * ==============================================================================
 * Designed specifically for non-technical users. Focuses on:
 * 1. Total Sudah Hadir vs Belum Hadir (Besar & Jelas).
 * 2. Pemisahan Hadir & Belum Hadir berdasarkan Gender (Laki-laki / Perempuan)
 *    atau kategori lain secara otomatis dan fleksibel.
 * 3. Filter sederhana dan pencarian instan.
 */

(function () {
  'use strict';

  // Global Dashboard State
  const state = {
    apiUrl: localStorage.getItem("absen_api_url") || "",
    theme: localStorage.getItem("absen_dash_theme") || "light",
    autoRefreshSec: parseInt(localStorage.getItem("absen_dash_refresh") || "30", 10),
    refreshTimer: null,

    // Data from sheet
    sessions: [],
    dimensions: [],
    attendees: [],
    detectedGenderCol: "",

    // Active User Selections
    selectedSessionId: "",
    selectedDimension: "GENDER_AUTO", // GENDER_AUTO, NONE, or custom column name
    statusFilter: "ALL",              // ALL, HADIR, BELUM_HADIR
    drilldownValue: "",               // Clicked category filter (e.g. "Laki-laki")
    searchQuery: "",

    // Pagination & Sorting
    currentPage: 1,
    rowsPerPage: 15,
    sortColumn: "no",     // 'no', 'name', 'ticketId', 'gender', 'category', 'status', 'time'
    sortDirection: "asc", // 'asc' | 'desc'
    isLoading: false,

    // Active Tab Navigation
    activeTab: "live", // "live" or "history"

    // Chart.js instances & view modes
    arrivalChart: null,
    historyChart: null,
    arrivalChartMode: "CATEGORY", // "ALL" or "CATEGORY" (supports gender & any active category)
    historyChartMode: "CATEGORY", // "ALL" or "CATEGORY"
    lastSessionList: [],
    sessionSummaries: {}
  };

  // ============================================================================
  // GENDER & CATEGORY CLASSIFICATION HELPERS
  // ============================================================================
  function isGenderDimension(name) {
    if (!name) return false;
    const l = name.toLowerCase();
    return l.includes("gender") || l.includes("jenis kelamin") || l.includes("kelamin") || l.includes("ikhwan") || l.includes("pria") || l === "l/p";
  }

  function getAttendeeCategoryValue(att, dimName) {
    if (!dimName) return "Semua";
    if (isGenderDimension(dimName)) {
      return getAttendeeGender(att);
    }
    return (att.custom && att.custom[dimName]) ? String(att.custom[dimName]).trim() || "Tidak Diisi" : "Tidak Diisi";
  }

  function getCategoryPalette(categories, isDark, isGender) {
    if (isGender) {
      return {
        "Laki-laki": {
          line: isDark ? "#60a5fa" : "#2563eb",
          bg: isDark ? "rgba(96, 165, 250, 0.22)" : "rgba(37, 99, 235, 0.12)"
        },
        "Perempuan": {
          line: isDark ? "#fb7185" : "#e11d48",
          bg: isDark ? "rgba(251, 113, 133, 0.22)" : "rgba(225, 29, 72, 0.12)"
        }
      };
    }

    const paletteList = isDark ? [
      { line: "#34d399", bg: "rgba(52, 211, 153, 0.20)" }, // Mint
      { line: "#60a5fa", bg: "rgba(96, 165, 250, 0.20)" }, // Blue
      { line: "#fb7185", bg: "rgba(251, 113, 133, 0.20)" }, // Rose
      { line: "#fbbf24", bg: "rgba(251, 191, 36, 0.20)" },  // Amber
      { line: "#a78bfa", bg: "rgba(167, 139, 250, 0.20)" }, // Purple
      { line: "#38bdf8", bg: "rgba(56, 189, 248, 0.20)" }   // Cyan
    ] : [
      { line: "#0d532d", bg: "rgba(13, 83, 45, 0.12)" },   // Forest Green (Primary)
      { line: "#62b32b", bg: "rgba(98, 179, 43, 0.12)" },   // Spring Leaf (Accent)
      { line: "#2563eb", bg: "rgba(37, 99, 235, 0.12)" },   // Blue
      { line: "#d97706", bg: "rgba(217, 119, 6, 0.12)" },   // Amber
      { line: "#e11d48", bg: "rgba(225, 29, 72, 0.12)" },   // Rose
      { line: "#7c3aed", bg: "rgba(124, 58, 237, 0.12)" }   // Purple
    ];

    const map = {};
    categories.forEach((cat, idx) => {
      map[cat] = paletteList[idx % paletteList.length];
    });
    return map;
  }

  function getGenderCol() {
    if (state.detectedGenderCol) return state.detectedGenderCol;
    if (!state.attendees || state.attendees.length === 0) return "";
    const col = findGenderColumnName(state.dimensions);
    if (col) {
      state.detectedGenderCol = col;
      return col;
    }
    const first = state.attendees[0];
    if (first && first.custom) {
      const keys = Object.keys(first.custom);
      for (const k of keys) {
        const l = k.toLowerCase();
        if (l.includes("gender") || l.includes("jenis kelamin") || l.includes("kelamin") || l.includes("ikhwan") || l.includes("pria") || l === "l/p") {
          state.detectedGenderCol = k;
          return k;
        }
      }
    }
    return "";
  }

  function classifyGender(rawVal) {
    if (!rawVal) return "Lainnya";
    const str = String(rawVal).trim().toLowerCase();
    if (str.startsWith("l") || str.startsWith("pria") || str.includes("ikhwan") || str.startsWith("m") || str.includes("laki") || str.includes("cowok")) {
      return "Laki-laki";
    }
    if (str.startsWith("p") || str.startsWith("wanita") || str.includes("akhwat") || str.startsWith("f") || str.includes("perempuan") || str.includes("cewek")) {
      return "Perempuan";
    }
    return String(rawVal).trim() || "Lainnya";
  }

  function getAttendeeGender(att) {
    const col = getGenderCol();
    if (!col || !att.custom) return "Lainnya";
    return classifyGender(att.custom[col]);
  }

  function calculateGenderStats(attendeeList, sessionId) {
    const col = getGenderCol();
    let maleTotal = 0;
    let femaleTotal = 0;
    let otherTotal = 0;
    let maleAttended = 0;
    let femaleAttended = 0;
    let otherAttended = 0;
    let maleInLocation = 0;
    let femaleInLocation = 0;
    let maleCheckedOut = 0;
    let femaleCheckedOut = 0;

    attendeeList.forEach(att => {
      const g = getAttendeeGender(att);
      const sess = att.sessions[sessionId];
      const isAttended = sess && (sess.status === "HADIR" || sess.status === "CHECKOUT");
      const isCheckedOut = sess && sess.status === "CHECKOUT";
      const isInLocation = sess && sess.status === "HADIR";

      if (g === "Laki-laki") {
        maleTotal++;
        if (isAttended) {
          maleAttended++;
          if (isCheckedOut) maleCheckedOut++;
          if (isInLocation) maleInLocation++;
        }
      } else if (g === "Perempuan") {
        femaleTotal++;
        if (isAttended) {
          femaleAttended++;
          if (isCheckedOut) femaleCheckedOut++;
          if (isInLocation) femaleInLocation++;
        }
      } else {
        otherTotal++;
        if (isAttended) otherAttended++;
      }
    });

    const maleAbsent = Math.max(0, maleTotal - maleAttended);
    const femaleAbsent = Math.max(0, femaleTotal - femaleAttended);

    const maleAttendedPct = maleTotal > 0 ? ((maleAttended / maleTotal) * 100).toFixed(1) : "0";
    const femaleAttendedPct = femaleTotal > 0 ? ((femaleAttended / femaleTotal) * 100).toFixed(1) : "0";

    return {
      hasGender: Boolean(col && (maleTotal > 0 || femaleTotal > 0)),
      genderCol: col,
      maleTotal,
      femaleTotal,
      otherTotal,
      maleAttended,
      femaleAttended,
      otherAttended,
      maleInLocation,
      femaleInLocation,
      maleCheckedOut,
      femaleCheckedOut,
      maleAbsent,
      femaleAbsent,
      maleAttendedPct,
      femaleAttendedPct
    };
  }

  // ============================================================================
  // INITIALIZATION
  // ============================================================================
  function initDashboard() {
    // 1. URL parameter check & reset trigger
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get("reset") === "1" || urlParams.get("clear") === "1") {
      state.apiUrl = "";
      localStorage.removeItem("absen_api_url");
    }
    const paramApi = urlParams.get("apiUrl");
    if (paramApi) {
      state.apiUrl = paramApi;
      localStorage.setItem("absen_api_url", paramApi);
    }

    // 2. Setup theme
    applyTheme(state.theme);

    // 3. Register DOM Listeners
    initListeners();

    // 4. Fetch data
    fetchDashboardData(false);

    // 5. Setup auto-refresh
    setupRefreshTimer();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initDashboard);
  } else {
    initDashboard();
  }

  function applyTheme(themeName) {
    state.theme = themeName;
    localStorage.setItem("absen_dash_theme", themeName);
    if (themeName === "dark") {
      document.body.classList.add("theme-dark");
    } else {
      document.body.classList.remove("theme-dark");
    }
    const themeBtnLabel = document.getElementById("theme-btn-label");
    if (themeBtnLabel) {
      themeBtnLabel.textContent = themeName === "dark" ? "Ganti ke Mode Terang" : "Ganti ke Mode Gelap";
    }
    if (state.arrivalChart) {
      renderArrivalHoursChart(true);
    }
    if (state.historyChart) {
      renderHistoryView(true);
    }
  }

  function initListeners() {
    // Primary Tab Switcher (Live vs History)
    const tabBtnLive = document.getElementById("tab-btn-live");
    const tabBtnHistory = document.getElementById("tab-btn-history");
    if (tabBtnLive) {
      tabBtnLive.addEventListener("click", () => switchActiveTab("live"));
    }
    if (tabBtnHistory) {
      tabBtnHistory.addEventListener("click", () => switchActiveTab("history"));
    }

    // Refresh button
    const btnRefresh = document.getElementById("btn-refresh");
    if (btnRefresh) {
      btnRefresh.addEventListener("click", () => fetchDashboardData(true));
    }

    // Session dropdown
    const selectSession = document.getElementById("select-session");
    if (selectSession) {
      selectSession.addEventListener("change", (e) => {
        state.selectedSessionId = e.target.value;
        state.currentPage = 1;
        updateView();
      });
    }

    // Category / Dimension dropdowns (Live & Riwayat Sesi)
    const selectDimension = document.getElementById("select-dimension");
    const selectHistDimension = document.getElementById("select-hist-dimension");

    function handleDimensionSelection(val) {
      state.selectedDimension = val;
      state.drilldownValue = ""; // reset drilldown
      state.currentPage = 1;

      if (selectDimension && selectDimension.value !== val) selectDimension.value = val;
      if (selectHistDimension && selectHistDimension.value !== val) selectHistDimension.value = val;

      if (state.activeTab === "history") {
        renderHistoryView(true);
      } else {
        updateView();
      }
    }

    if (selectDimension) {
      selectDimension.addEventListener("change", (e) => handleDimensionSelection(e.target.value));
    }
    if (selectHistDimension) {
      selectHistDimension.addEventListener("change", (e) => handleDimensionSelection(e.target.value));
    }

    // Toggle Mode Grafik Arus Kedatangan (Semua vs Pisah Kategori)
    const btnArrivalModeAll = document.getElementById("btn-arrival-mode-all");
    const btnArrivalModeGender = document.getElementById("btn-arrival-mode-gender");
    if (btnArrivalModeAll) {
      btnArrivalModeAll.addEventListener("click", () => {
        if (state.arrivalChartMode === "ALL") return;
        state.arrivalChartMode = "ALL";
        renderArrivalHoursChart(true);
      });
    }
    if (btnArrivalModeGender) {
      btnArrivalModeGender.addEventListener("click", () => {
        if (state.arrivalChartMode === "CATEGORY") return;
        state.arrivalChartMode = "CATEGORY";
        renderArrivalHoursChart(true);
      });
    }



    // Search input (Realtime)
    const searchInput = document.getElementById("dash-search-input");
    if (searchInput) {
      let timeout;
      searchInput.addEventListener("input", (e) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => {
          state.searchQuery = e.target.value.trim().toLowerCase();
          state.currentPage = 1;
          renderTable();
        }, 200);
      });
    }

    // Filter tabs (Semua, Sudah Hadir, Belum Hadir)
    const filterTabs = document.querySelectorAll(".dash-filter-tab");
    filterTabs.forEach(tab => {
      tab.addEventListener("click", () => {
        filterTabs.forEach(t => t.classList.remove("active"));
        tab.classList.add("active");
        state.statusFilter = tab.getAttribute("data-status");
        state.currentPage = 1;
        renderTable();
      });
    });

    // Reset drilldown button
    const btnResetBreakdown = document.getElementById("btn-reset-breakdown-filter");
    const btnClearDrilldown = document.getElementById("btn-clear-drilldown");
    [btnResetBreakdown, btnClearDrilldown].forEach(btn => {
      if (btn) {
        btn.addEventListener("click", () => {
          state.drilldownValue = "";
          state.currentPage = 1;
          updateView();
        });
      }
    });

    // Pagination
    const btnPrev = document.getElementById("btn-prev-page");
    const btnNext = document.getElementById("btn-next-page");
    if (btnPrev) {
      btnPrev.addEventListener("click", () => {
        if (state.currentPage > 1) {
          state.currentPage--;
          renderTable();
        }
      });
    }
    if (btnNext) {
      btnNext.addEventListener("click", () => {
        const total = getFilteredAttendees().length;
        const maxPage = Math.ceil(total / state.rowsPerPage) || 1;
        if (state.currentPage < maxPage) {
          state.currentPage++;
          renderTable();
        }
      });
    }

    // Export CSV
    const btnExport = document.getElementById("btn-export-csv");
    if (btnExport) {
      btnExport.addEventListener("click", exportCsv);
    }

    // Settings Modal
    const btnOpenSettings = document.getElementById("btn-open-settings-menu");
    const modalSettings = document.getElementById("modal-settings");
    const btnCloseSettings = document.getElementById("btn-close-settings");
    const btnSaveSettings = document.getElementById("btn-save-settings");
    const inputApi = document.getElementById("cfg-api-url-input");
    const selectRefresh = document.getElementById("select-refresh-interval");
    const btnToggleTheme = document.getElementById("btn-toggle-theme");

    if (btnOpenSettings && modalSettings) {
      btnOpenSettings.addEventListener("click", () => {
        if (inputApi) inputApi.value = state.apiUrl || "";
        if (selectRefresh) selectRefresh.value = String(state.autoRefreshSec);
        modalSettings.classList.add("open");
      });
    }
    if (btnCloseSettings && modalSettings) {
      btnCloseSettings.addEventListener("click", () => modalSettings.classList.remove("open"));
    }
    const btnClearApi = document.getElementById("btn-clear-api-url");
    if (btnClearApi && inputApi) {
      btnClearApi.addEventListener("click", () => {
        inputApi.value = "";
        state.apiUrl = "";
        localStorage.removeItem("absen_api_url");
        if (modalSettings) modalSettings.classList.remove("open");
        fetchDashboardData(true);
      });
    }
    if (btnToggleTheme) {
      btnToggleTheme.addEventListener("click", () => {
        applyTheme(state.theme === "dark" ? "light" : "dark");
      });
    }
    if (btnSaveSettings && modalSettings) {
      btnSaveSettings.addEventListener("click", () => {
        if (inputApi) {
          state.apiUrl = inputApi.value.trim();
          localStorage.setItem("absen_api_url", state.apiUrl);
        }
        if (selectRefresh) {
          state.autoRefreshSec = parseInt(selectRefresh.value, 10);
          localStorage.setItem("absen_dash_refresh", String(state.autoRefreshSec));
          setupRefreshTimer();
        }
        modalSettings.classList.remove("open");
        fetchDashboardData(true);
      });
    }
  }

  // ============================================================================
  // AUTO REFRESH
  // ============================================================================
  function setupRefreshTimer() {
    if (state.refreshTimer) clearInterval(state.refreshTimer);
    if (state.autoRefreshSec <= 0) return;

    state.refreshTimer = setInterval(() => {
      fetchDashboardData(false);
    }, state.autoRefreshSec * 1000);
  }

  // ============================================================================
  // DATA FETCHING
  // ============================================================================
  async function fetchDashboardData(forceRefresh = false) {
    const btnRefresh = document.getElementById("btn-refresh");
    const syncDot = document.getElementById("sync-live-dot");
    const syncText = document.getElementById("sync-live-text");

    if (btnRefresh) btnRefresh.style.opacity = "0.6";
    if (syncText) syncText.textContent = "Menyinkronkan...";

    state.isLoading = true;

    try {
      let data = null;

      if (!state.apiUrl) {
        // Tanpa URL API: Kosongkan data, jangan gunakan data dummy
        data = {
          success: true,
          meta: { eventName: "Absen QR General" },
          sessions: [],
          dimensions: [],
          attendees: [],
          sessionSummaries: {}
        };
        if (syncDot) syncDot.style.backgroundColor = "var(--dash-text-dim, #94a3b8)";
        if (syncText) syncText.textContent = "API Belum Diatur";
      } else {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 8000);
          const url = `${state.apiUrl}${state.apiUrl.includes('?') ? '&' : '?'}action=getDashboardData&forceRefresh=${forceRefresh}&t=${Date.now()}`;
          const resp = await fetch(url, { signal: controller.signal });
          clearTimeout(timeoutId);
          const text = await resp.text();
          data = JSON.parse(text);

          if (!data.success) {
            throw new Error(data.message || "Gagal mengambil data presensi.");
          }

          if (syncDot) syncDot.style.backgroundColor = "var(--dash-green)";
          if (syncText) {
            const timeStr = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
            syncText.textContent = `Realtime (${timeStr})`;
          }
        } catch (fetchErr) {
          console.warn("[Dashboard API warning] Backend offline/error:", fetchErr);
          data = {
            success: false,
            meta: { eventName: "Absen QR General" },
            sessions: [],
            dimensions: [],
            attendees: [],
            sessionSummaries: {}
          };
          if (syncDot) syncDot.style.backgroundColor = "var(--dash-red, #ef4444)";
          if (syncText) syncText.textContent = "Koneksi Terputus / API Bermasalah";
        }
      }

      state.sessions = data.sessions || [];
      state.dimensions = (data.dimensions || []).filter(d => !isSensitiveDimension(d.name));
      state.attendees = data.attendees || [];
      state.detectedGenderCol = data.detectedGenderCol || findGenderColumnName(state.dimensions);
      state.sessionSummaries = data.sessionSummaries || {};

      const badgeHistoryCount = document.getElementById("badge-history-count");
      if (badgeHistoryCount) {
        badgeHistoryCount.textContent = `${state.sessions.length} Sesi`;
      }

      // Set default active session (prioritaskan sesi yang berstatus AKTIF jika ada)
      if (state.sessions.length > 0) {
        if (!state.selectedSessionId || !state.sessions.some(s => s.id === state.selectedSessionId)) {
          const activeSess = state.sessions.find(s => s.status === "AKTIF");
          state.selectedSessionId = activeSess ? activeSess.id : state.sessions[0].id;
        }
      } else {
        state.selectedSessionId = "";
      }

      // Populate Session dropdown
      populateSessionDropdown();

      // Populate Category dropdown
      populateDimensionDropdown();

      // Update View based on active tab
      if (state.activeTab === "history") {
        renderHistoryView();
      } else {
        updateView();
      }

      const eventTitle = document.getElementById("event-title-display");
      if (eventTitle && data.meta && data.meta.eventName) {
        eventTitle.textContent = data.meta.eventName;
      }

    } catch (err) {
      console.error("[Dashboard Fetch Error]", err);
      if (syncDot) syncDot.style.backgroundColor = "var(--dash-red)";
      if (syncText) syncText.textContent = "Offline";
    } finally {
      state.isLoading = false;
      if (btnRefresh) btnRefresh.style.opacity = "1";
    }
  }

  function findGenderColumnName(dimensions) {
    if (!dimensions || dimensions.length === 0) return "";
    for (const d of dimensions) {
      const l = d.name.toLowerCase();
      if (l.includes("gender") || l.includes("jenis kelamin") || l.includes("kelamin") || l.includes("ikhwan") || l.includes("pria") || l === "l/p") {
        return d.name;
      }
    }
    return "";
  }

  function isSensitiveDimension(name) {
    if (!name) return false;
    const l = name.toLowerCase();
    return l.includes("email") || l.includes("wa") || l.includes("whatsapp") || l.includes("hp") ||
           l.includes("telepon") || l.includes("phone") || l.includes("kontak") ||
           l.includes("nim") || l.includes("nik") || l.includes("nrp") || l.includes("npm") ||
           l.includes("nomor induk") || l.includes("no. induk");
  }

  function populateSessionDropdown() {
    const sel = document.getElementById("select-session");
    if (!sel) return;

    const prev = state.selectedSessionId;
    sel.innerHTML = "";

    if (state.sessions.length === 0) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "-- Belum Ada Sesi (Atur API) --";
      sel.appendChild(opt);
      state.selectedSessionId = "";
      return;
    }

    state.sessions.forEach(s => {
      const opt = document.createElement("option");
      opt.value = s.id;
      opt.textContent = `${s.name || s.id}`;
      sel.appendChild(opt);
    });

    if (prev && state.sessions.some(s => s.id === prev)) {
      sel.value = prev;
    } else {
      const activeSess = state.sessions.find(s => s.status === "AKTIF") || state.sessions[0];
      sel.value = activeSess.id;
      state.selectedSessionId = activeSess.id;
    }
  }

  function populateDimensionDropdown() {
    const selects = [
      document.getElementById("select-dimension"),
      document.getElementById("select-hist-dimension")
    ].filter(Boolean);

    if (selects.length === 0) return;

    if (!state.detectedGenderCol && state.dimensions.length === 0) {
      selects.forEach(sel => {
        sel.innerHTML = '<option value="NONE">-- Belum Ada Kategori Data --</option>';
      });
      state.selectedDimension = "NONE";
      return;
    }

    const prev = state.selectedDimension;

    // Prioritaskan Gender jika ada, atau kembalikan pilihan sebelumnya
    let activeVal = "NONE";
    if (prev && (prev === "NONE" || prev === "GENDER_AUTO" || state.dimensions.some(d => d.name === prev))) {
      activeVal = prev;
    } else if (state.detectedGenderCol) {
      activeVal = "GENDER_AUTO";
    } else if (state.dimensions.length > 0) {
      activeVal = state.dimensions[0].name;
    }

    state.selectedDimension = activeVal;

    selects.forEach(sel => {
      sel.innerHTML = "";

      // 1. Opsi Gender Otomatis jika ada
      if (state.detectedGenderCol) {
        const optGender = document.createElement("option");
        optGender.value = "GENDER_AUTO";
        optGender.textContent = `Jenis Kelamin (${state.detectedGenderCol})`;
        sel.appendChild(optGender);
      }

      // 2. Dimensi Lainnya (Instansi, Divisi, dll)
      state.dimensions.forEach(dim => {
        if (dim.name !== state.detectedGenderCol) {
          const opt = document.createElement("option");
          opt.value = dim.name;
          opt.textContent = dim.name;
          sel.appendChild(opt);
        }
      });

      // 3. Opsi Tanpa Pemecahan
      const optNone = document.createElement("option");
      optNone.value = "NONE";
      optNone.textContent = "Semua Peserta (Tanpa Pemecahan)";
      sel.appendChild(optNone);

      sel.value = activeVal;
    });
  }

  // ============================================================================
  // VIEW UPDATES (HERO STATS & BREAKDOWN CARDS)
  // ============================================================================
  function updateView() {
    updateHeroStats();
    renderBreakdownCards();
    renderArrivalHoursChart();
    renderTable();
  }

  function getEffectiveDimensionName() {
    if (state.selectedDimension === "GENDER_AUTO") {
      return state.detectedGenderCol || "";
    }
    if (state.selectedDimension === "NONE") {
      return "";
    }
    return state.selectedDimension;
  }

  function updateHeroStats() {
    const total = state.attendees.length;
    let attended = 0;
    let checkedOut = 0;

    state.attendees.forEach(att => {
      const sess = att.sessions[state.selectedSessionId];
      if (sess) {
        if (sess.status === "HADIR" || sess.status === "CHECKOUT") {
          attended++;
        }
        if (sess.status === "CHECKOUT") {
          checkedOut++;
        }
      }
    });

    const inLocation = Math.max(0, attended - checkedOut);
    const absent = Math.max(0, total - attended);
    const attendedPct = total > 0 ? ((attended / total) * 100).toFixed(1) : "0";
    const absentPct = total > 0 ? ((absent / total) * 100).toFixed(1) : "0";

    // Set DOM numbers
    const elTotal = document.getElementById("kpi-total-registered");
    const elAttended = document.getElementById("kpi-total-attended");
    const elAbsent = document.getElementById("kpi-total-absent");
    const elAttPct = document.getElementById("kpi-attendance-pct");
    const elAbsPct = document.getElementById("kpi-absent-pct");

    if (elTotal) elTotal.textContent = total;
    if (elAttended) elAttended.textContent = attended;
    if (elAbsent) elAbsent.textContent = absent;
    if (elAttPct) elAttPct.textContent = `${attendedPct}%`;
    if (elAbsPct) elAbsPct.textContent = `${absentPct}%`;

    // Progress Bars in Hero Cards
    const kpiProgBar = document.getElementById("kpi-progress-bar");
    if (kpiProgBar) kpiProgBar.style.width = `${attendedPct}%`;

    const kpiAbsBar = document.getElementById("kpi-absent-progress-bar");
    if (kpiAbsBar) kpiAbsBar.style.width = `${absentPct}%`;

    // Subtitle Hero Card: Informasikan jika ada peserta yang checkout
    const elAttendedSub = document.getElementById("kpi-attended-sub");
    if (elAttendedSub) {
      if (checkedOut > 0) {
        elAttendedSub.style.display = "block";
        elAttendedSub.innerHTML = `<strong>${inLocation}</strong> di lokasi &bull; <strong>${checkedOut}</strong> checkout`;
      } else {
        elAttendedSub.style.display = "none";
      }
    }

    // Legacy Fallback if element exists
    const progBar = document.getElementById("main-progress-bar");
    const progText = document.getElementById("progress-summary-text");
    if (progBar) progBar.style.width = `${attendedPct}%`;
    if (progText) progText.textContent = `${attended} dari ${total} orang hadir (${attendedPct}%)`;

    // Tab counts & Dynamic In-Out labels
    const tabAll = document.getElementById("tab-count-all");
    const tabHadir = document.getElementById("tab-count-hadir");
    const tabLabelHadir = document.getElementById("tab-label-hadir");
    const tabBelum = document.getElementById("tab-count-belum");
    const tabBtnCheckout = document.getElementById("tab-btn-checkout");
    const tabCountCheckout = document.getElementById("tab-count-checkout");

    if (tabAll) tabAll.textContent = total;
    if (tabBelum) tabBelum.textContent = absent;

    if (tabLabelHadir) {
      tabLabelHadir.textContent = (checkedOut > 0) ? "Di Lokasi" : "Hadir";
    }
    if (tabHadir) {
      tabHadir.textContent = (checkedOut > 0) ? inLocation : attended;
    }

    if (tabBtnCheckout && tabCountCheckout) {
      if (checkedOut > 0) {
        tabBtnCheckout.style.display = "inline-flex";
        tabCountCheckout.textContent = checkedOut;
      } else {
        tabBtnCheckout.style.display = "none";
        if (state.statusFilter === "CHECKOUT") {
          state.statusFilter = "ALL";
          document.querySelectorAll(".dash-filter-tab").forEach(t => {
            t.classList.toggle("active", t.getAttribute("data-status") === "ALL");
          });
        }
      }
    }

    // Gender Mini Pills in Hero Cards (Clean, no emojis)
    const gStats = calculateGenderStats(state.attendees, state.selectedSessionId);
    const elPillsTotal = document.getElementById("kpi-total-gender-pills");
    const elPillsAttended = document.getElementById("kpi-attended-gender-pills");
    const elPillsAbsent = document.getElementById("kpi-absent-gender-pills");

    if (gStats.hasGender) {
      if (elPillsTotal) {
        elPillsTotal.style.display = "flex";
        elPillsTotal.innerHTML = `
          <span class="dash-gender-mini-pill neutral">L: ${gStats.maleTotal}</span>
          <span class="dash-gender-mini-pill neutral">P: ${gStats.femaleTotal}</span>
        `;
      }
      if (elPillsAttended) {
        elPillsAttended.style.display = "flex";
        const hasCheckout = (gStats.maleCheckedOut > 0 || gStats.femaleCheckedOut > 0);
        const maleText = hasCheckout
          ? `L: ${gStats.maleAttended} (${gStats.maleInLocation} lokasi &bull; ${gStats.maleCheckedOut} out)`
          : `L: ${gStats.maleAttended} (${gStats.maleAttendedPct}%)`;
        const femaleText = hasCheckout
          ? `P: ${gStats.femaleAttended} (${gStats.femaleInLocation} lokasi &bull; ${gStats.femaleCheckedOut} out)`
          : `P: ${gStats.femaleAttended} (${gStats.femaleAttendedPct}%)`;

        elPillsAttended.innerHTML = `
          <span class="dash-gender-mini-pill male">${maleText}</span>
          <span class="dash-gender-mini-pill female">${femaleText}</span>
        `;
      }
      if (elPillsAbsent) {
        elPillsAbsent.style.display = "flex";
        elPillsAbsent.innerHTML = `
          <span class="dash-gender-mini-pill male">L: ${gStats.maleAbsent}</span>
          <span class="dash-gender-mini-pill female">P: ${gStats.femaleAbsent}</span>
        `;
      }
    } else {
      if (elPillsTotal) elPillsTotal.style.display = "none";
      if (elPillsAttended) elPillsAttended.style.display = "none";
      if (elPillsAbsent) elPillsAbsent.style.display = "none";
    }
  }

  function renderBreakdownCards() {
    const section = document.getElementById("category-breakdown-section");
    const grid = document.getElementById("category-cards-grid");
    const titleEl = document.getElementById("breakdown-section-title");
    const btnReset = document.getElementById("btn-reset-breakdown-filter");

    if (!section || !grid) return;

    const dimName = getEffectiveDimensionName();

    if (!dimName || state.attendees.length === 0) {
      section.style.display = "none";
      return;
    }

    section.style.display = "flex";
    if (titleEl) {
      titleEl.textContent = `Rincian Kehadiran Berdasarkan ${dimName}`;
    }
    if (btnReset) {
      btnReset.style.display = state.drilldownValue ? "inline-flex" : "none";
    }

    // Grouping
    const groups = {}; // { [groupName]: { total: 0, attended: 0, inLocation: 0, checkedOut: 0 } }
    state.attendees.forEach(att => {
      const val = getAttendeeCategoryValue(att, dimName);
      if (!groups[val]) groups[val] = { total: 0, attended: 0, inLocation: 0, checkedOut: 0 };
      groups[val].total++;

      const sess = att.sessions[state.selectedSessionId];
      if (sess) {
        if (sess.status === "HADIR") {
          groups[val].attended++;
          groups[val].inLocation++;
        } else if (sess.status === "CHECKOUT") {
          groups[val].attended++;
          groups[val].checkedOut++;
        }
      }
    });

    const categories = Object.keys(groups).sort((a, b) => groups[b].total - groups[a].total);
    const hasAnyCheckoutInSession = categories.some(cat => groups[cat].checkedOut > 0);

    const cardsHtml = categories.map(cat => {
      const g = groups[cat];
      const absent = Math.max(0, g.total - g.attended);
      const rate = g.total > 0 ? ((g.attended / g.total) * 100).toFixed(1) : 0;
      const isSelected = (state.drilldownValue === cat);

      const splitRowHtml = hasAnyCheckoutInSession
        ? `<div class="dash-group-split-row">
             <span class="dash-group-sub-pill in-loc" title="Sedang berada di lokasi acara">
               Di Lokasi: <strong>${g.inLocation}</strong>
             </span>
             <span class="dash-group-sub-pill out" title="Sudah melakukan checkout kepulangan">
               Checkout: <strong>${g.checkedOut}</strong>
             </span>
           </div>`
        : '';

      return `
        <div class="dash-group-card ${isSelected ? 'active-selected' : ''}" onclick="window.EventPassSimple.selectGroup('${escapeJs(cat)}')" title="${isSelected ? 'Klik untuk menghapus filter' : 'Klik untuk menyaring tabel'}">
          <div class="dash-group-header">
            <span class="dash-group-name">${escapeHtml(cat)}</span>
            <div class="dash-group-badges">
              <span class="dash-group-total">${g.total} Peserta</span>
              <span class="dash-group-filter-pill ${isSelected ? 'active' : ''}">
                ${isSelected ? 'Aktif' : 'Filter'}
              </span>
            </div>
          </div>

          <div class="dash-group-stats-row">
            <div class="dash-group-metric">
              <span class="dash-group-metric-val green">${g.attended}</span>
              <span class="dash-group-metric-label">Hadir (${rate}%)</span>
            </div>
            <div class="dash-group-metric" style="text-align: right;">
              <span class="dash-group-metric-val amber">${absent}</span>
              <span class="dash-group-metric-label">Belum Hadir</span>
            </div>
          </div>

          <div class="dash-mini-progress">
            <div class="dash-mini-bar" style="width: ${rate}%;"></div>
          </div>

          ${splitRowHtml}
        </div>
      `;
    }).join("");

    grid.innerHTML = cardsHtml;
  }

  // ============================================================================
  // ARUS KEDATANGAN (JAM PALING BANYAK HADIR SESUAI KATEGORI AKTIF)
  // ============================================================================
  function renderArrivalHoursChart(forceRecreate = false) {
    const ctx = document.getElementById("chart-arrival-hours");
    const peakBadge = document.getElementById("peak-arrival-badge");
    const subEl = document.getElementById("arrival-chart-sub");
    if (!ctx) return;

    if (state.attendees.length === 0) {
      if (chartInstances.arrivalHours) {
        chartInstances.arrivalHours.destroy();
        chartInstances.arrivalHours = null;
      }
      ctx.style.display = "none";
      if (peakBadge) peakBadge.style.display = "none";
      let emptyMsg = document.getElementById("chart-arrival-empty-msg");
      if (!emptyMsg) {
        emptyMsg = document.createElement("div");
        emptyMsg.id = "chart-arrival-empty-msg";
        emptyMsg.style.cssText = "text-align: center; padding: 44px 16px; color: var(--dash-text-muted); font-size: 0.85rem;";
        ctx.parentElement.appendChild(emptyMsg);
      }
      emptyMsg.innerHTML = `<div style="font-weight: 600; margin-bottom: 4px; color: var(--dash-text-main);">Belum Ada Data Arus Kedatangan</div><div>Data grafik akan muncul saat peserta mulai memindai tiket.</div>`;
      emptyMsg.style.display = "block";
      return;
    }

    const emptyArrivalMsg = document.getElementById("chart-arrival-empty-msg");
    if (emptyArrivalMsg) emptyArrivalMsg.style.display = "none";
    ctx.style.display = "block";

    const dimName = getEffectiveDimensionName();
    const isGender = isGenderDimension(dimName);
    const hasCategory = Boolean(dimName);

    // Jika tidak ada pemecahan kategori (NONE), paksa ke mode ALL
    if (!hasCategory) {
      state.arrivalChartMode = "ALL";
    }

    // Perbarui Tombol Toggle View Mode
    const toggleGroup = document.getElementById("arrival-chart-toggle-group");
    const btnAll = document.getElementById("btn-arrival-mode-all");
    const btnCat = document.getElementById("btn-arrival-mode-gender");
    const btnLabel = document.getElementById("btn-arrival-mode-label");

    if (toggleGroup) {
      toggleGroup.style.display = hasCategory ? "inline-flex" : "none";
    }
    if (btnLabel && hasCategory) {
      if (isGender) {
        btnLabel.textContent = "Pisah Gender (L / P)";
      } else {
        btnLabel.textContent = `Pecah: ${dimName.length > 14 ? dimName.slice(0, 12) + "..." : dimName}`;
      }
    }
    if (btnAll) btnAll.classList.toggle("active", state.arrivalChartMode === "ALL");
    if (btnCat) btnCat.classList.toggle("active", state.arrivalChartMode !== "ALL");

    // Perbarui Subtitle Deskripsi Grafik
    if (subEl) {
      if (state.arrivalChartMode === "ALL" || !hasCategory) {
        subEl.textContent = "Melihat tren jam berapa seluruh peserta paling banyak datang dan memindai tiket";
      } else {
        const focusText = state.drilldownValue ? ` • Fokus: ${state.drilldownValue}` : "";
        subEl.textContent = `Melihat tren naik-turun jam kedatangan berdasarkan kelompok aktif: ${dimName}${focusText}`;
      }
    }

    // Kumpulkan waktu check-in beserta nilai kategori aktif tiap peserta
    const checkIns = [];
    const categoryTotals = {};
    state.attendees.forEach(att => {
      const sess = att.sessions[state.selectedSessionId];
      if (sess && (sess.status === "HADIR" || sess.status === "CHECKOUT") && sess.checkInTime) {
        const match = String(sess.checkInTime).match(/(\d{1,2}):(\d{2})/);
        if (match) {
          const hour = parseInt(match[1], 10);
          const minute = parseInt(match[2], 10);
          const catVal = getAttendeeCategoryValue(att, dimName);
          checkIns.push({ min: hour * 60 + minute, cat: catVal });
          categoryTotals[catVal] = (categoryTotals[catVal] || 0) + 1;
        }
      }
    });

    // Tentukan daftar kategori yang akan dirender (maksimal 5 kategori teratas agar kurva tetap bersih)
    let activeCategories = [];
    if (isGender) {
      activeCategories = ["Laki-laki", "Perempuan"];
      Object.keys(categoryTotals).forEach(k => {
        if (k !== "Laki-laki" && k !== "Perempuan" && categoryTotals[k] > 0) {
          activeCategories.push(k);
        }
      });
    } else if (hasCategory) {
      activeCategories = Object.keys(categoryTotals).sort((a, b) => (categoryTotals[b] || 0) - (categoryTotals[a] || 0));
      if (activeCategories.length > 5) {
        activeCategories = activeCategories.slice(0, 5);
      }
    }

    let labels = [];
    let allBuckets = {};
    const categoryBuckets = {};
    activeCategories.forEach(cat => {
      categoryBuckets[cat] = {};
    });

    let maxAllSlot = "";
    let maxAllCount = 0;
    const categoryPeaks = {};

    if (checkIns.length > 0) {
      checkIns.sort((a, b) => a.min - b.min);
      const spanMin = checkIns[checkIns.length - 1].min - checkIns[0].min;

      let stepMin = 15;
      if (spanMin <= 90) {
        stepMin = 5;
      } else if (spanMin > 600) {
        stepMin = 30;
      }

      const minMin = Math.max(0, Math.floor(checkIns[0].min / stepMin) * stepMin - stepMin);
      const maxMin = Math.min(1440 - stepMin, Math.ceil(checkIns[checkIns.length - 1].min / stepMin) * stepMin + stepMin);

      // Inisialisasi slot kontinu
      for (let m = minMin; m <= maxMin; m += stepMin) {
        const hStr = String(Math.floor(m / 60)).padStart(2, "0");
        const mStr = String(m % 60).padStart(2, "0");
        const slotKey = `${hStr}:${mStr}`;
        allBuckets[slotKey] = 0;
        activeCategories.forEach(cat => {
          categoryBuckets[cat][slotKey] = 0;
        });
      }

      // Hitung akumulasi kedatangan pada tiap slot
      checkIns.forEach(c => {
        const slotM = Math.floor(c.min / stepMin) * stepMin;
        const hStr = String(Math.floor(slotM / 60)).padStart(2, "0");
        const mStr = String(slotM % 60).padStart(2, "0");
        const slotKey = `${hStr}:${mStr}`;
        if (allBuckets[slotKey] !== undefined) {
          allBuckets[slotKey]++;
          if (categoryBuckets[c.cat] && categoryBuckets[c.cat][slotKey] !== undefined) {
            categoryBuckets[c.cat][slotKey]++;
          }
        }
      });

      labels = Object.keys(allBuckets).sort();

      // Hitung puncak keseluruhan
      labels.forEach(s => {
        if (allBuckets[s] > maxAllCount) {
          maxAllCount = allBuckets[s];
          maxAllSlot = s;
        }
      });

      // Hitung puncak per kategori
      activeCategories.forEach(cat => {
        let maxC = 0;
        let maxS = "";
        labels.forEach(s => {
          const val = categoryBuckets[cat][s] || 0;
          if (val > maxC) {
            maxC = val;
            maxS = s;
          }
        });
        categoryPeaks[cat] = { count: maxC, slot: maxS };
      });
    }

    // Render Badge Puncak Kedatangan
    if (peakBadge) {
      if (state.arrivalChartMode !== "ALL" && hasCategory && activeCategories.length > 0) {
        if (isGender) {
          const peakL = categoryPeaks["Laki-laki"] || { count: 0, slot: "-" };
          const peakP = categoryPeaks["Perempuan"] || { count: 0, slot: "-" };
          if (peakL.count > 0 || peakP.count > 0) {
            peakBadge.style.display = "inline-flex";
            peakBadge.innerHTML = `
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"></polyline><polyline points="17 6 23 6 23 12"></polyline>
              </svg>
              <span>L: <strong>${peakL.slot || '-'}</strong> (${peakL.count}) &nbsp;&bull;&nbsp; P: <strong>${peakP.slot || '-'}</strong> (${peakP.count})</span>
            `;
          } else {
            peakBadge.style.display = "none";
          }
        } else {
          // Cari 2 kategori dengan puncak tertinggi
          const sortedPeaks = [...activeCategories].sort((a, b) => (categoryPeaks[b]?.count || 0) - (categoryPeaks[a]?.count || 0));
          const top1 = sortedPeaks[0];
          const top2 = sortedPeaks[1];
          if (top1 && categoryPeaks[top1]?.count > 0) {
            peakBadge.style.display = "inline-flex";
            let text = `<span>Puncak: <strong>${escapeHtml(top1)}</strong> (${categoryPeaks[top1].slot} WIB, ${categoryPeaks[top1].count} org)`;
            if (top2 && categoryPeaks[top2]?.count > 0) {
              text += ` &nbsp;&bull;&nbsp; <strong>${escapeHtml(top2)}</strong> (${categoryPeaks[top2].slot} WIB, ${categoryPeaks[top2].count} org)`;
            }
            text += `</span>`;
            peakBadge.innerHTML = `
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"></polyline><polyline points="17 6 23 6 23 12"></polyline>
              </svg>
              ${text}
            `;
          } else {
            peakBadge.style.display = "none";
          }
        }
      } else {
        if (maxAllCount > 0) {
          peakBadge.style.display = "inline-flex";
          peakBadge.innerHTML = `
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"></polyline><polyline points="17 6 23 6 23 12"></polyline>
            </svg>
            <span>Puncak: <strong>Pukul ${maxAllSlot} WIB</strong> (${maxAllCount} orang)</span>
          `;
        } else {
          peakBadge.style.display = "none";
        }
      }
    }

    if (labels.length === 0) {
      labels = ["Belum ada waktu scan"];
      allBuckets["Belum ada waktu scan"] = 0;
      activeCategories.forEach(cat => {
        categoryBuckets[cat]["Belum ada waktu scan"] = 0;
      });
    }

    // Dynamic horizontal scroll support for large amount of time slots
    const arrivalContainer = document.getElementById("chart-arrival-container");
    if (arrivalContainer) {
      if (labels.length > 12) {
        const neededWidth = Math.max(labels.length * 48, 520);
        arrivalContainer.style.width = `${neededWidth}px`;
        arrivalContainer.style.minWidth = `${neededWidth}px`;
      } else {
        arrivalContainer.style.width = "100%";
        arrivalContainer.style.minWidth = "100%";
      }
    }

    const isDark = (state.theme === "dark");
    const textColor = isDark ? "#9eb5a5" : "#334d3d";
    const gridColor = isDark ? "rgba(255, 255, 255, 0.06)" : "rgba(13, 83, 45, 0.08)";

    // Fallback jika Chart.js belum terload atau offline
    if (typeof Chart === "undefined") {
      renderPureHtmlArrivalBars(ctx, labels, allBuckets, categoryBuckets, activeCategories, maxAllCount, isCategoryMode);
      return;
    }

    ctx.style.display = "block";
    const oldFallback = ctx.parentElement ? ctx.parentElement.querySelector(".dash-pure-bars") : null;
    if (oldFallback) oldFallback.remove();

    // Palet Warna & Gradien Dinamis
    const isCategoryMode = (state.arrivalChartMode !== "ALL" && hasCategory && activeCategories.length > 0);
    const catPalette = getCategoryPalette(activeCategories, isDark, isGender);
    const allLineColor = isDark ? "#34d399" : "#0d532d";

    let allAreaBg = isDark ? "rgba(52, 211, 153, 0.18)" : "rgba(13, 83, 45, 0.12)";
    const catGradients = {};

    try {
      const ctx2d = ctx.getContext('2d');
      const gradAll = ctx2d.createLinearGradient(0, 0, 0, 180);
      if (isDark) {
        gradAll.addColorStop(0, 'rgba(52, 211, 153, 0.35)');
        gradAll.addColorStop(1, 'rgba(52, 211, 153, 0.01)');
      } else {
        gradAll.addColorStop(0, 'rgba(13, 83, 45, 0.25)');
        gradAll.addColorStop(1, 'rgba(13, 83, 45, 0.01)');
      }
      allAreaBg = gradAll;

      activeCategories.forEach(cat => {
        const pal = catPalette[cat];
        if (pal) {
          const g = ctx2d.createLinearGradient(0, 0, 0, 180);
          g.addColorStop(0, pal.bg.replace("0.12", "0.22").replace("0.20", "0.32"));
          g.addColorStop(1, pal.bg.replace("0.12", "0.01").replace("0.20", "0.01"));
          catGradients[cat] = g;
        }
      });
    } catch (e) {}

    // Bangun Datasets Chart.js
    let datasets = [];

    if (isCategoryMode) {
      datasets = activeCategories.map(cat => {
        const pal = catPalette[cat] || { line: '#10b981', bg: 'rgba(16, 185, 129, 0.12)' };
        const grad = catGradients[cat] || pal.bg;
        const isHighlighted = (!state.drilldownValue || state.drilldownValue === cat);

        return {
          label: cat,
          data: labels.map(s => categoryBuckets[cat][s] || 0),
          borderColor: pal.line,
          backgroundColor: grad,
          fill: true,
          tension: 0.35,
          borderWidth: isHighlighted ? 2.8 : 1.5,
          pointBackgroundColor: pal.line,
          pointBorderColor: isDark ? '#132218' : '#ffffff',
          pointBorderWidth: 2,
          pointRadius: isHighlighted ? 4 : 2,
          pointHoverRadius: 7,
          pointHoverBackgroundColor: pal.line,
          pointHoverBorderColor: '#ffffff'
        };
      });
    } else {
      datasets = [
        {
          label: 'Total Kedatangan',
          data: labels.map(s => allBuckets[s]),
          borderColor: allLineColor,
          backgroundColor: allAreaBg,
          fill: true,
          tension: 0.35,
          borderWidth: 2.8,
          pointBackgroundColor: allLineColor,
          pointBorderColor: isDark ? '#132218' : '#ffffff',
          pointBorderWidth: 2,
          pointRadius: 4,
          pointHoverRadius: 7,
          pointHoverBackgroundColor: allLineColor,
          pointHoverBorderColor: '#ffffff'
        }
      ];
    }

    // Chart.js instance reuse check
    const shouldRecreate = forceRecreate || !state.arrivalChart || (state.arrivalChart.data.datasets.length !== datasets.length);

    if (!shouldRecreate && state.arrivalChart) {
      state.arrivalChart.data.labels = labels;
      datasets.forEach((ds, idx) => {
        state.arrivalChart.data.datasets[idx].label = ds.label;
        state.arrivalChart.data.datasets[idx].data = ds.data;
        state.arrivalChart.data.datasets[idx].borderColor = ds.borderColor;
        state.arrivalChart.data.datasets[idx].backgroundColor = ds.backgroundColor;
        state.arrivalChart.data.datasets[idx].pointBackgroundColor = ds.pointBackgroundColor;
        state.arrivalChart.data.datasets[idx].borderWidth = ds.borderWidth;
      });
      state.arrivalChart.options.plugins.legend.display = isCategoryMode;
      state.arrivalChart.update();
      return;
    }

    if (state.arrivalChart) {
      state.arrivalChart.destroy();
      state.arrivalChart = null;
    }

    state.arrivalChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: datasets
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'index',
          intersect: false
        },
        plugins: {
          legend: {
            display: isCategoryMode,
            position: 'top',
            labels: {
              color: textColor,
              font: { family: 'Inter', size: 11, weight: '600' },
              boxWidth: 12,
              usePointStyle: true
            }
          },
          tooltip: {
            backgroundColor: isDark ? 'rgba(19, 34, 24, 0.96)' : 'rgba(12, 31, 20, 0.94)',
            cornerRadius: 8,
            padding: 10,
            callbacks: {
              title: (items) => `Waktu: ${items[0].label} WIB`,
              label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y} orang`,
              footer: (items) => {
                if (items.length > 1) {
                  const sum = items.reduce((acc, it) => acc + (it.parsed.y || 0), 0);
                  return `Total pada jam ini: ${sum} orang`;
                }
                return "";
              }
            }
          }
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: {
              color: textColor,
              font: { family: 'Inter', size: 11, weight: '500' },
              autoSkip: true,
              maxTicksLimit: 12,
              maxRotation: 0
            }
          },
          y: {
            beginAtZero: true,
            grid: { color: gridColor },
            ticks: {
              color: textColor,
              precision: 0,
              font: { family: 'Inter', size: 11 }
            }
          }
        }
      }
    });
  }

  /**
   * Fallback render grafik kedatangan menggunakan pure HTML/CSS jika library Chart.js tidak tersedia
   */
  function renderPureHtmlArrivalBars(canvasEl, labels, allBuckets, categoryBuckets, activeCategories, maxCount, isCategoryMode) {
    const parent = canvasEl.parentElement;
    if (!parent) return;

    let fallbackDiv = parent.querySelector(".dash-pure-bars");
    if (!fallbackDiv) {
      canvasEl.style.display = "none";
      fallbackDiv = document.createElement("div");
      fallbackDiv.className = "dash-pure-bars";
      fallbackDiv.style.cssText = "display: flex; align-items: flex-end; justify-content: space-around; width: 100%; height: 100%; gap: 8px; padding-top: 15px; box-sizing: border-box;";
      parent.appendChild(fallbackDiv);
    }

    const safeMax = Math.max(1, maxCount);

    fallbackDiv.innerHTML = labels.map(lbl => {
      const cAll = allBuckets[lbl] || 0;
      const pctAll = Math.round((cAll / safeMax) * 100);

      if (isCategoryMode && activeCategories.length > 0) {
        const miniBars = activeCategories.map((cat, idx) => {
          const val = (categoryBuckets[cat] && categoryBuckets[cat][lbl]) || 0;
          const pct = Math.round((val / safeMax) * 100);
          const color = idx === 0 ? "#2563eb" : (idx === 1 ? "#e11d48" : "#059669");
          return `<div style="flex: 1; height: ${Math.max(4, pct)}%; background: ${color}; border-radius: 4px 4px 0 0;" title="${escapeHtml(cat)}: ${val}"></div>`;
        }).join("");

        return `
          <div style="flex: 1; display: flex; flex-direction: column; align-items: center; height: 100%; justify-content: flex-end;">
            <div style="display: flex; gap: 2px; align-items: flex-end; height: 100%; width: 100%; max-width: 44px; justify-content: center;">
              ${miniBars}
            </div>
            <span style="font-size: 0.72rem; color: var(--dash-text-dim); margin-top: 6px; white-space: nowrap;">${lbl}</span>
          </div>
        `;
      }

      return `
        <div style="flex: 1; display: flex; flex-direction: column; align-items: center; height: 100%; justify-content: flex-end;">
          <span style="font-size: 0.72rem; font-weight: 700; color: var(--dash-green); margin-bottom: 4px;">${cAll > 0 ? cAll : ''}</span>
          <div style="width: 100%; max-width: 44px; height: ${Math.max(4, pctAll)}%; background: var(--dash-green); border-radius: 6px 6px 0 0; min-height: 4px;"></div>
          <span style="font-size: 0.72rem; color: var(--dash-text-dim); margin-top: 6px; white-space: nowrap;">${lbl}</span>
        </div>
      `;
    }).join("");
  }

  // ============================================================================
  // TABLE FILTERING, SORTING & RENDERING
  // ============================================================================
  function sortAttendees(list) {
    const col = state.sortColumn;
    const dir = (state.sortDirection === "desc") ? -1 : 1;
    const dimName = getEffectiveDimensionName();
    const currentSessId = state.selectedSessionId;

    return [...list].sort((a, b) => {
      let res = 0;

      switch (col) {
        case "name": {
          const nameA = String(a.name || "");
          const nameB = String(b.name || "");
          res = nameA.localeCompare(nameB, "id", { sensitivity: "base" });
          break;
        }
        case "ticketId": {
          const tA = String(a.ticketId || "");
          const tB = String(b.ticketId || "");
          res = tA.localeCompare(tB, undefined, { numeric: true, sensitivity: "base" });
          break;
        }
        case "gender": {
          const gA = getAttendeeGender(a);
          const gB = getAttendeeGender(b);
          res = gA.localeCompare(gB, "id");
          break;
        }
        case "category": {
          const cA = (a.custom && dimName && a.custom[dimName]) ? String(a.custom[dimName]).trim() : "";
          const cB = (b.custom && dimName && b.custom[dimName]) ? String(b.custom[dimName]).trim() : "";
          res = cA.localeCompare(cB, "id");
          break;
        }
        case "status": {
          const getStatusWeight = (att) => {
            const sess = att.sessions[currentSessId];
            if (!sess || sess.status === "BELUM_HADIR") return 3;
            if (sess.status === "CHECKOUT") return 2;
            if (sess.status === "HADIR") return 1;
            return 3;
          };
          res = getStatusWeight(a) - getStatusWeight(b);
          break;
        }
        case "time": {
          const getTimeVal = (att) => {
            const sess = att.sessions[currentSessId];
            if (!sess) return "";
            return sess.checkInTime || sess.checkOutTime || "";
          };
          const tA = getTimeVal(a);
          const tB = getTimeVal(b);
          if (!tA && !tB) res = 0;
          else if (!tA) res = 1;
          else if (!tB) res = -1;
          else res = tA.localeCompare(tB);
          break;
        }
        case "no":
        default: {
          const tA = String(a.ticketId || "");
          const tB = String(b.ticketId || "");
          res = tA.localeCompare(tB, undefined, { numeric: true });
          break;
        }
      }

      if (res === 0) {
        res = String(a.name || "").localeCompare(String(b.name || ""), "id");
      }

      return res * dir;
    });
  }

  function handleTableSort(columnKey) {
    if (state.sortColumn === columnKey) {
      state.sortDirection = (state.sortDirection === "asc") ? "desc" : "asc";
    } else {
      state.sortColumn = columnKey;
      state.sortDirection = "asc";
    }
    state.currentPage = 1;
    renderTable();
  }

  function getFilteredAttendees() {
    const dimName = getEffectiveDimensionName();

    const filtered = state.attendees.filter(att => {
      // 1. Status Filter
      if (state.statusFilter !== "ALL") {
        const sess = att.sessions[state.selectedSessionId];
        const isAttended = sess && (sess.status === "HADIR" || sess.status === "CHECKOUT");
        if (state.statusFilter === "HADIR") {
          if (!sess || sess.status !== "HADIR") return false;
        } else if (state.statusFilter === "CHECKOUT") {
          if (!sess || sess.status !== "CHECKOUT") return false;
        } else if (state.statusFilter === "BELUM_HADIR") {
          if (isAttended) return false;
        }
      }

      // 2. Drilldown Group Filter (e.g. "Laki-laki")
      if (state.drilldownValue && dimName) {
        const val = att.custom ? String(att.custom[dimName] || "").trim() : "";
        if (val !== state.drilldownValue) return false;
      }

      // 3. Search Query (Nama atau ID Tiket saja, tanpa mengekspos kontak/WA)
      if (state.searchQuery) {
        const q = state.searchQuery.toLowerCase();
        const matchName = att.name.toLowerCase().includes(q);
        const matchTicket = att.ticketId.toLowerCase().includes(q);
        if (!matchName && !matchTicket) return false;
      }

      return true;
    });

    return sortAttendees(filtered);
  }

  function renderTable() {
    const tbody = document.getElementById("dash-table-body");
    const theadRow = document.getElementById("dash-table-head-row");
    const drilldownBanner = document.getElementById("active-drilldown-banner");
    const drilldownName = document.getElementById("drilldown-category-name");

    if (!tbody) return;

    const dimName = getEffectiveDimensionName();
    const genderCol = getGenderCol();
    const hasGender = Boolean(genderCol);
    const hasOtherDim = Boolean(dimName && !isGenderDimension(dimName));

    // Drilldown banner
    if (drilldownBanner && drilldownName) {
      if (state.drilldownValue) {
        drilldownBanner.style.display = "flex";
        drilldownName.textContent = state.drilldownValue;
      } else {
        drilldownBanner.style.display = "none";
      }
    }

    // Bangun Kolom Tabel Dinamis
    const columns = [
      { key: "no", label: "No", style: "width: 48px;" },
      { key: "name", label: "Nama Peserta" },
      { key: "ticketId", label: "ID Tiket", style: "width: 130px;" }
    ];
    if (hasGender) {
      columns.push({ key: "gender", label: "Jenis Kelamin", style: "width: 130px;" });
    }
    if (hasOtherDim) {
      columns.push({ key: "category", label: dimName, style: "width: 140px;" });
    }
    columns.push({ key: "status", label: "Status", style: "width: 130px;" });
    columns.push({ key: "time", label: "Waktu Presensi", style: "width: 140px;" });

    // Render Table Header dengan Indikator Sort
    if (theadRow) {
      theadRow.innerHTML = columns.map(col => {
        const isSorted = state.sortColumn === col.key;
        let sortArrow = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 15l5 5 5-5M7 9l5-5 5 5"/></svg>`;
        if (isSorted) {
          sortArrow = state.sortDirection === "asc"
            ? `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="18 15 12 9 6 15"></polyline></svg>`
            : `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"></polyline></svg>`;
        }
        return `
          <th class="dash-th-sortable ${isSorted ? 'active-sorted' : ''}" 
              style="${col.style || ''}" 
              onclick="EventPassSimple.sortTable('${col.key}')" 
              title="Klik untuk mengurutkan berdasarkan ${escapeHtml(col.label)}">
            <div class="dash-th-inner">
              <span>${escapeHtml(col.label)}</span>
              <span class="dash-sort-arrow" aria-hidden="true">${sortArrow}</span>
            </div>
          </th>
        `;
      }).join("");
    }

    const filtered = getFilteredAttendees();
    const startIdx = (state.currentPage - 1) * state.rowsPerPage;
    const pageRows = filtered.slice(startIdx, startIdx + state.rowsPerPage);

    if (pageRows.length === 0) {
      if (state.attendees.length === 0) {
        tbody.innerHTML = `
          <tr>
            <td colspan="${columns.length}" class="dash-empty-cell" style="padding: 44px 16px; text-align: center;">
              <div style="font-size: 1.8rem; margin-bottom: 8px; opacity: 0.7;">
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                  <polyline points="14 2 14 8 20 8"></polyline>
                  <line x1="16" y1="13" x2="8" y2="13"></line>
                  <line x1="16" y1="17" x2="8" y2="17"></line>
                </svg>
              </div>
              <div style="font-weight: 600; font-size: 0.95rem; color: var(--dash-text-main);">Data Peserta Belum Masuk</div>
              <div style="font-size: 0.8rem; color: var(--dash-text-muted); margin-top: 4px; max-width: 400px; margin-left: auto; margin-right: auto; line-height: 1.5;">
                ${state.apiUrl ? 'Belum ada data peserta yang tersinkronisasi dari Google Sheets untuk sesi ini.' : 'URL Google Apps Script belum diatur. Silakan masukkan URL Web App pada menu Pengaturan.'}
              </div>
              ${!state.apiUrl ? `
                <button type="button" onclick="window.EventPassSimple.openSettings()" class="dash-btn" style="margin-top: 14px; background: var(--dash-green); color: white; border: none; padding: 7px 16px; border-radius: 6px; font-size: 0.82rem; cursor: pointer; display: inline-flex; align-items: center; gap: 6px;">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
                  Atur URL Google Apps Script
                </button>
              ` : ''}
            </td>
          </tr>`;
      } else {
        tbody.innerHTML = `
          <tr>
            <td colspan="${columns.length}" class="dash-empty-cell">
              <div style="font-weight: 600;">Tidak ada peserta yang cocok</div>
              <div style="font-size: 0.78rem; margin-top: 4px;">Coba sesuaikan pencarian atau reset filter di atas.</div>
            </td>
          </tr>`;
      }
      updatePagination(0, 0, 0);
      return;
    }

    const hasAnyCheckout = state.attendees.some(att => {
      const sess = att.sessions[state.selectedSessionId];
      return sess && sess.status === "CHECKOUT";
    });

    const rowsHtml = pageRows.map((att, idx) => {
      const seq = startIdx + idx + 1;
      const sess = att.sessions[state.selectedSessionId] || { status: "BELUM_HADIR", checkInTime: "", checkOutTime: "" };
      const isAttended = (sess.status === "HADIR" || sess.status === "CHECKOUT");
      const isCheckout = (sess.status === "CHECKOUT");

      // Clean Status Badge
      let statusBadge = "";
      if (isCheckout) {
        statusBadge = `<span class="dash-badge dash-badge-checkout">
             <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
             Sudah Checkout
           </span>`;
      } else if (isAttended) {
        statusBadge = `<span class="dash-badge dash-badge-hadir">
             <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"></polyline></svg>
             ${hasAnyCheckout ? 'Di Lokasi' : 'Hadir'}
           </span>`;
      } else {
        statusBadge = `<span class="dash-badge dash-badge-belum">
             Belum Hadir
           </span>`;
      }

      // Waktu Presensi: Tampilkan IN dan OUT jika event berkonsep IN-OUT
      let timeHtml = '<span style="color: var(--dash-text-dim); font-size: 0.82rem;">-</span>';
      if (sess.checkInTime && sess.checkOutTime) {
        timeHtml = `
          <div style="display: flex; flex-direction: column; gap: 2px;">
            <span style="font-size: 0.8rem; font-weight: 500; color: var(--dash-green);"><span style="font-size: 0.68rem; font-weight: 700; opacity: 0.85; padding: 1px 4px; background: rgba(16,185,129,0.12); border-radius: 3px; margin-right: 4px;">IN</span>${sess.checkInTime}</span>
            <span style="font-size: 0.78rem; color: var(--dash-text-muted);"><span style="font-size: 0.68rem; font-weight: 700; opacity: 0.85; padding: 1px 4px; background: rgba(148,163,184,0.15); border-radius: 3px; margin-right: 4px;">OUT</span>${sess.checkOutTime}</span>
          </div>`;
      } else if (sess.checkInTime) {
        timeHtml = `<span style="color: var(--dash-text-muted); font-size: 0.82rem;">${sess.checkInTime}</span>`;
      } else if (sess.checkOutTime) {
        timeHtml = `<span style="color: var(--dash-text-muted); font-size: 0.82rem;"><span style="font-size: 0.68rem; font-weight: 700; opacity: 0.85; padding: 1px 4px; background: rgba(148,163,184,0.15); border-radius: 3px; margin-right: 4px;">OUT</span>${sess.checkOutTime}</span>`;
      }

      let cells = `
        <td style="color: var(--dash-text-dim); font-size: 0.78rem;">${seq}</td>
        <td>
          <div style="font-weight: 600;">${escapeHtml(att.name)}</div>
        </td>
        <td style="font-family: monospace; font-size: 0.8rem; font-weight: 600;">${escapeHtml(att.ticketId)}</td>
      `;

      if (hasGender) {
        const gVal = getAttendeeGender(att);
        const gClass = (gVal === "Laki-laki") ? "gender-laki" : (gVal === "Perempuan" ? "gender-perempuan" : "gender-other");
        cells += `<td><span class="dash-gender-badge ${gClass}">${escapeHtml(gVal)}</span></td>`;
      }

      if (hasOtherDim) {
        const catVal = (att.custom && att.custom[dimName]) ? att.custom[dimName] : "-";
        cells += `<td><span style="font-size: 0.82rem; color: var(--dash-text-muted);">${escapeHtml(catVal)}</span></td>`;
      }

      cells += `
        <td>${statusBadge}</td>
        <td>${timeHtml}</td>
      `;

      return `<tr>${cells}</tr>`;
    }).join("");

    tbody.innerHTML = rowsHtml;
    updatePagination(startIdx + 1, Math.min(startIdx + state.rowsPerPage, filtered.length), filtered.length);
  }

  function updatePagination(start, end, total) {
    const textEl = document.getElementById("dash-pagination-text");
    const btnPrev = document.getElementById("btn-prev-page");
    const btnNext = document.getElementById("btn-next-page");

    if (textEl) {
      textEl.textContent = total > 0 ? `Menampilkan ${start}-${end} dari ${total} orang` : "0 peserta";
    }

    const maxPage = Math.ceil(total / state.rowsPerPage) || 1;
    if (btnPrev) btnPrev.disabled = state.currentPage <= 1;
    if (btnNext) btnNext.disabled = state.currentPage >= maxPage;
  }

  // ============================================================================
  // EXPORT CSV (KOMPREHENSIF DENGAN WAKTU IN & OUT, TANPA DATA SENSITIF)
  // ============================================================================
  function exportCsv() {
    const filtered = getFilteredAttendees();
    if (filtered.length === 0) {
      alert("Tidak ada data peserta untuk diunduh.");
      return;
    }

    const dimName = getEffectiveDimensionName();
    const genderCol = getGenderCol();
    const hasGender = Boolean(genderCol);
    const hasOtherDim = Boolean(dimName && !isGenderDimension(dimName));

    const headers = ["No", "ID Tiket", "Nama Peserta"];
    if (hasGender) headers.push("Jenis Kelamin");
    if (hasOtherDim) headers.push(dimName);
    headers.push("Status Kehadiran", "Waktu Check-In", "Waktu Check-Out");

    const rows = filtered.map((att, idx) => {
      const sess = att.sessions[state.selectedSessionId] || { status: "BELUM_HADIR", checkInTime: "", checkOutTime: "" };
      const isAttended = (sess.status === "HADIR" || sess.status === "CHECKOUT");
      let statusLabel = "Belum Hadir";
      if (sess.status === "CHECKOUT") statusLabel = "Checkout";
      else if (isAttended) statusLabel = "Hadir / Di Lokasi";

      const row = [
        idx + 1,
        `"${att.ticketId}"`,
        `"${att.name.replace(/"/g, '""')}"`
      ];

      if (hasGender) {
        row.push(`"${getAttendeeGender(att)}"`);
      }
      if (hasOtherDim) {
        const catVal = (att.custom && att.custom[dimName]) ? att.custom[dimName] : "";
        row.push(`"${catVal.replace(/"/g, '""')}"`);
      }

      row.push(
        `"${statusLabel}"`,
        `"${sess.checkInTime || ''}"`,
        `"${sess.checkOutTime || ''}"`
      );

      return row;
    });

    const csvContent = "data:text/csv;charset=utf-8,\uFEFF" +
      [headers.join(","), ...rows.map(r => r.join(","))].join("\r\n");

    const link = document.createElement("a");
    link.setAttribute("href", encodeURI(csvContent));
    link.setAttribute("download", `Kehadiran_${state.selectedSessionId}_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  // ============================================================================
  // TAB SWITCHER: LIVE VS RIWAYAT SESI (HISTORY)
  // ============================================================================
  function switchActiveTab(tabName) {
    state.activeTab = tabName;
    const tabBtnLive = document.getElementById("tab-btn-live");
    const tabBtnHistory = document.getElementById("tab-btn-history");
    const viewLive = document.getElementById("view-live");
    const viewHistory = document.getElementById("view-history");

    if (tabName === "live") {
      if (tabBtnLive) tabBtnLive.classList.add("active");
      if (tabBtnHistory) tabBtnHistory.classList.remove("active");
      if (viewLive) viewLive.style.display = "flex";
      if (viewHistory) viewHistory.style.display = "none";
      updateView();
    } else {
      if (tabBtnLive) tabBtnLive.classList.remove("active");
      if (tabBtnHistory) tabBtnHistory.classList.add("active");
      if (viewLive) viewLive.style.display = "none";
      if (viewHistory) viewHistory.style.display = "flex";
      renderHistoryView();
    }
  }

  // ============================================================================
  // RIWAYAT SESI (HISTORY & REKAPITULASI DENGAN TREN DINAMIS KATEGORI)
  // ============================================================================
  function calculateSessionSummaries() {
    const map = {};
    const totalReg = state.attendees.length;
    const dimName = getEffectiveDimensionName();
    const isGender = isGenderDimension(dimName);

    // Kumpulkan seluruh kelompok kategori pada data peserta
    const categoryTotals = {};
    state.attendees.forEach(att => {
      const val = getAttendeeCategoryValue(att, dimName);
      categoryTotals[val] = (categoryTotals[val] || 0) + 1;
    });

    let activeCategories = [];
    if (isGender) {
      activeCategories = ["Laki-laki", "Perempuan"];
      Object.keys(categoryTotals).forEach(k => {
        if (k !== "Laki-laki" && k !== "Perempuan" && categoryTotals[k] > 0) {
          activeCategories.push(k);
        }
      });
    } else if (dimName) {
      activeCategories = Object.keys(categoryTotals).sort((a, b) => (categoryTotals[b] || 0) - (categoryTotals[a] || 0));
      if (activeCategories.length > 5) {
        activeCategories = activeCategories.slice(0, 5);
      }
    }

    state.sessions.forEach(s => {
      let attended = 0;
      let checkouts = 0;
      let maleAttended = 0;
      let femaleAttended = 0;
      let maleTotal = 0;
      let femaleTotal = 0;
      let maleInLocation = 0;
      let femaleInLocation = 0;
      let maleCheckedOut = 0;
      let femaleCheckedOut = 0;
      const hourly = {};

      // Inisialisasi statistik kategori aktif per sesi
      const catStats = {};
      activeCategories.forEach(cat => {
        catStats[cat] = { total: 0, attended: 0, inLocation: 0, checkedOut: 0, rate: 0 };
      });

      state.attendees.forEach(att => {
        const g = getAttendeeGender(att);
        if (g === "Laki-laki") maleTotal++;
        else if (g === "Perempuan") femaleTotal++;

        const cVal = getAttendeeCategoryValue(att, dimName);
        if (catStats[cVal]) {
          catStats[cVal].total++;
        }

        const sess = att.sessions[s.id];
        if (sess && (sess.status === "HADIR" || sess.status === "CHECKOUT")) {
          attended++;
          if (g === "Laki-laki") {
            maleAttended++;
            if (sess.status === "CHECKOUT") maleCheckedOut++;
            else maleInLocation++;
          } else if (g === "Perempuan") {
            femaleAttended++;
            if (sess.status === "CHECKOUT") femaleCheckedOut++;
            else femaleInLocation++;
          }

          if (sess.status === "CHECKOUT") {
            checkouts++;
            if (catStats[cVal]) {
              catStats[cVal].attended++;
              catStats[cVal].checkedOut++;
            }
          } else {
            if (catStats[cVal]) {
              catStats[cVal].attended++;
              catStats[cVal].inLocation++;
            }
          }

          if (sess.checkInTime) {
            const match = String(sess.checkInTime).match(/(\d{1,2}):(\d{2})/);
            if (match) {
              const hour = String(parseInt(match[1], 10)).padStart(2, "0");
              const slot = `${hour}:00`;
              hourly[slot] = (hourly[slot] || 0) + 1;
            }
          }
        }
      });

      // Hitung persentase kehadiran per kategori
      activeCategories.forEach(cat => {
        const st = catStats[cat];
        st.rate = st.total > 0 ? Math.round((st.attended / st.total) * 1000) / 10 : 0;
      });

      const absent = Math.max(0, totalReg - attended);
      const rate = totalReg > 0 ? Math.round((attended / totalReg) * 1000) / 10 : 0;
      const maleRate = maleTotal > 0 ? Math.round((maleAttended / maleTotal) * 1000) / 10 : 0;
      const femaleRate = femaleTotal > 0 ? Math.round((femaleAttended / femaleTotal) * 1000) / 10 : 0;

      // Cari jam puncak kedatangan
      let peakSlot = "";
      let peakCount = 0;
      Object.entries(hourly).forEach(([slot, cnt]) => {
        if (cnt > peakCount) {
          peakCount = cnt;
          peakSlot = slot;
        }
      });

      map[s.id] = {
        sessionId: s.id,
        sessionName: s.name || s.id,
        date: s.date || "",
        status: s.status || "AKTIF",
        totalRegistered: totalReg,
        attended: attended,
        checkedOut: checkouts,
        inLocation: Math.max(0, attended - checkouts),
        absent: absent,
        rate: rate,
        maleTotal: maleTotal,
        femaleTotal: femaleTotal,
        maleAttended: maleAttended,
        femaleAttended: femaleAttended,
        maleInLocation: maleInLocation,
        femaleInLocation: femaleInLocation,
        maleCheckedOut: maleCheckedOut,
        femaleCheckedOut: femaleCheckedOut,
        maleRate: maleRate,
        femaleRate: femaleRate,
        categoryStats: catStats,
        activeCategories: activeCategories,
        peakSlot: peakSlot,
        peakCount: peakCount,
        hourlyArrivals: hourly
      };
    });

    map._activeCategories = activeCategories;
    map._dimName = dimName;
    map._isGender = isGender;
    return map;
  }

  function renderHistoryView(forceRecreate = false) {
    const badgeCount = document.getElementById("badge-history-count");
    if (badgeCount) {
      badgeCount.textContent = `${state.sessions.length} Sesi`;
    }

    const summaries = calculateSessionSummaries();

    // 1. Kalkulasi Statistik Makro
    let totalScans = 0;
    let rateSum = 0;
    let peakAttended = -1;
    let peakSessionName = "-";
    let peakSessionRate = 0;
    const sessionList = [];

    state.sessions.forEach(s => {
      const sum = summaries[s.id] || {
        sessionId: s.id,
        sessionName: s.name,
        date: s.date || "",
        status: s.status || "AKTIF",
        totalRegistered: state.attendees.length,
        attended: 0,
        absent: state.attendees.length,
        rate: 0,
        maleTotal: 0,
        femaleTotal: 0,
        maleAttended: 0,
        femaleAttended: 0,
        maleRate: 0,
        femaleRate: 0,
        peakSlot: "",
        peakCount: 0
      };
      sessionList.push(sum);
      totalScans += sum.attended;
      rateSum += sum.rate;

      if (sum.attended > peakAttended) {
        peakAttended = sum.attended;
        peakSessionName = sum.sessionName;
        peakSessionRate = sum.rate;
      }
    });

    state.lastSessionList = sessionList;

    const avgRate = sessionList.length > 0 ? (rateSum / sessionList.length).toFixed(1) : 0;

    // DOM Updates
    const elHistTotal = document.getElementById("hist-kpi-total-scans");
    const elHistSub = document.getElementById("hist-kpi-total-sub");
    const elHistAvg = document.getElementById("hist-kpi-avg-rate");
    const elHistPeakName = document.getElementById("hist-kpi-peak-name");
    const elHistPeakDetail = document.getElementById("hist-kpi-peak-detail");

    if (elHistTotal) elHistTotal.textContent = totalScans.toLocaleString('id-ID');
    if (elHistSub) elHistSub.textContent = `Akumulasi presensi dari ${sessionList.length} sesi terdaftar`;
    if (elHistAvg) elHistAvg.textContent = `${avgRate}%`;
    if (elHistPeakName) elHistPeakName.textContent = peakSessionName;
    if (elHistPeakDetail) {
      elHistPeakDetail.textContent = peakAttended > 0
        ? `${peakAttended} orang hadir (${peakSessionRate}%)`
        : "Belum ada scan tercatat";
    }

    // 2. Render Grafik Tren Lintas Sesi
    renderHistoryTrendChart(sessionList, forceRecreate);

    // 3. Render Kartu Tiap Sesi
    renderHistoryCards(sessionList);
  }

  function renderHistoryTrendChart(sessionList, forceRecreate) {
    const ctx = document.getElementById("chart-history-sessions");
    if (!ctx) return;

    if (sessionList.length === 0) {
      if (chartInstances.historySessions) {
        chartInstances.historySessions.destroy();
        chartInstances.historySessions = null;
      }
      ctx.style.display = "none";
      let emptyMsg = document.getElementById("chart-history-empty-msg");
      if (!emptyMsg) {
        emptyMsg = document.createElement("div");
        emptyMsg.id = "chart-history-empty-msg";
        emptyMsg.style.cssText = "text-align: center; padding: 44px 16px; color: var(--dash-text-muted); font-size: 0.85rem;";
        ctx.parentElement.appendChild(emptyMsg);
      }
      emptyMsg.innerHTML = `<div style="font-weight: 600; margin-bottom: 4px; color: var(--dash-text-main);">Belum Ada Riwayat Sesi</div><div>Data grafik perbandingan akan muncul setelah terdapat minimal satu sesi acara.</div>`;
      emptyMsg.style.display = "block";
      return;
    }

    const emptyHistMsg = document.getElementById("chart-history-empty-msg");
    if (emptyHistMsg) emptyHistMsg.style.display = "none";
    ctx.style.display = "block";

    if (typeof Chart === "undefined") {
      ctx.parentElement.innerHTML = `<div style="text-align:center; padding: 40px; color: var(--dash-text-muted);">Library grafik sedang dimuat...</div>`;
      return;
    }

    const dimName = getEffectiveDimensionName();
    const hasCategory = Boolean(dimName);
    const isGender = isGenderDimension(dimName);

    const activeCategories = (sessionList[0] && sessionList[0].activeCategories && sessionList[0].activeCategories.length > 0)
      ? sessionList[0].activeCategories
      : (isGender ? ["Laki-laki", "Perempuan"] : []);

    const isCategoryMode = hasCategory && activeCategories.length > 0;
    state.historyChartMode = isCategoryMode ? "CATEGORY" : "ALL";

    // Dynamic horizontal scroll support when there are many sessions
    const historyContainer = document.getElementById("chart-history-container");
    if (historyContainer) {
      if (sessionList.length > 5) {
        const neededWidth = Math.max(sessionList.length * 85, 560);
        historyContainer.style.width = `${neededWidth}px`;
        historyContainer.style.minWidth = `${neededWidth}px`;
      } else {
        historyContainer.style.width = "100%";
        historyContainer.style.minWidth = "100%";
      }
    }

    const chartSub = document.getElementById("history-chart-sub");
    if (chartSub) {
      if (isCategoryMode) {
        chartSub.textContent = `Membandingkan tren kehadiran peserta berdasarkan ${dimName} antar sesi`;
      } else {
        chartSub.textContent = "Melihat perbandingan jumlah peserta hadir dan persentase dari sesi ke sesi";
      }
    }

    const isDark = (state.theme === "dark");
    const textColor = isDark ? "#9eb5a5" : "#334d3d";
    const gridColor = isDark ? "rgba(255, 255, 255, 0.06)" : "rgba(13, 83, 45, 0.08)";

    const labels = sessionList.map(s => {
      const name = s.sessionName || s.sessionId;
      return name.length > 20 ? name.slice(0, 18) + '...' : name;
    });

    let datasets = [];

    if (isCategoryMode) {
      const palette = getCategoryPalette(activeCategories, isDark, isGender);

      activeCategories.forEach((cat) => {
        const pal = palette[cat] || { line: "#059669", bg: "rgba(5, 150, 105, 0.2)" };
        const attendedArr = sessionList.map(s => (s.categoryStats && s.categoryStats[cat]) ? s.categoryStats[cat].attended : 0);

        datasets.push({
          type: 'bar',
          label: `${cat} Hadir`,
          data: attendedArr,
          backgroundColor: pal.line,
          borderRadius: 6,
          order: 2,
          yAxisID: 'y'
        });

        // Jika jumlah kategori <= 3, tampilkan garis persentase per kategori
        if (activeCategories.length <= 3) {
          const rateArr = sessionList.map(s => (s.categoryStats && s.categoryStats[cat]) ? s.categoryStats[cat].rate : 0);
          datasets.push({
            type: 'line',
            label: `Rasio ${cat} (%)`,
            data: rateArr,
            borderColor: pal.line,
            backgroundColor: 'transparent',
            borderWidth: 2.5,
            pointBackgroundColor: pal.line,
            pointBorderColor: '#ffffff',
            pointBorderWidth: 1.5,
            pointRadius: 4,
            pointHoverRadius: 6,
            tension: 0.25,
            order: 1,
            yAxisID: 'yRate'
          });
        }
      });
    } else {
      const attendedData = sessionList.map(s => s.attended);
      const absentData = sessionList.map(s => s.absent);
      const rateData = sessionList.map(s => s.rate);
      const greenBar = isDark ? "#34d399" : "#0d532d";
      const amberBar = isDark ? "rgba(251, 191, 36, 0.35)" : "rgba(217, 119, 6, 0.22)";

      datasets = [
        {
          type: 'bar',
          label: 'Sudah Hadir',
          data: attendedData,
          backgroundColor: greenBar,
          borderRadius: 6,
          order: 2,
          yAxisID: 'y'
        },
        {
          type: 'bar',
          label: 'Belum Hadir',
          data: absentData,
          backgroundColor: amberBar,
          borderRadius: 6,
          order: 3,
          yAxisID: 'y'
        },
        {
          type: 'line',
          label: 'Tingkat Kehadiran (%)',
          data: rateData,
          borderColor: '#0284c7',
          backgroundColor: 'transparent',
          borderWidth: 2.8,
          pointBackgroundColor: '#0284c7',
          pointBorderColor: '#ffffff',
          pointBorderWidth: 2,
          pointRadius: 5,
          pointHoverRadius: 7,
          tension: 0.25,
          order: 1,
          yAxisID: 'yRate'
        }
      ];
    }

    const hasRateAxis = datasets.some(ds => ds.yAxisID === 'yRate');
    const shouldRecreate = forceRecreate || !state.historyChart || (state.historyChart.data.datasets.length !== datasets.length);

    if (!shouldRecreate && state.historyChart) {
      state.historyChart.data.labels = labels;
      datasets.forEach((ds, idx) => {
        state.historyChart.data.datasets[idx].label = ds.label;
        state.historyChart.data.datasets[idx].data = ds.data;
        state.historyChart.data.datasets[idx].backgroundColor = ds.backgroundColor;
        if (ds.borderColor) state.historyChart.data.datasets[idx].borderColor = ds.borderColor;
      });
      state.historyChart.update();
      return;
    }

    if (state.historyChart) {
      state.historyChart.destroy();
      state.historyChart = null;
    }

    state.historyChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: datasets
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: true,
            position: 'top',
            labels: {
              color: textColor,
              font: { family: 'Inter', size: 11, weight: '600' },
              boxWidth: 12,
              usePointStyle: false
            }
          },
          tooltip: {
            backgroundColor: 'rgba(12, 31, 20, 0.94)',
            cornerRadius: 8,
            padding: 10,
            callbacks: {
              title: (items) => `Sesi: ${sessionList[items[0].dataIndex].sessionName}`,
              afterBody: (items) => {
                const idx = items[0].dataIndex;
                const s = sessionList[idx];
                if (isCategoryMode && s.categoryStats) {
                  const activeCats = s.activeCategories || Object.keys(s.categoryStats);
                  const lines = activeCats.map(cat => {
                    const st = s.categoryStats[cat] || { attended: 0, total: 0, rate: 0 };
                    const prefix = isGender ? (cat === "Laki-laki" ? "L: " : (cat === "Perempuan" ? "P: " : "")) : "";
                    return `${prefix}${cat}: ${st.attended} / ${st.total} hadir (${st.rate}%)`;
                  });
                  lines.push(`Total Presensi: ${s.attended} / ${s.totalRegistered} (${s.rate}%)`);
                  return lines.join("\n");
                }
                return `Total Terdaftar: ${s.totalRegistered} orang\nRasio Hadir: ${s.rate}%`;
              }
            }
          }
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { color: textColor, font: { family: 'Inter', size: 11, weight: '600' } }
          },
          y: {
            position: 'left',
            beginAtZero: true,
            grid: { color: gridColor },
            ticks: {
              color: textColor,
              precision: 0,
              font: { family: 'Inter', size: 11 }
            },
            title: {
              display: true,
              text: 'Jumlah Orang',
              color: textColor,
              font: { size: 10, weight: '600' }
            }
          },
          yRate: {
            position: 'right',
            beginAtZero: true,
            max: 100,
            display: hasRateAxis,
            grid: { display: false },
            ticks: {
              color: '#0284c7',
              callback: (val) => `${val}%`,
              font: { family: 'Inter', size: 10 }
            },
            title: {
              display: hasRateAxis,
              text: 'Rasio (%)',
              color: '#0284c7',
              font: { size: 10, weight: '600' }
            }
          }
        }
      }
    });
  }

  function renderHistoryCards(sessionList) {
    const grid = document.getElementById("history-cards-grid");
    if (!grid) return;

    if (sessionList.length === 0) {
      grid.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 48px 16px; color: var(--dash-text-muted); font-size: 0.85rem; border: 1px dashed var(--dash-border, #e5e7eb); border-radius: 8px;">
          <div style="font-weight: 600; margin-bottom: 4px; color: var(--dash-text-main);">Belum Ada Riwayat Sesi</div>
          <div>Hubungkan URL Google Apps Script di Pengaturan untuk memuat daftar sesi presensi.</div>
        </div>`;
      return;
    }

    const dimName = getEffectiveDimensionName();
    const isGender = isGenderDimension(dimName);

    grid.innerHTML = sessionList.map((s, idx) => {
      const prev = idx > 0 ? sessionList[idx - 1] : null;
      let deltaBadge = `<span class="dash-history-delta-badge neutral">Sesi Pertama</span>`;

      if (prev && prev.attended > 0) {
        const diff = s.attended - prev.attended;
        const pctDiff = Math.round((diff / prev.attended) * 100);
        if (diff > 0) {
          deltaBadge = `<span class="dash-history-delta-badge up" title="Naik dibanding sesi sebelumnya">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="18 15 12 9 6 15"></polyline></svg>
            +${pctDiff}% (+${diff} org)
          </span>`;
        } else if (diff < 0) {
          deltaBadge = `<span class="dash-history-delta-badge down" title="Turun dibanding sesi sebelumnya">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="6 9 12 15 18 9"></polyline></svg>
            ${pctDiff}% (${diff} org)
          </span>`;
        } else {
          deltaBadge = `<span class="dash-history-delta-badge neutral">Stabil</span>`;
        }
      } else if (prev && prev.attended === 0 && s.attended > 0) {
        deltaBadge = `<span class="dash-history-delta-badge up">+${s.attended} org</span>`;
      }

      const statusBadge = (s.status === "AKTIF")
        ? `<span class="dash-badge dash-badge-hadir">Sesi Aktif</span>`
        : `<span class="dash-badge dash-badge-selesai">Selesai</span>`;

      // Split Box Hadir (Di Lokasi) vs Checkout jika ada aktivitas checkout
      let splitBoxHtml = '';
      if (s.checkedOut > 0) {
        splitBoxHtml = `
          <div class="dash-hist-split-box">
            <div class="dash-hist-split-item in-loc" title="Peserta yang masih berada di lokasi acara">
              <span class="dash-hist-split-dot in-loc"></span>
              <span class="dash-hist-split-label">Di Lokasi:</span>
              <strong class="dash-hist-split-val">${s.inLocation}</strong>
            </div>
            <div class="dash-hist-split-divider"></div>
            <div class="dash-hist-split-item out" title="Peserta yang sudah checkout kepulangan">
              <span class="dash-hist-split-dot out"></span>
              <span class="dash-hist-split-label">Checkout:</span>
              <strong class="dash-hist-split-val">${s.checkedOut}</strong>
            </div>
          </div>
        `;
      }

      // Rincian Berdasarkan Kategori / Gender
      let categoryBreakdownHtml = '';
      if (dimName && s.categoryStats) {
        if (isGender) {
          const hasCo = (s.maleCheckedOut > 0 || s.femaleCheckedOut > 0);
          categoryBreakdownHtml = `
            <div class="dash-hist-gender-row">
              <div class="dash-hist-gender-chip male">
                <div class="dash-hist-chip-header">
                  <span class="dash-hist-chip-title">Laki-laki</span>
                  <span class="dash-hist-chip-pct">${s.maleRate}%</span>
                </div>
                <div class="dash-hist-chip-body">
                  <strong class="dash-hist-chip-num">${s.maleAttended}</strong>
                  <span class="dash-hist-chip-of">/ ${s.maleTotal}</span>
                </div>
                ${hasCo ? `<div class="dash-hist-chip-sub">${s.maleInLocation} lokasi &bull; ${s.maleCheckedOut} out</div>` : ''}
              </div>

              <div class="dash-hist-gender-chip female">
                <div class="dash-hist-chip-header">
                  <span class="dash-hist-chip-title">Perempuan</span>
                  <span class="dash-hist-chip-pct">${s.femaleRate}%</span>
                </div>
                <div class="dash-hist-chip-body">
                  <strong class="dash-hist-chip-num">${s.femaleAttended}</strong>
                  <span class="dash-hist-chip-of">/ ${s.femaleTotal}</span>
                </div>
                ${hasCo ? `<div class="dash-hist-chip-sub">${s.femaleInLocation} lokasi &bull; ${s.femaleCheckedOut} out</div>` : ''}
              </div>
            </div>
          `;
        } else {
          const catEntries = Object.entries(s.categoryStats)
            .filter(([_, st]) => st.total > 0)
            .sort((a, b) => b[1].attended - a[1].attended)
            .slice(0, 4);

          if (catEntries.length > 0) {
            const pills = catEntries.map(([cName, st]) => {
              const displayName = cName.length > 16 ? cName.slice(0, 14) + '..' : cName;
              const hasCo = (st.checkedOut > 0);
              const subText = hasCo ? `${st.inLocation} in &bull; ${st.checkedOut} out` : `${st.rate}%`;
              return `
                <div class="dash-hist-cat-pill" title="${escapeHtml(cName)}: ${st.attended} dari ${st.total} orang hadir (${st.rate}%)">
                  <span class="dash-hist-cat-name">${escapeHtml(displayName)}:</span>
                  <strong class="dash-hist-cat-val">${st.attended}/${st.total}</strong>
                  <span class="dash-hist-cat-sub">(${subText})</span>
                </div>
              `;
            }).join("");

            categoryBreakdownHtml = `<div class="dash-history-cat-row">${pills}</div>`;
          }
        }
      }

      const rushHtml = (s.peakCount > 0 && s.peakSlot)
        ? `<div class="dash-history-rush" title="Puncak kedatangan">
             <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
             <span>Puncak: <strong>Pukul ${s.peakSlot} WIB</strong> (${s.peakCount} org)</span>
           </div>`
        : `<div class="dash-history-rush" style="color: var(--dash-text-dim);"><span>Belum ada waktu scan</span></div>`;

      const dateHtml = (s.date && s.date !== "Sesi Acara")
        ? `<div class="dash-history-card-date">${escapeHtml(s.date)}</div>`
        : '';

      return `
        <div class="dash-history-card">
          <div class="dash-history-card-top">
            <div class="dash-history-card-header">
              <div class="dash-history-title-wrap">
                <h3 class="dash-history-card-title">${escapeHtml(s.sessionName)}</h3>
                ${dateHtml}
              </div>
              <div class="dash-history-badges-top">
                ${deltaBadge}
                ${statusBadge}
              </div>
            </div>

            <div class="dash-history-card-stats">
              <div class="dash-history-card-num">
                ${s.attended}
                <span class="dash-history-card-total">/ ${s.totalRegistered} hadir</span>
              </div>
              <span class="dash-history-card-pct">${s.rate}%</span>
            </div>

            <div class="dash-stat-progress-wrap" style="margin: 6px 0 10px;">
              <div class="dash-stat-progress-bar">
                <div class="dash-stat-progress-fill fill-green" style="width: ${s.rate}%;"></div>
              </div>
            </div>

            ${splitBoxHtml}
            ${categoryBreakdownHtml}
          </div>

          <div class="dash-history-card-footer">
            ${rushHtml}
            <button class="dash-btn dash-btn-sm" onclick="EventPassSimple.openSessionInLive('${escapeJs(s.sessionId)}')">
              <span>Buka Sesi</span>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"></polyline></svg>
            </button>
          </div>
        </div>
      `;
    }).join("");
  }

  // Helper Escapes
  function escapeHtml(str) {
    if (!str) return "";
    return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function escapeJs(str) {
    if (!str) return "";
    return String(str).replace(/'/g, "\\'");
  }

  // Global namespace for HTML onclick handlers
  window.EventPassSimple = {
    switchTab: (tabName) => {
      switchActiveTab(tabName);
    },
    selectDimension: (dimName) => {
      state.selectedDimension = dimName;
      state.drilldownValue = "";
      state.currentPage = 1;
      const s1 = document.getElementById("select-dimension");
      const s2 = document.getElementById("select-hist-dimension");
      if (s1) s1.value = dimName;
      if (s2) s2.value = dimName;
      if (state.activeTab === "history") {
        renderHistoryView(true);
      } else {
        updateView();
      }
    },
    selectGroup: (catName) => {
      state.drilldownValue = (state.drilldownValue === catName) ? "" : catName;
      state.currentPage = 1;
      updateView();
    },
    openSessionInLive: (sessionId) => {
      state.selectedSessionId = sessionId;
      const sel = document.getElementById("select-session");
      if (sel) sel.value = sessionId;
      switchActiveTab("live");
    },
    sortTable: (columnKey) => {
      handleTableSort(columnKey);
    },
    openSettings: () => {
      const btn = document.getElementById("btn-open-settings-menu");
      if (btn) btn.click();
    }
  };

})();
