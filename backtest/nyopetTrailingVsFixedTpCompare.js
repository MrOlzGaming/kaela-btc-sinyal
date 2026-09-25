// nyopetTrailingVsFixedTpCompare.js (23 Sep 2026) -- Olan: "aku pengen lihat backtest fvg dan
// pola dengan trailing stop.. trailing stop ini keunggulan banget.. misal harga naik dah kasih
// profit 1x, harga balik arah belum sempat TP, tapi dengan trailing stop ceritanya beda". Bikin
// PERBANDINGAN LANGSUNG: SAMA PERSIS entry/sizing/window-gating kayak runNyopetV2BacktestWindowGated
// (live), CUMA exit-nya diganti simple TP TETAP (di titik R yang SAMA persis partial normal
// trigger) -- biar isolasi variabel TUNGGAL "exit mechanism", apples-to-apples.
//
// SENGAJA nulis loop terpisah (BUKAN nambah flag ke fungsi live-matching yang udah divalidasi) --
// gak mau resiko ngerusak fungsi referensi yang dipakai live, riset eksperimental taro file sendiri.

const { sma } = require('../technicalAnalysis');
const { hitung: hitungExposure } = require('../calculator');
const { detectFlag, detectWedge } = require('../chartPatterns');
const { CANDLES_4H, RESCALED_4H, makeBtcBearWindowFn, detectFvgSignalBoth, summarize, byYear } = require('./rangerChartPatternFvg');

function runSimpleTpVariant(candles, opts) {
  const {
    warmupCandles, poleLookbackRange, poleMinMovePct, flagLookbackRange, flagMaxRangePct,
    wedgeLookbackRange, wedgeMinTouches, wedgeConvergenceRatio, fvgTrendSmaLen,
    slBufferPct = 0.5, tpRMultiple = 2, modalDivisor = 5, maxMarginPct = 20,
    startCapital = 100, bearWindowFn, forceCloseOnFlip = true, halfShortExposure = true,
  } = opts;
  const trades = [];
  let openPos = null;
  let capital = startCapital;
  const capitalSeries = [{ time: candles[warmupCandles] ? candles[warmupCandles].closeTime : 0, capital }];

  for (let i = warmupCandles; i < candles.length; i++) {
    const today = candles[i];
    const bearNow = bearWindowFn(candles, i);

    if (openPos) {
      const wrongSide = forceCloseOnFlip && ((openPos.direction === 'buy' && bearNow) || (openPos.direction === 'sell' && !bearNow));
      if (wrongSide) {
        const movePctSigned = (today.close - openPos.entryPrice) / openPos.entryPrice * (openPos.direction === 'buy' ? 1 : -1) * 100;
        const pnlUsd = openPos.nilaiPosisi * (movePctSigned / 100);
        capital = Math.max(0, capital + pnlUsd);
        const riskPct = Math.abs(openPos.entryPrice - openPos.sl) / openPos.entryPrice * 100;
        trades.push({ ...openPos, exitReason: 'WINDOW_FLIP', rMultiple: riskPct > 0 ? (pnlUsd / openPos.nilaiPosisi * 100) / riskPct : 0, pnlUsd, exitTime: today.closeTime });
        capitalSeries.push({ time: today.closeTime, capital }); openPos = null;
        continue;
      }
      const hitSl = openPos.direction === 'buy' ? today.low <= openPos.sl : today.high >= openPos.sl;
      const hitTp = openPos.direction === 'buy' ? today.high >= openPos.tp : today.low <= openPos.tp;
      if (hitSl) {
        capital = Math.max(0, capital - openPos.lossAtSl);
        trades.push({ ...openPos, exitReason: 'SL', rMultiple: -1, pnlUsd: -openPos.lossAtSl, exitTime: today.closeTime });
        capitalSeries.push({ time: today.closeTime, capital }); openPos = null;
      } else if (hitTp) {
        const profitUsd = openPos.lossAtSl * tpRMultiple; // TP di jarak tpRMultiple x jarak SL -- SAMA persis titik partial normal trigger
        capital += profitUsd;
        trades.push({ ...openPos, exitReason: 'TP', rMultiple: tpRMultiple, pnlUsd: profitUsd, exitTime: today.closeTime });
        capitalSeries.push({ time: today.closeTime, capital }); openPos = null;
      }
      continue;
    }

    const lastPrice = today.close;
    let direction = null, sl = null, patternType = null;
    const flag = detectFlag(candles, i, { poleLookbackRange, poleMinMovePct, flagLookbackRange, flagMaxRangePct });
    if (!bearNow && flag && flag.type === 'bull' && lastPrice > flag.flagHigh) { direction = 'buy'; sl = flag.flagLow * (1 - slBufferPct / 100); patternType = 'flag_bull'; }
    else if (bearNow && flag && flag.type === 'bear' && lastPrice < flag.flagLow) { direction = 'sell'; sl = flag.flagHigh * (1 + slBufferPct / 100); patternType = 'flag_bear'; }
    if (!direction) {
      const wedge = detectWedge(candles, i, { wedgeLookbackRange, minTouches: wedgeMinTouches, convergenceRatio: wedgeConvergenceRatio });
      if (bearNow && wedge && wedge.type === 'rising' && lastPrice < wedge.projectedSupport) { direction = 'sell'; sl = wedge.recentSwingHigh * (1 + slBufferPct / 100); patternType = 'wedge_rising'; }
      else if (!bearNow && wedge && wedge.type === 'falling' && lastPrice > wedge.projectedResistance) { direction = 'buy'; sl = wedge.recentSwingLow * (1 - slBufferPct / 100); patternType = 'wedge_falling'; }
    }
    if (!direction) {
      const fvgSig = detectFvgSignalBoth(candles, i, { slBufferPct, trendSmaLen: fvgTrendSmaLen, allowShort: true });
      if (fvgSig && ((fvgSig.direction === 'buy' && !bearNow) || (fvgSig.direction === 'sell' && bearNow))) { direction = fvgSig.direction; sl = fvgSig.sl; patternType = fvgSig.patternType; }
    }
    if (!direction) continue;

    const riskDistance = Math.abs(lastPrice - sl);
    if (riskDistance === 0) continue;
    const nyawaPct = riskDistance / lastPrice * 100;
    const { nilaiPosisi, margin } = hitungExposure({ modal: capital / modalDivisor, entry: lastPrice, stopLoss: sl, direction: halfShortExposure ? direction : undefined });
    if (margin > capital) continue;
    if (margin / capital * 100 > maxMarginPct) continue;
    const lossAtSl = nilaiPosisi * (nyawaPct / 100);
    const tp = direction === 'buy' ? lastPrice + riskDistance * tpRMultiple : lastPrice - riskDistance * tpRMultiple;

    openPos = { direction, entryPrice: lastPrice, sl, tp, entryTime: today.closeTime, nilaiPosisi, margin, lossAtSl, patternType };
  }

  let peak = -Infinity, maxDrawdownPct = 0;
  for (const pt of capitalSeries) { peak = Math.max(peak, pt.capital); maxDrawdownPct = Math.max(maxDrawdownPct, (peak - pt.capital) / peak * 100); }
  return { trades, finalCapital: capital, maxDrawdownPct };
}

