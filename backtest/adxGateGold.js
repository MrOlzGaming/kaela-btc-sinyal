// Riset "[PRIORITAS, 15 Sep 2026]" dari RESEARCH-LOG.md ("Ide-ide yang BELUM dicoba") -- lanjutan
// LANGSUNG dari riset whipsaw+buffer band (goldWindowMaturation.js, hari yang sama): buffer band
// (Schmitt trigger) TERBUKTI ngilangin whipsaw window Emas (348/444 -> puluhan/~100), TAPI Era1
// (2020-2023) TETAP rugi (PF<1) di SEMUA level buffer -- sub-agent skeptis simpulkan "belum layak
// modal real". Hipotesis riset ini: Era1 rugi bukan cuma soal window whipsaw, tapi soal TRADING DI
// MARKET CHOPPY/RANGING (sinyal chart-pattern/FVG emang lemah kalau gak ada tren buat diikuti) --
// ADX (Average Directional Index, standar CTA/managed-futures buat bedain trending vs ranging)
// dipasang sbg GERBANG ENTRY TAMBAHAN (skip entry arah manapun kalau ADX rendah), DIGABUNG sama
// buffer band yang udah tervalidasi ngilangin whipsaw -- coba benerin Era1 dari 2 sisi sekaligus.
//
// Alternatif yang DICATAT tapi TIDAK dites di sini (di luar scope hari ini, masih di "Ide belum
// dicoba" kalau mau lanjut nanti): Donchian Channel breakout (sistem "Turtle Traders") -- nunggu
// breakout N-hari tinggi/rendah drpd crossover SMA, filosofi beda dari nambah gerbang di ATAS
// sinyal yang ADA, bukan ganti cara deteksi window itu sendiri.
//
// Ekspektasi realistis (dicatat di RESEARCH-LOG sebelum riset ini mulai): dana trend-following
// PROFESIONAL (Man AHL, Winton dkk) TERBUKTI juga ngalamin tahun jelek pas market choppy --solusi
// industri BUKAN "menyelesaikan sempurna" di 1 aset, tapi diversifikasi banyak pasar. Jangan
// berharap Era1 jadi UNTUNG besar, realistisnya cuma NGURANGIN kerugian.

const { adxSeries } = require('../technicalAnalysis');
const { CANDLES_4H_GOLD } = require('./nyopetChartPatternFvg');
const { makeBufferedBearWindowFn, runVariant, countWindowFlips } = require('./goldWindowMaturation');

const START_2020 = new Date('2020-01-01T00:00:00Z').getTime();
const ERA_SPLIT = new Date('2023-01-01T00:00:00Z').getTime();

// Cache per-period -- adxSeries itung SEKALI per period (1 pass, lihat technicalAnalysis.js),
// dipakai ulang lintas semua threshold yang mau dites (hemat, gak recompute tiap kombinasi).
const adxCache = new Map();
function getAdxSeries(period) {
  if (!adxCache.has(period)) adxCache.set(period, adxSeries(CANDLES_4H_GOLD, period));
  return adxCache.get(period);
}
function makeAdxGateFn(period, threshold) {
  const series = getAdxSeries(period);
  return (candles, i) => series[i] !== null && series[i] >= threshold;
}

// ============ Sanity check: adxSeries gak lookahead + nilainya masuk akal (0-100) ============
// ADX definisinya emang antara 0-100 (turunan dari |+DI - -DI| / (+DI + -DI) * 100, DX itu sendiri
// dibatasi 0-100 secara matematis, ADX-nya rata-rata Wilder dari DX -- gak mungkin keluar rentang
// itu). Sanity check ini nangkep BUG implementasi (typo formula dsb), bukan nge-tes properti
// statistik ADX yang emang dijamin definisinya sendiri.
(function sanityCheck() {
  const series = getAdxSeries(14);
  const valid = series.filter((v) => v !== null);
  if (valid.length === 0) throw new Error('adxSeries kosong -- data candle Emas kurang?');
  const bad = valid.find((v) => Number.isNaN(v) || v < 0 || v > 100);
  if (bad !== undefined) throw new Error(`adxSeries hasilin nilai gak masuk akal: ${bad}`);
  console.log(`[Sanity check] adxSeries(period=14): ${valid.length}/${series.length} titik valid, contoh nilai: ${valid.slice(0, 3).map((v) => v.toFixed(1)).join(', ')}...`);
})();

console.log('\n========== KONTROL: Buffer band SENDIRI (dari riset sebelum ini, hari yang sama) ==========');
runVariant('Buffer 12% (no ADX) -- REKOMENDASI whipsaw fix sebelumnya', makeBufferedBearWindowFn(CANDLES_4H_GOLD, 1200, 12));
runVariant('Buffer 2% (no ADX) -- alternatif rekomendasi whipsaw fix', makeBufferedBearWindowFn(CANDLES_4H_GOLD, 1200, 2));

console.log('\n\n========== KANDIDAT: Buffer 12% + ADX gate (period=14), sweep threshold ==========');
[15, 20, 25, 30].forEach((threshold) => {
  runVariant(`Buffer 12% + ADX>=${threshold}`, makeBufferedBearWindowFn(CANDLES_4H_GOLD, 1200, 12), { adxGateFn: makeAdxGateFn(14, threshold) });
});

console.log('\n\n========== KANDIDAT: Buffer 2% + ADX gate (period=14), sweep threshold ==========');
[15, 20, 25, 30].forEach((threshold) => {
  runVariant(`Buffer 2% + ADX>=${threshold}`, makeBufferedBearWindowFn(CANDLES_4H_GOLD, 1200, 2), { adxGateFn: makeAdxGateFn(14, threshold) });
});

console.log('\n\n========== Sensitivitas parameter: ADX period (threshold tetap 20, buffer 12%) ==========');
[10, 20].forEach((period) => {
  runVariant(`Buffer 12% + ADX(period=${period})>=20`, makeBufferedBearWindowFn(CANDLES_4H_GOLD, 1200, 12), { adxGateFn: makeAdxGateFn(period, 20) });
});
