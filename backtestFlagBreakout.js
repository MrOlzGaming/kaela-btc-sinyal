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

// SCAN rentang panjang tiang & bendera yang FLEKSIBEL (10 Agu 2026, fix atas versi pertama yang
// cuma cek 1 kombinasi panjang tetap per hari -- dari 9 tahun data cuma nemu 1 sinyal, jelas
// bukan krn polanya beneran langka, tapi krn jendela pencarian terlalu kaku. Pola asli di pasar
// gak selalu persis N hari -- perlu discan beberapa kemungkinan panjang.
function detectFlag(daily, i, opts) {
  const { poleLookbackRange = [5, 20], poleMinMovePct, flagLookbackRange = [3, 15], flagMaxRangePct } = opts;
  for (let flagLen = flagLookbackRange[0]; flagLen <= flagLookbackRange[1]; flagLen++) {
    const flagStart = i - flagLen;
    if (flagStart < 1) continue;
    const flagWindow = daily.slice(flagStart, i); // belum termasuk hari ini (breakout day)
    if (flagWindow.length < 3) continue;
    const flagHigh = Math.max(...flagWindow.map((c) => c.high));
    const flagLow = Math.min(...flagWindow.map((c) => c.low));
    const flagRangePct = (flagHigh - flagLow) / flagLow * 100;
    if (flagRangePct > flagMaxRangePct) continue;

    for (let poleLen = poleLookbackRange[0]; poleLen <= poleLookbackRange[1]; poleLen++) {
      const poleStart = flagStart - poleLen;
      if (poleStart < 0) continue;
      const poleOpenPrice = daily[poleStart].close;
      const poleClosePrice = daily[flagStart].close;
      const poleMovePct = (poleClosePrice - poleOpenPrice) / poleOpenPrice * 100;
      if (poleMovePct >= poleMinMovePct && flagHigh <= poleClosePrice * 1.02) {
        return { type: 'bull', flagHigh, flagLow, poleMovePct, flagLen, poleLen };
      }
      if (poleMovePct <= -poleMinMovePct && flagLow >= poleClosePrice * 0.98) {
        return { type: 'bear', flagHigh, flagLow, poleMovePct, flagLen, poleLen };
      }
    }
  }
  return null;
}

function runFlagBacktest(daily, opts = {}) {
  const {
    warmupDays = 60, poleLookbackRange = [5, 20], poleMinMovePct = 15, flagLookbackRange = [3, 15], flagMaxRangePct = 8,
    slBufferPct = 0.5, partialRR = 2, trailSmaLen = 10, allowShort = true,
    startCapital = 100, topUpAmount = 100, topUpStopAt = 1000, topUpDayOfMonth = 5,
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

    const flag = detectFlag(daily, i, { poleLookbackRange, poleMinMovePct, flagLookbackRange, flagMaxRangePct });
    if (!flag) continue;
    if (flag.type === 'bear' && !allowShort) continue;

    const lastPrice = today.close;
    let direction, sl;
    if (flag.type === 'bull' && lastPrice > flag.flagHigh) {
      direction = 'buy'; sl = flag.flagLow * (1 - slBufferPct / 100);
    } else if (flag.type === 'bear' && lastPrice < flag.flagLow) {
      direction = 'sell'; sl = flag.flagHigh * (1 + slBufferPct / 100);
    } else continue;

    const riskDistance = Math.abs(lastPrice - sl);
    if (riskDistance === 0) continue;
    const nyawaPct = riskDistance / lastPrice * 100;
    const { nilaiPosisi, margin } = hitungExposure({ modal: capital, entry: lastPrice, stopLoss: sl });
    if (margin > capital) continue;
    const lossAtSl = nilaiPosisi * (nyawaPct / 100);
    const partialTp = direction === 'buy' ? lastPrice + riskDistance * partialRR : lastPrice - riskDistance * partialRR;

    openPos = {
      direction, entryPrice: lastPrice, sl, originalSl: sl, partialTp, entryTime: today.closeTime,
      nilaiPosisi, margin, lossAtSl, partialDone: false, realizedPnl: 0,
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

module.exports = { runFlagBacktest, detectFlag, summarize, fetchAllCandles };

if (require.main === module) {
  (async () => {
    const startTime = new Date('2017-08-17').getTime();
    const daily = await fetchAllCandles('BTCUSDT', '1d', startTime);
    console.log('Daily candles:', daily.length);
    const r = runFlagBacktest(daily);
    console.log(JSON.stringify({ ...summarize(r.trades), finalCapital: '$' + r.finalCapital.toFixed(2), maxDD: r.maxDrawdownPct.toFixed(1) + '%' }, null, 2));
  })().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
}
