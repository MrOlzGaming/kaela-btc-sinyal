// ⛔ TIDAK DIPAKAI DI SISTEM LIVE (22 Agu 2026) -- dites, sinyalnya kelewat jarang (0-7 dari 9
// tahun tergantung ambang zigzag), gak cukup buat dipercaya. Disimpan APA ADANYA sbg bagian dari
// ilmu/riset yang udah dijalani -- lihat rekap lengkap di memory project-kaela-btc-sinyal.
//
// Riset 22 Agu 2026 (permintaan Olan: "belajar Elliott Wave, backtest matematis buat BTC") --
// PENTING: ini BUKAN Elliott Wave asli (yang butuh interpretasi manusia, diakui luas SUBJEKTIF --
// 2 analis bisa beda hitungan gelombang). Ini PROKSI OBJEKTIF: deteksi swing (zigzag) otomatis,
// lalu cek programatis apakah rangkaian 5 titik MEMENUHI 3 aturan wajib EW (gelombang 2 gak
// retrace >100% gelombang 1, gelombang 3 gak boleh terpendek, gelombang 4 gak overlap gelombang 1).
// Begitu gelombang 1-2-3-4 valid kedeteksi, entry LONG pas breakout di atas puncak gelombang 3
// (sinyal gelombang 5 dimulai), SL di bawah lembah gelombang 4 (titik invalidasi count).
// Exit pakai mekanisme 2-tier yang SAMA/udah tervalidasi di backtestFlagBreakout.js (Sniper
// baseline) -- biar pembanding apple-to-apple, EW di sini cuma ganti METODE ENTRY, bukan exit.

const { sma } = require('./technicalAnalysis');
const { hitung: hitungExposure } = require('./calculator');

// --- Zigzag: deteksi swing high/low pakai filter % reversal ---
function zigzag(daily, thresholdPct) {
  const swings = [];
  let dir = 0; // 0=belum tau, 1=naik, -1=turun
  let lastExtreme = daily[0].close, lastExtremeIdx = 0;

  for (let i = 1; i < daily.length; i++) {
    const c = daily[i].close;
    if (dir >= 0 && c >= lastExtreme) { lastExtreme = c; lastExtremeIdx = i; dir = 1; continue; }
    if (dir <= 0 && c <= lastExtreme) { lastExtreme = c; lastExtremeIdx = i; dir = -1; continue; }

    const movePct = Math.abs(c - lastExtreme) / lastExtreme * 100;
    if (movePct >= thresholdPct) {
      swings.push({ idx: lastExtremeIdx, time: daily[lastExtremeIdx].closeTime, price: lastExtreme, type: dir === 1 ? 'high' : 'low' });
      dir = dir === 1 ? -1 : 1;
      lastExtreme = c; lastExtremeIdx = i;
    }
  }
  swings.push({ idx: lastExtremeIdx, time: daily[lastExtremeIdx].closeTime, price: lastExtreme, type: dir >= 0 ? 'high' : 'low' });
  return swings;
}

// Cek 5 titik swing (S0=awal, S1=puncak G1, S2=lembah G2, S3=puncak G3, S4=lembah G4) buat
// impuls BULLISH -- 3 aturan wajib EW. minRatio3 = filter opsional biar gelombang 3 gak cuma
// "gak terpendek" scr teknis tapi beneran kuat (rasio Fibonacci wajar, default longgar).
function checkBullishImpulse(s0, s1, s2, s3, s4) {
  if (s0.type !== 'low' || s1.type !== 'high' || s2.type !== 'low' || s3.type !== 'high' || s4.type !== 'low') return false;
  const wave1 = s1.price - s0.price;
  const wave2 = s1.price - s2.price;
  const wave3 = s3.price - s2.price;
  const wave4 = s3.price - s4.price;
  if (wave1 <= 0 || wave3 <= 0) return false;
  // Aturan 1: gelombang 2 gak retrace >100% gelombang 1 (S2 gak boleh di bawah S0)
  if (s2.price <= s0.price) return false;
  // Aturan 2: gelombang 3 gak boleh TERPENDEK di antara 1/3/5 -- G5 belum kebentuk, jadi
  // dicek longgar: G3 minimal >= G1 (paling umum G3 malah paling panjang).
  if (wave3 < wave1) return false;
  // Aturan 3: gelombang 4 gak overlap wilayah gelombang 1 (lembah G4 gak boleh di bawah puncak G1)
  if (s4.price <= s1.price) return false;
  return { wave1, wave2, wave3, wave4 };
}

