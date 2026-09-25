// Perbandingan trailing distance CHANNEL-WIDTH DINAMIS (yang UDAH LIVE sekarang, PF 11.68
// tervalidasi) vs 2% TETAP (ide Olan 25 Sep 2026, abis liat MASTER_RULE_DYNAMIC_CANDLE_
// INVALIDATION_v3_4.md pakai 2.00% sbg CONTOH ILUSTRASI) -- Olan: "biar kita sama-sama gak
// ngarang, bisa ambil metode terbaik" -- backtest APPLE-TO-APPLE, SATU SUMBER detektor channel
// yang sama (`detectChannel`/`channelLinesAt`, chartPatterns.js), SATU-SATUNYA variabel yang beda
// = cara hitung trailDistancePct (dinamis dari halfWidth vs konstanta 2).

const { detectChannel, channelLinesAt } = require('./chartPatterns');
const { simulateTrailingLegPct } = require('./backtestNyopetChannelBreakoutTrailing');
const { metricProfitFactor, buildEquityCurve, maxDrawdownPct } = require('./backtest/backtestValidation');

const DEFAULT_CHANNEL_OPTS = { maxWidthAtrMultiple: 1.5 };

// `trailPctFn(halfWidth, entryPrice) -> number` -- SATU-SATUNYA titik beda dari
// simulateBreakoutTrailingPct asli (yang HARDCODE halfWidth/entryPrice*100 di dalam loop) --
// diekstrak jadi callback biar bisa tukar dinamis vs konstan TANPA duplikat logic deteksi channel.
function simulateBreakoutTrailingCustomPct(candles, trailPctFn, opts = {}) {
  const { channelOpts = DEFAULT_CHANNEL_OPTS, tradeExpiryBars = 100, minLookahead = 45 } = opts;
  const trades = [];
  const detail = [];
  let i = minLookahead;
  let activeChannel = null;
  let channelFoundAt = 0;

  while (i < candles.length) {
    if (!activeChannel) {
      const ch = detectChannel(candles, i, channelOpts);
      if (ch) { activeChannel = ch; channelFoundAt = i; }
      i++;
      continue;
    }
    if (i - channelFoundAt > tradeExpiryBars) { activeChannel = null; continue; }

    const { top, bottom } = channelLinesAt(activeChannel, i);
    const halfWidth = (top - bottom) / 2;
    if (halfWidth <= 0) { activeChannel = null; continue; }
    const c = candles[i];

    const breakoutUp = top + halfWidth;
    const breakoutDown = bottom - halfWidth;
    let dir = null, entryPrice = null;
    if (c.high >= breakoutUp) { dir = 'long'; entryPrice = breakoutUp; }
    else if (c.low <= breakoutDown) { dir = 'short'; entryPrice = breakoutDown; }
    if (!dir) { i++; continue; }

    const trailDistancePct = trailPctFn(halfWidth, entryPrice);
    const leg = simulateTrailingLegPct(candles, i, dir, entryPrice, halfWidth, trailDistancePct);
    trades.push(leg.r);
    detail.push({ dir, entryPrice, halfWidth, trailDistancePct, entryTime: c.closeTime });

    activeChannel = null;
    i = leg.exitIndex + 1;
  }
  return { trades, detail };
}

function winRate(returns) { return returns.length ? returns.filter((r) => r > 0).length / returns.length : null; }

function report(label, trades) {
  if (trades.length === 0) { console.log(`${label}: gak ada trade.`); return; }
  const curve = buildEquityCurve(trades);
  console.log(`--- ${label} ---`);
  console.log(`  Trade: ${trades.length} | Win rate: ${(winRate(trades) * 100).toFixed(1)}% | PF: ${metricProfitFactor(trades).toFixed(2)}`);
  console.log(`  Total R: ${trades.reduce((a, b) => a + b, 0).toFixed(1)} | Rata-rata R/trade: ${(trades.reduce((a, b) => a + b, 0) / trades.length).toFixed(3)}`);
  console.log(`  Max Drawdown (kurva R): ${maxDrawdownPct(curve).toFixed(1)}%`);
  const half = Math.floor(trades.length / 2);
  const era1 = trades.slice(0, half), era2 = trades.slice(half);
  console.log(`  Split-era: Era1 (n=${era1.length}) PF=${metricProfitFactor(era1).toFixed(2)} | Era2 (n=${era2.length}) PF=${metricProfitFactor(era2).toFixed(2)}`);
  console.log();
}

async function main() {
  const { fetchWithRetry } = require('./httpRetry');
  const BASE_URL = 'https://data-api.binance.vision/api/v3/klines';
  function parseCandle(raw) { return { openTime: raw[0], open: +raw[1], high: +raw[2], low: +raw[3], close: +raw[4], closeTime: raw[6] }; }
  async function fetchAllCandles(symbol, interval, startTime) {
    let all = []; let cursor = startTime;
    for (;;) {
      const res = await fetchWithRetry(`${BASE_URL}?symbol=${symbol}&interval=${interval}&startTime=${cursor}&limit=1000`);
      const raw = await res.json();
      if (!Array.isArray(raw) || raw.length === 0) break;
      all = all.concat(raw.map(parseCandle));
      const last = raw[raw.length - 1][6];
      if (last <= cursor) break;
      cursor = last + 1;
      if (raw.length < 1000) break;
    }
    return all;
  }

  const days = 730; // ~2 tahun, SAMA rentang validasi asli PF 11.68
  console.log(`[BacktestFixed2PctCompare] Fetch BTCUSDT 5m, ${days} hari terakhir (~2 tahun, samain validasi asli)...`);
  const candles = await fetchAllCandles('BTCUSDT', '5m', Date.now() - days * 24 * 60 * 60 * 1000);
  console.log(`[BacktestFixed2PctCompare] ${candles.length} candle kefetch.\n`);

  const dynamic = simulateBreakoutTrailingCustomPct(candles, (halfWidth, entryPrice) => (halfWidth / entryPrice) * 100);
  const fixed2 = simulateBreakoutTrailingCustomPct(candles, () => 2.0);

  console.log('=== Channel-width DINAMIS (LIVE sekarang) vs 2% TETAP (ide Olan) ===\n');
  report('DINAMIS (halfWidth/entryPrice, LIVE)', dynamic.trades);
  report('TETAP 2%', fixed2.trades);

  // Sebaran trailDistancePct dinamis -- biar Olan liat rentang aslinya (bukan cuma titik tengah)
  const pcts = dynamic.detail.map((d) => d.trailDistancePct).sort((a, b) => a - b);
  if (pcts.length > 0) {
    console.log('Sebaran trailDistancePct DINAMIS (buat konteks kenapa beda dari 2% tetap):');
    console.log(`  Min: ${pcts[0].toFixed(2)}% | P25: ${pcts[Math.floor(pcts.length*0.25)].toFixed(2)}% | Median: ${pcts[Math.floor(pcts.length*0.5)].toFixed(2)}% | P75: ${pcts[Math.floor(pcts.length*0.75)].toFixed(2)}% | Max: ${pcts[pcts.length-1].toFixed(2)}%`);
  }
}

module.exports = { simulateBreakoutTrailingCustomPct };
if (require.main === module) { main().catch((e) => { console.error('ERROR:', e.message, e.stack); process.exit(1); }); }
