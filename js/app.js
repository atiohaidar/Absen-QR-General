/**
 * ==============================================================================
 * EventPass • Main Application Bootstrap & Coordinator (js/app.js)
 * Ties together State, Audio, API, Scanner, and UI modules.
 * ==============================================================================
 */

window.EventPass = window.EventPass || {};

(function(ns) {
  'use strict';

  ns.App = {
    /**
     * Entry point called when DOM is ready
     */
    init() {
      // 0. Auto-connect if query parameter is provided (e.g. ?q=https://... or ?api=https://...)
      this.checkUrlAutoConfig();

      ns.UI.renderOperatorHeader();
      ns.UI.renderSessionDropdown();
      ns.UI.renderHistory();
      
      // Asynchronously enrich device model (e.g. Samsung SM-..., Pixel, Xiaomi) via Client Hints
      if (typeof ns.enrichDeviceInfoWithModel === "function") {
        ns.enrichDeviceInfoWithModel();
      }

      this.bindEventListeners();
      ns.Scanner.startScanning();

      // Check if location is allowed, otherwise display full-screen blocking overlay
      this.checkLocationState();

      // Sync active sessions from Google Sheets
      if (ns.state.apiUrl) {
        this.syncSessions(false);
      } else {
        setTimeout(() => {
          if (!ns.DOM.locationModal || !ns.DOM.locationModal.classList.contains("show")) {
            ns.UI.openSettingsModal();
            ns.UI.showToast("Silakan masukkan Apps Script API URL terlebih dahulu.");
          }
        }, 700);
      }
    },

    /**
     * Bind all DOM buttons, tabs, forms, and keyboard actions
     */
    bindEventListeners() {
      const DOM = ns.DOM;

      // 1. Custom Session Dropdown & Refresh
      if (DOM.sessionTrigger) {
        DOM.sessionTrigger.addEventListener("click", (e) => {
          e.stopPropagation();
          ns.UI.toggleSessionDropdown();
        });
      }

      // Close dropdown when clicking outside
      document.addEventListener("click", (e) => {
        if (DOM.sessionDropdownContainer && !DOM.sessionDropdownContainer.contains(e.target)) {
          ns.UI.closeSessionDropdown();
        }
      });

      // Keyboard Esc to close dropdown & modals
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
          ns.UI.closeSessionDropdown();
          ns.UI.closeCancelModal();
          ns.UI.closeSettingsModal();
        }
      });

      if (DOM.btnRefreshSessions) {
        DOM.btnRefreshSessions.addEventListener("click", (e) => {
          e.stopPropagation();
          this.syncSessions(true);
        });
      }

      // 2. Navigation Tabs
      DOM.tabButtons.forEach(btn => {
        btn.addEventListener("click", () => {
          const targetTab = btn.getAttribute("data-tab");

          DOM.tabButtons.forEach(b => b.classList.remove("active"));
          DOM.tabPanes.forEach(p => p.classList.remove("active"));

          btn.classList.add("active");
          const activePane = document.getElementById(`tab-${targetTab}`);
          if (activePane) activePane.classList.add("active");

          if (targetTab === "scan") {
            if (!ns.state.isScanning) ns.Scanner.startScanning();
          } else {
            if (ns.state.isScanning) ns.Scanner.stopScanning();
          }
        });
      });

      // 3. Camera Controls (Flip, Torch, Reconnect)
      if (DOM.btnFlipCam) {
        DOM.btnFlipCam.addEventListener("click", () => ns.Scanner.flipCamera());
      }
      if (DOM.btnTorch) {
        DOM.btnTorch.addEventListener("click", () => ns.Scanner.toggleTorch());
      }
      const statusBox = document.querySelector(".scanner-status-box");
      if (statusBox) {
        statusBox.addEventListener("click", () => {
          if (!ns.state.isScanning) {
            ns.UI.showToast("Menghubungkan ulang kamera...");
            ns.Scanner.startScanning();
          }
        });
      }

      // 4. Modal Buttons (Next Scan, Fix URL, Cancel Attendance)
      if (DOM.btnNextScan) {
        DOM.btnNextScan.addEventListener("click", () => ns.UI.closeResultModal());
      }
      if (DOM.btnFixConfigUrl) {
        DOM.btnFixConfigUrl.addEventListener("click", () => {
          ns.UI.closeResultModal();
          ns.UI.openSettingsModal();
          setTimeout(() => {
            if (DOM.inputApiUrl) {
              DOM.inputApiUrl.focus();
              DOM.inputApiUrl.select();
            }
          }, 250);
        });
      }
      if (DOM.btnCancelCheckin) {
        DOM.btnCancelCheckin.addEventListener("click", () => {
          if (!ns.state.lastScanned) return;
          ns.UI.openCancelModal(ns.state.lastScanned);
        });
      }

      // 5. Cancel Confirmation Modal Actions
      if (DOM.btnCloseCancelModal) {
        DOM.btnCloseCancelModal.addEventListener("click", () => ns.UI.closeCancelModal());
      }
      if (DOM.btnDismissCancel) {
        DOM.btnDismissCancel.addEventListener("click", () => ns.UI.closeCancelModal());
      }
      if (DOM.btnExecuteCancel) {
        DOM.btnExecuteCancel.addEventListener("click", async () => {
          if (!ns.state.pendingCancel) return;
          const target = ns.state.pendingCancel;
          const reason = (DOM.cancelReasonInput ? DOM.cancelReasonInput.value.trim() : "") || "Dibatalkan oleh panitia";

          ns.UI.closeCancelModal();
          await this.handleCancelAttendance(target.ticketId, target.sessionId, target.sessionName, reason);
        });
      }

      // 6. Manual Check-In & Search
      if (DOM.btnManualCheckin) {
        DOM.btnManualCheckin.addEventListener("click", () => {
          const id = DOM.inputManualId.value.trim();
          if (!id) {
            ns.UI.showToast("Masukkan ID Tiket terlebih dahulu!");
            return;
          }
          this.processCheckIn(id);
        });
      }
      if (DOM.btnSearchQuery) {
        DOM.btnSearchQuery.addEventListener("click", () => this.performSearch());
      }
      if (DOM.inputManualSearch) {
        DOM.inputManualSearch.addEventListener("keyup", (e) => {
          if (e.key === "Enter") this.performSearch();
        });
      }

      // 7. On-The-Spot (OTS) Registration Form
      if (DOM.btnSubmitOts) {
        DOM.btnSubmitOts.addEventListener("click", () => this.handleOtsSubmit());
      }

      // 8. Settings Modal
      if (DOM.btnOpenSettings) {
        DOM.btnOpenSettings.addEventListener("click", () => ns.UI.openSettingsModal());
      }
      if (DOM.btnCloseSettings) {
        DOM.btnCloseSettings.addEventListener("click", () => ns.UI.closeSettingsModal());
      }
      if (DOM.settingsModal) {
        DOM.settingsModal.addEventListener("click", (e) => {
          if (e.target === DOM.settingsModal) {
            ns.UI.closeSettingsModal();
          }
        });
      }
      if (DOM.cancelModal) {
        DOM.cancelModal.addEventListener("click", (e) => {
          if (e.target === DOM.cancelModal) {
            ns.UI.closeCancelModal();
          }
        });
      }
      if (DOM.btnTestConnection) {
        DOM.btnTestConnection.addEventListener("click", () => this.handleTestConnection());
      }
      if (DOM.btnSaveSettings) {
        DOM.btnSaveSettings.addEventListener("click", () => this.handleSaveSettings());
      }
      if (DOM.btnCopyShareLink) {
        DOM.btnCopyShareLink.addEventListener("click", () => this.handleCopyShareLink());
      }

      // 9. History Clear
      if (DOM.btnClearHistory) {
        DOM.btnClearHistory.addEventListener("click", () => {
          ns.state.history = [];
          localStorage.removeItem("absen_history");
          ns.UI.renderHistory();
          ns.UI.showToast("Riwayat lokal telah dibersihkan.");
        });
      }

      // 10. Location Permission Blocking Modal Actions
      if (DOM.btnAllowLocation) {
        DOM.btnAllowLocation.addEventListener("click", () => this.handleAllowLocation());
      }
      if (DOM.btnSkipLocation) {
        DOM.btnSkipLocation.addEventListener("click", () => this.handleSkipLocation());
      }
      if (DOM.btnRetriggerLoc) {
        DOM.btnRetriggerLoc.addEventListener("click", () => {
          ns.UI.closeSettingsModal();
          ns.UI.openLocationModal("prompt");
        });
      }
    },

    /**
     * Check if location permission is granted, otherwise shows full-screen blocking notification
     */
    async checkLocationState() {
      // If user already dismissed during this session, do not block screen
      if (sessionStorage.getItem("absen_loc_dismissed") === "true") {
        if (typeof ns.initBackgroundGeolocation === "function") {
          ns.initBackgroundGeolocation();
        }
        return;
      }

      if (!("geolocation" in navigator)) {
        if (ns.DOM.previewLocation) {
          ns.DOM.previewLocation.textContent = "Tidak Didukung";
        }
        return;
      }

      // Query permission if browser supports Permissions API
      if (navigator.permissions && navigator.permissions.query) {
        try {
          const permissionStatus = await navigator.permissions.query({ name: 'geolocation' });
          if (permissionStatus.state === 'granted') {
            if (typeof ns.initBackgroundGeolocation === "function") {
              ns.initBackgroundGeolocation();
            }
            ns.UI.closeLocationModal();
          } else if (permissionStatus.state === 'denied') {
            ns.UI.openLocationModal("denied");
          } else {
            // 'prompt' - Not yet allowed! Show full-screen blocking overlay
            ns.UI.openLocationModal("prompt");
          }

          permissionStatus.onchange = () => {
            if (permissionStatus.state === 'granted') {
              if (typeof ns.initBackgroundGeolocation === "function") {
                ns.initBackgroundGeolocation();
              }
              ns.UI.closeLocationModal();
              ns.UI.showToast("Akses lokasi berhasil diaktifkan.");
            }
          };
          return;
        } catch (e) {
          console.warn("Permissions query error, fallback to prompt:", e);
        }
      }

      // Fallback for browsers without permissions.query
      if (!ns.state.location) {
        ns.UI.openLocationModal("prompt");
      }
    },

    /**
     * Trigger browser prompt to allow location
     */
    handleAllowLocation() {
      const btn = ns.DOM.btnAllowLocation;
      const btnText = ns.DOM.btnAllowLocationText;

      if (!("geolocation" in navigator)) {
        ns.UI.showToast("Perangkat ini tidak mendukung GPS.");
        ns.UI.closeLocationModal();
        return;
      }

      if (btn) btn.disabled = true;
      if (btnText) btnText.innerHTML = `<span class="spinner" style="margin-right: 6px;"></span><span>Menunggu Izin Browser...</span>`;

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

          if (btn) btn.disabled = false;
          if (btnText) btnText.innerHTML = `<span>Izinkan Akses Lokasi</span>`;

          ns.UI.closeLocationModal();
          ns.UI.showToast("Izin lokasi berhasil diaktifkan.");

          if (!ns.state.apiUrl) {
            setTimeout(() => ns.UI.openSettingsModal(), 400);
          }
        },
        (err) => {
          console.warn("Geolocation prompt error:", err);
          if (btn) btn.disabled = false;
          if (btnText) btnText.innerHTML = `<span>Coba Minta Izin Lagi</span>`;

          if (ns.DOM.locStatusText) {
            if (err.code === err.PERMISSION_DENIED) {
              ns.DOM.locStatusText.textContent = "Izin lokasi diblokir oleh browser. Anda dapat melanjutkan tanpa lokasi di bawah.";
            } else {
              ns.DOM.locStatusText.textContent = `Gagal memperoleh sinyal GPS: ${err.message}`;
            }
          }
          if (ns.DOM.locStatusDot) {
            ns.DOM.locStatusDot.style.background = "var(--status-error)";
          }

          ns.UI.showToast("Izin lokasi belum diberikan. Anda dapat lanjut tanpa lokasi.");
        },
        {
          enableHighAccuracy: false,
          timeout: 12000,
          maximumAge: 300000
        }
      );
    },

    /**
     * Dismiss full-screen blocking overlay and continue without location
     */
    handleSkipLocation() {
      sessionStorage.setItem("absen_loc_dismissed", "true");
      if (ns.DOM.previewLocation) {
        ns.DOM.previewLocation.textContent = "Non-GPS (Dilewati)";
        ns.DOM.previewLocation.style.color = "var(--text-muted)";
      }
      ns.UI.closeLocationModal();
      ns.UI.showToast("Melanjutkan presensi tanpa koordinat GPS.");

      if (!ns.state.apiUrl) {
        setTimeout(() => ns.UI.openSettingsModal(), 400);
      }
    },

    /**
     * Parse query parameters from URL for automatic zero-configuration onboarding:
     * Supports: ?q=https://script.google.com/... or ?api=https://...
     * Optional: &gate=Gate+1 &panitia=Budi
     */
    checkUrlAutoConfig() {
      try {
        const searchParams = new URLSearchParams(window.location.search);
        let hashParams = null;
        if (window.location.hash && window.location.hash.includes("=")) {
          hashParams = new URLSearchParams(window.location.hash.replace(/^#\/?/, ""));
        }

        const apiParam = searchParams.get("q") || 
                         searchParams.get("api") || 
                         searchParams.get("apiUrl") || 
                         searchParams.get("url") || 
                         searchParams.get("backend") || 
                         (hashParams && (hashParams.get("q") || hashParams.get("api")));

        const gateParam = searchParams.get("gate") || (hashParams && hashParams.get("gate"));
        const panitiaParam = searchParams.get("panitia") || searchParams.get("operator") || (hashParams && hashParams.get("panitia"));

        let hasNewConfig = false;

        if (apiParam && apiParam.trim().startsWith("http")) {
          const cleanApi = apiParam.trim();
          ns.state.apiUrl = cleanApi;
          localStorage.setItem("absen_api_url", cleanApi);
          if (ns.DOM.inputApiUrl) ns.DOM.inputApiUrl.value = cleanApi;
          hasNewConfig = true;
        }

        if (gateParam && gateParam.trim()) {
          const cleanGate = gateParam.trim();
          ns.state.gateName = cleanGate;
          localStorage.setItem("absen_gate_name", cleanGate);
          if (ns.DOM.inputGateName) ns.DOM.inputGateName.value = cleanGate;
          hasNewConfig = true;
        }

        if (panitiaParam && panitiaParam.trim()) {
          const cleanPanitia = panitiaParam.trim();
          ns.state.panitiaName = cleanPanitia;
          localStorage.setItem("absen_panitia_name", cleanPanitia);
          if (ns.DOM.inputPanitiaName) ns.DOM.inputPanitiaName.value = cleanPanitia;
          hasNewConfig = true;
        }

        if (hasNewConfig) {
          // Bersihkan query string dari browser address bar agar tetap bersih dan rapi
          const cleanUrl = window.location.origin + window.location.pathname;
          window.history.replaceState({}, document.title, cleanUrl);

          setTimeout(() => {
            ns.UI.showToast("🔗 Terhubung otomatis ke Google Apps Script!");
          }, 800);
        }
      } catch (e) {
        console.warn("Auto-config URL parser error:", e);
      }
    },

    /**
     * Copy shareable pre-configured URL to clipboard for panitia:
     * Creates: https://domain/?q=https://script.google.com/...
     */
    handleCopyShareLink() {
      const url = (ns.DOM.inputApiUrl ? ns.DOM.inputApiUrl.value.trim() : "") || ns.state.apiUrl;
      if (!url) {
        ns.UI.showToast("Ketik atau simpan URL Google Apps Script terlebih dahulu.");
        return;
      }

      const baseUrl = window.location.origin + window.location.pathname;
      const shareUrl = `${baseUrl}?q=${encodeURIComponent(url)}`;

      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(shareUrl).then(() => {
          ns.UI.showToast("📋 Link otomatis disalin! Bagikan ke panitia (langsung aktif via ?q=...).");
        }).catch(() => {
          prompt("Salin link ini untuk dibagikan ke panitia:", shareUrl);
        });
      } else {
        prompt("Salin link ini untuk dibagikan ke panitia:", shareUrl);
      }
    },

    /**
     * Handler invoked by Scanner when a QR code is captured
     */
    handleScannedQr(rawText) {
      if (ns.state.isProcessing) return;
      const ticketId = rawText.trim();
      if (!ticketId) return;
      this.processCheckIn(ticketId);
    },

    /**
     * Process Check-in via API with resilient UI states
     */
    async processCheckIn(ticketId, sourceButton = null) {
      if (ns.state.isProcessing) return;
      ns.state.isProcessing = true;

      ns.sounds.init();

      // UI Loading Feedback
      if (ns.DOM.globalLoadingBar) ns.DOM.globalLoadingBar.classList.add("active");
      if (ns.DOM.scannerLoadingHud) {
        ns.DOM.scannerLoadingHud.classList.add("show");
        if (ns.DOM.hudTicketId) ns.DOM.hudTicketId.textContent = `${ticketId} • ${ns.state.currentSessionName}`;
      }
      if (ns.DOM.btnManualCheckin) {
        ns.DOM.btnManualCheckin.disabled = true;
        ns.DOM.btnManualCheckin.classList.add("btn-loading");
        ns.DOM.btnManualCheckin.innerHTML = `<div class="spinner"></div><span>Memproses...</span>`;
      }
      if (ns.DOM.inputManualId) ns.DOM.inputManualId.disabled = true;

      if (sourceButton) {
        sourceButton.disabled = true;
        sourceButton.classList.add("btn-loading");
        sourceButton.innerHTML = `<div class="spinner" style="width:10px;height:10px;border-width:1.5px;display:inline-block;vertical-align:middle;margin-right:4px;"></div> Memproses...`;
      }

      if (ns.DOM.verifyingBox) ns.DOM.verifyingBox.style.display = "inline-flex";
      if (ns.DOM.verifyingText) ns.DOM.verifyingText.textContent = `Memverifikasi ${ticketId}...`;
      ns.UI.updateScannerStatus("Memproses...", `Mengecek sesi: ${ns.state.currentSessionName}`);

      if (navigator.vibrate) navigator.vibrate(60);

      try {
        const result = await ns.API.checkIn(ticketId);
        this.handleCheckInResponse(ticketId, result);
      } catch (err) {
        console.error("Check-in error:", err);
        ns.sounds.playError();

        const isConnErr = err.isConnectionError || 
                          err.isFetchError || 
                          err.isConfigError ||
                          (err.message && (
                            err.message.toLowerCase().includes("failed to fetch") || 
                            err.message.includes("CORS") || 
                            err.message.includes("HTML") || 
                            err.message.includes("404")
                          ));

        ns.UI.showResultModal({
          type: "error",
          title: isConnErr ? "Koneksi Apps Script Gagal" : "Koneksi Gagal",
          subtitle: isConnErr 
            ? "URL Web App mungkin salah, kadaluarsa (404), atau belum diatur ke 'Anyone'."
            : (err.message || "Gagal terhubung ke Google Apps Script."),
          name: "-",
          ticketId: ticketId,
          email: "-",
          time: new Date().toLocaleTimeString(),
          officer: ns.state.panitiaName,
          allowCancel: false,
          isConfigError: isConnErr
        });
        ns.UI.recordHistory({
          ticketId: ticketId,
          sessionId: ns.state.currentSessionId,
          sessionName: ns.state.currentSessionName,
          name: isConnErr ? "Koneksi Gagal (Cek URL API)" : "Koneksi Gagal",
          status: "ERROR",
          time: new Date().toLocaleTimeString()
        });
      } finally {
        this.finishProcessing(sourceButton);
      }
    },

    finishProcessing(sourceButton = null) {
      if (ns.DOM.globalLoadingBar) ns.DOM.globalLoadingBar.classList.remove("active");
      if (ns.DOM.scannerLoadingHud) ns.DOM.scannerLoadingHud.classList.remove("show");

      if (ns.DOM.btnManualCheckin) {
        ns.DOM.btnManualCheckin.disabled = false;
        ns.DOM.btnManualCheckin.classList.remove("btn-loading");
        ns.DOM.btnManualCheckin.innerHTML = `Check In`;
      }
      if (ns.DOM.inputManualId) ns.DOM.inputManualId.disabled = false;

      if (sourceButton) {
        sourceButton.disabled = false;
        sourceButton.classList.remove("btn-loading");
        sourceButton.innerHTML = `Check In`;
      }

      if (ns.DOM.verifyingBox) ns.DOM.verifyingBox.style.display = "none";
      ns.UI.updateScannerStatus("Siap Memindai", `Sesi: ${ns.state.currentSessionName}`);
    },

    handleCheckInResponse(scannedTicketId, res) {
      const attendee = res.attendee || {};
      const attendeeName = attendee.name || "Peserta";
      const attendeeEmail = attendee.email || "-";
      const checkTime = attendee.checkInTime || attendee.firstCheckInTime || new Date().toLocaleTimeString();
      const officer = attendee.scannedBy || ns.state.panitiaName;

      ns.state.lastScanned = {
        ticketId: scannedTicketId,
        sessionId: ns.state.currentSessionId,
        sessionName: ns.state.currentSessionName,
        attendeeName: attendeeName
      };

      if (res.success && res.status === "CHECKED_IN") {
        ns.sounds.playSuccess();
        if (navigator.vibrate) navigator.vibrate([100, 50, 100]);

        ns.state.stats.total++;
        ns.state.stats.success++;
        ns.DOM.statTotal.textContent = ns.state.stats.total;

        ns.UI.showResultModal({
          type: "success",
          title: "CHECK-IN BERHASIL",
          subtitle: `${ns.state.currentSessionName} • Hadir`,
          name: attendeeName,
          ticketId: attendee.ticketId || scannedTicketId,
          email: attendeeEmail,
          time: checkTime,
          officer: officer,
          allowCancel: true
        });

        ns.UI.recordHistory({
          ticketId: scannedTicketId,
          sessionId: ns.state.currentSessionId,
          sessionName: ns.state.currentSessionName,
          name: attendeeName,
          status: "SUCCESS",
          time: checkTime
        });

      } else if (res.status === "ALREADY_CHECKED_IN") {
        ns.sounds.playWarning();
        if (navigator.vibrate) navigator.vibrate([200, 100, 200]);

        ns.state.stats.total++;
        ns.state.stats.duplicate++;
        ns.DOM.statTotal.textContent = ns.state.stats.total;

        ns.UI.showResultModal({
          type: "warning",
          title: "SUDAH ABSEN DI SESI INI",
          subtitle: `Sesi: ${ns.state.currentSessionName} (${checkTime})`,
          name: attendeeName,
          ticketId: attendee.ticketId || scannedTicketId,
          email: attendeeEmail,
          time: checkTime,
          officer: attendee.scannedBy || "Petugas lain",
          allowCancel: true
        });

        ns.UI.recordHistory({
          ticketId: scannedTicketId,
          sessionId: ns.state.currentSessionId,
          sessionName: ns.state.currentSessionName,
          name: attendeeName,
          status: "DUPLICATE",
          time: checkTime
        });

      } else {
        ns.sounds.playError();
        if (navigator.vibrate) navigator.vibrate(300);

        ns.state.stats.total++;
        ns.state.stats.invalid++;
        ns.DOM.statTotal.textContent = ns.state.stats.total;

        ns.UI.showResultModal({
          type: "error",
          title: "TIKET TIDAK VALID",
          subtitle: res.message || "ID tidak ditemukan di database peserta.",
          name: "Tidak Terdaftar",
          ticketId: scannedTicketId,
          email: "-",
          time: new Date().toLocaleTimeString(),
          officer: ns.state.panitiaName,
          allowCancel: false
        });

        ns.UI.recordHistory({
          ticketId: scannedTicketId,
          sessionId: ns.state.currentSessionId,
          sessionName: ns.state.currentSessionName,
          name: "Tidak Terdaftar",
          status: "INVALID",
          time: new Date().toLocaleTimeString()
        });
      }
    },

    /**
     * Cancel attendance check-in
     */
    async handleCancelAttendance(ticketId, sessionId, sessionName, reason = "Dibatalkan oleh panitia") {
      if (ns.DOM.globalLoadingBar) ns.DOM.globalLoadingBar.classList.add("active");
      if (ns.DOM.btnCancelCheckin) {
        ns.DOM.btnCancelCheckin.disabled = true;
        ns.DOM.btnCancelCheckin.innerHTML = `<div class="spinner"></div><span>Membatalkan...</span>`;
      }

      try {
        const result = await ns.API.cancelCheckIn(ticketId, sessionId, sessionName, reason);

        if (result.success) {
          ns.sounds.playWarning();
          ns.UI.showToast(`Kehadiran ${ticketId} pada ${sessionName} berhasil dibatalkan.`);

          if (ns.DOM.resultModal.classList.contains("show")) {
            ns.DOM.resultBanner.className = "result-banner warning";
            ns.DOM.resultIcon.innerHTML = `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
            ns.DOM.resultTitle.textContent = "KEHADIRAN DIBATALKAN";
            ns.DOM.resultSubtitle.textContent = `Status direset ke belum hadir pada ${sessionName}`;
            ns.DOM.btnCancelCheckin.style.display = "none";
            setTimeout(() => ns.UI.closeResultModal(), 2000);
          }

          const targetHistory = ns.state.history.find(h => h.ticketId === ticketId && h.sessionId === sessionId);
          if (targetHistory) {
            targetHistory.status = "CANCELLED";
            localStorage.setItem("absen_history", JSON.stringify(ns.state.history));
            ns.UI.renderHistory();
          }
        } else {
          ns.UI.showToast(`Gagal membatalkan: ${result.message}`);
        }
      } catch (err) {
        console.error("Cancel check-in error:", err);
        const isConnErr = err.isConnectionError || 
                          err.isFetchError || 
                          (err.message && (err.message.toLowerCase().includes("failed to fetch") || err.message.includes("CORS")));
        if (isConnErr) {
          ns.UI.showToast("Gagal membatalkan (404/CORS). Periksa URL Apps Script di Pengaturan.");
        } else {
          ns.UI.showToast(`Gagal membatalkan: ${err.message}`);
        }
      } finally {
        if (ns.DOM.globalLoadingBar) ns.DOM.globalLoadingBar.classList.remove("active");
        if (ns.DOM.btnCancelCheckin) {
          ns.DOM.btnCancelCheckin.disabled = false;
          ns.DOM.btnCancelCheckin.innerHTML = `<span>Batalkan Kehadiran (Salah Orang)</span>`;
        }
      }
    },

    /**
     * Search attendees by query
     */
    async performSearch() {
      const query = ns.DOM.inputManualSearch.value.trim();
      if (!query) {
        ns.UI.showToast("Ketik nama atau email yang dicari.");
        return;
      }

      if (ns.DOM.globalLoadingBar) ns.DOM.globalLoadingBar.classList.add("active");
      if (ns.DOM.btnSearchQuery) {
        ns.DOM.btnSearchQuery.disabled = true;
        ns.DOM.btnSearchQuery.classList.add("btn-loading");
        ns.DOM.btnSearchQuery.innerHTML = `<div class="spinner"></div><span>Mencari...</span>`;
      }
      if (ns.DOM.inputManualSearch) ns.DOM.inputManualSearch.disabled = true;

      ns.DOM.searchResultsList.innerHTML = `
        <div style="text-align: center; color: var(--text-muted); padding: 20px; display: flex; align-items: center; justify-content: center; gap: 8px;">
          <div class="spinner"></div>
          <span>Mencari data untuk ${ns.state.currentSessionName}...</span>
        </div>
      `;

      try {
        const data = await ns.API.searchAttendees(query);
        ns.UI.renderSearchResults(data.results, query);
      } catch (err) {
        console.error("Search error:", err);
        const isConnErr = err.isConnectionError || 
                          err.isFetchError || 
                          err.isConfigError ||
                          (err.message && (
                            err.message.toLowerCase().includes("failed to fetch") || 
                            err.message.includes("CORS") || 
                            err.message.includes("404")
                          ));

        if (isConnErr) {
          ns.DOM.searchResultsList.innerHTML = `
            <div style="text-align: center; color: var(--status-error); padding: 22px 16px; background: rgba(220, 38, 38, 0.04); border-radius: var(--radius-md); border: 1px dashed rgba(220, 38, 38, 0.25); margin-top: 10px;">
              <p style="font-weight: 700; font-size: 14px; margin-bottom: 6px;">Koneksi Google Apps Script Gagal (404/CORS)</p>
              <p style="font-size: 12px; color: var(--text-muted); line-height: 1.45; margin-bottom: 14px;">
                URL Web App mungkin salah, kadaluarsa, atau opsi akses belum disetel ke <strong>Anyone</strong>.
              </p>
              <button type="button" class="btn-primary" onclick="EventPass.UI.openSettingsModal()" style="margin: 0 auto; width: auto; padding: 8px 18px; font-size: 12px; border-radius: var(--radius-md); display: inline-flex; align-items: center; gap: 6px;">
                ⚙️ Buka Pengaturan URL
              </button>
            </div>
          `;
        } else {
          ns.DOM.searchResultsList.innerHTML = `<div style="text-align: center; color: var(--status-error); padding: 20px;">Gagal mengambil data pencarian: ${err.message}</div>`;
        }
      } finally {
        if (ns.DOM.globalLoadingBar) ns.DOM.globalLoadingBar.classList.remove("active");
        if (ns.DOM.btnSearchQuery) {
          ns.DOM.btnSearchQuery.disabled = false;
          ns.DOM.btnSearchQuery.classList.remove("btn-loading");
          ns.DOM.btnSearchQuery.innerHTML = `Cari`;
        }
        if (ns.DOM.inputManualSearch) ns.DOM.inputManualSearch.disabled = false;
      }
    },

    /**
     * Handle OTS (On-the-spot) form submit
     */
    async handleOtsSubmit() {
      const name = ns.DOM.inputOtsName.value.trim();
      const contact = ns.DOM.inputOtsContact.value.trim();
      const notes = ns.DOM.inputOtsNotes.value.trim();

      if (!name) {
        ns.UI.showToast("Nama lengkap peserta wajib diisi.");
        if (ns.DOM.inputOtsName) ns.DOM.inputOtsName.focus();
        return;
      }

      if (ns.DOM.globalLoadingBar) ns.DOM.globalLoadingBar.classList.add("active");
      if (ns.DOM.btnSubmitOts) {
        ns.DOM.btnSubmitOts.disabled = true;
        ns.DOM.btnSubmitOts.classList.add("btn-loading");
        ns.DOM.btnSubmitOts.innerHTML = `<div class="spinner"></div><span>Mendaftarkan & Check-In...</span>`;
      }

      try {
        const result = await ns.API.registerOts(name, contact, notes);

        if (result.success && result.attendee) {
          ns.sounds.playSuccess();
          if (navigator.vibrate) navigator.vibrate([100, 50, 100]);

          ns.state.stats.total++;
          ns.state.stats.success++;
          ns.DOM.statTotal.textContent = ns.state.stats.total;

          const attendee = result.attendee;
          ns.DOM.inputOtsName.value = "";
          ns.DOM.inputOtsContact.value = "";
          ns.DOM.inputOtsNotes.value = "";

          ns.UI.showToast(`${name} berhasil didaftarkan OTS & hadir.`);

          ns.state.lastScanned = {
            ticketId: attendee.ticketId,
            sessionId: ns.state.currentSessionId,
            sessionName: ns.state.currentSessionName,
            attendeeName: name
          };

          ns.UI.showResultModal({
            type: "success",
            title: "REGISTRASI OTS BERHASIL",
            subtitle: `${ns.state.currentSessionName} • Langsung Hadir (Walk-In)`,
            name: name,
            ticketId: attendee.ticketId,
            email: attendee.email || "OTS (Walk-in)",
            time: attendee.checkInTime || new Date().toLocaleTimeString(),
            officer: ns.state.panitiaName,
            allowCancel: true
          });

          ns.UI.recordHistory({
            ticketId: attendee.ticketId,
            sessionId: ns.state.currentSessionId,
            sessionName: ns.state.currentSessionName,
            name: `${name} (OTS)`,
            status: "SUCCESS",
            time: attendee.checkInTime || new Date().toLocaleTimeString()
          });

        } else {
          ns.sounds.playError();
          ns.UI.showToast(`Gagal mendaftarkan: ${result.message || "Terjadi kesalahan server"}`);
        }
      } catch (err) {
        console.error("OTS error:", err);
        ns.sounds.playError();
        const isConnErr = err.isConnectionError || 
                          err.isFetchError || 
                          (err.message && (err.message.toLowerCase().includes("failed to fetch") || err.message.includes("CORS")));
        if (isConnErr) {
          ns.UI.showToast("Gagal mendaftar (404/CORS). URL Apps Script mungkin salah atau belum Anyone.");
        } else {
          ns.UI.showToast(`Gagal mendaftarkan: ${err.message}`);
        }
      } finally {
        if (ns.DOM.globalLoadingBar) ns.DOM.globalLoadingBar.classList.remove("active");
        if (ns.DOM.btnSubmitOts) {
          ns.DOM.btnSubmitOts.disabled = false;
          ns.DOM.btnSubmitOts.classList.remove("btn-loading");
          ns.DOM.btnSubmitOts.innerHTML = `
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
              <circle cx="8.5" cy="7" r="4"></circle>
              <polyline points="17 11 19 13 23 9"></polyline>
            </svg>
            <span>Daftarkan & Langsung Check-In</span>
          `;
        }
      }
    },

    /**
     * Sync sessions from backend
     */
    async syncSessions(isManual = false) {
      if (!ns.state.apiUrl) return;

      if (ns.DOM.btnRefreshSessions) ns.DOM.btnRefreshSessions.classList.add("spinning");
      if (ns.DOM.globalLoadingBar && isManual) ns.DOM.globalLoadingBar.classList.add("active");

      try {
        const data = await ns.API.fetchSessions();
        if (data && data.success && data.sessions && data.sessions.length > 0) {
          ns.state.sessions = data.sessions;
          localStorage.setItem("absen_cached_sessions", JSON.stringify(data.sessions));
          ns.UI.renderSessionDropdown();
          if (isManual) ns.UI.showToast("Daftar sesi berhasil diperbarui.");
        } else if (isManual) {
          ns.UI.showToast("Belum ada sesi aktif di Master Sesi.");
        }
      } catch (err) {
        console.warn("Gagal mengambil sesi:", err);
        const isConnErr = err.isConnectionError || 
                          err.isFetchError || 
                          (err.message && (err.message.toLowerCase().includes("failed to fetch") || err.message.includes("CORS")));
        if (isManual) {
          if (isConnErr) {
            ns.UI.showToast("Gagal terhubung (404/CORS). Periksa URL Apps Script di Pengaturan.");
          } else {
            ns.UI.showToast(`Gagal terhubung: ${err.message}`);
          }
        }
      } finally {
        if (ns.DOM.btnRefreshSessions) ns.DOM.btnRefreshSessions.classList.remove("spinning");
        if (ns.DOM.globalLoadingBar) ns.DOM.globalLoadingBar.classList.remove("active");
      }
    },

    /**
     * Test connection to Apps Script Web App
     */
    async handleTestConnection() {
      const url = ns.DOM.inputApiUrl.value.trim();
      if (!url) {
        ns.UI.showToast("Ketik URL API Apps Script terlebih dahulu.");
        return;
      }

      ns.DOM.btnTestConnection.textContent = "Testing...";
      try {
        const data = await ns.API.testConnection(url);
        if (data && (data.success || data.status === "ONLINE")) {
          ns.UI.showToast("Koneksi Berhasil! API Online.");
        } else {
          ns.UI.showToast("Respons diterima namun format berbeda.");
        }
      } catch (e) {
        ns.UI.showToast(`Gagal: ${e.message}`);
      } finally {
        ns.DOM.btnTestConnection.textContent = "Test Koneksi";
      }
    },

    /**
     * Save settings to localStorage
     */
    handleSaveSettings() {
      const pName = ns.DOM.inputPanitiaName.value.trim() || "Panitia";
      const gName = ns.DOM.inputGateName.value.trim() || "Pintu Masuk";
      const aUrl = ns.DOM.inputApiUrl.value.trim();

      ns.state.panitiaName = pName;
      ns.state.gateName = gName;
      ns.state.apiUrl = aUrl;

      localStorage.setItem("absen_panitia_name", pName);
      localStorage.setItem("absen_gate_name", gName);
      localStorage.setItem("absen_api_url", aUrl);

      ns.UI.renderOperatorHeader();
      ns.UI.closeSettingsModal();
      ns.UI.showToast("Pengaturan berhasil disimpan.");

      if (aUrl) this.syncSessions(true);
    }
  };

  // Bootstrap when document is ready
  document.addEventListener("DOMContentLoaded", () => {
    ns.App.init();
  });

})(window.EventPass);
