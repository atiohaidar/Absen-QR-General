/**
 * ==============================================================================
 * EventPass – Batch Attendance / Roll-Call Checklist Module (js/batch.js)
 * ==============================================================================
 * Mengelola checklist presensi massal (roll-call roster) berbasis cache lokal
 * dengan sinkronisasi batch ke Google Spreadsheet tanpa membebani sistem.
 * ==============================================================================
 */

window.EventPass = window.EventPass || {};

((ns) => {
  "use strict";

  const Batch = {
    selectedTickets: new Set(),
    filterStatus: "unattended", // "unattended" | "attended" | "all"
    searchQuery: "",
    isBatchMode: false,
    debounceTimer: null,

    /**
     * Inisialisasi event listener dan state modul batch
     */
    init() {
      const DOM = ns.DOM;
      if (!DOM) return;

      // 1. Subnav Switcher (Cari Satuan vs Checklist Massal)
      if (DOM.subtabBtnSingle) {
        DOM.subtabBtnSingle.addEventListener("click", () => this.switchSubtab("single"));
      }
      if (DOM.subtabBtnBatch) {
        DOM.subtabBtnBatch.addEventListener("click", () => this.switchSubtab("batch"));
      }

      // 2. Realtime Search Input dengan Debounce Ringan (120ms)
      if (DOM.batchSearchQuery) {
        DOM.batchSearchQuery.addEventListener("input", (e) => {
          const val = (e.target.value || "").trim();
          this.searchQuery = val.toLowerCase();

          if (DOM.btnBatchClearSearch) {
            DOM.btnBatchClearSearch.style.display = val ? "inline-block" : "none";
          }

          clearTimeout(this.debounceTimer);
          this.debounceTimer = setTimeout(() => {
            this.renderBatchRoster();
          }, 120);
        });
      }

      // Clear search button
      if (DOM.btnBatchClearSearch) {
        DOM.btnBatchClearSearch.addEventListener("click", () => {
          if (DOM.batchSearchQuery) {
            DOM.batchSearchQuery.value = "";
            DOM.batchSearchQuery.focus();
          }
          DOM.btnBatchClearSearch.style.display = "none";
          this.searchQuery = "";
          this.renderBatchRoster();
        });
      }

      // 3. Status Filter Dropdown
      if (DOM.batchStatusFilter) {
        DOM.batchStatusFilter.addEventListener("change", (e) => {
          this.filterStatus = e.target.value || "unattended";
          this.renderBatchRoster();
        });
      }

      // 4. Quick Selection Buttons
      if (DOM.btnBatchSelectAll) {
        DOM.btnBatchSelectAll.addEventListener("click", () => this.selectAllVisible());
      }
      if (DOM.btnBatchDeselectAll) {
        DOM.btnBatchDeselectAll.addEventListener("click", () => this.deselectAll());
      }

      // 5. Submit Batch Check-In Button
      if (DOM.btnSubmitBatchCheckin) {
        DOM.btnSubmitBatchCheckin.addEventListener("click", () => this.submitBatchCheckIn());
      }
    },

    /**
     * Berpindah antara mode Cari Satuan vs Checklist Massal
     */
    switchSubtab(mode) {
      const DOM = ns.DOM;
      if (!DOM) return;

      if (mode === "batch") {
        this.isBatchMode = true;
        if (DOM.subtabBtnBatch) {
          DOM.subtabBtnBatch.classList.add("active");
          DOM.subtabBtnBatch.setAttribute("aria-selected", "true");
        }
        if (DOM.subtabBtnSingle) {
          DOM.subtabBtnSingle.classList.remove("active");
          DOM.subtabBtnSingle.setAttribute("aria-selected", "false");
        }
        if (DOM.manualSingleContainer) DOM.manualSingleContainer.style.display = "none";
        if (DOM.manualBatchContainer) DOM.manualBatchContainer.style.display = "block";

        this.renderBatchRoster();
      } else {
        this.isBatchMode = false;
        if (DOM.subtabBtnSingle) {
          DOM.subtabBtnSingle.classList.add("active");
          DOM.subtabBtnSingle.setAttribute("aria-selected", "true");
        }
        if (DOM.subtabBtnBatch) {
          DOM.subtabBtnBatch.classList.remove("active");
          DOM.subtabBtnBatch.setAttribute("aria-selected", "false");
        }
        if (DOM.manualBatchContainer) DOM.manualBatchContainer.style.display = "none";
        if (DOM.manualSingleContainer) DOM.manualSingleContainer.style.display = "block";
      }
    },

    /**
     * Memeriksa apakah seorang peserta sudah hadir di sesi aktif
     */
    getAttendeeSessionStatus(attendee, sessionId) {
      if (!attendee) return { isAttended: false, time: "", label: "Belum Hadir" };

      const uId = String(attendee.ticketId || "").toUpperCase().trim();
      const inSessId = sessionId ? `${sessionId}_IN` : "";
      const sessions = attendee.checkedInSessions || {};

      // Cek antrean pending di HP (offline queue)
      const isPending = Boolean(
        ns.state.syncQueue && ns.state.syncQueue.some(
          q => String(q.ticketId).toUpperCase() === uId &&
               (q.sessionId === sessionId || q.sessionId === inSessId) &&
               !q.isDuplicate
        )
      );

      const val = sessions[inSessId] || sessions[sessionId] || "";
      const hasAttended = Boolean(val) || isPending;

      let timeText = "";
      if (typeof val === "string" && val) {
        timeText = val.replace(/^HADIR\s*-\s*/i, "").trim();
      } else if (isPending) {
        timeText = "Menunggu Sync";
      }

      return {
        isAttended: hasAttended,
        time: timeText,
        label: hasAttended ? "Sudah Hadir" : "Belum Hadir"
      };
    },

    /**
     * Render daftar peserta roll-call (Checklist Massal) dengan performa tinggi
     */
    renderBatchRoster() {
      const DOM = ns.DOM;
      if (!DOM || !DOM.batchRosterList) return;

      const cachedMap = ns.state.cachedAttendees || {};
      const allAttendees = Object.values(cachedMap);
      const currentSessId = ns.state.currentSessionId || "SESI-01";
      const currentSessName = ns.state.currentSessionName || "Sesi Utama";

      // Jika cache lokal masih kosong (belum pernah fetch)
      if (allAttendees.length === 0) {
        DOM.batchRosterList.innerHTML = `
          <div style="text-align: center; padding: 32px 16px; background: var(--bg-subtle); border-radius: var(--radius-md); border: 1px dashed var(--border-color);">
            <div style="font-size: 28px; margin-bottom: 8px;">📋</div>
            <strong style="font-size: 14px; color: var(--text-main); display: block; margin-bottom: 6px;">
              Data Peserta Belum Ada di Memori HP
            </strong>
            <p style="font-size: 12.5px; color: var(--text-muted); margin-bottom: 14px; line-height: 1.45;">
              Klik tombol di bawah untuk mengunduh daftar peserta dari Google Spreadsheet agar bisa melakukan checklist offline.
            </p>
            <button type="button" id="btn-batch-fetch-now" class="btn-primary" style="margin: 0 auto; width: auto; padding: 8px 18px; font-size: 13px;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 6px;">
                <polyline points="23 4 23 10 17 10"></polyline>
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
              </svg>
              <span>Unduh Data Peserta</span>
            </button>
          </div>
        `;

        const btnFetch = document.getElementById("btn-batch-fetch-now");
        if (btnFetch && ns.Sync) {
          btnFetch.addEventListener("click", () => {
            btnFetch.disabled = true;
            btnFetch.innerHTML = `<div class="spinner" style="width:12px;height:12px;border-width:2px;display:inline-block;margin-right:6px;"></div> Mengunduh...`;
            ns.Sync.syncAttendees(true).finally(() => {
              this.renderBatchRoster();
            });
          });
        }

        if (DOM.batchStatsSummary) DOM.batchStatsSummary.textContent = "0 Peserta";
        this.updateActionBar();
        return;
      }

      // Hitung metrik keseluruhan
      let totalCount = allAttendees.length;
      let totalAttended = 0;

      // Filter daftar peserta berdasarkan search query & status filter
      const q = this.searchQuery;
      const filtered = [];

      for (let i = 0; i < allAttendees.length; i++) {
        const att = allAttendees[i];
        const statusInfo = this.getAttendeeSessionStatus(att, currentSessId);

        if (statusInfo.isAttended) {
          totalAttended++;
        }

        // Saring berdasarkan filter status
        if (this.filterStatus === "unattended" && statusInfo.isAttended) continue;
        if (this.filterStatus === "attended" && !statusInfo.isAttended) continue;

        // Saring berdasarkan kata kunci pencarian
        if (q) {
          const tId = String(att.ticketId || "").toLowerCase();
          const tName = String(att.name || "").toLowerCase();
          const tEmail = String(att.email || "").toLowerCase();
          if (!tId.includes(q) && !tName.includes(q) && !tEmail.includes(q)) {
            continue;
          }
        }

        filtered.push({ attendee: att, statusInfo: statusInfo });
      }

      // Update bar ringkasan statistik
      if (DOM.batchStatsSummary) {
        DOM.batchStatsSummary.innerHTML = `<strong>${totalAttended}/${totalCount}</strong> Hadir • Menampilkan <strong>${filtered.length}</strong>`;
      }

      // Jika hasil saring kosong
      if (filtered.length === 0) {
        DOM.batchRosterList.innerHTML = `
          <div style="text-align: center; padding: 28px 16px; color: var(--text-muted); font-size: 13px;">
            Tidak ada peserta yang cocok dengan filter atau pencarian saat ini.
          </div>
        `;
        this.updateActionBar();
        return;
      }

      // Urutkan: Peserta yang belum hadir di atas, lalu abjad nama
      filtered.sort((a, b) => {
        if (a.statusInfo.isAttended !== b.statusInfo.isAttended) {
          return a.statusInfo.isAttended ? 1 : -1;
        }
        return String(a.attendee.name || "").localeCompare(String(b.attendee.name || ""));
      });

      // Render menggunakan DocumentFragment untuk efisiensi DOM 60 FPS
      const fragment = document.createDocumentFragment();

      filtered.forEach(({ attendee, statusInfo }) => {
        const uId = String(attendee.ticketId || "").toUpperCase().trim();
        const isAttended = statusInfo.isAttended;
        const isSelected = this.selectedTickets.has(uId);

        const item = document.createElement("div");
        item.className = "batch-roster-item" +
          (isAttended ? " is-attended" : "") +
          (isSelected && !isAttended ? " is-selected" : "");
        item.setAttribute("data-ticket-id", uId);

        // Icon checkmark SVG
        const checkIcon = `
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
        `;

        item.innerHTML = `
          <div class="batch-checkbox-wrap">
            <div class="batch-checkbox-custom">
              ${(isAttended || isSelected) ? checkIcon : ""}
            </div>
          </div>
          <div class="batch-item-info">
            <div class="batch-item-name">
              <span>${ns.escapeHtml(attendee.name || "Tanpa Nama")}</span>
            </div>
            <div class="batch-item-meta">
              <span class="batch-item-tag">${ns.escapeHtml(attendee.ticketId || "-")}</span>
              ${attendee.email && attendee.email !== "-" ? `<span>${ns.escapeHtml(attendee.email)}</span>` : ""}
              ${statusInfo.time ? `<span>• ${ns.escapeHtml(statusInfo.time)}</span>` : ""}
            </div>
          </div>
          <div class="batch-item-status-badge ${isAttended ? 'batch-badge-attended' : 'batch-badge-unattended'}">
            ${isAttended ? 'Sudah Hadir' : 'Belum Hadir'}
          </div>
        `;

        // Interaktivitas tap pada baris
        if (!isAttended) {
          item.addEventListener("click", () => {
            this.toggleTicketSelection(uId, item);
          });
        }

        fragment.appendChild(item);
      });

      DOM.batchRosterList.innerHTML = "";
      DOM.batchRosterList.appendChild(fragment);

      this.updateActionBar();
    },

    /**
     * Toggle status pemilihan untuk satu tiket
     */
    toggleTicketSelection(ticketId, itemElement) {
      if (!ticketId) return;
      const uId = ticketId.toUpperCase().trim();

      if (this.selectedTickets.has(uId)) {
        this.selectedTickets.delete(uId);
        if (itemElement) {
          itemElement.classList.remove("is-selected");
          const box = itemElement.querySelector(".batch-checkbox-custom");
          if (box) box.innerHTML = "";
        }
      } else {
        this.selectedTickets.add(uId);
        if (itemElement) {
          itemElement.classList.add("is-selected");
          const box = itemElement.querySelector(".batch-checkbox-custom");
          if (box) {
            box.innerHTML = `
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
            `;
          }
        }
      }

      this.updateActionBar();
    },

    /**
     * Tandai semua peserta yang sedang tampil dan belum hadir
     */
    selectAllVisible() {
      const DOM = ns.DOM;
      if (!DOM || !DOM.batchRosterList) return;

      const items = DOM.batchRosterList.querySelectorAll(".batch-roster-item:not(.is-attended)");
      items.forEach(el => {
        const tId = el.getAttribute("data-ticket-id");
        if (tId) {
          this.selectedTickets.add(tId.toUpperCase().trim());
          el.classList.add("is-selected");
          const box = el.querySelector(".batch-checkbox-custom");
          if (box) {
            box.innerHTML = `
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
            `;
          }
        }
      });

      this.updateActionBar();
      ns.UI.showToast(`${this.selectedTickets.size} peserta terpilih.`);
    },

    /**
     * Batalkan semua pilihan tiket
     */
    deselectAll() {
      const DOM = ns.DOM;
      this.selectedTickets.clear();

      if (DOM && DOM.batchRosterList) {
        const items = DOM.batchRosterList.querySelectorAll(".batch-roster-item.is-selected");
        items.forEach(el => {
          el.classList.remove("is-selected");
          const box = el.querySelector(".batch-checkbox-custom");
          if (box) box.innerHTML = "";
        });
      }

      this.updateActionBar();
    },

    /**
     * Perbarui tampilan counter dan tombol di Action Bar bawah
     */
    updateActionBar() {
      const DOM = ns.DOM;
      if (!DOM) return;

      const count = this.selectedTickets.size;

      if (DOM.batchSelectedBadge) {
        DOM.batchSelectedBadge.textContent = `${count} Dipilih`;
      }
      if (DOM.batchBarCount) {
        DOM.batchBarCount.textContent = `${count} Peserta Terpilih`;
      }
      if (DOM.btnSubmitBatchCheckin) {
        DOM.btnSubmitBatchCheckin.disabled = (count === 0);
      }
      if (DOM.batchSubmitBtnText) {
        DOM.batchSubmitBtnText.textContent = count > 0
          ? `Simpan Presensi (${count})`
          : `Simpan Presensi`;
      }
    },

    /**
     * Eksekusi penyimpanan presensi massal (Batch Submission)
     */
    async submitBatchCheckIn() {
      const DOM = ns.DOM;
      if (this.selectedTickets.size === 0) {
        ns.UI.showToast("Pilih minimal 1 peserta untuk dicatat presensinya.");
        return;
      }

      // Pastikan nama panitia sudah diatur
      if (ns.App && typeof ns.App.requirePanitiaName === "function") {
        if (!ns.App.requirePanitiaName()) return;
      }

      const tickets = Array.from(this.selectedTickets);
      const totalToProcess = tickets.length;
      const sessionId = ns.state.currentSessionId || "SESI-01";
      const sessionName = ns.state.currentSessionName || "Sesi Utama";
      const operator = ns.state.panitiaName || "Panitia";
      const gate = ns.state.gateName || "Pintu Masuk";
      const inSessId = `${sessionId}_IN`;
      const now = new Date();
      const timeStr = now.toLocaleTimeString();
      const isoTimeStr = ns.Sync ? ns.Sync.formatLocalIsoDateTime(now) : now.toLocaleString();

      // UI Loading Feedback
      if (DOM.btnSubmitBatchCheckin) {
        DOM.btnSubmitBatchCheckin.disabled = true;
        DOM.btnSubmitBatchCheckin.classList.add("btn-loading");
      }
      if (DOM.batchSubmitBtnText) {
        DOM.batchSubmitBtnText.innerHTML = `
          <div class="spinner" style="width:14px;height:14px;border-width:2px;display:inline-block;vertical-align:middle;margin-right:6px;"></div>
          <span>Menyimpan ${totalToProcess} Peserta...</span>
        `;
      }
      if (DOM.globalLoadingBar) DOM.globalLoadingBar.classList.add("active");

      // Siapkan paket payload scan batch
      const scanBatch = [];

      tickets.forEach(ticketId => {
        const uId = ticketId.toUpperCase().trim();
        const cached = ns.state.cachedAttendees ? ns.state.cachedAttendees[uId] : null;
        const attendeeName = cached ? cached.name : "Peserta";
        const attendeeEmail = cached ? cached.email : "-";

        // 1. Update cache lokal di memori secara instan
        if (cached) {
          cached.checkedInSessions = cached.checkedInSessions || {};
          cached.checkedInSessions[sessionId] = `HADIR - ${isoTimeStr}`;
          cached.checkedInSessions[inSessId] = `HADIR - ${isoTimeStr}`;
        }

        // 2. Tambahkan ke riwayat lokal
        ns.UI.recordHistory({
          ticketId: uId,
          name: attendeeName,
          email: attendeeEmail,
          sessionName: sessionName,
          time: timeStr,
          status: "BERHASIL",
          scannedBy: operator,
          gate: gate
        });

        // 3. Update metrik statistik scan
        ns.state.stats.total++;
        ns.state.stats.success++;

        // 4. Kumpulkan paket untuk sync ke Google Sheets
        scanBatch.push({
          ticketId: uId,
          sessionId: sessionId,
          sessionName: sessionName,
          scannedBy: operator,
          gate: gate,
          mapsUrl: (ns.state.location && ns.state.location.mapsUrl) || "-",
          deviceInfo: ns.state.deviceInfo || "-",
          clientTime: isoTimeStr,
          scanMode: "IN"
        });
      });

      // Simpan perubahan cache ke localStorage
      localStorage.setItem("absen_cached_attendees", JSON.stringify(ns.state.cachedAttendees));
      if (DOM.statTotal) DOM.statTotal.textContent = ns.state.stats.total;

      // Audio & Haptic feedback
      if (ns.sounds && typeof ns.sounds.playSuccess === "function") {
        ns.sounds.playSuccess();
      }
      if (navigator.vibrate) navigator.vibrate([80, 50, 80]);

      // Kirim batch ke backend / antrean sinkronisasi
      let sentDirectly = false;
      const isOnline = navigator.onLine;
      const hasApiUrl = Boolean(ns.state.apiUrl && ns.state.apiUrl.trim());

      if (isOnline && hasApiUrl && ns.API && typeof ns.API.batchCheckIn === "function") {
        try {
          const res = await ns.API.batchCheckIn(scanBatch);
          if (res && res.success) {
            sentDirectly = true;
          } else {
            console.warn("[Batch] Server mengembalikan status non-success, simpan ke antrean lokal.");
          }
        } catch (err) {
          console.warn("[Batch] Gagal kirim langsung ke server, dialihkan ke antrean offline:", err);
        }
      }

      // Jika offline atau kirim langsung gagal, masukkan ke syncQueue
      if (!sentDirectly && ns.Sync && typeof ns.Sync.enqueue === "function") {
        scanBatch.forEach(item => {
          ns.Sync.enqueue(item);
        });
      }

      // Reset UI state
      if (DOM.globalLoadingBar) DOM.globalLoadingBar.classList.remove("active");
      if (DOM.btnSubmitBatchCheckin) {
        DOM.btnSubmitBatchCheckin.classList.remove("btn-loading");
      }

      // Bersihkan daftar yang dipilih & re-render
      this.selectedTickets.clear();
      this.renderBatchRoster();

      const notifMsg = sentDirectly
        ? `Presensi ${totalToProcess} peserta berhasil disimpan ke Google Sheets!`
        : `Presensi ${totalToProcess} peserta tersimpan di HP (akan sync otomatis).`;

      ns.UI.showToast(notifMsg);
    }
  };

  ns.Batch = Batch;
})(window.EventPass);
