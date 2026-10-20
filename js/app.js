/**
 * ==============================================================================
 * QR ATTENDANCE SCANNER CONTROLLER (MULTI-SESSION & REVERT CAPABLE)
 * ==============================================================================
 */

// App State
const state = {
  mediaStream: null,
  animationFrameId: null,
  isScanning: false,
  isProcessing: false,
  currentFacingMode: "environment", // "environment" (rear) or "user" (front)
  isTorchOn: false,
  autoResumeTimer: null,
  
  // Settings (Persisted in localStorage)
  panitiaName: localStorage.getItem("absen_panitia_name") || "Panitia Gate 1",
  gateName: localStorage.getItem("absen_gate_name") || "Pintu Masuk Utama",
  apiUrl: localStorage.getItem("absen_api_url") || "",

  // Sessions Management
  sessions: JSON.parse(localStorage.getItem("absen_cached_sessions") || "[]"),
  currentSessionId: localStorage.getItem("absen_current_session_id") || "SESI-01",
  currentSessionName: localStorage.getItem("absen_current_session_name") || "Pertemuan 1",

  // Last Scanned Item (for direct cancellation from modal)
  lastScanned: null,

  // Session Stats
  stats: {
    total: 0,
    success: 0,
    duplicate: 0,
    invalid: 0
  },
  history: JSON.parse(localStorage.getItem("absen_history") || "[]")
};

// Web Audio API Synthesizer (Zero external file dependency!)
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
      const gain = this.ctx.createGain();

      osc1.type = "sine";
      // Ascending major chord: C5 (523Hz) -> E5 (659Hz)
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
  // Global Loading Bar & HUD
  globalLoadingBar: document.getElementById("global-loading-bar"),
  scannerLoadingHud: document.getElementById("scanner-loading-hud"),
  hudTicketId: document.getElementById("hud-ticket-id"),

  // Operator & Session
  operatorBadge: document.getElementById("operator-badge-text"),
  statTotal: document.getElementById("stat-total"),
  selectSession: document.getElementById("select-session"),
  btnRefreshSessions: document.getElementById("btn-refresh-sessions"),
  tabButtons: document.querySelectorAll(".tab-btn"),
  tabPanes: document.querySelectorAll(".tab-pane"),
  
  // Scanner UI (Native Video & Canvas for jsQR)
  scanVideo: document.getElementById("scan-video"),
  scanCanvas: document.getElementById("scan-canvas"),
  qrTrackingCanvas: document.getElementById("qr-tracking-canvas"),
  scannerOverlay: document.querySelector(".scanner-overlay"),
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
  btnCancelCheckin: document.getElementById("btn-cancel-checkin"),

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

  // OTS (On-The-Spot) Tab
  formOts: document.getElementById("form-ots"),
  inputOtsName: document.getElementById("ots-name"),
  inputOtsContact: document.getElementById("ots-contact"),
  inputOtsNotes: document.getElementById("ots-notes"),
  btnSubmitOts: document.getElementById("btn-submit-ots"),

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
  renderSessionDropdown();
  renderHistory();
  setupTabNavigation();
  setupSettingsModal();
  setupManualActions();
  setupOtsActions();
  setupCancelAction();
  initScanner();

  // Fetch Sesi terbaru dari Spreadsheet di background
  if (state.apiUrl) {
    fetchSessions();
  } else {
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
// SESSION MANAGEMENT (MASTER SESI)
// ==========================================
async function fetchSessions(isManual = false) {
  if (!state.apiUrl) return;

  if (DOM.btnRefreshSessions) DOM.btnRefreshSessions.classList.add("spinning");
  if (DOM.globalLoadingBar && isManual) DOM.globalLoadingBar.classList.add("active");

  try {
    const res = await fetch(`${state.apiUrl}?action=getSessions`);
    const data = await res.json();

    if (data.success && data.sessions && data.sessions.length > 0) {
      state.sessions = data.sessions;
      localStorage.setItem("absen_cached_sessions", JSON.stringify(data.sessions));
      renderSessionDropdown();
      if (isManual) showToast("✅ Daftar sesi berhasil diperbarui!");
    } else if (isManual) {
      showToast("⚠️ Belum ada sesi berstatus AKTIF di sheet Master Sesi.");
    }
  } catch (err) {
    console.warn("Gagal mengambil sesi:", err);
    if (isManual) showToast("❌ Gagal terhubung ke API sesi.");
  } finally {
    if (DOM.btnRefreshSessions) DOM.btnRefreshSessions.classList.remove("spinning");
    if (DOM.globalLoadingBar) DOM.globalLoadingBar.classList.remove("active");
  }
}

function renderSessionDropdown() {
  if (!DOM.selectSession) return;
  DOM.selectSession.innerHTML = "";

  const list = state.sessions.length > 0 ? state.sessions : [
    { id: "SESI-01", name: "Pertemuan 1 - Pembukaan", label: "Pertemuan 1 - Pembukaan" },
    { id: "SESI-02", name: "Pertemuan 2 - Workshop", label: "Pertemuan 2 - Workshop" }
  ];

  list.forEach(sesi => {
    const opt = document.createElement("option");
    opt.value = sesi.id;
    opt.textContent = sesi.label || sesi.name;
    opt.setAttribute("data-name", sesi.name);
    if (sesi.id === state.currentSessionId) opt.selected = true;
    DOM.selectSession.appendChild(opt);
  });

  // Pastikan currentSessionName sinkron
  const selectedOpt = DOM.selectSession.options[DOM.selectSession.selectedIndex];
  if (selectedOpt) {
    state.currentSessionId = selectedOpt.value;
    state.currentSessionName = selectedOpt.getAttribute("data-name") || selectedOpt.textContent;
  }
}

if (DOM.selectSession) {
  DOM.selectSession.addEventListener("change", (e) => {
    const opt = e.target.options[e.target.selectedIndex];
    state.currentSessionId = e.target.value;
    state.currentSessionName = opt.getAttribute("data-name") || opt.textContent;

    localStorage.setItem("absen_current_session_id", state.currentSessionId);
    localStorage.setItem("absen_current_session_name", state.currentSessionName);

    showToast(`📍 Sesi aktif: ${state.currentSessionName}`);
  });
}

if (DOM.btnRefreshSessions) {
  DOM.btnRefreshSessions.addEventListener("click", () => fetchSessions(true));
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
        if (!state.isScanning) {
          startScanning();
        }
      } else {
        if (state.isScanning) {
          stopScanning();
        }
      }
    });
  });
}

