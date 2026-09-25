// Validasi "short exposure = separuh long" (14 Sep 2026, permintaan Olan setelah izin short BTC
// real: "tunggu dengan mode ini kita backtest ulang.. btc dan emas.. semua ya.. kita backtest
// dari tahun dekat aja 2020") -- SEBELUM aturan baru ini dipercaya buat uang real, harus dibuktikan
// dulu gak ngerusak hasil dibanding versi lama (exposure short = SAMA kayak long, window-gated
// biasa yang udah live sejak 13 Sep). 4 kombinasi: Sniper BTC, Sniper Emas, Nyopet BTC, Nyopet
// Emas -- SEMUA dites, walau Emas short TETAP manual-only buat sekarang (Olan: "emas shortnya aku
// manual aja.. kita cari strategi lebih baik dulu") -- backtest ini buat VALIDASI/INFO, bukan
// buat auto-enable Emas.

const fs = require('fs');
const path = require('path');
const { sma } = require('../technicalAnalysis');
const { runFlagBacktestWindowGated, summarize: summarizeSniper } = require('../backtestFlagBreakout');
const {
  runNyopetV2BacktestWindowGated, makeBtcBearWindowFn, makeEmasBearWindowFn,
  summarize: summarizeNyopet, CANDLES_4H, CANDLES_4H_GOLD, RESCALED_4H,
} = require('./rangerChartPatternFvg');

function byYear(trades) {
  const years = {};
  trades.forEach((t) => {
    const y = new Date(t.exitTime).getUTCFullYear();
    if (!years[y]) years[y] = { count: 0, totalR: 0, wins: 0 };
    years[y].count++;
    years[y].totalR += t.rMultiple;
    if (t.rMultiple > 0) years[y].wins++;
  });
  return years;
}
function printByYear(trades) {
  const years = byYear(trades);
  Object.keys(years).sort().forEach((y) => {
    const d = years[y];
    const wr = d.count ? (d.wins / d.count * 100).toFixed(1) : '-';
    console.log(`      ${y}: n=${d.count}, totalR=${d.totalR.toFixed(2)}, winRate=${wr}%`);
  });
}
function shortStats(trades) {
  const shorts = trades.filter((t) => t.direction === 'sell');
  const s = summarizeSniper(shorts);
  return `n=${s.n} totalR=${s.totalR} avgR=${s.avgR} winRate=${s.winRate}`;
}
function eraSplit(trades, splitMs) {
  return { era1: trades.filter((t) => t.exitTime < splitMs), era2: trades.filter((t) => t.exitTime >= splitMs) };
}

const ERA_SPLIT = new Date('2023-01-01T00:00:00Z').getTime();
const START_2020 = new Date('2020-01-01T00:00:00Z').getTime();

function makeXauBearWindowFnDaily(candles, smaLen = 200) {
  const closes = candles.map((c) => c.close);
  const map = new Map();
  for (let i = 0; i < candles.length; i++) {
    const s = i >= smaLen - 1 ? sma(closes.slice(0, i + 1), smaLen) : null;
    map.set(new Date(candles[i].closeTime).toISOString().slice(0, 10), s !== null && candles[i].close < s);
  }
  return (d) => map.get(d.toISOString().slice(0, 10)) || false;
}

function runSniperCombo(label, daily, bearWindowFn) {
  console.log(`\n========== SNIPER ${label} ==========`);
  const dailyFrom2020 = daily.filter((c) => c.closeTime >= START_2020 - 200 * 86400000); // buffer warmup
  const startIdx = dailyFrom2020.findIndex((c) => c.closeTime >= START_2020);
  [
    ['LAMA (short = exposure SAMA long)', false],
    ['BARU (short = exposure SEPARUH long)', true],
  ].forEach(([variantLabel, halfShortExposure]) => {
    const r = runFlagBacktestWindowGated(dailyFrom2020, { bearWindowFn, halfShortExposure });
    const tradesFrom2020 = r.trades.filter((t) => t.exitTime >= START_2020);
    const s = summarizeSniper(tradesFrom2020);
    console.log(`\n  --- ${variantLabel} ---`);
    console.log(`  Semua: n=${s.n} PF=${s.profitFactor} totalR=${s.totalR} avgR=${s.avgR} winRate=${s.winRate} | final=$${r.finalCapital.toFixed(0)} maxDD=${r.maxDrawdownPct.toFixed(1)}%`);
    console.log(`  SHORT doang: ${shortStats(tradesFrom2020)}`);
    console.log(`  Per tahun:`);
    printByYear(tradesFrom2020);
    const { era1, era2 } = eraSplit(tradesFrom2020, ERA_SPLIT);
    const s1 = summarizeSniper(era1), s2 = summarizeSniper(era2);
    console.log(`  Era1 (2020-2023): n=${s1.n} PF=${s1.profitFactor} totalR=${s1.totalR} | Era2 (2023-2026): n=${s2.n} PF=${s2.profitFactor} totalR=${s2.totalR}`);
  });
}

function runNyopetCombo(label, candles4h, bearWindowFn) {
  console.log(`\n========== NYOPET ${label} ==========`);
  [
    ['LAMA (short = exposure SAMA long)', false],
    ['BARU (short = exposure SEPARUH long)', true],
  ].forEach(([variantLabel, halfShortExposure]) => {
    const r = runNyopetV2BacktestWindowGated(candles4h, { ...RESCALED_4H, modalDivisor: 5, bearWindowFn, halfShortExposure, startMs: undefined });
    const tradesFrom2020 = r.trades.filter((t) => t.exitTime >= START_2020);
    const s = summarizeNyopet(tradesFrom2020);
    console.log(`\n  --- ${variantLabel} ---`);
    console.log(`  Semua: n=${s.n} PF=${s.profitFactor} totalR=${s.totalR} avgR=${s.avgR} winRate=${s.winRate} | final=$${r.finalCapital.toFixed(0)} maxDD=${r.maxDrawdownPct.toFixed(1)}%`);
    console.log(`  SHORT doang: ${shortStats(tradesFrom2020)}`);
    console.log(`  Per tahun:`);
    printByYear(tradesFrom2020);
    const { era1, era2 } = eraSplit(tradesFrom2020, ERA_SPLIT);
    const s1 = summarizeNyopet(era1), s2 = summarizeNyopet(era2);
    console.log(`  Era1 (2020-2023): n=${s1.n} PF=${s1.profitFactor} totalR=${s1.totalR} | Era2 (2023-2026): n=${s2.n} PF=${s2.profitFactor} totalR=${s2.totalR}`);
  });
}

async function main() {
  const btcDaily = JSON.parse(fs.readFileSync(path.join(__dirname, 'daily-cache.json'), 'utf8'));
  const goldDaily = JSON.parse(fs.readFileSync(path.join(__dirname, 'gold-daily-cache.json'), 'utf8'));
  const { isBtcBearWindow } = require('../halvingBearWindow');

  runSniperCombo('BTC', btcDaily, isBtcBearWindow);
  runSniperCombo('EMAS', goldDaily, makeXauBearWindowFnDaily(goldDaily));
  runNyopetCombo('BTC', CANDLES_4H, makeBtcBearWindowFn());
  if (CANDLES_4H_GOLD) runNyopetCombo('EMAS', CANDLES_4H_GOLD, makeEmasBearWindowFn());
  else console.log('\nNyopet EMAS: CANDLES_4H_GOLD gak ada, skip.');
}

main().catch((e) => { console.error('ERROR shortHalfExposureValidation.js:', e.message, e.stack); process.exit(1); });
