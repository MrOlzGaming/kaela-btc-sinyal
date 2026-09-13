// Riset "Nyopet v2" (30 Agu 2026, ide Olan): pindah dari zona-ping-pong (backtest sebelumnya
// PF~0,96, marginal/negatif -- lihat backtest/nyopetNyawaUpgrade.js) ke mesin deteksi Sniper
// yang UDAH TERBUKTI edge (chart pattern flag/wedge + FVG, PF 1,71-2,32 di timeframe harian --
// lihat backtestFlagBreakout.js/backtestFVG.js), TAPI dimodifikasi jadi versi "nyopet":
//   1. Timeframe LEBIH RENDAH dari Sniper asli (4 jam, bukan harian) -- lebih sering, gaya cepat.
//   2. LONG *dan* SHORT diaktifkan (Sniper asli buy-only permanen -- lihat
//      [[feedback-nyopet-buyonly]], short kebukti ngerusak di timeframe HARIAN. Ini timeframe
//      BEDA -- pantas dites ulang, bukan diasumsikan bakal sama.).
//   3. "Cheat exposure" -- modal yang DIMASUKIN ke kalkulator exposure = capital/5 (BUKAN
//      capital penuh), sengaja lompat ke bracket exposure lebih agresif dari yang capital asli
//      "berhak" dapat -- deployment/tracking P&L tetap ke CAPITAL PENUH, cuma nilaiPosisi/leverage
//      yang dihitung seolah-olah modal 5x lebih kecil.
//
// FVG bearish BELUM ADA sama sekali di kode manapun (fvgDetector.js/backtestFVG.js cuma bullish)
// -- ditulis BARU di sini (mirror logic bullish, gap TURUN = resistance, short pas harga koreksi
// balik turun ke gap & ditolak). BELUM divalidasi/dipakai live di manapun, murni riset.
//
// Chart pattern (flag/wedge) REUSE LANGSUNG dari chartPatterns.js (SATU sumber kebenaran sama
// yang dipakai live Sniper) -- `allowShort` UDAH ADA di situ, gak perlu reimplementasi.

const fs = require('fs');
const path = require('path');
const { sma } = require('../technicalAnalysis');
const { hitung: hitungExposure } = require('../calculator');
const { detectFlag, detectWedge } = require('../chartPatterns');
const { isBtcBearWindow } = require('../halvingBearWindow');

const HOURLY_BTC = JSON.parse(fs.readFileSync(path.join(__dirname, 'hourly-cache.json'), 'utf8'));
// Emas (30 Agu 2026, permintaan Olan: "bukan cuma BTC.. tapi BTC dan Emas", sama pola kayak
// Sniper yang udah 2 aset) -- PAXGUSDT, data Binance mulai ~28 Agu 2020 (lihat refreshGoldCache.js).
const goldCachePath = path.join(__dirname, 'gold-hourly-cache.json');
const HOURLY_GOLD = fs.existsSync(goldCachePath) ? JSON.parse(fs.readFileSync(goldCachePath, 'utf8')) : null;

// ============ Resample HOURLY -> 4H (candle mentah gak ada di cache, hemat 1 fetch network) ============
function resampleTo4h(hourly) {
  const out = [];
  let bucket = null;
  for (const c of hourly) {
    const hour = new Date(c.closeTime).getUTCHours();
    const bucketHour = Math.floor(hour / 4) * 4;
    const isNewBucket = !bucket || new Date(bucket.closeTime).getUTCHours() !== bucketHour
      || (c.closeTime - bucket.closeTime) > 4 * 3600 * 1000;
    if (isNewBucket) {
      if (bucket) out.push(bucket);
      bucket = { openTime: c.openTime, open: c.open, high: c.high, low: c.low, close: c.close, closeTime: c.closeTime };
    } else {
      bucket.high = Math.max(bucket.high, c.high);
      bucket.low = Math.min(bucket.low, c.low);
      bucket.close = c.close;
      bucket.closeTime = c.closeTime;
    }
  }
  if (bucket) out.push(bucket);
  return out;
}

const CANDLES_4H = resampleTo4h(HOURLY_BTC);
const CANDLES_4H_GOLD = HOURLY_GOLD ? resampleTo4h(HOURLY_GOLD) : null;