// ==========================================
// TELEGRAM-STYLE DYNAMIC AR QR TRACKER ENGINE
// ==========================================
const nativeBarcodeDetector = ('BarcodeDetector' in window) 
  ? new BarcodeDetector({ formats: ['qr_code'] }) 
  : null;

const qrTracker = {
  currentCorners: null, // [ {x, y}, {x, y}, {x, y}, {x, y} ]
  targetCorners: null,
  detectedText: null,
  lastSeenTime: 0,
  opacity: 0,
  activeScanTriggered: false
};

function mapVideoToDisplay(pt, vW, vH, dW, dH) {
  const videoAspect = vW / vH;
  const displayAspect = dW / dH;
  let scale, offsetX = 0, offsetY = 0;

  if (videoAspect > displayAspect) {
    scale = dH / vH;
    offsetX = (dW - vW * scale) / 2;
  } else {
    scale = dW / vW;
    offsetY = (dH - vH * scale) / 2;
  }

  return {
    x: pt.x * scale + offsetX,
    y: pt.y * scale + offsetY
  };
}

function lerp(start, end, amt) {
  return start + (end - start) * amt;
}

function drawTelegramCornerBracket(ctx, corner, nextPt, prevPt, len) {
  const dxN = nextPt.x - corner.x;
  const dyN = nextPt.y - corner.y;
  const lenN = Math.hypot(dxN, dyN) || 1;
  const uNext = { x: dxN / lenN, y: dyN / lenN };

  const dxP = prevPt.x - corner.x;
  const dyP = prevPt.y - corner.y;
  const lenP = Math.hypot(dxP, dyP) || 1;
  const uPrev = { x: dxP / lenP, y: dyP / lenP };

  ctx.beginPath();
  ctx.moveTo(corner.x + uPrev.x * len, corner.y + uPrev.y * len);
  ctx.lineTo(corner.x, corner.y);
  ctx.lineTo(corner.x + uNext.x * len, corner.y + uNext.y * len);
  ctx.stroke();
}

function drawFloatingTag(ctx, x, y, text, isLocked) {
  ctx.save();
  ctx.font = "bold 12px 'Outfit', sans-serif";
  const paddingH = 12;
  const pillHeight = 26;
  const textWidth = ctx.measureText(text).width;
  const pillWidth = textWidth + paddingH * 2 + 14;
  const pillX = x - pillWidth / 2;
  const pillY = y - pillHeight / 2;

  // Glassmorphism card
  ctx.fillStyle = "rgba(17, 24, 39, 0.92)";
  ctx.strokeStyle = isLocked ? "#10b981" : "#38bdf8";
  ctx.lineWidth = 1.5;
  ctx.shadowColor = isLocked ? "rgba(16, 185, 129, 0.6)" : "rgba(56, 189, 248, 0.5)";
  ctx.shadowBlur = 10;

  // Round rect
  ctx.beginPath();
  const r = 13;
  ctx.moveTo(pillX + r, pillY);
  ctx.arcTo(pillX + pillWidth, pillY, pillX + pillWidth, pillY + pillHeight, r);
  ctx.arcTo(pillX + pillWidth, pillY + pillHeight, pillX, pillY + pillHeight, r);
  ctx.arcTo(pillX, pillY + pillHeight, pillX, pillY, r);
  ctx.arcTo(pillX, pillY, pillX + pillWidth, pillY, r);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Cyan / Emerald pulse indicator
  ctx.shadowBlur = 0;
  ctx.fillStyle = isLocked ? "#10b981" : "#38bdf8";
  ctx.beginPath();
  ctx.arc(pillX + 12, y, 3.5, 0, Math.PI * 2);
  ctx.fill();

  // Text label
  ctx.fillStyle = "#ffffff";
  ctx.textBaseline = "middle";
  ctx.fillText(text, pillX + 22, y + 0.5);
  ctx.restore();
}

