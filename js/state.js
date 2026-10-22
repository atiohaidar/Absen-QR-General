/**
 * ==============================================================================
 * EventPass • State & DOM Cache Module (js/state.js)
 * ==============================================================================
 */

window.EventPass = window.EventPass || {};

(function(ns) {
  'use strict';

  /**
   * Extract clean, readable device & browser string from user agent
   */
  function detectCleanDeviceInfo() {
    try {
      const ua = navigator.userAgent || "";
      let os = "Unknown OS";
      if (/android/i.test(ua)) os = "Android";
      else if (/iphone|ipad|ipod/i.test(ua)) os = "iOS (Apple)";
      else if (/windows phone/i.test(ua)) os = "Windows Phone";
      else if (/win/i.test(ua)) os = "Windows PC";
      else if (/macintosh|mac os x/i.test(ua)) os = "macOS";
      else if (/linux/i.test(ua)) os = "Linux";
      else if (/cros/i.test(ua)) os = "ChromeOS";

      let browser = "Browser";
      if (/edg\//i.test(ua)) browser = "Edge";
      else if (/opr\/|opera/i.test(ua)) browser = "Opera";
      else if (/chrome|crios/i.test(ua)) browser = "Chrome";
      else if (/firefox|fxios/i.test(ua)) browser = "Firefox";
      else if (/safari/i.test(ua)) browser = "Safari";
      else if (/trident|msie/i.test(ua)) browser = "IE";

      const isMobile = /mobi|android|touch/i.test(ua);
      const category = isMobile ? "Mobile" : "Desktop";

      // Check legacy Android UA model (if not reduced to "K")
      let legacyModel = "";
      const modelMatch = ua.match(/Android[^;]+;\s*([^;)]+)\s*[;)]/i);
      if (modelMatch && modelMatch[1]) {
        const candidate = modelMatch[1].trim();
        if (candidate && candidate.toUpperCase() !== "K" && !candidate.startsWith("Build")) {
          legacyModel = candidate;
        }
      }

      if (legacyModel) {
        return `${os} (${legacyModel}) • ${browser}`;
      }

      return `${os} • ${browser} (${category})`;
    } catch (e) {
      return "Web Browser";
    }
  }

  /**
   * Asynchronous Modern User-Agent Client Hints (UA-CH):
   * Retrieves high-entropy device model from modern Chromium browsers
   */
  ns.enrichDeviceInfoWithModel = async function() {
    try {
      if (navigator.userAgentData && typeof navigator.userAgentData.getHighEntropyValues === "function") {
        const hints = await navigator.userAgentData.getHighEntropyValues(["model", "platform", "platformVersion"]);
        if (hints && hints.model && hints.model.trim()) {
          const model = hints.model.trim();
          const current = ns.state.deviceInfo || "";
          if (!current.includes(model)) {
            if (current.startsWith("Android")) {
              ns.state.deviceInfo = current.replace("Android", `Android (${model})`);
            } else {
              ns.state.deviceInfo = `${model} • ${current}`;
            }
            if (ns.DOM && ns.DOM.previewDevice) {
              ns.DOM.previewDevice.textContent = ns.state.deviceInfo;
            }
          }
        }
      }
    } catch (e) {
      // Graceful fallback to default deviceInfo
    }
  };

  // Default Fallback Web App URL (Opsional: paste URL Apps Script di sini jika ingin auto-connect tanpa query param ?api=)
  const DEFAULT_APP_SCRIPT_URL = "";

  // Application State
  ns.state = {
    mediaStream: null,
    animationFrameId: null,
    isScanning: false,
    isProcessing: false,
    currentFacingMode: "environment", // "environment" (rear) or "user" (front)
    isTorchOn: false,
    
    // Settings (Persisted in localStorage with optional default fallback)
    panitiaName: localStorage.getItem("absen_panitia_name") || "",
    gateName: localStorage.getItem("absen_gate_name") || "",
    apiUrl: localStorage.getItem("absen_api_url") || DEFAULT_APP_SCRIPT_URL || "",

    // Sessions Management
    sessions: JSON.parse(localStorage.getItem("absen_cached_sessions") || "[]"),
    currentSessionId: localStorage.getItem("absen_current_session_id") || "SESI-01",
    currentSessionName: localStorage.getItem("absen_current_session_name") || "Pertemuan 1",

    // Device & Location Audit
    deviceInfo: detectCleanDeviceInfo(),
    location: null, // { lat, lng, mapsUrl, accuracy, timestamp }

    // Last Scanned Item (for direct cancellation from modal)
    lastScanned: null,

    // Instant Offline-Ready Scan & Background Batch Sync
    instantMode: localStorage.getItem("absen_instant_mode") !== "false", // Default: true (ON)
    cachedAttendees: JSON.parse(localStorage.getItem("absen_cached_attendees") || "{}"),
    syncQueue: JSON.parse(localStorage.getItem("absen_sync_queue") || "[]"),
    isSyncingQueue: false,
    lastSyncTime: localStorage.getItem("absen_last_sync_time") || null,

    // Session Stats
    stats: {
      total: 0,
      success: 0,
      duplicate: 0,
      invalid: 0
    },
    history: JSON.parse(localStorage.getItem("absen_history") || "[]")
  };

  // DOM Elements Cache
  ns.DOM = {
    // Global Loading Bar & HUD
    globalLoadingBar: document.getElementById("global-loading-bar"),
    scannerLoadingHud: document.getElementById("scanner-loading-hud"),
    hudTicketId: document.getElementById("hud-ticket-id"),

    // Operator & Session
    operatorBadge: document.getElementById("operator-badge-text"),
    statTotal: document.getElementById("stat-total"),
    sessionDropdownContainer: document.getElementById("custom-session-dropdown"),
    sessionTrigger: document.getElementById("session-select-trigger"),
    sessionLabel: document.getElementById("session-select-label"),
    sessionMenu: document.getElementById("session-dropdown-menu"),
    btnRefreshSessions: document.getElementById("btn-refresh-sessions"),
    tabButtons: document.querySelectorAll(".tab-btn"),
    tabPanes: document.querySelectorAll(".tab-pane"),
    
    // Scanner Viewport & Controls
    scanVideo: document.getElementById("scan-video"),
    scanCanvas: document.getElementById("scan-canvas"),
    qrTrackingCanvas: document.getElementById("qr-tracking-canvas"),
    statusLabel: document.getElementById("scanner-status-label"),
    statusSub: document.getElementById("scanner-status-sub"),
    verifyingBox: document.getElementById("verifying-box"),
    verifyingText: document.getElementById("verifying-text"),
    btnFlipCam: document.getElementById("btn-flip-cam"),
    btnTorch: document.getElementById("btn-toggle-torch"),
    btnScanImage: document.getElementById("btn-scan-image"),
    inputQrFile: document.getElementById("input-qr-file"),
    btnManualUploadQr: document.getElementById("btn-manual-upload-qr"),

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
    resultConfigGuide: document.getElementById("result-config-guide"),
    btnFixConfigUrl: document.getElementById("btn-fix-config-url"),
    btnNextScan: document.getElementById("btn-next-scan"),
    btnRecheckServer: document.getElementById("btn-recheck-server"),
    btnCancelCheckin: document.getElementById("btn-cancel-checkin"),

    // Cancel Confirmation Modal
    cancelModal: document.getElementById("cancel-confirm-modal"),
    cancelModalAttendeeName: document.getElementById("cancel-modal-attendee-name"),
    cancelModalDetails: document.getElementById("cancel-modal-details"),
    cancelReasonInput: document.getElementById("cancel-reason-input"),
    btnCloseCancelModal: document.getElementById("btn-close-cancel-modal"),
    btnDismissCancel: document.getElementById("btn-dismiss-cancel"),
    btnExecuteCancel: document.getElementById("btn-execute-cancel"),

    // Settings Modal
    btnOpenSettings: document.getElementById("btn-open-settings"),
    settingsModal: document.getElementById("settings-modal"),
    btnCloseSettings: document.getElementById("btn-close-settings"),
    cfgInstantMode: document.getElementById("cfg-instant-mode"),
    btnSyncAttendees: document.getElementById("btn-sync-attendees"),
    cacheStatusText: document.getElementById("cache-status-text"),
    cloudSyncDot: document.getElementById("cloud-sync-dot"),
    syncQueueBadge: document.getElementById("sync-queue-badge"),
    inputPanitiaName: document.getElementById("cfg-panitia-name"),
    inputGateName: document.getElementById("cfg-gate-name"),
    inputApiUrl: document.getElementById("cfg-api-url"),
    btnCopyShareLink: document.getElementById("btn-copy-share-link"),
    btnTestConnection: document.getElementById("btn-test-connection"),
    btnSaveSettings: document.getElementById("btn-save-settings"),
    previewDevice: document.getElementById("cfg-device-info-preview"),
    previewLocation: document.getElementById("cfg-location-info-preview"),

    // Manual Tab
    inputManualId: document.getElementById("manual-ticket-id"),
    btnManualCheckin: document.getElementById("btn-manual-checkin"),
    inputManualSearch: document.getElementById("manual-search-query"),
    btnSearchQuery: document.getElementById("btn-search-query"),
    searchResultsList: document.getElementById("search-results-list"),

    // OTS Tab
    formOts: document.getElementById("form-ots"),
    inputOtsName: document.getElementById("ots-name"),
    inputOtsContact: document.getElementById("ots-contact"),
    inputOtsNotes: document.getElementById("ots-notes"),
    btnSubmitOts: document.getElementById("btn-submit-ots"),

    // History Tab
    historyList: document.getElementById("history-list"),
    btnClearHistory: document.getElementById("btn-clear-history"),
    historySyncBanner: document.getElementById("history-sync-banner"),
    historySyncTitle: document.getElementById("history-sync-title"),
    historySyncDesc: document.getElementById("history-sync-desc"),
    btnSyncNowHistory: document.getElementById("btn-sync-now-history"),

    // Location Modal
    locationModal: document.getElementById("location-prompt-modal"),
    locBadgePill: document.getElementById("loc-badge-pill"),
    locStatusText: document.getElementById("loc-status-text"),
    locStatusDot: document.querySelector(".loc-info-dot"),
    btnAllowLocation: document.getElementById("btn-allow-location"),
    btnAllowLocationText: document.getElementById("btn-allow-location-text"),
    btnSkipLocation: document.getElementById("btn-skip-location"),
    btnRetriggerLoc: document.getElementById("btn-retrigger-loc"),

    // Toast
    toast: document.getElementById("toast-notice"),
    toastMsg: document.getElementById("toast-msg")
  };

  // Helper Sanitizer
  ns.escapeHtml = function(str) {
    if (!str) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  };

  /**
   * Zero-Lag Background Geolocation Lock
   * Requests coordinates once asynchronously in the background.
   * If permitted/cached, saves Google Maps URL to state; never stalls QR scanning.
   */
  ns.initBackgroundGeolocation = function() {
    if (!("geolocation" in navigator)) {
      if (ns.DOM.previewLocation) {
        ns.DOM.previewLocation.textContent = "Tidak Didukung";
        ns.DOM.previewLocation.style.color = "var(--text-muted)";
      }
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = position.coords.latitude.toFixed(6);
        const lng = position.coords.longitude.toFixed(6);
        const accuracy = Math.round(position.coords.accuracy || 0);
        const mapsUrl = `https://www.google.com/maps?q=${lat},${lng}`;

        ns.state.location = {
          lat: lat,
          lng: lng,
          accuracy: accuracy,
          mapsUrl: mapsUrl,
          timestamp: Date.now()
        };

        if (ns.DOM.previewLocation) {
          ns.DOM.previewLocation.textContent = `Aktif (±${accuracy}m)`;
          ns.DOM.previewLocation.style.color = "var(--status-success)";
        }
      },
      (err) => {
        console.warn("📍 Geolocation note:", err.message);
        if (ns.DOM.previewLocation) {
          ns.DOM.previewLocation.textContent = "Non-GPS / Belum Diizinkan";
          ns.DOM.previewLocation.style.color = "var(--text-muted)";
        }
      },
      {
        enableHighAccuracy: false, // battery & quick lock friendly
        timeout: 10000,            // 10s max wait before giving up silently
        maximumAge: 300000         // accept 5 minutes cached position
      }
    );
  };

})(window.EventPass);
