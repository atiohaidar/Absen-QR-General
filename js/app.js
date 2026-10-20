/**
 * ==============================================================================
 * QR ATTENDANCE SCANNER CONTROLLER (GitHub Pages Frontend)
 * ==============================================================================
 */

// App State
const state = {
  html5QrCode: null,
  isScanning: false,
  isProcessing: false,
  currentCameraId: null,
  cameras: [],
  isTorchOn: false,
  autoResumeTimer: null,
  
  // Settings (Persisted in localStorage)
  panitiaName: localStorage.getItem("absen_panitia_name") || "Panitia Gate 1",
  gateName: localStorage.getItem("absen_gate_name") || "Pintu Masuk Utama",
  apiUrl: localStorage.getItem("absen_api_url") || "",

  // Session Stats
  stats: {
    total: 0,
    success: 0,
    duplicate: 0,
    invalid: 0
  },
  history: JSON.parse(localStorage.getItem("absen_history") || "[]")
};

// Web Audio API Synthesizer (Zero external audio file dependency!)
class SoundSynthesizer {
  constructor() {
    this.ctx = null;
  }

  init() {
    if (!this.ctx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) {
        this.ctx = new AudioContext();
      }
    }
    if (this.ctx && this.ctx.state === "suspended") {
      this.ctx.resume();
    }
  }

  playSuccess() {
    this.init();
    if (!this.ctx) return;
    try {
      const now = this.ctx.currentTime;
      const osc1 = this.ctx.createOscillator();
      const osc2 = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc1.type = "sine";
      osc2.type = "sine";

      // Two-tone cheerful major chord: C5 (523Hz) -> E5 (659Hz)
      osc1.frequency.setValueAtTime(523.25, now);
      osc1.frequency.exponentialRampToValueAtTime(659.25, now + 0.12);

      gain.gain.setValueAtTime(0.3, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.35);

      osc1.connect(gain);
      gain.connect(this.ctx.destination);

      osc1.start(now);
      osc1.stop(now + 0.35);
    } catch (e) {
      console.warn("Audio play error:", e);
    }
  }

  playWarning() {
    this.init();
    if (!this.ctx) return;
    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = "triangle";
      // Double pulse alert: 440Hz -> 330Hz
      osc.frequency.setValueAtTime(440, now);
      osc.frequency.setValueAtTime(330, now + 0.12);

      gain.gain.setValueAtTime(0.4, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.4);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(now);
      osc.stop(now + 0.4);
    } catch (e) {
      console.warn("Audio play error:", e);
    }
  }

  playError() {
    this.init();
    if (!this.ctx) return;
    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = "sawtooth";
      // Low buzzer: 160Hz
      osc.frequency.setValueAtTime(160, now);

      gain.gain.setValueAtTime(0.35, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.45);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(now);
      osc.stop(now + 0.45);
    } catch (e) {
      console.warn("Audio play error:", e);
    }
  }
}

const sounds = new SoundSynthesizer();

