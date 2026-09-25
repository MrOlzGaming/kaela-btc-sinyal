// Matangkan strategi Emas SHORT (15 Sep 2026, permintaan Olan: "sekarang kita coba matangkan
// strategi emas short") -- diagnosis (dites langsung sebelum riset ini): window bear/bull Emas
// SEKARANG (SMA200-daily / SMA1200-4H, crossover POLOS) bikin 348 dari 444 trade (78%!) Nyopet
// Emas kena WINDOW_FLIP (tutup paksa krn window ganti), rata2 posisi cuma idup 2,89 HARI sebelum
// di-chop -- window-nya SENDIRI yang kelewat gampang gonta-ganti (whipsaw), bukan soal pola
// entry-nya. Riset ini nyoba 1 solusi: BUFFER BAND (gaya "Schmitt trigger") -- regime CUMA ganti
// begitu harga beneran nembus JAUH dari SMA (bukan cuma nyentuh dikit), dan TETAP di regime lama
// selama harga masih di "zona netral" deket garis SMA -- prinsip standar buat ngilangin whipsaw
// di trading (dipakai luas di indikator trend-following), bukan skema buatan sendiri yang asal.

const fs = require('fs');
const path = require('path');
const { sma } = require('../technicalAnalysis');
const {
  runNyopetV2BacktestWindowGated, summarize, CANDLES_4H_GOLD, RESCALED_4H,
} = require('./rangerChartPatternFvg');

const START_2020 = new Date('2020-01-01T00:00:00Z').getTime();
const ERA_SPLIT = new Date('2023-01-01T00:00:00Z').getTime();

// Buffer band (Schmitt trigger) -- state cuma FLIP begitu harga nembus (1+bufferPct/100) dari SMA
// ke arah yang BERLAWANAN sama state SEKARANG. Selama harga di "zona netral" (dalam buffer),
// state LAMA dipertahankan -- ini yang bedain dari crossover polos (yang flip di SETIAP
// persentuhan garis, gak peduli seberapa tipis).
function makeBufferedBearWindowFn(candles, smaLen, bufferPct) {
  const closes = candles.map((c) => c.close);
  const smaSeries = closes.map((_, i) => (i >= smaLen - 1 ? sma(closes.slice(0, i + 1), smaLen) : null));
  const stateMap = new Map();
  let bearState = false; // asumsi mulai "bull" (netral) sebelum data cukup
  for (let i = 0; i < candles.length; i++) {
    const s = smaSeries[i];
    if (s !== null) {
      const upperBand = s * (1 + bufferPct / 100);
      const lowerBand = s * (1 - bufferPct / 100);
      if (!bearState && closes[i] < lowerBand) bearState = true;
      else if (bearState && closes[i] > upperBand) bearState = false;
      // kalau di antara lowerBand-upperBand: TETAP di state lama (ini inti anti-whipsaw-nya).
    }
    stateMap.set(candles[i].closeTime, bearState);
  }
  return (cds, i) => stateMap.get(cds[i].closeTime) || false;
}

function countWindowFlips(trades) {
  return trades.filter((t) => t.exitReason === 'WINDOW_FLIP').length;
}
function avgHoldDaysForFlips(trades) {
  const flips = trades.filter((t) => t.exitReason === 'WINDOW_FLIP');
  if (!flips.length) return 0;
  return flips.reduce((s, t) => s + (t.exitTime - t.entryTime) / 86400000, 0) / flips.length;
}
function byYear(trades) {
  const years = {};
  trades.forEach((t) => {
    const y = new Date(t.exitTime).getUTCFullYear();
    if (!years[y]) years[y] = { count: 0, totalR: 0, wins: 0, flips: 0 };
    years[y].count++;
    years[y].totalR += t.rMultiple;
    if (t.rMultiple > 0) years[y].wins++;
    if (t.exitReason === 'WINDOW_FLIP') years[y].flips++;
  });
  return years;
}
function printByYear(trades) {
  const years = byYear(trades);
  Object.keys(years).sort().forEach((y) => {
    const d = years[y];
    const wr = d.count ? (d.wins / d.count * 100).toFixed(1) : '-';
    console.log(`      ${y}: n=${d.count}, totalR=${d.totalR.toFixed(2)}, winRate=${wr}%, WINDOW_FLIP=${d.flips}`);
  });
}

function runVariant(label, bearWindowFn, extraOpts = {}) {
  // `extraOpts` (15 Sep 2026) -- biar script LAIN (adxGateGold.js) bisa numpangin param baru
  // (misal `adxGateFn`) tanpa duplikat seluruh badan fungsi ini.
  const r = runNyopetV2BacktestWindowGated(CANDLES_4H_GOLD, { ...RESCALED_4H, modalDivisor: 5, bearWindowFn, ...extraOpts });
  const trades = r.trades.filter((t) => t.exitTime >= START_2020);
  const s = summarize(trades);
  const flips = countWindowFlips(trades);
  console.log(`\n--- ${label} ---`);
  console.log(`  n=${s.n} PF=${s.profitFactor} totalR=${s.totalR} winRate=${s.winRate} | final=$${r.finalCapital.toFixed(0)} maxDD=${r.maxDrawdownPct.toFixed(1)}%`);
  console.log(`  WINDOW_FLIP: ${flips}/${trades.length} (${(flips / trades.length * 100).toFixed(0)}%), rata2 hold sebelum flip: ${avgHoldDaysForFlips(trades).toFixed(2)} hari`);
  console.log(`  Per tahun:`);
  printByYear(trades);
  const era1 = trades.filter((t) => t.exitTime < ERA_SPLIT);
  const era2 = trades.filter((t) => t.exitTime >= ERA_SPLIT);
  const s1 = summarize(era1), s2 = summarize(era2);
  console.log(`  Era1 (2020-2023): n=${s1.n} PF=${s1.profitFactor} totalR=${s1.totalR} flips=${countWindowFlips(era1)} | Era2 (2023-2026): n=${s2.n} PF=${s2.profitFactor} totalR=${s2.totalR} flips=${countWindowFlips(era2)}`);
  return { r, trades, flips };
}

// Dibungkus `require.main === module` (15 Sep 2026, biar `makeBufferedBearWindowFn` bisa di-
// require file LAIN -- misal adxGateGold.js -- TANPA ikut nge-print laporan ini tiap kali
// di-import, pola PERSIS `nyopetChartPatternFvg.js`) -- jalanin `node goldWindowMaturation.js`
// langsung kalau mau lihat laporan buffer-band ini sendiri.
if (require.main === module) {
  console.log('========== BASELINE (crossover polos, SMA1200-4H, LIVE SEKARANG) ==========');
  const { makeEmasBearWindowFn } = require('./rangerChartPatternFvg');
  runVariant('Baseline (buffer 0%)', makeEmasBearWindowFn());

  console.log('\n\n========== KANDIDAT: Buffer band (Schmitt trigger), SMA1200 ==========');
  [2, 5, 8, 12].forEach((bufferPct) => {
    runVariant(`Buffer ${bufferPct}%`, makeBufferedBearWindowFn(CANDLES_4H_GOLD, 1200, bufferPct));
  });

  console.log('\n\n========== KANDIDAT: SMA lebih panjang (polos, gak pakai buffer) ==========');
  [1800, 2400].forEach((smaLen) => {
    runVariant(`SMA${smaLen} (4H) polos`, makeEmasBearWindowFn(smaLen));
  });
}

module.exports = { makeBufferedBearWindowFn, runVariant, countWindowFlips, avgHoldDaysForFlips, byYear, printByYear };
