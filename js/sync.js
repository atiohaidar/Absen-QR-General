/**
 * ==============================================================================
 * EventPass • Sync Manager: Instant Scan, Offline Queue & Batch Background Sync
 * (js/sync.js)
 * ==============================================================================
 */

window.EventPass = window.EventPass || {};

(function (ns) {
  'use strict';

  const BATCH_SIZE = 15; // Send up to 15 queued scans in one request
  const FLUSH_INTERVAL_MS = 3500; // Check and flush queue every 3.5 seconds

  ns.Sync = {
    flushTimer: null,
    batchSupported: true, // Default true; switches to false if backend returns "tidak dikenali"

    init() {
      // Update UI with initial queue status
      this.updateSyncUI();
      this.updateCacheCountUI();

      // Start periodic flush
      this.startFlushTimer();

      // Listen to browser network changes
      window.addEventListener("online", () => {
        this.updateSyncUI();
        ns.UI.showToast("🌐 Koneksi internet online! Menyinkronkan antrean...");
        this.flushQueue();
      });

      window.addEventListener("offline", () => {
        this.updateSyncUI();
        ns.UI.showToast("⚠️ Mode offline aktif (koneksi terputus). Scan tetap lancar.");
      });

      // Auto-fetch attendees database if empty and URL is set
      if (ns.state.apiUrl && Object.keys(ns.state.cachedAttendees).length === 0) {
        setTimeout(() => this.syncAttendees(false), 800);
      }
    },

    startFlushTimer() {
      if (this.flushTimer) clearInterval(this.flushTimer);
      this.flushTimer = setInterval(() => {
        if (ns.state.syncQueue.length > 0 && navigator.onLine && !ns.state.isSyncingQueue) {
          this.flushQueue();
        }
      }, FLUSH_INTERVAL_MS);
    },

    /**
     * Download all attendees from sheet to local memory
     */
    async syncAttendees(isManual = false) {
      if (!ns.state.apiUrl) return;

      if (isManual && ns.DOM.btnSyncAttendees) {
        ns.DOM.btnSyncAttendees.disabled = true;
        ns.DOM.btnSyncAttendees.innerHTML = `<div class="spinner" style="width:10px;height:10px;border-width:1.5px;"></div> <span>Syncing...</span>`;
      }

      try {
        const data = await ns.API.fetchAttendees();
        if (data && data.success && Array.isArray(data.attendees)) {
          const pendingSessions = {};
          if (ns.state.syncQueue) {
            ns.state.syncQueue.forEach(item => {
              if (item.ticketId && item.sessionId && !item.isDuplicate) {
                const uId = String(item.ticketId).toUpperCase().trim();
                if (!pendingSessions[uId]) pendingSessions[uId] = {};
                pendingSessions[uId][item.sessionId] = item.clientTime || "Antrean";
              }
            });
          }

          const newMap = {};
          data.attendees.forEach(a => {
            if (a.ticketId) {
              const upperId = a.ticketId.toUpperCase().trim();
              const backendSessions = a.sessions || {};
              const userPending = pendingSessions[upperId] || {};
              newMap[upperId] = {
                ticketId: a.ticketId.trim(),
                name: a.name || "Peserta",
                email: a.email || "-",
                checkedInSessions: Object.assign({}, backendSessions, userPending)
              };
            }
          });

          ns.state.cachedAttendees = newMap;
          localStorage.setItem("absen_cached_attendees", JSON.stringify(newMap));
          ns.state.lastSyncTime = new Date().toLocaleTimeString();
          localStorage.setItem("absen_last_sync_time", ns.state.lastSyncTime);

          this.updateCacheCountUI();
          if (isManual) {
            ns.UI.showToast(`✅ Database peserta diperbarui (${data.count} peserta).`);
          }
        }
      } catch (err) {
        console.warn("Sync attendees error:", err);
        if (isManual) {
          ns.UI.showToast(`Gagal sync database: ${err.message}`);
        }
      } finally {
        if (isManual && ns.DOM.btnSyncAttendees) {
          ns.DOM.btnSyncAttendees.disabled = false;
          ns.DOM.btnSyncAttendees.innerHTML = `
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/>
            </svg>
            <span>Sync Database</span>
          `;
        }
      }
    },

    updateCacheCountUI() {
      const count = Object.keys(ns.state.cachedAttendees).length;
      if (ns.DOM.cacheStatusText) {
        if (count > 0) {
          ns.DOM.cacheStatusText.textContent = `${count} peserta siap mode instan`;
        } else {
          ns.DOM.cacheStatusText.textContent = "Belum tersinkron";
        }
      }
    },

    updateSyncUI() {
      const queueLen = ns.state.syncQueue.length;
      const isOnline = navigator.onLine;

      if (ns.DOM.cloudSyncDot) {
        ns.DOM.cloudSyncDot.className = "status-dot";
        if (!isOnline) {
          ns.DOM.cloudSyncDot.classList.add("offline");
          ns.DOM.cloudSyncDot.title = `Offline (${queueLen} antrean tersimpan di HP)`;
        } else if (ns.state.isSyncingQueue || queueLen > 0) {
          ns.DOM.cloudSyncDot.classList.add("syncing");
          ns.DOM.cloudSyncDot.title = `Menyinkronkan (${queueLen} antrean pending - Klik untuk sync)`;
        } else {
          ns.DOM.cloudSyncDot.title = "Cloud Sync Aktif (Semua tersinkron)";
        }
      }

      if (ns.DOM.syncQueueBadge) {
        if (queueLen > 0) {
          ns.DOM.syncQueueBadge.textContent = queueLen;
          ns.DOM.syncQueueBadge.style.display = "inline-flex";
          ns.DOM.syncQueueBadge.title = `${queueLen} antrean belum tersinkron (Klik untuk sync)`;
        } else {
          ns.DOM.syncQueueBadge.style.display = "none";
        }
      }
    },

    formatLocalIsoDateTime(d = new Date()) {
      const pad = n => String(n).padStart(2, "0");
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    },

    /**
     * Enqueue a new check-in to background sync queue
     */
    enqueue(scanData) {
      const queueItem = {
        queueId: "Q-" + Date.now() + "-" + Math.random().toString(36).substring(2, 7),
        ticketId: scanData.ticketId,
        sessionId: scanData.sessionId,
        sessionName: scanData.sessionName,
        scannedBy: scanData.scannedBy,
        gate: scanData.gate,
        mapsUrl: scanData.mapsUrl || "-",
        deviceInfo: scanData.deviceInfo || "-",
        clientTime: (scanData.clientTime && scanData.clientTime.includes("-")) ? scanData.clientTime : this.formatLocalIsoDateTime(),
        isDuplicate: !!scanData.isDuplicate,
        queuedAt: Date.now()
      };

      ns.state.syncQueue.push(queueItem);
      localStorage.setItem("absen_sync_queue", JSON.stringify(ns.state.syncQueue));
      this.updateSyncUI();

      // Trigger immediate flush if online
      if (navigator.onLine && !ns.state.isSyncingQueue) {
        this.flushQueue();
      }
    },

    /**
     * Flush queue to Google Apps Script in batches (with auto-fallback to sequential check-in)
     */
    async flushQueue(isManual = false) {
      if (ns.state.isSyncingQueue || ns.state.syncQueue.length === 0 || !navigator.onLine) {
        this.updateSyncUI();
        if (isManual && ns.state.syncQueue.length === 0) {
          ns.UI.showToast("Semua data presensi sudah tersinkron ke cloud ✅");
        }
        return;
      }

      ns.state.isSyncingQueue = true;
      this.updateSyncUI();

      const batch = ns.state.syncQueue.slice(0, BATCH_SIZE);
      const batchIds = new Set(batch.map(item => item.queueId));

      try {
        let isBatchSuccess = false;

        if (this.batchSupported) {
          const response = await ns.API.batchCheckIn(batch);

          if (response && response.success) {
            isBatchSuccess = true;
            // Remove processed items from queue
            ns.state.syncQueue = ns.state.syncQueue.filter(item => !batchIds.has(item.queueId));
            localStorage.setItem("absen_sync_queue", JSON.stringify(ns.state.syncQueue));

            // Check if any item was updated or rejected by server
            if (Array.isArray(response.results)) {
              response.results.forEach(res => {
                const uId = (res.ticketId || "").toUpperCase();

                if (res.status === "NOT_FOUND") {
                  // TIKET DIHAPUS DI SPREADSHEET (Rollback Alert)
                  ns.sounds.playError();
                  ns.UI.showToast(`⚠️ Tiket ${res.ticketId} Ditolak Server: Data telah dihapus dari Google Sheets!`);

                  // Update history item to indicate rejection
                  const hist = ns.state.history.find(h => h.ticketId === res.ticketId);
                  if (hist) {
                    hist.status = "REJECTED_BY_SERVER";
                    hist.note = "Dihapus dari Google Sheets";
                    localStorage.setItem("absen_history", JSON.stringify(ns.state.history));
                    ns.UI.renderHistory();
                  }

                  // Purge from local cache
                  delete ns.state.cachedAttendees[uId];
                  localStorage.setItem("absen_cached_attendees", JSON.stringify(ns.state.cachedAttendees));
                  this.updateCacheCountUI();
                } else if (res.status === "CHECKED_IN") {
                  // Di spreadsheet ternyata statusnya belum hadir/direset admin, sehingga server mencatat presensi baru
                  if (ns.state.cachedAttendees[uId]) {
                    if (!ns.state.cachedAttendees[uId].checkedInSessions) {
                      ns.state.cachedAttendees[uId].checkedInSessions = {};
                    }
                    const sessId = res.attendee?.sessionName || "SESI-01";
                    ns.state.cachedAttendees[uId].checkedInSessions[sessId] = res.attendee?.checkInTime || "Hadir";
                    localStorage.setItem("absen_cached_attendees", JSON.stringify(ns.state.cachedAttendees));
                  }

                  // Balikkan item duplikat lokal menjadi SUKSES jika ada
                  const dupHist = ns.state.history.find(h => h.ticketId === res.ticketId && h.status === "DUPLICATE");
                  if (dupHist) {
                    dupHist.status = "SUCCESS";
                    localStorage.setItem("absen_history", JSON.stringify(ns.state.history));
                    ns.UI.renderHistory();
                  }
                }
              });
            }

            if (isManual) {
              ns.UI.showToast(`✅ Berhasil menyinkronkan ${batch.length} data ke spreadsheet.`);
            }
          } else if (response && !response.success && response.message && (response.message.includes("tidak dikenali") || response.message.includes("batchCheckIn"))) {
            // ⚠️ Backend Apps Script belum dideploy dengan New Version!
            console.warn("Backend Apps Script belum mengenali 'batchCheckIn'. Melakukan fallback otomatis ke sequential check-in.");
            this.batchSupported = false;
            ns.UI.showToast("🔄 Backend versi lama terdeteksi. Menyinkronkan antrean satu per satu...");
          }
        }

        // =========================================================================
        // SEQUENTIAL FALLBACK (Jika Apps Script belum update ke versi batch)
        // =========================================================================
        if (!isBatchSuccess && !this.batchSupported) {
          for (const item of batch) {
            try {
              const singleRes = await ns.API.checkIn(item.ticketId);
              if (singleRes && (singleRes.success || singleRes.status === "ALREADY_CHECKED_IN")) {
                ns.state.syncQueue = ns.state.syncQueue.filter(q => q.queueId !== item.queueId);
                localStorage.setItem("absen_sync_queue", JSON.stringify(ns.state.syncQueue));
                this.updateSyncUI();
              } else if (singleRes && singleRes.status === "NOT_FOUND") {
                ns.state.syncQueue = ns.state.syncQueue.filter(q => q.queueId !== item.queueId);
                localStorage.setItem("absen_sync_queue", JSON.stringify(ns.state.syncQueue));
                this.updateSyncUI();
                ns.sounds.playError();
                ns.UI.showToast(`⚠️ Tiket ${item.ticketId} Ditolak: Tidak ada di Google Sheets.`);
              }
            } catch (singleErr) {
              console.warn("Single check-in fallback failed for", item.ticketId, singleErr);
              break;
            }
          }

          if (isManual && ns.state.syncQueue.length === 0) {
            ns.UI.showToast("✅ Semua antrean berhasil disinkronkan ke database.");
          }
        }
      } catch (err) {
        console.warn("Background sync batch failed, will retry next cycle:", err);
        if (isManual) {
          ns.UI.showToast(`Gagal sinkron antrean: ${err.message}`);
        }
      } finally {
        ns.state.isSyncingQueue = false;
        this.updateSyncUI();
        if (ns.UI && typeof ns.UI.renderHistory === "function") {
          ns.UI.renderHistory();
        }

        // If more items remain and online, schedule next batch
        if (ns.state.syncQueue.length > 0 && navigator.onLine) {
          setTimeout(() => this.flushQueue(), 1000);
        }
      }
    }
  };

})(window.EventPass);
