// ⛔ TIDAK DIPAKAI DI SISTEM LIVE (22 Agu 2026) -- dites, cacat struktural (zona retracement aktif
// SEBELUM koreksi beneran tuntas, ketauan zigzag baru konfirmasi belakangan) -- hasil jelek di
// semua ambang. Disimpan APA ADANYA sbg bagian dari ilmu/riset yang udah dijalani -- lihat rekap
// lengkap di memory project-kaela-btc-sinyal.
//
// Riset 22 Agu 2026 (permintaan Olan: "backtest Fibonacci retracement"). Strategi: dalam tren naik
// (swing low -> swing high via zigzag), tunggu harga koreksi masuk zona retracement 38,2%-61,8%
// dari kaki naik terakhir, cari konfirmasi pantulan (candle tutup lebih tinggi dari candle
// sebelumnya SAAT di dalam zona), baru entry LONG. SL di bawah level 78,6% (invalidasi standar --
// kalau ditembus, dianggap bukan koreksi sehat lagi tapi pembalikan tren). Exit pakai mekanisme
// 2-tier yang SAMA/tervalidasi di backtestFlagBreakout.js (apple-to-apple, cuma ganti ENTRY).

const { sma } = require('./technicalAnalysis');
const { hitung: hitungExposure } = require('./calculator');
const { zigzag } = require('./backtestElliottWave');

function runFibonacciBacktest(daily, opts = {}) {
  const {
    zigzagPct = 8, warmupDays = 60,
    zoneTopPct = 38.2, zoneBottomPct = 61.8, invalidPct = 78.6,
    partialRR = 2, trailSmaLen = 10,
    startCapital = 100, topUpAmount = 100, topUpStopAt = 1000, topUpDayOfMonth = 5,
    maxMarginPct = 20,
    // Filter tren besar (BARU, ketemu perlu setelah cek trade konkret -- banyak sinyal awal
    // ternyata beli pas pantulan kecil DI TENGAH bear market/crash, bukan koreksi sehat di
    // uptrend beneran). trendSmaLen=null = gak difilter (perilaku lama).
    trendSmaLen = 200,
  } = opts;

  const swings = zigzag(daily, zigzagPct);
  const watchZones = [];
  for (let k = 1; k < swings.length; k++) {
    const sLow = swings[k - 1], sHigh = swings[k];
    if (sLow.type !== 'low' || sHigh.type !== 'high') continue;
    const legLen = sHigh.price - sLow.price;
    if (legLen <= 0) continue;
    const zoneTop = sHigh.price - legLen * (zoneTopPct / 100);
    const zoneBottom = sHigh.price - legLen * (zoneBottomPct / 100);
    const invalidPrice = sHigh.price - legLen * (invalidPct / 100);
    const endIdx = k + 1 < swings.length ? swings[k + 1].idx : daily.length - 1;
    watchZones.push({ sLow, sHigh, zoneTop, zoneBottom, invalidPrice, endIdx });
  }

  const trades = [];
  const signals = [];
  let openPos = null;
  let capital = startCapital;
  let lastTopUpMonthKey = null;
  const capitalSeries = [{ time: daily[warmupDays] ? daily[warmupDays].closeTime : 0, capital }];

  for (let i = warmupDays; i < daily.length; i++) {
    const today = daily[i];
    const yesterday = daily[i - 1];
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

    // Cari watch-zone aktif: harga udah PERNAH masuk zona (low nembus ke zoneTop atau lebih
    // dalam) DAN belum invalid, konfirmasi pantulan WAJIB tutup balik DI ATAS zoneTop (bener-bener
    // reclaim keluar zona ke atas -- bukan cuma "tutup lebih tinggi dari kemarin" yang lemah/noise
    // dan gampang kejebak beli pas koreksi masih lanjut turun). 1 zona cuma boleh coba SEKALI
    // (zone._tried) biar gak whipsaw berulang di zona yang sama abis gagal.
    // PENTING (bug ketemu+fix 22 Agu 2026): zigzag deteksi swing dari harga PENUTUPAN, jadi cek
    // zona di sini WAJIB konsisten pakai CLOSE juga (bukan low/high intraday) -- versi lama pakai
    // today.low bikin entry bisa PERSIS di hari yg sama jadi puncak baru (low intraday hari itu
    // udah nyentuh zona sementara close-nya masih di titik tertinggi) -> beli tepat di puncak,
    // win rate 0%. i STRICT lebih besar dari sHigh.idx juga (bukan cuma i<sHigh.idx yg diskip)
    // biar gak ada 1 hari pun yg overlap sama hari puncak itu sendiri.
    const zone = watchZones.find((z) => {
      if (z._tried) return false;
      if (i <= z.sHigh.idx || i > z.endIdx) return false;
      if (today.close <= z.invalidPrice) { z._tried = true; return false; } // invalidasi duluan, zona gugur
      if (!z._touched && today.close <= z.zoneTop) z._touched = true; // pernah masuk zona (tutup)
      return z._touched && today.close > z.zoneTop;
    });
    if (!zone) continue;
    zone._tried = true;

    // Filter tren besar: cuma ambil kalau harga MASIH di atas SMA jangka panjang (uptrend
    // beneran), bukan pantulan kecil di tengah bear market/crash.
    if (trendSmaLen !== null) {
      const closesSoFarTrend = daily.slice(0, i + 1).map((c) => c.close);
      const trendSma = sma(closesSoFarTrend, trendSmaLen);
      if (trendSma !== null && today.close < trendSma) continue;
    }

    const lastPrice = today.close;
    const sl = zone.invalidPrice;
    const riskDistance = lastPrice - sl;
    if (riskDistance <= 0) continue;
    const nyawaPct = riskDistance / lastPrice * 100;
    const { nilaiPosisi, margin } = hitungExposure({ modal: capital, entry: lastPrice, stopLoss: sl });
    if (margin > capital) continue;
    const marginPct = margin / capital * 100;
    if (marginPct > maxMarginPct) continue;
    const lossAtSl = nilaiPosisi * (nyawaPct / 100);
    const partialTp = lastPrice + riskDistance * partialRR;

    signals.push({ time: today.closeTime, price: lastPrice, swingHigh: zone.sHigh.price, swingLow: zone.sLow.price });
    openPos = {
      direction: 'buy', entryPrice: lastPrice, sl, originalSl: sl, partialTp, entryTime: today.closeTime,
      nilaiPosisi, margin, marginPct, lossAtSl, partialDone: false, realizedPnl: 0, patternType: 'fib_bounce',
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

module.exports = { runFibonacciBacktest, summarize };

if (require.main === module) {
  const fs = require('fs');
  const path = require('path');
  const daily = JSON.parse(fs.readFileSync(path.join(__dirname, 'backtest', 'daily-cache.json'), 'utf8'));
  console.log('Daily candles:', daily.length);

  function line(label, r) {
    const s = summarize(r.trades);
    console.log(label.padEnd(30), '| sinyal='+r.signals.length, '| n='+s.n, '| WR='+s.winRate, '| PF='+s.profitFactor, '| totalR='+s.totalR, '| final=$'+r.finalCapital.toFixed(0), '| DD='+r.maxDrawdownPct.toFixed(1)+'%');
  }

  console.log('\n=== Fibonacci Retracement Bounce (zigzag % threshold sweep) ===');
  for (const pct of [5, 8, 10, 12, 15]) {
    line('zigzagPct=' + pct, runFibonacciBacktest(daily, { zigzagPct: pct }));
  }
}
