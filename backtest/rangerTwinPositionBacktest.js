// Fase 2 riset MASTER_RULE_DYNAMIC_CANDLE_INVALIDATION_v3_4.md (25 Sep 2026) -- TWIN POSITION
// beneran (Bagian 19): 1 sinyal Ranger (bekas "Nyopet" 4-jam, lihat masterRuleTrailingInvalidation.js
// buat konteks) buka 2 posisi SEKALIGUS, modal dibagi 50/50 (Bagian 19.5), leg independen:
//   - Leg TRAILING  : masterRuleTrailingInvalidation.js (HIGH/LOW ratchet, Nyawa+fee)
//   - Leg FIXED_TP  : TP TETAP MURNI (permintaan eksplisit Olan, "Opsi B" -- 1 target keras,
//                     full-close, TANPA partial/trailing sama sekali) -- RR default 1:1 SAMA
//                     konvensi "TP Tetap" Channel Breakout (channelBreakoutTrader.js: "SL/TP
//                     tetap 1:1 R:R"), biar istilah "TP Tetap" konsisten se-proyek.
//
// Modal fisik TERPISAH per leg (Bagian 19.5: "secara fisik dana tetap tersebar di tiap exchange")
// -- 2 sub-capital independen (capTrail/capFixed), masing-masing mulai capitalSplit% dari modal
// awal, sizing PAKAI CAPITAL LEG ITU SENDIRI (bukan gabungan) via "cheat exposure" modal/5 yang
// SAMA kayak sistem lama.
//
// TAHAP INI: TANPA window bear/bull (permintaan Olan, fokus logika dulu). Exchange-pairing per leg
// BELUM relevan di backtest (logic-agnostic ke exchange), fee dipukul rata taker (lihat catatan
// scoutTrailingInvalidationBacktest.js).

const { detectFlag, detectWedge } = require('../chartPatterns');
const { hitung: hitungExposure } = require('../calculator');
const { sma } = require('../technicalAnalysis');
const { simulateTrailingInvalidation } = require('../masterRuleTrailingInvalidation');
const { detectFvgSignalBoth, CANDLES_4H, CANDLES_4H_GOLD } = require('./nyopetChartPatternFvg');
const { TAKER_FEE_PERCENT } = require('./scoutTrailingInvalidationBacktest');

