// Jalankan tiap hari: node monitor.js
// Narik harga BTC LIVE, baca/update status dari state.json, cetak laporan harian.
// Nanti kalau WA (Fonnte) udah disiapkan, tinggal sambungin output generateDailyReport() ke situ.

const fs = require('fs');
const path = require('path');
const { generateDailyReport } = require('./dailyReport');
const { fetchWithRetry } = require('./httpRetry');

const STATE_PATH = path.join(__dirname, 'state.json');

async function fetchCurrentPrice() {
  const res = await fetchWithRetry('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT');
  const data = await res.json();
  return parseFloat(data.price);
}

function loadState() {
  if (!fs.existsSync(STATE_PATH)) {
    return { status: 'TUNAI', position: null, lastChecked: null };
  }
  return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
}

function saveState(state) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

async function main() {
  const now = new Date();
  const price = await fetchCurrentPrice();
  const state = loadState();

  const position = state.status === 'OPEN' ? state.position : null;
  const report = generateDailyReport(now, price, position);

  console.log(report);
  // SENGAJA gak diarsip ke web publik -- ini laporan PRIBADI Olan, bukan buat grup/publik.
  // Arsip web cuma 3 grup: Berita, Laporan (grup), Sinyal (lihat buildDashboard.js).

  // cek peringatan tambahan kalau posisi lagi OPEN dan deket SL
  if (position) {
    const distToStopPct = ((price - position.stopPrice) / price) * 100;
    if (distToStopPct < 10) {
      console.log('\n⚠️⚠️ PERINGATAN: harga udah DEKAT Stop Loss (kurang dari 10%)! ⚠️⚠️');
    }
  }

  state.lastChecked = now.toISOString();
  saveState(state);
}

main().catch((e) => {
  console.error('ERROR monitor.js:', e.message);
  process.exit(1);
});
