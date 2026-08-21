// Deteksi pola chart breakout (10 Agu 2026) -- diekstrak dari backtestFlagBreakout.js supaya
// SATU sumber kebenaran dipakai backtest MAUPUN live (sniperAutoAnalysis.js), gak ada logika
// duplikat yang bisa kegeser beda satu sama lain. Lihat backtestFlagBreakout.js buat riset/hasil
// validasi lengkapnya -- file ini murni fungsi deteksi, gak ada logic backtest/simulasi di sini.
//
// 2 jenis pola, KARAKTER BEDA:
//   FLAG/PENNANT (lanjutan) -- tiang (gerakan tajam) + bendera (konsolidasi sempit) + breakout
//     SEARAH tiang. SL di ujung lain bendera.
//   WEDGE (pembalikan) -- 2 trendline (dari swing high & swing low) konvergen ke arah SAMA,
//     breakout KEBALIKAN dari kemiringan wedge-nya sendiri. SL di swing extreme terakhir.

const { findSwingPoints } = require('./technicalAnalysis');

function linearRegression(points) {
  const n = points.length;
  if (n < 2) return null;
  const sumX = points.reduce((s, p) => s + p.x, 0);
  const sumY = points.reduce((s, p) => s + p.y, 0);
  const sumXY = points.reduce((s, p) => s + p.x * p.y, 0);
  const sumXX = points.reduce((s, p) => s + p.x * p.x, 0);
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return null;
  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  return { slope, intercept };
}

// Bedain FLAG (kanal konsolidasi kira-kira SEJAJAR/rectangular) dari PENNANT (segitiga kecil
// yang MENGERUCUT) -- 22 Agu 2026, ketemu perlu krn kode lama nyamain dua-duanya jadi label
// gabungan "Flag/Pennant" walau bentuknya beda. Cara paling robust buat window PENDEK (3-15
// candle, kadang kurang buat regresi titik swing yang layak): bandingin lebar (high-low) SEPARUH
// AWAL window vs SEPARUH AKHIR -- kalau separuh akhir MENGERUCUT signifikan (rasio <=0,6), itu
// pennant (segitiga makin sempit ke ujung); kalau lebarnya relatif konsisten, itu flag.
function classifyConsolidationShape(flagWindow) {
  const mid = Math.floor(flagWindow.length / 2);
  if (mid < 1) return 'flag';
  const firstHalf = flagWindow.slice(0, mid);
  const secondHalf = flagWindow.slice(mid);
  const rangeOf = (w) => Math.max(...w.map((c) => c.high)) - Math.min(...w.map((c) => c.low));
  const firstRange = rangeOf(firstHalf);
  const secondRange = rangeOf(secondHalf);
  if (firstRange <= 0) return 'flag';
  return (secondRange / firstRange) <= 0.6 ? 'pennant' : 'flag';
}

// SCAN rentang panjang tiang & bendera yang FLEKSIBEL -- pola asli di pasar gak selalu persis
// N hari, perlu discan beberapa kemungkinan panjang tiap hari.
function detectFlag(daily, i, opts = {}) {
  const { poleLookbackRange = [5, 20], poleMinMovePct = 20, flagLookbackRange = [3, 15], flagMaxRangePct = 8 } = opts;
  for (let flagLen = flagLookbackRange[0]; flagLen <= flagLookbackRange[1]; flagLen++) {
    const flagStart = i - flagLen;
    if (flagStart < 1) continue;
    const flagWindow = daily.slice(flagStart, i); // belum termasuk hari ini (breakout day)
    if (flagWindow.length < 3) continue;
    const flagHigh = Math.max(...flagWindow.map((c) => c.high));
    const flagLow = Math.min(...flagWindow.map((c) => c.low));
    const flagRangePct = (flagHigh - flagLow) / flagLow * 100;
    if (flagRangePct > flagMaxRangePct) continue;
    const shape = classifyConsolidationShape(flagWindow);

    for (let poleLen = poleLookbackRange[0]; poleLen <= poleLookbackRange[1]; poleLen++) {
      const poleStart = flagStart - poleLen;
      if (poleStart < 0) continue;
      const poleOpenPrice = daily[poleStart].close;
      const poleClosePrice = daily[flagStart].close;
      const poleMovePct = (poleClosePrice - poleOpenPrice) / poleOpenPrice * 100;
      if (poleMovePct >= poleMinMovePct && flagHigh <= poleClosePrice * 1.02) {
        return { type: 'bull', shape, flagHigh, flagLow, poleMovePct, flagLen, poleLen };
      }
      if (poleMovePct <= -poleMinMovePct && flagLow >= poleClosePrice * 0.98) {
        return { type: 'bear', shape, flagHigh, flagLow, poleMovePct, flagLen, poleLen };
      }
    }
  }
  return null;
}