async function initScanner() {
  await startScanning();
}

async function startScanning() {
  stopScanning();
  updateScannerStatus("Menghubungkan Kamera...", "Mohon izinkan akses kamera jika diminta...");

  try {
    const constraints = {
      video: {
        facingMode: { ideal: state.currentFacingMode },
        width: { ideal: 1280 },
        height: { ideal: 720 }
      },
      audio: false
    };

    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    state.mediaStream = stream;

    if (DOM.scanVideo) {
      DOM.scanVideo.srcObject = stream;
      DOM.scanVideo.setAttribute("playsinline", "true");
      await DOM.scanVideo.play();
    }

    state.isScanning = true;
    updateScannerStatus("Siap Memindai", `Sesi: ${state.currentSessionName}`);

    // Mulai frame scan loop
    scanFrame();
  } catch (err) {
    console.warn("Camera start warning:", err);
    state.isScanning = false;
    const errText = String(err || "");
    if (errText.includes("NotAllowed") || errText.includes("Permission")) {
      updateScannerStatus("Izin Kamera Ditolak", "Klik ikon gembok di URL browser untuk mengizinkan kamera");
    } else {
      updateScannerStatus("Kamera Offline", "Klik di sini untuk menyalakan kamera");
    }
  }
}

function stopScanning() {
  state.isScanning = false;
  if (state.animationFrameId) {
    cancelAnimationFrame(state.animationFrameId);
    state.animationFrameId = null;
  }
  if (state.mediaStream) {
    state.mediaStream.getTracks().forEach(track => track.stop());
    state.mediaStream = null;
  }
  if (DOM.scanVideo) {
    DOM.scanVideo.srcObject = null;
  }
}