function main() {
  const opts = { ...RESCALED_4H, modalDivisor: 5, bearWindowFn: makeBtcBearWindowFn(), tpRMultiple: 2 };
  const { runNyopetV2BacktestWindowGated } = require('./rangerChartPatternFvg');

  console.log('=== PERBANDINGAN: Trailing Stop (SMA-60, LIVE sekarang) vs TP Tetap (2R, gak ada trail) ===');
  console.log('SAMA PERSIS: sinyal (flag/wedge/FVG), window-gating, sizing/leverage, cuma exit-nya beda.\n');

  const trail = runNyopetV2BacktestWindowGated(CANDLES_4H, opts);
  const sTrail = summarize(trail.trades);
  console.log('--- TRAILING STOP (live sekarang) ---');
  console.log(`n=${sTrail.n} | win rate=${sTrail.winRate} | PF=${sTrail.profitFactor} | totalR=${sTrail.totalR} | avgR=${sTrail.avgR}`);
  console.log(`Final capital: $${trail.finalCapital.toFixed(2)} | Max DD: ${trail.maxDrawdownPct.toFixed(1)}%`);
  const trailExits = {};
  trail.trades.forEach((t) => { trailExits[t.exitReason] = (trailExits[t.exitReason] || 0) + 1; });
  console.log('Exit breakdown:', JSON.stringify(trailExits));

  const fixedTp = runSimpleTpVariant(CANDLES_4H, opts);
  const sFixed = summarize(fixedTp.trades);
  console.log('\n--- TP TETAP (2R, tanpa trail sama sekali) ---');
  console.log(`n=${sFixed.n} | win rate=${sFixed.winRate} | PF=${sFixed.profitFactor} | totalR=${sFixed.totalR} | avgR=${sFixed.avgR}`);
  console.log(`Final capital: $${fixedTp.finalCapital.toFixed(2)} | Max DD: ${fixedTp.maxDrawdownPct.toFixed(1)}%`);
  const fixedExits = {};
  fixedTp.trades.forEach((t) => { fixedExits[t.exitReason] = (fixedExits[t.exitReason] || 0) + 1; });
  console.log('Exit breakdown:', JSON.stringify(fixedExits));

  console.log('\n--- SELISIH ---');
  console.log(`Total R: Trailing ${sTrail.totalR}R vs TP Tetap ${sFixed.totalR}R (selisih ${(parseFloat(sTrail.totalR) - parseFloat(sFixed.totalR)).toFixed(1)}R)`);
  console.log(`Final capital: Trailing $${trail.finalCapital.toFixed(2)} vs TP Tetap $${fixedTp.finalCapital.toFixed(2)}`);

  console.log('\n--- Contoh trade yang HASILNYA BEDA (trailing dapat >2R, TP tetap cuma dapat pas 2R) ---');
  const bigTrailWins = trail.trades.filter((t) => t.exitReason === 'TRAIL_EXIT' && t.rMultiple > 2.5).sort((a, b) => b.rMultiple - a.rMultiple).slice(0, 5);
  bigTrailWins.forEach((t) => {
    console.log(`  ${new Date(t.entryTime).toISOString().slice(0, 10)} ${t.patternType} ${t.direction}: trailing dapat ${t.rMultiple.toFixed(1)}R (TP tetap cuma bakal dapat 2R di titik yang sama)`);
  });
}

main();
