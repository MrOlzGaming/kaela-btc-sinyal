// Sniper (harian) TWIN POSITION -- DENGAN window bear/bull (25 Sep 2026, sekuel
// sniperTwinPositionBacktest.js) -- SAMA arsitektur rangerTwinPositionWindowGated.js (4H), pindah
// ke candle HARIAN + isBtcBearWindow (siklus halving) buat BTC. Emas TETAP long-only tanpa window
// (udah kuat sendiri, lihat sniperTwinPositionBacktest.js -- window historinya nyulitin Emas krn
// whipsaw SMA, gak perlu dites ulang di sini).

const { detectFlag, detectWedge } = require('../chartPatterns');
const { hitung: hitungExposure } = require('../calculator');
const { sma } = require('../technicalAnalysis');
const { isBtcBearWindow } = require('../halvingBearWindow');
const { simulateFixedTp, simulateOldStyleExit } = require('./rangerTwinPositionBacktest');
const { detectFvgSignalBoth } = require('./nyopetChartPatternFvg');
const { DAILY_BTC, summarizeLeg } = require('./sniperTwinPositionBacktest');
const { TAKER_FEE_PERCENT } = require('./scoutTrailingInvalidationBacktest');

function makeBtcBearWindowFnDaily() {
  return (candles, i) => isBtcBearWindow(new Date(candles[i].closeTime));
}

function simulateTrailingInvalidationWindowGated({ candles, entryIndex, entryPrice, direction, nyawaPct, feePercent, bearWindowFn }) {
  const effectivePct = nyawaPct + feePercent;
  const f = effectivePct / 100;
  let extreme = entryPrice;
  let invalidation = direction === 'buy' ? entryPrice * (1 - f) : entryPrice * (1 + f);
  const initialInvalidation = invalidation;
  for (let i = entryIndex + 1; i < candles.length; i++) {
    const c = candles[i];
    const bearNow = bearWindowFn(candles, i);
    const wrongSide = (direction === 'buy' && bearNow) || (direction === 'sell' && !bearNow);
    if (wrongSide) return { exitPrice: c.close, exitIndex: i, exitTime: c.closeTime, reason: 'WINDOW_FLIP', extreme, initialInvalidation, finalInvalidation: invalidation, effectivePct };
    if (c.high == null || c.low == null || c.high < c.low) continue;
    if (direction === 'buy') {
      if (c.low <= invalidation) return { exitPrice: invalidation, exitIndex: i, exitTime: c.closeTime, reason: 'INVALIDATED', extreme, initialInvalidation, finalInvalidation: invalidation, effectivePct };
      extreme = Math.max(extreme, c.high);
      const dynamic = extreme * (1 - f);
      if (dynamic > invalidation) invalidation = dynamic;
    } else {
      if (c.high >= invalidation) return { exitPrice: invalidation, exitIndex: i, exitTime: c.closeTime, reason: 'INVALIDATED', extreme, initialInvalidation, finalInvalidation: invalidation, effectivePct };
      extreme = Math.min(extreme, c.low);
      const dynamic = extreme * (1 + f);
      if (dynamic < invalidation) invalidation = dynamic;
    }
  }
  const last = candles[candles.length - 1];
  return { exitPrice: null, exitIndex: candles.length - 1, exitTime: last ? last.closeTime : null, reason: 'STILL_OPEN', extreme, initialInvalidation, finalInvalidation: invalidation, effectivePct };
}

function simulateFixedTpWindowGated({ candles, entryIndex, entryPrice, direction, sl, tp, bearWindowFn }) {
  for (let j = entryIndex + 1; j < candles.length; j++) {
    const c = candles[j];
    const bearNow = bearWindowFn(candles, j);
    const wrongSide = (direction === 'buy' && bearNow) || (direction === 'sell' && !bearNow);
    if (wrongSide) return { exitPrice: c.close, exitIndex: j, exitTime: c.closeTime, reason: 'WINDOW_FLIP' };
    if (c.high == null || c.low == null || c.high < c.low) continue;
    if (direction === 'buy') {
      if (c.low <= sl) return { exitPrice: sl, exitIndex: j, exitTime: c.closeTime, reason: 'SL' };
      if (c.high >= tp) return { exitPrice: tp, exitIndex: j, exitTime: c.closeTime, reason: 'TP' };
    } else {
      if (c.high >= sl) return { exitPrice: sl, exitIndex: j, exitTime: c.closeTime, reason: 'SL' };
      if (c.low <= tp) return { exitPrice: tp, exitIndex: j, exitTime: c.closeTime, reason: 'TP' };
    }
  }
  const last = candles[candles.length - 1];
  return { exitPrice: null, exitIndex: candles.length - 1, exitTime: last ? last.closeTime : null, reason: 'STILL_OPEN' };
}