// DOM Elements
const DOM = {
  operatorBadge: document.getElementById("operator-badge-text"),
  statTotal: document.getElementById("stat-total"),
  tabButtons: document.querySelectorAll(".tab-btn"),
  tabPanes: document.querySelectorAll(".tab-pane"),
  
  // Global Loading Bar & HUD
  globalLoadingBar: document.getElementById("global-loading-bar"),
  scannerLoadingHud: document.getElementById("scanner-loading-hud"),
  hudTicketId: document.getElementById("hud-ticket-id"),

  // Scanner UI
  scannerContainer: document.getElementById("qr-video-reader"),
  statusLabel: document.getElementById("scanner-status-label"),
  statusSub: document.getElementById("scanner-status-sub"),
  verifyingBox: document.getElementById("verifying-box"),
  verifyingText: document.getElementById("verifying-text"),
  btnFlipCam: document.getElementById("btn-flip-cam"),
  btnTorch: document.getElementById("btn-toggle-torch"),

  // Result Modal
  resultModal: document.getElementById("scan-result-modal"),
  resultBanner: document.getElementById("result-banner"),
  resultIcon: document.getElementById("result-icon"),
  resultTitle: document.getElementById("result-title"),
  resultSubtitle: document.getElementById("result-subtitle"),
  detailName: document.getElementById("detail-name"),
  detailTicketId: document.getElementById("detail-ticket-id"),
  detailEmail: document.getElementById("detail-email"),
  detailTime: document.getElementById("detail-time"),
  detailOfficer: document.getElementById("detail-officer"),
  countdownBar: document.getElementById("countdown-bar"),
  btnNextScan: document.getElementById("btn-next-scan"),

  // Settings Modal
  btnOpenSettings: document.getElementById("btn-open-settings"),
  settingsModal: document.getElementById("settings-modal"),
  btnCloseSettings: document.getElementById("btn-close-settings"),
  inputPanitiaName: document.getElementById("cfg-panitia-name"),
  inputGateName: document.getElementById("cfg-gate-name"),
  inputApiUrl: document.getElementById("cfg-api-url"),
  btnTestConnection: document.getElementById("btn-test-connection"),
  btnSaveSettings: document.getElementById("btn-save-settings"),

  // Manual Tab
  inputManualId: document.getElementById("manual-ticket-id"),
  btnManualCheckin: document.getElementById("btn-manual-checkin"),
  inputManualSearch: document.getElementById("manual-search-query"),
  btnSearchQuery: document.getElementById("btn-search-query"),
  searchResultsList: document.getElementById("search-results-list"),

  // History Tab
  historyList: document.getElementById("history-list"),
  btnClearHistory: document.getElementById("btn-clear-history"),

  // Toast
  toast: document.getElementById("toast-notice"),
  toastMsg: document.getElementById("toast-msg")
};

// ==========================================
// INITIALIZATION
// ==========================================
document.addEventListener("DOMContentLoaded", () => {
  renderOperatorHeader();
  renderHistory();
  setupTabNavigation();
  setupSettingsModal();
  setupManualActions();
  initScanner();

  // Prompt setup jika API URL belum diisi
  if (!state.apiUrl) {
    setTimeout(() => {
      openSettingsModal();
      showToast("⚠️ Silakan masukkan Apps Script API URL terlebih dahulu.");
    }, 600);
  }
});

function renderOperatorHeader() {
  if (DOM.operatorBadge) {
    DOM.operatorBadge.textContent = `${state.panitiaName} • ${state.gateName}`;
  }
  if (DOM.statTotal) {
    DOM.statTotal.textContent = state.stats.total;
  }
}

function showToast(message, duration = 3000) {
  if (!DOM.toast) return;
  DOM.toastMsg.textContent = message;
  DOM.toast.classList.add("show");
  setTimeout(() => {
    DOM.toast.classList.remove("show");
  }, duration);
}

// ==========================================
// TAB NAVIGATION
// ==========================================
function setupTabNavigation() {
  DOM.tabButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      const targetTab = btn.getAttribute("data-tab");

      DOM.tabButtons.forEach(b => b.classList.remove("active"));
      DOM.tabPanes.forEach(p => p.classList.remove("active"));

      btn.classList.add("active");
      const activePane = document.getElementById(`tab-${targetTab}`);
      if (activePane) activePane.classList.add("active");

      // Pause/resume scanner based on tab
      if (targetTab === "scan") {
        if (!state.isScanning && state.html5QrCode) {
          startScanning();
        }
      } else {
        if (state.isScanning && state.html5QrCode) {
          stopScanning();
        }
      }
    });
  });
}

// ==========================================
// QR CODE SCANNER ENGINE
// ==========================================
async function initScanner() {
  try {
    state.html5QrCode = new Html5Qrcode("qr-video-reader");
    
    const devices = await Html5Qrcode.getCameras();
    if (devices && devices.length > 0) {
      state.cameras = devices;
      // Utamakan kamera belakang (environment)
      const backCam = devices.find(d => 
        d.label.toLowerCase().includes("back") || 
        d.label.toLowerCase().includes("belakang") || 
        d.label.toLowerCase().includes("rear")
      );
      state.currentCameraId = backCam ? backCam.id : devices[devices.length - 1].id;

      startScanning();
    } else {
      updateScannerStatus("Tidak ada kamera terdeteksi", "Gunakan tab Manual Check-In");
    }
  } catch (err) {
    console.error("Camera init error:", err);
    updateScannerStatus("Izin kamera belum diberikan", "Buka izin akses kamera browser");
  }
}

