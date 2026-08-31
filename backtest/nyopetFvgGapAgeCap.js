// Riset (31 Agu 2026, ide Olan langsung dari observasi posisi live): FVG detector Nyopet numpang
// PERSIS mesin yang sama kayak Sniper (fvgDetector.js) -- nyisir mundur ke gap TERTUA yang belum
// keisi TANPA batas umur (cuma dibatasin total candle yang di-fetch, ~10 bulan buat 4H). Window
// LOOKBACK buat pola grafik (flag/wedge) UDAH di-rescale ×6 sepadan 4H, tapi bagian FVG KELEWAT
// -- observasi nyata: posisi Nyopet BTC live (31 Agu) punya nyawa 20,66% (di atas p99 historis
// 18,89%!), diduga gara-gara gap TUA yang baru "kesentuh" sekarang. Itu justru gaya SNIPER
// (sabar, struktur lama valid), bukan gaya "Nyopet" (cepat, struktur BARU).
//
// Riset ini: kasih BATAS umur gap (`maxGapAgeCandles`, dalam candle 4H) ke FVG detector, uji
// apa itu ningkatin/nurunin/gak ngaruh ke PF & profil trade Nyopet -- pakai rigor 3-lapis WAJIB
// (breakdown per tahun + split-era + sensitivitas parameter).
//
// SALINAN dari backtest/nyopetChartPatternFvg.js (BUKAN live code, aman diutak-atik) dengan
// SATU tambahan: opsi `maxGapAgeCandles` di FVG scan (default Infinity = perilaku SEKARANG,
// baseline buat perbandingan).

const fs = require('fs');
const path = require('path');
const { sma } = require('../technicalAnalysis');
const { hitung: hitungExposure } = require('../calculator');
const { detectFlag, detectWedge } = require('../chartPatterns');

const HOURLY_BTC = JSON.parse(fs.readFileSync(path.join(__dirname, 'hourly-cache.json'), 'utf8'));
const goldCachePath = path.join(__dirname, 'gold-hourly-cache.json');
const HOURLY_GOLD = fs.existsSync(goldCachePath) ? JSON.parse(fs.readFileSync(goldCachePath, 'utf8')) : null;

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

function detectBearishFVG(candles, i) {
  if (i < 2) return null;
  const c1 = candles[i - 2], c3 = candles[i];
  if (c1.low > c3.high) return { gapTop: c1.low, gapBottom: c3.high, createdIdx: i };
  return null;
}
function detectBullishFVG(candles, i) {
  if (i < 2) return null;
  const c1 = candles[i - 2], c3 = candles[i];
  if (c1.high < c3.low) return { gapTop: c3.low, gapBottom: c1.high, createdIdx: i };
  return null;
}

// SATU-SATUNYA perubahan dari versi asli: `maxGapAgeCandles` -- loop berhenti nyisir mundur kalau
// gap-nya udah lebih tua dari batas ini (i - k > maxGapAgeCandles), Infinity = gak dibatasin (baseline).
function detectFvgSignalBoth(candles, i, opts = {}) {
  const { slBufferPct = 0, trendSmaLen = 200, allowShort = true, maxGapAgeCandles = Infinity } = opts;
  const lastPrice = candles[i].close;
  let trendSma = null;
  if (trendSmaLen !== null && i >= trendSmaLen) {
    const closes = candles.slice(Math.max(0, i - trendSmaLen + 1), i + 1).map((c) => c.close);
    trendSma = closes.reduce((a, b) => a + b, 0) / closes.length;
  }

  if (trendSma === null || lastPrice >= trendSma) {
    for (let k = i - 1; k >= 2 && (i - k) <= maxGapAgeCandles; k--) {
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
        return { direction: 'buy', sl: fvg.gapBottom * (1 - slBufferPct / 100), patternType: 'fvg_bounce_long', gapCreatedTime: candles[k].closeTime, gapAgeCandles: i - k };
      }
      break;
    }
  }

  if (allowShort && (trendSma === null || lastPrice <= trendSma)) {
    for (let k = i - 1; k >= 2 && (i - k) <= maxGapAgeCandles; k--) {
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
        return { direction: 'sell', sl: fvg.gapTop * (1 + slBufferPct / 100), patternType: 'fvg_bounce_short', gapCreatedTime: candles[k].closeTime, gapAgeCandles: i - k };
      }
      break;
    }
  }
  return null;
}

