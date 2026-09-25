// Fase riset MASTER_RULE buat SNIPER (harian) -- SAMA PERSIS arsitektur rangerTwinPositionBacktest.js
// (25 Sep 2026, "nyebar ke semua... sniper, pattern breakout fvg high time frame twin position
// yang pake tp target dan trailing"), cuma beda candle (DAILY, bukan 4H) dan sumber pattern
// (chartPatterns.js langsung -- SATU sumber kebenaran sama live Sniper, bukan reimplementasi).
// Entry: flag/wedge (chartPatterns.js) + FVG (detectFvgSignalBoth, reuse dari nyopetChartPatternFvg.js
// -- generic ke candle array manapun, gak spesifik 4H). Exit: SAMA 2 leg (Trailing MASTER_RULE +
// leg kedua fixedTp/oldStyle) via masterRuleTrailingInvalidation.js + simulateFixedTp/
// simulateOldStyleExit yang di-reuse dari rangerTwinPositionBacktest.js (BUKAN ditulis ulang).
//
// TAHAP INI: TANPA window bear/bull dulu (permintaan Olan, fokus logika). BTC + Emas (candle daily
// Emas balik 2001, jauh lebih panjang dari versi 4H yang cuma mulai 2020).

const { detectFlag, detectWedge } = require('../chartPatterns');
const { hitung: hitungExposure } = require('../calculator');
const { simulateTrailingInvalidation } = require('../masterRuleTrailingInvalidation');
const { simulateFixedTp, simulateOldStyleExit } = require('./rangerTwinPositionBacktest');
const { detectFvgSignalBoth } = require('./nyopetChartPatternFvg');
const { TAKER_FEE_PERCENT } = require('./scoutTrailingInvalidationBacktest');
const fs = require('fs');
const path = require('path');

const DAILY_BTC = JSON.parse(fs.readFileSync(path.join(__dirname, 'daily-cache.json'), 'utf8'));
const DAILY_GOLD = JSON.parse(fs.readFileSync(path.join(__dirname, 'gold-daily-cache.json'), 'utf8'));

function legPnl(entryPrice, exitPrice, nilaiPosisi, direction, feePercent) {
  const movePct = (exitPrice - entryPrice) / entryPrice * (direction === 'buy' ? 1 : -1) * 100;
  const gross = nilaiPosisi * (movePct / 100);
  const roundTripFee = nilaiPosisi * (feePercent * 2 / 100);
  return { gross, net: gross - roundTripFee, roundTripFee };
}

function runSniperTwinPosition(candles, opts = {}) {
  const {
    warmupCandles = 260,
    poleLookbackRange = [5, 20], poleMinMovePct = 15, flagLookbackRange = [3, 15], flagMaxRangePct = 8,
    wedgeLookbackRange = [15, 40], wedgeMinTouches = 2, wedgeConvergenceRatio = 0.65,
    usePatterns = ['flag', 'wedge', 'fvg'],
    slBufferPct = 0.5, fvgTrendSmaLen = 200,
    startCapital = 100, modalDivisor = 5, capitalSplit = 0.5, fixedTpRR = 3,
    maxMarginPct = 20, maxNyawaPct = null,
    feePercent = TAKER_FEE_PERCENT,
    secondLegStyle = 'fixedTp', partialRR = 2, trailSmaLen = 10,
    longOnly = false,
  } = opts;

  let capTrail = startCapital * capitalSplit;
  let capFixed = startCapital * (1 - capitalSplit);
  const trades = [];
  const capitalSeries = [{ time: candles[warmupCandles] ? candles[warmupCandles].closeTime : 0, capital: capTrail + capFixed }];
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
      const fvgSig = detectFvgSignalBoth(candles, i, { slBufferPct, trendSmaLen: fvgTrendSmaLen, allowShort: !longOnly });
      if (fvgSig) { direction = fvgSig.direction; sl = fvgSig.sl; patternType = fvgSig.patternType; }
    }
    if (longOnly && direction === 'sell') { direction = null; sl = null; patternType = null; }
    if (!direction) continue;

    const riskDistance = Math.abs(lastPrice - sl);
    if (riskDistance === 0) continue;
    const nyawaPct = riskDistance / lastPrice * 100;
    if (maxNyawaPct !== null && nyawaPct > maxNyawaPct) continue;

    const trailSizing = hitungExposure({ modal: capTrail / modalDivisor, entry: lastPrice, stopLoss: sl, direction });
    const trailOk = trailSizing.margin <= capTrail && (trailSizing.margin / capTrail * 100) <= maxMarginPct;
    if (!trailOk) continue;

    const fixedSizing = hitungExposure({ modal: capFixed / modalDivisor, entry: lastPrice, stopLoss: sl, direction });
    const fixedOk = fixedSizing.margin <= capFixed && (fixedSizing.margin / capFixed * 100) <= maxMarginPct;

    const trailResult = simulateTrailingInvalidation({ candles, entryIndex: i, entryPrice: lastPrice, direction, nyawaPct, feePercent });
    if (trailResult.reason === 'STILL_OPEN') {
      stillOpenAtEnd = { direction, entryPrice: lastPrice, patternType, entryTime: today.closeTime };
      break;
    }
    const trailPnl = legPnl(lastPrice, trailResult.exitPrice, trailSizing.nilaiPosisi, direction, feePercent);
    capTrail = Math.max(0, capTrail + trailPnl.net);

    let fixedEntry = null;
    if (fixedOk) {
      const lastC = candles[candles.length - 1];
      if (secondLegStyle === 'oldStyle') {
        const oldResult = simulateOldStyleExit({ candles, entryIndex: i, entryPrice: lastPrice, direction, sl, nyawaPct, partialRR, trailSmaLen });
        let totalPnlPct = oldResult.totalPnlPct, exitTime = oldResult.exitTime, reason = oldResult.reason, markedToMarket = false;
        if (oldResult.reason === 'STILL_OPEN') { totalPnlPct = 0; exitTime = lastC.closeTime; markedToMarket = true; }
        const gross = fixedSizing.nilaiPosisi * (totalPnlPct / 100);
        const roundTripFee = fixedSizing.nilaiPosisi * (feePercent * 2 / 100);
        const net = gross - roundTripFee;
        capFixed = Math.max(0, capFixed + net);
        fixedEntry = { gross, net, roundTripFee, exitPrice: null, exitTime, reason, markedToMarket, nilaiPosisi: fixedSizing.nilaiPosisi };
      } else {
        const tpPrice = direction === 'buy' ? lastPrice + riskDistance * fixedTpRR : lastPrice - riskDistance * fixedTpRR;
        const fixedResult = simulateFixedTp({ candles, entryIndex: i, entryPrice: lastPrice, direction, sl, tp: tpPrice });
        let exitPrice = fixedResult.exitPrice, exitTime = fixedResult.exitTime, reason = fixedResult.reason, markedToMarket = false;
        if (fixedResult.reason === 'STILL_OPEN') { exitPrice = lastC.close; exitTime = lastC.closeTime; markedToMarket = true; }
        const fixedPnl = legPnl(lastPrice, exitPrice, fixedSizing.nilaiPosisi, direction, feePercent);
        capFixed = Math.max(0, capFixed + fixedPnl.net);
        fixedEntry = { ...fixedPnl, exitPrice, exitTime, reason, markedToMarket, nilaiPosisi: fixedSizing.nilaiPosisi };
      }
    }

    trades.push({
      twinGroupId: `${today.closeTime}-${direction}`, direction, patternType, entryPrice: lastPrice, nyawaPct, entryTime: today.closeTime,
      trailing: { ...trailPnl, exitPrice: trailResult.exitPrice, exitTime: trailResult.exitTime, reason: trailResult.reason, effectivePct: trailResult.effectivePct, nilaiPosisi: trailSizing.nilaiPosisi },
      fixedTp: fixedEntry, twinIncomplete: fixedEntry === null,
    });
    capitalSeries.push({ time: trailResult.exitTime, capital: capTrail + capFixed });
    i = trailResult.exitIndex;
  }

  let peak = -Infinity, maxDrawdownPct = 0;
  for (const pt of capitalSeries) { peak = Math.max(peak, pt.capital); maxDrawdownPct = Math.max(maxDrawdownPct, (peak - pt.capital) / peak * 100); }
  return { trades, capTrail, capFixed, capitalCombined: capTrail + capFixed, capitalSeries, maxDrawdownPct, stillOpenAtEnd };
}