async function startScanning() {
  if (!state.html5QrCode || state.isScanning) return;

  try {
    const config = {
      fps: 15,
      qrbox: { width: 250, height: 250 },
      aspectRatio: 1.0
    };

    await state.html5QrCode.start(
      state.currentCameraId,
      config,
      onQrCodeSuccess,
      onQrCodeProgress
    );

    state.isScanning = true;
    updateScannerStatus("Siap Memindai", "Arahkan kamera ke QR Code tiket peserta");
  } catch (err) {
    console.error("Start scanning error:", err);
    updateScannerStatus("Kamera offline", "Klik coba lagi atau gunakan input manual");
  }
}

async function stopScanning() {
  if (state.html5QrCode && state.isScanning) {
    try {
      await state.html5QrCode.stop();
      state.isScanning = false;
    } catch (e) {
      console.warn("Stop scanner error:", e);
    }
  }
}

// Event triggered saat QR Code terbaca
function onQrCodeSuccess(decodedText) {
  if (state.isProcessing) return; // Mencegah double scan saat sedang request API
  
  const ticketId = decodedText.trim();
  if (!ticketId) return;

  processCheckIn(ticketId);
}

function onQrCodeProgress(error) {
  // Silent frame scan callback
}

function updateScannerStatus(title, sub) {
  if (DOM.statusLabel) DOM.statusLabel.textContent = title;
  if (DOM.statusSub) DOM.statusSub.textContent = sub;
}

// Camera Flip Handler
if (DOM.btnFlipCam) {
  DOM.btnFlipCam.addEventListener("click", async () => {
    if (state.cameras.length <= 1) {
      showToast("Hanya 1 kamera tersedia pada perangkat ini.");
      return;
    }

    const currentIndex = state.cameras.findIndex(c => c.id === state.currentCameraId);
    const nextIndex = (currentIndex + 1) % state.cameras.length;
    state.currentCameraId = state.cameras[nextIndex].id;

    await stopScanning();
    await startScanning();
    showToast(`Beralih ke: ${state.cameras[nextIndex].label || "Kamera " + (nextIndex + 1)}`);
  });
}

// Torch / Flashlight Toggle Handler
if (DOM.btnTorch) {
  DOM.btnTorch.addEventListener("click", async () => {
    try {
      state.isTorchOn = !state.isTorchOn;
      await state.html5QrCode.applyVideoConstraints({
        advanced: [{ torch: state.isTorchOn }]
      });
      DOM.btnTorch.classList.toggle("active", state.isTorchOn);
      showToast(state.isTorchOn ? "Senter Nyala 🔦" : "Senter Mati");
    } catch (e) {
      showToast("Perangkat tidak mendukung kontrol lampu senter.");
      state.isTorchOn = false;
      DOM.btnTorch.classList.remove("active");
    }
  });
}

