// Strategi BREAKOUT DARI POLA CHART SPESIFIK (10 Agu 2026, usulan Olan) -- beda dari Nyopet lama
// yang SL-nya diambil dari zona swing high/low umum (bisa jauh, nyawa lebar 10-38%). Di sini SL
// diambil dari lebar PATTERN-nya sendiri (bull flag / bear flag) -- pattern ini secara definisi
// SEMPIT (konsolidasi ketat abis gerakan tajam/"tiang"), jadi SL alami TIPIS tanpa dipaksa/arbitrer
// kayak percobaan cap 5% kemarin yang gagal (itu gagal krn maksa SL tipis di ATAS zona yg lebar,
// bukan krn pattern-nya sendiri emang sempit).
//
// Anatomi:
//   1. TIANG (pole): gerakan tajam searah, >=poleMinMovePct dalam poleLookbackDays.
//   2. BENDERA (flag): abis tiang, harga KONSOLIDASI SEMPIT (range <=flagMaxRangePct) selama
//      flagLookbackDays -- ini pause/napas pasar, BUKAN pembalikan.
//   3. BREAKOUT: harga tembus batas bendera SEARAH tiang -> entry, SL di ujung LAIN bendera
//      (sempit, karena bendera sendiri udah sempit).
//   4. Target 1:2 R diambil SEBAGIAN (jual separuh), sisanya di-trail (SL geser ke breakeven,
//      keluar kalau harga tutup di bawah/atas SMA pendek -- proksi "lihat kelakuan candle").

const { fetchWithRetry } = require('./httpRetry');
const { sma } = require('./technicalAnalysis');
const { hitung: hitungExposure } = require('./calculator');
const { detectFlag, detectWedge } = require('./chartPatterns');

const BASE_URL = 'https://data-api.binance.vision/api/v3/klines';
function parseCandle(raw) { return { openTime: raw[0], open: +raw[1], high: +raw[2], low: +raw[3], close: +raw[4], closeTime: raw[6] }; }
async function fetchAllCandles(symbol, interval, startTime) {
  let all = [];
  let cursor = startTime;
  for (;;) {
    const res = await fetchWithRetry(`${BASE_URL}?symbol=${symbol}&interval=${interval}&startTime=${cursor}&limit=1000`);
    const raw = await res.json();
    if (!raw.length) break;
    all = all.concat(raw.map(parseCandle));
    if (raw.length < 1000) break;
    cursor = raw[raw.length - 1][6] + 1;
  }
  return all;
}

// detectFlag/detectWedge dipindah ke chartPatterns.js (10 Agu 2026) -- dipakai bareng sama live
// (nyopetAutoAnalysis.js), satu sumber kebenaran.

