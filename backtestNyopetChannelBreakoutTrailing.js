// backtestNyopetChannelBreakoutTrailing.js (22 Sep 2026) -- varian TRAILING dari
// backtestNyopetChannelBreakoutOnly.js (yang TP-nya TETAP, 1:1 R:R, PF 3,14 tervalidasi).
// Olan: "breakout-nya itu TP pake trailing stop.. kalo lebih baik langsung terapkan" -- ide biar
// nangkep pergerakan yang GAK BERHENTI-BERHENTI (bukan dibatasin target kecil).
//
// Jarak trailing = SAMA PERSIS halfWidth (lebar channel edge-ke-mid) yang udah dipakai buat SL
// awal -- SENGAJA gak nambah parameter baru (ATR/SMA dst), biar tetap 1 angka doang yang ngatur
// SEMUA (SL awal, TP versi lama, DAN trailing distance versi ini) -- konsisten sama filosofi
// "satu ukuran channel, semua diturunin dari situ" yang udah dipegang dari awal.
//
// Beda dari versi TP tetap: R-multiple SEKARANG VARIATIF (bukan cuma +1/-1) -- bisa -1 (kena SL
// awal persis), sedikit positif (trail udah naik dikit sebelum kesentuh), atau JAUH lebih besar
// dari +1 kalau momentumnya beneran lanjut panjang.

const { detectChannel, channelLinesAt } = require('./chartPatterns');
const {
  metricProfitFactor, barPermutationTest, buildEquityCurve, ulcerIndex, maxDrawdownPct,
  ulcerPerformanceIndex, deflatedSharpeRatio,
} = require('./backtest/backtestValidation');

const DEFAULT_CHANNEL_OPTS = { maxWidthAtrMultiple: 1.5 }; // SAMA PERSIS versi TP-tetap, biar apple-to-apple

// Trail SL selalu `trailDistance` di belakang harga TERBAIK yang pernah dicapai sejak entry
// (bukan sejak awal candle ini) -- SL cuma boleh gerak MAJU (mendekat ke profit), gak pernah
// mundur, standar trailing-stop di manapun.
function simulateTrailingLeg(candles, entryIndex, dir, entryPrice, halfWidth, trailDistance) {
  let sl = dir === 'long' ? entryPrice - halfWidth : entryPrice + halfWidth;
  let extreme = entryPrice;
  for (let j = entryIndex + 1; j < candles.length; j++) {
    const c = candles[j];
    if (dir === 'long') {
      if (c.low <= sl) return { outcome: 'STOPPED', r: (sl - entryPrice) / halfWidth, exitIndex: j, slAtExit: sl };
      if (c.high > extreme) { extreme = c.high; sl = Math.max(sl, extreme - trailDistance); }
    } else {
      if (c.high >= sl) return { outcome: 'STOPPED', r: (entryPrice - sl) / halfWidth, exitIndex: j, slAtExit: sl };
      if (c.low < extreme) { extreme = c.low; sl = Math.min(sl, extreme + trailDistance); }
    }
  }
  return { outcome: 'EOF', r: 0, exitIndex: candles.length - 1 };
}

// Varian PERSEN (22 Sep 2026, ide Olan) -- BEDA dari simulateTrailingLeg (dolar TETAP dari entry):
// di sini jarak trailing diukur % dari lebar channel/harga PAS ENTRY, tapi diterapkan ke harga
// EKSTREM SAAT ITU tiap langkah -- jadi jarak DOLAR-nya ikut MEMBESAR/MENGECIL proporsional
// mengikuti harga (bukan angka $ tetap yang jadi relatif kecil kalau harga udah lari jauh).
// SL AWAL tetap $ absolut dari lebar channel (invalidasi awal gak berubah), CUMA cara TRAILING-nya
// abis itu yang beda.
function simulateTrailingLegPct(candles, entryIndex, dir, entryPrice, initialHalfWidth, trailDistancePct) {
  let sl = dir === 'long' ? entryPrice - initialHalfWidth : entryPrice + initialHalfWidth;
  let extreme = entryPrice;
  for (let j = entryIndex + 1; j < candles.length; j++) {
    const c = candles[j];
    if (dir === 'long') {
      if (c.low <= sl) return { outcome: 'STOPPED', r: (sl - entryPrice) / initialHalfWidth, exitIndex: j };
      if (c.high > extreme) { extreme = c.high; sl = Math.max(sl, extreme * (1 - trailDistancePct / 100)); }
    } else {
      if (c.high >= sl) return { outcome: 'STOPPED', r: (entryPrice - sl) / initialHalfWidth, exitIndex: j };
      if (c.low < extreme) { extreme = c.low; sl = Math.min(sl, extreme * (1 + trailDistancePct / 100)); }
    }
  }
  return { outcome: 'EOF', r: 0, exitIndex: candles.length - 1 };
}

