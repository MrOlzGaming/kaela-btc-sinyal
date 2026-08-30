// Scrutiny SAMA PERSIS yang dipakai buat Sniper (dxySniperScrutiny.js) -- biar adil, jangan
// standar ganda (percaya Nyopet cuma dari breakdown per tahun doang, sementara Sniper diteliti
// lebih ketat). 2 tes: split era independen + sensitivitas parameter SMA.

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { runNyopetV2Backtest, summarize, CANDLES_4H, CANDLES_4H_GOLD, RESCALED_4H } = require('./nyopetChartPatternFvg.js');
const { buildDxyWeakLookup } = require('./dxyFilter.js');

function runEra(candles, startMs, endMs, dxyFilter) {
  const r = runNyopetV2Backtest(candles, { ...RESCALED_4H, allowShort: false, modalDivisor: 5, startCapital: 100, startMs, dxyFilter });
  const tradesInEra = r.trades.filter((t) => t.exitTime <= endMs);
  return summarize(tradesInEra);
}

console.log('=== TES 1: Split 2 era independen -- Nyopet ===\n');
const era1Start = new Date('2020-01-01T00:00:00Z').getTime();
const era1End = new Date('2023-01-01T00:00:00Z').getTime();
const era2Start = new Date('2023-01-01T00:00:00Z').getTime();
const era2End = new Date('2026-09-01T00:00:00Z').getTime();
const dxy20 = buildDxyWeakLookup(20);

[['Nyopet BTC', CANDLES_4H], ['Nyopet Emas', CANDLES_4H_GOLD]].forEach(([label, candles]) => {
  if (!candles) { console.log(label + ': data gak ada, skip'); return; }
  console.log(`--- ${label} ---`);
  const e1_base = runEra(candles, era1Start, era1End, null);
  const e1_dxy = runEra(candles, era1Start, era1End, dxy20);
  const e2_base = runEra(candles, era2Start, era2End, null);
  const e2_dxy = runEra(candles, era2Start, era2End, dxy20);
  console.log(`  Era1 (2020-2023) TANPA DXY : n=${e1_base.n}, PF=${e1_base.profitFactor}, WR=${e1_base.winRate}`);
  console.log(`  Era1 (2020-2023) + DXY     : n=${e1_dxy.n}, PF=${e1_dxy.profitFactor}, WR=${e1_dxy.winRate}`);
  console.log(`  Era2 (2023-2026) TANPA DXY : n=${e2_base.n}, PF=${e2_base.profitFactor}, WR=${e2_base.winRate}`);
  console.log(`  Era2 (2023-2026) + DXY     : n=${e2_dxy.n}, PF=${e2_dxy.profitFactor}, WR=${e2_dxy.winRate}`);
  console.log('');
});

console.log('\n=== TES 2: Sensitivitas parameter SMA (10/20/50) -- Nyopet ===\n');
const BACKTEST_START = new Date('2020-01-01T00:00:00Z').getTime();
[10, 20, 50].forEach((smaLen) => {
  const dxy = buildDxyWeakLookup(smaLen);
  const btcR = runNyopetV2Backtest(CANDLES_4H, { ...RESCALED_4H, allowShort: false, modalDivisor: 5, startCapital: 100, startMs: BACKTEST_START, dxyFilter: dxy });
  const btcS = summarize(btcR.trades);
  let line = `SMA${smaLen}: Nyopet BTC n=${btcS.n} PF=${btcS.profitFactor} WR=${btcS.winRate} final=$${btcR.finalCapital.toFixed(0)}`;
  if (CANDLES_4H_GOLD) {
    const goldR = runNyopetV2Backtest(CANDLES_4H_GOLD, { ...RESCALED_4H, allowShort: false, modalDivisor: 5, startCapital: 100, startMs: BACKTEST_START, dxyFilter: dxy });
    const goldS = summarize(goldR.trades);
    line += ` | Nyopet Emas n=${goldS.n} PF=${goldS.profitFactor} WR=${goldS.winRate} final=$${goldR.finalCapital.toFixed(0)}`;
  }
  console.log(line);
});
