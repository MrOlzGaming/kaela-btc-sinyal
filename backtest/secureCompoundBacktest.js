// Riset "Money Management Secure/Compound + Target 2x" (18 Sep 2026, permintaan Olan) --
// backtest historis WAJIB SEBELUM live (dikonfirmasi eksplisit, lihat plan/percakapan). Jalanin
// Sniper BTC+Emas dan Nyopet BTC+Emas, WITH ledger (`secureCompoundLedger.js`) vs BASELINE (tanpa
// ledger, sizing langsung dari capital kayak sekarang) -- window-gated engine yang SAMA PERSIS
// dipakai live (`runFlagBacktestWindowGated`/`runNyopetV2BacktestWindowGated`), zero perubahan
// sinyal/entry/exit, cuma cara sizing/capital-tracking yang beda (lihat param `ledgerStartCapital`
// baru di 2 fungsi itu -- opt-in, default null = perilaku lama).
//
// Fokus laporan (paling relevan buat Olan): final Secure (duit "aman" murni), berapa kali target
// 2x kecapai + rata2 berapa lama per siklus, DAN dibandingin ke baseline (apa money-management ini
// beneran nambah nilai, atau cuma numpang untung/rugi trend dasar yang sama).

const fs = require('fs');
const path = require('path');
const { runFlagBacktestWindowGated, summarize: summarizeSniper, makeXauBearWindowFn } = require('../backtestFlagBreakout');
const { isBtcBearWindow } = require('../halvingBearWindow');
const {
  runNyopetV2BacktestWindowGated, summarize: summarizeNyopet, makeBtcBearWindowFn, makeEmasBearWindowFn,
  CANDLES_4H, CANDLES_4H_GOLD, RESCALED_4H,
} = require('./rangerChartPatternFvg');

const START_2020 = new Date('2020-01-01T00:00:00Z').getTime();
const ERA_SPLIT = new Date('2023-01-01T00:00:00Z').getTime();
const LEDGER_START = 100;

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
function splitEra(trades) {
  const era1 = trades.filter((t) => t.exitTime < ERA_SPLIT);
  const era2 = trades.filter((t) => t.exitTime >= ERA_SPLIT);
  return { era1, era2 };
}

function printLedgerSummary(ledgerState, cycleEvents) {
  if (!ledgerState) return;
  console.log(`  [Ledger] tradingCapital=$${ledgerState.tradingCapital.toFixed(2)} secure=$${ledgerState.secure.toFixed(2)} activeCompound=$${ledgerState.activeCompound.toFixed(2)} | siklus target-2x tercapai: ${cycleEvents.length}x`);
  if (cycleEvents.length) {
    let prevTime = null;
    cycleEvents.forEach((c, idx) => {
      const days = prevTime !== null ? ((c.exitTime - prevTime) / 86400000).toFixed(0) : '-';
      console.log(`      Siklus #${c.cycleNumber}: $${c.startingWealth.toFixed(2)} -> $${c.endingWealth.toFixed(2)} (${new Date(c.exitTime).toISOString().slice(0, 10)}, ${days} hari sejak siklus sebelumnya)`);
      prevTime = c.exitTime;
    });
  }
}

function runSniperVariant(label, daily, bearWindowFn, ledgerOn) {
  const opts = { bearWindowFn };
  if (ledgerOn) opts.ledgerStartCapital = LEDGER_START;
  const r = runFlagBacktestWindowGated(daily, opts);
  const trades = r.trades.filter((t) => t.exitTime >= START_2020);
  const s = summarizeSniper(trades);
  console.log(`\n--- ${label} ---`);
  console.log(`  n=${s.n} PF=${s.profitFactor} totalR=${s.totalR} winRate=${s.winRate} | final=$${r.finalCapital.toFixed(0)} maxDD=${r.maxDrawdownPct.toFixed(1)}%`);
  console.log(`  Per tahun:`); printByYear(trades);
  const { era1, era2 } = splitEra(trades);
  const s1 = summarizeSniper(era1), s2 = summarizeSniper(era2);
  console.log(`  Era1 (2020-2023): n=${s1.n} PF=${s1.profitFactor} totalR=${s1.totalR} | Era2 (2023-2026): n=${s2.n} PF=${s2.profitFactor} totalR=${s2.totalR}`);
  if (ledgerOn) printLedgerSummary(r.ledgerState, r.cycleEvents.filter((c) => c.exitTime >= START_2020));
  return { r, trades };
}

function runNyopetVariant(label, candles, bearWindowFn, ledgerOn) {
  const opts = { ...RESCALED_4H, modalDivisor: 5, bearWindowFn };
  if (ledgerOn) opts.ledgerStartCapital = LEDGER_START;
  const r = runNyopetV2BacktestWindowGated(candles, opts);
  const trades = r.trades.filter((t) => t.exitTime >= START_2020);
  const s = summarizeNyopet(trades);
  console.log(`\n--- ${label} ---`);
  console.log(`  n=${s.n} PF=${s.profitFactor} totalR=${s.totalR} winRate=${s.winRate} | final=$${r.finalCapital.toFixed(0)} maxDD=${r.maxDrawdownPct.toFixed(1)}%`);
  console.log(`  Per tahun:`); printByYear(trades);
  const { era1, era2 } = splitEra(trades);
  const s1 = summarizeNyopet(era1), s2 = summarizeNyopet(era2);
  console.log(`  Era1 (2020-2023): n=${s1.n} PF=${s1.profitFactor} totalR=${s1.totalR} | Era2 (2023-2026): n=${s2.n} PF=${s2.profitFactor} totalR=${s2.totalR}`);
  if (ledgerOn) printLedgerSummary(r.ledgerState, r.cycleEvents.filter((c) => c.exitTime >= START_2020));
  return { r, trades };
}

console.log('========== SNIPER BTC (harian, window halving) ==========');
const btcDaily = JSON.parse(fs.readFileSync(path.join(__dirname, 'daily-cache.json'), 'utf8'));
runSniperVariant('BASELINE (tanpa ledger)', btcDaily, isBtcBearWindow, false);
runSniperVariant('LEDGER Secure/Compound', btcDaily, isBtcBearWindow, true);

console.log('\n\n========== SNIPER EMAS (harian, window SMA200) ==========');
const goldDaily = JSON.parse(fs.readFileSync(path.join(__dirname, 'gold-daily-cache.json'), 'utf8'));
const xauBearFn = makeXauBearWindowFn(goldDaily);
runSniperVariant('BASELINE (tanpa ledger)', goldDaily, xauBearFn, false);
runSniperVariant('LEDGER Secure/Compound', goldDaily, xauBearFn, true);

console.log('\n\n========== NYOPET BTC (4H, window halving) ==========');
runNyopetVariant('BASELINE (tanpa ledger)', CANDLES_4H, makeBtcBearWindowFn(), false);
runNyopetVariant('LEDGER Secure/Compound', CANDLES_4H, makeBtcBearWindowFn(), true);

if (CANDLES_4H_GOLD) {
  console.log('\n\n========== NYOPET EMAS (4H, window SMA1200) ==========');
  runNyopetVariant('BASELINE (tanpa ledger)', CANDLES_4H_GOLD, makeEmasBearWindowFn(), false);
  runNyopetVariant('LEDGER Secure/Compound', CANDLES_4H_GOLD, makeEmasBearWindowFn(), true);
}