async function scanFrame() {
  if (!state.isScanning || !DOM.scanVideo) return;

  const tCanvas = DOM.qrTrackingCanvas;
  const tCtx = tCanvas ? tCanvas.getContext("2d") : null;

  if (DOM.scanVideo.readyState === DOM.scanVideo.HAVE_ENOUGH_DATA) {
    const vW = DOM.scanVideo.videoWidth;
    const vH = DOM.scanVideo.videoHeight;
    const dW = DOM.scanVideo.clientWidth;
    const dH = DOM.scanVideo.clientHeight;

    // Sinkronkan ukuran tracking canvas dengan tampilan video
    if (tCanvas && (tCanvas.width !== dW || tCanvas.height !== dH)) {
      tCanvas.width = dW;
      tCanvas.height = dH;
    }

    const canvas = DOM.scanCanvas;
    if (canvas) {
      const ctx = canvas.getContext("2d", { willReadFrequently: true });

      let rawText = null;
      let rawCorners = null;

      // 1. Fast path: Native BarcodeDetector bawaan browser (C++ accelerated)
      if (nativeBarcodeDetector && !state.isProcessing) {
        try {
          const barcodes = await nativeBarcodeDetector.detect(DOM.scanVideo);
          if (barcodes.length > 0 && barcodes[0].rawValue) {
            rawText = barcodes[0].rawValue;
            if (barcodes[0].cornerPoints && barcodes[0].cornerPoints.length === 4) {
              rawCorners = barcodes[0].cornerPoints;
            }
          }
        } catch (e) {
          // Fallback ke jsQR
        }
      }

      // 2. Standard path: jsQR (Apache 2.0 Pure JS)
      if (!rawText && typeof jsQR !== "undefined" && !state.isProcessing) {
        canvas.width = vW;
        canvas.height = vH;
        ctx.drawImage(DOM.scanVideo, 0, 0, vW, vH);
        const imageData = ctx.getImageData(0, 0, vW, vH);
        const code = jsQR(imageData.data, vW, vH, { inversionAttempts: "dontInvert" });

        if (code && code.data) {
          rawText = code.data;
          if (code.location) {
            rawCorners = [
              code.location.topLeftCorner,
              code.location.topRightCorner,
              code.location.bottomRightCorner,
              code.location.bottomLeftCorner
            ];
          }
        }
      }

      // Jika QR code terdeteksi pada frame ini:
      if (rawCorners && rawText) {
        const mappedCorners = rawCorners.map(pt => mapVideoToDisplay(pt, vW, vH, dW, dH));
        qrTracker.targetCorners = mappedCorners;
        qrTracker.detectedText = rawText;
        qrTracker.lastSeenTime = Date.now();
        qrTracker.opacity = 1;

        if (!qrTracker.currentCorners) {
          qrTracker.currentCorners = mappedCorners.map(p => ({ x: p.x, y: p.y }));
        }

        // Trigger proses check-in
        if (!state.isProcessing && !qrTracker.activeScanTriggered) {
          qrTracker.activeScanTriggered = true;
          onQrCodeSuccess(rawText);
        }
      }
    }
  }

  // Render Telegram Dynamic AR Tracking di atas kamera
  if (tCtx && tCanvas) {
    tCtx.clearRect(0, 0, tCanvas.width, tCanvas.height);

    const now = Date.now();
    const isRecentlySeen = (now - qrTracker.lastSeenTime) < 320;

    if (!isRecentlySeen) {
      qrTracker.opacity = Math.max(0, qrTracker.opacity - 0.08);
      qrTracker.activeScanTriggered = false;
    }

    if (qrTracker.opacity > 0 && qrTracker.currentCorners && qrTracker.targetCorners) {
      // Butter-smooth interpolation (Lerp) mengikuti gerakan QR fisik
      const lerpSpeed = 0.45;
      for (let i = 0; i < 4; i++) {
        qrTracker.currentCorners[i].x = lerp(qrTracker.currentCorners[i].x, qrTracker.targetCorners[i].x, lerpSpeed);
        qrTracker.currentCorners[i].y = lerp(qrTracker.currentCorners[i].y, qrTracker.targetCorners[i].y, lerpSpeed);
      }

      tCtx.save();
      tCtx.globalAlpha = qrTracker.opacity;

      const p0 = qrTracker.currentCorners[0];
      const p1 = qrTracker.currentCorners[1];
      const p2 = qrTracker.currentCorners[2];
      const p3 = qrTracker.currentCorners[3];

      const centerX = (p0.x + p1.x + p2.x + p3.x) / 4;
      const minY = Math.min(p0.y, p1.y, p2.y, p3.y);

      // 1. Semi-translucent Polygon Fill di dalam QR
      tCtx.beginPath();
      tCtx.moveTo(p0.x, p0.y);
      tCtx.lineTo(p1.x, p1.y);
      tCtx.lineTo(p2.x, p2.y);
      tCtx.lineTo(p3.x, p3.y);
      tCtx.closePath();
      tCtx.fillStyle = state.isProcessing ? "rgba(16, 185, 129, 0.22)" : "rgba(56, 189, 248, 0.14)";
      tCtx.fill();

      // Thin outline
      tCtx.lineWidth = 1.5;
      tCtx.strokeStyle = state.isProcessing ? "rgba(16, 185, 129, 0.6)" : "rgba(56, 189, 248, 0.4)";
      tCtx.stroke();

      // 2. Telegram Futuristic 4 Siku-siku Brackets (Menempel di sudut QR)
      const bracketLen = Math.max(16, Math.min(32, Math.hypot(p1.x - p0.x, p1.y - p0.y) * 0.22));
      const bracketColor = state.isProcessing ? "#10b981" : "#38bdf8";

      tCtx.shadowColor = bracketColor;
      tCtx.shadowBlur = 12;
      tCtx.strokeStyle = bracketColor;
      tCtx.lineWidth = 4;
      tCtx.lineCap = "round";
      tCtx.lineJoin = "round";

      drawTelegramCornerBracket(tCtx, p0, p1, p3, bracketLen); // Top-Left
      drawTelegramCornerBracket(tCtx, p1, p2, p0, bracketLen); // Top-Right
      drawTelegramCornerBracket(tCtx, p2, p3, p1, bracketLen); // Bottom-Right
      drawTelegramCornerBracket(tCtx, p3, p0, p2, bracketLen); // Bottom-Left

      // 3. Floating Tag melayang di atas QR yang bergerak
      if (qrTracker.detectedText) {
        const displayLabel = qrTracker.detectedText.length > 20 
          ? qrTracker.detectedText.substring(0, 18) + "..." 
          : qrTracker.detectedText;
        drawFloatingTag(tCtx, centerX, minY - 26, `⚡ ${displayLabel}`, state.isProcessing);
      }

      tCtx.restore();
    }
  }

  if (state.isScanning) {
    state.animationFrameId = requestAnimationFrame(scanFrame);
  }
}

function onQrCodeSuccess(decodedText) {
  if (state.isProcessing) return;
  const ticketId = decodedText.trim();
  if (!ticketId) return;
  processCheckIn(ticketId);
}

function updateScannerStatus(title, sub) {
  if (DOM.statusLabel) DOM.statusLabel.textContent = title;
  if (DOM.statusSub) DOM.statusSub.textContent = sub;
}