// ==========================================
// CHECK-IN API PROCESSOR (ANTI-HANG UX)
// ==========================================
async function processCheckIn(ticketId, sourceButton = null) {
  if (state.isProcessing) return;
  state.isProcessing = true;

  // Active micro-animation feedback (Anti-Hang)
  sounds.init(); // Warm-up audio

  // 1. Show Global Top Loading Bar
  if (DOM.globalLoadingBar) DOM.globalLoadingBar.classList.add("active");

  // 2. Show Viewport Center Loading HUD
  if (DOM.scannerLoadingHud) {
    DOM.scannerLoadingHud.classList.add("show");
    if (DOM.hudTicketId) DOM.hudTicketId.textContent = ticketId;
  }

  // 3. Update Manual Button State
  if (DOM.btnManualCheckin) {
    DOM.btnManualCheckin.disabled = true;
    DOM.btnManualCheckin.classList.add("btn-loading");
    DOM.btnManualCheckin.innerHTML = `<div class="spinner"></div><span>Memproses...</span>`;
  }
  if (DOM.inputManualId) DOM.inputManualId.disabled = true;

  // 4. Update Source Button (if clicked from search list)
  if (sourceButton) {
    sourceButton.disabled = true;
    sourceButton.classList.add("btn-loading");
    sourceButton.innerHTML = `<div class="spinner" style="width:10px;height:10px;border-width:1.5px;display:inline-block;vertical-align:middle;margin-right:4px;"></div> Memproses...`;
  }

  if (DOM.verifyingBox) DOM.verifyingBox.style.display = "inline-flex";
  if (DOM.verifyingText) DOM.verifyingText.textContent = `Memverifikasi ${ticketId}...`;
  updateScannerStatus("Memproses...", `Menghubungi server Apps Script...`);

  // Haptic feedback (getar halus di HP panitia)
  if (navigator.vibrate) navigator.vibrate(60);

  // Validasi URL API
  if (!state.apiUrl) {
    finishProcessing(sourceButton);
    openSettingsModal();
    showToast("⚠️ URL API Google Apps Script belum disetting!");
    return;
  }

  const payload = {
    action: "checkIn",
    ticketId: ticketId,
    scannedBy: state.panitiaName,
    gate: state.gateName
  };

  try {
    // IMPORTANT: Kirim string JSON langsung tanpa custom header agar bypass preflight CORS Google Apps Script!
    const response = await fetch(state.apiUrl, {
      method: "POST",
      body: JSON.stringify(payload)
    });

    const result = await response.json();
    handleCheckInResponse(ticketId, result);
  } catch (err) {
    console.error("API Call error:", err);
    sounds.playError();
    showResultModal({
      type: "error",
      title: "Koneksi Gagal",
      subtitle: "Gagal terhubung ke Google Apps Script.",
      name: "-",
      ticketId: ticketId,
      email: "-",
      time: new Date().toLocaleTimeString(),
      officer: state.panitiaName
    });
    recordHistory({
      ticketId: ticketId,
      name: "Koneksi Gagal",
      status: "ERROR",
      time: new Date().toLocaleTimeString()
    });
  } finally {
    finishProcessing(sourceButton);
  }
}

function finishProcessing(sourceButton = null) {
  // Hide Top Loading Bar & HUD
  if (DOM.globalLoadingBar) DOM.globalLoadingBar.classList.remove("active");
  if (DOM.scannerLoadingHud) DOM.scannerLoadingHud.classList.remove("show");

  // Restore Manual Button State
  if (DOM.btnManualCheckin) {
    DOM.btnManualCheckin.disabled = false;
    DOM.btnManualCheckin.classList.remove("btn-loading");
    DOM.btnManualCheckin.innerHTML = `Check In`;
  }
  if (DOM.inputManualId) DOM.inputManualId.disabled = false;

  // Restore Source Button
  if (sourceButton) {
    sourceButton.disabled = false;
    sourceButton.classList.remove("btn-loading");
    sourceButton.innerHTML = `Check In`;
  }

  if (DOM.verifyingBox) DOM.verifyingBox.style.display = "none";
  updateScannerStatus("Siap Memindai", "Arahkan kamera ke QR Code tiket peserta");
}

