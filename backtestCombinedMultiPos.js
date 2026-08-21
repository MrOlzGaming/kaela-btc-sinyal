// Riset 22 Agu 2026: simulasi Sniper (flag/wedge) + FVG jalan BARENGAN multi-posisi, tiap entry
// baru pakai SALDO AVAILABLE (modal total - margin yg udah kepakai posisi lain yang masih
// floating) lewat kalkulator exposure yang sama -- sesuai arahan Olan soal arsitektur multi-posisi.
// Exit tiap posisi independen (2-tier per-posisi, gak saling ganggu).

const { sma } = require('./technicalAnalysis');
const { hitung: hitungExposure } = require('./calculator');
const { detectFlag, detectWedge } = require('./chartPatterns');
const { detectBullishFVG } = require('./backtestFVG');

// Riset 22 Agu 2026 (Olan tanya "apa market choppy bisa dideteksi", nyambung ke diagnosa drawdown
// sebelumnya). Choppiness Index (E.W. Dreiss): 100*log10(sum(TrueRange,n)/(maxHigh-minLow))/log10(n)
// -- makin tinggi makin choppy (gerak zig-zag gak progress bersih), makin rendah makin trending.
// PENTING: ambang STANDAR (61,8/38,2) TERNYATA GAK NYAMBUNG ke BTC harian -- dicoba periode=14
// (default umum), hasilnya FLAT ~46-48 di periode choppy MAUPUN trending kuat (gak ada beda sama
// sekali). Baru kelihatan beda nyata di periode PANJANG (50-90 hari): choppy ~49-51 vs trending
// kuat ~38-43 -- ambang harus dikalibrasi ULANG khusus BTC, bukan pakai angka textbook mentah.
function trueRange(c, prevClose) { return Math.max(c.high - c.low, Math.abs(c.high - prevClose), Math.abs(c.low - prevClose)); }
function choppinessIndex(daily, i, period) {
  if (i < period) return null;
  let sumTR = 0, maxHi = -Infinity, minLo = Infinity;
  for (let k = i - period + 1; k <= i; k++) {
    sumTR += trueRange(daily[k], daily[k - 1].close);
    maxHi = Math.max(maxHi, daily[k].high); minLo = Math.min(minLo, daily[k].low);
  }
  const range = maxHi - minLo;
  if (range === 0) return null;
  return 100 * Math.log10(sumTR / range) / Math.log10(period);
}

