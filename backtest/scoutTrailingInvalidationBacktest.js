// Riset "logika dulu" MASTER_RULE_DYNAMIC_CANDLE_INVALIDATION_v3_4.md (25 Sep 2026, dokumen Olan)
// -- dites di sistem 4-jam (bekas nama "Nyopet", DIGANTI -- lihat memori/chat: "Scout", pattern
// breakout+FVG timeframe 4H, sama metodenya kayak Sniper cuma timeframe lebih rendah).
//
// TAHAP INI (permintaan eksplisit Olan): "coba dulu tanpa window bear/bull, hajar rata... fokus ke
// logikanya dulu" -- jadi TANPA gerbang rezim (beda dari runNyopetV2BacktestWindowGated), long+short
// bebas nurut sinyal doang. Entry-detection REUSE 100% dari nyopetChartPatternFvg.js (flag/wedge/
// FVG, SATU sumber kebenaran sama backtest lama) -- exit DIGANTI ke `masterRuleTrailingInvalidation.js`
// (HIGH/LOW candle ratchet + Nyawa+fee), BUKAN partial-2R+trail-SMA yang lama.
//
// Modal 50/50 twin-leg (Bagian 19.5 dokumen) BELUM disimulasikan di sini -- fase ini murni
// bandingin GAYA EXIT (lama vs MASTER_RULE) di FULL capital yang SAMA, biar perbandingan bersih
// (skala modal sama, SATU variabel yang beda: cara keluar). Kalau logikanya kebukti bagus, twin-leg
// 50/50 + lintas-exchange baru disusun di iterasi berikutnya (butuh keputusan pasangan exchange).

const fs = require('fs');
const path = require('path');
const { detectFlag, detectWedge } = require('../chartPatterns');
const { hitung: hitungExposure } = require('../calculator');
const { simulateTrailingInvalidation, FALLBACK_FEE_PERCENT } = require('../masterRuleTrailingInvalidation');
const { detectFvgSignalBoth, CANDLES_4H, CANDLES_4H_GOLD } = require('./rangerChartPatternFvg');

// Binance Futures base/VIP0 taker (dipakai exit MARKET order -- Bagian 5 dokumen: "order akan
// jadi taker -> pakai taker_fee"). SAMA tier yang udah dipakai asumsi Channel Breakout/BingX di
// sesi ini (0.05% taker) -- Binance base tier IDENTIK. `fee_source` di sini = OFFICIAL_DOCS
// (Prioritas 3 dokumen), BUKAN DEFAULT_FALLBACK -- kita TAU tier-nya, bukan nebak.
const TAKER_FEE_PERCENT = 0.05;