// ============ FVG bearish (BARU, gak ada di kode manapun) -- mirror bullish, gap TURUN ============
// candle1.low > candle3.high = gap turun (harga "dilompatin" ke bawah pas displacement) -- zona
// itu jadi resistance, entry SHORT pas harga koreksi balik NAIK ke gap & tutup balik di bawahnya
// (rejection). SL di atas batas atas gap (gap keisi penuh ke atas = thesis gugur).
function detectBearishFVG(candles, i) {
  if (i < 2) return null;
  const c1 = candles[i - 2], c3 = candles[i];
  if (c1.low > c3.high) return { gapTop: c1.low, gapBottom: c3.high, createdIdx: i };
  return null;
}

function detectFvgSignalBoth(candles, i, opts = {}) {
  const { slBufferPct = 0, trendSmaLen = 200, allowShort = true } = opts;
  const lastPrice = candles[i].close;
  let trendSma = null;
  if (trendSmaLen !== null && i >= trendSmaLen) {
    const closes = candles.slice(Math.max(0, i - trendSmaLen + 1), i + 1).map((c) => c.close);
    trendSma = closes.reduce((a, b) => a + b, 0) / closes.length;
  }

  // Bullish (long) -- persis logic fvgDetector.js, filter tren: WAJIB di atas SMA.
  if (trendSma === null || lastPrice >= trendSma) {
    for (let k = i - 1; k >= 2; k--) {
      const fvg = detectBullishFVG(candles, k);
      if (!fvg) continue;
      let filled = false, touchedBefore = false;
      for (let j = k + 1; j < i; j++) {
        if (candles[j].low <= fvg.gapBottom) { filled = true; break; }
        if (candles[j].low <= fvg.gapTop) touchedBefore = true;
      }
      if (filled) continue;
      if (candles[i].low <= fvg.gapBottom) continue;
      if (!touchedBefore && candles[i].low > fvg.gapTop) continue;
      if (lastPrice > fvg.gapTop) {
        return { direction: 'buy', sl: fvg.gapBottom * (1 - slBufferPct / 100), patternType: 'fvg_bounce_long', gapCreatedTime: candles[k].closeTime };
      }
      break; // gap terdekat doang yang dicek per arah, sama pola fvgDetector.js (scan mundur, return begitu ketemu kandidat gap TERDEKAT valid)
    }
  }

  // Bearish (short) -- mirror, filter tren: WAJIB di bawah SMA.
  if (allowShort && (trendSma === null || lastPrice <= trendSma)) {
    for (let k = i - 1; k >= 2; k--) {
      const fvg = detectBearishFVG(candles, k);
      if (!fvg) continue;
      let filled = false, touchedBefore = false;
      for (let j = k + 1; j < i; j++) {
        if (candles[j].high >= fvg.gapTop) { filled = true; break; }
        if (candles[j].high >= fvg.gapBottom) touchedBefore = true;
      }
      if (filled) continue;
      if (candles[i].high >= fvg.gapTop) continue;
      if (!touchedBefore && candles[i].high < fvg.gapBottom) continue;
      if (lastPrice < fvg.gapBottom) {
        return { direction: 'sell', sl: fvg.gapTop * (1 + slBufferPct / 100), patternType: 'fvg_bounce_short', gapCreatedTime: candles[k].closeTime };
      }
      break;
    }
  }
  return null;
}

function detectBullishFVG(candles, i) {
  if (i < 2) return null;
  const c1 = candles[i - 2], c3 = candles[i];
  if (c1.high < c3.low) return { gapTop: c3.low, gapBottom: c1.high, createdIdx: i };
  return null;
}

