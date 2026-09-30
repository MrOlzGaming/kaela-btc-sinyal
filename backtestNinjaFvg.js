// backtestNinjaFvg.js (30 Sep 2026) -- evaluasi spesifikasi NINJA baru dari Olan: ganti Channel
// Breakout 5M dengan FVG-touch (ninjaFvg.js), uji di 5M / 15M / 1H, banding head-to-head sama
// Channel Breakout 5M lama pakai METRIK YANG SAMA dan FEE YANG SAMA.
//
// Satuan: % NOTIONAL per trade (Kalkulator Exposure bikin notional per trade tetap = modal x
// exposure, jadi rugi/untung $ = notional x gerak harga %). Fee round-trip dipotong dari tiap
// trade dalam % notional juga -- ini yang bikin sistem yang sering buka-tutup kelihatan aslinya.
// $ dihitung pakai notional contoh $15.000 (kurang lebih ukuran posisi demo Ninja sekarang).
//
// Skenario fee round-trip: 0,04% (~maker+maker), 0,10% (~taker+taker), 0,20% (fallback 0,10%/sisi
// yang dipakai stats live ninjaTrader.js). Lihat BUG-KAELATRADE-0045 soal kenapa fee WAJIB dihitung
// per notional, bukan per margin.
//
// Pakai: node backtestNinjaFvg.js            (fetch 2 tahun candle 5m/15m/1h, ~1-2 menit)
//        NINJA_CANDLE_CACHE=/path/dir node backtestNinjaFvg.js   (cache candle ke disk)
//        NINJA_PERM_ITER=200 node backtestNinjaFvg.js            (iterasi bar-permutation test)

const fs = require('fs');
const path = require('path');
const { runBacktest, tradeGrossPct } = require('./ninjaFvg');
const { detectChannel, channelLinesAt } = require('./chartPatterns');
const { simulateTrailingLegPct } = require('./backtestNyopetChannelBreakoutTrailing');
const { metricProfitFactor, barPermutationTest, deflatedSharpeRatio } = require('./backtest/backtestValidation');

const FEES_RT = [0.04, 0.10, 0.20];
const NOTIONAL_USD = 15000;
const TF_MINUTES = { '5m': 5, '15m': 15, '1h': 60 };
const QUICK_CLOSE_MIN = 15;   // "ditutup terlalu cepat" = <= 15 menit
const REENTRY_WINDOW_MIN = 60; // "re-entry" = entry searah <= 60 menit setelah exit sebelumnya

const BASE_URL = 'https://data-api.binance.vision/api/v3/klines';
async function fetchCandles(interval, startTime, endTime) {
  const cacheDir = process.env.NINJA_CANDLE_CACHE;
  const cacheFile = cacheDir ? path.join(cacheDir, `BTCUSDT-${interval}-${startTime}-${endTime}.json`) : null;
  if (cacheFile && fs.existsSync(cacheFile)) return JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
  let all = [];
  let cursor = startTime;
  while (cursor < endTime) {
    const res = await fetch(`${BASE_URL}?symbol=BTCUSDT&interval=${interval}&startTime=${cursor}&endTime=${endTime}&limit=1000`);
    if (!res.ok) throw new Error(`Binance ${res.status}`);
    const raw = await res.json();
    if (!raw.length) break;
    all = all.concat(raw.map((r) => ({ openTime: r[0], open: +r[1], high: +r[2], low: +r[3], close: +r[4], closeTime: r[6] })));
    cursor = raw[raw.length - 1][0] + 1;
  }
  all = all.filter((c) => c.closeTime < endTime); // cuma candle yang udah CLOSED
  if (cacheFile) { fs.mkdirSync(cacheDir, { recursive: true }); fs.writeFileSync(cacheFile, JSON.stringify(all)); }
  return all;
}

// Channel Breakout 5M lama -- LOOP SAMA PERSIS simulateBreakoutTrailingPct (yang jadi dasar Ninja
// live), cuma ditambah catat index entry/exit buat metrik durasi & re-entry.
function runChannelBreakout(candles) {
  const trades = [];
  let i = 45, active = null, foundAt = 0;
  while (i < candles.length) {
    if (!active) { const ch = detectChannel(candles, i, { maxWidthAtrMultiple: 1.5 }); if (ch) { active = ch; foundAt = i; } i++; continue; }
    if (i - foundAt > 100) { active = null; continue; }
    const { top, bottom } = channelLinesAt(active, i);
    const hw = (top - bottom) / 2;
    if (hw <= 0) { active = null; continue; }
    const c = candles[i];
    let dir = null, entry = null;
    if (c.high >= top + hw) { dir = 'long'; entry = top + hw; } else if (c.low <= bottom - hw) { dir = 'short'; entry = bottom - hw; }
    if (!dir) { i++; continue; }
    const leg = simulateTrailingLegPct(candles, i, dir, entry, hw, (hw / entry) * 100);
    if (leg.outcome === 'EOF') break;
    trades.push({ dir, entryPrice: entry, grossPct: leg.r * (hw / entry) * 100, entryIdx: i, exitIdx: leg.exitIndex, entryTime: c.closeTime, slDistPct: (hw / entry) * 100 });
    active = null;
    i = leg.exitIndex + 1;
  }
  return trades;
}