// Camera Retry on Status Box Click
const statusBox = document.querySelector(".scanner-status-box");
if (statusBox) {
  statusBox.addEventListener("click", () => {
    if (!state.isScanning) {
      showToast("🔄 Menghubungkan ulang kamera...");
      startScanning();
    }
  });
}

// Camera Flip Handler (Front / Rear)
if (DOM.btnFlipCam) {
  DOM.btnFlipCam.addEventListener("click", async () => {
    state.currentFacingMode = (state.currentFacingMode === "environment") ? "user" : "environment";
    await startScanning();
    showToast(`Beralih ke kamera ${state.currentFacingMode === "environment" ? "belakang" : "depan"}`);
  });
}

// Torch Handler
if (DOM.btnTorch) {
  DOM.btnTorch.addEventListener("click", async () => {
    if (!state.mediaStream) {
      showToast("Kamera belum aktif.");
      return;
    }
    const track = state.mediaStream.getVideoTracks()[0];
    if (!track) return;

    try {
      state.isTorchOn = !state.isTorchOn;
      await track.applyConstraints({
        advanced: [{ torch: state.isTorchOn }]
      });
      DOM.btnTorch.classList.toggle("active", state.isTorchOn);
      showToast(state.isTorchOn ? "Senter Nyala 🔦" : "Senter Mati");
    } catch (e) {
      showToast("Perangkat tidak mendukung kontrol senter.");
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

  sounds.init();

  // 1. Show Global Top Loading Bar
  if (DOM.globalLoadingBar) DOM.globalLoadingBar.classList.add("active");

  // 2. Show Viewport Center Loading HUD
  if (DOM.scannerLoadingHud) {
    DOM.scannerLoadingHud.classList.add("show");
    if (DOM.hudTicketId) DOM.hudTicketId.textContent = `${ticketId} • ${state.currentSessionName}`;
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
  updateScannerStatus("Memproses...", `Mengecek sesi: ${state.currentSessionName}`);

  if (navigator.vibrate) navigator.vibrate(60);

  if (!state.apiUrl) {
    finishProcessing(sourceButton);
    openSettingsModal();
    showToast("⚠️ URL API Google Apps Script belum disetting!");
    return;
  }

  const payload = {
    action: "checkIn",
    ticketId: ticketId,
    sessionId: state.currentSessionId,
    sessionName: state.currentSessionName,
    scannedBy: state.panitiaName,
    gate: state.gateName
  };

  try {
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
      officer: state.panitiaName,
      allowCancel: false
    });
    recordHistory({
      ticketId: ticketId,
      sessionId: state.currentSessionId,
      sessionName: state.currentSessionName,
      name: "Koneksi Gagal",
      status: "ERROR",
      time: new Date().toLocaleTimeString()
    });
  } finally {
    finishProcessing(sourceButton);
  }
}

function finishProcessing(sourceButton = null) {
  if (DOM.globalLoadingBar) DOM.globalLoadingBar.classList.remove("active");
  if (DOM.scannerLoadingHud) DOM.scannerLoadingHud.classList.remove("show");

  if (DOM.btnManualCheckin) {
    DOM.btnManualCheckin.disabled = false;
    DOM.btnManualCheckin.classList.remove("btn-loading");
    DOM.btnManualCheckin.innerHTML = `Check In`;
  }
  if (DOM.inputManualId) DOM.inputManualId.disabled = false;

  if (sourceButton) {
    sourceButton.disabled = false;
    sourceButton.classList.remove("btn-loading");
    sourceButton.innerHTML = `Check In`;
  }

  if (DOM.verifyingBox) DOM.verifyingBox.style.display = "none";
  updateScannerStatus("Siap Memindai", `Sesi: ${state.currentSessionName}`);
}

function handleCheckInResponse(scannedTicketId, res) {
  const attendee = res.attendee || {};
  const attendeeName = attendee.name || "Peserta";
  const attendeeEmail = attendee.email || "-";
  const checkTime = attendee.checkInTime || attendee.firstCheckInTime || new Date().toLocaleTimeString();
  const officer = attendee.scannedBy || state.panitiaName;

  state.lastScanned = {
    ticketId: scannedTicketId,
    sessionId: state.currentSessionId,
    sessionName: state.currentSessionName,
    attendeeName: attendeeName
  };

  if (res.success && res.status === "CHECKED_IN") {
    // SUCCESS
    sounds.playSuccess();
    if (navigator.vibrate) navigator.vibrate([100, 50, 100]);

    state.stats.total++;
    state.stats.success++;
    DOM.statTotal.textContent = state.stats.total;

    showResultModal({
      type: "success",
      title: "CHECK-IN BERHASIL! 🎉",
      subtitle: `${state.currentSessionName} • Hadir`,
      name: attendeeName,
      ticketId: attendee.ticketId || scannedTicketId,
      email: attendeeEmail,
      time: checkTime,
      officer: officer,
      allowCancel: true
    });

    recordHistory({
      ticketId: scannedTicketId,
      sessionId: state.currentSessionId,
      sessionName: state.currentSessionName,
      name: attendeeName,
      status: "SUCCESS",
      time: checkTime
    });

  } else if (res.status === "ALREADY_CHECKED_IN") {
    // DUPLICATE
    sounds.playWarning();
    if (navigator.vibrate) navigator.vibrate([200, 100, 200]);

    state.stats.total++;
    state.stats.duplicate++;
    DOM.statTotal.textContent = state.stats.total;

    showResultModal({
      type: "warning",
      title: "SUDAH ABSEN DI SESI INI! ⚠️",
      subtitle: `Sesi: ${state.currentSessionName} (${checkTime})`,
      name: attendeeName,
      ticketId: attendee.ticketId || scannedTicketId,
      email: attendeeEmail,
      time: checkTime,
      officer: attendee.scannedBy || "Petugas lain",
      allowCancel: true
    });

    recordHistory({
      ticketId: scannedTicketId,
      sessionId: state.currentSessionId,
      sessionName: state.currentSessionName,
      name: attendeeName,
      status: "DUPLICATE",
      time: checkTime
    });

  } else {
    // NOT FOUND / INVALID
    sounds.playError();
    if (navigator.vibrate) navigator.vibrate(300);

    state.stats.total++;
    state.stats.invalid++;
    DOM.statTotal.textContent = state.stats.total;

    showResultModal({
      type: "error",
      title: "TIKET TIDAK VALID! ❌",
      subtitle: res.message || "ID tidak ditemukan di database peserta.",
      name: "Tidak Terdaftar",
      ticketId: scannedTicketId,
      email: "-",
      time: new Date().toLocaleTimeString(),
      officer: state.panitiaName,
      allowCancel: false
    });

    recordHistory({
      ticketId: scannedTicketId,
      sessionId: state.currentSessionId,
      sessionName: state.currentSessionName,
      name: "Tidak Terdaftar",
      status: "INVALID",
      time: new Date().toLocaleTimeString()
    });
  }
}

// ==========================================
// RESULT MODAL & CANCEL HANDLER
// ==========================================
function showResultModal(data) {
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

  // Tampilkan atau sembunyikan tombol Batalkan Kehadiran
  if (DOM.btnCancelCheckin) {
    DOM.btnCancelCheckin.style.display = data.allowCancel ? "flex" : "none";
  }

  // Reset Countdown animation
  if (DOM.countdownBar) {
    DOM.countdownBar.style.transition = "none";
    DOM.countdownBar.style.transform = "scaleX(1)";
    setTimeout(() => {
      DOM.countdownBar.style.transition = "transform 4s linear";
      DOM.countdownBar.style.transform = "scaleX(0)";
    }, 50);
  }

  DOM.resultModal.classList.add("show");

  // Berikan waktu 4 detik agar panitia sempat baca nama & batalin kalau salah orang
  clearTimeout(state.autoResumeTimer);
  state.autoResumeTimer = setTimeout(() => {
    closeResultModal();
  }, 4200);
}

function closeResultModal() {
  clearTimeout(state.autoResumeTimer);
  DOM.resultModal.classList.remove("show");
  state.isProcessing = false;
  qrTracker.activeScanTriggered = false;
  qrTracker.lastSeenTime = 0;
  qrTracker.opacity = 0;
}

if (DOM.btnNextScan) {
  DOM.btnNextScan.addEventListener("click", closeResultModal);
}

function setupCancelAction() {
  // Batalkan Kehadiran dari Modal Pop-up
  if (DOM.btnCancelCheckin) {
    DOM.btnCancelCheckin.addEventListener("click", async () => {
      if (!state.lastScanned) return;

      const confirmCancel = confirm(`Batalkan kehadiran untuk ${state.lastScanned.attendeeName} (${state.lastScanned.ticketId}) pada ${state.lastScanned.sessionName}?`);
      if (!confirmCancel) return;

      clearTimeout(state.autoResumeTimer);
      await executeCancelAttendance(state.lastScanned.ticketId, state.lastScanned.sessionId, state.lastScanned.sessionName);
    });
  }
}

// Eksekusi API pembatalan kehadiran
async function executeCancelAttendance(ticketId, sessionId, sessionName, historyIndex = null) {
  if (DOM.globalLoadingBar) DOM.globalLoadingBar.classList.add("active");
  if (DOM.btnCancelCheckin) {
    DOM.btnCancelCheckin.disabled = true;
    DOM.btnCancelCheckin.innerHTML = `<div class="spinner"></div><span>Membatalkan...</span>`;
  }

  try {
    const payload = {
      action: "cancelCheckIn",
      ticketId: ticketId,
      sessionId: sessionId,
      sessionName: sessionName,
      cancelledBy: state.panitiaName,
      reason: "Dibatalkan oleh panitia (nama/identitas tidak cocok)"
    };

    const res = await fetch(state.apiUrl, {
      method: "POST",
      body: JSON.stringify(payload)
    });
    const result = await res.json();

    if (result.success) {
      sounds.playWarning();
      showToast(`⚠️ Kehadiran ${ticketId} pada ${sessionName} berhasil dibatalkan!`);

      // Update Modal jika sedang terbuka
      if (DOM.resultModal.classList.contains("show")) {
        DOM.resultBanner.className = "result-banner warning";
        DOM.resultIcon.textContent = "✕";
        DOM.resultTitle.textContent = "KEHADIRAN DIBATALKAN";
        DOM.resultSubtitle.textContent = `Status direset ke belum hadir pada ${sessionName}`;
        DOM.btnCancelCheckin.style.display = "none";
        setTimeout(() => closeResultModal(), 2000);
      }

      // Update riwayat lokal
      const targetHistory = state.history.find(h => h.ticketId === ticketId && h.sessionId === sessionId);
      if (targetHistory) {
        targetHistory.status = "CANCELLED";
        localStorage.setItem("absen_history", JSON.stringify(state.history));
        renderHistory();
      }

    } else {
      showToast(`❌ Gagal membatalkan: ${result.message}`);
    }
  } catch (err) {
    console.error("Cancel check-in error:", err);
    showToast("❌ Gagal terhubung ke server untuk membatalkan kehadiran.");
  } finally {
    if (DOM.globalLoadingBar) DOM.globalLoadingBar.classList.remove("active");
    if (DOM.btnCancelCheckin) {
      DOM.btnCancelCheckin.disabled = false;
      DOM.btnCancelCheckin.innerHTML = `<span>Batalkan Kehadiran (Salah Orang)</span>`;
    }
  }
}

// ==========================================
// MANUAL TAB (SEARCH & CHECK-IN)
// ==========================================
function setupManualActions() {
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
      <span>Mencari data untuk ${state.currentSessionName}...</span>
    </div>
  `;

  try {
    const res = await fetch(state.apiUrl, {
      method: "POST",
      body: JSON.stringify({ 
        action: "search", 
        query: query,
        sessionId: state.currentSessionId,
        sessionName: state.currentSessionName 
      })
    });
    const data = await res.json();

    if (data.results && data.results.length > 0) {
      DOM.searchResultsList.innerHTML = "";
      data.results.forEach(item => {
        const div = document.createElement("div");
        div.className = "search-result-item";
        
        const isHadir = item.status === "HADIR";
        const statusBadge = isHadir 
          ? `<span class="badge badge-warning">Sudah Hadir</span>` 
          : `<span class="badge badge-success">Belum Hadir</span>`;

        div.innerHTML = `
          <div>
            <div class="attendee-name">${escapeHtml(item.name)} ${statusBadge}</div>
            <div class="attendee-sub">${escapeHtml(item.ticketId)} • ${escapeHtml(item.email)}</div>
          </div>
          <div>
            <button class="btn-checkin-sm" data-id="${escapeHtml(item.ticketId)}">
              ${isHadir ? "Cek Status" : "Check In"}
            </button>
          </div>
        `;
        DOM.searchResultsList.appendChild(div);
      });

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
// OTS (ON-THE-SPOT) REGISTRATION & CHECK-IN
// ==========================================
function setupOtsActions() {
  if (DOM.btnSubmitOts) {
    DOM.btnSubmitOts.addEventListener("click", handleOtsSubmit);
  }
}

async function handleOtsSubmit() {
  const name = DOM.inputOtsName.value.trim();
  const contact = DOM.inputOtsContact.value.trim();
  const notes = DOM.inputOtsNotes.value.trim();

  if (!name) {
    showToast("⚠️ Nama lengkap peserta wajib diisi!");
    if (DOM.inputOtsName) DOM.inputOtsName.focus();
    return;
  }

  if (!state.apiUrl) {
    openSettingsModal();
    showToast("⚠️ URL API Google Apps Script belum disetting!");
    return;
  }

  // Loading UI feedback
  if (DOM.globalLoadingBar) DOM.globalLoadingBar.classList.add("active");
  if (DOM.btnSubmitOts) {
    DOM.btnSubmitOts.disabled = true;
    DOM.btnSubmitOts.classList.add("btn-loading");
    DOM.btnSubmitOts.innerHTML = `<div class="spinner"></div><span>Mendaftarkan & Check-In...</span>`;
  }

  try {
    const payload = {
      action: "registerOts",
      name: name,
      contact: contact,
      notes: notes,
      sessionId: state.currentSessionId,
      sessionName: state.currentSessionName,
      scannedBy: state.panitiaName,
      gate: state.gateName
    };

    const res = await fetch(state.apiUrl, {
      method: "POST",
      body: JSON.stringify(payload)
    });
    const result = await res.json();

    if (result.success && result.attendee) {
      sounds.playSuccess();
      if (navigator.vibrate) navigator.vibrate([100, 50, 100]);

      state.stats.total++;
      state.stats.success++;
      DOM.statTotal.textContent = state.stats.total;

      const attendee = result.attendee;

      // Reset Form OTS
      DOM.inputOtsName.value = "";
      DOM.inputOtsContact.value = "";
      DOM.inputOtsNotes.value = "";

      showToast(`🎉 ${name} berhasil didaftarkan OTS & langsung hadir!`);

      // Tampilkan Modal Hasil
      state.lastScanned = {
        ticketId: attendee.ticketId,
        sessionId: state.currentSessionId,
        sessionName: state.currentSessionName,
        attendeeName: name
      };

      showResultModal({
        type: "success",
        title: "REGISTRASI OTS BERHASIL! 🎉",
        subtitle: `${state.currentSessionName} • Langsung Hadir (Walk-In)`,
        name: name,
        ticketId: attendee.ticketId,
        email: attendee.email || "OTS (Walk-in)",
        time: attendee.checkInTime || new Date().toLocaleTimeString(),
        officer: state.panitiaName,
        allowCancel: true
      });

      recordHistory({
        ticketId: attendee.ticketId,
        sessionId: state.currentSessionId,
        sessionName: state.currentSessionName,
        name: `${name} (OTS)`,
        status: "SUCCESS",
        time: attendee.checkInTime || new Date().toLocaleTimeString()
      });

    } else {
      sounds.playError();
      showToast(`❌ Gagal mendaftarkan: ${result.message || "Terjadi kesalahan server"}`);
    }
  } catch (err) {
    console.error("OTS error:", err);
    sounds.playError();
    showToast("❌ Gagal terhubung ke server saat mendaftarkan OTS.");
  } finally {
    if (DOM.globalLoadingBar) DOM.globalLoadingBar.classList.remove("active");
    if (DOM.btnSubmitOts) {
      DOM.btnSubmitOts.disabled = false;
      DOM.btnSubmitOts.classList.remove("btn-loading");
      DOM.btnSubmitOts.innerHTML = `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
          <circle cx="8.5" cy="7" r="4"></circle>
          <polyline points="17 11 19 13 23 9"></polyline>
        </svg>
        <span>Daftarkan & Langsung Check-In</span>
      `;
    }
  }
}

// ==========================================
// HISTORY TRACKER WITH UNDO CAPABILITY
// ==========================================
function recordHistory(entry) {
  state.history.unshift(entry);
  if (state.history.length > 50) state.history.pop();
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
  state.history.forEach((item, idx) => {
    const div = document.createElement("div");
    div.className = "history-item";

    let badgeClass = "badge-success";
    let badgeLabel = "Hadir";
    let showUndo = false;

    if (item.status === "SUCCESS") {
      badgeClass = "badge-success";
      badgeLabel = "Berhasil";
      showUndo = true;
    } else if (item.status === "CANCELLED") {
      badgeClass = "badge-error";
      badgeLabel = "Dibatalkan";
    } else if (item.status === "DUPLICATE") {
      badgeClass = "badge-warning";
      badgeLabel = "Duplikat";
    } else {
      badgeClass = "badge-error";
      badgeLabel = "Gagal";
    }

    div.innerHTML = `
      <div style="flex: 1;">
        <div style="font-weight: 600; color: #fff;">${escapeHtml(item.name)}</div>
        <div style="font-size: 11px; color: var(--text-muted);">
          ${escapeHtml(item.ticketId)} • ${escapeHtml(item.sessionName || "Sesi")} • ${escapeHtml(item.time)}
        </div>
      </div>
      <div style="display: flex; align-items: center; gap: 8px;">
        <span class="badge ${badgeClass}">${badgeLabel}</span>
        ${showUndo ? `<button class="btn-undo-sm" data-idx="${idx}" data-id="${escapeHtml(item.ticketId)}" data-session="${escapeHtml(item.sessionId)}" data-name="${escapeHtml(item.name)}">Batalkan</button>` : ""}
      </div>
    `;
    DOM.historyList.appendChild(div);
  });

  // Pasang listener tombol Batalkan di daftar riwayat
  DOM.historyList.querySelectorAll(".btn-undo-sm").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      const tId = e.currentTarget.getAttribute("data-id");
      const sId = e.currentTarget.getAttribute("data-session");
      const name = e.currentTarget.getAttribute("data-name");

      const confirmBatal = confirm(`Batalkan kehadiran untuk ${name} (${tId})? Data di Google Sheets akan otomatis di-reset.`);
      if (!confirmBatal) return;

      e.currentTarget.disabled = true;
      e.currentTarget.textContent = "Membatalkan...";

      await executeCancelAttendance(tId, sId, state.currentSessionName);
    });
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

      // Refresh sesi dengan API baru
      if (aUrl) fetchSessions(true);
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

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
