/**
 * ==============================================================================
 * EventPass • State & DOM Cache Module (js/state.js)
 * ==============================================================================
 */

window.EventPass = window.EventPass || {};

(function(ns) {
  'use strict';

  // Application State
  ns.state = {
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

    // OTS Tab
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

})(window.EventPass);