function handleCheckInResponse(scannedTicketId, res) {
  const attendee = res.attendee || {};
  const attendeeName = attendee.name || "Peserta";
  const attendeeEmail = attendee.email || "-";
  const checkTime = attendee.checkInTime || attendee.firstCheckInTime || new Date().toLocaleTimeString();
  const officer = attendee.scannedBy || state.panitiaName;

  if (res.success && res.status === "CHECKED_IN") {
    // ------------------------------------
    // SUCCESS: CHECK-IN BERHASIL
    // ------------------------------------
    sounds.playSuccess();
    if (navigator.vibrate) navigator.vibrate([100, 50, 100]);

    state.stats.total++;
    state.stats.success++;
    DOM.statTotal.textContent = state.stats.total;

    showResultModal({
      type: "success",
      title: "CHECK-IN BERHASIL! 🎉",
      subtitle: "Akses Terverifikasi • Selamat Datang",
      name: attendeeName,
      ticketId: attendee.ticketId || scannedTicketId,
      email: attendeeEmail,
      time: checkTime,
      officer: officer
    });

    recordHistory({
      ticketId: scannedTicketId,
      name: attendeeName,
      status: "SUCCESS",
      time: checkTime
    });

  } else if (res.status === "ALREADY_CHECKED_IN") {
    // ------------------------------------
    // WARNING: DUPLICATE SCAN
    // ------------------------------------
    sounds.playWarning();
    if (navigator.vibrate) navigator.vibrate([200, 100, 200]);

    state.stats.total++;
    state.stats.duplicate++;
    DOM.statTotal.textContent = state.stats.total;

    showResultModal({
      type: "warning",
      title: "TIKET SUDAH DIPAKAI! ⚠️",
      subtitle: `Pertama kali di-scan: ${checkTime} (${attendee.scannedBy || "Gate lain"})`,
      name: attendeeName,
      ticketId: attendee.ticketId || scannedTicketId,
      email: attendeeEmail,
      time: checkTime,
      officer: attendee.scannedBy || "Petugas lain"
    });

    recordHistory({
      ticketId: scannedTicketId,
      name: attendeeName,
      status: "DUPLICATE",
      time: checkTime
    });

  } else {
    // ------------------------------------
    // ERROR: TIKET TIDAK VALID / NOT FOUND
    // ------------------------------------
    sounds.playError();
    if (navigator.vibrate) navigator.vibrate(300);

    state.stats.total++;
    state.stats.invalid++;
    DOM.statTotal.textContent = state.stats.total;

    showResultModal({
      type: "error",
      title: "TIKET TIDAK VALID! ❌",
      subtitle: res.message || "ID tidak ditemukan di database pendaftaran.",
      name: "Tidak Terdaftar",
      ticketId: scannedTicketId,
      email: "-",
      time: new Date().toLocaleTimeString(),
      officer: state.panitiaName
    });

    recordHistory({
      ticketId: scannedTicketId,
      name: "Tidak Terdaftar",
      status: "INVALID",
      time: new Date().toLocaleTimeString()
    });
  }
}

// ==========================================
// RESULT MODAL & AUTO-RESUME
// ==========================================
function showResultModal(data) {
  // Set banner class (success / warning / error)
  DOM.resultBanner.className = `result-banner ${data.type}`;
  
  if (data.type === "success") {
    DOM.resultIcon.textContent = "✓";
  } else if (data.type === "warning") {
    DOM.resultIcon.textContent = "!";
  } else {
    DOM.resultIcon.textContent = "✕";
  }

  DOM.resultTitle.textContent = data.title;
  DOM.resultSubtitle.textContent = data.subtitle;
  DOM.detailName.textContent = data.name;
  DOM.detailTicketId.textContent = data.ticketId;
  DOM.detailEmail.textContent = data.email;
  DOM.detailTime.textContent = data.time;
  DOM.detailOfficer.textContent = data.officer;

  // Reset Countdown animation
  if (DOM.countdownBar) {
    DOM.countdownBar.style.transition = "none";
    DOM.countdownBar.style.transform = "scaleX(1)";
    setTimeout(() => {
      DOM.countdownBar.style.transition = "transform 2.5s linear";
      DOM.countdownBar.style.transform = "scaleX(0)";
    }, 50);
  }

  DOM.resultModal.classList.add("show");

  // Auto-dismiss setelah 2.5 detik
  clearTimeout(state.autoResumeTimer);
  state.autoResumeTimer = setTimeout(() => {
    closeResultModal();
  }, 2600);
}

function closeResultModal() {
  clearTimeout(state.autoResumeTimer);
  DOM.resultModal.classList.remove("show");
  state.isProcessing = false;
}

if (DOM.btnNextScan) {
  DOM.btnNextScan.addEventListener("click", () => {
    closeResultModal();
  });
}