// "Opsi A" (25 Sep 2026, permintaan Olan setelah lihat Fixed-TP murni GAK reliable buat BTC di
// rasio manapun -- "tujuanku yang tp tetap buat jamin modal kembali... yang ngepush saldo yang
// trailing") -- leg kedua BTC pakai sistem LAMA yang UDAH TERVALIDASI (partial 2R + geser
// breakeven + trail SMA, PF 3.71 window-gated -- lihat nyopetLatestFullReport.js), BUKAN target
// tetap murni. Return `totalPnlPct` (% dari nilaiPosisi PENUH, udah gabung partial+sisa) biar
// caller tinggal kali nilaiPosisi SEKALI, konsisten gaya sama legPnl() -- BEDA dari simulateFixedTp
// yang balikin exitPrice tunggal (mekanisme ini 2 tahap, gak ada 1 "harga keluar" tunggal).
function simulateOldStyleExit({ candles, entryIndex, entryPrice, direction, sl, nyawaPct, partialRR = 2, trailSmaLen = 10 }) {
  const partialTp = direction === 'buy' ? entryPrice + Math.abs(entryPrice - sl) * partialRR : entryPrice - Math.abs(entryPrice - sl) * partialRR;
  let partialDone = false, currentSl = sl, realizedPctFromPartial = 0;

  for (let j = entryIndex + 1; j < candles.length; j++) {
    const c = candles[j];
    if (c.high == null || c.low == null || c.high < c.low) continue;

    if (!partialDone) {
      const hitSl = direction === 'buy' ? c.low <= currentSl : c.high >= currentSl;
      const hitPartial = direction === 'buy' ? c.high >= partialTp : c.low <= partialTp;
      if (hitSl) return { totalPnlPct: -nyawaPct, exitIndex: j, exitTime: c.closeTime, reason: 'SL' };
      if (hitPartial) {
        const rewardPct = Math.abs(partialTp - entryPrice) / entryPrice * 100;
        realizedPctFromPartial = 0.5 * rewardPct;
        partialDone = true; currentSl = entryPrice; // geser breakeven
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

// Simulasi leg FIXED_TP murni -- SL/TP harga tunggal, dicek pakai HIGH/LOW candle (bukan close,
// konsisten sama prinsip "jangan pakai close" MASTER_RULE Bagian 10), SL dicek DULUAN tiap candle
// sebelum TP (konservatif, kalau kebetulan sama-sama kesentuh 1 candle -- sama semangat Bagian 16.1
// "cek trigger dulu sebelum asumsi mana duluan").
function simulateFixedTp({ candles, entryIndex, entryPrice, direction, sl, tp }) {
  for (let j = entryIndex + 1; j < candles.length; j++) {
    const c = candles[j];
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

function legPnl(entryPrice, exitPrice, nilaiPosisi, direction, feePercent) {
  const movePct = (exitPrice - entryPrice) / entryPrice * (direction === 'buy' ? 1 : -1) * 100;
  const gross = nilaiPosisi * (movePct / 100);
  const roundTripFee = nilaiPosisi * (feePercent * 2 / 100);
  return { gross, net: gross - roundTripFee, roundTripFee };
}

function runTwinPositionBacktest(candles, opts = {}) {
  const {
    warmupCandles = 260,
    poleLookbackRange = [5, 20], poleMinMovePct = 15, flagLookbackRange = [3, 15], flagMaxRangePct = 8,
    wedgeLookbackRange = [15, 40], wedgeMinTouches = 2, wedgeConvergenceRatio = 0.65,
    usePatterns = ['flag', 'wedge', 'fvg'],
    slBufferPct = 0.5, fvgTrendSmaLen = 200,
    startCapital = 100, modalDivisor = 5, capitalSplit = 0.5, fixedTpRR = 1,
    maxMarginPct = 20, maxNyawaPct = null,
    feePercent = TAKER_FEE_PERCENT,
    // "Opsi A" (25 Sep 2026) -- leg kedua bisa gonta-ganti mekanisme: 'fixedTp' (target keras
    // murni, simulateFixedTp) atau 'oldStyle' (partial 2R+trail SMA yang UDAH tervalidasi,
    // simulateOldStyleExit) -- Olan: "tp tetap buat jamin modal kembali", Fixed-TP murni TERBUKTI
    // gak reliable buat BTC di rasio manapun (PF-net gak pernah solid >1), oldStyle BTC-specific.
    secondLegStyle = 'fixedTp',
    partialRR = 2, trailSmaLen = 10, // dipakai kalau secondLegStyle==='oldStyle'
    // `longOnly` (25 Sep 2026, ide Olan abis liat Emas whipsaw parah di filter window: "emas itu
    // cuma long aja ya?") -- SAMA konvensi live sekarang (Emas auto-short DICABUT permanen, lihat
    // nyopetAutoTrader.js). Buang sinyal short di titik deteksi, TANPA filter window sama sekali
    // (gak butuh gerbang rezim buat nge-gate short kalau short-nya emang gak pernah diambil).
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

    // ⛔ FIX METODOLOGI 25 Sep 2026 RONDE 2 (Olan: "benerin metodologinya dulu") -- RONDE 1 udah
    // misahin CADENCE loop (pakai exitIndex trailing doang), TAPI gerbang margin masih `if (trailFail
    // || fixedFail) continue` GABUNGAN -- kalau modal leg FIXED-TP KEBETULAN lagi kecil (fixedTpRR
    // lain lagi jelek performa-nya), SATU sinyal yang SEBENERNYA trailing-nya valid ikut KETOLAK
    // total gara-gara fixed-nya doang yang gagal modal -- ini masih bikin SET TRADE trailing beda
    // dikit-dikit tiap ganti RR (717/450/399 BTC, padahal harusnya identik). Fix TUNTAS: gerbang
    // margin TRAILING dan FIXED-TP dicek TERPISAH SEKARANG -- Bagian 19.6 dokumen ("Opsi A,
    // disarankan"): kalau 1 leg gagal syarat modal, LEG LAIN TETAP JALAN SENDIRI (`TWIN_INCOMPLETE`),
    // BUKAN dua-duanya dibatalkan. Trailing SEKARANG 100% independen dari kondisi modal Fixed-TP --
    // ganti fixedTpRR MURNI ngubah angka exit Fixed-TP, gak pernah nyentuh SET SINYAL trailing lagi.
    const trailSizing = hitungExposure({ modal: capTrail / modalDivisor, entry: lastPrice, stopLoss: sl, direction });
    const trailOk = trailSizing.margin <= capTrail && (trailSizing.margin / capTrail * 100) <= maxMarginPct;
    if (!trailOk) continue; // trailing sendiri gagal modal -- gak ada leg SAMA SEKALI buat sinyal ini, skip normal

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
        if (oldResult.reason === 'STILL_OPEN') {
          // belum kelar pas data abis -- gak ada cara jujur mark-to-market 2-tahap ini pakai 1
          // angka % tunggal, treat PnL 0 (netral) drpd nebak, ditandain jelas via markedToMarket.
          totalPnlPct = 0; exitTime = lastC.closeTime; markedToMarket = true;
        }
        const gross = fixedSizing.nilaiPosisi * (totalPnlPct / 100);
        const roundTripFee = fixedSizing.nilaiPosisi * (feePercent * 2 / 100);
        const net = gross - roundTripFee;
        capFixed = Math.max(0, capFixed + net);
        fixedEntry = { gross, net, roundTripFee, exitPrice: null, exitTime, reason, markedToMarket, nilaiPosisi: fixedSizing.nilaiPosisi };
      } else {
        const tpPrice = direction === 'buy' ? lastPrice + riskDistance * fixedTpRR : lastPrice - riskDistance * fixedTpRR;
        const fixedResult = simulateFixedTp({ candles, entryIndex: i, entryPrice: lastPrice, direction, sl, tp: tpPrice });
        // fixedResult 'STILL_OPEN' (RR gede, belum sempat kena TP/SL pas data abis TAPI trailing
        // udah kelar duluan) -- mark-to-market pakai harga penutup TERAKHIR biar tetap kehitung ke
        // laporan (bukan exit ASLI, ditandain field `markedToMarket`).
        let exitPrice = fixedResult.exitPrice, exitTime = fixedResult.exitTime, reason = fixedResult.reason, markedToMarket = false;
        if (fixedResult.reason === 'STILL_OPEN') {
          exitPrice = lastC.close; exitTime = lastC.closeTime; markedToMarket = true;
        }
        const fixedPnl = legPnl(lastPrice, exitPrice, fixedSizing.nilaiPosisi, direction, feePercent);
        capFixed = Math.max(0, capFixed + fixedPnl.net);
        fixedEntry = { ...fixedPnl, exitPrice, exitTime, reason, markedToMarket, nilaiPosisi: fixedSizing.nilaiPosisi };
      }
    }
    // fixedOk===false -> fixedEntry TETAP null (TWIN_INCOMPLETE, Bagian 19.6 Opsi A) -- trailing
    // tercatat NORMAL di trades[], summarizeLeg('fixedTp') otomatis skip entry yang fixedTp:null.

    trades.push({
      twinGroupId: `${today.closeTime}-${direction}`, direction, patternType, entryPrice: lastPrice, nyawaPct, entryTime: today.closeTime,
      trailing: { ...trailPnl, exitPrice: trailResult.exitPrice, exitTime: trailResult.exitTime, effectivePct: trailResult.effectivePct, nilaiPosisi: trailSizing.nilaiPosisi },
      fixedTp: fixedEntry, twinIncomplete: fixedEntry === null,
    });
    capitalSeries.push({ time: trailResult.exitTime, capital: capTrail + capFixed });

    // Cadence loop SEKARANG 100% independen dari fixedTpRR (lihat catatan panjang di atas) --
    // slot kosong lagi begitu leg TRAILING kelar, REGARDLESS leg Fixed-TP masih jalan/gagal buka.
    i = trailResult.exitIndex;
  }

  let peak = -Infinity, maxDrawdownPct = 0;
  for (const pt of capitalSeries) { peak = Math.max(peak, pt.capital); maxDrawdownPct = Math.max(maxDrawdownPct, (peak - pt.capital) / peak * 100); }
  return { trades, capTrail, capFixed, capitalCombined: capTrail + capFixed, capitalSeries, maxDrawdownPct, stillOpenAtEnd };
}

function summarizeLeg(trades, legKey) {
  // `fixedTp` bisa `null` per pasangan (TWIN_INCOMPLETE, Bagian 19.6 -- leg itu gagal buka krn
  // modal, trailing tetap tercatat normal di trades[]) -- disaring keluar di sini, JANGAN ikut
  // dihitung ke win-rate/PF leg ini (bukan trade yang beneran kejadian).
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
  console.log('=== Ranger (4-jam) TWIN POSITION -- Trailing + TP-Tetap 1:1, modal 50/50 -- TANPA window bear/bull ===\n');
  for (const [assetLabel, candles] of [['BTC', CANDLES_4H], ['EMAS (PAXG)', CANDLES_4H_GOLD]]) {
    if (!candles) { console.log(`--- ${assetLabel}: data candle gak ada, skip ---\n`); continue; }
    const result = runTwinPositionBacktest(candles);
    const trailStats = summarizeLeg(result.trades, 'trailing');
    const fixedStats = summarizeLeg(result.trades, 'fixedTp');
    console.log(`--- ${assetLabel} (${result.trades.length} pasang sinyal) ---`);
    if (result.trades.length === 0) { console.log('  Gak ada trade.\n'); continue; }
    console.log(`  Leg TRAILING : n=${trailStats.n} win=${trailStats.winRatePct.toFixed(1)}% PF-net=${trailStats.pfNet.toFixed(2)} totalNet=$${trailStats.totalPnlNet.toFixed(2)}`);
    console.log(`  Leg FIXED-TP : n=${fixedStats.n} win=${fixedStats.winRatePct.toFixed(1)}% PF-net=${fixedStats.pfNet.toFixed(2)} totalNet=$${fixedStats.totalPnlNet.toFixed(2)}`);
    console.log(`  Modal awal $100 (50/50) -> Trailing $${result.capTrail.toFixed(2)} + Fixed-TP $${result.capFixed.toFixed(2)} = GABUNGAN $${result.capitalCombined.toFixed(2)}`);
    console.log(`  Max drawdown gabungan: ${result.maxDrawdownPct.toFixed(1)}%`);
    if (result.stillOpenAtEnd) console.log(`  ⚠️ Pasangan terakhir masih floating pas data abis (${result.stillOpenAtEnd.direction} @ ${result.stillOpenAtEnd.entryPrice.toFixed(2)}) -- gak dihitung.`);
    console.log();
  }
}

module.exports = { runTwinPositionBacktest, simulateFixedTp, simulateOldStyleExit, summarizeLeg };
if (require.main === module) { main().catch((e) => { console.error('ERROR:', e.message, e.stack); process.exit(1); }); }