function simulateOldStyleExitWindowGated({ candles, entryIndex, entryPrice, direction, sl, nyawaPct, partialRR = 2, trailSmaLen = 10, bearWindowFn }) {
  const partialTp = direction === 'buy' ? entryPrice + Math.abs(entryPrice - sl) * partialRR : entryPrice - Math.abs(entryPrice - sl) * partialRR;
  let partialDone = false, currentSl = sl, realizedPctFromPartial = 0;
  for (let j = entryIndex + 1; j < candles.length; j++) {
    const c = candles[j];
    const bearNow = bearWindowFn(candles, j);
    const wrongSide = (direction === 'buy' && bearNow) || (direction === 'sell' && !bearNow);
    if (wrongSide) {
      const movePctSigned = (c.close - entryPrice) / entryPrice * (direction === 'buy' ? 1 : -1) * 100;
      const remainingFrac = partialDone ? 0.5 : 1;
      return { totalPnlPct: realizedPctFromPartial + remainingFrac * movePctSigned, exitIndex: j, exitTime: c.closeTime, reason: 'WINDOW_FLIP' };
    }
    if (c.high == null || c.low == null || c.high < c.low) continue;
    if (!partialDone) {
      const hitSl = direction === 'buy' ? c.low <= currentSl : c.high >= currentSl;
      const hitPartial = direction === 'buy' ? c.high >= partialTp : c.low <= partialTp;
      if (hitSl) return { totalPnlPct: -nyawaPct, exitIndex: j, exitTime: c.closeTime, reason: 'SL' };
      if (hitPartial) {
        const rewardPct = Math.abs(partialTp - entryPrice) / entryPrice * 100;
        realizedPctFromPartial = 0.5 * rewardPct;
        partialDone = true; currentSl = entryPrice;
      }
      continue;
    }
    const trailSma = sma(candles.slice(0, j + 1).map((cc) => cc.close), trailSmaLen);
    const hitSl = direction === 'buy' ? c.low <= currentSl : c.high >= currentSl;
    const trendBroken = trailSma !== null && (direction === 'buy' ? c.close < trailSma : c.close > trailSma);
    if (hitSl || trendBroken) {
      const movePctSigned = (c.close - entryPrice) / entryPrice * (direction === 'buy' ? 1 : -1) * 100;
      return { totalPnlPct: realizedPctFromPartial + 0.5 * movePctSigned, exitIndex: j, exitTime: c.closeTime, reason: hitSl ? 'SL_BREAKEVEN' : 'TRAIL_EXIT' };
    }
  }
  const last = candles[candles.length - 1];
  return { totalPnlPct: null, exitIndex: candles.length - 1, exitTime: last ? last.closeTime : null, reason: 'STILL_OPEN' };
}

function legPnl(entryPrice, exitPrice, nilaiPosisi, direction, feePercent) {
  const movePct = (exitPrice - entryPrice) / entryPrice * (direction === 'buy' ? 1 : -1) * 100;
  const gross = nilaiPosisi * (movePct / 100);
  const roundTripFee = nilaiPosisi * (feePercent * 2 / 100);
  return { gross, net: gross - roundTripFee, roundTripFee };
}