// ==========================================
// MANUAL TAB (SEARCH & CHECK-IN)
// ==========================================
function setupManualActions() {
  // Check-In by direct ID input
  if (DOM.btnManualCheckin) {
    DOM.btnManualCheckin.addEventListener("click", () => {
      const id = DOM.inputManualId.value.trim();
      if (!id) {
        showToast("Masukkan ID Tiket terlebih dahulu!");
        return;
      }
      processCheckIn(id);
    });
  }

  // Search by Name / Email
  if (DOM.btnSearchQuery) {
    DOM.btnSearchQuery.addEventListener("click", performSearch);
  }
  if (DOM.inputManualSearch) {
    DOM.inputManualSearch.addEventListener("keyup", (e) => {
      if (e.key === "Enter") performSearch();
    });
  }
}

async function performSearch() {
  const query = DOM.inputManualSearch.value.trim();
  if (!query) {
    showToast("Ketik nama atau email yang dicari.");
    return;
  }

  // Show top loading bar & button loading state
  if (DOM.globalLoadingBar) DOM.globalLoadingBar.classList.add("active");
  if (DOM.btnSearchQuery) {
    DOM.btnSearchQuery.disabled = true;
    DOM.btnSearchQuery.classList.add("btn-loading");
    DOM.btnSearchQuery.innerHTML = `<div class="spinner"></div><span>Mencari...</span>`;
  }
  if (DOM.inputManualSearch) DOM.inputManualSearch.disabled = true;

  DOM.searchResultsList.innerHTML = `
    <div style="text-align: center; color: var(--text-muted); padding: 20px; display: flex; align-items: center; justify-content: center; gap: 8px;">
      <div class="spinner"></div>
      <span>Mencari data dari spreadsheet...</span>
    </div>
  `;

  try {
    const res = await fetch(state.apiUrl, {
      method: "POST",
      body: JSON.stringify({ action: "search", query: query })
    });
    const data = await res.json();

    if (data.results && data.results.length > 0) {
      DOM.searchResultsList.innerHTML = "";
      data.results.forEach(item => {
        const div = document.createElement("div");
        div.className = "search-result-item";
        
        const isChecked = item.status === "CHECKED_IN";
        const statusBadge = isChecked 
          ? `<span class="badge badge-warning">Sudah Check-In</span>` 
          : `<span class="badge badge-success">Belum Masuk</span>`;

        div.innerHTML = `
          <div>
            <div class="attendee-name">${escapeHtml(item.name)} ${statusBadge}</div>
            <div class="attendee-sub">${escapeHtml(item.ticketId)} • ${escapeHtml(item.email)}</div>
          </div>
          <div>
            <button class="btn-checkin-sm" data-id="${escapeHtml(item.ticketId)}">
              ${isChecked ? "Cek Ulang" : "Check In"}
            </button>
          </div>
        `;
        DOM.searchResultsList.appendChild(div);
      });

      // Bind button events with source button indicator
      DOM.searchResultsList.querySelectorAll(".btn-checkin-sm").forEach(btn => {
        btn.addEventListener("click", (e) => {
          const tId = e.currentTarget.getAttribute("data-id");
          processCheckIn(tId, e.currentTarget);
        });
      });
    } else {
      DOM.searchResultsList.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 20px;">Tidak ada peserta yang cocok dengan "${escapeHtml(query)}"</div>`;
    }
  } catch (err) {
    DOM.searchResultsList.innerHTML = `<div style="text-align: center; color: var(--status-error); padding: 20px;">Gagal mengambil data pencarian. Pastikan API URL benar.</div>`;
  } finally {
    if (DOM.globalLoadingBar) DOM.globalLoadingBar.classList.remove("active");
    if (DOM.btnSearchQuery) {
      DOM.btnSearchQuery.disabled = false;
      DOM.btnSearchQuery.classList.remove("btn-loading");
      DOM.btnSearchQuery.innerHTML = `Cari`;
    }
    if (DOM.inputManualSearch) DOM.inputManualSearch.disabled = false;
  }
}