function simulateBreakoutTrailingPct(candles, opts = {}) {
  const { channelOpts = DEFAULT_CHANNEL_OPTS, tradeExpiryBars = 100, minLookahead = 45 } = opts;
  const trades = [];
  const detail = []; // 22 Sep 2026 -- expose entryPrice/halfWidth/nyawaPct per trade, dibutuhin buat
  // itung fee-adjusted PF (fee dolar = notional x feePct, notional = margin x leverage, leverage
  // dari nyawaPct -- BUKAN dari r doang) di backtestNyopetChannelBreakoutFeeCheck.js
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

    const trailDistancePct = (halfWidth / entryPrice) * 100; // "lebar regresi pas buka posisi awal, diukur persen"
    const leg = simulateTrailingLegPct(candles, i, dir, entryPrice, halfWidth, trailDistancePct);
    trades.push(leg.r);
    detail.push({ dir, entryPrice, halfWidth, entryTime: c.closeTime });

    activeChannel = null;
    i = leg.exitIndex + 1;
  }

  simulateBreakoutTrailingPct._lastDetail = detail;
  return trades;
}

function simulateBreakoutTrailing(candles, opts = {}) {
  const { channelOpts = DEFAULT_CHANNEL_OPTS, tradeExpiryBars = 100, minLookahead = 45, trailDistanceMultiple = 1 } = opts;
  const trades = [];
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

    const leg = simulateTrailingLeg(candles, i, dir, entryPrice, halfWidth, halfWidth * trailDistanceMultiple);
    trades.push(leg.r);

    activeChannel = null;
    i = leg.exitIndex + 1;
  }

  return trades;
}

function winRate(returns) { return returns.length ? returns.filter((r) => r > 0).length / returns.length : null; }

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

  const days = 120;
  console.log(`[BacktestBreakoutTrailing] Fetch BTCUSDT 5m, ${days} hari terakhir...`);
  const candles = await fetchAllCandles('BTCUSDT', '5m', Date.now() - days * 24 * 60 * 60 * 1000);
  console.log(`[BacktestBreakoutTrailing] ${candles.length} candle kefetch.`);

  const trades = simulateBreakoutTrailing(candles);
  console.log(`\n=== HASIL BREAKOUT + TRAILING STOP (${days} hari, BTCUSDT 5m) ===`);
  console.log(`Total trade: ${trades.length}`);
  console.log(`Win rate: ${(winRate(trades) * 100).toFixed(1)}%`);
  console.log(`Total R: ${trades.reduce((a, b) => a + b, 0).toFixed(1)}`);
  console.log(`Rata-rata R/trade: ${(trades.reduce((a, b) => a + b, 0) / trades.length).toFixed(3)}`);
  console.log(`Profit Factor: ${metricProfitFactor(trades).toFixed(2)}`);
  console.log(`Terbesar 1 trade: ${Math.max(...trades).toFixed(2)}R`);

  const curve = buildEquityCurve(trades);
  console.log(`Ulcer Index: ${ulcerIndex(curve).toFixed(2)}`);
  console.log(`Max Drawdown: ${maxDrawdownPct(curve).toFixed(1)}%`);
  console.log(`Ulcer Performance Index: ${ulcerPerformanceIndex(trades).upi.toFixed(2)}`);
  if (trades.length >= 30) {
    const dsr = deflatedSharpeRatio(trades, 5);
    console.log(`Deflated Sharpe Ratio: psr=${dsr.psr != null ? dsr.psr.toFixed(3) : 'n/a'}`);
  }
  if (trades.length >= 5) {
    console.log('\n=== BAR PERMUTATION TEST (200x) ===');
    const perm = barPermutationTest(candles, (c) => simulateBreakoutTrailing(c), metricProfitFactor, { iterations: 200 });
    if (perm.ok) {
      console.log(`Observed PF: ${perm.observedMetric.toFixed(2)} (n=${perm.observedTradeCount})`);
      console.log(`Null mean PF: ${perm.nullMean.toFixed(2)} +- ${perm.nullStdDev.toFixed(2)}`);
      console.log(`p-value: ${perm.pValue.toFixed(3)}`);
    } else {
      console.log('Permutation test gagal:', perm.error);
    }
  }
}

module.exports = { simulateBreakoutTrailing, simulateTrailingLeg, simulateBreakoutTrailingPct, simulateTrailingLegPct };
if (require.main === module) { main().catch((e) => { console.error('ERROR:', e.message); process.exit(1); }); }
