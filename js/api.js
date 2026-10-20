/**
 * ==============================================================================
 * EventPass • Network API Client with Timeout & Auto-Retry (js/api.js)
 * ==============================================================================
 */

window.EventPass = window.EventPass || {};

(function (ns) {
  'use strict';

  const DEFAULT_TIMEOUT_MS = 12000; // 12 seconds request timeout

  /**
   * Helper fetch with AbortController timeout to prevent UI freeze on spotty mobile data
   */
  async function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal
      });
      return response;
    } catch (err) {
      if (err.name === 'AbortError') {
        throw new Error('Koneksi timeout (jaringan lambat atau sinyal lemah).');
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Safe JSON parse that detects HTML login redirect pages from misconfigured Google Web Apps
   */
  async function parseResponseJson(response) {
    const text = await response.text();
    const trimmed = text.trim();

    // Deteksi jika Google me-redirect ke halaman HTML Login
    if (trimmed.startsWith('<') || trimmed.toLowerCase().includes('<!doctype html>')) {
      throw new Error('URL Apps Script mengembalikan halaman HTML. Pastikan opsi Deploy: "Who has access" diatur ke "Anyone", bukan "Only myself".');
    }

    try {
      return JSON.parse(trimmed);
    } catch (e) {
      throw new Error(`Format respons server tidak valid: ${trimmed.substring(0, 80)}...`);
    }
  }

  /**
   * Execute POST request with silent 1x auto-retry on SERVER_BUSY or transient network failure
   */
  async function postJsonWithRetry(payload, retries = 1) {
    const apiUrl = ns.state.apiUrl;
    if (!apiUrl) {
      throw new Error('URL API Google Apps Script belum disetting.');
    }

    const options = {
      method: 'POST',
      body: JSON.stringify(payload)
    };

    let attempt = 0;
    while (attempt <= retries) {
      try {
        const response = await fetchWithTimeout(apiUrl, options, DEFAULT_TIMEOUT_MS);
        const data = await parseResponseJson(response);

        // Jika server mengembalikan SERVER_BUSY, retry 1x setelah jeda 400ms
        if (data.status === 'SERVER_BUSY' && attempt < retries) {
          attempt++;
          await new Promise(r => setTimeout(r, 450));
          continue;
        }

        return data;
      } catch (err) {
        attempt++;
        if (attempt <= retries) {
          await new Promise(r => setTimeout(r, 450));
          continue;
        }
        throw err;
      }
    }
  }

  ns.API = {
    /**
     * Fetch active sessions from sheet Master Sesi
     */
    async fetchSessions() {
      const apiUrl = ns.state.apiUrl;
      if (!apiUrl) return null;

      // Coba lewat GET terlebih dahulu, fallback ke POST
      try {
        const response = await fetchWithTimeout(`${apiUrl}?action=getSessions`, {}, 8000);
        return await parseResponseJson(response);
      } catch (getErr) {
        return await postJsonWithRetry({ action: 'getSessions' }, 0);
      }
    },

    /**
     * Verify ticket check-in for active session
     */
    async checkIn(ticketId) {
      const payload = {
        action: 'checkIn',
        ticketId: ticketId.trim(),
        sessionId: ns.state.currentSessionId,
        sessionName: ns.state.currentSessionName,
        scannedBy: ns.state.panitiaName,
        gate: ns.state.gateName
      };

      return await postJsonWithRetry(payload, 1);
    },

    /**
     * Cancel / Undo check-in
     */
    async cancelCheckIn(ticketId, sessionId, sessionName, reason) {
      const payload = {
        action: 'cancelCheckIn',
        ticketId: ticketId.trim(),
        sessionId: sessionId,
        sessionName: sessionName,
        cancelledBy: ns.state.panitiaName,
        reason: reason || 'Dibatalkan oleh panitia'
      };

      return await postJsonWithRetry(payload, 1);
    },

    /**
     * Search attendees by query in Data Peserta
     */
    async searchAttendees(query) {
      const payload = {
        action: 'search',
        query: query.trim(),
        sessionId: ns.state.currentSessionId,
        sessionName: ns.state.currentSessionName
      };

      return await postJsonWithRetry(payload, 0);
    },

    /**
     * Register walk-in attendee on the spot
     */
    async registerOts(name, contact, notes) {
      const payload = {
        action: 'registerOts',
        name: name.trim(),
        contact: contact.trim(),
        notes: notes.trim(),
        sessionId: ns.state.currentSessionId,
        sessionName: ns.state.currentSessionName,
        scannedBy: ns.state.panitiaName,
        gate: ns.state.gateName
      };

      return await postJsonWithRetry(payload, 1);
    },

    /**
     * Test connection to Apps Script Web App
     */
    async testConnection(url) {
      if (!url) throw new Error('URL tidak boleh kosong.');
      const response = await fetchWithTimeout(url, {}, 8000);
      return await parseResponseJson(response);
    }
  };

})(window.EventPass);