// ==========================================
// HISTORY TRACKER
// ==========================================
function recordHistory(entry) {
  state.history.unshift(entry);
  if (state.history.length > 50) state.history.pop(); // Keep max 50 recent
  localStorage.setItem("absen_history", JSON.stringify(state.history));
  renderHistory();
}

function renderHistory() {
  if (!DOM.historyList) return;
  if (state.history.length === 0) {
    DOM.historyList.innerHTML = `<div style="text-align: center; color: var(--text-dim); padding: 24px;">Belum ada riwayat pemindaian pada sesi ini.</div>`;
    return;
  }

  DOM.historyList.innerHTML = "";
  state.history.forEach(item => {
    const div = document.createElement("div");
    div.className = "history-item";

    let badgeClass = "badge-success";
    let badgeLabel = "Berhasil";
    if (item.status === "DUPLICATE") {
      badgeClass = "badge-warning";
      badgeLabel = "Duplikat";
    } else if (item.status === "INVALID" || item.status === "ERROR") {
      badgeClass = "badge-error";
      badgeLabel = "Gagal";
    }

    div.innerHTML = `
      <div>
        <div style="font-weight: 600; color: #fff;">${escapeHtml(item.name)}</div>
        <div style="font-size: 11px; color: var(--text-muted);">${escapeHtml(item.ticketId)} • ${escapeHtml(item.time)}</div>
      </div>
      <div>
        <span class="badge ${badgeClass}">${badgeLabel}</span>
      </div>
    `;
    DOM.historyList.appendChild(div);
  });
}

if (DOM.btnClearHistory) {
  DOM.btnClearHistory.addEventListener("click", () => {
    state.history = [];
    localStorage.removeItem("absen_history");
    renderHistory();
    showToast("Riwayat lokal telah dibersihkan.");
  });
}

// ==========================================
// SETTINGS MODAL
// ==========================================
function setupSettingsModal() {
  if (DOM.btnOpenSettings) {
    DOM.btnOpenSettings.addEventListener("click", openSettingsModal);
  }
  if (DOM.btnCloseSettings) {
    DOM.btnCloseSettings.addEventListener("click", closeSettingsModal);
  }

  // Test Connection
  if (DOM.btnTestConnection) {
    DOM.btnTestConnection.addEventListener("click", async () => {
      const url = DOM.inputApiUrl.value.trim();
      if (!url) {
        showToast("Ketik URL API Apps Script terlebih dahulu.");
        return;
      }

      DOM.btnTestConnection.textContent = "Testing...";
      try {
        const res = await fetch(url);
        const data = await res.json();
        if (data.success) {
          showToast("✅ Koneksi Berhasil! API Online.");
        } else {
          showToast("⚠️ Response diterima namun format berbeda.");
        }
      } catch (e) {
        showToast("❌ Gagal terhubung: Pastikan Deploy as Web App (Anyone).");
      } finally {
        DOM.btnTestConnection.textContent = "Test Koneksi";
      }
    });
  }

  // Save Settings
  if (DOM.btnSaveSettings) {
    DOM.btnSaveSettings.addEventListener("click", () => {
      const pName = DOM.inputPanitiaName.value.trim() || "Panitia";
      const gName = DOM.inputGateName.value.trim() || "Pintu Masuk";
      const aUrl = DOM.inputApiUrl.value.trim();

      state.panitiaName = pName;
      state.gateName = gName;
      state.apiUrl = aUrl;

      localStorage.setItem("absen_panitia_name", pName);
      localStorage.setItem("absen_gate_name", gName);
      localStorage.setItem("absen_api_url", aUrl);

      renderOperatorHeader();
      closeSettingsModal();
      showToast("✅ Pengaturan berhasil disimpan!");
    });
  }
}

function openSettingsModal() {
  DOM.inputPanitiaName.value = state.panitiaName;
  DOM.inputGateName.value = state.gateName;
  DOM.inputApiUrl.value = state.apiUrl;
  DOM.settingsModal.classList.add("show");
}

function closeSettingsModal() {
  DOM.settingsModal.classList.remove("show");
}

// Helper: Escape HTML to prevent XSS
function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
