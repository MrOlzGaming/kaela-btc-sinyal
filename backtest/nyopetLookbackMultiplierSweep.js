// Riset (31 Agu 2026, dari daftar "Ide-ide belum dicoba" di RESEARCH-LOG.md): apakah multiplier
// x6 di RESCALED_4H (dipakai LIVE di nyopetAutoTrader.js) itu beneran robust, atau cuma angka
// yang "masuk akal" (6 candle 4H = 1 hari) yang belum pernah divalidasi independen?
//
// Semua parameter lookback di RESCALED_4H = default daily x 6 (poleLookbackRange [5,20]x6=[30,120],
// flagLookbackRange [3,15]x6=[18,90], wedgeLookbackRange [15,40]x6=[90,240], trailSmaLen 10x6=60,
// fvgTrendSmaLen 200x6=1200, warmupCandles 260x6=1560).
//
// CATATAN METODOLOGI: TIDAK melakukan sweep luas buat "cari M terbaik" (itu sendiri rawan
// overfitting -- optimasi parameter pakai data yang sama yang dipakai buat "validasi" adalah
// p-hacking). Sebaliknya, tes SENSITIVITAS murni: geser M=6 (LIVE) ke tetangga terdekat M=4 dan
// M=8 (mirror pola SMA10/20/50 di dxyNyopetScrutiny.js), pakai KONFIG LIVE PERSIS (allowShort=false,
// modalDivisor=5, startMs=2020-01-01 seragam) buat BTC+Emas. Kalau performa runtuh drastis cuma
// gara-gara geser M dikit, itu tanda overfitting di M=6 -- BUKAN cari M baru yang "lebih bagus".
//
// CATATAN PERFORMA: pattern detection (flag/wedge) di chartPatterns.js itu O(window) per candle,
// BTC 4H ada ~59rb candle -- 1 run full-period BTC M=6 makan waktu ~90 detik. Makanya M dibatasi
// ke 3 nilai doang (bukan sweep 9 nilai), dan script ini dijalanin di background/nohup, BUKAN
// lewat pipe ke `tail` (itu nge-buffer semua output sampe EOF, bikin kelihatan macet).

const { runNyopetV2Backtest, summarize, CANDLES_4H, CANDLES_4H_GOLD } = require('./nyopetChartPatternFvg.js');

function scaledParams(M) {
  return {
    poleLookbackRange: [5 * M, 20 * M], flagLookbackRange: [3 * M, 15 * M],
    wedgeLookbackRange: [15 * M, 40 * M], fvgTrendSmaLen: 200 * M, trailSmaLen: 10 * M,
    warmupCandles: 260 * M,
    poleMinMovePct: 15, flagMaxRangePct: 8, wedgeMinTouches: 2, wedgeConvergenceRatio: 0.65,
  };
}

function byYear(trades) {
  const years = {};
  trades.forEach((t) => {
    const y = new Date(t.exitTime).getUTCFullYear();
    if (!years[y]) years[y] = { count: 0, totalR: 0, wins: 0 };
    years[y].count++; years[y].totalR += t.rMultiple;
    if (t.rMultiple > 0) years[y].wins++;
  });
  return years;
}

const BACKTEST_START = new Date('2020-01-01T00:00:00Z').getTime();
const LIVE_BASE = { allowShort: false, modalDivisor: 5, startCapital: 100 };
const MS = [4, 6, 8]; // 6 = LIVE, 4 & 8 = tetangga terdekat buat sensitivitas

function runM(candles, M, startMs = BACKTEST_START) {
  const t0 = Date.now();
  const r = runNyopetV2Backtest(candles, { ...LIVE_BASE, ...scaledParams(M), startMs });
  const s = summarize(r.trades);
  console.error(`  [debug] M=${M} startMs=${new Date(startMs).toISOString().slice(0, 10)} candles=${candles.length} -> ${Date.now() - t0}ms`);
  return { r, s };
}

console.log('=== TES 1: Sensitivitas M (4 vs 6-LIVE vs 8), full period 2020-2026 -- Nyopet BTC & Emas ===\n');
const aggBtc = {}, aggGold = {};
MS.forEach((M) => {
  const btc = runM(CANDLES_4H, M);
  aggBtc[M] = btc;
  let line = `M=${M}${M === 6 ? '(LIVE)' : '      '}: BTC  n=${String(btc.s.n).padStart(3)} PF=${String(btc.s.profitFactor).padStart(5)} WR=${String(btc.s.winRate).padStart(6)} totalR=${String(btc.s.totalR).padStart(7)} final=$${btc.r.finalCapital.toFixed(0)}`;
  if (CANDLES_4H_GOLD) {
    const gold = runM(CANDLES_4H_GOLD, M);
    aggGold[M] = gold;
    line += `   |   Emas n=${String(gold.s.n).padStart(3)} PF=${String(gold.s.profitFactor).padStart(5)} WR=${String(gold.s.winRate).padStart(6)} totalR=${String(gold.s.totalR).padStart(7)} final=$${gold.r.finalCapital.toFixed(0)}`;
  }
  console.log(line);
});

console.log('\n=== TES 2: Breakdown per tahun -- M=4 vs M=6(LIVE) vs M=8 ===\n');
[['BTC', CANDLES_4H, aggBtc], ['Emas', CANDLES_4H_GOLD, aggGold]].forEach(([label, candles, agg]) => {
  if (!candles) return;
  MS.forEach((M) => {
    console.log(`--- ${label}: M=${M}${M === 6 ? ' (LIVE)' : ''} per tahun ---`);
    Object.entries(byYear(agg[M].r.trades)).sort().forEach(([y, dt]) => {
      console.log(`  ${y}: ${dt.count} trade | WR ${(dt.wins / dt.count * 100).toFixed(1)}% | totalR ${dt.totalR >= 0 ? '+' : ''}${dt.totalR.toFixed(1)}R`);
    });
  });
});

console.log('\n=== TES 3: Split-era independen (2020-2023 vs 2023-2026) -- M=4/6/8 ===\n');
const era1Start = new Date('2020-01-01T00:00:00Z').getTime();
const era1End = new Date('2023-01-01T00:00:00Z').getTime();
const era2Start = new Date('2023-01-01T00:00:00Z').getTime();
const era2End = new Date('2026-09-01T00:00:00Z').getTime();

function runEra(candles, M, startMs, endMs) {
  const { r } = runM(candles, M, startMs);
  const tradesInEra = r.trades.filter((t) => t.exitTime <= endMs);
  return summarize(tradesInEra);
}

[['BTC', CANDLES_4H], ['Emas', CANDLES_4H_GOLD]].forEach(([label, candles]) => {
  if (!candles) return;
  console.log(`--- ${label} ---`);
  console.log('M           | Era1(20-23) n/PF/totalR          | Era2(23-26) n/PF/totalR');
  MS.forEach((M) => {
    const e1 = runEra(candles, M, era1Start, era1End);
    const e2 = runEra(candles, M, era2Start, era2End);
    console.log(`M=${M}${M === 6 ? '(LIVE)' : '      '} | n=${String(e1.n).padStart(3)} PF=${String(e1.profitFactor).padStart(5)} totalR=${String(e1.totalR).padStart(7)}  | n=${String(e2.n).padStart(3)} PF=${String(e2.profitFactor).padStart(5)} totalR=${String(e2.totalR).padStart(7)}`);
  });
  console.log('');
});

console.log('=== SELESAI ===');
