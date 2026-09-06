// backtest/barPermutationChartPattern.js -- (6 Sep 2026) uji "bar permutation" (lihat
// backtestValidation.js) ke strategi Chart Pattern+FVG BTC -- strategi flagship yang UDAH lolos
// DSR/Ulcer/PSR (99,9%) di expandedValidation.js. Ini konfirmasi TAMBAHAN, bukan syarat mutlak --
// 1x jalan backtest penuh ~128 detik (59.314 candle 4H, pattern detector scan tiap bar), jadi
// iterations DIBATASI (lihat ITERATIONS di bawah) biar selesai dalam waktu wajar, BUKAN 2000
// seperti permutationTest biasa. Resolusi p-value = 1/ITERATIONS -- cukup buat deteksi "beda
// drastis dari acak", kurang presisi buat p-value yang mepet 0,05 (kalau hasilnya di kisaran itu,
// pertimbangkan iterations lebih banyak, jalan overnight).
const cpf = require('./nyopetChartPatternFvg.js');
const { barPermutationTest, metricAvgReturn, metricProfitFactor } = require('./backtestValidation');

const ITERATIONS = 40; // ~128 detik x 41 run (1 observed + 40 null) = ~87 menit

function strategyFn(candles) {
  const r = cpf.runNyopetV2Backtest(candles, { ...cpf.RESCALED_4H, allowShort: false, modalDivisor: 1 });
  return r.trades.map((t) => t.rMultiple);
}

async function main() {
  console.log(`Mulai bar permutation test BTC Chart Pattern+FVG -- ${ITERATIONS} iterasi, estimasi ~${Math.round((ITERATIONS + 1) * 128 / 60)} menit...`);
  const t0 = Date.now();
  const resultAvg = barPermutationTest(cpf.CANDLES_4H, strategyFn, metricAvgReturn, { iterations: ITERATIONS });
  console.log('\n=== Metrik avgReturn (rMultiple) ===');
  console.log(resultAvg);
  const resultPf = barPermutationTest(cpf.CANDLES_4H, strategyFn, metricProfitFactor, { iterations: ITERATIONS });
  console.log('\n=== Metrik ProfitFactor ===');
  console.log(resultPf);
  console.log(`\nSelesai dalam ${Math.round((Date.now() - t0) / 1000)} detik.`);
  console.log(resultAvg.ok && resultAvg.pValue < 0.05 ? '-> p-value < 0.05: pattern detector NGASIH HASIL LEBIH BAIK dari urutan candle acak (signifikan).' : '-> p-value >= 0.05: BELUM bisa dibedain dari urutan candle acak.');
}

if (require.main === module) {
  main().catch((e) => { console.error('ERROR barPermutationChartPattern.js:', e.message); process.exit(1); });
}

module.exports = { main, ITERATIONS };
