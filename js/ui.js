/**
 * ==============================================================================
 * EventPass • UI & Presentation Layer Module (js/ui.js)
 * ==============================================================================
 */

window.EventPass = window.EventPass || {};

(function(ns) {
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
        if (!ns.state.panitiaName && !ns.state.gateName) {
          ns.DOM.operatorBadge.textContent = "Atur Petugas & Gate";
        } else if (ns.state.panitiaName && ns.state.gateName) {
          ns.DOM.operatorBadge.textContent = `${ns.state.panitiaName} • ${ns.state.gateName}`;
        } else {
          ns.DOM.operatorBadge.textContent = ns.state.panitiaName || ns.state.gateName;
        }
      }
      if (ns.DOM.statTotal) {
        ns.DOM.statTotal.textContent = ns.state.stats.total;
      }
    },

    renderSessionDropdown() {
      if (!ns.DOM.sessionDropdownContainer || !ns.DOM.sessionMenu) return;

      const list = ns.state.sessions.length > 0 ? ns.state.sessions : [
        { id: "SESI-01", name: "Pertemuan 1 - Pembukaan", label: "Pertemuan 1 - Pembukaan" },
        { id: "SESI-02", name: "Pertemuan 2 - Workshop", label: "Pertemuan 2 - Workshop" }
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

        itemBtn.innerHTML = `
          <div class="dropdown-item-info">
            <span class="dropdown-item-title">${ns.escapeHtml(sesi.name)}</span>
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
          ns.UI.updateScannerStatus("Siap Memindai", `Sesi: ${sesi.name}`);
        });

        ns.DOM.sessionMenu.appendChild(itemBtn);
      });
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
      ns.DOM.detailTime.textContent = data.time;
      ns.DOM.detailOfficer.textContent = data.officer;

      if (ns.DOM.btnCancelCheckin) {
        ns.DOM.btnCancelCheckin.style.display = data.allowCancel ? "flex" : "none";
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

    openSettingsModal() {
      ns.DOM.inputPanitiaName.value = ns.state.panitiaName || "";
      ns.DOM.inputGateName.value = ns.state.gateName || "";
      ns.DOM.inputApiUrl.value = ns.state.apiUrl || "";

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

    recordHistory(entry) {
      ns.state.history.unshift(entry);
      if (ns.state.history.length > 50) ns.state.history.pop();
      localStorage.setItem("absen_history", JSON.stringify(ns.state.history));
      ns.UI.renderHistory();
    },

    renderHistory() {
      if (!ns.DOM.historyList) return;
      if (ns.state.history.length === 0) {
        ns.DOM.historyList.innerHTML = `<div style="text-align: center; color: var(--text-dim); padding: 24px;">Belum ada riwayat pemindaian pada sesi ini.</div>`;
        return;
      }

      ns.DOM.historyList.innerHTML = "";
      ns.state.history.forEach((item, idx) => {
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
            <div style="font-weight: 600; color: var(--text-main); font-size: 14px;">${ns.escapeHtml(item.name)}</div>
            <div style="font-size: 12px; color: var(--text-muted); margin-top: 2px;">
              ${ns.escapeHtml(item.ticketId)} • ${ns.escapeHtml(item.sessionName || "Sesi")} • ${ns.escapeHtml(item.time)}
            </div>
          </div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <span class="badge ${badgeClass}">${badgeLabel}</span>
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

    renderSearchResults(results, query) {
      if (!ns.DOM.searchResultsList) return;

      if (results && results.length > 0) {
        ns.DOM.searchResultsList.innerHTML = "";
        results.forEach(item => {
          const div = document.createElement("div");
          div.className = "search-result-item";
          
          const isHadir = item.status === "HADIR";
          const statusBadge = isHadir 
            ? `<span class="badge badge-warning">Sudah Hadir</span>` 
            : `<span class="badge badge-success">Belum Hadir</span>`;

          div.innerHTML = `
            <div>
              <div class="attendee-name">${ns.escapeHtml(item.name)} ${statusBadge}</div>
              <div class="attendee-sub">${ns.escapeHtml(item.ticketId)} • ${ns.escapeHtml(item.email)}</div>
            </div>
            <div>
              <button class="btn-checkin-sm" data-id="${ns.escapeHtml(item.ticketId)}">
                ${isHadir ? "Cek Status" : "Check In"}
              </button>
            </div>
          `;
          ns.DOM.searchResultsList.appendChild(div);
        });

        ns.DOM.searchResultsList.querySelectorAll(".btn-checkin-sm").forEach(btn => {
          btn.addEventListener("click", (e) => {
            const tId = e.currentTarget.getAttribute("data-id");
            ns.App.processCheckIn(tId, e.currentTarget);
          });
        });
      } else {
        ns.DOM.searchResultsList.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 20px;">Tidak ada peserta yang cocok dengan "${ns.escapeHtml(query)}"</div>`;
      }
    }
  };

})(window.EventPass);