function runScoutTrailingInvalidationNoWindow(candles, opts = {}) {
  const {
    warmupCandles = 260,
    poleLookbackRange = [5, 20], poleMinMovePct = 15, flagLookbackRange = [3, 15], flagMaxRangePct = 8,
    wedgeLookbackRange = [15, 40], wedgeMinTouches = 2, wedgeConvergenceRatio = 0.65,
    usePatterns = ['flag', 'wedge', 'fvg'],
    slBufferPct = 0.5, fvgTrendSmaLen = 200,
    startCapital = 100, modalDivisor = 5,
    maxMarginPct = 20, maxNyawaPct = null,
    feePercent = TAKER_FEE_PERCENT, // dipakai DUA kali: buffer invalidation (Bagian 6) DAN fee round-trip (Prompt Awal v3.4)
  } = opts;
  const trades = [];
  let capital = startCapital;
  const capitalSeries = [{ time: candles[warmupCandles] ? candles[warmupCandles].closeTime : 0, capital }];
  let stillOpenAtEnd = null;

  for (let i = warmupCandles; i < candles.length; i++) {
    const today = candles[i];
    const lastPrice = today.close;
    let direction = null, sl = null, patternType = null;

    if (usePatterns.includes('flag')) {
      const flag = detectFlag(candles, i, { poleLookbackRange, poleMinMovePct, flagLookbackRange, flagMaxRangePct });
      if (flag && flag.type === 'bull' && lastPrice > flag.flagHigh) { direction = 'buy'; sl = flag.flagLow * (1 - slBufferPct / 100); patternType = 'flag_bull'; }
      else if (flag && flag.type === 'bear' && lastPrice < flag.flagLow) { direction = 'sell'; sl = flag.flagHigh * (1 + slBufferPct / 100); patternType = 'flag_bear'; }
    }
    if (!direction && usePatterns.includes('wedge')) {
      const wedge = detectWedge(candles, i, { wedgeLookbackRange, minTouches: wedgeMinTouches, convergenceRatio: wedgeConvergenceRatio });
      if (wedge && wedge.type === 'rising' && lastPrice < wedge.projectedSupport) { direction = 'sell'; sl = wedge.recentSwingHigh * (1 + slBufferPct / 100); patternType = 'wedge_rising'; }
      else if (wedge && wedge.type === 'falling' && lastPrice > wedge.projectedResistance) { direction = 'buy'; sl = wedge.recentSwingLow * (1 - slBufferPct / 100); patternType = 'wedge_falling'; }
    }
    if (!direction && usePatterns.includes('fvg')) {
      const fvgSig = detectFvgSignalBoth(candles, i, { slBufferPct, trendSmaLen: fvgTrendSmaLen, allowShort: true });
      if (fvgSig) { direction = fvgSig.direction; sl = fvgSig.sl; patternType = fvgSig.patternType; }
    }
    if (!direction) continue;

    const riskDistance = Math.abs(lastPrice - sl);
    if (riskDistance === 0) continue;
    const nyawaPct = riskDistance / lastPrice * 100;
    if (maxNyawaPct !== null && nyawaPct > maxNyawaPct) continue;

    // "Cheat exposure" -- SAMA PERSIS runNyopetV2Backtest (modal/5), biar perbandingan lama-vs-baru
    // apple-to-apple (satu-satunya beda cuma GAYA EXIT, bukan sizing).
    const sizingModal = capital / modalDivisor;
    const { nilaiPosisi, margin } = hitungExposure({ modal: sizingModal, entry: lastPrice, stopLoss: sl, direction });
    if (margin > capital) continue;
    const marginPct = margin / capital * 100;
    if (marginPct > maxMarginPct) continue;

    // Simulasi PENUH sekali panggil (bukan re-simulasi per-candle) -- lebih efisien (O(n) total,
    // bukan O(n^2)) DAN lebih sederhana: `simulateTrailingInvalidation` sendiri yang jalanin loop
    // sampai ke-invalidasi atau data abis.
    const result = simulateTrailingInvalidation({ candles, entryIndex: i, entryPrice: lastPrice, direction, nyawaPct, feePercent });

    if (result.reason === 'STILL_OPEN') {
      stillOpenAtEnd = { direction, entryPrice: lastPrice, entryTime: today.closeTime, patternType, nyawaPct, finalInvalidation: result.finalInvalidation };
      break; // data abis, posisi terakhir belum ke-invalidasi -- gak ada sinyal baru lagi buat dicek
    }

    const movePctSigned = (result.exitPrice - lastPrice) / lastPrice * (direction === 'buy' ? 1 : -1) * 100;
    const pnlGross = nilaiPosisi * (movePctSigned / 100);
    // Fee round-trip (Prompt Awal v3.4, WAJIB dihitung terpisah dari buffer invalidation) -- entry
    // MARKET (breakout, sama kayak buffer) + exit MARKET (invalidation market-close) = 2x taker.
    const roundTripFeeUsd = nilaiPosisi * (feePercent * 2 / 100);
    const pnlNet = pnlGross - roundTripFeeUsd;
    capital = Math.max(0, capital + pnlNet);

    trades.push({
      direction, entryPrice: lastPrice, exitPrice: result.exitPrice, patternType, nyawaPct,
      effectivePct: result.effectivePct, nilaiPosisi, margin, marginPct,
      pnlGross, roundTripFeeUsd, pnlNet, entryTime: today.closeTime, exitTime: result.exitTime,
    });
    capitalSeries.push({ time: result.exitTime, capital });

    i = result.exitIndex; // lompat loop ke abis-exit -- next iterasi (i++) mulai cari sinyal lagi TEPAT setelahnya
  }

  let peak = -Infinity, maxDrawdownPct = 0;
  for (const pt of capitalSeries) { peak = Math.max(peak, pt.capital); maxDrawdownPct = Math.max(maxDrawdownPct, (peak - pt.capital) / peak * 100); }
  return { trades, finalCapital: capital, maxDrawdownPct, capitalSeries, stillOpenAtEnd };
}

