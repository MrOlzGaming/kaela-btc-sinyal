// backtestNyopetChannelBreakoutRigorCheck.js (22 Sep 2026) -- 2 tes terakhir dari ATURAN BAKU
// RESEARCH-LOG.md yang belum dijalanin buat strategi channel-breakout: split-era + sensitivitas
// parameter. Olan minta keputusan TEGAS (bukan gantung "bagus tapi ragu") -- ini yang nentuin.

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
  console.log(`[RigorCheck] Fetch BTCUSDT 5m, ${years} tahun terakhir...`);
  const candles = await fetchAllCandles('BTCUSDT', '5m', startTime, endTime);
  console.log(`[RigorCheck] ${candles.length} candle kefetch.\n`);

  // === SPLIT-ERA: 2 potongan ~1 tahun independen ===
  const midTime = startTime + (endTime - startTime) / 2;
  const midIdx = candles.findIndex((c) => c.openTime >= midTime);
  const era1 = candles.slice(0, midIdx);
  const era2 = candles.slice(midIdx); // TIDAK overlap -- independen beneran, bukan cuma breakdown per tahun kalender

  console.log('=== SPLIT-ERA (2 potongan independen, ~1 tahun tiap era) ===');
  for (const [label, eraCandles] of [['Era 1 (lebih lama)', era1], ['Era 2 (lebih baru)', era2]]) {
    const trades = simulateBreakoutOnly(eraCandles);
    console.log(`${label}: n=${trades.length}, win=${(winRate(trades) * 100).toFixed(1)}%, PF=${metricProfitFactor(trades).toFixed(2)}, totalR=${trades.reduce((a, b) => a + b, 0).toFixed(1)}`);
  }

  // === SENSITIVITAS PARAMETER: maxWidthAtrMultiple digeser dari default 1.5 ===
  console.log('\n=== SENSITIVITAS PARAMETER (maxWidthAtrMultiple, default=1.5) ===');
  for (const mult of [1.0, 1.5, 2.0, 2.5]) {
    const trades = simulateBreakoutOnly(candles, { channelOpts: { maxWidthAtrMultiple: mult } });
    console.log(`  ${mult}x: n=${trades.length}, win=${(winRate(trades) * 100).toFixed(1)}%, PF=${metricProfitFactor(trades).toFixed(2)}, totalR=${trades.reduce((a, b) => a + b, 0).toFixed(1)}`);
  }
}

if (require.main === module) { main().catch((e) => { console.error('ERROR:', e.message, e.stack); process.exit(1); }); }
