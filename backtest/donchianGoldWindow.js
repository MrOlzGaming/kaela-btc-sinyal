// backtest/donchianGoldWindow.js (4 Okt 2026, riset malam) -- ide terakhir di "IDE YANG BELUM DICOBA" katalog:
// DONCHIAN (Turtle) sbg PENGGANTI cara deteksi window bull/bear Emas. Latar: Ranger Emas rugi di Era1 (2020-2023) di
// SEMUA varian sebelumnya (buffer band 2-12%, SMA lebih panjang, gerbang ADX -- RESEARCH-LOG 15 Sep). Filosofi beda:
// bukan nambah gerbang di atas sinyal, tapi ganti cara nentuin rezim: bear NYALA pas close tembus low terendah N candle
// sebelumnya, MATI pas close tembus high tertinggi N candle sebelumnya (di antaranya: rezim lama dipertahanin).
// Mesin & data SAMA PERSIS goldWindowMaturation.js/adxGateGold.js (runVariant, CANDLES_4H_GOLD, 2020+, split Era1/Era2).
// Ekspektasi realistis (dicatat sebelum jalan): trend follower profesional juga rugi di tahun choppy -- jangan berharap
// Era1 jadi untung besar; LOLOS kalau PF Era1 > 1 TANPA ngerusak Era2, dan tetangga N ikut membaik (dataran).
// Pakai: node backtest/donchianGoldWindow.js
const { CANDLES_4H_GOLD, makeEmasBearWindowFn } = require('./rangerChartPatternFvg');
const { makeBufferedBearWindowFn, runVariant } = require('./goldWindowMaturation');

if (!CANDLES_4H_GOLD) { console.log('gold-hourly-cache.json gak ada -- jalanin backtest/refreshGoldCache.js dulu.'); process.exit(1); }

// window Donchian N candle 4H, TANPA look-ahead: band dari candle i-N .. i-1, dibandingin close candle i
function makeDonchianBearWindowFn(candles, n) {
  const state = new Map();
  let bear = false;
  for (let i = 0; i < candles.length; i++) {
    if (i >= n) {
      let hi = -Infinity, lo = Infinity;
      for (let k = i - n; k < i; k++) { if (candles[k].high > hi) hi = candles[k].high; if (candles[k].low < lo) lo = candles[k].low; }
      if (!bear && candles[i].close < lo) bear = true;
      else if (bear && candles[i].close > hi) bear = false;
    }
    state.set(candles[i].closeTime, bear);
  }
  return (cds, i) => state.get(cds[i].closeTime) || false;
}
// Sanity: hitung berapa kali rezim ganti + porsi waktu bear (biar kelihatan kalau ada yang aneh)
function regimeStats(fn) {
  let flips = 0, bearN = 0, prev = null;
  for (let i = 0; i < CANDLES_4H_GOLD.length; i++) { const b = fn(CANDLES_4H_GOLD, i); if (b) bearN++; if (prev !== null && b !== prev) flips++; prev = b; }
  return `rezim ganti ${flips}x, porsi bear ${(bearN / CANDLES_4H_GOLD.length * 100).toFixed(0)}%`;
}

console.log(`Emas 4H: ${CANDLES_4H_GOLD.length} candle ${new Date(CANDLES_4H_GOLD[0].openTime).toISOString().slice(0, 10)} .. ${new Date(CANDLES_4H_GOLD[CANDLES_4H_GOLD.length - 1].openTime).toISOString().slice(0, 10)}`);
console.log('\n========== KONTROL ==========');
const base = makeEmasBearWindowFn();
console.log(`[baseline SMA1200 polos -- LIVE] ${regimeStats(base)}`);
runVariant('Baseline SMA1200 polos (LIVE)', base);
const buf = makeBufferedBearWindowFn(CANDLES_4H_GOLD, 1200, 12);
console.log(`\n[buffer 12%] ${regimeStats(buf)}`);
runVariant('Buffer 12% (riset 15 Sep)', buf);

console.log('\n\n========== KANDIDAT: Donchian N hari (x6 candle 4H) ==========');
for (const days of [20, 55, 100, 200]) {
  const fn = makeDonchianBearWindowFn(CANDLES_4H_GOLD, days * 6);
  console.log(`\n[Donchian ${days} hari] ${regimeStats(fn)}`);
  runVariant(`Donchian ${days} hari (${days * 6} candle 4H)`, fn);
}

// ---- Dataran di sekitar 20 hari (hasil grid kasar di atas) -- titik beruntung atau beneran? ----
console.log('\n\n========== DATARAN: Donchian 10-40 hari ==========');
const plateau = [];
for (const days of [10, 15, 20, 25, 30, 40]) {
  const fn = makeDonchianBearWindowFn(CANDLES_4H_GOLD, days * 6);
  const origLog = console.log; console.log = () => {}; // diem-in laporan panjang runVariant
  const { trades } = runVariant(`Donchian ${days}`, fn);
  console.log = origLog;
  const split = new Date('2023-01-01T00:00:00Z').getTime();
  const pf = (ts) => { const w = ts.filter((t) => t.rMultiple > 0).reduce((a, t) => a + t.rMultiple, 0), l = -ts.filter((t) => t.rMultiple <= 0).reduce((a, t) => a + t.rMultiple, 0); return l > 0 ? w / l : 99; };
  const e1 = trades.filter((t) => t.exitTime < split), e2 = trades.filter((t) => t.exitTime >= split);
  plateau.push({ days, n: trades.length, pfAll: pf(trades), pf1: pf(e1), n1: e1.length, pf2: pf(e2), n2: e2.length });
  console.log(`  ${String(days).padStart(2)} hari | ${regimeStats(fn)} | semua n${trades.length} PF ${pf(trades).toFixed(2)} | Era1 n${e1.length} PF ${pf(e1).toFixed(2)} | Era2 n${e2.length} PF ${pf(e2).toFixed(2)}`);
}
