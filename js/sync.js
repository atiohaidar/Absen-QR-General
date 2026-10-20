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
          const newMap = {};
          data.attendees.forEach(a => {
            if (a.ticketId) {
              const upperId = a.ticketId.toUpperCase().trim();
              newMap[upperId] = {
                ticketId: a.ticketId.trim(),
                name: a.name || "Peserta",
                email: a.email || "-",
                checkedInSessions: (ns.state.cachedAttendees[upperId] && ns.state.cachedAttendees[upperId].checkedInSessions) || {}
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
          ns.DOM.cacheStatusText.textContent = `${count} peserta siap offline`;
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
          ns.DOM.cloudSyncDot.title = `Menyinkronkan (${queueLen} antrean pending)`;
        } else {
          ns.DOM.cloudSyncDot.title = "Cloud Sync Aktif (Semua tersinkron)";
        }
      }

      if (ns.DOM.syncQueueBadge) {
        if (queueLen > 0) {
          ns.DOM.syncQueueBadge.textContent = queueLen;
          ns.DOM.syncQueueBadge.style.display = "inline-flex";
        } else {
          ns.DOM.syncQueueBadge.style.display = "none";
        }
      }
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
        clientTime: scanData.clientTime || new Date().toLocaleTimeString(),
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
     * Flush queue to Google Apps Script in batches
     */
    async flushQueue() {
      if (ns.state.isSyncingQueue || ns.state.syncQueue.length === 0 || !navigator.onLine) {
        this.updateSyncUI();
        return;
      }

      ns.state.isSyncingQueue = true;
      this.updateSyncUI();

      const batch = ns.state.syncQueue.slice(0, BATCH_SIZE);
      const batchIds = new Set(batch.map(item => item.queueId));

      try {
        const response = await ns.API.batchCheckIn(batch);

        if (response && response.success) {
          // Remove processed items from queue
          ns.state.syncQueue = ns.state.syncQueue.filter(item => !batchIds.has(item.queueId));
          localStorage.setItem("absen_sync_queue", JSON.stringify(ns.state.syncQueue));

          // Check if any item was rejected by server (e.g. deleted in sheets)
          if (Array.isArray(response.results)) {
            response.results.forEach(res => {
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
                delete ns.state.cachedAttendees[res.ticketId.toUpperCase()];
                localStorage.setItem("absen_cached_attendees", JSON.stringify(ns.state.cachedAttendees));
                this.updateCacheCountUI();
              }
            });
          }
        }
      } catch (err) {
        console.warn("Background sync batch failed, will retry next cycle:", err);
      } finally {
        ns.state.isSyncingQueue = false;
        this.updateSyncUI();

        // If more items remain and online, schedule next batch
        if (ns.state.syncQueue.length > 0 && navigator.onLine) {
          setTimeout(() => this.flushQueue(), 800);
        }
      }
    }
  };

})(window.EventPass);
