/**
 * ==============================================================================
 * Comprehensive Stress Test & Offline Resilience Verification
 * Featuring User ID: TIC-TUGADG
 * (scratch/stress_test.js)
 * ==============================================================================
 */

// 1. Build Minimal Browser Environment Mock
class MockLocalStorage {
  constructor() {
    this.store = {};
  }
  getItem(key) {
    return Object.prototype.hasOwnProperty.call(this.store, key) ? this.store[key] : null;
  }
  setItem(key, val) {
    this.store[key] = String(val);
  }
  removeItem(key) {
    delete this.store[key];
  }
  clear() {
    this.store = {};
  }
}

global.localStorage = new MockLocalStorage();
global.sessionStorage = new MockLocalStorage();

const eventListeners = {};
global.window = {
  addEventListener(event, cb) {
    if (!eventListeners[event]) eventListeners[event] = [];
    eventListeners[event].push(cb);
  },
  dispatchEvent(event) {
    const list = eventListeners[event.type] || [];
    list.forEach(cb => cb(event));
  },
  location: { search: "", hash: "", origin: "http://localhost", pathname: "/" },
  history: { replaceState: () => {} }
};

Object.defineProperty(globalThis.navigator, 'onLine', { value: true, writable: true, configurable: true });
globalThis.navigator.vibrate = () => true;

global.Event = class Event {
  constructor(type) {
    this.type = type;
  }
};

// Mock DOM elements
function createMockElement(id) {
  return {
    id,
    value: "",
    textContent: "",
    innerHTML: "",
    className: "",
    children: [],
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
    classList: {
      add(cls) { this.className += " " + cls; },
      remove(cls) { this.className = this.className.replace(new RegExp("\\b" + cls + "\\b", "g"), "").trim(); },
      toggle(cls, force) {
        if (force === undefined) {
          if (this.contains(cls)) this.remove(cls);
          else this.add(cls);
        } else if (force) {
          this.add(cls);
        } else {
          this.remove(cls);
        }
      },
      contains(cls) { return (this.className || "").includes(cls); }
    },
    style: {},
    disabled: false,
    addEventListener: () => {},
    focus: () => {}
  };
}

const mockDomIds = [
  "global-loading-bar", "scanner-loading-hud", "hud-ticket-id",
  "btn-manual-checkin", "input-manual-id", "verifying-box", "verifying-text",
  "scanner-status-text", "scanner-status-sub", "stat-total", "stat-success",
  "stat-duplicate", "stat-invalid", "result-modal", "result-banner", "result-icon",
  "result-title", "result-subtitle", "detail-name", "detail-ticket-id",
  "detail-email", "detail-time", "detail-officer", "btn-cancel-checkin",
  "result-config-guide", "history-list", "history-empty", "history-count-badge",
  "cloud-sync-dot", "sync-queue-badge", "cache-status-text", "cfg-instant-mode",
  "btn-sync-attendees", "input-api-url", "input-gate-name", "input-panitia-name",
  "history-sync-banner", "history-sync-title", "history-sync-desc", "btn-sync-now-history"
];

const mockDOM = {};
mockDomIds.forEach(id => {
  const camelKey = id.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  mockDOM[camelKey] = createMockElement(id);
});

global.document = {
  getElementById(id) {
    const camelKey = id.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    return mockDOM[camelKey] || createMockElement(id);
  },
  querySelector(sel) {
    return createMockElement(sel);
  },
  querySelectorAll() {
    return [];
  },
  createElement(tag) {
    return createMockElement(tag);
  },
  addEventListener(event, cb) {
    // No-op for DOMContentLoaded in node test
  }
};

// Load Project Modules
const fs = require("fs");
const path = require("path");

const basePath = path.resolve(__dirname, "..");
global.window.EventPass = {};

// Load js/state.js
eval(fs.readFileSync(path.join(basePath, "js/state.js"), "utf8"));
// Load js/api.js
eval(fs.readFileSync(path.join(basePath, "js/api.js"), "utf8"));
// Load js/sync.js
eval(fs.readFileSync(path.join(basePath, "js/sync.js"), "utf8"));
// Load js/ui.js
eval(fs.readFileSync(path.join(basePath, "js/ui.js"), "utf8"));
// Load js/app.js
eval(fs.readFileSync(path.join(basePath, "js/app.js"), "utf8"));

const ep = global.window.EventPass;

// Override DOM in state
ep.DOM = mockDOM;

// Mock Audio & UI toast/modals for clean test output
ep.sounds = {
  init: () => {},
  playSuccess: () => {},
  playWarning: () => {},
  playError: () => {}
};

let toastLogs = [];
ep.UI.showToast = (msg) => {
  toastLogs.push(msg);
};

let modalLogs = [];
ep.UI.showResultModal = (data) => {
  modalLogs.push(data);
};
ep.UI.closeResultModal = () => {
  ep.state.isProcessing = false;
};