function runNyopetV2Backtest(candles, opts = {}) {
  const {
    warmupCandles = 260,
    poleLookbackRange = [5, 20], poleMinMovePct = 15, flagLookbackRange = [3, 15], flagMaxRangePct = 8,
    wedgeLookbackRange = [15, 40], wedgeMinTouches = 2, wedgeConvergenceRatio = 0.65,
    usePatterns = ['flag', 'wedge', 'fvg'],
    slBufferPct = 0.5, partialRR = 2, trailSmaLen = 10, fvgTrendSmaLen = 200,
    allowShort = true,
    startCapital = 100,
    modalDivisor = 5,
    maxMarginPct = 20, maxNyawaPct = null,
    maxGapAgeCandles = Infinity, // <-- SATU-SATUNYA param baru dari versi asli
  } = opts;
  const trades = [];
  let openPos = null;
  let capital = startCapital;

  for (let i = warmupCandles; i < candles.length; i++) {
    const today = candles[i];

    if (openPos) {
      const closes = candles.slice(0, i + 1).map((c) => c.close);
      const trailSma = sma(closes, trailSmaLen);
      if (!openPos.partialDone) {
        const hitSl = openPos.direction === 'buy' ? today.low <= openPos.sl : today.high >= openPos.sl;
        const hitPartial = openPos.direction === 'buy' ? today.high >= openPos.partialTp : today.low <= openPos.partialTp;
        if (hitSl) {
          capital = Math.max(0, capital - openPos.lossAtSl);
          trades.push({ ...openPos, exitReason: 'SL', rMultiple: -1, pnlUsd: -openPos.lossAtSl, exitTime: today.closeTime });
          openPos = null;
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
          openPos = null;
        }
      }
      continue;
    }

    const lastPrice = today.close;
    let direction = null, sl = null, patternType = null, gapAgeCandles = null;

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
      const fvgSig = detectFvgSignalBoth(candles, i, { slBufferPct, trendSmaLen: fvgTrendSmaLen, allowShort, maxGapAgeCandles });
      if (fvgSig) { direction = fvgSig.direction; sl = fvgSig.sl; patternType = fvgSig.patternType; gapAgeCandles = fvgSig.gapAgeCandles; }
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

    openPos = {
      direction, entryPrice: lastPrice, sl, originalSl: sl, partialTp, entryTime: today.closeTime,
      nilaiPosisi, margin, marginPct, lossAtSl, partialDone: false, realizedPnl: 0, patternType, nyawaPct, gapAgeCandles,
    };
  }

  return { trades, finalCapital: capital };
}

function summarize(trades) {
  const n = trades.length;
  if (n === 0) return { n: 0 };
  const wins = trades.filter((t) => t.rMultiple > 0);
  const totalR = trades.reduce((s, t) => s + t.rMultiple, 0);
  const grossWinR = wins.reduce((s, t) => s + t.rMultiple, 0);
  const grossLossR = Math.abs(trades.filter((t) => t.rMultiple <= 0).reduce((s, t) => s + t.rMultiple, 0));
  return {
    n, winRate: (wins.length / n * 100).toFixed(1) + '%',
    profitFactor: grossLossR > 0 ? (grossWinR / grossLossR).toFixed(2) : 'inf',
    totalR: totalR.toFixed(2), avgR: (totalR / n).toFixed(2),
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

const RESCALED_4H = {
  poleLookbackRange: [30, 120], flagLookbackRange: [18, 90],
  wedgeLookbackRange: [90, 240], fvgTrendSmaLen: 1200, trailSmaLen: 60,
  warmupCandles: 1560,
};

module.exports = { runNyopetV2Backtest, summarize, byYear, CANDLES_4H, CANDLES_4H_GOLD, RESCALED_4H };
