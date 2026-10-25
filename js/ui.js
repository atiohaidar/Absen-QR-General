/**
 * ==============================================================================
 * EventPass • UI & Presentation Layer Module (js/ui.js)
 * ==============================================================================
 */

window.EventPass = window.EventPass || {};

(function (ns) {
  'use strict';

  ns.UI = {
    showToast(message, duration = 3000) {
      if (!ns.DOM.toast) return;
      ns.DOM.toastMsg.textContent = message;
      ns.DOM.toast.classList.add("show");
      setTimeout(() => {
        ns.DOM.toast.classList.remove("show");
      }, duration);
    },

    updateScannerStatus(title, sub) {
      if (ns.DOM.statusLabel) ns.DOM.statusLabel.textContent = title;
      if (ns.DOM.statusSub) ns.DOM.statusSub.textContent = sub;
    },

    renderOperatorHeader() {
      if (ns.DOM.operatorBadge) {
        if (!ns.state.panitiaName) {
          ns.DOM.operatorBadge.textContent = "⚠️ Isi Nama Petugas";
          if (ns.DOM.operatorBadgeBtn) {
            ns.DOM.operatorBadgeBtn.classList.add("needs-setup");
          }
        } else {
          if (ns.DOM.operatorBadgeBtn) {
            ns.DOM.operatorBadgeBtn.classList.remove("needs-setup");
          }
          if (ns.state.gateName) {
            ns.DOM.operatorBadge.textContent = `${ns.state.panitiaName} • ${ns.state.gateName}`;
          } else {
            ns.DOM.operatorBadge.textContent = ns.state.panitiaName;
          }
        }
      }
      if (ns.DOM.statTotal) {
        ns.DOM.statTotal.textContent = ns.state.stats.total;
      }
    },

    renderSessionDropdown() {
      if (!ns.DOM.sessionDropdownContainer || !ns.DOM.sessionMenu) return;

      const list = ns.state.sessions.length > 0 ? ns.state.sessions : [
        { id: "SESI-01", name: "Pertemuan 1 - Pembukaan", label: "Pertemuan 1 - Pembukaan", type: "SINGLE" },
        { id: "SESI-02", name: "Pertemuan 2 - Workshop", label: "Pertemuan 2 - Workshop", type: "CHECK_IN_OUT" }
      ];

      // Sinkronkan sesi yang aktif atau fallback ke sesi pertama
      let current = list.find(s => s.id === ns.state.currentSessionId);
      if (!current) {
        current = list[0];
        ns.state.currentSessionId = current.id;
        ns.state.currentSessionName = current.name;
        localStorage.setItem("absen_current_session_id", current.id);
        localStorage.setItem("absen_current_session_name", current.name);
      } else {
        ns.state.currentSessionName = current.name;
      }

      if (ns.DOM.sessionLabel) {
        ns.DOM.sessionLabel.textContent = current.label || current.name;
      }

      ns.DOM.sessionMenu.innerHTML = "";

      list.forEach(sesi => {
        const itemBtn = document.createElement("button");
        itemBtn.type = "button";
        const isActive = sesi.id === ns.state.currentSessionId;
        itemBtn.className = `dropdown-item ${isActive ? "active" : ""}`;
        itemBtn.setAttribute("role", "option");
        itemBtn.setAttribute("aria-selected", isActive ? "true" : "false");

        const typeBadge = sesi.type === "CHECK_IN_OUT" ? `<span style="font-size: 10px; background: #e0e7ff; color: #4338ca; padding: 1px 6px; border-radius: 4px; font-weight: 700; margin-left: 6px;">IN/OUT</span>` : "";

        itemBtn.innerHTML = `
          <div class="dropdown-item-info">
            <span class="dropdown-item-title">${ns.escapeHtml(sesi.name)}${typeBadge}</span>
            <span class="dropdown-item-date">${ns.escapeHtml(sesi.date || sesi.id)}</span>
          </div>
          <svg class="dropdown-item-check" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
        `;

        itemBtn.addEventListener("click", () => {
          ns.state.currentSessionId = sesi.id;
          ns.state.currentSessionName = sesi.name;

          localStorage.setItem("absen_current_session_id", sesi.id);
          localStorage.setItem("absen_current_session_name", sesi.name);

          ns.UI.renderSessionDropdown();
          ns.UI.closeSessionDropdown();

          ns.UI.showToast(`Sesi aktif: ${sesi.name}`);
        });

        ns.DOM.sessionMenu.appendChild(itemBtn);
      });

      this.updateScanModeUI();
    },

    /**
     * Update Scan Mode UI (Check-In vs Check-Out) toggle visibility and active state
     */
    updateScanModeUI() {
      const current = (ns.state.sessions || []).find(s => s.id === ns.state.currentSessionId);
      const isInOut = (current && current.type === "CHECK_IN_OUT");

      if (ns.DOM.scanModeContainer) {
        ns.DOM.scanModeContainer.style.display = isInOut ? "block" : "none";
      }

      const mode = ns.state.currentScanMode || "IN";
      if (ns.DOM.btnModeIn) {
        const isActive = (mode === "IN");
        ns.DOM.btnModeIn.classList.toggle("active", isActive);
        ns.DOM.btnModeIn.setAttribute("aria-checked", isActive ? "true" : "false");
      }
      if (ns.DOM.btnModeOut) {
        const isActive = (mode === "OUT");
        ns.DOM.btnModeOut.classList.toggle("active", isActive);
        ns.DOM.btnModeOut.setAttribute("aria-checked", isActive ? "true" : "false");
      }

      // Update Manual Tab labels & button
      if (ns.DOM.btnManualCheckin) {
        if (isInOut && mode === "OUT") {
          ns.DOM.btnManualCheckin.textContent = "Check Out";
          ns.DOM.btnManualCheckin.style.background = "#d97706";
          ns.DOM.btnManualCheckin.style.borderColor = "#b45309";
        } else {
          ns.DOM.btnManualCheckin.textContent = "Check In";
          ns.DOM.btnManualCheckin.style.background = "";
          ns.DOM.btnManualCheckin.style.borderColor = "";
        }
      }
      if (ns.DOM.manualSectionTitle) {
        ns.DOM.manualSectionTitle.textContent = (isInOut && mode === "OUT") ? "Manual Check-Out" : "Manual Check-In";
      }

      // Update status message if not currently processing
      if (!ns.state.isProcessing) {
        if (isInOut && mode === "OUT") {
          this.updateScannerStatus("Siap Memindai (Check-Out)", `Sesi: ${current?.name || ""} • Verifikasi Keluar`);
        } else if (isInOut && mode === "IN") {
          this.updateScannerStatus("Siap Memindai (Check-In)", `Sesi: ${current?.name || ""} • Verifikasi Masuk`);
        } else {
          this.updateScannerStatus("Siap Memindai", `Sesi: ${current?.name || ns.state.currentSessionName}`);
        }
      }
    },

    toggleSessionDropdown() {
      if (!ns.DOM.sessionDropdownContainer) return;
      const isOpen = ns.DOM.sessionDropdownContainer.classList.toggle("open");
      if (ns.DOM.sessionTrigger) {
        ns.DOM.sessionTrigger.setAttribute("aria-expanded", isOpen ? "true" : "false");
      }
    },

    closeSessionDropdown() {
      if (ns.DOM.sessionDropdownContainer) {
        ns.DOM.sessionDropdownContainer.classList.remove("open");
        if (ns.DOM.sessionTrigger) {
          ns.DOM.sessionTrigger.setAttribute("aria-expanded", "false");
        }
      }
    },

    showResultModal(data) {
      ns.DOM.resultBanner.className = `result-banner ${data.type}`;

      if (data.type === "success") {
        ns.DOM.resultIcon.innerHTML = `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
      } else if (data.type === "warning") {
        ns.DOM.resultIcon.innerHTML = `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`;
      } else {
        ns.DOM.resultIcon.innerHTML = `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
      }

      ns.DOM.resultTitle.textContent = data.title;
      ns.DOM.resultSubtitle.textContent = data.subtitle;
      ns.DOM.detailName.textContent = data.name;
      ns.DOM.detailTicketId.textContent = data.ticketId;
      ns.DOM.detailEmail.textContent = data.email;
      if (ns.DOM.detailTimeLabel) {
        ns.DOM.detailTimeLabel.textContent = data.timeLabel || (data.scanMode === "OUT" ? "Waktu Keluar" : "Waktu Masuk");
      }
      ns.DOM.detailTime.textContent = data.time;
      ns.DOM.detailOfficer.textContent = data.officer;

      if (ns.DOM.btnCancelCheckin) {
        ns.DOM.btnCancelCheckin.style.display = data.allowCancel ? "flex" : "none";
      }

      if (ns.DOM.btnRecheckServer) {
        ns.DOM.btnRecheckServer.style.display = (data.type === "warning" || data.allowRecheck) ? "flex" : "none";
        ns.DOM.btnRecheckServer.disabled = false;
        ns.DOM.btnRecheckServer.innerHTML = `
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/>
          </svg>
          <span>Cek Status Terbaru ke Spreadsheet</span>
        `;
      }

      // Handle Apps Script / Connection Error UI
      if (data.isConfigError) {
        if (ns.DOM.resultConfigGuide) ns.DOM.resultConfigGuide.style.display = "block";
      } else {
        if (ns.DOM.resultConfigGuide) ns.DOM.resultConfigGuide.style.display = "none";
      }

      ns.DOM.resultModal.classList.add("show");
    },

    closeResultModal() {
      if (ns.DOM.resultConfigGuide) ns.DOM.resultConfigGuide.style.display = "none";
      ns.DOM.resultModal.classList.remove("show");
      ns.state.isProcessing = false;
      ns.Scanner.resetReticle();
    },

    openOperatorModal(options = {}) {
      if (!ns.DOM.operatorModal) return;

      const isForced = Boolean(options.force) || (!ns.state.panitiaName || !ns.state.panitiaName.trim());

      if (ns.DOM.inputOpName) {
        ns.DOM.inputOpName.value = ns.state.panitiaName || "";
        ns.DOM.inputOpName.classList.remove("error-highlight");
      }
      if (ns.DOM.inputOpGate) {
        ns.DOM.inputOpGate.value = ns.state.gateName || "";
      }
      if (ns.DOM.opNameError) {
        ns.DOM.opNameError.style.display = "none";
      }

      // If forced, do not show close button to prevent bypassing
      if (ns.DOM.btnCloseOperator) {
        ns.DOM.btnCloseOperator.style.display = isForced ? "none" : "flex";
      }

      ns.DOM.operatorModal.setAttribute("data-forced", isForced ? "true" : "false");
      ns.DOM.operatorModal.classList.add("show");

      setTimeout(() => {
        if (ns.DOM.inputOpName) {
          ns.DOM.inputOpName.focus();
          if (ns.DOM.inputOpName.value) ns.DOM.inputOpName.select();
        }
      }, 150);
    },

    closeOperatorModal() {
      if (!ns.DOM.operatorModal) return;
      ns.DOM.operatorModal.classList.remove("show");
      if (ns.DOM.inputOpName) ns.DOM.inputOpName.classList.remove("error-highlight");
      if (ns.DOM.opNameError) ns.DOM.opNameError.style.display = "none";
    },

    openSettingsModal() {
      ns.DOM.inputPanitiaName.value = ns.state.panitiaName || "";
      ns.DOM.inputGateName.value = ns.state.gateName || "";
      ns.DOM.inputApiUrl.value = ns.state.apiUrl || "";

      if (ns.DOM.cfgInstantMode) {
        ns.DOM.cfgInstantMode.checked = ns.state.instantMode;
      }
      if (ns.Sync) {
        ns.Sync.updateCacheCountUI();
      }

      if (ns.DOM.previewDevice) {
        ns.DOM.previewDevice.textContent = ns.state.deviceInfo || "Browser";
      }
      if (ns.DOM.previewLocation) {
        if (ns.state.location && ns.state.location.mapsUrl) {
          ns.DOM.previewLocation.textContent = `Aktif (±${ns.state.location.accuracy || 0}m)`;
          ns.DOM.previewLocation.style.color = "var(--status-success)";
        } else {
          ns.DOM.previewLocation.textContent = "Non-GPS / Belum Diizinkan";
          ns.DOM.previewLocation.style.color = "var(--text-muted)";
        }
      }

      ns.DOM.settingsModal.classList.add("show");
    },

    closeSettingsModal() {
      ns.DOM.settingsModal.classList.remove("show");
    },

    openLocationModal(type = "prompt") {
      if (!ns.DOM.locationModal) return;

      if (type === "denied") {
        if (ns.DOM.locBadgePill) {
          ns.DOM.locBadgePill.textContent = "Akses Lokasi Diblokir";
          ns.DOM.locBadgePill.style.background = "var(--status-error-bg)";
          ns.DOM.locBadgePill.style.color = "var(--status-error)";
          ns.DOM.locBadgePill.style.borderColor = "var(--status-error-border)";
        }
        if (ns.DOM.locStatusText) {
          ns.DOM.locStatusText.textContent = "Izin lokasi diblokir di browser. Aktifkan di ikon gembok bilah alamat, atau lanjutkan tanpa lokasi.";
        }
        if (ns.DOM.locStatusDot) {
          ns.DOM.locStatusDot.style.background = "var(--status-error)";
        }
        if (ns.DOM.btnAllowLocationText) {
          ns.DOM.btnAllowLocationText.textContent = "Coba Minta Izin Lagi";
        }
      } else {
        if (ns.DOM.locBadgePill) {
          ns.DOM.locBadgePill.textContent = "Izin Lokasi Belum Aktif";
          ns.DOM.locBadgePill.style.background = "var(--status-warning-bg)";
          ns.DOM.locBadgePill.style.color = "var(--status-warning)";
          ns.DOM.locBadgePill.style.borderColor = "var(--status-warning-border)";
        }
        if (ns.DOM.locStatusText) {
          ns.DOM.locStatusText.textContent = "Status: Belum diizinkan di browser ini";
        }
        if (ns.DOM.locStatusDot) {
          ns.DOM.locStatusDot.style.background = "var(--status-warning)";
        }
        if (ns.DOM.btnAllowLocationText) {
          ns.DOM.btnAllowLocationText.textContent = "Izinkan Akses Lokasi";
        }
      }

      ns.DOM.locationModal.classList.add("show");
    },

    closeLocationModal() {
      if (ns.DOM.locationModal) {
        ns.DOM.locationModal.classList.remove("show");
      }
    },

    openCancelModal(target) {
      ns.state.pendingCancel = target;
      if (ns.DOM.cancelModalAttendeeName) {
        ns.DOM.cancelModalAttendeeName.textContent = target.attendeeName || "Peserta";
      }
      if (ns.DOM.cancelModalDetails) {
        ns.DOM.cancelModalDetails.textContent = `${target.ticketId} • ${target.sessionName || "Sesi"}`;
      }
      if (ns.DOM.cancelReasonInput) {
        ns.DOM.cancelReasonInput.value = "";
      }
      if (ns.DOM.cancelModal) {
        ns.DOM.cancelModal.classList.add("show");
        setTimeout(() => {
          if (ns.DOM.cancelReasonInput) ns.DOM.cancelReasonInput.focus();
        }, 150);
      }
    },

    closeCancelModal() {
      ns.state.pendingCancel = null;
      if (ns.DOM.cancelModal) {
        ns.DOM.cancelModal.classList.remove("show");
      }
    },

    openAnomalyModal(options = {}) {
      if (!ns.DOM.anomalyModal) return;
      if (ns.DOM.anomalyAttendeeName) ns.DOM.anomalyAttendeeName.textContent = options.name || "Peserta";
      if (ns.DOM.anomalyTicketId) ns.DOM.anomalyTicketId.textContent = options.ticketId || "-";
      if (ns.DOM.anomalyReasonSelect) ns.DOM.anomalyReasonSelect.selectedIndex = 0;

      this._anomalyCallbacks = {
        onConfirm: options.onConfirm,
        onCancel: options.onCancel
      };

      ns.DOM.anomalyModal.classList.add("show");
      ns.DOM.anomalyModal.style.display = "flex";
    },

    closeAnomalyModal(triggerCancel = false) {
      if (!ns.DOM.anomalyModal) return;
      ns.DOM.anomalyModal.classList.remove("show");
      ns.DOM.anomalyModal.style.display = "none";
      if (triggerCancel && this._anomalyCallbacks && typeof this._anomalyCallbacks.onCancel === "function") {
        this._anomalyCallbacks.onCancel();
      }
      this._anomalyCallbacks = null;
    },

    recordHistory(entry) {
      ns.state.history.unshift(entry);
      if (ns.state.history.length > 50) ns.state.history.pop();
      localStorage.setItem("absen_history", JSON.stringify(ns.state.history));
      ns.UI.renderHistory();
    },

    renderHistory() {
      // 1. Update Top Sync Queue Banner in Riwayat Tab
      const queueLen = (ns.state.syncQueue && Array.isArray(ns.state.syncQueue)) ? ns.state.syncQueue.length : 0;
      if (ns.DOM.historySyncBanner) {
        if (queueLen > 0) {
          ns.DOM.historySyncBanner.style.display = "flex";
          if (ns.DOM.historySyncTitle) {
            ns.DOM.historySyncTitle.textContent = `${queueLen} Tiket Menunggu Sinkronisasi ke Spreadsheet`;
          }
          if (ns.DOM.historySyncDesc) {
            ns.DOM.historySyncDesc.textContent = `Tersimpan aman di HP panitia. Klik "Sync Sekarang" untuk mengirim langsung.`;
          }
        } else {
          ns.DOM.historySyncBanner.style.display = "none";
        }
      }

      if (!ns.DOM.historyList) return;

      // 1. Sanitize & normalize riwayat (auto-heal status usang & buang kartu duplikat berlebih)
      let historyNeedsSave = false;
      const cancelledKeys = new Set();
      (ns.state.history || []).forEach(h => {
        if (h && h.status === "CANCELLED" && h.ticketId && h.sessionId) {
          cancelledKeys.add(`${String(h.ticketId).toUpperCase().trim()}_${h.sessionId}`);
        }
      });

      (ns.state.history || []).forEach(h => {
        if (!h || !h.ticketId || !h.sessionId) return;
        const uId = String(h.ticketId).toUpperCase().trim();
        const key = `${uId}_${h.sessionId}`;
        const cached = ns.state.cachedAttendees ? ns.state.cachedAttendees[uId] : null;
        const isPending = ns.state.syncQueue && ns.state.syncQueue.some(
          q => String(q.ticketId || "").toUpperCase().trim() === uId && q.sessionId === h.sessionId
        );
        const isCheckedInCache = cached && cached.checkedInSessions && cached.checkedInSessions[h.sessionId];

        if (h.status === "SUCCESS") {
          // Jika tiket terdeteksi pernah dibatalkan, atau data di cache sudah dicabut dan tidak ada di antrean
          if (cancelledKeys.has(key) || (cached && !isCheckedInCache && !isPending)) {
            h.status = "CANCELLED";
            cancelledKeys.add(key);
            historyNeedsSave = true;
          }
        }
      });

      // Konsolidasi: hilangkan kartu ganda untuk tiket & sesi yang sama jika statusnya CANCELLED
      const seenCancelled = new Set();
      const sanitizedHistory = [];
      for (const h of (ns.state.history || [])) {
        if (h && h.ticketId && h.sessionId) {
          const key = `${String(h.ticketId).toUpperCase().trim()}_${h.sessionId}`;
          if (cancelledKeys.has(key)) {
            if (seenCancelled.has(key)) {
              historyNeedsSave = true;
              continue; // Buang duplikat redundant
            }
            seenCancelled.add(key);
            h.status = "CANCELLED";
          }
        }
        sanitizedHistory.push(h);
      }

      if (historyNeedsSave) {
        ns.state.history = sanitizedHistory;
        localStorage.setItem("absen_history", JSON.stringify(ns.state.history));
      }

      if (ns.state.history.length === 0) {
        ns.DOM.historyList.innerHTML = `<div style="text-align: center; color: var(--text-dim); padding: 24px;">Belum ada riwayat pemindaian pada sesi ini.</div>`;
        return;
      }

      ns.DOM.historyList.innerHTML = "";
      ns.state.history.forEach((item, idx) => {
        const div = document.createElement("div");
        div.className = "history-item";

        // Cek apakah tiket ini masih ada di antrean sync lokal HP
        const uId = String(item.ticketId || "").toUpperCase().trim();
        const isPendingInQueue = ns.state.syncQueue && ns.state.syncQueue.some(
          q => String(q.ticketId || "").toUpperCase().trim() === uId && q.sessionId === item.sessionId
        );
        const cached = ns.state.cachedAttendees ? ns.state.cachedAttendees[uId] : null;
        const isCheckedInNow = (cached && cached.checkedInSessions && cached.checkedInSessions[item.sessionId]) || isPendingInQueue;

        let badgeClass = "badge-success";
        let badgeLabel = "Hadir";
        let showUndo = false;
        let syncTagHtml = "";
        let syncSubtextHtml = "";

        if (item.status === "SUCCESS") {
          badgeClass = "badge-success";
          badgeLabel = "Hadir";
          // Tombol Batalkan hanya muncul jika tiket ini benar-benar masih terdaftar hadir
          showUndo = Boolean(isCheckedInNow);

          if (isPendingInQueue) {
            syncTagHtml = `
              <span class="badge badge-pending-sync" title="Data tersimpan di memori HP, belum terkirim ke Google Sheets">
                ⏳ Antrean HP
              </span>
            `;
            syncSubtextHtml = `
              <div style="font-size: 11px; color: #b45309; margin-top: 3px; display: flex; align-items: center; gap: 4px;">
                <span class="sync-mini-dot"></span>
                <span><strong>Belum Masuk Sheet</strong> • Menunggu sinkronisasi</span>
              </div>
            `;
          } else {
            syncTagHtml = `
              <span class="badge badge-synced" title="Telah tercatat permanen di Google Sheets">
                ☁️ Tersinkron
              </span>
            `;
            syncSubtextHtml = `
              <div style="font-size: 11px; color: #059669; margin-top: 3px; display: flex; align-items: center; gap: 4px;">
                <span>✅ <strong>Masuk Spreadsheet</strong> (Aman)</span>
              </div>
            `;
          }
        } else if (item.status === "CANCELLED") {
          badgeClass = "badge-cancelled";
          badgeLabel = "Dibatalkan";
          showUndo = false;
          syncTagHtml = `
            <span class="badge badge-synced" title="Pembatalan telah tersinkron dan tercatat di spreadsheet">
              ☁️ Tersinkron
            </span>
          `;
          syncSubtextHtml = `
            <div style="font-size: 11px; color: #64748b; margin-top: 3px; display: flex; align-items: center; gap: 4px;">
              <span>↩️ <strong>Dibatalkan</strong> • Status presensi dinonaktifkan</span>
            </div>
          `;
        } else if (item.status === "DUPLICATE") {
          badgeClass = "badge-warning";
          badgeLabel = "Duplikat";
          showUndo = false;
          if (isPendingInQueue) {
            syncTagHtml = `
              <span class="badge badge-pending-sync" title="Log duplikat dalam antrean sync">
                ⏳ Antrean HP
              </span>
            `;
            syncSubtextHtml = `
              <div style="font-size: 11px; color: #b45309; margin-top: 3px; display: flex; align-items: center; gap: 4px;">
                <span class="sync-mini-dot"></span>
                <span>⚠️ <strong>Duplikat</strong> • Menunggu sync log audit</span>
              </div>
            `;
          } else {
            syncTagHtml = `
              <span class="badge badge-synced" title="Tercatat di Google Sheets sebagai duplikat">
                ☁️ Tersinkron
              </span>
            `;
            syncSubtextHtml = `
              <div style="font-size: 11px; color: #d97706; margin-top: 3px; display: flex; align-items: center; gap: 4px;">
                <span>⚠️ <strong>Sudah Pernah Absen</strong> • Tercatat di Log Sheet</span>
              </div>
            `;
          }
        } else if (item.status === "REJECTED_BY_SERVER") {
          badgeClass = "badge-error";
          badgeLabel = "Ditolak";
          showUndo = false;
          syncTagHtml = `
            <span class="badge badge-rejected" title="Tiket tidak ditemukan / dihapus admin di database">
              ⚠️ Ditolak Sheet
            </span>
          `;
          syncSubtextHtml = `
            <div style="font-size: 11px; color: #dc2626; margin-top: 3px; display: flex; align-items: center; gap: 4px;">
              <span>⚠️ <strong>Ditolak Database</strong>: Data tiket dihapus admin di spreadsheet</span>
            </div>
          `;
        } else {
          badgeClass = "badge-error";
          badgeLabel = item.status === "INVALID" ? "Tidak Valid" : "Gagal";
          showUndo = false;
          syncTagHtml = `
            <span class="badge badge-rejected">
              ❌ Gagal
            </span>
          `;
          syncSubtextHtml = `
            <div style="font-size: 11px; color: #dc2626; margin-top: 3px; display: flex; align-items: center; gap: 4px;">
              <span>❌ <strong>${item.status === "INVALID" ? "Tiket Tidak Terdaftar" : "Gagal Diproses"}</strong>: ${ns.escapeHtml(item.name || "Error")}</span>
            </div>
          `;
        }

        div.innerHTML = `
          <div style="flex: 1;">
            <div style="font-weight: 600; color: var(--text-main); font-size: 14px;">${ns.escapeHtml(item.name)}</div>
            <div style="font-size: 12px; color: var(--text-muted); margin-top: 2px;">
              <strong style="font-family: monospace; letter-spacing: 0.3px;">${ns.escapeHtml(item.ticketId)}</strong> • ${ns.escapeHtml(item.sessionName || "Sesi")} • ${ns.escapeHtml(item.time)}
            </div>
            ${syncSubtextHtml}
          </div>
          <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 6px;">
            <div style="display: flex; align-items: center; gap: 6px;">
              ${syncTagHtml}
              <span class="badge ${badgeClass}">${badgeLabel}</span>
            </div>
            ${showUndo ? `<button class="btn-undo-sm" data-idx="${idx}" data-id="${ns.escapeHtml(item.ticketId)}" data-session="${ns.escapeHtml(item.sessionId)}" data-name="${ns.escapeHtml(item.name)}">Batalkan</button>` : ""}
          </div>
        `;
        ns.DOM.historyList.appendChild(div);
      });

      // Attach undo handlers that open the cancel confirmation modal with optional reason
      ns.DOM.historyList.querySelectorAll(".btn-undo-sm").forEach(btn => {
        btn.addEventListener("click", (e) => {
          const tId = e.currentTarget.getAttribute("data-id");
          const sId = e.currentTarget.getAttribute("data-session");
          const name = e.currentTarget.getAttribute("data-name");

          ns.UI.openCancelModal({
            ticketId: tId,
            sessionId: sId,
            sessionName: ns.state.currentSessionName,
            attendeeName: name
          });
        });
      });
    },

    /**
     * Smoothly animate and remove a checked-in attendee card from search results
     */
    removeSearchResultItem(ticketId) {
      if (!ns.DOM.searchResultsList) return;
      const cleanId = String(ticketId || "").trim();
      const upperId = cleanId.toUpperCase();
      const itemEl = ns.DOM.searchResultsList.querySelector(`[data-ticket="${cleanId}"]`) || 
                     ns.DOM.searchResultsList.querySelector(`[data-ticket="${upperId}"]`) ||
                     document.getElementById(`search-item-${cleanId}`) ||
                     document.getElementById(`search-item-${upperId}`);
      if (itemEl) {
        itemEl.classList.add("item-completed");
        setTimeout(() => {
          if (itemEl.parentNode) itemEl.remove();
          const remainingItems = ns.DOM.searchResultsList.querySelectorAll(".search-result-item");
          if (remainingItems.length === 0) {
            ns.DOM.searchResultsList.innerHTML = `
              <div class="search-empty-state" style="text-align: center; color: var(--primary); padding: 16px; background: rgba(30, 86, 49, 0.06); border-radius: var(--radius-md); font-size: 13px; font-weight: 500; border: 1px dashed rgba(30, 86, 49, 0.25);">
                ✓ Presensi berhasil dicatat. Layar siap untuk pencarian berikutnya.
              </div>
            `;
            if (ns.DOM.inputManualSearch) {
              ns.DOM.inputManualSearch.value = "";
              ns.DOM.inputManualSearch.focus();
            }
          }
        }, 350);
      }
    },

    renderSearchResults(results, query) {
      if (!ns.DOM.searchResultsList) return;

      if (results && results.length > 0) {
        ns.DOM.searchResultsList.innerHTML = "";

        const current = (ns.state.sessions || []).find(s => s.id === ns.state.currentSessionId);
        const isInOut = (current && current.type === "CHECK_IN_OUT");
        const mode = isInOut ? (ns.state.currentScanMode || "IN") : "IN";
        const isOut = (mode === "OUT");
        const currentSessId = ns.state.currentSessionId || "SESI-01";
        const inSessId = `${currentSessId}_IN`;
        const outSessId = `${currentSessId}_OUT`;

        results.forEach(item => {
          const div = document.createElement("div");
          div.className = "search-result-item";
          const uId = String(item.ticketId || "").toUpperCase().trim();
          div.id = `search-item-${uId}`;
          div.setAttribute("data-ticket", uId);

          const cached = ns.state.cachedAttendees ? ns.state.cachedAttendees[uId] : null;

          // Cek apakah sudah pernah check-in atau check-out
          const hasIn = Boolean(
            (item.status === "HADIR") ||
            (cached && cached.checkedInSessions && (cached.checkedInSessions[inSessId] || cached.checkedInSessions[currentSessId])) ||
            (ns.state.syncQueue && ns.state.syncQueue.some(q => String(q.ticketId).toUpperCase() === uId && (q.sessionId === inSessId || q.sessionId === currentSessId) && !q.isDuplicate))
          );

          const hasOut = Boolean(
            (item.status === "CHECKOUT") ||
            (cached && cached.checkedInSessions && cached.checkedInSessions[outSessId]) ||
            (ns.state.syncQueue && ns.state.syncQueue.some(q => String(q.ticketId).toUpperCase() === uId && q.sessionId === outSessId && !q.isDuplicate))
          );

          let statusBadge = "";
          let actionBtnHtml = "";

          if (isOut) {
            // Mode Check-Out
            if (hasOut) {
              statusBadge = `<span class="badge badge-warning">Sudah Check-Out</span>`;
              actionBtnHtml = `<button class="btn-checkin-sm btn-disabled" disabled>Sudah Keluar</button>`;
            } else if (hasIn) {
              statusBadge = `<span class="badge badge-success">Sudah Check-In</span>`;
              actionBtnHtml = `<button class="btn-checkin-sm btn-checkout-action" data-id="${ns.escapeHtml(item.ticketId)}">Check Out</button>`;
            } else {
              statusBadge = `<span class="badge badge-error">Belum Hadir</span>`;
              actionBtnHtml = `<button class="btn-checkin-sm btn-checkout-action" data-id="${ns.escapeHtml(item.ticketId)}" title="Konfirmasi Checkout tanpa Check-In">Check Out</button>`;
            }
          } else {
            // Mode Check-In / Single
            if (hasIn) {
              statusBadge = `<span class="badge badge-warning">Sudah Hadir</span>`;
              actionBtnHtml = `<button class="btn-checkin-sm btn-disabled" disabled>Sudah Hadir</button>`;
            } else {
              statusBadge = `<span class="badge badge-success">Belum Hadir</span>`;
              actionBtnHtml = `<button class="btn-checkin-sm" data-id="${ns.escapeHtml(item.ticketId)}">Check In</button>`;
            }
          }

          div.innerHTML = `
            <div>
              <div class="attendee-name">${ns.escapeHtml(item.name)} ${statusBadge}</div>
              <div class="attendee-sub">${ns.escapeHtml(item.ticketId)} • ${ns.escapeHtml(item.email)}</div>
            </div>
            <div>
              ${actionBtnHtml}
            </div>
          `;
          ns.DOM.searchResultsList.appendChild(div);
        });

        ns.DOM.searchResultsList.querySelectorAll(".btn-checkin-sm:not(.btn-disabled)").forEach(btn => {
          btn.addEventListener("click", (e) => {
            const tId = e.currentTarget.getAttribute("data-id");
            ns.App.processCheckIn(tId, e.currentTarget);
          });
        });
      } else {
        ns.DOM.searchResultsList.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 20px;">Tidak ada peserta yang cocok dengan "${ns.escapeHtml(query)}"</div>`;
      }
    },

    /**
     * Render dynamic form fields in OTS tab based on custom columns in Data Peserta sheet
     */
    renderOtsCustomFields(fields) {
      if (!ns.DOM.otsCustomFieldsContainer) return;
      ns.DOM.otsCustomFieldsContainer.innerHTML = "";
      if (!fields || !Array.isArray(fields) || fields.length === 0) return;

      fields.forEach(field => {
        const group = document.createElement("div");
        group.className = "form-group";
        const fieldId = `ots-custom-${field.name.replace(/[^a-zA-Z0-9_-]/g, "_")}`;

        if (field.type === "select" && field.options && field.options.length > 0) {
          let optionsHtml = `<option value="">-- Pilih ${ns.escapeHtml(field.label)} --</option>`;
          field.options.forEach(opt => {
            optionsHtml += `<option value="${ns.escapeHtml(opt)}">${ns.escapeHtml(opt)}</option>`;
          });
          group.innerHTML = `
            <label class="form-label" for="${fieldId}">${ns.escapeHtml(field.label)} (Opsional)</label>
            <select id="${fieldId}" class="input-box ots-custom-field" data-field-name="${ns.escapeHtml(field.name)}" style="cursor: pointer; background: #ffffff;">
              ${optionsHtml}
            </select>
          `;
        } else {
          group.innerHTML = `
            <label class="form-label" for="${fieldId}">${ns.escapeHtml(field.label)} (Opsional)</label>
            <input type="text" id="${fieldId}" class="input-box ots-custom-field" data-field-name="${ns.escapeHtml(field.name)}" placeholder="Masukkan ${ns.escapeHtml(field.label)}..." autocomplete="off">
          `;
        }
        ns.DOM.otsCustomFieldsContainer.appendChild(group);
      });
    }
  };

})(window.EventPass);