// ------------------------------------------------------------------------------
// TEST SUITE
// ------------------------------------------------------------------------------
async function runStressTests() {
  console.log("=================================================================");
  console.log("🚀 EVENTPASS STRESS & OFFLINE RESILIENCE TEST SUITE");
  console.log("   Target Ticket ID Verification: TIC-TUGADG");
  console.log("=================================================================\n");

  let passedTests = 0;
  let totalTests = 0;

  function assert(condition, testName, detail = "") {
    totalTests++;
    if (condition) {
      console.log(`  ✅ [PASS] ${testName} ${detail ? "(" + detail + ")" : ""}`);
      passedTests++;
    } else {
      console.error(`  ❌ [FAIL] ${testName} ${detail ? "(" + detail + ")" : ""}`);
      process.exitCode = 1;
    }
  }

  // Set up API state
  ep.state.apiUrl = "https://script.google.com/macros/s/TEST/exec";
  ep.state.instantMode = true;
  ep.state.panitiaName = "Panitia Test";
  ep.state.gateName = "Gate 1";
  ep.state.currentSessionId = "SESI-01";
  ep.state.currentSessionName = "Sesi Utama";

  // Mock Backend APIs
  let backendBatchesReceived = [];
  ep.API.batchCheckIn = async (scans) => {
    backendBatchesReceived.push([...scans]);
    await new Promise(r => setTimeout(r, 15));

    const results = scans.map(s => {
      // Simulate ticket TICK-0099 deleted on Google Sheets
      if (s.ticketId === "TICK-0099") {
        return {
          ticketId: s.ticketId,
          status: "NOT_FOUND",
          message: "Data tiket telah dihapus dari Google Sheets!"
        };
      }
      return {
        ticketId: s.ticketId,
        status: "CHECKED_IN",
        message: "Presensi tercatat"
      };
    });

    return {
      success: true,
      processedCount: scans.length,
      results: results
    };
  };

  ep.API.fetchAttendees = async () => {
    return {
      success: true,
      count: 200,
      attendees: Object.values(ep.state.cachedAttendees)
    };
  };

  // Seed 200 attendee records in local cache, EXPLICITLY INCLUDING USER TICKET 'TIC-TUGADG'
  const seedAttendees = {};
  for (let i = 1; i <= 199; i++) {
    const tid = `TICK-${String(i).padStart(4, "0")}`;
    seedAttendees[tid] = {
      ticketId: tid,
      name: `Peserta Nomor ${i}`,
      email: `peserta${i}@example.com`
    };
  }

  // Include user's requested ID: TIC-TUGADG
  seedAttendees["TIC-TUGADG"] = {
    ticketId: "TIC-TUGADG",
    name: "Ahmad Haidar (Target User)",
    email: "haidar@test.com"
  };

  ep.state.cachedAttendees = seedAttendees;
  localStorage.setItem("absen_cached_attendees", JSON.stringify(seedAttendees));

  // Initialize Sync module
  ep.Sync.init();

  assert(Object.keys(ep.state.cachedAttendees).length === 200, "1. Local Cache initialized with 200 attendees");
  assert(ep.state.cachedAttendees["TIC-TUGADG"] !== undefined, "2. User ticket TIC-TUGADG is ready in cache", ep.state.cachedAttendees["TIC-TUGADG"].name);

  // Helper to drain entire queue in batches
  async function drainAllQueues() {
    let safetyCounter = 0;
    while (ep.state.syncQueue.length > 0 && globalThis.navigator.onLine && safetyCounter < 20) {
      safetyCounter++;
      // Wait for any running batch
      while (ep.state.isSyncingQueue) {
        await new Promise(r => setTimeout(r, 20));
      }
      if (ep.state.syncQueue.length > 0) {
        await ep.Sync.flushQueue();
      }
      await new Promise(r => setTimeout(r, 30));
    }
  }

  // ----------------------------------------------------------------------------
  // TEST 1: Rapid-fire "Bertubi-tubi" Scans (Online)
  // ----------------------------------------------------------------------------
  console.log("\n--- TEST 1: Rapid-fire Scans Online (50 Scans Bertubi-tubi) ---");
  const startTime = Date.now();
  const scanCount = 50;

  for (let i = 1; i <= scanCount; i++) {
    const tid = (i === 1) ? "TIC-TUGADG" : `TICK-${String(i).padStart(4, "0")}`;
    await ep.App.processCheckIn(tid);
    ep.UI.closeResultModal();
  }

  const durationMs = Date.now() - startTime;
  const avgLatency = (durationMs / scanCount).toFixed(2);
  console.log(`  ⏱️ Processed ${scanCount} scans in ${durationMs}ms (Avg: ${avgLatency}ms/scan)`);

  assert(durationMs < 1000, "3. Throughput: 50 scans handled under 1000ms", `${durationMs}ms`);
  assert(ep.state.stats.success === scanCount, "4. Stats count matched exactly", `${ep.state.stats.success}/${scanCount}`);
  assert(modalLogs.length === scanCount, "5. UI modal popped up for every scan without lag");
  assert(modalLogs[0].type === "success" && modalLogs[0].ticketId === "TIC-TUGADG", "6. TIC-TUGADG first scan was instant SUCCESS", modalLogs[0].name);

  // Drain background batches
  await drainAllQueues();

  assert(backendBatchesReceived.length > 0, "7. Background batch sync flushed chunks to backend", `${backendBatchesReceived.length} batches`);
  assert(ep.state.syncQueue.length === 0, "8. Sync queue completely drained to 0 after server acknowledgment");

  // ----------------------------------------------------------------------------
  // TEST 2: Internet Mati (Offline Scans)
  // ----------------------------------------------------------------------------
  console.log("\n--- TEST 2: Internet Terputus / Mati (Offline Scans) ---");
  
  // Simulate network disconnection
  globalThis.navigator.onLine = false;
  global.window.dispatchEvent(new Event("offline"));

  assert(mockDOM.cloudSyncDot.classList.contains("offline") || mockDOM.cloudSyncDot.className.includes("offline"), "9. Cloud status dot turned OFFLINE");

  const offlineScans = 30;
  const offlineStart = Date.now();

  for (let i = 51; i <= 51 + offlineScans - 1; i++) {
    const tid = `TICK-${String(i).padStart(4, "0")}`;
    await ep.App.processCheckIn(tid);
    ep.UI.closeResultModal();
  }

  const offlineDuration = Date.now() - offlineStart;
  console.log(`  ⏱️ Handled ${offlineScans} offline scans in ${offlineDuration}ms (Zero Network Delay)`);

  assert(offlineDuration < 500, "10. Offline scans execute instantly with zero freeze/timeout", `${offlineDuration}ms`);
  assert(ep.state.syncQueue.length === offlineScans, "11. All 30 offline scans safely enqueued in memory", `Queue: ${ep.state.syncQueue.length}`);
  
  // Verify persistence in localStorage
  const savedQueue = JSON.parse(localStorage.getItem("absen_sync_queue") || "[]");
  assert(savedQueue.length === offlineScans, "12. Queue persisted in localStorage (survives tab close/reload)", `Saved: ${savedQueue.length}`);
  assert(savedQueue[0].ticketId === "TICK-0051", "13. Correct ticket payload preserved in queue");

  // Also include deleted ticket (TICK-0099) offline
  await ep.App.processCheckIn("TICK-0099");
  ep.UI.closeResultModal();
  assert(ep.state.syncQueue.length === offlineScans + 1, "14. Ticket TICK-0099 enqueued offline");

  // ----------------------------------------------------------------------------
  // TEST 3: Internet Tersambung Kembali (Reconnection & Batch Sync)
  // ----------------------------------------------------------------------------
  console.log("\n--- TEST 3: Internet Tersambung Kembali (Reconnection & Batch Flush) ---");
  
  backendBatchesReceived = [];
  globalThis.navigator.onLine = true;
  global.window.dispatchEvent(new Event("online"));

  await drainAllQueues();

  assert(ep.state.syncQueue.length === 0, "15. All offline scans flushed and queue drained to 0", `Remaining: ${ep.state.syncQueue.length}`);
  assert(backendBatchesReceived.length >= 2, "16. Batch chunking split requests into chunks <= 15 (preventing 429 server overload)", `${backendBatchesReceived.length} batches`);
  assert(backendBatchesReceived[0].length <= 15, "17. First batch chunk size compliant (<= 15 items)", `${backendBatchesReceived[0].length} items`);

  // Verify rollback on deleted ticket (TICK-0099)
  const rejectedHistory = ep.state.history.find(h => h.ticketId === "TICK-0099");
  assert(rejectedHistory && rejectedHistory.status === "REJECTED_BY_SERVER", "18. Rollback: Deleted ticket automatically marked REJECTED_BY_SERVER in history");
  assert(!ep.state.cachedAttendees["TICK-0099"], "19. Deleted ticket purged from local cache");

  // ----------------------------------------------------------------------------
  // TEST 4: Duplicate Scan Prevention on User ID TIC-TUGADG
  // ----------------------------------------------------------------------------
  console.log("\n--- TEST 4: Duplicate Scan Prevention on TIC-TUGADG (Bertubi-tubi) ---");
  
  const prevDuplicates = ep.state.stats.duplicate;

  // Scan TIC-TUGADG 10 times consecutively
  for (let i = 0; i < 10; i++) {
    await ep.App.processCheckIn("TIC-TUGADG");
    ep.UI.closeResultModal();
  }

  assert(ep.state.stats.duplicate === prevDuplicates + 10, "20. 10 rapid scans of TIC-TUGADG immediately blocked as DUPLICATE", `Blocked: ${ep.state.stats.duplicate - prevDuplicates}`);
  const lastModal = modalLogs[modalLogs.length - 1];
  assert(lastModal.type === "warning" && lastModal.title.includes("SUDAH ABSEN"), "21. Warning modal displayed with previous attendance info", lastModal.title);

  // ----------------------------------------------------------------------------
  // TEST 5: Smart Fallback Live Check for Newly Registered Attendee
  // ----------------------------------------------------------------------------
  console.log("\n--- TEST 5: Smart Fallback Live Check (Peserta Baru Daftar) ---");
  
  // TICK-9999 is NOT in local cache (registered 10 seconds ago on Google Form)
  assert(!ep.state.cachedAttendees["TICK-9999"], "22. Confirm TICK-9999 is not in local cache");

  // Mock live check API
  ep.API.checkIn = async (tid) => {
    return {
      success: true,
      status: "CHECKED_IN",
      message: "Check-in live berhasil",
      attendee: {
        ticketId: tid,
        name: "Peserta Baru GForm",
        email: "baru@gmail.com",
        sessionName: "Sesi Utama"
      }
    };
  };

  await ep.App.processCheckIn("TICK-9999");
  ep.UI.closeResultModal();

  assert(ep.state.cachedAttendees["TICK-9999"] !== undefined, "23. Fallback: Successfully verified live and saved to local cache");
  assert(ep.state.cachedAttendees["TICK-9999"].name === "Peserta Baru GForm", "24. Correct attendee metadata cached for subsequent scans");

  // Scan TICK-9999 a second time -> should now be instant duplicate detection!
  await ep.App.processCheckIn("TICK-9999");
  ep.UI.closeResultModal();
  assert(modalLogs[modalLogs.length - 1].title.includes("SUDAH ABSEN"), "25. Subsequent scan of newly cached attendee recognized immediately as duplicate");

  // ----------------------------------------------------------------------------
  // TEST 6: Auto-Fallback when Backend returns 'Action "batchCheckIn" tidak dikenali.'
  // ----------------------------------------------------------------------------
  console.log("\n--- TEST 6: Auto-Fallback on Older Apps Script (Action tidak dikenali) ---");

  // Re-enable batch mode to test auto-detection
  ep.Sync.batchSupported = true;

  // Mock server returning the EXACT error user experienced:
  ep.API.batchCheckIn = async () => {
    return { success: false, message: 'Action "batchCheckIn" tidak dikenali.' };
  };

  let fallbackCheckInsReceived = [];
  ep.API.checkIn = async (tid) => {
    fallbackCheckInsReceived.push(tid);
    return {
      success: true,
      status: "CHECKED_IN",
      message: `Presensi ${tid} berhasil dicatat!`,
      attendee: { ticketId: tid, name: "Peserta Fallback" }
    };
  };

  // Enqueue 3 items in the sync queue
  ep.Sync.enqueue({ ticketId: "FB-001", sessionId: "SESI-01", sessionName: "Sesi Utama" });
  ep.Sync.enqueue({ ticketId: "FB-002", sessionId: "SESI-01", sessionName: "Sesi Utama" });
  ep.Sync.enqueue({ ticketId: "FB-003", sessionId: "SESI-01", sessionName: "Sesi Utama" });

  assert(ep.state.syncQueue.length === 3, "26. 3 items enqueued for fallback test");

  // Drain all fallback queues
  await drainAllQueues();

  assert(ep.Sync.batchSupported === false, "27. Detected older backend: batchSupported auto-flipped to FALSE");
  assert(fallbackCheckInsReceived.length === 3, "28. Fallback: all 3 items sequentially processed via checkIn API", fallbackCheckInsReceived.join(", "));
  assert(ep.state.syncQueue.length === 0, "29. Sync queue cleanly drained to 0 with zero stuck items");

  // Cleanup timers so Node process terminates cleanly
  if (ep.Sync.flushTimer) {
    clearInterval(ep.Sync.flushTimer);
  }

  // ----------------------------------------------------------------------------
  // SUMMARY
  // ----------------------------------------------------------------------------
  console.log("\n=================================================================");
  console.log(`🎯 TEST RESULTS: ${passedTests} / ${totalTests} TESTS PASSED`);
  if (passedTests === totalTests) {
    console.log("🎉 ALL 29 TESTS PASSED! Instant Mode, Offline Queue, & Batch Fallback are 100% rock solid.");
  } else {
    console.log("⚠️ SOME TESTS FAILED. Check log output above.");
  }
  console.log("=================================================================\n");
  process.exit(passedTests === totalTests ? 0 : 1);
}

runStressTests().catch(err => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
