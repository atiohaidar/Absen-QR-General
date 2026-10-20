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
      ns.UI.renderOperatorHeader();
      ns.UI.renderSessionDropdown();
      ns.UI.renderHistory();
      
      this.bindEventListeners();
      ns.Scanner.startScanning();

      // Sync active sessions from Google Sheets
      if (ns.state.apiUrl) {
        this.syncSessions(false);
      } else {
        setTimeout(() => {
          ns.UI.openSettingsModal();
          ns.UI.showToast("Silakan masukkan Apps Script API URL terlebih dahulu.");
        }, 600);
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

      // 4. Modal Buttons (Next Scan, Cancel Attendance)
      if (DOM.btnNextScan) {
        DOM.btnNextScan.addEventListener("click", () => ns.UI.closeResultModal());
      }
      if (DOM.btnCancelCheckin) {
        DOM.btnCancelCheckin.addEventListener("click", () => {
          if (!ns.state.lastScanned) return;
          clearTimeout(ns.state.autoResumeTimer);
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
      if (DOM.btnTestConnection) {
        DOM.btnTestConnection.addEventListener("click", () => this.handleTestConnection());
      }
      if (DOM.btnSaveSettings) {
        DOM.btnSaveSettings.addEventListener("click", () => this.handleSaveSettings());
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
        ns.UI.showResultModal({
          type: "error",
          title: "Koneksi Gagal",
          subtitle: err.message || "Gagal terhubung ke Google Apps Script.",
          name: "-",
          ticketId: ticketId,
          email: "-",
          time: new Date().toLocaleTimeString(),
          officer: ns.state.panitiaName,
          allowCancel: false
        });
        ns.UI.recordHistory({
          ticketId: ticketId,
          sessionId: ns.state.currentSessionId,
          sessionName: ns.state.currentSessionName,
          name: "Koneksi Gagal",
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
        ns.UI.showToast(`Gagal membatalkan: ${err.message}`);
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
        ns.DOM.searchResultsList.innerHTML = `<div style="text-align: center; color: var(--status-error); padding: 20px;">Gagal mengambil data pencarian: ${err.message}</div>`;
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
        ns.UI.showToast(`Gagal mendaftarkan: ${err.message}`);
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
        if (isManual) ns.UI.showToast(`Gagal terhubung: ${err.message}`);
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
