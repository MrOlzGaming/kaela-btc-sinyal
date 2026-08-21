// ⛔ TIDAK DIPAKAI DI SISTEM LIVE (22 Agu 2026) -- pola waktunya NYATA secara statistik (lolos uji
// kontrol jitter ketat), tapi begitu dicoba jadi FILTER buat sinyal Sniper, gak menaikkan hasil
// (baseline tanpa filter tetap menang). Disimpan APA ADANYA sbg bagian dari ilmu/riset yang udah
// dijalani -- lihat rekap lengkap di memory project-kaela-btc-sinyal.
//
// Riset 22 Agu 2026 (lanjutan riset Astronacci -- permintaan Olan). Fibonacci Time Zone TERBUKTI
// (via `backtestElliottWave.js` zigzag + kontrol jitter ketat) berkorelasi signifikan secara
// STATISTIK ke jarak waktu antar titik balik BTC (z-score -2,1 s.d -2,46) -- tapi itu cuma soal
// WAKTU, bukan ARAH. Di sini ditest jadi FILTER/PENGUAT buat sinyal Sniper yang udah ada
// (flag/wedge): apa sinyal Sniper yang muncul PAS DEKAT proyeksi Fibonacci Time Zone (dari swing
// besar terakhir) beneran lebih bagus hasilnya dibanding sinyal yang jauh dari proyeksi itu?

const { sma } = require('./technicalAnalysis');
const { hitung: hitungExposure } = require('./calculator');
const { detectFlag, detectWedge } = require('./chartPatterns');
const { zigzag } = require('./backtestElliottWave');

const FIB_DAYS = [1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233, 377];

// Cari jarak (hari) dari `today` ke proyeksi Fibonacci Time Zone TERDEKAT, dihitung CUMA dari
// swing besar PALING BARU yang udah kekonfirmasi sebelum hari ini (no look-ahead) -- bukan
// numpuk SEMUA swing sejarah (itu bikin proyeksi kelewat padat, hampir semua hari "dekat" ke
// proyeksi SALAH SATU swing, filter jadi gak berarti apa-apa -- ketauan pas tes pertama).
// Ini juga lebih sesuai cara Gann/Astronacci beneran dipakai: dari 1 pivot besar, bukan tumpukan.
function nearestFibProjectionDays(todayIdx, swings) {
  let lastSwing = null;
  for (const s of swings) {
    if (s.idx > todayIdx) break;
    lastSwing = s;
  }
  if (!lastSwing) return Infinity;
  let best = Infinity;
  for (const f of FIB_DAYS) {
    const dist = Math.abs((todayIdx - lastSwing.idx) - f);
    if (dist < best) best = dist;
  }
  return best;
}

function runSniperFibFilterBacktest(daily, opts = {}) {
  const {
    warmupDays = 60, poleLookbackRange = [5, 20], poleMinMovePct = 15, flagLookbackRange = [3, 15], flagMaxRangePct = 8,
    slBufferPct = 0.5, partialRR = 2, trailSmaLen = 10,
    startCapital = 100, topUpAmount = 100, topUpStopAt = 1000, topUpDayOfMonth = 5,
    wedgeLookbackRange = [15, 40], wedgeMinTouches = 2, wedgeConvergenceRatio = 0.65,
    maxMarginPct = 20, maxNyawaPct = null,
    zigzagPct = 8, tolDays = 3, // toleransi "dekat" proyeksi Fib Time Zone
    filterMode = 'all', // 'all' | 'near' (cuma ambil yg DEKAT proyeksi) | 'far' (cuma yg JAUH, kontrol pembanding)
  } = opts;

  const swings = zigzag(daily, zigzagPct);
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
        const hitSl = today.low <= openPos.sl;
        const hitPartial = today.high >= openPos.partialTp;
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
        const hitSl = today.low <= openPos.sl;
        const trendBroken = trailSma !== null && today.close < trailSma;
        if (hitSl || trendBroken) {
          const movePctSigned = (today.close - openPos.entryPrice) / openPos.entryPrice * 100;
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
    if (true) {
      const flag = detectFlag(daily, i, { poleLookbackRange, poleMinMovePct, flagLookbackRange, flagMaxRangePct });
      if (flag && flag.type === 'bull' && lastPrice > flag.flagHigh) { direction = 'buy'; sl = flag.flagLow * (1 - slBufferPct / 100); patternType = 'flag_bull'; }
    }
    if (!direction) {
      const wedge = detectWedge(daily, i, { wedgeLookbackRange, minTouches: wedgeMinTouches, convergenceRatio: wedgeConvergenceRatio });
      if (wedge && wedge.type === 'falling' && lastPrice > wedge.projectedResistance) { direction = 'buy'; sl = wedge.recentSwingLow * (1 - slBufferPct / 100); patternType = 'wedge_falling'; }
    }
    if (!direction) continue;

    // Filter Fibonacci Time Zone
    const fibDist = nearestFibProjectionDays(i, swings);
    const isNear = fibDist <= tolDays;
    if (filterMode === 'near' && !isNear) continue;
    if (filterMode === 'far' && isNear) continue;

    const riskDistance = Math.abs(lastPrice - sl);
    if (riskDistance === 0) continue;
    const nyawaPct = riskDistance / lastPrice * 100;
    if (maxNyawaPct !== null && nyawaPct > maxNyawaPct) continue;
    const { nilaiPosisi, margin } = hitungExposure({ modal: capital, entry: lastPrice, stopLoss: sl });
    if (margin > capital) continue;
    const marginPct = margin / capital * 100;
    if (marginPct > maxMarginPct) continue;
    const lossAtSl = nilaiPosisi * (nyawaPct / 100);
    const partialTp = lastPrice + riskDistance * partialRR;

    openPos = {
      direction, entryPrice: lastPrice, sl, originalSl: sl, partialTp, entryTime: today.closeTime,
      nilaiPosisi, margin, marginPct, lossAtSl, partialDone: false, realizedPnl: 0, patternType, fibDist,
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

module.exports = { runSniperFibFilterBacktest, summarize };

if (require.main === module) {
  const fs = require('fs');
  const path = require('path');
  const daily = JSON.parse(fs.readFileSync(path.join(__dirname, 'backtest', 'daily-cache.json'), 'utf8'));
  console.log('Daily candles:', daily.length);

  function line(label, r) {
    const s = summarize(r.trades);
    console.log(label.padEnd(35), '| n='+s.n, '| WR='+s.winRate, '| PF='+s.profitFactor, '| totalR='+s.totalR, '| final=$'+r.finalCapital.toFixed(0), '| DD='+r.maxDrawdownPct.toFixed(1)+'%');
  }

  console.log('\n=== Sniper + Fibonacci Time Zone filter (tolDays=3) ===');
  for (const [label, mode] of [['SEMUA sinyal (baseline)', 'all'], ['CUMA dekat proyeksi Fib', 'near'], ['CUMA jauh dari proyeksi (kontrol)', 'far']]) {
    line(label, runSniperFibFilterBacktest(daily, { filterMode: mode, tolDays: 3 }));
  }

  console.log('\n=== Sensitivitas toleransi hari ===');
  for (const tol of [1, 2, 3, 5, 7]) {
    line('near, tolDays=' + tol, runSniperFibFilterBacktest(daily, { filterMode: 'near', tolDays: tol }));
  }
}
