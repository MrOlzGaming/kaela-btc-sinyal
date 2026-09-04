// SATU titik kirim WA ke grup "Wibowo Hedgefund" (posisi buka/tutup Olan sendiri + manual
// terdeteksi reconciler) -- gantiin WIBOWO_GROUP_ID yang dulu ke-duplikat di 2 file terpisah
// (multiAccountExecutor.js + positionReconciler.js). Pola saklar sama kayak killSwitch.js.
//
// 4 Sep 2026 -- SAKLAR PAUSE ditambahin: Olan lapor pesan posisi ke grup ini nempelin gambar
// rusak ("kayak barcode", link-preview WA yang gagal parse) -- pesan DIMATIKAN SEMENTARA lewat
// wibowo-notify-config.json sampai bug itu kelar, biar gak keliatan lagi di grup selagi Kaela
// benerin. Default file gak ada = TIDAK pause (aman, gak nyenyet notif kalau lupa bikin file).
const fs = require('fs');
const path = require('path');
const { sendWhatsApp } = require('./fonnte');

const WIBOWO_GROUP_ID = '120363430640997174@g.us';
const CONFIG_PATH = path.join(__dirname, 'wibowo-notify-config.json');

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) return { paused: false };
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    return { paused: false };
  }
}

function isWibowoNotifyPaused() {
  return loadConfig().paused === true;
}

async function sendWhatsAppToWibowo(message) {
  const cfg = loadConfig();
  if (cfg.paused === true) {
    console.log(`[WibowoNotify] Pesan posisi ke Wibowo Hedgefund DI-SKIP -- lagi dipause (${cfg.reason || 'gak ada alasan tercatat'}).`);
    return { skipped: true, paused: true };
  }
  return sendWhatsApp(message, WIBOWO_GROUP_ID);
}

module.exports = { WIBOWO_GROUP_ID, isWibowoNotifyPaused, sendWhatsAppToWibowo };
