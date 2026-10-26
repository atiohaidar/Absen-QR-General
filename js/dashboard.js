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

    // Pagination
    currentPage: 1,
    rowsPerPage: 15,
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

  // Demo Fallback Data (When Google Apps Script URL is not set yet)
  const mockData = {
    success: true,
    meta: { eventName: "Presensi Gerakan Subuh Berjamaah" },
    sessions: [
      { id: "SESI-01", name: "Sesi 01: Pembukaan & Registrasi", status: "SELESAI" },
      { id: "SESI-02", name: "Sesi 02: Kajian Inti (Hari Ini)", status: "AKTIF" },
      { id: "SESI-03", name: "Sesi 03: Penutupan & Ramah Tamah", status: "AKTIF" }
    ],
    detectedGenderCol: "Jenis Kelamin",
    dimensions: [
      { name: "Jenis Kelamin" },
      { name: "Instansi / Masjid" },
      { name: "Kategori Peserta" }
    ],
    attendees: generateDemoAttendees(120)
  };

  function generateDemoAttendees(count) {
    const instansi = ["Masjid Al-Ikhlas", "DKM Baiturrahman", "Masjid Raya", "Komunitas Pejuang Subuh"];

    // Distribusi jam kedatangan demo per gender & kelompok:
    const timesPoolLaki02 = [
      "04:05", "04:10", "04:12", "04:15", "04:15", "04:18", "04:20", "04:20", "04:20", "04:22", "04:25", "04:25", "04:28", "04:30", "04:35"
    ];
    const timesPoolPerempuan02 = [
      "04:15", "04:20", "04:22", "04:25", "04:28", "04:30", "04:30", "04:32", "04:35", "04:35", "04:35", "04:38", "04:40", "04:45", "04:50"
    ];

    // Distribusi jam kedatangan Sesi 01 (Pembukaan)
    const timesPoolLaki01 = ["03:45", "03:50", "03:55", "04:00", "04:00", "04:05", "04:10", "04:15"];
    const timesPoolPerempuan01 = ["03:55", "04:00", "04:05", "04:10", "04:10", "04:15", "04:20", "04:25"];

    const list = [];
    for (let i = 1; i <= count; i++) {
      const pad = String(i).padStart(3, '0');
      const isLaki = i % 2 !== 0;
      const genderVal = isLaki ? "Laki-laki" : "Perempuan";
      const isPengurus = (i % 5 === 0);
      const instansiIdx = i % instansi.length;

      const isAttended01 = Math.random() < (isLaki ? 0.88 : 0.78);
      const isAttended02 = Math.random() < (isLaki ? 0.83 : 0.72);
      const isAttended03 = Math.random() < (isLaki ? 0.45 : 0.38);

      let pool02 = isLaki ? timesPoolLaki02 : timesPoolPerempuan02;
      if (isPengurus) {
        pool02 = ["03:55", "04:00", "04:05", "04:10", "04:12", "04:15", "04:18"];
      } else {
        if (instansiIdx === 0) pool02 = ["04:10", "04:15", "04:18", "04:20", "04:22", "04:25"];
        else if (instansiIdx === 1) pool02 = ["04:18", "04:22", "04:25", "04:28", "04:30"];
        else if (instansiIdx === 2) pool02 = ["04:22", "04:26", "04:30", "04:32", "04:35"];
        else pool02 = ["04:28", "04:32", "04:35", "04:38", "04:40", "04:45"];
      }

      const pool01 = isLaki ? timesPoolLaki01 : timesPoolPerempuan01;

      const timeStr01 = isAttended01 ? pool01[Math.floor(Math.random() * pool01.length)] : "";
      const timeStr02 = isAttended02 ? pool02[Math.floor(Math.random() * pool02.length)] : "";
      const timeStr03 = isAttended03 ? "05:15" : "";

      // Simulasi status IN-OUT untuk Sesi 02 (sedang berlangsung: sebagian sudah checkout) & Sesi 01 (selesai)
      let status02 = isAttended02 ? "HADIR" : "BELUM_HADIR";
      let checkOutTime02 = "";
      if (isAttended02 && (i % 6 === 0)) {
        status02 = "CHECKOUT";
        checkOutTime02 = (i % 2 === 0) ? "05:10" : "05:25";
      }

      let status01 = isAttended01 ? (i % 4 !== 0 ? "CHECKOUT" : "HADIR") : "BELUM_HADIR";
      let checkOutTime01 = (status01 === "CHECKOUT") ? "05:30" : "";

      list.push({
        ticketId: `MSU-GSB-${pad}`,
        name: isLaki ? `Jamaah Putra ${pad}` : `Jamaah Putri ${pad}`,
        email: `peserta${pad}@example.com`,
        phone: `62812${Math.floor(10000000 + Math.random() * 90000000)}`,
        custom: {
          "Jenis Kelamin": genderVal,
          "Instansi / Masjid": instansi[instansiIdx],
          "Kategori Peserta": isPengurus ? "Pengurus" : "Jamaah Umum"
        },
        sessions: {
          "SESI-01": { status: status01, checkInTime: timeStr01, checkOutTime: checkOutTime01 },
          "SESI-02": { status: status02, checkInTime: timeStr02, checkOutTime: checkOutTime02 },
          "SESI-03": { status: isAttended03 ? "HADIR" : "BELUM_HADIR", checkInTime: timeStr03, checkOutTime: "" }
        }
      });
    }
    return list;
  }

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
      { line: "#34d399", bg: "rgba(52, 211, 153, 0.20)" }, // Emerald
      { line: "#60a5fa", bg: "rgba(96, 165, 250, 0.20)" }, // Blue
      { line: "#fb7185", bg: "rgba(251, 113, 133, 0.20)" }, // Rose
      { line: "#fbbf24", bg: "rgba(251, 191, 36, 0.20)" },  // Amber
      { line: "#a78bfa", bg: "rgba(167, 139, 250, 0.20)" }, // Purple
      { line: "#38bdf8", bg: "rgba(56, 189, 248, 0.20)" }   // Cyan
    ] : [
      { line: "#059669", bg: "rgba(5, 150, 105, 0.12)" },   // Emerald
      { line: "#2563eb", bg: "rgba(37, 99, 235, 0.12)" },   // Blue
      { line: "#e11d48", bg: "rgba(225, 29, 72, 0.12)" },   // Rose
      { line: "#d97706", bg: "rgba(217, 119, 6, 0.12)" },   // Amber
      { line: "#7c3aed", bg: "rgba(124, 58, 237, 0.12)" },  // Purple
      { line: "#0284c7", bg: "rgba(2, 132, 199, 0.12)" }    // Cyan
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

    attendeeList.forEach(att => {
      const g = getAttendeeGender(att);
      const sess = att.sessions[sessionId];
      const isAttended = sess && (sess.status === "HADIR" || sess.status === "CHECKOUT");

      if (g === "Laki-laki") {
        maleTotal++;
        if (isAttended) maleAttended++;
      } else if (g === "Perempuan") {
        femaleTotal++;
        if (isAttended) femaleAttended++;
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
    // 1. URL parameter check
    const urlParams = new URLSearchParams(window.location.search);
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
        // Fallback demo data
        await new Promise(r => setTimeout(r, 150));
        data = mockData;
      } else {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 5000);
          const url = `${state.apiUrl}${state.apiUrl.includes('?') ? '&' : '?'}action=getDashboardData&forceRefresh=${forceRefresh}&t=${Date.now()}`;
          const resp = await fetch(url, { signal: controller.signal });
          clearTimeout(timeoutId);
          const text = await resp.text();
          data = JSON.parse(text);

          if (!data.success) {
            throw new Error(data.message || "Gagal mengambil data presensi.");
          }
        } catch (fetchErr) {
          console.warn("[Dashboard API warning] Backend offline/error, falling back to demo data:", fetchErr);
          data = mockData;
          if (syncDot) syncDot.style.backgroundColor = "var(--dash-amber)";
          if (syncText) syncText.textContent = "Offline (Demo Mode)";
        }
      }

      state.sessions = data.sessions || [];
      state.dimensions = data.dimensions || [];
      state.attendees = data.attendees || [];
      state.detectedGenderCol = data.detectedGenderCol || findGenderColumnName(state.dimensions);
      state.sessionSummaries = data.sessionSummaries || {};

      const badgeHistoryCount = document.getElementById("badge-history-count");
      if (badgeHistoryCount) {
        badgeHistoryCount.textContent = `${state.sessions.length} Sesi`;
      }

      // Set default active session (prioritaskan sesi yang berstatus AKTIF)
      if (!state.selectedSessionId && state.sessions.length > 0) {
        const activeSess = state.sessions.find(s => s.status === "AKTIF");
        state.selectedSessionId = activeSess ? activeSess.id : state.sessions[0].id;
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

      if (syncDot) syncDot.style.backgroundColor = "var(--dash-green)";
      if (syncText) {
        const timeStr = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
        syncText.textContent = `Realtime (${timeStr})`;
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

  function populateSessionDropdown() {
    const sel = document.getElementById("select-session");
    if (!sel) return;

    const prev = state.selectedSessionId;
    sel.innerHTML = "";

    state.sessions.forEach(s => {
      const opt = document.createElement("option");
      opt.value = s.id;
      opt.textContent = `${s.name || s.id}`;
      sel.appendChild(opt);
    });

    if (prev && state.sessions.some(s => s.id === prev)) {
      sel.value = prev;
    } else if (state.sessions.length > 0) {
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
        elAttendedSub.innerHTML = `<strong>${inLocation}</strong> di lokasi • <strong>${checkedOut}</strong> sudah checkout`;
      } else {
        elAttendedSub.textContent = "Peserta sudah melewati scanner sesi ini";
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

    // Gender Mini Pills in Hero Cards
    const gStats = calculateGenderStats(state.attendees, state.selectedSessionId);
    const elPillsTotal = document.getElementById("kpi-total-gender-pills");
    const elPillsAttended = document.getElementById("kpi-attended-gender-pills");
    const elPillsAbsent = document.getElementById("kpi-absent-gender-pills");

    if (gStats.hasGender) {
      if (elPillsTotal) {
        elPillsTotal.style.display = "flex";
        elPillsTotal.innerHTML = `
          <span class="dash-gender-mini-pill neutral">👨 ${gStats.maleTotal} Laki-laki</span>
          <span class="dash-gender-mini-pill neutral">👩 ${gStats.femaleTotal} Perempuan</span>
        `;
      }
      if (elPillsAttended) {
        elPillsAttended.style.display = "flex";
        elPillsAttended.innerHTML = `
          <span class="dash-gender-mini-pill male">👨 ${gStats.maleAttended} Laki-laki (${gStats.maleAttendedPct}%)</span>
          <span class="dash-gender-mini-pill female">👩 ${gStats.femaleAttended} Perempuan (${gStats.femaleAttendedPct}%)</span>
        `;
      }
      if (elPillsAbsent) {
        elPillsAbsent.style.display = "flex";
        elPillsAbsent.innerHTML = `
          <span class="dash-gender-mini-pill male">👨 ${gStats.maleAbsent} Laki-laki</span>
          <span class="dash-gender-mini-pill female">👩 ${gStats.femaleAbsent} Perempuan</span>
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

    if (!dimName) {
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
    const groups = {}; // { [groupName]: { total: 0, attended: 0 } }
    state.attendees.forEach(att => {
      const val = (att.custom && att.custom[dimName]) ? String(att.custom[dimName]).trim() : "Tidak Diisi";
      if (!groups[val]) groups[val] = { total: 0, attended: 0 };
      groups[val].total++;

      const sess = att.sessions[state.selectedSessionId];
      if (sess && (sess.status === "HADIR" || sess.status === "CHECKOUT")) {
        groups[val].attended++;
      }
    });

    const categories = Object.keys(groups).sort((a, b) => groups[b].total - groups[a].total);

    const cardsHtml = categories.map(cat => {
      const g = groups[cat];
      const absent = Math.max(0, g.total - g.attended);
      const rate = g.total > 0 ? ((g.attended / g.total) * 100).toFixed(1) : 0;
      const isSelected = (state.drilldownValue === cat);

      return `
        <div class="dash-group-card ${isSelected ? 'active-selected' : ''}" onclick="window.EventPassSimple.selectGroup('${escapeJs(cat)}')" title="${isSelected ? 'Klik untuk menghapus filter' : 'Klik untuk menyaring tabel'}">
          <div class="dash-group-header">
            <span class="dash-group-name">${escapeHtml(cat)}</span>
            <div class="dash-group-badges">
              <span class="dash-group-total">${g.total} Orang</span>
              <span class="dash-group-filter-pill ${isSelected ? 'active' : ''}">
                ${isSelected ? 'Filter Aktif ✓' : 'Saring →'}
              </span>
            </div>
          </div>

          <div class="dash-group-stats-row">
            <div class="dash-group-metric">
              <span class="dash-group-metric-val green">${g.attended}</span>
              <span class="dash-group-metric-label">Sudah Hadir (${rate}%)</span>
            </div>
            <div class="dash-group-metric" style="text-align: right;">
              <span class="dash-group-metric-val amber">${absent}</span>
              <span class="dash-group-metric-label">Belum Hadir</span>
            </div>
          </div>

          <div class="dash-mini-progress">
            <div class="dash-mini-bar" style="width: ${rate}%;"></div>
          </div>
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
              <span>👨 Puncak L: <strong>${peakL.slot || '-'}</strong> (${peakL.count} org) &nbsp;&bull;&nbsp; 👩 P: <strong>${peakP.slot || '-'}</strong> (${peakP.count} org)</span>
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
            <span>Puncak Kedatangan: <strong>Pukul ${maxAllSlot} WIB</strong> (${maxAllCount} orang)</span>
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
    const allLineColor = isDark ? "#4ade80" : "#0d532d";

    let allAreaBg = isDark ? "rgba(74, 222, 128, 0.18)" : "rgba(13, 83, 45, 0.12)";
    const catGradients = {};

    try {
      const ctx2d = ctx.getContext('2d');
      const gradAll = ctx2d.createLinearGradient(0, 0, 0, 180);
      if (isDark) {
        gradAll.addColorStop(0, 'rgba(74, 222, 128, 0.35)');
        gradAll.addColorStop(1, 'rgba(74, 222, 128, 0.01)');
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
  // TABLE FILTERING & RENDERING
  // ============================================================================
  function getFilteredAttendees() {
    const dimName = getEffectiveDimensionName();

    return state.attendees.filter(att => {
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

      // 3. Search Query
      if (state.searchQuery) {
        const q = state.searchQuery;
        const matchName = att.name.toLowerCase().includes(q);
        const matchTicket = att.ticketId.toLowerCase().includes(q);
        const matchPhone = att.phone && att.phone.includes(q);
        if (!matchName && !matchTicket && !matchPhone) return false;
      }

      return true;
    });
  }

  function renderTable() {
    const tbody = document.getElementById("dash-table-body");
    const thCategory = document.getElementById("th-category-name");
    const drilldownBanner = document.getElementById("active-drilldown-banner");
    const drilldownName = document.getElementById("drilldown-category-name");

    if (!tbody) return;

    const dimName = getEffectiveDimensionName();
    if (thCategory) {
      thCategory.textContent = dimName || "Kategori";
    }

    // Drilldown banner
    if (drilldownBanner && drilldownName) {
      if (state.drilldownValue) {
        drilldownBanner.style.display = "flex";
        drilldownName.textContent = state.drilldownValue;
      } else {
        drilldownBanner.style.display = "none";
      }
    }

    const filtered = getFilteredAttendees();
    const startIdx = (state.currentPage - 1) * state.rowsPerPage;
    const pageRows = filtered.slice(startIdx, startIdx + state.rowsPerPage);

    if (pageRows.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" class="dash-empty-cell">
            <div style="font-weight: 600;">Tidak ada peserta yang cocok</div>
            <div style="font-size: 0.78rem; margin-top: 4px;">Coba sesuaikan pencarian atau reset filter di atas.</div>
          </td>
        </tr>`;
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

      // Category / Gender value
      const catVal = (att.custom && dimName && att.custom[dimName]) ? att.custom[dimName] : "-";

      // WhatsApp Button for Absent Attendees
      let waBtn = "";
      if (att.phone && att.phone.length > 8) {
        const cleanPhone = att.phone.replace(/[^0-9]/g, "");
        const formatted = cleanPhone.startsWith("0") ? "62" + cleanPhone.slice(1) : cleanPhone;
        const msg = encodeURIComponent(`Assalamu'alaikum ${att.name}, kami panitia mengingatkan terkait kehadiran sesi ${state.selectedSessionId}.`);
        waBtn = `<a href="https://wa.me/${formatted}?text=${msg}" target="_blank" class="dash-action-btn" title="Kirim Pesan WhatsApp">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>
          WA
        </a>`;
      }

      return `
        <tr>
          <td style="color: var(--dash-text-dim); font-size: 0.78rem;">${seq}</td>
          <td>
            <div style="font-weight: 600;">${escapeHtml(att.name)}</div>
          </td>
          <td style="font-family: monospace; font-size: 0.8rem; font-weight: 600;">${escapeHtml(att.ticketId)}</td>
          <td>${escapeHtml(catVal)}</td>
          <td>${statusBadge}</td>
          <td>${timeHtml}</td>
          <td style="text-align: right;">${waBtn}</td>
        </tr>
      `;
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
  // EXPORT CSV (KOMPREHENSIF DENGAN WAKTU IN & OUT)
  // ============================================================================
  function exportCsv() {
    const filtered = getFilteredAttendees();
    if (filtered.length === 0) {
      alert("Tidak ada data peserta untuk diunduh.");
      return;
    }

    const dimName = getEffectiveDimensionName() || "Kategori";
    const headers = ["No", "ID Tiket", "Nama Peserta", dimName, "Status Kehadiran", "Waktu Check-In", "Waktu Check-Out", "Nomor WhatsApp"];

    const rows = filtered.map((att, idx) => {
      const sess = att.sessions[state.selectedSessionId] || { status: "BELUM_HADIR", checkInTime: "", checkOutTime: "" };
      const isAttended = (sess.status === "HADIR" || sess.status === "CHECKOUT");
      let statusLabel = "Belum Hadir";
      if (sess.status === "CHECKOUT") statusLabel = "Checkout";
      else if (isAttended) statusLabel = "Hadir / Di Lokasi";

      const catVal = (att.custom && dimName && att.custom[dimName]) ? att.custom[dimName] : "";

      return [
        idx + 1,
        `"${att.ticketId}"`,
        `"${att.name.replace(/"/g, '""')}"`,
        `"${catVal.replace(/"/g, '""')}"`,
        `"${statusLabel}"`,
        `"${sess.checkInTime || ''}"`,
        `"${sess.checkOutTime || ''}"`,
        `"${att.phone || ''}"`
      ];
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
      const hourly = {};

      // Inisialisasi statistik kategori aktif per sesi
      const catStats = {};
      activeCategories.forEach(cat => {
        catStats[cat] = { total: 0, attended: 0, rate: 0 };
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
          if (sess.status === "CHECKOUT") checkouts++;
          if (g === "Laki-laki") maleAttended++;
          else if (g === "Perempuan") femaleAttended++;

          if (catStats[cVal]) {
            catStats[cVal].attended++;
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
      const greenBar = isDark ? "#4ade80" : "#10b981";
      const amberBar = isDark ? "rgba(245, 158, 11, 0.4)" : "rgba(245, 158, 11, 0.25)";

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
                    const icon = isGender ? (cat === "Laki-laki" ? "👨 " : (cat === "Perempuan" ? "👩 " : "")) : "• ";
                    return `${icon}${cat}: ${st.attended} / ${st.total} hadir (${st.rate}%)`;
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
      grid.innerHTML = `<div style="grid-column: 1 / -1; text-align: center; padding: 40px; color: var(--dash-text-muted);">Belum ada riwayat sesi yang tersimpan.</div>`;
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
          deltaBadge = `<span class="dash-history-delta-badge up">▲ +${pctDiff}% (+${diff} org) vs ${escapeHtml(prev.sessionName)}</span>`;
        } else if (diff < 0) {
          deltaBadge = `<span class="dash-history-delta-badge down">▼ ${pctDiff}% (${diff} org) vs ${escapeHtml(prev.sessionName)}</span>`;
        } else {
          deltaBadge = `<span class="dash-history-delta-badge neutral">● Stabil vs ${escapeHtml(prev.sessionName)}</span>`;
        }
      } else if (prev && prev.attended === 0 && s.attended > 0) {
        deltaBadge = `<span class="dash-history-delta-badge up">▲ +${s.attended} org vs ${escapeHtml(prev.sessionName)}</span>`;
      }

      const statusBadge = s.status === "AKTIF"
        ? `<span class="dash-stat-badge badge-hadir">● Sesi Aktif</span>`
        : `<span class="dash-stat-badge badge-neutral">Selesai</span>`;

      const rushHtml = (s.peakCount > 0 && s.peakSlot)
        ? `<span class="dash-history-rush" title="Puncak kedatangan">
             <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
             Puncak: Pukul ${s.peakSlot} WIB (${s.peakCount} org)
           </span>`
        : `<span class="dash-history-rush" style="color: var(--dash-text-dim);">Belum ada waktu scan</span>`;

      let categoryBreakdownHtml = '';
      if (dimName && s.categoryStats) {
        if (isGender) {
          categoryBreakdownHtml = (s.maleTotal > 0 || s.femaleTotal > 0)
            ? `<div class="dash-history-gender-split">
                 <span class="male">👨 ${s.maleAttended}/${s.maleTotal} (${s.maleRate}%)</span>
                 <span>&bull;</span>
                 <span class="female">👩 ${s.femaleAttended}/${s.femaleTotal} (${s.femaleRate}%)</span>
               </div>`
            : '';
        } else {
          const catEntries = Object.entries(s.categoryStats)
            .filter(([_, st]) => st.total > 0)
            .sort((a, b) => b[1].attended - a[1].attended)
            .slice(0, 4);

          if (catEntries.length > 0) {
            const pills = catEntries.map(([cName, st]) => {
              const displayName = cName.length > 16 ? cName.slice(0, 14) + '..' : cName;
              return `<span class="dash-hist-cat-pill" title="${escapeHtml(cName)}: ${st.attended} dari ${st.total} orang hadir (${st.rate}%)">
                <span class="dash-hist-cat-name">${escapeHtml(displayName)}:</span>
                <span class="dash-hist-cat-val">${st.attended}/${st.total} (${st.rate}%)</span>
              </span>`;
            }).join("");

            categoryBreakdownHtml = `<div class="dash-history-cat-row">${pills}</div>`;
          }
        }
      }

      const checkoutInfoHtml = (s.checkedOut > 0)
        ? `<div style="font-size: 0.74rem; color: var(--dash-text-muted); margin-top: 4px; display: flex; align-items: center; gap: 5px;">
             <span>📍 ${s.inLocation || (s.attended - s.checkedOut)} di lokasi</span>
             <span>&bull;</span>
             <span>🚪 ${s.checkedOut} sudah checkout</span>
           </div>`
        : '';

      return `
        <div class="dash-history-card">
          <div>
            <div class="dash-history-card-header">
              <div>
                <h3 class="dash-history-card-title">${escapeHtml(s.sessionName)}</h3>
                <div class="dash-history-card-date">${escapeHtml(s.date || 'Sesi Acara')}</div>
              </div>
              ${statusBadge}
            </div>

            <div class="dash-history-card-stats">
              <div class="dash-history-card-num">${s.attended} <span style="font-size: 0.9rem; font-weight: 600; color: var(--dash-text-dim);">/ ${s.totalRegistered} hadir</span></div>
              <span class="dash-history-card-pct">${s.rate}%</span>
            </div>

            <div class="dash-stat-progress-wrap" style="margin: 8px 0 6px;">
              <div class="dash-stat-progress-bar">
                <div class="dash-stat-progress-fill fill-green" style="width: ${s.rate}%;"></div>
              </div>
            </div>

            ${categoryBreakdownHtml}
            ${checkoutInfoHtml}

            <div style="margin-top: 8px;">
              ${deltaBadge}
            </div>
          </div>

          <div class="dash-history-card-footer">
            ${rushHtml}
            <button class="dash-btn dash-btn-sm" onclick="EventPassSimple.openSessionInLive('${escapeJs(s.sessionId)}')">
              <span>Buka di Live</span>
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
    }
  };

})();
