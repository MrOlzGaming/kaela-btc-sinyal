// backtestNyopetChannelBreakoutOnly.js (22 Sep 2026) -- riset LANJUTAN dari
// backtestNyopetChannelScalp.js. Temuan awal: leg "breakout-follow" (win rate 80,7%) di
// simulasi FADE+reverse ternyata CUMA muncul sebagai penyelamat SETELAH fade gagal duluan --
// sample-nya terfilter/kondisional (Olan tanya "bisa kita ambil yang breakout ini?", jawaban
// jujurnya: perlu diuji BERDIRI SENDIRI dulu sebelum diklaim valid).
//
// Strategi di sini: TRIGGER SAMA PERSIS (harga nembus separuh lebar channel dari garis batas --
// "breakout terkonfirmasi", bukan cuma nyentuh) TAPI TANPA nyoba fade dulu -- entry LANGSUNG pas
// breakout, SL/TP pakai lebar yang SAMA (edge-ke-mid channel), diukur dari titik breakout. Kalau
// hasil PF/win-rate-nya MIRIP sama leg breakout-follow tadi, itu bukti edge-nya ASLI (bukan
// artefak cara ngitung). Kalau JAUH beda, itu tandanya angka 80,7% tadi menyesatkan.

const { fetchWithRetry } = require('./httpRetry');
const { detectChannel, channelLinesAt } = require('./chartPatterns');
const {
  metricProfitFactor, barPermutationTest, buildEquityCurve, ulcerIndex, maxDrawdownPct,
  ulcerPerformanceIndex, deflatedSharpeRatio,
} = require('./backtest/backtestValidation');
const { simulateLeg } = require('./backtestNyopetChannelScalp');

const BASE_URL = 'https://data-api.binance.vision/api/v3/klines';
function parseCandle(raw) { return { openTime: raw[0], open: +raw[1], high: +raw[2], low: +raw[3], close: +raw[4], closeTime: raw[6] }; }
async function fetchAllCandles(symbol, interval, startTime) {
  let all = [];
  let cursor = startTime;
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

const DEFAULT_CHANNEL_OPTS = { maxWidthAtrMultiple: 1.5 }; // SAMA PERSIS backtestNyopetChannelScalp.js

// BEDA dari simulateChannelScalp -- entry CUMA pas breakout terkonfirmasi (harga nembus
// setengah-lebar channel dari garis), TANPA nyoba fade sama sekali. 1 channel = 1x breakout
// trade (kalau ada), sama filosofi "1 channel 1x trading" kayak sebelumnya.
// `flipDirection` (22 Sep 2026, dipakai backtestNyopetChannelBreakoutDirectionFlip.js) -- validasi
// edge ASLI-DIRECTIONAL (bukan artefak simetri backtest): kejadian breakout & entryPrice SAMA
// PERSIS, tapi posisi dibuka arah KEBALIKAN (long->short, short->long). SL/TP dihitung ULANG
// simetris dari entryPrice yang sama (mirror), BUKAN cuma dibalik tandanya -- kalau edge beneran
// dari momentum breakout (bukan kebetulan simetri market), versi dibalik ini HARUS jauh lebih
// jelek (win rate jatuh signifikan), bukan sekadar ~50%.
function simulateBreakoutOnly(candles, opts = {}) {
  const { channelOpts = DEFAULT_CHANNEL_OPTS, tradeExpiryBars = 100, minLookahead = 45, flipDirection = false } = opts;
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

    // Breakout terkonfirmasi = harga nembus garis batas SEBESAR halfWidth lagi (persis titik
    // yang jadi SL si fade di simulasi sebelumnya) -- SAMA kriteria konfirmasinya, biar hasilnya
    // bisa dibandingin APEL-KE-APEL sama leg breakout-follow yang lama.
    const breakoutUp = top + halfWidth;
    const breakoutDown = bottom - halfWidth;

    let dir = null, entryPrice = null;
    if (c.high >= breakoutUp) { dir = 'long'; entryPrice = breakoutUp; }
    else if (c.low <= breakoutDown) { dir = 'short'; entryPrice = breakoutDown; }

    if (!dir) { i++; continue; }

    if (flipDirection) dir = dir === 'long' ? 'short' : 'long';
    const sl = dir === 'long' ? entryPrice - halfWidth : entryPrice + halfWidth;
    const tp = dir === 'long' ? entryPrice + halfWidth : entryPrice - halfWidth;
    const leg = simulateLeg(candles, i, dir, sl, tp);
    trades.push(leg.r);
    detail.push({ dir, entryPrice, sl, tp, ...leg, entryTime: c.closeTime });

    activeChannel = null;
    i = leg.exitIndex + 1;
  }

  simulateBreakoutOnly._lastDetail = detail;
  return trades;
}

function winRate(returns) { return returns.length ? returns.filter((r) => r > 0).length / returns.length : null; }

async function main() {
  const days = 120;
  const startTime = Date.now() - days * 24 * 60 * 60 * 1000;
  console.log(`[BacktestBreakoutOnly] Fetch BTCUSDT 5m, ${days} hari terakhir...`);
  const candles = await fetchAllCandles('BTCUSDT', '5m', startTime);
  console.log(`[BacktestBreakoutOnly] ${candles.length} candle 5m kefetch.`);

  const trades = simulateBreakoutOnly(candles);
  console.log(`\n=== HASIL BREAKOUT-ONLY BERDIRI SENDIRI (${days} hari, BTCUSDT 5m) ===`);
  console.log(`Total trade: ${trades.length}`);
  console.log(`Win rate: ${(winRate(trades) * 100).toFixed(1)}%`);
  console.log(`Total R: ${trades.reduce((a, b) => a + b, 0).toFixed(1)}`);
  console.log(`Profit Factor: ${metricProfitFactor(trades).toFixed(2)}`);

  const returnsPct = trades.map((r) => r * 1);
  const curve = buildEquityCurve(returnsPct);
  console.log(`Ulcer Index: ${ulcerIndex(curve).toFixed(2)}`);
  console.log(`Max Drawdown: ${maxDrawdownPct(curve).toFixed(1)}%`);
  console.log(`Ulcer Performance Index: ${ulcerPerformanceIndex(returnsPct).upi.toFixed(2)}`);
  if (trades.length >= 30) {
    const dsr = deflatedSharpeRatio(returnsPct, 5);
    console.log(`Deflated Sharpe Ratio: psr=${dsr.psr != null ? dsr.psr.toFixed(3) : 'n/a'}`);
  }

  if (trades.length >= 5) {
    console.log('\n=== BAR PERMUTATION TEST (200x) ===');
    const perm = barPermutationTest(candles, (c) => simulateBreakoutOnly(c), metricProfitFactor, { iterations: 200 });
    if (perm.ok) {
      console.log(`Observed PF: ${perm.observedMetric.toFixed(2)} (n=${perm.observedTradeCount})`);
      console.log(`Null mean PF: ${perm.nullMean.toFixed(2)} +- ${perm.nullStdDev.toFixed(2)}`);
      console.log(`p-value: ${perm.pValue.toFixed(3)} (< 0.05 = signifikan)`);
    } else {
      console.log('Permutation test gagal:', perm.error);
    }
  }
}

module.exports = { simulateBreakoutOnly };
if (require.main === module) { main().catch((e) => { console.error('ERROR:', e.message); process.exit(1); }); }
