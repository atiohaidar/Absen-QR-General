/**
 * ==============================================================================
 * EventPass • Telegram-Style Dynamic AR Scanner Engine (js/scanner.js)
 * Dual-Engine: Browser Native BarcodeDetector + Fallback jsQR (Apache 2.0)
 * ==============================================================================
 */

window.EventPass = window.EventPass || {};

(function(ns) {
  'use strict';

  const nativeBarcodeDetector = ('BarcodeDetector' in window) 
    ? new BarcodeDetector({ formats: ['qr_code'] }) 
    : null;

  // Potato-Phone Performance Throttle (~15 decodes/sec max to save 75% CPU while AR stays 60fps)
  let lastDecodeTime = 0;
  const DECODE_INTERVAL_MS = 65;

  // AR Tracker State
  const qrTracker = {
    currentCorners: null,
    targetCorners: null,
    detectedText: null,
    lastSeenTime: 0,
    opacity: 0,
    activeScanTriggered: false
  };

  function mapVideoToDisplay(pt, vW, vH, dW, dH) {
    const videoAspect = vW / vH;
    const displayAspect = dW / dH;
    let scale, offsetX = 0, offsetY = 0;

    if (videoAspect > displayAspect) {
      scale = dH / vH;
      offsetX = (dW - vW * scale) / 2;
    } else {
      scale = dW / vW;
      offsetY = (dH - vH * scale) / 2;
    }

    return {
      x: pt.x * scale + offsetX,
      y: pt.y * scale + offsetY
    };
  }

  function lerp(start, end, amt) {
    return start + (end - start) * amt;
  }

  function drawTelegramCornerBracket(ctx, corner, nextPt, prevPt, len) {
    const dxN = nextPt.x - corner.x;
    const dyN = nextPt.y - corner.y;
    const lenN = Math.hypot(dxN, dyN) || 1;
    const uNext = { x: dxN / lenN, y: dyN / lenN };

    const dxP = prevPt.x - corner.x;
    const dyP = prevPt.y - corner.y;
    const lenP = Math.hypot(dxP, dyP) || 1;
    const uPrev = { x: dxP / lenP, y: dyP / lenP };

    ctx.beginPath();
    ctx.moveTo(corner.x + uPrev.x * len, corner.y + uPrev.y * len);
    ctx.lineTo(corner.x, corner.y);
    ctx.lineTo(corner.x + uNext.x * len, corner.y + uNext.y * len);
    ctx.stroke();
  }

  function drawFloatingTag(ctx, x, y, text, isLocked) {
    ctx.save();
    ctx.font = "bold 12px 'Outfit', sans-serif";
    const paddingH = 12;
    const pillHeight = 26;
    const textWidth = ctx.measureText(text).width;
    const pillWidth = textWidth + paddingH * 2 + 14;
    const pillX = x - pillWidth / 2;
    const pillY = y - pillHeight / 2;

    // Clean pill tag
    ctx.fillStyle = "rgba(12, 31, 20, 0.92)";
    ctx.strokeStyle = isLocked ? "#62b32b" : "#0d532d";
    ctx.lineWidth = 1.5;
    ctx.shadowColor = "rgba(0, 0, 0, 0.2)";
    ctx.shadowBlur = 4;
    ctx.shadowOffsetY = 2;

    // Round rect
    ctx.beginPath();
    const r = 13;
    ctx.moveTo(pillX + r, pillY);
    ctx.arcTo(pillX + pillWidth, pillY, pillX + pillWidth, pillY + pillHeight, r);
    ctx.arcTo(pillX + pillWidth, pillY + pillHeight, pillX, pillY + pillHeight, r);
    ctx.arcTo(pillX, pillY + pillHeight, pillX, pillY, r);
    ctx.arcTo(pillX, pillY + pillWidth, pillX, pillY, r);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Status indicator dot
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    ctx.fillStyle = isLocked ? "#62b32b" : "#22c55e";
    ctx.beginPath();
    ctx.arc(pillX + 12, y, 3.5, 0, Math.PI * 2);
    ctx.fill();

    // Text label
    ctx.fillStyle = "#ffffff";
    ctx.textBaseline = "middle";
    ctx.fillText(text, pillX + 22, y + 0.5);
    ctx.restore();
  }

  // Screen WakeLock to prevent screen dimming during check-in rush
  let wakeLockSentinel = null;

  async function requestWakeLock() {
    if ('wakeLock' in navigator && !wakeLockSentinel) {
      try {
        wakeLockSentinel = await navigator.wakeLock.request('screen');
        wakeLockSentinel.addEventListener('release', () => {
          wakeLockSentinel = null;
        });
      } catch (e) {
        // Silently fail if restricted by OS/low battery
      }
    }
  }

  function releaseWakeLock() {
    if (wakeLockSentinel) {
      try {
        wakeLockSentinel.release();
      } catch (e) {}
      wakeLockSentinel = null;
    }
  }

  async function startScanning() {
    stopScanning();
    ns.UI.updateScannerStatus("Menghubungkan Kamera...", "Mohon izinkan akses kamera jika diminta...");

    try {
      const constraints = {
        video: {
          facingMode: { ideal: ns.state.currentFacingMode },
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: false
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      ns.state.mediaStream = stream;

      if (ns.DOM.scanVideo) {
        ns.DOM.scanVideo.srcObject = stream;
        ns.DOM.scanVideo.setAttribute("playsinline", "true");
        await ns.DOM.scanVideo.play();
      }

      ns.state.isScanning = true;
      ns.UI.updateScannerStatus("Siap Memindai", `Sesi: ${ns.state.currentSessionName}`);

      // Request screen stay awake
      requestWakeLock();

      // Start frame scan loop
      scanFrame();
    } catch (err) {
      console.warn("Camera start warning:", err);
      ns.state.isScanning = false;
      const errText = String(err || "");
      if (errText.includes("NotAllowed") || errText.includes("Permission")) {
        ns.UI.updateScannerStatus("Izin Kamera Ditolak", "Klik ikon gembok di URL browser untuk mengizinkan kamera");
      } else {
        ns.UI.updateScannerStatus("Kamera Offline", "Klik di sini untuk menyalakan kamera");
      }
    }
  }

  function stopScanning() {
    ns.state.isScanning = false;
    releaseWakeLock();

    if (ns.state.animationFrameId) {
      cancelAnimationFrame(ns.state.animationFrameId);
      ns.state.animationFrameId = null;
    }
    if (ns.state.mediaStream) {
      ns.state.mediaStream.getTracks().forEach(track => track.stop());
      ns.state.mediaStream = null;
    }
    if (ns.DOM.scanVideo) {
      ns.DOM.scanVideo.srcObject = null;
    }
  }

  // Auto-pause camera when phone is locked or app is minimized to save battery & prevent overheating
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      const activeTab = document.querySelector(".tab-btn.active");
      if (activeTab && activeTab.getAttribute("data-tab") === "scan") {
        startScanning();
      }
    } else {
      stopScanning();
    }
  });

  async function scanFrame() {
    if (!ns.state.isScanning || !ns.DOM.scanVideo) return;

    const tCanvas = ns.DOM.qrTrackingCanvas;
    const tCtx = tCanvas ? tCanvas.getContext("2d") : null;

    if (ns.DOM.scanVideo.readyState === ns.DOM.scanVideo.HAVE_ENOUGH_DATA) {
      const vW = ns.DOM.scanVideo.videoWidth;
      const vH = ns.DOM.scanVideo.videoHeight;
      const dW = ns.DOM.scanVideo.clientWidth;
      const dH = ns.DOM.scanVideo.clientHeight;

      // Sync tracking canvas dimensions to video element
      if (tCanvas && (tCanvas.width !== dW || tCanvas.height !== dH)) {
        tCanvas.width = dW;
        tCanvas.height = dH;
      }

      const canvas = ns.DOM.scanCanvas;
      const now = Date.now();
      const shouldDecode = (now - lastDecodeTime) >= DECODE_INTERVAL_MS;

      if (canvas && shouldDecode && !ns.state.isProcessing) {
        lastDecodeTime = now;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });

        let rawText = null;
        let rawCorners = null;

        // 1. Fast path: Native BarcodeDetector (C++ hardware accelerated on Chromium/Android)
        if (nativeBarcodeDetector) {
          try {
            const barcodes = await nativeBarcodeDetector.detect(ns.DOM.scanVideo);
            if (barcodes.length > 0 && barcodes[0].rawValue) {
              rawText = barcodes[0].rawValue;
              if (barcodes[0].cornerPoints && barcodes[0].cornerPoints.length === 4) {
                rawCorners = barcodes[0].cornerPoints;
              }
            }
          } catch (e) {
            // Fallback to jsQR
          }
        }

        // 2. Standard fallback: jsQR with downscaled canvas for potato phone efficiency
        if (!rawText && typeof jsQR !== "undefined") {
          // Downscale to max 640px width to reduce pixel processing by 75% on budget CPUs
          const scale = Math.min(1, 640 / vW);
          const scanW = Math.round(vW * scale);
          const scanH = Math.round(vH * scale);

          if (canvas.width !== scanW || canvas.height !== scanH) {
            canvas.width = scanW;
            canvas.height = scanH;
          }

          ctx.drawImage(ns.DOM.scanVideo, 0, 0, scanW, scanH);
          const imageData = ctx.getImageData(0, 0, scanW, scanH);
          const code = jsQR(imageData.data, scanW, scanH, { inversionAttempts: "dontInvert" });

          if (code && code.data) {
            rawText = code.data;
            if (code.location) {
              const invScale = 1 / scale;
              rawCorners = [
                { x: code.location.topLeftCorner.x * invScale, y: code.location.topLeftCorner.y * invScale },
                { x: code.location.topRightCorner.x * invScale, y: code.location.topRightCorner.y * invScale },
                { x: code.location.bottomRightCorner.x * invScale, y: code.location.bottomRightCorner.y * invScale },
                { x: code.location.bottomLeftCorner.x * invScale, y: code.location.bottomLeftCorner.y * invScale }
              ];
            }
          }
        }

        // QR detected on this frame
        if (rawCorners && rawText) {
          const mappedCorners = rawCorners.map(pt => mapVideoToDisplay(pt, vW, vH, dW, dH));
          qrTracker.targetCorners = mappedCorners;
          qrTracker.detectedText = rawText;
          qrTracker.lastSeenTime = Date.now();
          qrTracker.opacity = 1;

          if (!qrTracker.currentCorners) {
            qrTracker.currentCorners = mappedCorners.map(p => ({ x: p.x, y: p.y }));
          }

          // Trigger attendance check-in
          if (!ns.state.isProcessing && !qrTracker.activeScanTriggered) {
            qrTracker.activeScanTriggered = true;
            ns.App.handleScannedQr(rawText);
          }
        }
      }
    }

    // Render Dynamic AR Reticle over camera
    if (tCtx && tCanvas) {
      tCtx.clearRect(0, 0, tCanvas.width, tCanvas.height);

      const now = Date.now();
      const isRecentlySeen = (now - qrTracker.lastSeenTime) < 320;

      if (!isRecentlySeen) {
        qrTracker.opacity = Math.max(0, qrTracker.opacity - 0.08);
        qrTracker.activeScanTriggered = false;
      }

      if (qrTracker.opacity > 0 && qrTracker.currentCorners && qrTracker.targetCorners) {
        // Butter-smooth interpolation (Lerp) following physical QR code movements
        const lerpSpeed = 0.45;
        for (let i = 0; i < 4; i++) {
          qrTracker.currentCorners[i].x = lerp(qrTracker.currentCorners[i].x, qrTracker.targetCorners[i].x, lerpSpeed);
          qrTracker.currentCorners[i].y = lerp(qrTracker.currentCorners[i].y, qrTracker.targetCorners[i].y, lerpSpeed);
        }

        tCtx.save();
        tCtx.globalAlpha = qrTracker.opacity;

        const p0 = qrTracker.currentCorners[0];
        const p1 = qrTracker.currentCorners[1];
        const p2 = qrTracker.currentCorners[2];
        const p3 = qrTracker.currentCorners[3];

        const centerX = (p0.x + p1.x + p2.x + p3.x) / 4;
        const minY = Math.min(p0.y, p1.y, p2.y, p3.y);

        // 1. Semi-translucent Polygon Fill
        tCtx.beginPath();
        tCtx.moveTo(p0.x, p0.y);
        tCtx.lineTo(p1.x, p1.y);
        tCtx.lineTo(p2.x, p2.y);
        tCtx.lineTo(p3.x, p3.y);
        tCtx.closePath();
        tCtx.fillStyle = ns.state.isProcessing ? "rgba(13, 83, 45, 0.2)" : "rgba(98, 179, 43, 0.14)";
        tCtx.fill();

        // Thin outline
        tCtx.lineWidth = 1.5;
        tCtx.strokeStyle = ns.state.isProcessing ? "rgba(13, 83, 45, 0.8)" : "rgba(98, 179, 43, 0.7)";
        tCtx.stroke();

        // 2. 4 Corner Brackets (Aligning with physical QR corners)
        const bracketLen = Math.max(16, Math.min(32, Math.hypot(p1.x - p0.x, p1.y - p0.y) * 0.22));
        const bracketColor = ns.state.isProcessing ? "#62b32b" : "#0d532d";

        tCtx.shadowColor = "rgba(0, 0, 0, 0.25)";
        tCtx.shadowBlur = 3;
        tCtx.strokeStyle = bracketColor;
        tCtx.lineWidth = 3.5;
        tCtx.lineCap = "round";
        tCtx.lineJoin = "round";

        drawTelegramCornerBracket(tCtx, p0, p1, p3, bracketLen); // Top-Left
        drawTelegramCornerBracket(tCtx, p1, p2, p0, bracketLen); // Top-Right
        drawTelegramCornerBracket(tCtx, p2, p3, p1, bracketLen); // Bottom-Right
        drawTelegramCornerBracket(tCtx, p3, p0, p2, bracketLen); // Bottom-Left

        // 3. Floating Tag above QR
        if (qrTracker.detectedText) {
          const displayLabel = qrTracker.detectedText.length > 20 
            ? qrTracker.detectedText.substring(0, 18) + "..." 
            : qrTracker.detectedText;
          drawFloatingTag(tCtx, centerX, minY - 26, `⚡ ${displayLabel}`, ns.state.isProcessing);
        }

        tCtx.restore();
      }
    }

    if (ns.state.isScanning) {
      ns.state.animationFrameId = requestAnimationFrame(scanFrame);
    }
  }

  ns.Scanner = {
    startScanning,
    stopScanning,
    resetReticle() {
      qrTracker.activeScanTriggered = false;
      qrTracker.lastSeenTime = 0;
      qrTracker.opacity = 0;
    },
    async flipCamera() {
      ns.state.currentFacingMode = (ns.state.currentFacingMode === "environment") ? "user" : "environment";
      await startScanning();
      ns.UI.showToast(`Beralih ke kamera ${ns.state.currentFacingMode === "environment" ? "belakang" : "depan"}`);
    },
    async toggleTorch() {
      if (!ns.state.mediaStream) {
        ns.UI.showToast("Kamera belum aktif.");
        return;
      }
      const track = ns.state.mediaStream.getVideoTracks()[0];
      if (!track) return;

      try {
        ns.state.isTorchOn = !ns.state.isTorchOn;
        await track.applyConstraints({
          advanced: [{ torch: ns.state.isTorchOn }]
        });
        if (ns.DOM.btnTorch) ns.DOM.btnTorch.classList.toggle("active", ns.state.isTorchOn);
        ns.UI.showToast(ns.state.isTorchOn ? "Senter Nyala" : "Senter Mati");
      } catch (e) {
        ns.UI.showToast("Perangkat tidak mendukung kontrol senter.");
        ns.state.isTorchOn = false;
        if (ns.DOM.btnTorch) ns.DOM.btnTorch.classList.remove("active");
      }
    }
  };

})(window.EventPass);
