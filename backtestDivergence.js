// ⛔ TIDAK DIPAKAI DI SISTEM LIVE (22 Agu 2026) -- dites, hasilnya NEGATIF (PF 0-0,41, sedikit
// sinyal juga). Disimpan APA ADANYA sbg bagian dari ilmu/riset yang udah dijalani -- lihat rekap
// lengkap di memory project-kaela-btc-sinyal.
//
// Riset 22 Agu 2026 (permintaan Olan: "Kaela juga bisa kasih sinyal bullish/bearish divergence").
// Deteksi BULLISH divergence: harga bikin LOWER LOW, tapi RSI di titik low kedua itu LEBIH TINGGI
// dari RSI di low pertama -- momentum turun sebenarnya melemah walau harga masih bikin rekor
// rendah baru (biasa nandain potensi pembalikan naik). Konfirmasi entry: harga breakout di atas
// puncak lokal ANTARA 2 low itu (bukan langsung entry pas low kedua -- terlalu berani/coba
// nangkep pisau jatuh). SL di bawah low kedua (titik invalidasi -- kalau ditembus, divergence-nya
// gak valid/gagal). Exit pakai mekanisme 2-tier yang SAMA kayak Sniper baseline (apple-to-apple).
//
// Fokus BULLISH doang (sesuai [[feedback-nyopet-buyonly]] -- short/bearish signal historisnya
// SELALU ngerusak hasil di BTC krn tren jangka panjang naik terus).

const { sma, rsi } = require('./technicalAnalysis');
const { hitung: hitungExposure } = require('./calculator');
const { zigzag } = require('./backtestElliottWave');

function runDivergenceBacktest(daily, opts = {}) {
  const {
    zigzagPct = 8, rsiPeriod = 14, warmupDays = 60,
    partialRR = 2, trailSmaLen = 10, slBufferPct = 0.5,
    startCapital = 100, topUpAmount = 100, topUpStopAt = 1000, topUpDayOfMonth = 5,
    maxMarginPct = 20,
  } = opts;

  const swings = zigzag(daily, zigzagPct);
  const lows = swings.filter((s) => s.type === 'low');
  const closes = daily.map((c) => c.close);

  function rsiAt(idx) {
    if (idx < rsiPeriod) return null;
    return rsi(closes.slice(0, idx + 1), rsiPeriod);
  }

  // Cari semua pasangan low berurutan yang bikin bullish divergence, simpan sbg "watch zone"
  // (nunggu breakout di atas puncak lokal antara 2 low itu, valid sampai low BERIKUTNYA muncul).
  const watchZones = [];
  for (let k = 1; k < lows.length; k++) {
    const l1 = lows[k - 1], l2 = lows[k];
    if (l2.price >= l1.price) continue; // wajib lower low di harga
    const r1 = rsiAt(l1.idx), r2 = rsiAt(l2.idx);
    if (r1 === null || r2 === null) continue;
    if (r2 <= r1) continue; // wajib RSI higher low (divergence)
    let peakBetween = -Infinity;
    for (let i = l1.idx; i <= l2.idx; i++) peakBetween = Math.max(peakBetween, daily[i].high);
    const endIdx = k + 1 < lows.length ? lows[k + 1].idx : daily.length - 1;
    watchZones.push({ l1, l2, peakBetween, endIdx });
  }

  const trades = [];
  const signals = [];
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
      const closesSoFar = daily.slice(0, i + 1).map((c) => c.close);
      const trailSma = sma(closesSoFar, trailSmaLen);
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

    const zone = watchZones.find((z) => i >= z.l2.idx && i <= z.endIdx && today.close > z.peakBetween);
    if (!zone) continue;

    const lastPrice = today.close;
    const sl = zone.l2.price * (1 - slBufferPct / 100);
    const riskDistance = lastPrice - sl;
    if (riskDistance <= 0) continue;
    const nyawaPct = riskDistance / lastPrice * 100;
    const { nilaiPosisi, margin } = hitungExposure({ modal: capital, entry: lastPrice, stopLoss: sl });
    if (margin > capital) continue;
    const marginPct = margin / capital * 100;
    if (marginPct > maxMarginPct) continue;
    const lossAtSl = nilaiPosisi * (nyawaPct / 100);
    const partialTp = lastPrice + riskDistance * partialRR;

    signals.push({ time: today.closeTime, price: lastPrice, l1Price: zone.l1.price, l2Price: zone.l2.price });
    openPos = {
      direction: 'buy', entryPrice: lastPrice, sl, originalSl: sl, partialTp, entryTime: today.closeTime,
      nilaiPosisi, margin, marginPct, lossAtSl, partialDone: false, realizedPnl: 0, patternType: 'bullish_divergence',
    };
  }

  let peak = -Infinity, maxDrawdownPct = 0;
  for (const pt of capitalSeries) { peak = Math.max(peak, pt.capital); maxDrawdownPct = Math.max(maxDrawdownPct, (peak - pt.capital) / peak * 100); }
  return { trades, signals, finalCapital: capital, maxDrawdownPct, capitalSeries };
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

module.exports = { runDivergenceBacktest, summarize };

if (require.main === module) {
  const fs = require('fs');
  const path = require('path');
  const daily = JSON.parse(fs.readFileSync(path.join(__dirname, 'backtest', 'daily-cache.json'), 'utf8'));
  console.log('Daily candles:', daily.length);

  function line(label, r) {
    const s = summarize(r.trades);
    console.log(label.padEnd(30), '| sinyal='+r.signals.length, '| n='+s.n, '| WR='+s.winRate, '| PF='+s.profitFactor, '| totalR='+s.totalR, '| final=$'+r.finalCapital.toFixed(0), '| DD='+r.maxDrawdownPct.toFixed(1)+'%');
  }

  console.log('\n=== Bullish RSI Divergence (zigzag % threshold sweep) ===');
  for (const pct of [5, 8, 10, 12, 15]) {
    line('zigzagPct=' + pct, runDivergenceBacktest(daily, { zigzagPct: pct }));
  }
}