function runCombinedBacktest(daily, opts = {}) {
  const {
    warmupDays = 60, poleLookbackRange = [5, 20], poleMinMovePct = 15, flagLookbackRange = [3, 15], flagMaxRangePct = 8,
    slBufferPct = 0.5, partialRR = 2, trailSmaLen = 10,
    startCapital = 100, topUpAmount = 100, topUpStopAt = 1000, topUpDayOfMonth = 5,
    wedgeLookbackRange = [15, 40], wedgeMinTouches = 2, wedgeConvergenceRatio = 0.65,
    maxMarginPct = 20, maxNyawaPct = null, trendSmaLen = 200,
    modes = ['sniper', 'fvg'],
    // Riset 22 Agu 2026 (diagnosa drawdown -- Olan minta cek penyebab DD, ketemu: BUKAN SL
    // kelewat tipis, tapi 20% dari total hari kedua mode BARENGAN buka posisi, saling numpuk
    // resiko pas market choppy). sharedRiskBudget=true: cap margin dihitung dari TOTAL modal
    // (bukan availNow per-posisi) -- jadi 2 posisi bareng jatahnya SAMA 20% GABUNGAN, bukan
    // 20%+20% independen.
    sharedRiskBudget = false,
    chopPeriod = null, chopThreshold = 45, // chopPeriod=null = filter mati (perilaku lama)
    // Aturan Turtle Traders (Richard Dennis, riset 22 Agu 2026 -- Olan minta cari trader top):
    // LEWATIN sinyal baru kalau sinyal SEBELUMNYA (mode yang SAMA) dalam skipWindowDays terakhir
    // itu MENANG -- logika: jarang ada 2 breakout menang beruntun di window pendek, yg kedua
    // biasanya whipsaw dari gerakan yg udah "kecapean". skipWindowDays=null = mati (perilaku lama).
    skipWindowDays = null,
    // Ide Olan (22 Agu 2026): "matikan sinyal pas window mendekati puncak siklus halving menuju
    // bottom lagi" -- window ISTIRAHAT = dari akhir Musim Panen (halving+549 hari) sampai awal
    // Musim Tanam siklus BERIKUTNYA (halving_next-542 hari), ~0,85-1,0 tahun/siklus. Verifikasi
    // kasar: 26 trade yang entry-nya jatuh di window ini RUGI -$19.753 total, 98 trade di luar
    // UNTUNG +$58.109 -- window ini kemungkinan besar nangkep fase bear/crash pasca-puncak siklus.
    haltInBearWindow = false,
  } = opts;
  const HALVINGS_FOR_BEAR = ['2016-07-09', '2020-05-11', '2024-04-19', '2028-04-13'];
  const bearWindows = [];
  for (let hi = 0; hi < HALVINGS_FOR_BEAR.length - 1; hi++) {
    const h = new Date(HALVINGS_FOR_BEAR[hi]).getTime();
    const hNext = new Date(HALVINGS_FOR_BEAR[hi + 1]).getTime();
    bearWindows.push({ start: h + 549 * 86400000, end: hNext - 542 * 86400000 });
  }
  function isBearWindow(ms) { return bearWindows.some((w) => ms >= w.start && ms <= w.end); }
  const lastResultByMode = {}; // { sniper: {won, exitTime}, fvg: {...} }

  const trades = [];
  let openPositions = []; // bisa lebih dari 1 sekaligus
  let activeFvgs = [];
  let capital = startCapital;
  let lastTopUpMonthKey = null;
  const capitalSeries = [{ time: daily[warmupDays] ? daily[warmupDays].closeTime : 0, capital }];

  function availableCapital() {
    const usedMargin = openPositions.reduce((s, p) => s + p.margin, 0);
    return Math.max(0, capital - usedMargin);
  }

  // PENTING (bug ketemu+fix): `capitalDelta` = SISA yang belum ditambahin ke capital sampai titik
  // ini (buat trade yang partial-exit duluan, realizedPnl/profitHalf UDAH ditambahin capital pas
  // partial itu terjadi -- kalau closePosition nambahin `totalPnl` lagi di sini, itu HITUNG GANDA
  // realizedPnl-nya). `pnlUsd` = angka LENGKAP (realizedPnl+sisa) buat DICATAT di record trade,
  // beda dari `capitalDelta` yang cuma porsi capital yang BELUM masuk.
  function closePosition(pos, reasonFull, exitPrice, exitTime, pnlUsd, capitalDelta = pnlUsd) {
    capital = Math.max(0, capital + capitalDelta);
    trades.push({ ...pos, exitReason: reasonFull, pnlUsd, exitTime });
    capitalSeries.push({ time: exitTime, capital });
    const modeKey = pos.patternType.startsWith('fvg') ? 'fvg' : 'sniper';
    lastResultByMode[modeKey] = { won: pnlUsd > 0, exitTime };
  }

  for (let i = warmupDays; i < daily.length; i++) {
    const today = daily[i];
    const todayDate = new Date(today.closeTime);
    const curMonthKey = todayDate.getUTCFullYear() * 12 + todayDate.getUTCMonth();
    if (todayDate.getUTCDate() >= topUpDayOfMonth && curMonthKey !== lastTopUpMonthKey) {
      lastTopUpMonthKey = curMonthKey;
      if (capital < topUpStopAt) { capital += topUpAmount; capitalSeries.push({ time: today.closeTime, capital }); }
    }

    const fvgNew = detectBullishFVG(daily, i);
    if (fvgNew) activeFvgs.push(fvgNew);
    activeFvgs = activeFvgs.filter((z) => i <= z.createdIdx || today.low > z.gapBottom);

    const closesSoFar = daily.slice(0, i + 1).map((c) => c.close);
    const trailSma = sma(closesSoFar, trailSmaLen);

    // Proses semua posisi terbuka (independen)
    const stillOpen = [];
    for (const pos of openPositions) {
      if (!pos.partialDone) {
        const hitSl = today.low <= pos.sl;
        const hitPartial = today.high >= pos.partialTp;
        if (hitSl) {
          closePosition(pos, 'SL', pos.sl, today.closeTime, -pos.lossAtSl);
          continue;
        } else if (hitPartial) {
          const rewardPct = Math.abs(pos.partialTp - pos.entryPrice) / pos.entryPrice * 100;
          const profitHalf = pos.nilaiPosisi * 0.5 * (rewardPct / 100);
          capital += profitHalf; capitalSeries.push({ time: today.closeTime, capital });
          pos.realizedPnl = profitHalf; pos.partialDone = true; pos.sl = pos.entryPrice;
        }
      } else {
        const hitSl = today.low <= pos.sl;
        const trendBroken = trailSma !== null && today.close < trailSma;
        if (hitSl || trendBroken) {
          const movePctSigned = (today.close - pos.entryPrice) / pos.entryPrice * 100;
          const pnlRest = pos.nilaiPosisi * 0.5 * (movePctSigned / 100);
          const totalPnl = pos.realizedPnl + pnlRest;
          closePosition(pos, hitSl ? 'SL_BREAKEVEN' : 'TRAIL_EXIT', today.close, today.closeTime, totalPnl, pnlRest);
          continue;
        }
      }
      stillOpen.push(pos);
    }
    openPositions = stillOpen;

    // Cari sinyal BARU. PENTING (bug ketemu+fix): tiap MODE cuma boleh punya 1 posisi aktif
    // SENDIRI-SENDIRI (persis kayak versi single-position yang udah tervalidasi) -- tanpa ini,
    // pola breakout yang sama kesangkut valid berhari-hari bikin entry DOBEL TERUS tiap hari
    // (ketauan: n meledak 69->472, DD 99,6%). Beda mode (Sniper vs FVG) TETAP boleh jalan
    // BARENGAN, cuma masing-masing dibatasi 1 posisi.
    const avail = availableCapital();
    if (avail <= 1) continue;
    if (haltInBearWindow && isBearWindow(today.closeTime)) continue;

    // Filter Choppiness Index: kalau market lagi choppy (di atas ambang), SKIP semua sinyal baru
    // hari ini -- baik Sniper maupun FVG (keduanya continuation-style, sama-sama rawan whipsaw
    // pas choppy, ini yang ketauan jadi akar masalah drawdown 55,2%).
    if (chopPeriod !== null) {
      const chop = choppinessIndex(daily, i, chopPeriod);
      if (chop !== null && chop > chopThreshold) continue;
    }

    const modesInUse = new Set(openPositions.map((p) => p.patternType.startsWith('fvg') ? 'fvg' : 'sniper'));

    function skippedByTurtleRule(modeKey) {
      if (skipWindowDays === null) return false;
      const last = lastResultByMode[modeKey];
      if (!last || !last.won) return false;
      return (today.closeTime - last.exitTime) / 86400000 < skipWindowDays;
    }

    const trendSmaFilter = sma(closesSoFar, trendSmaLen);
    const candidates = [];

    if (modes.includes('sniper') && !modesInUse.has('sniper') && !skippedByTurtleRule('sniper')) {
      const lastPrice = today.close;
      let direction = null, sl = null, patternType = null;
      const flag = detectFlag(daily, i, { poleLookbackRange, poleMinMovePct, flagLookbackRange, flagMaxRangePct });
      if (flag && flag.type === 'bull' && lastPrice > flag.flagHigh) { direction = 'buy'; sl = flag.flagLow * (1 - slBufferPct / 100); patternType = 'flag_bull'; }
      if (!direction) {
        const wedge = detectWedge(daily, i, { wedgeLookbackRange, minTouches: wedgeMinTouches, convergenceRatio: wedgeConvergenceRatio });
        if (wedge && wedge.type === 'falling' && lastPrice > wedge.projectedResistance) { direction = 'buy'; sl = wedge.recentSwingLow * (1 - slBufferPct / 100); patternType = 'wedge_falling'; }
      }
      if (direction) candidates.push({ entryPrice: lastPrice, sl, patternType });
    }

    if (modes.includes('fvg') && !modesInUse.has('fvg') && !skippedByTurtleRule('fvg') && (trendSmaFilter === null || today.close >= trendSmaFilter)) {
      const zone = activeFvgs.find((z) => {
        if (i <= z.createdIdx) return false;
        if (!z._touched && today.low <= z.gapTop) z._touched = true;
        return z._touched && today.close > z.gapTop;
      });
      if (zone) {
        candidates.push({ entryPrice: today.close, sl: zone.gapBottom, patternType: 'fvg_bounce' });
        activeFvgs = activeFvgs.filter((z) => z !== zone);
      }
    }

    for (const cand of candidates) {
      const availNow = availableCapital();
      if (availNow <= 1) break;
      const riskDistance = cand.entryPrice - cand.sl;
      if (riskDistance <= 0) continue;
      const nyawaPct = riskDistance / cand.entryPrice * 100;
      if (maxNyawaPct !== null && nyawaPct > maxNyawaPct) continue;
      const { nilaiPosisi, margin } = hitungExposure({ modal: availNow, entry: cand.entryPrice, stopLoss: cand.sl });
      if (margin > availNow) continue;
      const marginPct = margin / availNow * 100;
      if (marginPct > maxMarginPct) continue;
      // sharedRiskBudget: TOTAL margin gabungan (posisi yang UDAH terbuka + posisi baru ini)
      // gak boleh lebih dari maxMarginPct% dari CAPITAL PENUH -- biar 2 posisi bareng jatahnya
      // 20% GABUNGAN, bukan 20%+20% independen (akar masalah DD 55,2% yang ketemu barusan).
      if (sharedRiskBudget) {
        const existingMargin = openPositions.reduce((s, p) => s + p.margin, 0);
        const combinedPct = (existingMargin + margin) / capital * 100;
        if (combinedPct > maxMarginPct) continue;
      }
      const lossAtSl = nilaiPosisi * (nyawaPct / 100);
      const partialTp = cand.entryPrice + riskDistance * partialRR;
      openPositions.push({
        direction: 'buy', entryPrice: cand.entryPrice, sl: cand.sl, originalSl: cand.sl, partialTp, entryTime: today.closeTime,
        nilaiPosisi, margin, marginPct, lossAtSl, partialDone: false, realizedPnl: 0, patternType: cand.patternType,
      });
    }
  }

  let peak = -Infinity, maxDrawdownPct = 0;
  for (const pt of capitalSeries) { peak = Math.max(peak, pt.capital); maxDrawdownPct = Math.max(maxDrawdownPct, (peak - pt.capital) / peak * 100); }
  return { trades, finalCapital: capital, maxDrawdownPct, capitalSeries };
}