function summarize(trades, label) {
  const n = trades.length;
  if (n === 0) return { label, n: 0 };
  const wins = trades.filter((t) => t.pnlNet >= 0);
  const losses = trades.filter((t) => t.pnlNet < 0);
  const grossProfit = wins.reduce((s, t) => s + t.pnlGross, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnlGross, 0));
  const netProfit = wins.reduce((s, t) => s + t.pnlNet, 0);
  const netLoss = Math.abs(losses.reduce((s, t) => s + t.pnlNet, 0));
  const totalFees = trades.reduce((s, t) => s + t.roundTripFeeUsd, 0);
  return {
    label, n, winRatePct: (wins.length / n) * 100,
    pfGross: grossLoss > 0 ? grossProfit / grossLoss : Infinity,
    pfNet: netLoss > 0 ? netProfit / netLoss : Infinity,
    totalPnlGross: trades.reduce((s, t) => s + t.pnlGross, 0),
    totalPnlNet: trades.reduce((s, t) => s + t.pnlNet, 0),
    totalFees,
    long: trades.filter((t) => t.direction === 'buy').length,
    short: trades.filter((t) => t.direction === 'sell').length,
  };
}

async function main() {
  console.log('=== Scout (4-jam) Trailing Invalidation -- TANPA window bear/bull (fokus logika) ===\n');
  console.log(`Fee: ${TAKER_FEE_PERCENT}% taker per sisi (round-trip ${TAKER_FEE_PERCENT * 2}%), sumber OFFICIAL_DOCS (Binance base tier).\n`);

  for (const [assetLabel, candles] of [['BTC', CANDLES_4H], ['EMAS (PAXG)', CANDLES_4H_GOLD]]) {
    if (!candles) { console.log(`--- ${assetLabel}: data candle gak ada, skip ---\n`); continue; }
    const result = runScoutTrailingInvalidationNoWindow(candles);
    const s = summarize(result.trades, assetLabel);
    console.log(`--- ${assetLabel} (${candles.length} candle 4H) ---`);
    if (s.n === 0) { console.log('  Gak ada trade sama sekali.\n'); continue; }
    console.log(`  Trades: ${s.n} (long ${s.long} / short ${s.short})`);
    console.log(`  Win rate: ${s.winRatePct.toFixed(1)}%`);
    console.log(`  Profit Factor GROSS: ${s.pfGross.toFixed(2)} | NET (setelah fee): ${s.pfNet.toFixed(2)}`);
    console.log(`  Total PnL GROSS: $${s.totalPnlGross.toFixed(2)} | NET: $${s.totalPnlNet.toFixed(2)} | Total fee terpotong: $${s.totalFees.toFixed(2)}`);
    console.log(`  Final capital (start $100): $${result.finalCapital.toFixed(2)}`);
    console.log(`  Max drawdown: ${result.maxDrawdownPct.toFixed(1)}%`);
    if (result.stillOpenAtEnd) {
      console.log(`  ⚠️ 1 posisi TERAKHIR masih floating pas data abis (${result.stillOpenAtEnd.direction} @ ${result.stillOpenAtEnd.entryPrice.toFixed(2)}, ${result.stillOpenAtEnd.patternType}) -- gak dihitung ke stats di atas (bukan trade closed).`);
    }
    console.log();
  }
}

module.exports = { runScoutTrailingInvalidationNoWindow, summarize, TAKER_FEE_PERCENT };
if (require.main === module) { main().catch((e) => { console.error('ERROR:', e.message, e.stack); process.exit(1); }); }
