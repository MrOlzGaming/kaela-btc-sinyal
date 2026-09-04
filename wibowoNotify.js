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

async function sendWhatsAppToWibowo(message) {
  const enabled = await kaela.getWibowoBroadcastEnabled();
  if (!enabled) {
    console.log('[WibowoNotify] Broadcast ke Wibowo Hedgefund lagi OFF (Silent Trade) -- pesan posisi di-skip.');
    return { skipped: true, silent: true };
  }
  return sendWhatsApp(message, WIBOWO_GROUP_ID);
}

module.exports = { WIBOWO_GROUP_ID, sendWhatsAppToWibowo };