// ============ Backtest utama -- sama arsitektur 2-tier exit (partial 2R + trail SMA) yang UDAH
// TERVALIDASI di runFlagBacktest (backtestFlagBreakout.js), diadaptasi ke 4H + FVG + modal/5. ============
function runNyopetV2Backtest(candles, opts = {}) {
  const {
    warmupCandles = 260, // ~260*4h = 43 hari, cukup buat SMA200 4H + window pattern
    poleLookbackRange = [5, 20], poleMinMovePct = 15, flagLookbackRange = [3, 15], flagMaxRangePct = 8,
    wedgeLookbackRange = [15, 40], wedgeMinTouches = 2, wedgeConvergenceRatio = 0.65,
    usePatterns = ['flag', 'wedge', 'fvg'],
    slBufferPct = 0.5, partialRR = 2, trailSmaLen = 10, fvgTrendSmaLen = 200,
    allowShort = true,
    startCapital = 100,
    modalDivisor = 5, // "cheat" -- capital/5 dimasukin ke kalkulator exposure, bukan capital penuh
    maxMarginPct = 20, maxNyawaPct = null,
    // Top-up bulanan (31 Agu 2026, permintaan Olan: "tiap bulan isi terus 50 dolar... max 1000
    // stop") -- OFF by default (topUpAmount=0) biar backward-compatible sama caller lama.
    topUpAmount = 0, topUpStopAt = Infinity, topUpDayOfMonth = 5,
    // Redirect (31 Agu 2026, Olan: "kalo dah ga top up isinya ke btc spot terus dan emas terus")
    // -- begitu slot capped, setoran bulanan dilempar ke callback ini, gak hilang.
    onRedirectedTopUp = null,
    // Konfirmasi DXY (31 Agu 2026, permintaan Olan) -- sama pola backtestCrossAsset.js, cek di
    // titik ENTRY doang, opsional (null = tanpa filter, backward-compatible).
    dxyFilter = null,
    // Titik mulai SERAGAM (31 Agu 2026, Olan: "backtest harus sama startnya.. dari 2020 aja, itu
    // pertama aku kenal kripto") -- candle SEBELUM startMs tetap dilewatin/dipakai buat SMA/pola
    // (loop & pattern-detection function baca array PENUH candles seperti biasa), tapi modal cuma
    // diseed begitu closeTime candle >= startMs (sebelum itu capital=0, otomatis gak ada entry
    // kelolos krn cek margin>capital yang UDAH ADA).
    startMs = null,
  } = opts;
  const trades = [];
  let openPos = null;
  let capital = startMs ? 0 : startCapital;
  let totalDeposited = startMs ? 0 : startCapital;
  let activated = !startMs;
  let lastTopUpMonthKey = null;
  // Kalau startMs diisi, JANGAN seed capitalSeries dgn titik capital=0 (bikin NaN di kalkulasi
  // drawdown, peak=0 -> pembagian 0/0) -- titik pertama yang valid didorong pas activation di bawah.
  const capitalSeries = startMs ? [] : [{ time: candles[warmupCandles] ? candles[warmupCandles].closeTime : 0, capital }];

  for (let i = warmupCandles; i < candles.length; i++) {
    const today = candles[i];

    if (!activated && (!startMs || today.closeTime >= startMs)) {
      activated = true;
      capital = startCapital; totalDeposited = startCapital;
      capitalSeries.push({ time: today.closeTime, capital });
    }
    if (!activated) continue; // belum aktif -- skip position mgmt & signal search, capital masih 0

    if (topUpAmount > 0 && activated) {
      const d = new Date(today.closeTime);
      const monthKey = d.getUTCFullYear() * 12 + d.getUTCMonth();
      if (d.getUTCDate() >= topUpDayOfMonth && monthKey !== lastTopUpMonthKey) {
        lastTopUpMonthKey = monthKey;
        if (capital < topUpStopAt) {
          capital += topUpAmount; totalDeposited += topUpAmount;
          capitalSeries.push({ time: today.closeTime, capital });
        } else if (onRedirectedTopUp) {
          onRedirectedTopUp(topUpAmount, today.closeTime);
        }
      }
    }

    if (openPos) {
      const closes = candles.slice(0, i + 1).map((c) => c.close);
      const trailSma = sma(closes, trailSmaLen);
      if (!openPos.partialDone) {
        const hitSl = openPos.direction === 'buy' ? today.low <= openPos.sl : today.high >= openPos.sl;
        const hitPartial = openPos.direction === 'buy' ? today.high >= openPos.partialTp : today.low <= openPos.partialTp;
        if (hitSl) {
          capital = Math.max(0, capital - openPos.lossAtSl);
          trades.push({ ...openPos, exitReason: 'SL', rMultiple: -1, pnlUsd: -openPos.lossAtSl, exitTime: today.closeTime });
          capitalSeries.push({ time: today.closeTime, capital }); openPos = null;
        } else if (hitPartial) {
          const rewardPct = Math.abs(openPos.partialTp - openPos.entryPrice) / openPos.entryPrice * 100;
          const profitHalf = openPos.nilaiPosisi * 0.5 * (rewardPct / 100);
          capital += profitHalf;
          openPos.realizedPnl = profitHalf; openPos.partialDone = true; openPos.sl = openPos.entryPrice;
        }
      } else {
        const hitSl = openPos.direction === 'buy' ? today.low <= openPos.sl : today.high >= openPos.sl;
        const trendBroken = trailSma !== null && (openPos.direction === 'buy' ? today.close < trailSma : today.close > trailSma);
        if (hitSl || trendBroken) {
          const movePctSigned = (today.close - openPos.entryPrice) / openPos.entryPrice * (openPos.direction === 'buy' ? 1 : -1) * 100;
          const pnlRest = openPos.nilaiPosisi * 0.5 * (movePctSigned / 100);
          capital = Math.max(0, capital + pnlRest);
          const totalPnl = openPos.realizedPnl + pnlRest;
          const riskPct = Math.abs(openPos.entryPrice - openPos.originalSl) / openPos.entryPrice * 100;
          trades.push({ ...openPos, exitReason: hitSl ? 'SL_BREAKEVEN' : 'TRAIL_EXIT', rMultiple: riskPct > 0 ? movePctSigned / riskPct : 0, pnlUsd: totalPnl, exitTime: today.closeTime });
          capitalSeries.push({ time: today.closeTime, capital }); openPos = null;
        }
      }
      continue;
    }

    const lastPrice = today.close;
    let direction = null, sl = null, patternType = null;

    if (usePatterns.includes('flag')) {
      const flag = detectFlag(candles, i, { poleLookbackRange, poleMinMovePct, flagLookbackRange, flagMaxRangePct });
      if (flag && flag.type === 'bull' && lastPrice > flag.flagHigh) { direction = 'buy'; sl = flag.flagLow * (1 - slBufferPct / 100); patternType = 'flag_bull'; }
      else if (flag && flag.type === 'bear' && lastPrice < flag.flagLow && allowShort) { direction = 'sell'; sl = flag.flagHigh * (1 + slBufferPct / 100); patternType = 'flag_bear'; }
    }
    if (!direction && usePatterns.includes('wedge')) {
      const wedge = detectWedge(candles, i, { wedgeLookbackRange, minTouches: wedgeMinTouches, convergenceRatio: wedgeConvergenceRatio });
      if (wedge && wedge.type === 'rising' && lastPrice < wedge.projectedSupport && allowShort) { direction = 'sell'; sl = wedge.recentSwingHigh * (1 + slBufferPct / 100); patternType = 'wedge_rising'; }
      else if (wedge && wedge.type === 'falling' && lastPrice > wedge.projectedResistance) { direction = 'buy'; sl = wedge.recentSwingLow * (1 - slBufferPct / 100); patternType = 'wedge_falling'; }
    }
    if (!direction && usePatterns.includes('fvg')) {
      const fvgSig = detectFvgSignalBoth(candles, i, { slBufferPct, trendSmaLen: fvgTrendSmaLen, allowShort });
      if (fvgSig) { direction = fvgSig.direction; sl = fvgSig.sl; patternType = fvgSig.patternType; }
    }
    if (!direction) continue;

    // Filter DXY -- sistem long-only (allowShort=false buat config live), cuma butuh dolar LEMAH
    // sbg konfirmasi arah buy. null (data DXY blm ada di titik itu) = treat LOLOS, bukan gagal.
    if (dxyFilter && direction === 'buy') {
      const dxyWeak = dxyFilter(today.closeTime);
      if (dxyWeak === false) continue;
    }

    const riskDistance = Math.abs(lastPrice - sl);
    if (riskDistance === 0) continue;
    const nyawaPct = riskDistance / lastPrice * 100;
    if (maxNyawaPct !== null && nyawaPct > maxNyawaPct) continue;

    // "Cheat exposure" -- modal yang DIMASUKIN kalkulator = capital/modalDivisor (BUKAN capital
    // penuh), lompat ke bracket exposure lebih agresif. Loss/profit TETAP dihitung dari
    // nilaiPosisi (produk exposure "curang" ini) tapi capital yang DILACAK/DEPLOY tetap penuh.
    const sizingModal = capital / modalDivisor;
    const { nilaiPosisi, margin } = hitungExposure({ modal: sizingModal, entry: lastPrice, stopLoss: sl });
    if (margin > capital) continue; // gak cukup modal PENUH buat kunci margin ini
    const marginPct = margin / capital * 100;
    if (marginPct > maxMarginPct) continue;
    const lossAtSl = nilaiPosisi * (nyawaPct / 100);
    const partialTp = direction === 'buy' ? lastPrice + riskDistance * partialRR : lastPrice - riskDistance * partialRR;

    openPos = {
      direction, entryPrice: lastPrice, sl, originalSl: sl, partialTp, entryTime: today.closeTime,
      nilaiPosisi, margin, marginPct, lossAtSl, partialDone: false, realizedPnl: 0, patternType,
    };
  }

  let peak = -Infinity, maxDrawdownPct = 0;
  for (const pt of capitalSeries) { peak = Math.max(peak, pt.capital); maxDrawdownPct = Math.max(maxDrawdownPct, (peak - pt.capital) / peak * 100); }
  return { trades, finalCapital: capital, maxDrawdownPct, capitalSeries, totalDeposited };
}

