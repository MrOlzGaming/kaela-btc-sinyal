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
const fs = require('fs');
const path = require('path');
const { sendWhatsApp } = require('./fonnte');
const kaela = require('./kaelaProTraderClient');

const WIBOWO_GROUP_ID = '120363430640997174@g.us';

// Antrean "belum sempat kekirim" (13 Sep 2026, lanjutan fix insiden pesan hilang permanen) --
// KHUSUS buat kasus checkFailed (gagal cek toggle SEBELUM sempat coba kirim -- 0% resiko dobel,
// beda dari kegagalan Fonnte sendiri yang punya aturan retry TERPISAH & lebih hati-hati, lihat
// fonnte.js soal kenapa gak boleh asal retry kirim WA yang UDAH sempat nyoba/dapet respons server).
// JANGAN pernah antre pesan yang gagalnya di TAHAP KIRIM (sendWhatsApp sendiri) -- cuma pesan yang
// gagalnya SEBELUM itu (gate/pengecekan) yang aman diantre-ulang tanpa resiko spam.
const QUEUE_PATH = path.join(__dirname, 'wibowo-broadcast-queue.json');
const QUEUE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 jam -- lewat ini dianggap basi, dibuang aja

function _loadQueue() {
  if (!fs.existsSync(QUEUE_PATH)) return [];
  try { return JSON.parse(fs.readFileSync(QUEUE_PATH, 'utf8')); } catch { return []; }
}
function _saveQueue(q) { fs.writeFileSync(QUEUE_PATH, JSON.stringify(q, null, 2)); }

// Dipanggil TIAP SIKLUS (lihat positionReconciler.js reconcileWibowoPositions), REGARDLESS ada
// pesan baru atau nggak -- biar antrean lama gak nunggu sampai ada event baru buat dicoba lagi.
// CUMA dipanggil kalau broadcast KETAHUAN enabled (caller yang jamin) -- kalau lagi off/gagal cek
// lagi, JANGAN nyoba flush (bisa ke-skip lagi percuma, biarin nunggu siklus yang beneran sehat).
async function flushWibowoBroadcastQueue() {
  const queue = _loadQueue();
  if (queue.length === 0) return;
  const now = Date.now();
  const fresh = queue.filter((q) => now - q.queuedAtMs < QUEUE_MAX_AGE_MS);
  const dropped = queue.length - fresh.length;
  if (dropped > 0) console.log(`[WibowoNotify] ${dropped} pesan di antrean DIBUANG (basi, >24 jam gak berhasil kekirim juga).`);

  const remaining = [];
  for (const item of fresh) {
    const res = await sendWhatsApp(item.message, WIBOWO_GROUP_ID).catch((e) => ({ ok: false, error: e.message }));
    if (res && res.ok) {
      console.log(`[WibowoNotify] Antrean berhasil dikirim (sempat tertunda sejak ${new Date(item.queuedAtMs).toISOString()}): "${String(item.message).split('\n')[0].slice(0, 60)}"`);
    } else {
      remaining.push(item); // gagal lagi -- coba lagi siklus berikutnya, TETAP disimpen
    }
  }
  _saveQueue(remaining);
}

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
      console.log(`[WibowoNotify] GAGAL cek status broadcast (GAS error) -- PESAN INI DIANTRE (bukan hilang), dicoba lagi siklus berikutnya: "${preview}"`);
      const queue = _loadQueue();
      queue.push({ message, queuedAtMs: Date.now() });
      _saveQueue(queue);
    } else {
      console.log('[WibowoNotify] Broadcast ke Wibowo Hedgefund lagi OFF (Silent Trade, disengaja) -- pesan posisi di-skip.');
    }
    return { skipped: true, silent: true, checkFailed: !!result.checkFailed };
  }
  // Broadcast KETAHUAN sehat+enabled -- kesempatan bagus buat lepasin antrean lama juga (kalau ada),
  // SEBELUM kirim pesan baru ini (urutan kronologis, biar member liat yang lama duluan).
  await flushWibowoBroadcastQueue().catch((e) => console.log('[WibowoNotify] Gagal flush antrean:', e.message));
  return sendWhatsApp(message, WIBOWO_GROUP_ID);
}

module.exports = { WIBOWO_GROUP_ID, sendWhatsAppToWibowo, flushWibowoBroadcastQueue };
