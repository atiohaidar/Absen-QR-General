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

    // Chart.js instance for arrival timeline
    arrivalChart: null
  };

  // Demo Fallback Data (When Google Apps Script URL is not set yet)
  const mockData = {
    success: true,
    meta: { eventName: "Presensi Gerakan Subuh Berjamaah" },
    sessions: [
      { id: "SESI-01", name: "Sesi 01: Pembukaan", status: "SELESAI" },
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

    // Distribusi jam kedatangan demo (paling ramai sekitar 04:15 - 04:35)
    const timesPool = [
      "04:05", "04:10",
      "04:15", "04:18", "04:20", "04:22", "04:25",
      "04:28", "04:30", "04:32", "04:35", "04:38",
      "04:45", "04:50", "05:00", "05:15"
    ];

    const list = [];
    for (let i = 1; i <= count; i++) {
      const pad = String(i).padStart(3, '0');
      const isLaki = i % 2 !== 0;
      const genderVal = isLaki ? "Laki-laki" : "Perempuan";
      const isAttended02 = Math.random() < (isLaki ? 0.82 : 0.72);
      const timeStr = isAttended02 ? timesPool[Math.floor(Math.random() * timesPool.length)] : "";

      list.push({
        ticketId: `MSU-GSB-${pad}`,
        name: isLaki ? `Jamaah Putra ${pad}` : `Jamaah Putri ${pad}`,
        email: `peserta${pad}@example.com`,
        phone: `62812${Math.floor(10000000 + Math.random() * 90000000)}`,
        custom: {
          "Jenis Kelamin": genderVal,
          "Instansi / Masjid": instansi[i % instansi.length],
          "Kategori Peserta": i % 5 === 0 ? "Pengurus" : "Jamaah Umum"
        },
        sessions: {
          "SESI-01": { status: "HADIR", checkInTime: "04:15" },
          "SESI-02": { status: isAttended02 ? "HADIR" : "BELUM_HADIR", checkInTime: timeStr },
          "SESI-03": { status: "BELUM_HADIR", checkInTime: "" }
        }
      });
    }
    return list;
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
  }

  function initListeners() {
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

    // Category / Dimension dropdown
    const selectDimension = document.getElementById("select-dimension");
    if (selectDimension) {
      selectDimension.addEventListener("change", (e) => {
        state.selectedDimension = e.target.value;
        state.drilldownValue = ""; // reset drilldown
        state.currentPage = 1;
        updateView();
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

      // Set default active session (prioritaskan sesi yang berstatus AKTIF)
      if (!state.selectedSessionId && state.sessions.length > 0) {
        const activeSess = state.sessions.find(s => s.status === "AKTIF");
        state.selectedSessionId = activeSess ? activeSess.id : state.sessions[0].id;
      }

      // Populate Session dropdown
      populateSessionDropdown();

      // Populate Category dropdown
      populateDimensionDropdown();

      // Update View
      updateView();

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
    const sel = document.getElementById("select-dimension");
    if (!sel) return;

    const prev = state.selectedDimension;
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

    // Prioritaskan Gender jika ada, atau kembalikan pilihan sebelumnya
    if (prev && (prev === "NONE" || prev === "GENDER_AUTO" || state.dimensions.some(d => d.name === prev))) {
      sel.value = prev;
    } else if (state.detectedGenderCol) {
      sel.value = "GENDER_AUTO";
      state.selectedDimension = "GENDER_AUTO";
    } else if (state.dimensions.length > 0) {
      sel.value = state.dimensions[0].name;
      state.selectedDimension = state.dimensions[0].name;
    } else {
      sel.value = "NONE";
      state.selectedDimension = "NONE";
    }
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

    state.attendees.forEach(att => {
      const sess = att.sessions[state.selectedSessionId];
      if (sess && (sess.status === "HADIR" || sess.status === "CHECKOUT")) {
        attended++;
      }
    });

    const absent = Math.max(0, total - attended);
    const attendedPct = total > 0 ? ((attended / total) * 100).toFixed(1) : "0";
    const absentPct = total > 0 ? ((absent / total) * 100).toFixed(1) : "0";

    // Set DOM numbers
    const elTotal = document.getElementById("kpi-total-registered");
    const elAttended = document.getElementById("kpi-total-attended");
    const elAbsent = document.getElementById("kpi-total-absent");
    const elAttPct = document.getElementById("kpi-attendance-pct");
    const elAbsPct = document.getElementById("kpi-absent-pct");

    if (elTotal) elTotal.textContent = `${total} Orang`;
    if (elAttended) elAttended.textContent = `${attended} Orang`;
    if (elAbsent) elAbsent.textContent = `${absent} Orang`;
    if (elAttPct) elAttPct.textContent = `(${attendedPct}%)`;
    if (elAbsPct) elAbsPct.textContent = `(${absentPct}%)`;

    // Progress Bar
    const progBar = document.getElementById("main-progress-bar");
    const progText = document.getElementById("progress-summary-text");
    if (progBar) progBar.style.width = `${attendedPct}%`;
    if (progText) progText.textContent = `${attended} dari ${total} orang hadir (${attendedPct}%)`;

    // Tab counts
    const tabAll = document.getElementById("tab-count-all");
    const tabHadir = document.getElementById("tab-count-hadir");
    const tabBelum = document.getElementById("tab-count-belum");
    if (tabAll) tabAll.textContent = total;
    if (tabHadir) tabHadir.textContent = attended;
    if (tabBelum) tabBelum.textContent = absent;
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
        <div class="dash-group-card ${isSelected ? 'active-selected' : ''}" onclick="window.EventPassSimple.selectGroup('${escapeJs(cat)}')">
          <div class="dash-group-header">
            <span class="dash-group-name">${escapeHtml(cat)}</span>
            <span class="dash-group-total">${g.total} Orang</span>
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
  // ARUS KEDATANGAN (JAM PALING BANYAK HADIR)
  // ============================================================================
  function renderArrivalHoursChart(forceRecreate = false) {
    const ctx = document.getElementById("chart-arrival-hours");
    const peakBadge = document.getElementById("peak-arrival-badge");
    const peakTimeEl = document.getElementById("peak-arrival-time");
    if (!ctx) return;

    // Kumpulkan waktu check-in peserta pada sesi yang aktif
    const rawTimes = [];
    state.attendees.forEach(att => {
      const sess = att.sessions[state.selectedSessionId];
      if (sess && (sess.status === "HADIR" || sess.status === "CHECKOUT") && sess.checkInTime) {
        const match = String(sess.checkInTime).match(/(\d{1,2}):(\d{2})/);
        if (match) {
          const hour = parseInt(match[1], 10);
          const minute = parseInt(match[2], 10);
          rawTimes.push(hour * 60 + minute);
        }
      }
    });

    let labels = [];
    let counts = [];
    let maxSlot = "";
    let maxCount = 0;

    if (rawTimes.length > 0) {
      rawTimes.sort((a, b) => a - b);
      const spanMin = rawTimes[rawTimes.length - 1] - rawTimes[0];

      // Adaptive bucket size: if short event (< 90m) use 5m, if long event (> 10h) use 30m, else 15m
      let stepMin = 15;
      if (spanMin <= 90) {
        stepMin = 5;
      } else if (spanMin > 600) {
        stepMin = 30;
      }

      // Beri sedikit padding 1 step di awal dan akhir agar kurva melandai indah dari/ke 0
      const minMin = Math.max(0, Math.floor(rawTimes[0] / stepMin) * stepMin - stepMin);
      const maxMin = Math.min(1440 - stepMin, Math.ceil(rawTimes[rawTimes.length - 1] / stepMin) * stepMin + stepMin);

      // Buat interval waktu kontinu agar garis kurva naik-turun alami
      const timeBuckets = {};
      for (let m = minMin; m <= maxMin; m += stepMin) {
        const hStr = String(Math.floor(m / 60)).padStart(2, "0");
        const mStr = String(m % 60).padStart(2, "0");
        timeBuckets[`${hStr}:${mStr}`] = 0;
      }

      // Hitung akumulasi kedatangan pada tiap slot waktu
      rawTimes.forEach(t => {
        const slotM = Math.floor(t / stepMin) * stepMin;
        const hStr = String(Math.floor(slotM / 60)).padStart(2, "0");
        const mStr = String(slotM % 60).padStart(2, "0");
        const slotKey = `${hStr}:${mStr}`;
        if (timeBuckets[slotKey] !== undefined) {
          timeBuckets[slotKey]++;
        } else {
          timeBuckets[slotKey] = 1;
        }
      });

      labels = Object.keys(timeBuckets).sort();
      counts = labels.map(s => timeBuckets[s]);

      // Cari puncak arus kedatangan (rush hour)
      labels.forEach(s => {
        if (timeBuckets[s] > maxCount) {
          maxCount = timeBuckets[s];
          maxSlot = s;
        }
      });
    }

    if (peakBadge && peakTimeEl) {
      if (maxCount > 0) {
        peakBadge.style.display = "inline-flex";
        peakTimeEl.textContent = `Pukul ${maxSlot} WIB (${maxCount} orang)`;
      } else {
        peakBadge.style.display = "none";
      }
    }

    if (labels.length === 0) {
      labels = ["Belum ada waktu scan"];
      counts = [0];
    }

    const isDark = (state.theme === "dark");
    const lineColor = isDark ? "#4ade80" : "#0d532d";
    const textColor = isDark ? "#9eb5a5" : "#334d3d";
    const gridColor = isDark ? "rgba(255, 255, 255, 0.06)" : "rgba(13, 83, 45, 0.08)";

    // Fallback jika Chart.js belum terload atau offline
    if (typeof Chart === "undefined") {
      renderPureHtmlArrivalBars(ctx, labels, counts, maxCount);
      return;
    }

    // Kembalikan canvas jika sebelumnya disembunyikan oleh fallback
    ctx.style.display = "block";
    const oldFallback = ctx.parentElement ? ctx.parentElement.querySelector(".dash-pure-bars") : null;
    if (oldFallback) oldFallback.remove();

    // Buat efek gradien area lembut di bawah kurva garis
    let areaBg = isDark ? "rgba(74, 222, 128, 0.18)" : "rgba(13, 83, 45, 0.12)";
    try {
      const ctx2d = ctx.getContext('2d');
      const gradient = ctx2d.createLinearGradient(0, 0, 0, 180);
      if (isDark) {
        gradient.addColorStop(0, 'rgba(74, 222, 128, 0.35)');
        gradient.addColorStop(1, 'rgba(74, 222, 128, 0.01)');
      } else {
        gradient.addColorStop(0, 'rgba(13, 83, 45, 0.25)');
        gradient.addColorStop(1, 'rgba(13, 83, 45, 0.01)');
      }
      areaBg = gradient;
    } catch (e) {}

    if (state.arrivalChart && !forceRecreate) {
      state.arrivalChart.data.labels = labels;
      state.arrivalChart.data.datasets[0].data = counts;
      state.arrivalChart.data.datasets[0].borderColor = lineColor;
      state.arrivalChart.data.datasets[0].backgroundColor = areaBg;
      state.arrivalChart.data.datasets[0].pointBackgroundColor = lineColor;
      state.arrivalChart.data.datasets[0].pointHoverBackgroundColor = lineColor;
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
        datasets: [{
          label: 'Jumlah Kedatangan',
          data: counts,
          borderColor: lineColor,
          backgroundColor: areaBg,
          fill: true,
          tension: 0.35, // Kurva mulus bezier
          borderWidth: 2.8,
          pointBackgroundColor: lineColor,
          pointBorderColor: isDark ? '#132218' : '#ffffff',
          pointBorderWidth: 2,
          pointRadius: 4,
          pointHoverRadius: 7,
          pointHoverBackgroundColor: lineColor,
          pointHoverBorderColor: '#ffffff',
          pointHoverBorderWidth: 2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'index',
          intersect: false
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: 'rgba(12, 31, 20, 0.92)',
            cornerRadius: 8,
            padding: 10,
            callbacks: {
              title: (items) => `Waktu: ${items[0].label} WIB`,
              label: (ctx) => `${ctx.parsed.y} orang hadir pada rentang ini`
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
  function renderPureHtmlArrivalBars(canvasEl, labels, counts, maxCount) {
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
    fallbackDiv.innerHTML = labels.map((lbl, idx) => {
      const c = counts[idx] || 0;
      const pct = Math.round((c / safeMax) * 100);
      return `
        <div style="flex: 1; display: flex; flex-direction: column; align-items: center; height: 100%; justify-content: flex-end;">
          <span style="font-size: 0.72rem; font-weight: 700; color: var(--dash-green); margin-bottom: 4px;">${c > 0 ? c : ''}</span>
          <div style="width: 100%; max-width: 44px; height: ${Math.max(4, pct)}%; background: var(--dash-green); border-radius: 6px 6px 0 0; min-height: 4px;"></div>
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
        if (state.statusFilter === "HADIR" && !isAttended) return false;
        if (state.statusFilter === "BELUM_HADIR" && isAttended) return false;
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

    const rowsHtml = pageRows.map((att, idx) => {
      const seq = startIdx + idx + 1;
      const sess = att.sessions[state.selectedSessionId] || { status: "BELUM_HADIR", checkInTime: "" };
      const isAttended = (sess.status === "HADIR" || sess.status === "CHECKOUT");

      // Clean Status Badge
      const statusBadge = isAttended
        ? `<span class="dash-badge dash-badge-hadir">
             <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"></polyline></svg>
             Hadir
           </span>`
        : `<span class="dash-badge dash-badge-belum">
             Belum Hadir
           </span>`;

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
          <td style="color: var(--dash-text-muted); font-size: 0.82rem;">${sess.checkInTime || "-"}</td>
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
  // EXPORT CSV
  // ============================================================================
  function exportCsv() {
    const filtered = getFilteredAttendees();
    if (filtered.length === 0) {
      alert("Tidak ada data peserta untuk diunduh.");
      return;
    }

    const dimName = getEffectiveDimensionName() || "Kategori";
    const headers = ["No", "ID Tiket", "Nama Peserta", dimName, "Status Kehadiran", "Waktu Hadir", "Nomor WhatsApp"];

    const rows = filtered.map((att, idx) => {
      const sess = att.sessions[state.selectedSessionId] || { status: "BELUM_HADIR", checkInTime: "" };
      const isAttended = (sess.status === "HADIR" || sess.status === "CHECKOUT");
      const catVal = (att.custom && dimName && att.custom[dimName]) ? att.custom[dimName] : "";

      return [
        idx + 1,
        `"${att.ticketId}"`,
        `"${att.name.replace(/"/g, '""')}"`,
        `"${catVal.replace(/"/g, '""')}"`,
        isAttended ? "Hadir" : "Belum Hadir",
        `"${sess.checkInTime || ''}"`,
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
    selectGroup: (catName) => {
      state.drilldownValue = (state.drilldownValue === catName) ? "" : catName;
      state.currentPage = 1;
      updateView();
    }
  };

})();
