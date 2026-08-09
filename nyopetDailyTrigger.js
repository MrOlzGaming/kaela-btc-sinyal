// PENSIUN per 9 Agu 2026 -- digantikan nyopetAutoAnalysis.js (analisa gabungan teknikal +
// liquidation heatmap + VALID/INVALID otomatis, bukan cuma heartbeat generik). File ini
// TIDAK DIPANGGIL workflow lagi, dibiarin ada buat referensi/riwayat, jangan dihapus.
//
// Jalankan tiap hari ~08:05 WITA (candle Daily udah closed): node nyopetDailyTrigger.js
// Kirim heartbeat harian ke grup WA -- BUKAN sinyal apapun, cuma status "Kaela lagi kerja" +
// ajakan Olan buka chat buat analisa BTC multi-timeframe bareng (lihat feedback-nyopet-selalu-
// beralasan.md: Rencana/heartbeat non-valid gak pernah tampil di web, cuma WA doang).

const fs = require('fs');
const path = require('path');
const { formatDailyTrigger } = require('./nyopetOrderLog');
const { sendWhatsApp } = require('./fonnte');
const { fetchWithRetry } = require('./httpRetry');
const { localDateKey } = require('./config');

const STATE_PATH = path.join(__dirname, 'nyopet-trigger-state.json');

function loadState() {
  if (!fs.existsSync(STATE_PATH)) return { lastSentDate: null };
  return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
}

function saveState(state) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

async function main() {
  const now = new Date();
  const todayKey = localDateKey(now); // hari kalender WITA, bukan UTC
  const state = loadState();

  if (state.lastSentDate === todayKey) {
    console.log('[NyopetDailyTrigger]', now.toISOString(), '— udah kirim hari ini, skip (cegah dobel WA kalau ke-run ulang).');
    return;
  }

  const res = await fetchWithRetry('https://data-api.binance.vision/api/v3/ticker/price?symbol=BTCUSDT');
  const price = parseFloat((await res.json()).price);

  const msg = formatDailyTrigger(price);
  console.log(msg);
  await sendWhatsApp(msg);

  state.lastSentDate = todayKey;
  saveState(state);
}

main().catch((e) => {
  console.error('ERROR nyopetDailyTrigger.js:', e.message);
  process.exit(1);
});