function runFlagBacktest(daily, opts = {}) {
  const {
    warmupDays = 60, poleLookbackRange = [5, 20], poleMinMovePct = 15, flagLookbackRange = [3, 15], flagMaxRangePct = 8,
    slBufferPct = 0.5, partialRR = 2, trailSmaLen = 10, allowShort = true,
    startCapital = 100, topUpAmount = 100, topUpStopAt = 1000, topUpDayOfMonth = 5,
    // Pola mana yang mau di-scan tiap hari -- flag/pennant (lanjutan) dan/atau wedge (pembalikan).
    usePatterns = ['flag', 'wedge'],
    // wedgeMinTouches=2 (bukan 3 kayak "aturan textbook") -- dites 10 Agu 2026, TERBUKTI lebih
    // baik di SEMUA metrik (PF, totalR, DD, modal akhir) drpd syarat 3 sentuhan yang lebih ketat.
    // 3 sentuhan kebanyakan MISS wedge yang beneran valid tapi cuma kebentuk dari 2 titik jelas.
    wedgeLookbackRange = [15, 40], wedgeMinTouches = 2, wedgeConvergenceRatio = 0.65,
    // Batas keras margin/modal per-trade (10 Agu 2026, instruksi Olan: "gak boleh ada lagi posisi
    // margin super -- kita nyopet, bukan investasi"). Kalkulator exposure udah alami ngasih margin
    // kecil kalau nyawa tipis (pattern-based SL emang tipis), tapi ini jaring pengaman keras biar
    // gak ada 1 trade pun yang lolos dengan margin gede -- skip trade kalau kejadian.
    maxMarginPct = 20,
    // Batas keras nyawa% (12 Agu 2026, instruksi Olan: "nyopet ya pake nyawa dikit aja, max
    // nyawa% sesuai yang kita buat.. invalidasi diterima dengan lapang, gak maksa nyawa lebar
    // buat ukuran nyopet"). null = gak dibatasi (perilaku lama).
    maxNyawaPct = null,
  } = opts;
  const trades = [];
  let openPos = null;
  let capital = startCapital;
  let lastTopUpMonthKey = null;
  const capitalSeries = [{ time: daily[warmupDays] ? daily[warmupDays].closeTime : 0, capital }];

  for (let i = warmupDays; i < daily.length; i++) {
    const today = daily[i];
    const todayDate = new Date(today.closeTime);
    const curMonthKey = todayDate.getUTCFullYear() * 12 + todayDate.getUTCMonth();
    if (todayDate.getUTCDate() >= topUpDayOfMonth && curMonthKey !== lastTopUpMonthKey) {
      lastTopUpMonthKey = curMonthKey;
      if (capital < topUpStopAt) { capital += topUpAmount; capitalSeries.push({ time: today.closeTime, capital }); }
    }

    if (openPos) {
      const closes = daily.slice(0, i + 1).map((c) => c.close);
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
          openPos.realizedPnl = profitHalf;
          openPos.partialDone = true;
          openPos.sl = openPos.entryPrice; // breakeven buat sisa separuh
        }
      } else {
        // Separuh sisa: trail pakai SMA pendek -- proksi "lihat kelakuan candle" (keluar kalau
        // momentum jangka pendek udah patah, bukan nunggu SL lebar/statis).
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
      const flag = detectFlag(daily, i, { poleLookbackRange, poleMinMovePct, flagLookbackRange, flagMaxRangePct });
      if (flag && flag.type === 'bull' && lastPrice > flag.flagHigh) {
        direction = 'buy'; sl = flag.flagLow * (1 - slBufferPct / 100); patternType = 'flag_bull';
      } else if (flag && flag.type === 'bear' && lastPrice < flag.flagLow && allowShort) {
        direction = 'sell'; sl = flag.flagHigh * (1 + slBufferPct / 100); patternType = 'flag_bear';
      }
    }
    if (!direction && usePatterns.includes('wedge')) {
      const wedge = detectWedge(daily, i, { wedgeLookbackRange, minTouches: wedgeMinTouches, convergenceRatio: wedgeConvergenceRatio });
      // Rising wedge -> breakout TURUN (short). Falling wedge -> breakout NAIK (long). SL di
      // swing extreme TERAKHIR di dalam pola (bukan ujung bendera -- wedge beda geometri).
      if (wedge && wedge.type === 'rising' && lastPrice < wedge.projectedSupport && allowShort) {
        direction = 'sell'; sl = wedge.recentSwingHigh * (1 + slBufferPct / 100); patternType = 'wedge_rising';
      } else if (wedge && wedge.type === 'falling' && lastPrice > wedge.projectedResistance) {
        direction = 'buy'; sl = wedge.recentSwingLow * (1 - slBufferPct / 100); patternType = 'wedge_falling';
      }
    }
    if (!direction) continue;

    const riskDistance = Math.abs(lastPrice - sl);
    if (riskDistance === 0) continue;
    const nyawaPct = riskDistance / lastPrice * 100;
    if (maxNyawaPct !== null && nyawaPct > maxNyawaPct) continue; // invalidasi -- nyawa kelewat lebar buat ukuran nyopet
    const { nilaiPosisi, margin } = hitungExposure({ modal: capital, entry: lastPrice, stopLoss: sl });
    if (margin > capital) continue;
    const marginPct = margin / capital * 100;
    if (marginPct > maxMarginPct) continue; // jaring pengaman keras -- nyopet, bukan investasi
    const lossAtSl = nilaiPosisi * (nyawaPct / 100);
    const partialTp = direction === 'buy' ? lastPrice + riskDistance * partialRR : lastPrice - riskDistance * partialRR;

    openPos = {
      direction, entryPrice: lastPrice, sl, originalSl: sl, partialTp, entryTime: today.closeTime,
      nilaiPosisi, margin, marginPct, lossAtSl, partialDone: false, realizedPnl: 0, patternType,
    };
  }

  let peak = -Infinity, maxDrawdownPct = 0;
  for (const pt of capitalSeries) { peak = Math.max(peak, pt.capital); maxDrawdownPct = Math.max(maxDrawdownPct, (peak - pt.capital) / peak * 100); }
  return { trades, finalCapital: capital, maxDrawdownPct, capitalSeries };
}

function summarize(trades) {
  const n = trades.length;
  if (n === 0) return { n: 0 };
  const wins = trades.filter((t) => t.rMultiple > 0);
  const totalR = trades.reduce((s, t) => s + t.rMultiple, 0);
  const grossWinR = wins.reduce((s, t) => s + t.rMultiple, 0);
  const grossLossR = Math.abs(trades.filter((t) => t.rMultiple <= 0).reduce((s, t) => s + t.rMultiple, 0));
  return { n, winRate: (wins.length / n * 100).toFixed(1) + '%', profitFactor: grossLossR > 0 ? (grossWinR / grossLossR).toFixed(2) : 'inf', totalR: totalR.toFixed(2), avgR: (totalR / n).toFixed(2) };
}

module.exports = { runFlagBacktest, detectFlag, detectWedge, summarize, fetchAllCandles };

if (require.main === module) {
  (async () => {
    const startTime = new Date('2017-08-17').getTime();
    const daily = await fetchAllCandles('BTCUSDT', '1d', startTime);
    console.log('Daily candles:', daily.length);
    const r = runFlagBacktest(daily);
    console.log(JSON.stringify({ ...summarize(r.trades), finalCapital: '$' + r.finalCapital.toFixed(2), maxDD: r.maxDrawdownPct.toFixed(1) + '%' }, null, 2));
  })().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
}
