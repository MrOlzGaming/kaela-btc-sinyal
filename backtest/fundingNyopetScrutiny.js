// Scrutiny funding-rate-sebagai-konfirmasi-entry buat Nyopet BTC -- SAMA disiplin 3-lapis kayak
// dxyNyopetScrutiny.js (breakdown per tahun WAJIB + split era independen + sensitivitas SMA).
// BTC DOANG (bukan Emas) -- funding rate itu mekanisme perpetual futures BTC yang udah lama
// establish datanya, Emas/PAXG di MEXC funding history-nya BELUM ketest/dipunya di project ini.

const { runNyopetV2Backtest, summarize, byYear, CANDLES_4H, RESCALED_4H } = require('./nyopetChartPatternFvg.js');
const { buildFundingFavorableLookup } = require('./fundingFilter.js');

const BASE_OPTS = { ...RESCALED_4H, allowShort: false, modalDivisor: 5, startCapital: 100 };

function runEra(candles, startMs, endMs, fundingFilter) {
  const r = runNyopetV2Backtest(candles, { ...BASE_OPTS, startMs, fundingFilter });
  const tradesInEra = r.trades.filter((t) => t.exitTime <= endMs);
  return summarize(tradesInEra);
}

function printByYear(label, trades) {
  const years = byYear(trades);
  const keys = Object.keys(years).sort();
  console.log(`  ${label} per tahun:`);
  keys.forEach((y) => {
    const d = years[y];
    const wr = d.count ? (d.wins / d.count * 100).toFixed(1) : '-';
    console.log(`    ${y}: n=${d.count}, totalR=${d.totalR.toFixed(2)}, winRate=${wr}%`);
  });
}

console.log('=== TES 0: Breakdown per tahun -- Nyopet BTC, baseline vs funding filter (SMA20) ===\n');
const BACKTEST_START = new Date('2020-01-01T00:00:00Z').getTime();
const funding20 = buildFundingFavorableLookup(20);
const baseR = runNyopetV2Backtest(CANDLES_4H, { ...BASE_OPTS, startMs: BACKTEST_START });
const fundR = runNyopetV2Backtest(CANDLES_4H, { ...BASE_OPTS, startMs: BACKTEST_START, fundingFilter: funding20 });
console.log(`Baseline: n=${summarize(baseR.trades).n}, PF=${summarize(baseR.trades).profitFactor}, final=$${baseR.finalCapital.toFixed(0)}`);
printByYear('Baseline', baseR.trades);
console.log(`\n+ Funding filter: n=${summarize(fundR.trades).n}, PF=${summarize(fundR.trades).profitFactor}, final=$${fundR.finalCapital.toFixed(0)}`);
printByYear('+ Funding filter', fundR.trades);

console.log('\n=== TES 1: Split 2 era independen -- Nyopet BTC ===\n');
const era1Start = new Date('2020-01-01T00:00:00Z').getTime();
const era1End = new Date('2023-01-01T00:00:00Z').getTime();
const era2Start = new Date('2023-01-01T00:00:00Z').getTime();
const era2End = new Date('2026-09-01T00:00:00Z').getTime();

const e1_base = runEra(CANDLES_4H, era1Start, era1End, null);
const e1_fund = runEra(CANDLES_4H, era1Start, era1End, funding20);
const e2_base = runEra(CANDLES_4H, era2Start, era2End, null);
const e2_fund = runEra(CANDLES_4H, era2Start, era2End, funding20);
console.log(`  Era1 (2020-2023) TANPA funding : n=${e1_base.n}, PF=${e1_base.profitFactor}, WR=${e1_base.winRate}`);
console.log(`  Era1 (2020-2023) + funding     : n=${e1_fund.n}, PF=${e1_fund.profitFactor}, WR=${e1_fund.winRate}`);
console.log(`  Era2 (2023-2026) TANPA funding : n=${e2_base.n}, PF=${e2_base.profitFactor}, WR=${e2_base.winRate}`);
console.log(`  Era2 (2023-2026) + funding     : n=${e2_fund.n}, PF=${e2_fund.profitFactor}, WR=${e2_fund.winRate}`);

console.log('\n=== TES 2: Sensitivitas parameter SMA (10/20/50 periode funding, ~3.3/6.7/16.7 hari) -- Nyopet BTC ===\n');
[10, 20, 50].forEach((smaLen) => {
  const funding = buildFundingFavorableLookup(smaLen);
  const r = runNyopetV2Backtest(CANDLES_4H, { ...BASE_OPTS, startMs: BACKTEST_START, fundingFilter: funding });
  const s = summarize(r.trades);
  console.log(`SMA${smaLen}: n=${s.n} PF=${s.profitFactor} WR=${s.winRate} final=$${r.finalCapital.toFixed(0)}`);
});
