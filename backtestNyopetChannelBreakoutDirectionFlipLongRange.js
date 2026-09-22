// backtestNyopetChannelBreakoutDirectionFlipLongRange.js (22 Sep 2026) -- ulang direction-flip
// test (yang sebelumnya cuma dites di 120 hari: 75.0% win rate arah asli vs 21.6% dibalik) tapi
// di rentang 2 TAHUN PENUH -- Olan: "lanjutin jalanin direction-flip test versi 2-tahun biar
// makin yakin sebelum ngomongin next step". Alasan perlu diulang di rentang panjang: bar
// permutation test (backtestNyopetChannelBreakoutLongRange.js) di 2 tahun BALIK LAGI gak
// signifikan (p=1.000, sama kayak temuan 120-hari yang bikin metode itu ditinggalkan) -- perlu
// dipastikan direction-flip (metode yang KEBUKTI valid sebelumnya) juga tetap konsisten di
// sample lebih besar, bukan cuma kebetulan cocok di 120 hari.

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
    if (all.length % 50000 < 1000) console.log(`  ... ${all.length} candle (${new Date(cursor).toISOString().slice(0, 10)})`);
  }
  return all;
}

function winRate(returns) { return returns.length ? returns.filter((r) => r > 0).length / returns.length : null; }
function yearOf(ms) { return new Date(ms).getUTCFullYear(); }

async function main() {
  const years = 2;
  const endTime = Date.now();
  const startTime = endTime - years * 365 * 24 * 60 * 60 * 1000;
  console.log(`[DirectionFlipLongRange] Fetch BTCUSDT 5m, ${years} tahun terakhir (${new Date(startTime).toISOString().slice(0, 10)} -> ${new Date(endTime).toISOString().slice(0, 10)})...`);
  const candles = await fetchAllCandles('BTCUSDT', '5m', startTime, endTime);
  console.log(`[DirectionFlipLongRange] ${candles.length} candle kefetch.\n`);

  for (const [label, flipDirection] of [['ARAH ASLI', false], ['ARAH DIBALIK', true]]) {
    const trades = simulateBreakoutOnly(candles, { flipDirection });
    const detail = simulateBreakoutOnly._lastDetail;
    console.log(`=== ${label} -- AGREGAT 2 TAHUN ===`);
    console.log(`Total trade: ${trades.length}, Win rate: ${(winRate(trades) * 100).toFixed(1)}%, Total R: ${trades.reduce((a, b) => a + b, 0).toFixed(1)}, PF: ${metricProfitFactor(trades).toFixed(2)}`);

    const byYear = {};
    detail.forEach((d, idx) => {
      const y = yearOf(d.entryTime);
      if (!byYear[y]) byYear[y] = [];
      byYear[y].push(trades[idx]);
    });
    console.log('Breakdown per tahun:');
    Object.keys(byYear).sort().forEach((y) => {
      const rs = byYear[y];
      console.log(`  ${y}: n=${rs.length}, win=${(winRate(rs) * 100).toFixed(1)}%, totalR=${rs.reduce((a, b) => a + b, 0).toFixed(1)}, PF=${metricProfitFactor(rs).toFixed(2)}`);
    });
    console.log();
  }
}

if (require.main === module) { main().catch((e) => { console.error('ERROR:', e.message, e.stack); process.exit(1); }); }