function summarize(trades) {
  const n = trades.length;
  if (n === 0) return { n: 0 };
  const wins = trades.filter((t) => (t.rMultiple !== undefined ? t.rMultiple > 0 : t.pnlUsd > 0));
  const totalPnl = trades.reduce((s, t) => s + t.pnlUsd, 0);
  const grossWin = trades.filter((t) => t.pnlUsd > 0).reduce((s, t) => s + t.pnlUsd, 0);
  const grossLoss = Math.abs(trades.filter((t) => t.pnlUsd <= 0).reduce((s, t) => s + t.pnlUsd, 0));
  return { n, winRate: (wins.length / n * 100).toFixed(1) + '%', profitFactor: grossLoss > 0 ? (grossWin / grossLoss).toFixed(2) : 'inf', totalPnl: totalPnl.toFixed(0) };
}

module.exports = { runCombinedBacktest, summarize };

if (require.main === module) {
  const fs = require('fs');
  const path = require('path');
  const daily = JSON.parse(fs.readFileSync(path.join(__dirname, 'backtest', 'daily-cache.json'), 'utf8'));
  console.log('Daily candles:', daily.length);

  function line(label, r) {
    const s = summarize(r.trades);
    console.log(label.padEnd(30), '| n='+s.n, '| WR='+s.winRate, '| PF='+s.profitFactor, '| final=$'+r.finalCapital.toFixed(0), '| DD='+r.maxDrawdownPct.toFixed(1)+'%');
  }

  console.log('\n=== Multi-posisi: Sniper doang vs FVG doang vs GABUNGAN ===');
  line('Sniper doang (multi-pos infra)', runCombinedBacktest(daily, { modes: ['sniper'] }));
  line('FVG doang (multi-pos infra)', runCombinedBacktest(daily, { modes: ['fvg'] }));
  line('GABUNGAN Sniper+FVG', runCombinedBacktest(daily, { modes: ['sniper', 'fvg'] }));
}
