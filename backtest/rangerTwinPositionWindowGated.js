// Fase 3 riset MASTER_RULE (25 Sep 2026) -- ULANGI twin position (Trailing + leg kedua) DENGAN
// filter window bear/bull (BTC: siklus halving isBtcBearWindow; Emas: SMA200-setara 4H) -- arah
// entry di-gate PAS DETEKSI (long di luar bear window, short cuma pas bear window, SAMA persis
// pola runNyopetV2BacktestWindowGated), DAN posisi yang lagi floating dipaksa tutup (WINDOW_FLIP)
// kalau rezim ganti di tengah jalan -- kedua leg (Trailing MAUPUN leg kedua) kena aturan yang SAMA,
// gak ada yang diistimewakan.
//
// Kenapa fase ini perlu (temuan fase "tanpa window"): BTC leg kedua (baik Fixed-TP MAUPUN Opsi A
// partial+trailSMA) SAMA-SAMA lemah tanpa filter window -- itu MASUK AKAL krn edge sistem lama yang
// udah tervalidasi (PF 3.71, nyopetLatestFullReport.js) MEMANG dari filter rezimnya, bukan cuma
// exit-nya. Emas historisnya JUSTRU LEBIH JELEK pakai filter window (whipsaw SMA200) -- tetap
// dites di sini demi konsistensi/kejujuran metodologi, tapi hasil "tanpa window" (fixedTpRR 3:1,
// PF-net 1.59) kemungkinan besar tetap jadi rujukan utama Emas.

const { detectFlag, detectWedge } = require('../chartPatterns');
const { hitung: hitungExposure } = require('../calculator');
const { sma } = require('../technicalAnalysis');
const { simulateFixedTp, simulateOldStyleExit } = require('./rangerTwinPositionBacktest');
const { detectFvgSignalBoth, CANDLES_4H, CANDLES_4H_GOLD, makeBtcBearWindowFn, makeEmasBearWindowFn } = require('./nyopetChartPatternFvg');
const { TAKER_FEE_PERCENT } = require('./scoutTrailingInvalidationBacktest');

// Trailing invalidation VERSI window-gated -- inti matematikanya SAMA PERSIS masterRuleTrailingInvalidation.js
// (udah divalidasi 16/16 test case resmi dokumen), CUMA nambah 1 cek WINDOW_FLIP di awal tiap
// candle (prioritas paling tinggi, SEBELUM cek invalidation -- pola sama runNyopetV2BacktestWindowGated
// yang cek window_flip duluan tiap siklus). Duplikat SENGAJA (bukan reuse langsung) biar modul inti
// yang udah tervalidasi gak disentuh -- resiko regresi kalau ditambah cabang di sana.
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
    if (wrongSide) {
      return { exitPrice: c.close, exitIndex: i, exitTime: c.closeTime, reason: 'WINDOW_FLIP', extreme, initialInvalidation, finalInvalidation: invalidation, effectivePct };
    }
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

function runTwinPositionWindowGated(candles, opts = {}) {
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
    bearWindowFn, // WAJIB -- makeBtcBearWindowFn() / makeEmasBearWindowFn()
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
  console.log('=== Ranger (4-jam) TWIN POSITION -- DENGAN window bear/bull ===\n');

  console.log('--- BTC (Trailing + Opsi A partial-2R-trailSMA, window isBtcBearWindow) ---');
  const btc = runTwinPositionWindowGated(CANDLES_4H, { secondLegStyle: 'oldStyle', bearWindowFn: makeBtcBearWindowFn() });
  const bt = summarizeLeg(btc.trades, 'trailing');
  const bf = summarizeLeg(btc.trades, 'fixedTp');
  console.log(`  Trailing : n=${bt.n} win=${bt.winRatePct.toFixed(1)}% PF-net=${bt.pfNet.toFixed(2)} net=$${bt.totalPnlNet.toFixed(2)}`);
  console.log(`  Opsi A   : n=${bf.n} win=${bf.winRatePct.toFixed(1)}% PF-net=${bf.pfNet.toFixed(2)} net=$${bf.totalPnlNet.toFixed(2)}`);
  console.log(`  Gabungan $100 -> ${btc.capitalCombined.toFixed(2)} (Trail $${btc.capTrail.toFixed(2)} + OpsiA $${btc.capFixed.toFixed(2)}) | DD ${btc.maxDrawdownPct.toFixed(1)}%\n`);

  console.log('--- EMAS (Trailing + Fixed-TP 3:1, window SMA200-setara -- historisnya BIASANYA lebih jelek pakai ini) ---');
  const gold = runTwinPositionWindowGated(CANDLES_4H_GOLD, { fixedTpRR: 3, bearWindowFn: makeEmasBearWindowFn() });
  const gt = summarizeLeg(gold.trades, 'trailing');
  const gf = summarizeLeg(gold.trades, 'fixedTp');
  console.log(`  Trailing : n=${gt.n} win=${gt.winRatePct.toFixed(1)}% PF-net=${gt.pfNet.toFixed(2)} net=$${gt.totalPnlNet.toFixed(2)}`);
  console.log(`  Fixed-TP : n=${gf.n} win=${gf.winRatePct.toFixed(1)}% PF-net=${gf.pfNet.toFixed(2)} net=$${gf.totalPnlNet.toFixed(2)}`);
  console.log(`  Gabungan $100 -> ${gold.capitalCombined.toFixed(2)} (Trail $${gold.capTrail.toFixed(2)} + Fixed $${gold.capFixed.toFixed(2)}) | DD ${gold.maxDrawdownPct.toFixed(1)}%`);
}

module.exports = { runTwinPositionWindowGated, summarizeLeg };
if (require.main === module) { main().catch((e) => { console.error('ERROR:', e.message, e.stack); process.exit(1); }); }