function fvgTrades(candles, tf, opts) {
  return runBacktest(candles, tf, opts).map((t) => ({ ...t, grossPct: tradeGrossPct(t) }));
}

function maxDrawdown(returns) {
  let eq = 0, peak = 0, dd = 0;
  for (const r of returns) { eq += r; peak = Math.max(peak, eq); dd = Math.max(dd, peak - eq); }
  return dd;
}

function summarize(trades, tfMin, days, feeRt) {
  const n = trades.length;
  const gross = trades.map((t) => t.grossPct);
  const net = gross.map((g) => g - feeRt);
  const holds = trades.map((t) => (t.exitIdx - t.entryIdx + 1) * tfMin).sort((a, b) => a - b);
  let reentries = 0;
  for (let k = 1; k < n; k++) {
    const gapMin = (trades[k].entryIdx - trades[k - 1].exitIdx) * tfMin;
    if (trades[k].dir === trades[k - 1].dir && gapMin <= REENTRY_WINDOW_MIN) reentries++;
  }
  const sum = (a) => a.reduce((x, y) => x + y, 0);
  const grossProfit = sum(net.filter((x) => x > 0));
  const grossLoss = -sum(net.filter((x) => x < 0));
  const sortedGross = [...gross].sort((a, b) => b - a);
  const top5 = sortedGross.slice(0, Math.max(1, Math.round(n * 0.05)));
  const posGross = sum(gross.filter((x) => x > 0));
  return {
    n, perDay: n / days,
    winNet: net.filter((x) => x > 0).length / n * 100,
    grossSumPct: sum(gross), feeSumPct: feeRt * n, netSumPct: sum(net),
    netUsd: sum(net) / 100 * NOTIONAL_USD, feeUsd: feeRt * n / 100 * NOTIONAL_USD,
    netProfitPct: grossProfit, netLossPct: grossLoss,
    pfGross: metricProfitFactor(gross), pfNet: metricProfitFactor(net),
    medianHoldMin: holds[Math.floor(n / 2)], avgHoldMin: sum(holds) / n,
    quickClosePct: holds.filter((h) => h <= QUICK_CLOSE_MIN).length / n * 100,
    reentries, reentryPct: reentries / Math.max(1, n - 1) * 100,
    maxDdPct: maxDrawdown(net),
    bestTradePct: sortedGross[0], top5SharePct: posGross > 0 ? sum(top5) / posGross * 100 : 0,
    bigMoves: gross.filter((x) => x >= 1).length,
    avgSlPct: sum(trades.map((t) => t.slDistPct)) / n,
  };
}

function perYear(trades, candles, feeRt) {
  const out = {};
  for (const t of trades) {
    const y = new Date(candles[t.entryIdx].closeTime).getUTCFullYear();
    out[y] = out[y] || [];
    out[y].push(t.grossPct - feeRt);
  }
  return Object.entries(out).map(([y, r]) => `${y}: n=${r.length} net=${r.reduce((a, b) => a + b, 0).toFixed(1)}% PF=${metricProfitFactor(r).toFixed(2)}`).join(' | ');
}

const f = (x, d = 2) => (x === undefined || x === null || !isFinite(x) ? String(x) : x.toFixed(d));
function row(label, s) {
  return `${label.padEnd(34)} n=${String(s.n).padStart(5)} (${f(s.perDay, 1)}/hari) win=${f(s.winNet, 1)}% PFgross=${f(s.pfGross)} PFnet=${f(s.pfNet)} `
    + `gross=${f(s.grossSumPct, 1)}% fee=${f(s.feeSumPct, 1)}% NET=${f(s.netSumPct, 1)}% ($${f(s.netUsd, 0)}, fee $${f(s.feeUsd, 0)}) `
    + `hold med=${f(s.medianHoldMin, 0)}m avg=${f(s.avgHoldMin, 0)}m cepat<=15m=${f(s.quickClosePct, 1)}% reentry=${s.reentries} (${f(s.reentryPct, 1)}%) `
    + `maxDD=${f(s.maxDdPct, 1)}% best=${f(s.bestTradePct)}% top5%share=${f(s.top5SharePct, 0)}% >=1%:${s.bigMoves} SLavg=${f(s.avgSlPct, 3)}%`;
}