// ============ WINDOW-GATED (13 Sep 2026, permintaan Olan: "backtest sniper dan nyopet, BTC dan
// emas") -- mirror PERSIS pola runFlagBacktestWindowGated (backtestFlagBreakout.js): arah digate
// per-window DI TITIK DETEKSI (bukan post-hoc filter/allowShort polos kayak fungsi C/D di atas
// yang nyampur long+short SEMBARANG kondisi), + WINDOW_FLIP force-close posisi yang arahnya udah
// gak cocok. `bearWindowFn(candles, i) -> bool` beda per aset -- BTC pakai isBtcBearWindow (siklus
// halving), Emas pakai SMA1200-4H (rescaled, setara SMA200 harian -- lihat RESCALED_4H). ============
function makeBtcBearWindowFn() {
  return (candles, i) => isBtcBearWindow(new Date(candles[i].closeTime));
}
function makeEmasBearWindowFn(smaLen = 1200) {
  return (candles, i) => {
    if (i < smaLen - 1) return false;
    const s = sma(candles.slice(0, i + 1).map((c) => c.close), smaLen);
    return s !== null && candles[i].close < s;
  };
}

function runNyopetV2BacktestWindowGated(candles, opts = {}) {
  const {
    warmupCandles = 260,
    poleLookbackRange = [5, 20], poleMinMovePct = 15, flagLookbackRange = [3, 15], flagMaxRangePct = 8,
    wedgeLookbackRange = [15, 40], wedgeMinTouches = 2, wedgeConvergenceRatio = 0.65,
    usePatterns = ['flag', 'wedge', 'fvg'],
    slBufferPct = 0.5, partialRR = 2, trailSmaLen = 10, fvgTrendSmaLen = 200,
    startCapital = 100, modalDivisor = 5,
    maxMarginPct = 20, maxNyawaPct = null,
    topUpAmount = 0, topUpStopAt = Infinity, topUpDayOfMonth = 5, onRedirectedTopUp = null,
    bearWindowFn, // WAJIB diisi caller (makeBtcBearWindowFn()/makeEmasBearWindowFn())
    forceCloseOnFlip = true,
  } = opts;
  const trades = [];
  let openPos = null;
  let capital = startCapital, totalDeposited = startCapital, lastTopUpMonthKey = null;
  const capitalSeries = [{ time: candles[warmupCandles] ? candles[warmupCandles].closeTime : 0, capital }];

  for (let i = warmupCandles; i < candles.length; i++) {
    const today = candles[i];
    const bearNow = bearWindowFn(candles, i);

    if (topUpAmount > 0) {
      const d = new Date(today.closeTime);
      const monthKey = d.getUTCFullYear() * 12 + d.getUTCMonth();
      if (d.getUTCDate() >= topUpDayOfMonth && monthKey !== lastTopUpMonthKey) {
        lastTopUpMonthKey = monthKey;
        if (capital < topUpStopAt) { capital += topUpAmount; totalDeposited += topUpAmount; capitalSeries.push({ time: today.closeTime, capital }); }
        else if (onRedirectedTopUp) onRedirectedTopUp(topUpAmount, today.closeTime);
      }
    }

    if (openPos) {
      const wrongSide = forceCloseOnFlip && ((openPos.direction === 'buy' && bearNow) || (openPos.direction === 'sell' && !bearNow));
      if (wrongSide) {
        const movePctSigned = (today.close - openPos.entryPrice) / openPos.entryPrice * (openPos.direction === 'buy' ? 1 : -1) * 100;
        const remainingFrac = openPos.partialDone ? 0.5 : 1;
        const pnlRest = openPos.nilaiPosisi * remainingFrac * (movePctSigned / 100);
        const totalPnl = openPos.realizedPnl + pnlRest;
        capital = Math.max(0, capital + pnlRest);
        const riskPct = Math.abs(openPos.entryPrice - openPos.originalSl) / openPos.entryPrice * 100;
        trades.push({ ...openPos, exitReason: 'WINDOW_FLIP', rMultiple: riskPct > 0 ? (totalPnl / openPos.nilaiPosisi * 100) / riskPct : 0, pnlUsd: totalPnl, exitTime: today.closeTime });
        capitalSeries.push({ time: today.closeTime, capital }); openPos = null;
        continue;
      }
      const closes = candles.slice(0, i + 1).map((c) => c.close);
      const trailSma = sma(closes, trailSmaLen);
      if (!openPos.partialDone) {
        const hitSl = openPos.direction === 'buy' ? today.low <= openPos.sl : today.high >= openPos.sl;
        const hitPartial = openPos.direction === 'buy' ? today.high >= openPos.partialTp : today.low <= openPos.partialTp;
        if (hitSl) {
          capital = Math.max(0, capital - openPos.lossAtSl);
          trades.push({ ...openPos, exitReason: 'SL', rMultiple: -1, pnlUsd: -openPos.lossAtSl, exitTime: today.closeTime });
          capitalSeries.push({ time: today.closeTime, capital }); openPos = null;
        } else if (hitPartial) {
          const rewardPct = Math.abs(openPos.partialTp - openPos.entryPrice) / openPos.entryPrice * 100;
          const profitHalf = openPos.nilaiPosisi * 0.5 * (rewardPct / 100);
          capital += profitHalf;
          openPos.realizedPnl = profitHalf; openPos.partialDone = true; openPos.sl = openPos.entryPrice;
        }
      } else {
        const hitSl = openPos.direction === 'buy' ? today.low <= openPos.sl : today.high >= openPos.sl;
        const trendBroken = trailSma !== null && (openPos.direction === 'buy' ? today.close < trailSma : today.close > trailSma);
        if (hitSl || trendBroken) {
          const movePctSigned = (today.close - openPos.entryPrice) / openPos.entryPrice * (openPos.direction === 'buy' ? 1 : -1) * 100;
          const pnlRest = openPos.nilaiPosisi * 0.5 * (movePctSigned / 100);
          capital = Math.max(0, capital + pnlRest);
          const totalPnl = openPos.realizedPnl + pnlRest;
          const riskPct = Math.abs(openPos.entryPrice - openPos.originalSl) / openPos.entryPrice * 100;
          trades.push({ ...openPos, exitReason: hitSl ? 'SL_BREAKEVEN' : 'TRAIL_EXIT', rMultiple: riskPct > 0 ? movePctSigned / riskPct : 0, pnlUsd: totalPnl, exitTime: today.closeTime });
          capitalSeries.push({ time: today.closeTime, capital }); openPos = null;
        }
      }
      continue;
    }

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
      // detectFvgSignalBoth SELALU cek dua arah regardless allowShort (cuma nggerbang cabang
      // short) -- filter EKSPLISIT arah vs window di sini, JANGAN andelin opts.allowShort doang
      // (pelajaran sama persis kayak bug nyopetAutoTrader.js yang dibenerin hari ini).
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
    const sizingModal = capital / modalDivisor;
    const { nilaiPosisi, margin } = hitungExposure({ modal: sizingModal, entry: lastPrice, stopLoss: sl });
    if (margin > capital) continue;
    const marginPct = margin / capital * 100;
    if (marginPct > maxMarginPct) continue;
    const lossAtSl = nilaiPosisi * (nyawaPct / 100);
    const partialTp = direction === 'buy' ? lastPrice + riskDistance * partialRR : lastPrice - riskDistance * partialRR;

    openPos = { direction, entryPrice: lastPrice, sl, originalSl: sl, partialTp, entryTime: today.closeTime, nilaiPosisi, margin, marginPct, lossAtSl, partialDone: false, realizedPnl: 0, patternType };
  }

  let peak = -Infinity, maxDrawdownPct = 0;
  for (const pt of capitalSeries) { peak = Math.max(peak, pt.capital); maxDrawdownPct = Math.max(maxDrawdownPct, (peak - pt.capital) / peak * 100); }
  return { trades, finalCapital: capital, maxDrawdownPct, capitalSeries, totalDeposited };
}

