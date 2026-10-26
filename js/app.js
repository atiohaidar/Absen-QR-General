/**
 * ==============================================================================
 * EventPass • Main Application Bootstrap & Coordinator (js/app.js)
 * Ties together State, Audio, API, Scanner, and UI modules.
 * ==============================================================================
 */

window.EventPass = window.EventPass || {};

(function (ns) {
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
      if (ns.state.customFields && ns.state.customFields.length > 0) {
        ns.UI.renderOtsCustomFields(ns.state.customFields);
      }

      // Asynchronously enrich device model (e.g. Samsung SM-..., Pixel, Xiaomi) via Client Hints
      if (typeof ns.enrichDeviceInfoWithModel === "function") {
        ns.enrichDeviceInfoWithModel();
      }

      this.bindEventListeners();
      ns.Scanner.startScanning();

      // Inisialisasi Offline Queue & Background Sync
      if (ns.Sync) {
        ns.Sync.init();
      }

      // Check if location is allowed, otherwise display full-screen blocking overlay
      this.checkLocationState();

      // Sync active sessions from Google Sheets
      if (ns.state.apiUrl) {
        this.syncSessions(false);
      }

      // Check operator identity on startup
      setTimeout(() => {
        const isLocModalShowing = ns.DOM.locationModal && ns.DOM.locationModal.classList.contains("show");
        if (!isLocModalShowing) {
          if (!ns.state.panitiaName) {
            ns.UI.openOperatorModal({ force: true });
          } else if (!ns.state.apiUrl) {
            ns.UI.openSettingsModal();
            ns.UI.showToast("Silakan masukkan Apps Script API URL terlebih dahulu.");
          }
        }
      }, 700);
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
          if (ns.state.panitiaName && ns.state.panitiaName.trim()) {
            ns.UI.closeOperatorModal();
          }
        }
      });

      if (DOM.btnRefreshSessions) {
        DOM.btnRefreshSessions.addEventListener("click", (e) => {
          e.stopPropagation();
          this.syncSessions(true);
          if (ns.Sync && ns.state.apiUrl) {
            ns.Sync.syncAttendees(false);
          }
        });
      }

      // 1b. Mode Presensi (Check-In vs Check-Out) Toggle
      if (DOM.btnModeIn) {
        DOM.btnModeIn.addEventListener("click", () => {
          ns.state.currentScanMode = "IN";
          localStorage.setItem("absen_scan_mode", "IN");
          ns.UI.updateScanModeUI();
          ns.UI.showToast("Mode aktif: Check-In (Masuk) 🟢");
          if (DOM.inputManualSearch && DOM.inputManualSearch.value.trim()) {
            this.performSearch();
          }
        });
      }
      if (DOM.btnModeOut) {
        DOM.btnModeOut.addEventListener("click", () => {
          ns.state.currentScanMode = "OUT";
          localStorage.setItem("absen_scan_mode", "OUT");
          ns.UI.updateScanModeUI();
          ns.UI.showToast("Mode aktif: Check-Out (Keluar) 🟠");
          if (DOM.inputManualSearch && DOM.inputManualSearch.value.trim()) {
            this.performSearch();
          }
        });
      }

      // 1c. Anomaly Modal Actions (Checkout Tanpa Checkin)
      if (DOM.btnCloseAnomalyModal) {
        DOM.btnCloseAnomalyModal.addEventListener("click", () => ns.UI.closeAnomalyModal(true));
      }
      if (DOM.btnCancelAnomaly) {
        DOM.btnCancelAnomaly.addEventListener("click", () => ns.UI.closeAnomalyModal(true));
      }
      if (DOM.btnForceCheckout) {
        DOM.btnForceCheckout.addEventListener("click", () => {
          const reason = (DOM.anomalyReasonSelect ? DOM.anomalyReasonSelect.value : "Lolos gate masuk / terlambat") || "Lolos gate masuk";
          if (ns.UI._anomalyCallbacks && typeof ns.UI._anomalyCallbacks.onConfirm === "function") {
            ns.UI._anomalyCallbacks.onConfirm(reason);
          }
          ns.UI.closeAnomalyModal(false);
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
            if (targetTab === "history") ns.UI.renderHistory();
            if (targetTab === "ots") ns.UI.renderOtsCustomFields(ns.state.customFields);
          }
        });
      });

      // 3. Camera Controls (Flip, Torch, Reconnect, Upload Image)
      if (DOM.btnFlipCam) {
        DOM.btnFlipCam.addEventListener("click", () => ns.Scanner.flipCamera());
      }
      if (DOM.btnTorch) {
        DOM.btnTorch.addEventListener("click", () => ns.Scanner.toggleTorch());
      }
      if (DOM.btnScanImage && DOM.inputQrFile) {
        DOM.btnScanImage.addEventListener("click", () => DOM.inputQrFile.click());
        DOM.inputQrFile.addEventListener("change", async (e) => {
          const file = e.target.files && e.target.files[0];
          if (file) {
            await ns.Scanner.scanImageFile(file);
            DOM.inputQrFile.value = "";
          }
        });
      }
      if (DOM.btnManualUploadQr && DOM.inputQrFile) {
        DOM.btnManualUploadQr.addEventListener("click", () => DOM.inputQrFile.click());
      }
      const viewport = document.querySelector(".scanner-viewport-wrapper");
      if (viewport) {
        viewport.addEventListener("dragover", (e) => {
          e.preventDefault();
          viewport.classList.add("drag-over");
        });
        viewport.addEventListener("dragleave", () => {
          viewport.classList.remove("drag-over");
        });
        viewport.addEventListener("drop", async (e) => {
          e.preventDefault();
          viewport.classList.remove("drag-over");
          const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
          if (file && file.type && file.type.startsWith("image/")) {
            await ns.Scanner.scanImageFile(file);
          }
        });
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

      if (DOM.btnRecheckServer) {
        DOM.btnRecheckServer.addEventListener("click", async () => {
          if (!ns.state.lastScanned || !ns.state.lastScanned.ticketId) return;
          const { ticketId, sessionId, sessionName } = ns.state.lastScanned;

          DOM.btnRecheckServer.disabled = true;
          DOM.btnRecheckServer.innerHTML = `<div class="spinner" style="width:12px;height:12px;border-width:1.5px;margin-right:6px;display:inline-block;vertical-align:middle;"></div> <span>Mengecek ke spreadsheet...</span>`;

          try {
            const res = await ns.API.checkIn(ticketId);
            if (res && res.success) {
              // Sukses! Admin di Sheets sudah menghapus status hadirnya, sehingga checkIn baru diterima
              ns.sounds.playSuccess();
              if (navigator.vibrate) navigator.vibrate([100, 50, 100]);

              const upperId = ticketId.toUpperCase();
              if (ns.state.cachedAttendees && ns.state.cachedAttendees[upperId]) {
                if (!ns.state.cachedAttendees[upperId].checkedInSessions) {
                  ns.state.cachedAttendees[upperId].checkedInSessions = {};
                }
                ns.state.cachedAttendees[upperId].checkedInSessions[sessionId] = res.attendee?.checkInTime || new Date().toLocaleTimeString();
                localStorage.setItem("absen_cached_attendees", JSON.stringify(ns.state.cachedAttendees));
              }

              ns.UI.recordHistory({
                ticketId: ticketId,
                sessionId: sessionId,
                sessionName: sessionName,
                name: res.attendee?.name || "Peserta",
                status: "SUCCESS",
                time: res.attendee?.checkInTime || new Date().toLocaleTimeString()
              });

              DOM.resultBanner.className = "result-banner success";
              DOM.resultIcon.innerHTML = `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
              DOM.resultTitle.textContent = "CHECK-IN BERHASIL";
              DOM.resultSubtitle.textContent = `Status direset & Terverifikasi (${sessionName})`;
              DOM.detailTime.textContent = res.attendee?.checkInTime || new Date().toLocaleTimeString();
              DOM.btnRecheckServer.style.display = "none";
              if (DOM.btnCancelCheckin) DOM.btnCancelCheckin.style.display = "flex";

              ns.UI.showToast("Status berhasil diverifikasi ulang dari spreadsheet!");
            } else if (res && res.status === "NOT_FOUND") {
              // Tiket telah dihapus admin di spreadsheet
              ns.sounds.playError();
              const upperId = ticketId.toUpperCase();
              if (ns.state.cachedAttendees) {
                delete ns.state.cachedAttendees[upperId];
                localStorage.setItem("absen_cached_attendees", JSON.stringify(ns.state.cachedAttendees));
              }
              if (ns.Sync) ns.Sync.updateCacheCountUI();

              DOM.resultBanner.className = "result-banner error";
              DOM.resultIcon.innerHTML = `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
              DOM.resultTitle.textContent = "TIKET TELAH DIHAPUS";
              DOM.resultSubtitle.textContent = "Data peserta tidak ada lagi di spreadsheet";
              DOM.btnRecheckServer.style.display = "none";
              if (DOM.btnCancelCheckin) DOM.btnCancelCheckin.style.display = "none";

              ns.UI.showToast("⚠️ Tiket ini sudah dihapus di Google Sheets.");
            } else {
              // Masih tercatat hadir di database
              ns.sounds.playWarning();
              const prevTime = res.attendee?.firstCheckInTime || "-";
              DOM.resultSubtitle.textContent = `Masih tercatat HADIR di spreadsheet (${prevTime})`;
              DOM.btnRecheckServer.disabled = false;
              DOM.btnRecheckServer.innerHTML = `<span>Sudah Dicek: Masih Hadir (${prevTime})</span>`;
              ns.UI.showToast(`ℹ️ Di spreadsheet masih tercatat HADIR (${prevTime})`);
            }
          } catch (err) {
            console.error("Recheck error:", err);
            DOM.btnRecheckServer.disabled = false;
            DOM.btnRecheckServer.innerHTML = `<span>Gagal cek (${err.message}). Coba lagi</span>`;
            ns.UI.showToast(`Gagal cek spreadsheet: ${err.message}`);
          }
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
          if (!this.requirePanitiaName()) return;
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

      // 7.5. Operator Identity Modal (Wajib Isi Nama)
      if (DOM.operatorBadgeBtn) {
        DOM.operatorBadgeBtn.addEventListener("click", () => {
          ns.UI.openOperatorModal({ force: !ns.state.panitiaName });
        });
      }
      if (DOM.btnSaveOperator) {
        DOM.btnSaveOperator.addEventListener("click", () => this.handleSaveOperator());
      }
      if (DOM.btnCloseOperator) {
        DOM.btnCloseOperator.addEventListener("click", () => ns.UI.closeOperatorModal());
      }
      if (DOM.operatorModal) {
        DOM.operatorModal.addEventListener("click", (e) => {
          if (e.target === DOM.operatorModal) {
            // Hanya izinkan tutup modal jika nama petugas sudah terisi
            if (ns.state.panitiaName && ns.state.panitiaName.trim()) {
              ns.UI.closeOperatorModal();
            }
          }
        });
      }
      if (DOM.inputOpName) {
        DOM.inputOpName.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            this.handleSaveOperator();
          }
        });
        DOM.inputOpName.addEventListener("input", () => {
          DOM.inputOpName.classList.remove("error-highlight");
          if (DOM.opNameError) DOM.opNameError.style.display = "none";
        });
      }
      if (DOM.inputOpGate) {
        DOM.inputOpGate.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            this.handleSaveOperator();
          }
        });
      }

      // 8. Driver.js Tour & Settings Modal
      if (DOM.btnStartTour) {
        DOM.btnStartTour.addEventListener("click", () => {
          if (ns.Tour && typeof ns.Tour.start === "function") {
            ns.Tour.start();
          }
        });
      }
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
      if (DOM.cfgInstantMode) {
        DOM.cfgInstantMode.addEventListener("change", () => {
          ns.state.instantMode = DOM.cfgInstantMode.checked;
          localStorage.setItem("absen_instant_mode", ns.state.instantMode);
          ns.UI.showToast(ns.state.instantMode ? "⚡ Mode Scan Instan (Sat-Set 0.05s) AKTIF." : "🌐 Mode Direct Server AKTIF (Setiap scan nunggu server).");
        });
      }
      if (DOM.btnSyncAttendees) {
        DOM.btnSyncAttendees.addEventListener("click", () => {
          if (ns.Sync) ns.Sync.syncAttendees(true);
        });
      }
      if (DOM.cloudSyncDot) {
        DOM.cloudSyncDot.style.cursor = "pointer";
        DOM.cloudSyncDot.addEventListener("click", () => {
          if (!ns.state.apiUrl || !ns.state.apiUrl.trim()) {
            ns.UI.openSettingsModal();
            ns.UI.showToast("Silakan atur URL Google Apps Script terlebih dahulu.");
            return;
          }
          if (ns.state.isApiConnected === false) {
            ns.UI.showToast("Mengecek kembali koneksi ke Google Apps Script...");
            ns.App.syncSessions(true);
            return;
          }
          if (ns.Sync) ns.Sync.flushQueue(true);
        });
      }
      if (DOM.syncQueueBadge) {
        DOM.syncQueueBadge.style.cursor = "pointer";
        DOM.syncQueueBadge.addEventListener("click", () => {
          if (ns.Sync) ns.Sync.flushQueue(true);
        });
      }
      if (DOM.btnSyncNowHistory) {
        DOM.btnSyncNowHistory.addEventListener("click", () => {
          if (ns.Sync) ns.Sync.flushQueue(true);
        });
      }

      // Helper to clear local attendees cache safely
      const handleClearCachePrompt = () => {
        if (!confirm("Hapus seluruh cache database peserta di perangkat ini?\n\n(Data di Google Sheets tetap 100% AMAN. Anda dapat mengunduh data terbaru kapan saja dengan klik 'Sync Database').")) {
          return;
        }
        ns.state.cachedAttendees = {};
        localStorage.removeItem("absen_cached_attendees");
        localStorage.removeItem("absen_last_sync_time");
        ns.state.lastSyncTime = null;

        if (ns.Sync) {
          ns.Sync.updateCacheCountUI();
          ns.Sync.updateSyncUI();
        }
        ns.UI.showToast("Cache data peserta lokal berhasil dibersihkan.");
      };

      if (DOM.btnClearCache) {
        DOM.btnClearCache.addEventListener("click", handleClearCachePrompt);
      }
      if (DOM.btnClearAllData) {
        DOM.btnClearAllData.addEventListener("click", handleClearCachePrompt);
      }

      // 9. History Clear
      if (DOM.btnClearHistory) {
        DOM.btnClearHistory.addEventListener("click", () => {
          if (!confirm("Bersihkan seluruh riwayat pemindaian pada perangkat ini?")) return;
          ns.state.history = [];
          localStorage.removeItem("absen_history");
          ns.UI.renderHistory();
          ns.UI.showToast("Riwayat pemindaian telah dibersihkan.");
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

              if (!ns.state.panitiaName) {
                setTimeout(() => ns.UI.openOperatorModal({ force: true }), 400);
              } else if (!ns.state.apiUrl) {
                setTimeout(() => ns.UI.openSettingsModal(), 400);
              }
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

          if (!ns.state.panitiaName) {
            setTimeout(() => ns.UI.openOperatorModal({ force: true }), 400);
          } else if (!ns.state.apiUrl) {
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

      if (!ns.state.panitiaName) {
        setTimeout(() => ns.UI.openOperatorModal({ force: true }), 400);
      } else if (!ns.state.apiUrl) {
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
        let isUrlChanged = false;

        if (apiParam && apiParam.trim().startsWith("http")) {
          const cleanApi = apiParam.trim();
          isUrlChanged = (ns.state.apiUrl && ns.state.apiUrl !== cleanApi);
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

        if (isUrlChanged) {
          this.purgeAllEventData(ns.state.apiUrl, true);
        }

        if (hasNewConfig) {
          // Bersihkan query string dari browser address bar agar tetap bersih dan rapi
          const cleanUrl = window.location.origin + window.location.pathname;
          window.history.replaceState({}, document.title, cleanUrl);

          setTimeout(() => {
            ns.UI.showToast("🔗 Terhubung otomatis ke Google Apps Script baru!");
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

      if (!this.requirePanitiaName(ticketId)) return;
      this.processCheckIn(ticketId);
    },

    /**
     * Process Check-in via API with resilient UI states & Instant Scan Mode
     */
    async processCheckIn(ticketId, sourceButton = null) {
      if (ns.state.isProcessing) return;

      const rawTicketId = String(ticketId || "").trim();
      if (!rawTicketId) return;

      if (!this.requirePanitiaName(rawTicketId, sourceButton)) return;

      const upperTicketId = rawTicketId.toUpperCase();
      const currentSessionId = ns.state.currentSessionId || "SESI-01";
      const currentSessionName = ns.state.currentSessionName || "Sesi Utama";
      const currentOperator = [ns.state.panitiaName, ns.state.gateName].filter(Boolean).join(" • ") || "-";

      // Deteksi apakah sesi yang aktif bertipe CHECK_IN_OUT
      const activeSessionObj = (ns.state.sessions || []).find(s => s.id === currentSessionId);
      const isInOutSession = (activeSessionObj && activeSessionObj.type === "CHECK_IN_OUT");
      const scanMode = isInOutSession ? (ns.state.currentScanMode || "IN") : "SINGLE";
      const effectiveSessionId = isInOutSession ? `${currentSessionId}_${scanMode}` : currentSessionId;
      const effectiveSessionName = isInOutSession ? `${currentSessionName} (${scanMode === "IN" ? "Masuk" : "Keluar"})` : currentSessionName;

      // =========================================================================
      // ⚡ INSTANT SCAN MODE (SAT-SET 0.05s / OFFLINE-READY LOCAL LOOKUP)
      // =========================================================================
      if (ns.state.instantMode && ns.Sync) {
        ns.sounds.init();

        const cachedAttendee = ns.state.cachedAttendees ? ns.state.cachedAttendees[upperTicketId] : null;

        // 1. Cek duplikasi di sesi/mode ini
        const alreadyInCacheSession = cachedAttendee && cachedAttendee.checkedInSessions && cachedAttendee.checkedInSessions[effectiveSessionId];
        const alreadyInQueue = ns.state.syncQueue && ns.state.syncQueue.some(
          item => String(item.ticketId || "").toUpperCase() === upperTicketId && item.sessionId === effectiveSessionId && !item.isDuplicate
        );
        const alreadyInHistory = !cachedAttendee && ns.state.history && ns.state.history.some(
          h => String(h.ticketId || "").toUpperCase() === upperTicketId && h.sessionId === effectiveSessionId && (h.status === "SUCCESS" || h.status === "CHECKED_IN" || h.status === "CHECKED_OUT")
        );

        if (alreadyInCacheSession || alreadyInQueue || alreadyInHistory) {
          ns.state.isProcessing = true;
          ns.sounds.playWarning();
          if (navigator.vibrate) navigator.vibrate([200, 100, 200]);

          ns.state.stats.total++;
          ns.state.stats.duplicate++;
          if (ns.DOM.statTotal) ns.DOM.statTotal.textContent = ns.state.stats.total;

          const cached = cachedAttendee || {};
          const attendeeName = cached.name || "Peserta";
          const checkTime = (alreadyInCacheSession && typeof alreadyInCacheSession === "string") ? alreadyInCacheSession : new Date().toLocaleTimeString();

          ns.state.lastScanned = {
            ticketId: rawTicketId,
            sessionId: effectiveSessionId,
            sessionName: effectiveSessionName,
            attendeeName: attendeeName
          };

          const isOut = (scanMode === "OUT");
          ns.UI.showResultModal({
            type: "warning",
            title: isOut ? "SUDAH CHECK-OUT SEBELUMNYA" : "SUDAH ABSEN DI SESI INI",
            subtitle: `Sesi: ${effectiveSessionName} (Pemeriksaan Instan)`,
            name: attendeeName,
            ticketId: rawTicketId,
            email: cached.email || "-",
            time: checkTime,
            timeLabel: isOut ? "Waktu Keluar" : "Waktu Masuk",
            officer: currentOperator,
            allowCancel: true,
            allowRecheck: true
          });

          ns.UI.recordHistory({
            ticketId: rawTicketId,
            sessionId: effectiveSessionId,
            sessionName: effectiveSessionName,
            name: attendeeName,
            status: "DUPLICATE",
            time: checkTime
          });

          // Masukkan ke background queue sebagai duplikat untuk audit trail
          const isAlreadyQueuedDup = ns.state.syncQueue && ns.state.syncQueue.some(
            item => String(item.ticketId || "").toUpperCase() === upperTicketId && item.sessionId === effectiveSessionId && item.isDuplicate
          );
          if (!isAlreadyQueuedDup) {
            ns.Sync.enqueue({
              ticketId: rawTicketId,
              sessionId: effectiveSessionId,
              sessionName: effectiveSessionName,
              scannedBy: ns.state.panitiaName,
              gate: ns.state.gateName || (isOut ? "Pintu Keluar" : "Pintu Masuk"),
              mapsUrl: ns.state.location ? ns.state.location.mapsUrl : "-",
              deviceInfo: ns.state.deviceInfo || "-",
              clientTime: ns.Sync ? ns.Sync.formatLocalIsoDateTime() : new Date().toLocaleTimeString(),
              scanMode: scanMode,
              isDuplicate: true
            });
          }

          return;
        }

        // =========================================================================
        // ⚠️ ANOMALY CHECK: CHECK-OUT TAPI BELUM CHECK-IN
        // =========================================================================
        if (isInOutSession && scanMode === "OUT" && cachedAttendee) {
          const inSessionId = `${currentSessionId}_IN`;
          const hasCheckedIn = Boolean(
            (cachedAttendee.checkedInSessions && cachedAttendee.checkedInSessions[inSessionId]) ||
            (ns.state.syncQueue && ns.state.syncQueue.some(item => String(item.ticketId || "").toUpperCase() === upperTicketId && item.sessionId === inSessionId && !item.isDuplicate)) ||
            (ns.state.history && ns.state.history.some(h => String(h.ticketId || "").toUpperCase() === upperTicketId && h.sessionId === inSessionId && (h.status === "SUCCESS" || h.status === "CHECKED_IN")))
          );

          if (!hasCheckedIn) {
            // Trigger Anomaly Modal!
            ns.state.isProcessing = true;
            ns.sounds.playWarning();
            if (navigator.vibrate) navigator.vibrate([200, 100, 200]);

            ns.UI.openAnomalyModal({
              name: cachedAttendee.name || "Peserta",
              ticketId: rawTicketId,
              onConfirm: (reason) => {
                this.executeSuccessfulScan({
                  rawTicketId,
                  cachedAttendee,
                  effectiveSessionId,
                  effectiveSessionName,
                  scanMode: "OUT",
                  currentOperator,
                  isAnomaly: true,
                  anomalyReason: reason
                });
              },
              onCancel: () => {
                ns.state.isProcessing = false;
                ns.Scanner.resetReticle();
              }
            });
            return;
          }
        }

        // 2. Cek apakah tiket terdaftar di cache lokal
        if (cachedAttendee) {
          this.executeSuccessfulScan({
            rawTicketId,
            cachedAttendee,
            effectiveSessionId,
            effectiveSessionName,
            scanMode,
            currentOperator,
            isAnomaly: false,
            anomalyReason: ""
          });
          return;
        }

        // 3. JIKA TIKET BELUM ADA DI CACHE LOKAL:
        console.log(`[Smart Fallback] Tiket ${rawTicketId} belum ada di cache lokal, cek langsung ke server...`);
      }

      // =========================================================================
      // STANDARD / FALLBACK SERVER CHECK
      // =========================================================================
      ns.state.isProcessing = true;
      ns.sounds.init();

      // UI Loading Feedback
      if (ns.DOM.globalLoadingBar) ns.DOM.globalLoadingBar.classList.add("active");
      if (ns.DOM.scannerLoadingHud) {
        ns.DOM.scannerLoadingHud.classList.add("show");
        if (ns.DOM.hudTicketId) ns.DOM.hudTicketId.textContent = `${rawTicketId} • ${effectiveSessionName}`;
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
      if (ns.DOM.verifyingText) ns.DOM.verifyingText.textContent = `Memverifikasi ${rawTicketId}...`;
      ns.UI.updateScannerStatus("Memproses...", `Mengecek sesi: ${effectiveSessionName}`);

      if (navigator.vibrate) navigator.vibrate(60);

      try {
        const result = await ns.API.checkIn(rawTicketId, {
          sessionId: effectiveSessionId,
          sessionName: effectiveSessionName,
          scanMode: scanMode
        });
        this.handleCheckInResponse(rawTicketId, result, {
          scanMode,
          effectiveSessionId,
          effectiveSessionName
        });
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
          ticketId: rawTicketId,
          email: "-",
          time: new Date().toLocaleTimeString(),
          timeLabel: (scanMode === "OUT") ? "Waktu Keluar" : "Waktu Masuk",
          officer: currentOperator,
          allowCancel: false,
          isConfigError: isConnErr
        });
        ns.UI.recordHistory({
          ticketId: rawTicketId,
          sessionId: effectiveSessionId,
          sessionName: effectiveSessionName,
          name: isConnErr ? "Koneksi Gagal (Cek URL API)" : "Koneksi Gagal",
          status: "ERROR",
          time: new Date().toLocaleTimeString()
        });
      } finally {
        this.finishProcessing(sourceButton);
      }
    },

    /**
     * Helper to execute a successful scan (both normal and anomaly) in instant mode
     */
    executeSuccessfulScan({ rawTicketId, cachedAttendee, effectiveSessionId, effectiveSessionName, scanMode, currentOperator, isAnomaly, anomalyReason }) {
      ns.state.isProcessing = true;
      ns.sounds.playSuccess();
      if (navigator.vibrate) navigator.vibrate([100, 50, 100]);

      ns.state.stats.total++;
      ns.state.stats.success++;
      if (ns.DOM.statTotal) ns.DOM.statTotal.textContent = ns.state.stats.total;

      const checkTime = new Date().toLocaleTimeString();
      const attendeeName = cachedAttendee.name || "Peserta";

      // Simpan status hadir sesi ini di memori agar anti double-scan selamanya
      if (!cachedAttendee.checkedInSessions) cachedAttendee.checkedInSessions = {};
      cachedAttendee.checkedInSessions[effectiveSessionId] = checkTime;
      try {
        localStorage.setItem("absen_cached_attendees", JSON.stringify(ns.state.cachedAttendees));
      } catch (e) { }

      ns.state.lastScanned = {
        ticketId: rawTicketId,
        sessionId: effectiveSessionId,
        sessionName: effectiveSessionName,
        attendeeName: attendeeName
      };

      const isOut = (scanMode === "OUT");
      const title = isOut ? (isAnomaly ? "CHECK-OUT (ANOMALI) ⚠️" : "CHECK-OUT BERHASIL ⚡") : "CHECK-IN BERHASIL ⚡";
      const subtitle = isAnomaly
        ? `Lolos Check-Out • Anomali: ${anomalyReason || "Tanpa Check-in"}`
        : `${effectiveSessionName} • ${isOut ? "Kepulangan Terverifikasi" : "Hadir (Mode Instan)"}`;

      ns.UI.showResultModal({
        type: isAnomaly ? "warning" : "success",
        title: title,
        subtitle: subtitle,
        name: attendeeName,
        ticketId: rawTicketId,
        email: cachedAttendee.email || "-",
        time: checkTime,
        timeLabel: isOut ? "Waktu Keluar" : "Waktu Masuk",
        officer: currentOperator,
        allowCancel: true
      });

      ns.UI.recordHistory({
        ticketId: rawTicketId,
        sessionId: effectiveSessionId,
        sessionName: effectiveSessionName,
        name: attendeeName,
        status: isAnomaly ? "ANOMALY_CHECKOUT" : (isOut ? "CHECKED_OUT" : "SUCCESS"),
        time: checkTime
      });

      // Masukkan ke background sync queue untuk di-batch ke Google Apps Script
      ns.Sync.enqueue({
        ticketId: rawTicketId,
        sessionId: effectiveSessionId,
        sessionName: effectiveSessionName,
        scannedBy: ns.state.panitiaName,
        gate: ns.state.gateName || (isOut ? "Pintu Keluar" : "Pintu Masuk"),
        mapsUrl: ns.state.location ? ns.state.location.mapsUrl : "-",
        deviceInfo: ns.state.deviceInfo || "-",
        clientTime: ns.Sync ? ns.Sync.formatLocalIsoDateTime() : checkTime,
        scanMode: scanMode,
        isAnomaly: !!isAnomaly,
        anomalyReason: anomalyReason || ""
      });

      ns.UI.removeSearchResultItem(rawTicketId);
      if (ns.DOM.inputManualId) ns.DOM.inputManualId.value = "";
      this.finishProcessing();
    },

    finishProcessing(sourceButton = null) {
      if (ns.DOM.globalLoadingBar) ns.DOM.globalLoadingBar.classList.remove("active");
      if (ns.DOM.scannerLoadingHud) ns.DOM.scannerLoadingHud.classList.remove("show");

      if (ns.DOM.btnManualCheckin) {
        ns.DOM.btnManualCheckin.disabled = false;
        ns.DOM.btnManualCheckin.classList.remove("btn-loading");
        const isOut = (ns.state.currentScanMode === "OUT");
        ns.DOM.btnManualCheckin.innerHTML = isOut ? `Check Out` : `Check In`;
      }
      if (ns.DOM.inputManualId) ns.DOM.inputManualId.disabled = false;

      if (sourceButton) {
        sourceButton.disabled = false;
        sourceButton.classList.remove("btn-loading");
        const isOut = (ns.state.currentScanMode === "OUT");
        sourceButton.innerHTML = isOut ? `Check Out` : `Check In`;
      }

      if (ns.DOM.verifyingBox) ns.DOM.verifyingBox.style.display = "none";
      ns.UI.updateScanModeUI();
    },

    handleCheckInResponse(scannedTicketId, res, options = {}) {
      const attendee = res.attendee || {};
      const attendeeName = attendee.name || "Peserta";
      const attendeeEmail = attendee.email || "-";
      const checkTime = attendee.checkInTime || attendee.firstCheckInTime || new Date().toLocaleTimeString();
      const currentOperator = [ns.state.panitiaName, ns.state.gateName].filter(Boolean).join(" • ") || "-";
      const officer = attendee.scannedBy || currentOperator;

      const effectiveSessionId = options.effectiveSessionId || ns.state.currentSessionId;
      const effectiveSessionName = options.effectiveSessionName || ns.state.currentSessionName;
      const scanMode = options.scanMode || (effectiveSessionId.endsWith("_OUT") ? "OUT" : "IN");
      const isOut = (scanMode === "OUT");

      ns.state.lastScanned = {
        ticketId: scannedTicketId,
        sessionId: effectiveSessionId,
        sessionName: effectiveSessionName,
        attendeeName: attendeeName
      };

      if (res.success && (res.status === "CHECKED_IN" || res.status === "CHECKED_OUT")) {
        ns.sounds.playSuccess();
        if (navigator.vibrate) navigator.vibrate([100, 50, 100]);

        ns.state.stats.total++;
        ns.state.stats.success++;
        ns.DOM.statTotal.textContent = ns.state.stats.total;

        const title = isOut ? (res.isAnomaly ? "CHECK-OUT (ANOMALI) ⚠️" : "CHECK-OUT BERHASIL") : "CHECK-IN BERHASIL";
        const subtitle = `${effectiveSessionName} • ${isOut ? "Kepulangan Terverifikasi" : "Hadir"}`;

        ns.UI.showResultModal({
          type: res.isAnomaly ? "warning" : "success",
          title: title,
          subtitle: subtitle,
          name: attendeeName,
          ticketId: attendee.ticketId || scannedTicketId,
          email: attendeeEmail,
          time: checkTime,
          timeLabel: isOut ? "Waktu Keluar" : "Waktu Masuk",
          officer: officer,
          allowCancel: true
        });

        ns.UI.recordHistory({
          ticketId: scannedTicketId,
          sessionId: effectiveSessionId,
          sessionName: effectiveSessionName,
          name: attendeeName,
          status: isOut ? "CHECKED_OUT" : "SUCCESS",
          time: checkTime
        });

        // Update cache lokal agar scan selanjutnya langsung instant 0.05s
        if (!ns.state.cachedAttendees) ns.state.cachedAttendees = {};
        const uId = String(attendee.ticketId || scannedTicketId).toUpperCase().trim();
        const existingSessions = (ns.state.cachedAttendees[uId] && ns.state.cachedAttendees[uId].checkedInSessions) || {};
        existingSessions[effectiveSessionId] = checkTime;
        ns.state.cachedAttendees[uId] = {
          ticketId: attendee.ticketId || scannedTicketId,
          name: attendeeName,
          email: attendeeEmail,
          checkedInSessions: existingSessions
        };
        try {
          localStorage.setItem("absen_cached_attendees", JSON.stringify(ns.state.cachedAttendees));
        } catch (e) { }
        if (ns.Sync) ns.Sync.updateCacheCountUI();

        ns.UI.removeSearchResultItem(scannedTicketId);
        if (ns.DOM.inputManualId) ns.DOM.inputManualId.value = "";

      } else if (res.status === "ALREADY_CHECKED_IN" || res.status === "ALREADY_CHECKED_OUT") {
        ns.sounds.playWarning();
        if (navigator.vibrate) navigator.vibrate([200, 100, 200]);

        ns.state.stats.total++;
        ns.state.stats.duplicate++;
        ns.DOM.statTotal.textContent = ns.state.stats.total;

        ns.UI.showResultModal({
          type: "warning",
          title: (res.status === "ALREADY_CHECKED_OUT" || isOut) ? "SUDAH CHECK-OUT SEBELUMNYA" : "SUDAH ABSEN DI SESI INI",
          subtitle: `Sesi: ${effectiveSessionName} (${checkTime})`,
          name: attendeeName,
          ticketId: attendee.ticketId || scannedTicketId,
          email: attendeeEmail,
          time: checkTime,
          timeLabel: isOut ? "Waktu Keluar" : "Waktu Masuk",
          officer: attendee.scannedBy || "Petugas lain",
          allowCancel: true
        });

        ns.UI.recordHistory({
          ticketId: scannedTicketId,
          sessionId: effectiveSessionId,
          sessionName: effectiveSessionName,
          name: attendeeName,
          status: "DUPLICATE",
          time: checkTime
        });

        // Simpan info peserta ke cache lokal
        if (!ns.state.cachedAttendees) ns.state.cachedAttendees = {};
        const uIdDup = String(attendee.ticketId || scannedTicketId).toUpperCase().trim();
        const existingSessionsDup = (ns.state.cachedAttendees[uIdDup] && ns.state.cachedAttendees[uIdDup].checkedInSessions) || {};
        existingSessionsDup[effectiveSessionId] = checkTime;
        ns.state.cachedAttendees[uIdDup] = {
          ticketId: attendee.ticketId || scannedTicketId,
          name: attendeeName,
          email: attendeeEmail,
          checkedInSessions: existingSessionsDup
        };
        try {
          localStorage.setItem("absen_cached_attendees", JSON.stringify(ns.state.cachedAttendees));
        } catch (e) { }
        if (ns.Sync) ns.Sync.updateCacheCountUI();

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
          timeLabel: isOut ? "Waktu Keluar" : "Waktu Masuk",
          officer: currentOperator,
          allowCancel: false
        });

        ns.UI.recordHistory({
          ticketId: scannedTicketId,
          sessionId: effectiveSessionId,
          sessionName: effectiveSessionName,
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
      if (!this.requirePanitiaName()) return;

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

          const upperId = (ticketId || "").toUpperCase().trim();
          if (ns.state.cachedAttendees && ns.state.cachedAttendees[upperId] && ns.state.cachedAttendees[upperId].checkedInSessions) {
            delete ns.state.cachedAttendees[upperId].checkedInSessions[sessionId];
            localStorage.setItem("absen_cached_attendees", JSON.stringify(ns.state.cachedAttendees));
          }
          if (ns.state.syncQueue) {
            ns.state.syncQueue = ns.state.syncQueue.filter(
              item => !(String(item.ticketId || "").toUpperCase().trim() === upperId && item.sessionId === sessionId)
            );
            localStorage.setItem("absen_sync_queue", JSON.stringify(ns.state.syncQueue));
            if (ns.Sync) ns.Sync.updateSyncUI();
          }

          let foundInHistory = false;
          ns.state.history.forEach(h => {
            if (String(h.ticketId || "").toUpperCase().trim() === upperId && h.sessionId === sessionId) {
              h.status = "CANCELLED";
              foundInHistory = true;
            }
          });

          // Konsolidasi entri ganda pada tiket & sesi yang sama agar tidak ada kartu redundant di riwayat
          const seenHistKey = new Set();
          ns.state.history = ns.state.history.filter(h => {
            const key = `${String(h.ticketId || "").toUpperCase().trim()}_${h.sessionId}`;
            if (key === `${upperId}_${sessionId}`) {
              if (seenHistKey.has(key)) return false;
              seenHistKey.add(key);
              h.status = "CANCELLED";
              return true;
            }
            return true;
          });

          if (!foundInHistory) {
            const attendeeName = (ns.state.cachedAttendees && ns.state.cachedAttendees[upperId] ? ns.state.cachedAttendees[upperId].name : "") || "Peserta";
            ns.state.history.unshift({
              ticketId: ticketId,
              sessionId: sessionId,
              sessionName: sessionName,
              name: attendeeName,
              status: "CANCELLED",
              time: new Date().toLocaleTimeString()
            });
            if (ns.state.history.length > 50) ns.state.history.pop();
          }

          localStorage.setItem("absen_history", JSON.stringify(ns.state.history));
          ns.UI.renderHistory();
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
      if (!this.requirePanitiaName()) return;

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

      // Kumpulkan nilai kolom dinamis customFields jika ada di sheet Data Peserta
      const customFields = {};
      if (ns.DOM.otsCustomFieldsContainer) {
        ns.DOM.otsCustomFieldsContainer.querySelectorAll(".ots-custom-field").forEach(input => {
          const fieldName = input.getAttribute("data-field-name");
          if (fieldName && input.value) {
            customFields[fieldName] = input.value.trim();
          }
        });
      }

      try {
        const result = await ns.API.registerOts(name, contact, notes, customFields);

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
          if (ns.DOM.otsCustomFieldsContainer) {
            ns.DOM.otsCustomFieldsContainer.querySelectorAll(".ots-custom-field").forEach(input => {
              input.value = "";
            });
          }

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
            officer: [ns.state.panitiaName, ns.state.gateName].filter(Boolean).join(" • ") || "-",
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

          // Update cache lokal dengan tiket OTS baru
          if (!ns.state.cachedAttendees) ns.state.cachedAttendees = {};
          ns.state.cachedAttendees[String(attendee.ticketId).toUpperCase().trim()] = {
            ticketId: attendee.ticketId,
            name: name,
            email: attendee.email || "OTS"
          };
          try {
            localStorage.setItem("absen_cached_attendees", JSON.stringify(ns.state.cachedAttendees));
          } catch (e) { }
          if (ns.Sync) ns.Sync.updateCacheCountUI();

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
        if (data && data.success) {
          if (data.sessions && data.sessions.length > 0) {
            ns.state.sessions = data.sessions;
            localStorage.setItem("absen_cached_sessions", JSON.stringify(data.sessions));
            ns.UI.renderSessionDropdown();
          }
          if (data.customFields) {
            ns.state.customFields = data.customFields;
            localStorage.setItem("absen_custom_fields", JSON.stringify(data.customFields));
            ns.UI.renderOtsCustomFields(data.customFields);
          }
          ns.state.isApiConnected = true;
          ns.state.apiErrorMessage = "";
          if (ns.Sync) ns.Sync.updateSyncUI();
          if (isManual) ns.UI.showToast("Daftar sesi & kolom peserta berhasil diperbarui.");
        }
      } catch (err) {
        console.warn("Gagal mengambil sesi:", err);
        const isConnErr = err.isConnectionError ||
          err.isFetchError ||
          (err.message && (err.message.toLowerCase().includes("failed to fetch") || err.message.includes("CORS") || err.message.includes("404")));
        ns.state.isApiConnected = false;
        ns.state.apiErrorMessage = isConnErr ? "Gagal terhubung (404/CORS)" : err.message;
        if (ns.Sync) ns.Sync.updateSyncUI();
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
          ns.state.isApiConnected = true;
          ns.state.apiErrorMessage = "";
          if (ns.Sync) ns.Sync.updateSyncUI();
          ns.UI.showToast("Koneksi Berhasil! API Online.");
        } else {
          ns.UI.showToast("Respons diterima namun format berbeda.");
        }
      } catch (e) {
        ns.state.isApiConnected = false;
        ns.state.apiErrorMessage = e.message;
        if (ns.Sync) ns.Sync.updateSyncUI();
        ns.UI.showToast(`Gagal: ${e.message}`);
      } finally {
        ns.DOM.btnTestConnection.textContent = "Test Koneksi";
      }
    },

    /**
     * Purge all local event caches (attendees, sessions, history, queue, custom fields)
     * when switching to a different event / different Apps Script URL to prevent
     * cross-event data contamination.
     */
    purgeAllEventData(newApiUrl = "", triggerSync = true) {
      console.log("[PURGE EVENT DATA] Purging previous event data and caches...");

      // 1. Wipe attendee cache
      ns.state.cachedAttendees = {};
      localStorage.removeItem("absen_cached_attendees");

      // 2. Wipe sessions cache
      ns.state.sessions = [];
      localStorage.removeItem("absen_cached_sessions");
      ns.state.currentSessionId = "SESI-01";
      ns.state.currentSessionName = "Memuat sesi...";
      localStorage.removeItem("absen_current_session_id");
      localStorage.removeItem("absen_current_session_name");

      // 3. Wipe history & offline queue
      ns.state.history = [];
      localStorage.removeItem("absen_history");

      ns.state.syncQueue = [];
      localStorage.removeItem("absen_sync_queue");

      // 4. Wipe custom fields & last sync time
      ns.state.customFields = [];
      localStorage.removeItem("absen_custom_fields");
      ns.state.lastSyncTime = null;
      localStorage.removeItem("absen_last_sync_time");

      ns.state.isApiConnected = null;
      ns.state.apiErrorMessage = "";

      // 5. Reset UI components
      if (ns.DOM.statTotal) ns.DOM.statTotal.textContent = "0";
      if (ns.DOM.searchQuery) ns.DOM.searchQuery.value = "";
      if (ns.DOM.searchResults) ns.DOM.searchResults.innerHTML = "";
      if (ns.DOM.searchEmptyState) ns.DOM.searchEmptyState.style.display = "block";
      if (ns.DOM.historyList) ns.DOM.historyList.innerHTML = "";
      if (ns.DOM.historyEmptyState) ns.DOM.historyEmptyState.style.display = "block";
      if (ns.DOM.syncQueueBadge) ns.DOM.syncQueueBadge.style.display = "none";
      if (ns.DOM.otsCustomFieldsContainer) ns.DOM.otsCustomFieldsContainer.innerHTML = "";

      ns.UI.renderSessionDropdown();
      ns.UI.renderHistory();
      if (ns.Sync) {
        ns.Sync.updateCacheCountUI();
        ns.Sync.updateSyncUI();
      }

      ns.UI.showToast("Data acara sebelumnya dibersihkan. Memuat data acara baru...");

      if (triggerSync && newApiUrl) {
        this.syncSessions(true);
        if (ns.Sync) {
          setTimeout(() => ns.Sync.syncAttendees(false), 400);
        }
      }
    },

    /**
     * Save settings to localStorage
     */
    handleSaveSettings() {
      const pName = ns.DOM.inputPanitiaName.value.trim();
      const gName = ns.DOM.inputGateName.value.trim();
      const aUrl = ns.DOM.inputApiUrl.value.trim();

      if (!pName) {
        ns.UI.showToast("⚠️ Nama petugas / panitia wajib diisi!");
        if (ns.DOM.inputPanitiaName) ns.DOM.inputPanitiaName.focus();
        return;
      }

      ns.state.panitiaName = pName;
      ns.state.gateName = gName;
      const urlChanged = (ns.state.apiUrl && ns.state.apiUrl !== aUrl);
      ns.state.apiUrl = aUrl;

      localStorage.setItem("absen_panitia_name", pName);
      localStorage.setItem("absen_gate_name", gName);
      localStorage.setItem("absen_api_url", aUrl);

      // Sinkronkan ke form modal Operator Identity
      if (ns.DOM.inputOpName) ns.DOM.inputOpName.value = pName;
      if (ns.DOM.inputOpGate) ns.DOM.inputOpGate.value = gName;

      // Auto-detect gate mode if gate contains "keluar" / "out"
      const lowerGate = gName.toLowerCase();
      if (lowerGate.includes("keluar") || lowerGate.includes("out")) {
        ns.state.currentScanMode = "OUT";
        localStorage.setItem("absen_scan_mode", "OUT");
      } else if (lowerGate.includes("masuk") || lowerGate.includes("in")) {
        ns.state.currentScanMode = "IN";
        localStorage.setItem("absen_scan_mode", "IN");
      }
      ns.UI.updateScanModeUI();

      ns.UI.renderOperatorHeader();
      ns.UI.closeSettingsModal();

      if (urlChanged) {
        this.purgeAllEventData(aUrl, true);
        return;
      }

      ns.UI.showToast("Pengaturan berhasil disimpan.");

      if (ns.Sync) {
        ns.Sync.updateSyncUI();
        if (aUrl) ns.Sync.syncAttendees(false);
      }
      if (aUrl) this.syncSessions(true);
    },

    /**
     * Guard: Memastikan nama petugas terisi sebelum memproses presensi
     */
    requirePanitiaName(pendingTicketId = null, sourceButton = null) {
      if (ns.state.panitiaName && ns.state.panitiaName.trim()) {
        return true;
      }

      if (pendingTicketId) {
        ns.state.pendingScan = { ticketId: pendingTicketId, sourceButton };
      }

      if (ns.sounds && typeof ns.sounds.playWarning === "function") {
        ns.sounds.playWarning();
      }
      if (navigator.vibrate) {
        navigator.vibrate([150, 80, 150]);
      }

      ns.UI.showToast("Mohon isi Nama Panitia terlebih dahulu!");
      ns.UI.openOperatorModal({ force: true });
      return false;
    },

    /**
     * Simpan nama & gate dari modal Operator Identity
     */
    handleSaveOperator() {
      const pName = (ns.DOM.inputOpName ? ns.DOM.inputOpName.value.trim() : "");
      const gName = (ns.DOM.inputOpGate ? ns.DOM.inputOpGate.value.trim() : "");

      if (!pName) {
        if (ns.DOM.opNameError) ns.DOM.opNameError.style.display = "block";
        if (ns.DOM.inputOpName) {
          ns.DOM.inputOpName.classList.add("error-highlight");
          ns.DOM.inputOpName.focus();
        }
        if (ns.sounds && typeof ns.sounds.playWarning === "function") {
          ns.sounds.playWarning();
        }
        ns.UI.showToast("⚠️ Nama petugas wajib diisi!");
        return;
      }

      ns.state.panitiaName = pName;
      ns.state.gateName = gName;
      localStorage.setItem("absen_panitia_name", pName);
      localStorage.setItem("absen_gate_name", gName);

      // Sinkronkan ke modal Settings
      if (ns.DOM.inputPanitiaName) ns.DOM.inputPanitiaName.value = pName;
      if (ns.DOM.inputGateName) ns.DOM.inputGateName.value = gName;

      // Auto-detect gate mode if gate contains "keluar" / "out"
      const lowerGate = gName.toLowerCase();
      if (lowerGate.includes("keluar") || lowerGate.includes("out")) {
        ns.state.currentScanMode = "OUT";
        localStorage.setItem("absen_scan_mode", "OUT");
      } else if (lowerGate.includes("masuk") || lowerGate.includes("in")) {
        ns.state.currentScanMode = "IN";
        localStorage.setItem("absen_scan_mode", "IN");
      }
      ns.UI.updateScanModeUI();

      ns.UI.renderOperatorHeader();
      ns.UI.closeOperatorModal();

      if (ns.sounds && typeof ns.sounds.playSuccess === "function") {
        ns.sounds.playSuccess();
      }
      ns.UI.showToast(`Letsgooo, ${pName}!`);

      // Lanjutkan eksekusi tiket yang tadi sempat tertunda jika ada
      if (ns.state.pendingScan) {
        const { ticketId, sourceButton } = ns.state.pendingScan;
        ns.state.pendingScan = null;
        setTimeout(() => {
          this.processCheckIn(ticketId, sourceButton);
        }, 300);
      }
    }
  };

  // Bootstrap when document is ready
  document.addEventListener("DOMContentLoaded", () => {
    ns.App.init();
  });

})(window.EventPass);