function summarizeLeg(trades, legKey) {
  const legs = trades.map((t) => t[legKey]).filter((l) => l != null);
  const n = legs.length;
  if (n === 0) return { n: 0, winRatePct: 0, pfNet: 0, totalPnlNet: 0 };
  const wins = legs.filter((l) => l.net >= 0);
  const losses = legs.filter((l) => l.net < 0);
  const grossProfit = wins.reduce((s, l) => s + l.gross, 0);
  const grossLoss = Math.abs(losses.reduce((s, l) => s + l.gross, 0));
  const netProfit = wins.reduce((s, l) => s + l.net, 0);
  const netLoss = Math.abs(losses.reduce((s, l) => s + l.net, 0));
  return {
    n, winRatePct: (wins.length / n) * 100,
    pfGross: grossLoss > 0 ? grossProfit / grossLoss : Infinity,
    pfNet: netLoss > 0 ? netProfit / netLoss : Infinity,
    totalPnlNet: legs.reduce((s, l) => s + l.net, 0),
  };
}

async function main() {
  console.log('=== Sniper (harian) TWIN POSITION -- TANPA window bear/bull (fokus logika) ===\n');
  for (const [label, candles, opts] of [
    ['BTC', DAILY_BTC, { fixedTpRR: 3 }],
    ['EMAS (long-only)', DAILY_GOLD, { fixedTpRR: 3, longOnly: true }],
  ]) {
    const result = runSniperTwinPosition(candles, opts);
    const t = summarizeLeg(result.trades, 'trailing');
    const f = summarizeLeg(result.trades, 'fixedTp');
    console.log(`--- ${label} (${result.trades.length} pasang, ${candles.length} candle harian) ---`);
    console.log(`  Trailing : n=${t.n} win=${t.winRatePct.toFixed(1)}% PF-net=${t.pfNet.toFixed(2)} net=$${t.totalPnlNet.toFixed(2)}`);
    console.log(`  Fixed-TP : n=${f.n} win=${f.winRatePct.toFixed(1)}% PF-net=${f.pfNet.toFixed(2)} net=$${f.totalPnlNet.toFixed(2)}`);
    console.log(`  Gabungan $100 -> ${result.capitalCombined.toFixed(2)} (Trail $${result.capTrail.toFixed(2)} + Fixed $${result.capFixed.toFixed(2)}) | DD ${result.maxDrawdownPct.toFixed(1)}%`);
    if (result.stillOpenAtEnd) console.log(`  ⚠️ 1 posisi terakhir masih floating pas data abis.`);
    console.log();
  }
}

module.exports = { runSniperTwinPosition, summarizeLeg, DAILY_BTC, DAILY_GOLD };
if (require.main === module) { main().catch((e) => { console.error('ERROR:', e.message, e.stack); process.exit(1); }); }