function runSniperTwinPositionWindowGated(candles, opts = {}) {
  const {
    warmupCandles = 260,
    poleLookbackRange = [5, 20], poleMinMovePct = 15, flagLookbackRange = [3, 15], flagMaxRangePct = 8,
    wedgeLookbackRange = [15, 40], wedgeMinTouches = 2, wedgeConvergenceRatio = 0.65,
    usePatterns = ['flag', 'wedge', 'fvg'],
    slBufferPct = 0.5, fvgTrendSmaLen = 200,
    startCapital = 100, modalDivisor = 5, capitalSplit = 0.5, fixedTpRR = 3,
    maxMarginPct = 20, maxNyawaPct = null,
    feePercent = TAKER_FEE_PERCENT,
    secondLegStyle = 'oldStyle', partialRR = 2, trailSmaLen = 10,
    bearWindowFn,
  } = opts;

  let capTrail = startCapital * capitalSplit;
  let capFixed = startCapital * (1 - capitalSplit);
  const trades = [];
  const capitalSeries = [{ time: candles[warmupCandles] ? candles[warmupCandles].closeTime : 0, capital: capTrail + capFixed }];
  let stillOpenAtEnd = null;

  for (let i = warmupCandles; i < candles.length; i++) {
    const today = candles[i];
    const bearNow = bearWindowFn(candles, i);
    const lastPrice = today.close;
    let direction = null, sl = null, patternType = null;

    if (usePatterns.includes('flag')) {
      const flag = detectFlag(candles, i, { poleLookbackRange, poleMinMovePct, flagLookbackRange, flagMaxRangePct });
      if (!bearNow && flag && flag.type === 'bull' && lastPrice > flag.flagHigh) { direction = 'buy'; sl = flag.flagLow * (1 - slBufferPct / 100); patternType = 'flag_bull'; }
      else if (bearNow && flag && flag.type === 'bear' && lastPrice < flag.flagLow) { direction = 'sell'; sl = flag.flagHigh * (1 + slBufferPct / 100); patternType = 'flag_bear'; }
    }
    if (!direction && usePatterns.includes('wedge')) {
      const wedge = detectWedge(candles, i, { wedgeLookbackRange, minTouches: wedgeMinTouches, convergenceRatio: wedgeConvergenceRatio });
      if (bearNow && wedge && wedge.type === 'rising' && lastPrice < wedge.projectedSupport) { direction = 'sell'; sl = wedge.recentSwingHigh * (1 + slBufferPct / 100); patternType = 'wedge_rising'; }
      else if (!bearNow && wedge && wedge.type === 'falling' && lastPrice > wedge.projectedResistance) { direction = 'buy'; sl = wedge.recentSwingLow * (1 - slBufferPct / 100); patternType = 'wedge_falling'; }
    }
    if (!direction && usePatterns.includes('fvg')) {
      const fvgSig = detectFvgSignalBoth(candles, i, { slBufferPct, trendSmaLen: fvgTrendSmaLen, allowShort: true });
      if (fvgSig && ((fvgSig.direction === 'buy' && !bearNow) || (fvgSig.direction === 'sell' && bearNow))) {
        direction = fvgSig.direction; sl = fvgSig.sl; patternType = fvgSig.patternType;
      }
    }
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

    const trailResult = simulateTrailingInvalidationWindowGated({ candles, entryIndex: i, entryPrice: lastPrice, direction, nyawaPct, feePercent, bearWindowFn });
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
        const oldResult = simulateOldStyleExitWindowGated({ candles, entryIndex: i, entryPrice: lastPrice, direction, sl, nyawaPct, partialRR, trailSmaLen, bearWindowFn });
        let totalPnlPct = oldResult.totalPnlPct, exitTime = oldResult.exitTime, reason = oldResult.reason, markedToMarket = false;
        if (oldResult.reason === 'STILL_OPEN') { totalPnlPct = 0; exitTime = lastC.closeTime; markedToMarket = true; }
        const gross = fixedSizing.nilaiPosisi * (totalPnlPct / 100);
        const roundTripFee = fixedSizing.nilaiPosisi * (feePercent * 2 / 100);
        const net = gross - roundTripFee;
        capFixed = Math.max(0, capFixed + net);
        fixedEntry = { gross, net, roundTripFee, exitPrice: null, exitTime, reason, markedToMarket, nilaiPosisi: fixedSizing.nilaiPosisi };
      } else {
        const tpPrice = direction === 'buy' ? lastPrice + riskDistance * fixedTpRR : lastPrice - riskDistance * fixedTpRR;
        const fixedResult = simulateFixedTpWindowGated({ candles, entryIndex: i, entryPrice: lastPrice, direction, sl, tp: tpPrice, bearWindowFn });
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

async function main() {
  console.log('=== Sniper (harian) TWIN POSITION -- DENGAN window bear/bull (BTC, Opsi A) ===\n');
  const btc = runSniperTwinPositionWindowGated(DAILY_BTC, { secondLegStyle: 'oldStyle', bearWindowFn: makeBtcBearWindowFnDaily() });
  const t = summarizeLeg(btc.trades, 'trailing');
  const f = summarizeLeg(btc.trades, 'fixedTp');
  console.log(`  Trailing : n=${t.n} win=${t.winRatePct.toFixed(1)}% PF-net=${t.pfNet.toFixed(2)} net=$${t.totalPnlNet.toFixed(2)}`);
  console.log(`  Opsi A   : n=${f.n} win=${f.winRatePct.toFixed(1)}% PF-net=${f.pfNet.toFixed(2)} net=$${f.totalPnlNet.toFixed(2)}`);
  console.log(`  Gabungan $100 -> ${btc.capitalCombined.toFixed(2)} (Trail $${btc.capTrail.toFixed(2)} + OpsiA $${btc.capFixed.toFixed(2)}) | DD ${btc.maxDrawdownPct.toFixed(1)}%`);

  const half = Math.floor(btc.trades.length / 2);
  const era1 = btc.trades.slice(0, half), era2 = btc.trades.slice(half);
  console.log(`\n  Split-era: Era1 (n=${era1.length}, ${new Date(era1[0].entryTime).toISOString().slice(0,10)}->${new Date(era1[era1.length-1].entryTime).toISOString().slice(0,10)}): Trail PF=${summarizeLeg(era1,'trailing').pfNet.toFixed(2)} OpsiA PF=${summarizeLeg(era1,'fixedTp').pfNet.toFixed(2)}`);
  console.log(`             Era2 (n=${era2.length}, ${new Date(era2[0].entryTime).toISOString().slice(0,10)}->${new Date(era2[era2.length-1].entryTime).toISOString().slice(0,10)}): Trail PF=${summarizeLeg(era2,'trailing').pfNet.toFixed(2)} OpsiA PF=${summarizeLeg(era2,'fixedTp').pfNet.toFixed(2)}`);
}

module.exports = { runSniperTwinPositionWindowGated, makeBtcBearWindowFnDaily };
if (require.main === module) { main().catch((e) => { console.error('ERROR:', e.message, e.stack); process.exit(1); }); }
