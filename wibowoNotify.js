// SATU titik kirim WA ke grup "Wibowo Hedgefund" (posisi buka/tutup Olan sendiri + manual
// terdeteksi reconciler) -- gantiin WIBOWO_GROUP_ID yang dulu ke-duplikat di 2 file terpisah
// (multiAccountExecutor.js + positionReconciler.js).
//
// 5 Sep 2026, permintaan Olan ("kasih aku tombol di developer.. off silent trade, on broadcast
// trade.. soalnya belum ada yang nitip dana, kita lagi pengembangan") -- saklar broadcast SEKARANG
// dikontrol Olan sendiri dari web Kaela Access (Developer > Wibowo Hedge Fund), dibaca dari GAS
// tiap mau kirim (lihat gas/Config.gs getWibowoBroadcastSetting). GANTIIN mekanisme LAMA (4 Sep
// 2026, wibowo-notify-config.json lokal di VPS -- cuma bisa diubah Kaela lewat SSH pas insiden bug
// barcode QRIS) -- file itu SEKARANG UDAH GAK DIPAKAI, sumber kebenaran tunggal pindah ke GAS.
const { sendWhatsApp } = require('./fonnte');
const kaela = require('./kaelaProTraderClient');

const WIBOWO_GROUP_ID = '120363430640997174@g.us';

// ⛔ INSIDEN NYATA 13 Sep 2026 -- lihat catatan panjang di kaelaProTraderClient.js
// getWibowoBroadcastEnabled(). Sekarang bedain 2 alasan skip: OFF disengaja (senyap, memang gak
// perlu ribut -- Olan sendiri yang matiin) vs GAGAL CEK (GAS hiccup) -- yang kedua WAJIB nyebut
// ISI pesan yang gagal terkirim, biar laporan mandor (reportCycleErrors.js) ke Olan langsung jelas
// KONSEKUENSINYA apa, bukan cuma baris teknis "gagal ambil setting" yang gampang dilewatin.
async function sendWhatsAppToWibowo(message) {
  const result = await kaela.getWibowoBroadcastEnabled();
  if (!result.enabled) {
    if (result.checkFailed) {
      const preview = String(message || '').split('\n')[0].slice(0, 80);
      console.log(`[WibowoNotify] GAGAL cek status broadcast (GAS error) -- PESAN INI TIDAK TERKIRIM ke Wibowo Hedgefund: "${preview}"`);
    } else {
      console.log('[WibowoNotify] Broadcast ke Wibowo Hedgefund lagi OFF (Silent Trade, disengaja) -- pesan posisi di-skip.');
    }
    return { skipped: true, silent: true, checkFailed: !!result.checkFailed };
  }
  return sendWhatsApp(message, WIBOWO_GROUP_ID);
}

module.exports = { WIBOWO_GROUP_ID, sendWhatsAppToWibowo };
