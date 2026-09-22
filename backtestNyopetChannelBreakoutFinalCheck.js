// backtestNyopetChannelBreakoutFinalCheck.js (22 Sep 2026) -- 2 lubang yang ditemuin Peninjau
// Skeptis (sub-agent review) belum ditutup: (1) sensitivitas parameter kurang granular di sekitar
// default 1.5x, (2) leverage 50x mentok dgn SL cuma ~0.1% dari harga -- backtest asumsi fill PERSIS
// di harga breakout/SL, padahal di dunia nyata slippage/wick sekecil apapun bisa kerasa berat di
// jarak SL sesempit itu. Dua-duanya dites di sini biar keputusan final gak gantung.

const { fetchWithRetry } = require('./httpRetry');
const { simulateBreakoutOnly } = require('./backtestNyopetChannelBreakoutOnly');
const { metricProfitFactor } = require('./backtest/backtestValidation');

const BASE_URL = 'https://data-api.binance.vision/api/v3/klines';
function parseCandle(raw) { return { openTime: raw[0], open: +raw[1], high: +raw[2], low: +raw[3], close: +raw[4], closeTime: raw[6] }; }
async function fetchAllCandles(symbol, interval, startTime, endTime) {
  let all = [];
  let cursor = startTime;
  while (cursor < endTime) {
    const res = await fetchWithRetry(`${BASE_URL}?symbol=${symbol}&interval=${interval}&startTime=${cursor}&endTime=${endTime}&limit=1000`);
    const raw = await res.json();
    if (!Array.isArray(raw) || raw.length === 0) break;
    all = all.concat(raw.map(parseCandle));
    const last = raw[raw.length - 1][6];
    if (last <= cursor) break;
    cursor = last + 1;
  }
  return all;
}

function winRate(returns) { return returns.length ? returns.filter((r) => r > 0).length / returns.length : null; }

async function main() {
  const years = 2;
  const endTime = Date.now();
  const startTime = endTime - years * 365 * 24 * 60 * 60 * 1000;
  console.log(`[FinalCheck] Fetch BTCUSDT 5m, ${years} tahun terakhir...`);
  const candles = await fetchAllCandles('BTCUSDT', '5m', startTime, endTime);
  console.log(`[FinalCheck] ${candles.length} candle kefetch.\n`);

  // === SENSITIVITAS GRANULAR di sekitar 1.5x ===
  console.log('=== SENSITIVITAS GRANULAR (1.1x - 1.9x, langkah 0.1) ===');
  for (const mult of [1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9]) {
    const trades = simulateBreakoutOnly(candles, { channelOpts: { maxWidthAtrMultiple: mult } });
    console.log(`  ${mult.toFixed(1)}x: n=${trades.length}, win=${(winRate(trades) * 100).toFixed(1)}%, PF=${metricProfitFactor(trades).toFixed(2)}, totalR=${trades.reduce((a, b) => a + b, 0).toFixed(1)}`);
  }

  // === STRESS TEST SLIPPAGE ===
  // R dinormalisasi ke halfWidth (jarak SL) by design -- jadi slippage yg diukur SEBAGAI % dari
  // halfWidth otomatis translate 1:1 ke satuan R, GAK butuh convert leverage lagi. Asumsi: entry
  // DAN exit (SL/TP) sama2 kena slippage seberat itu (round-trip, skenario pesimis: breakout =
  // momen paling volatile/likuiditas tertipis, dua sisi kena).
  console.log('\n=== STRESS TEST SLIPPAGE (% dari lebar-SL/halfWidth, round-trip 2x) ===');
  const tradesDefault = simulateBreakoutOnly(candles);
  for (const slipPctOfHalfWidth of [0, 0.05, 0.10, 0.20, 0.30, 0.50]) {
    const slippageR = 2 * slipPctOfHalfWidth; // kena di entry DAN exit
    const netTrades = tradesDefault.map((r) => r - slippageR);
    console.log(`  slippage=${(slipPctOfHalfWidth * 100).toFixed(0)}% dari halfWidth (=${slippageR.toFixed(2)}R/trade): PF=${metricProfitFactor(netTrades).toFixed(2)}, totalR=${netTrades.reduce((a, b) => a + b, 0).toFixed(1)}, winRate(net>0)=${(winRate(netTrades) * 100).toFixed(1)}%`);
  }
}

if (require.main === module) { main().catch((e) => { console.error('ERROR:', e.message, e.stack); process.exit(1); }); }