function runElliottBacktest(daily, opts = {}) {
  const {
    zigzagPct = 8, warmupDays = 60,
    partialRR = 2, trailSmaLen = 10, slBufferPct = 0.5,
    startCapital = 100, topUpAmount = 100, topUpStopAt = 1000, topUpDayOfMonth = 5,
    maxMarginPct = 20,
  } = opts;

  const swings = zigzag(daily, zigzagPct);
  const trades = [];
  const signals = []; // titik-titik wave5-breakout kedeteksi (buat debug/laporan)
  let openPos = null;
  let capital = startCapital;
  let lastTopUpMonthKey = null;
  const capitalSeries = [{ time: daily[warmupDays] ? daily[warmupDays].closeTime : 0, capital }];

  // Precompute: buat tiap index hari, cari apakah ini hari breakout valid (S3.price ditembus
  // SETELAH S4 kebentuk, dgn S0..S4 valid impuls). Simple scan: buat tiap kombinasi 5 swing
  // berurutan yg valid, tandai "watch zone" dari S4.idx sampai swing berikutnya (atau akhir data),
  // breakout = candle close pertama yg tembus S3.price dalam watch zone itu.
  const watchZones = [];
  for (let k = 4; k < swings.length; k++) {
    const [s0, s1, s2, s3, s4] = [swings[k - 4], swings[k - 3], swings[k - 2], swings[k - 1], swings[k]];
    const res = checkBullishImpulse(s0, s1, s2, s3, s4);
    if (res) watchZones.push({ s0, s1, s2, s3, s4, endIdx: k + 1 < swings.length ? swings[k + 1].idx : daily.length - 1 });
  }

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

    // Cari watch-zone aktif hari ini (S4 udah kebentuk, blm ada swing baru gantiin) yg breakout
    const zone = watchZones.find((z) => i >= z.s4.idx && i <= z.endIdx && today.close > z.s3.price);
    if (!zone) continue;

    const lastPrice = today.close;
    const sl = zone.s4.price * (1 - slBufferPct / 100); // di bawah lembah G4, titik invalidasi count
    const riskDistance = lastPrice - sl;
    if (riskDistance <= 0) continue;
    const nyawaPct = riskDistance / lastPrice * 100;
    const { nilaiPosisi, margin } = hitungExposure({ modal: capital, entry: lastPrice, stopLoss: sl });
    if (margin > capital) continue;
    const marginPct = margin / capital * 100;
    if (marginPct > maxMarginPct) continue;
    const lossAtSl = nilaiPosisi * (nyawaPct / 100);
    const partialTp = lastPrice + riskDistance * partialRR;

    signals.push({ time: today.closeTime, price: lastPrice, wave1: zone.s1.price - zone.s0.price, wave3: zone.s3.price - zone.s2.price });
    openPos = {
      direction: 'buy', entryPrice: lastPrice, sl, originalSl: sl, partialTp, entryTime: today.closeTime,
      nilaiPosisi, margin, marginPct, lossAtSl, partialDone: false, realizedPnl: 0, patternType: 'ew_wave5',
    };
  }

  let peak = -Infinity, maxDrawdownPct = 0;
  for (const pt of capitalSeries) { peak = Math.max(peak, pt.capital); maxDrawdownPct = Math.max(maxDrawdownPct, (peak - pt.capital) / peak * 100); }
  return { trades, signals, finalCapital: capital, maxDrawdownPct, capitalSeries, swingCount: swings.length };
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

module.exports = { runElliottBacktest, zigzag, checkBullishImpulse, summarize };

if (require.main === module) {
  const fs = require('fs');
  const path = require('path');
  const cachePath = path.join(__dirname, 'backtest', 'daily-cache.json');
  const daily = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
  console.log('Daily candles:', daily.length);

  function line(label, r) {
    const s = summarize(r.trades);
    console.log(label.padEnd(30), '| swing='+r.swingCount, '| sinyal='+r.signals.length, '| n='+s.n, '| WR='+s.winRate, '| PF='+s.profitFactor, '| totalR='+s.totalR, '| final=$'+r.finalCapital.toFixed(0), '| DD='+r.maxDrawdownPct.toFixed(1)+'%');
  }

  console.log('\n=== Elliott Wave proksi (zigzag % threshold sweep) ===');
  for (const pct of [5, 8, 10, 12, 15, 20]) {
    line('zigzagPct=' + pct, runElliottBacktest(daily, { zigzagPct: pct }));
  }
}