function summarize(trades) {
  const n = trades.length;
  if (n === 0) return { n: 0 };
  const wins = trades.filter((t) => t.rMultiple > 0);
  const totalR = trades.reduce((s, t) => s + t.rMultiple, 0);
  const grossWinR = wins.reduce((s, t) => s + t.rMultiple, 0);
  const grossLossR = Math.abs(trades.filter((t) => t.rMultiple <= 0).reduce((s, t) => s + t.rMultiple, 0));
  const long = trades.filter((t) => t.direction === 'buy');
  const short = trades.filter((t) => t.direction === 'sell');
  return {
    n, winRate: (wins.length / n * 100).toFixed(1) + '%',
    profitFactor: grossLossR > 0 ? (grossWinR / grossLossR).toFixed(2) : 'inf',
    totalR: totalR.toFixed(2), avgR: (totalR / n).toFixed(2),
    longCount: long.length, longWinRate: long.length ? (long.filter((t) => t.rMultiple > 0).length / long.length * 100).toFixed(1) + '%' : '-',
    shortCount: short.length, shortWinRate: short.length ? (short.filter((t) => t.rMultiple > 0).length / short.length * 100).toFixed(1) + '%' : '-',
  };
}

function byYear(trades) {
  const years = {};
  trades.forEach((t) => {
    const y = new Date(t.exitTime).getUTCFullYear();
    if (!years[y]) years[y] = { count: 0, totalR: 0, wins: 0 };
    years[y].count++;
    years[y].totalR += t.rMultiple;
    if (t.rMultiple > 0) years[y].wins++;
  });
  return years;
}

