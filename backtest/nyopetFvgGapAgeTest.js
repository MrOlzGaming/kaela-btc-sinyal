// Uji rigor 3-lapis: batasin umur gap FVG buat Nyopet v2 (lihat catatan lengkap di
// nyopetFvgGapAgeCap.js). Bandingin BASELINE (gak dibatasin, perilaku live SEKARANG) vs beberapa
// kandidat batas (candle 4H) -- 180 (~30 hari), 360 (~60 hari), 540 (~90 hari).
const { runNyopetV2Backtest, summarize, byYear, CANDLES_4H: FULL_BTC, CANDLES_4H_GOLD: FULL_GOLD, RESCALED_4H } = require('./nyopetFvgGapAgeCap');

// Backtest full-history (59rb+ candle 4H sejak 2017) makan ~90 detik SATU config -- terlalu berat
// buat ngejalanin banyak kombinasi sekaligus (dicoba, proses ke-kill diem2 sebelum kelar). Potong
// ke 3 tahun terakhir (2023-2026) -- masih cukup panjang buat breakdown per tahun (3 titik) +
// split-era (2 bagian), jauh lebih cepat. Dicatat jelas di RESEARCH-LOG biar transparan soal
// rentang yang dipakai riset INI SAJA (bukan ganti standar 2020+ yang dipakai riset lain).
const CUTOFF_3Y = Date.now() - 3 * 365 * 24 * 3600 * 1000;
function sliceRecent(candles) { return candles ? candles.filter((c) => c.closeTime >= CUTOFF_3Y) : null; }
const CANDLES_4H = sliceRecent(FULL_BTC);
const CANDLES_4H_GOLD = sliceRecent(FULL_GOLD);

const CAPS = [Infinity, 360, 180]; // Infinity = baseline (current live behavior)
const BASE_OPTS = { ...RESCALED_4H, allowShort: false, modalDivisor: 5 }; // sama persis config LIVE

function runFullPeriod(candles, label) {
  console.log(`\n=== ${label} -- FULL PERIOD ===`);
  const rows = [];
  for (const cap of CAPS) {
    const r = runNyopetV2Backtest(candles, { ...BASE_OPTS, maxGapAgeCandles: cap });
    const s = summarize(r.trades);
    const capLabel = cap === Infinity ? 'BASELINE(no cap)' : `cap=${cap}c(~${Math.round(cap * 4 / 24)}d)`;
    console.log(`  ${capLabel}: n=${s.n} winRate=${s.winRate} PF=${s.profitFactor} totalR=${s.totalR} avgR=${s.avgR} finalCap=$${r.finalCapital.toFixed(2)}`);
    rows.push({ cap, s, trades: r.trades });
  }
  return rows;
}

function runSplitEra(candles, label, cutoffTime) {
  console.log(`\n=== ${label} -- SPLIT ERA (cutoff ${new Date(cutoffTime).toISOString().slice(0, 10)}) ===`);
  for (const cap of CAPS) {
    const r = runNyopetV2Backtest(candles, { ...BASE_OPTS, maxGapAgeCandles: cap });
    const era1 = r.trades.filter((t) => t.exitTime < cutoffTime);
    const era2 = r.trades.filter((t) => t.exitTime >= cutoffTime);
    const s1 = summarize(era1), s2 = summarize(era2);
    const capLabel = cap === Infinity ? 'BASELINE' : `cap=${cap}c`;
    console.log(`  ${capLabel}: Era1 n=${s1.n} PF=${s1.profitFactor} totalR=${s1.totalR} | Era2 n=${s2.n} PF=${s2.profitFactor} totalR=${s2.totalR}`);
  }
}

console.log('BTC 4H candles:', CANDLES_4H.length, '|', new Date(CANDLES_4H[0].closeTime).toISOString().slice(0, 10), '->', new Date(CANDLES_4H[CANDLES_4H.length - 1].closeTime).toISOString().slice(0, 10));

const btcRows = runFullPeriod(CANDLES_4H, 'BTC');
console.log('\n--- BTC BASELINE -- breakdown per tahun ---');
Object.entries(byYear(btcRows[0].trades)).sort().forEach(([y, dt]) => {
  console.log(`  ${y}: ${dt.count} trade | win ${(dt.wins / dt.count * 100).toFixed(1)}% | R:${dt.totalR >= 0 ? '+' : ''}${dt.totalR.toFixed(1)}`);
});
console.log('\n--- BTC cap=360 -- breakdown per tahun ---');
Object.entries(byYear(btcRows[2].trades)).sort().forEach(([y, dt]) => {
  console.log(`  ${y}: ${dt.count} trade | win ${(dt.wins / dt.count * 100).toFixed(1)}% | R:${dt.totalR >= 0 ? '+' : ''}${dt.totalR.toFixed(1)}`);
});

// Split-era: pertengahan rentang data BTC (2020-01 -> sekarang, ~6.6 tahun) -> cutoff ~2023-05
const btcMid = CANDLES_4H[0].closeTime + (CANDLES_4H[CANDLES_4H.length - 1].closeTime - CANDLES_4H[0].closeTime) / 2;
runSplitEra(CANDLES_4H, 'BTC', btcMid);

if (CANDLES_4H_GOLD) {
  console.log('\n\nEmas 4H candles:', CANDLES_4H_GOLD.length, '|', new Date(CANDLES_4H_GOLD[0].closeTime).toISOString().slice(0, 10), '->', new Date(CANDLES_4H_GOLD[CANDLES_4H_GOLD.length - 1].closeTime).toISOString().slice(0, 10));
  const goldRows = runFullPeriod(CANDLES_4H_GOLD, 'EMAS');
  const goldMid = CANDLES_4H_GOLD[0].closeTime + (CANDLES_4H_GOLD[CANDLES_4H_GOLD.length - 1].closeTime - CANDLES_4H_GOLD[0].closeTime) / 2;
  runSplitEra(CANDLES_4H_GOLD, 'EMAS', goldMid);
}