// wedgeMinTouches=2 (bukan 3 kayak "aturan textbook") -- dites 10 Agu 2026 (backtestFlagBreakout.js),
// TERBUKTI lebih baik di SEMUA metrik drpd syarat 3 sentuhan yang lebih ketat.
function detectWedge(daily, i, opts = {}) {
  const { wedgeLookbackRange = [15, 40], minTouches = 2, convergenceRatio = 0.65, swingPointLookback = 2 } = opts;
  for (let wedgeLen = wedgeLookbackRange[0]; wedgeLen <= wedgeLookbackRange[1]; wedgeLen++) {
    const start = i - wedgeLen;
    if (start < 0) continue;
    const window = daily.slice(start, i); // belum termasuk hari ini (breakout day)
    if (window.length < wedgeLen) continue;
    const { highs, lows } = findSwingPoints(window, swingPointLookback);
    if (highs.length < minTouches || lows.length < minTouches) continue;

    const highReg = linearRegression(highs.map((h) => ({ x: h.index, y: h.price })));
    const lowReg = linearRegression(lows.map((l) => ({ x: l.index, y: l.price })));
    if (!highReg || !lowReg) continue;

    const spreadStart = highReg.intercept - lowReg.intercept;
    const spreadEnd = (highReg.slope * wedgeLen + highReg.intercept) - (lowReg.slope * wedgeLen + lowReg.intercept);
    if (spreadStart <= 0 || spreadEnd <= 0) continue; // garis udah kesilang -- invalid
    if (spreadEnd > spreadStart * convergenceRatio) continue; // gak cukup mengerucut

    const projectedResistance = highReg.slope * wedgeLen + highReg.intercept;
    const projectedSupport = lowReg.slope * wedgeLen + lowReg.intercept;
    const recentSwingHigh = Math.max(...highs.map((h) => h.price));
    const recentSwingLow = Math.min(...lows.map((l) => l.price));

    if (highReg.slope > 0 && lowReg.slope > 0) {
      return { type: 'rising', projectedSupport, projectedResistance, recentSwingHigh, recentSwingLow, spreadStart, wedgeLen };
    }
    if (highReg.slope < 0 && lowReg.slope < 0) {
      return { type: 'falling', projectedSupport, projectedResistance, recentSwingHigh, recentSwingLow, spreadStart, wedgeLen };
    }
  }
  return null;
}

// Deteksi TERPADU (buat live -- sniperAutoAnalysis.js) -- cek flag dulu, baru wedge kalau flag
// gak ketemu, normalisasi ke bentuk sinyal generik { direction, sl, patternType, ... } biar
// caller gak perlu tau beda struktur flag vs wedge. `allowShort=false` = default tervalidasi
// (short kebukti ngerusak edge di backtest, baik di sistem lama maupun pola baru ini).
function detectPatternSignal(daily, i, opts = {}) {
  const { allowShort = false, slBufferPct = 0.5, poleMinMovePct = 20 } = opts;
  const lastPrice = daily[i].close;

  const flag = detectFlag(daily, i, { ...opts, poleMinMovePct });
  // patternType sekarang BEDA buat flag vs pennant (22 Agu 2026) -- shape ditentukan
  // classifyConsolidationShape() di detectFlag(), bukan lagi gabungan "flag_bull" doang.
  if (flag && flag.type === 'bull' && lastPrice > flag.flagHigh) {
    return { direction: 'buy', sl: flag.flagLow * (1 - slBufferPct / 100), patternType: flag.shape === 'pennant' ? 'pennant_bull' : 'flag_bull', pattern: flag };
  }
  if (flag && flag.type === 'bear' && lastPrice < flag.flagLow && allowShort) {
    return { direction: 'sell', sl: flag.flagHigh * (1 + slBufferPct / 100), patternType: flag.shape === 'pennant' ? 'pennant_bear' : 'flag_bear', pattern: flag };
  }

  const wedge = detectWedge(daily, i, opts);
  if (wedge && wedge.type === 'falling' && lastPrice > wedge.projectedResistance) {
    return { direction: 'buy', sl: wedge.recentSwingLow * (1 - slBufferPct / 100), patternType: 'wedge_falling', pattern: wedge };
  }
  if (wedge && wedge.type === 'rising' && lastPrice < wedge.projectedSupport && allowShort) {
    return { direction: 'sell', sl: wedge.recentSwingHigh * (1 + slBufferPct / 100), patternType: 'wedge_rising', pattern: wedge };
  }

  return null;
}

module.exports = { linearRegression, detectFlag, detectWedge, detectPatternSignal };