async function main() {
  const days = 730;
  const endTime = Date.now();
  const startTime = endTime - days * 864e5;
  const candles = {};
  for (const tf of Object.keys(TF_MINUTES)) {
    candles[tf] = await fetchCandles(tf, startTime, endTime);
    console.log(`[NinjaFvg] ${tf}: ${candles[tf].length} candle (${new Date(candles[tf][0].closeTime).toISOString().slice(0, 10)} s/d ${new Date(candles[tf][candles[tf].length - 1].closeTime).toISOString().slice(0, 10)})`);
  }

  console.log('\n=== BASELINE: Channel Breakout 5M (sistem Ninja lama) ===');
  const cb = runChannelBreakout(candles['5m']);
  for (const fee of FEES_RT) console.log(row(`CB 5M fee ${fee}%`, summarize(cb, 5, days, fee)));
  console.log(`  per tahun @0.10%: ${perYear(cb, candles['5m'], 0.10)}`);

  // Grid parameter -- minWidthPct (filter "FVG %" BigBeluga) & maxAgeBars. SEMUA kombinasi dicetak
  // (bukan cuma pemenang) biar kelihatan sensitivitasnya; jumlah trial dipakai buat Deflated Sharpe.
  const minWidths = [0.02, 0.05, 0.10, 0.20, 0.30];
  const maxAges = { '5m': [96, 288], '15m': [96, 288], '1h': [48, 168] };
  const results = [];
  for (const tf of Object.keys(TF_MINUTES)) {
    console.log(`\n=== FVG ${tf.toUpperCase()} ===`);
    for (const minWidthPct of minWidths) {
      for (const maxAgeBars of maxAges[tf]) {
        const opts = { minWidthPct, maxAgeBars, slMultiple: 2 };
        const tr = fvgTrades(candles[tf], tf, opts);
        if (tr.length < 10) { console.log(`FVG ${tf} w>=${minWidthPct}% age${maxAgeBars}: n=${tr.length} (terlalu sedikit)`); continue; }
        for (const fee of FEES_RT) {
          const s = summarize(tr, TF_MINUTES[tf], days, fee);
          console.log(row(`FVG ${tf} w>=${minWidthPct}% age${maxAgeBars} fee ${fee}%`, s));
          results.push({ tf, opts, fee, s, trades: tr });
        }
      }
    }
  }

  // Pemenang per TF @ fee 0,10% (taker realistis), berdasar NET % total -- lalu diuji ketat.
  const numTrials = results.length / FEES_RT.length + 1;
  const iters = Number(process.env.NINJA_PERM_ITER || 100);
  console.log(`\n=== VALIDASI KETAT (pemenang per TF @fee 0.10%, trials=${numTrials}, perm iter=${iters}) ===`);
  for (const tf of Object.keys(TF_MINUTES)) {
    const best = results.filter((r) => r.tf === tf && r.fee === 0.10).sort((a, b) => b.s.netSumPct - a.s.netSumPct)[0];
    if (!best) continue;
    const netReturns = best.trades.map((t) => t.grossPct - 0.10);
    const dsr = deflatedSharpeRatio(netReturns, numTrials);
    const perm = barPermutationTest(candles[tf], (cs) => fvgTrades(cs, tf, best.opts).map((t) => t.grossPct - 0.10), (r) => r.reduce((a, b) => a + b, 0), { iterations: iters });
    const half = Math.floor(best.trades.length / 2);
    const sumNet = (arr) => arr.reduce((a, t) => a + t.grossPct - 0.10, 0);
    console.log(`FVG ${tf} ${JSON.stringify(best.opts)}: NET=${f(best.s.netSumPct, 1)}% PFnet=${f(best.s.pfNet)} | DSR=${dsr.ok ? f(dsr.dsr * 100, 1) + '%' : dsr.error} `
      + `| bar-permutation p=${perm.ok ? f(perm.pValue, 3) : perm.error} (null mean ${perm.ok ? f(perm.nullMean, 1) : '-'}%) `
      + `| split-era: paruh1 ${f(sumNet(best.trades.slice(0, half)), 1)}% / paruh2 ${f(sumNet(best.trades.slice(half)), 1)}%`);
    console.log(`  per tahun @0.10%: ${perYear(best.trades, candles[tf], 0.10)}`);
    for (const fee of FEES_RT) console.log('  ' + row(`fee ${fee}%`, summarize(best.trades, TF_MINUTES[tf], days, fee)));
  }
}

if (require.main === module) main().catch((e) => { console.error('ERROR:', e.stack); process.exit(1); });

module.exports = { runChannelBreakout, fvgTrades, summarize };
