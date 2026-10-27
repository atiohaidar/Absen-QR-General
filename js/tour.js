/**
 * ==============================================================================
 * EventPass • Interactive Driver.js Tour Guide Module (js/tour.js)
 * Clean, step-by-step walkthrough for event operators with smooth tab transitions:
 * Scanner -> Nav Tabs Overview -> Cari Manual -> OTS -> Riwayat -> Cloud & Config.
 * ==============================================================================
 */

window.EventPass = window.EventPass || {};

(function(ns) {
  'use strict';

  let driverInstance = null;

  function activateTab(tabName) {
    const tabBtn = document.getElementById(`tab-btn-${tabName}`);
    if (tabBtn && !tabBtn.classList.contains("active")) {
      tabBtn.click();
    }
  }

  ns.Tour = {
    /**
     * Build and start the comprehensive Driver.js walkthrough
     */
    start() {
      const driverFactory = (window.driver && window.driver.js && window.driver.js.driver) 
                         || (typeof window.driver === 'function' ? window.driver : null);

      if (!driverFactory) {
        if (ns.UI && typeof ns.UI.showToast === 'function') {
          ns.UI.showToast("Modul tutorial sedang dimuat, coba sesaat lagi.");
        }
        return;
      }

      // Pastikan modal tertutup agar backdrop tutorial fokus ke elemen utama
      if (ns.UI) {
        if (typeof ns.UI.closeSettingsModal === 'function') ns.UI.closeSettingsModal();
        if (typeof ns.UI.closeOperatorModal === 'function') ns.UI.closeOperatorModal();
        if (typeof ns.UI.closeResultModal === 'function') ns.UI.closeResultModal();
      }

      // Pastikan awal tutorial mulai dari tab scan
      activateTab("scan");

      const tourSteps = [
        // 1. Identitas Panitia
        {
          element: '#operator-badge-btn',
          tab: 'scan',
          popover: {
            title: 'Identitas Petugas',
            description: 'Nama panitia dan gerbang aktif. Setiap pemindaian presensi otomatis tercatat atas nama Anda di audit spreadsheet panitia.',
            side: 'bottom',
            align: 'start'
          }
        },

        // 2. Pemilihan Sesi Acara
        {
          element: '#custom-session-dropdown',
          tab: 'scan',
          popover: {
            title: 'Pemilihan Sesi Pertemuan',
            description: 'Pilih sesi acara yang sedang berlangsung. 1 QR code peserta berlaku multi-sesi, dan sistem otomatis memvalidasi kehadiran di sesi yang dipilih.',
            side: 'bottom',
            align: 'start'
          }
        },

        // 3. Viewport Scanner Kamera
        {
          element: '.scanner-viewport-wrapper',
          tab: 'scan',
          popover: {
            title: 'Kamera & Pemindai QR',
            description: 'Arahkan kamera ke QR code tiket peserta. Engine scanner mendeteksi tiket dalam 0.05 detik dan memvalidasi duplikasi secara instan.',
            side: 'bottom',
            align: 'center'
          }
        },

        // 4. Kontrol Kamera
        {
          element: '.camera-controls',
          tab: 'scan',
          popover: {
            title: 'Kontrol Kamera & Galeri',
            description: 'Pintasan untuk beralih kamera depan/belakang, menyalakan senter di kondisi minim cahaya, atau membaca foto QR dari galeri ponsel.',
            side: 'top',
            align: 'center'
          }
        },

        // 5. Pengenalan Navigasi Tab
        {
          element: '.nav-tabs',
          tab: 'scan',
          popover: {
            title: 'Navigasi 4 Mode Presensi',
            description: 'Di baris ini terdapat 4 menu utama: Scan QR (kamera), Cari Manual (jika tiket bermasalah), Daftar OTS (walk-in), dan Riwayat. Mari kita pelajari tab berikutnya.',
            side: 'top',
            align: 'center'
          }
        },

        // 6. Pengenalan Tab Cari Manual
        {
          element: '#tab-btn-manual',
          tab: 'manual',
          popover: {
            title: 'Tab Cari Manual',
            description: 'Mode cadangan jika kamera ponsel peserta rusak, layar gelap, atau peserta tidak membawa HP. Tersedia dua metode pencarian di tab ini.',
            side: 'bottom',
            align: 'center'
          }
        },

        // 7. Tab Manual: Input ID Langsung
        {
          element: '#manual-ticket-id',
          tab: 'manual',
          popover: {
            title: 'Input ID Tiket Langsung',
            description: 'Jika peserta mengetahui kode tiketnya (misal: TICK-001), ketik kode tersebut di sini lalu tekan Check In.',
            side: 'bottom',
            align: 'start'
          }
        },

        // 8. Tab Manual: Cari Berdasarkan Nama / Email
        {
          element: '#manual-search-query',
          tab: 'manual',
          popover: {
            title: 'Cari Berdasarkan Nama atau Email',
            description: 'Jika peserta lupa nomor tiket, ketik nama atau email mereka di sini. Sistem akan menampilkan daftar peserta dan tombol Check In langsung.',
            side: 'bottom',
            align: 'start'
          }
        },

        // 9. Tab OTS (Walk-In)
        {
          element: '#tab-btn-ots',
          tab: 'ots',
          popover: {
            title: 'Tab Pendaftaran OTS (Walk-In)',
            description: 'Khusus peserta baru yang datang langsung tanpa pendaftaran online. Cukup isi nama lengkap, sistem langsung membuatkan tiket baru dan mencatat hadir di sesi ini.',
            side: 'bottom',
            align: 'center'
          }
        },

        // 10. Tab Riwayat & Pembatalan
        {
          element: '#tab-btn-history',
          tab: 'history',
          popover: {
            title: 'Tab Riwayat & Pembatalan',
            description: 'Daftar audit seluruh presensi di perangkat ini. Terdapat tombol Batalkan jika salah scan orang, serta status antrean sinkronisasi offline ke spreadsheet.',
            side: 'bottom',
            align: 'center'
          }
        },

        // 11. Status Cloud Sync
        {
          element: '#cloud-sync-dot',
          tab: 'scan',
          popover: {
            title: 'Status Sinkronisasi Cloud',
            description: 'Indikator status: Hijau (terhubung ke Google Sheets), Abu-abu (URL belum diatur), Kuning (sedang sync antrean), dan Merah (offline). Klik titik ini untuk membuka pengaturan atau sinkronisasi manual.',
            side: 'bottom',
            align: 'start'
          }
        },

        // 12. Pengaturan
        {
          element: '#btn-open-settings',
          tab: 'scan',
          popover: {
            title: 'Pengaturan & Cache Database',
            description: 'Menu untuk mengatur URL Google Apps Script, mengaktifkan mode scan instan 0.05s, dan menyinkronkan database peserta ke memori perangkat.',
            side: 'bottom',
            align: 'end'
          }
        }
      ];

      driverInstance = driverFactory({
        showProgress: true,
        animate: true,
        allowClose: true,
        doneBtnText: 'Selesai',
        nextBtnText: 'Lanjut',
        prevBtnText: 'Kembali',
        progressText: 'Langkah {{current}} dari {{total}}',
        steps: tourSteps,
        onHighlightStarted: (element, step) => {
          if (step && step.tab) {
            activateTab(step.tab);
            if (driverInstance && typeof driverInstance.refresh === 'function') {
              setTimeout(() => {
                try {
                  driverInstance.refresh();
                } catch (e) {}
              }, 70);
            }
          }
        },
        onDestroyStarted: () => {
          activateTab("scan");
          if (driverInstance) {
            driverInstance.destroy();
          }
        }
      });

      driverInstance.drive();
    }
  };

})(window.EventPass);