// Window RESCALED x6 (6 candle 4H = 1 hari) -- BUG metodologi ketemu+fix (30 Agu 2026): pole/
// flag/wedge lookback di-tuning dalam CANDLE COUNT buat harian, dipakai MENTAH di 4H bikin window
// 6x lebih PENDEK dari waktu aslinya (noise, bukan struktur beneran). WAJIB dipakai, JANGAN balik
// ke default candle-count harian buat data 4H manapun.
const RESCALED_4H = {
  poleLookbackRange: [30, 120], flagLookbackRange: [18, 90],
  wedgeLookbackRange: [90, 240], fvgTrendSmaLen: 1200, trailSmaLen: 60,
  warmupCandles: 1560,
};

function runReport(label, candles, opts) {
  const r = runNyopetV2Backtest(candles, opts);
  const s = summarize(r.trades);
  console.log(`\n[${label}]`);
  console.log(`  n=${s.n} | winRate=${s.winRate} | PF=${s.profitFactor} | totalR=${s.totalR} | avgR=${s.avgR}`);
  console.log(`  Long: ${s.longCount} (win ${s.longWinRate}) | Short: ${s.shortCount} (win ${s.shortWinRate})`);
  console.log(`  finalCapital=$${r.finalCapital.toFixed(2)} (${((r.finalCapital / 100 - 1) * 100).toFixed(0)}%) | maxDD=${r.maxDrawdownPct.toFixed(1)}%`);
  return { r, s };
}

if (require.main === module) {
  console.log('=== Nyopet v2: Chart Pattern + FVG, Long+Short, 4H, modal/5 -- BTC + Emas ===');
  console.log(`BTC 4H candles: ${CANDLES_4H.length} | rentang: ${new Date(CANDLES_4H[0].closeTime).toISOString().slice(0, 10)} -> ${new Date(CANDLES_4H[CANDLES_4H.length - 1].closeTime).toISOString().slice(0, 10)}`);
  if (CANDLES_4H_GOLD) console.log(`Emas 4H candles: ${CANDLES_4H_GOLD.length} | rentang: ${new Date(CANDLES_4H_GOLD[0].closeTime).toISOString().slice(0, 10)} -> ${new Date(CANDLES_4H_GOLD[CANDLES_4H_GOLD.length - 1].closeTime).toISOString().slice(0, 10)}`);
  else console.log('Emas: gold-hourly-cache.json gak ketemu, skip (jalanin refreshGoldCache.js dulu)');

  console.log('\n\n########## BTC ##########');
  runReport('BTC A. Buy-only, sizing NORMAL -- kontrol', CANDLES_4H, { ...RESCALED_4H, allowShort: false, modalDivisor: 1 });
  runReport('BTC B. Buy-only, sizing 1/5 (cheat)', CANDLES_4H, { ...RESCALED_4H, allowShort: false, modalDivisor: 5 });
  runReport('BTC C. Long+Short, sizing NORMAL', CANDLES_4H, { ...RESCALED_4H, allowShort: true, modalDivisor: 1 });
  const dBtc = runReport('BTC D. Long+Short + sizing 1/5 (PERMINTAAN OLAN)', CANDLES_4H, { ...RESCALED_4H, allowShort: true, modalDivisor: 5 });
  console.log('\n--- BTC D -- breakdown per tahun ---');
  Object.entries(byYear(dBtc.r.trades)).sort().forEach(([y, dt]) => {
    console.log(`  ${y}: ${dt.count} trade | win rate ${(dt.wins / dt.count * 100).toFixed(1)}% | Total R: ${dt.totalR >= 0 ? '+' : ''}${dt.totalR.toFixed(1)}R`);
  });

  if (CANDLES_4H_GOLD) {
    console.log('\n\n########## EMAS (PAXGUSDT) ##########');
    runReport('EMAS A. Buy-only, sizing NORMAL -- kontrol', CANDLES_4H_GOLD, { ...RESCALED_4H, allowShort: false, modalDivisor: 1 });
    runReport('EMAS B. Buy-only, sizing 1/5 (cheat)', CANDLES_4H_GOLD, { ...RESCALED_4H, allowShort: false, modalDivisor: 5 });
    runReport('EMAS C. Long+Short, sizing NORMAL', CANDLES_4H_GOLD, { ...RESCALED_4H, allowShort: true, modalDivisor: 1 });
    const dGold = runReport('EMAS D. Long+Short + sizing 1/5 (PERMINTAAN OLAN)', CANDLES_4H_GOLD, { ...RESCALED_4H, allowShort: true, modalDivisor: 5 });
    console.log('\n--- EMAS D -- breakdown per tahun ---');
    Object.entries(byYear(dGold.r.trades)).sort().forEach(([y, dt]) => {
      console.log(`  ${y}: ${dt.count} trade | win rate ${(dt.wins / dt.count * 100).toFixed(1)}% | Total R: ${dt.totalR >= 0 ? '+' : ''}${dt.totalR.toFixed(1)}R`);
    });
  }

  // 13 Sep 2026, permintaan Olan: "backtest sniper dan nyopet, btc dan emas" -- versi WINDOW-GATED
  // (bull=long, bear=short, BUKAN "Long+Short di semua kondisi" kayak varian C/D di atas).
  console.log('\n\n\n########## NYOPET 4H -- WINDOW-GATED (bull=long, bear=short, force-close on flip) ##########');
  const wgBtc = runReport('BTC Window-Gated, sizing 1/5', CANDLES_4H, { ...RESCALED_4H, modalDivisor: 5, bearWindowFn: makeBtcBearWindowFn() });
  console.log('\n--- BTC Window-Gated -- breakdown per tahun ---');
  Object.entries(byYear(wgBtc.r.trades)).sort().forEach(([y, dt]) => {
    console.log(`  ${y}: ${dt.count} trade | win rate ${(dt.wins / dt.count * 100).toFixed(1)}% | Total R: ${dt.totalR >= 0 ? '+' : ''}${dt.totalR.toFixed(1)}R`);
  });
  const btcWgFlips = wgBtc.r.trades.filter((t) => t.exitReason === 'WINDOW_FLIP');
  console.log(`  WINDOW_FLIP: ${btcWgFlips.length}x, totalPnl=$${btcWgFlips.reduce((s, t) => s + t.pnlUsd, 0).toFixed(2)}`);

  if (CANDLES_4H_GOLD) {
    const wgGold = runReport('EMAS Window-Gated, sizing 1/5', CANDLES_4H_GOLD, { ...RESCALED_4H, modalDivisor: 5, bearWindowFn: makeEmasBearWindowFn() });
    console.log('\n--- EMAS Window-Gated -- breakdown per tahun ---');
    Object.entries(byYear(wgGold.r.trades)).sort().forEach(([y, dt]) => {
      console.log(`  ${y}: ${dt.count} trade | win rate ${(dt.wins / dt.count * 100).toFixed(1)}% | Total R: ${dt.totalR >= 0 ? '+' : ''}${dt.totalR.toFixed(1)}R`);
    });
    const goldWgFlips = wgGold.r.trades.filter((t) => t.exitReason === 'WINDOW_FLIP');
    console.log(`  WINDOW_FLIP: ${goldWgFlips.length}x, totalPnl=$${goldWgFlips.reduce((s, t) => s + t.pnlUsd, 0).toFixed(2)}`);
  }
}

module.exports = { runNyopetV2Backtest, runNyopetV2BacktestWindowGated, makeBtcBearWindowFn, makeEmasBearWindowFn, detectBearishFVG, detectFvgSignalBoth, resampleTo4h, summarize, byYear, CANDLES_4H, CANDLES_4H_GOLD, RESCALED_4H };
