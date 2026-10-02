// sniperExitResearch.js (3 Okt 2026) -- lanjutan riset exit (rangerExitResearch.js: partial 33% @2R menang di Ranger 4H).
// Apakah sama berlaku buat SNIPER (BTC harian, window-gated, engine runFlagBacktestWindowGated = engine validasi Sniper)?
// Variasi: porsi partial (1/2 sekarang vs 1/3), target partial (2R vs 3R), trailing SMA harian (10 sekarang vs 20).
// Era <2023 / >=2023 (by exitTime). Data: backtest/daily-cache.json (BTC harian).
// Pakai: node backtest/sniperExitResearch.js

const fs = require('fs');
const path = require('path');
const { runFlagBacktestWindowGated, summarize } = require('../backtestFlagBreakout');
const { isBtcBearWindow } = require('../halvingBearWindow');

const SPLIT = Date.UTC(2023, 0, 1);
const daily = JSON.parse(fs.readFileSync(path.join(__dirname, 'daily-cache.json'), 'utf8'));
const pf = (tr) => { let w = 0, l = 0; for (const t of tr) { if (t.rMultiple > 0) w += t.rMultiple; else l -= t.rMultiple; } return l ? w / l : Infinity; };
const sumR = (tr) => tr.reduce((a, t) => a + t.rMultiple, 0);
console.log(`BTC harian: ${daily.length} candle ${new Date(daily[0].closeTime).toISOString().slice(0, 10)} -> ${new Date(daily.at(-1).closeTime).toISOString().slice(0, 10)}`);
const VARIANTS = [
  { name: 'SEKARANG: partial 1/2 @2R, trail SMA10', partialFrac: 0.5, partialRR: 2, trailSmaLen: 10 },
  { name: 'partial 1/3 @2R, trail SMA10', partialFrac: 1 / 3, partialRR: 2, trailSmaLen: 10 },
  { name: 'partial 1/2 @3R, trail SMA10', partialFrac: 0.5, partialRR: 3, trailSmaLen: 10 },
  { name: 'partial 1/3 @3R, trail SMA10', partialFrac: 1 / 3, partialRR: 3, trailSmaLen: 10 },
  { name: 'partial 1/2 @2R, trail SMA20', partialFrac: 0.5, partialRR: 2, trailSmaLen: 20 },
  { name: 'partial 1/3 @2R, trail SMA20', partialFrac: 1 / 3, partialRR: 2, trailSmaLen: 20 },
];
for (const v of VARIANTS) {
  const r = runFlagBacktestWindowGated(daily, { bearWindowFn: (d) => isBtcBearWindow(d), partialFrac: v.partialFrac, partialRR: v.partialRR, trailSmaLen: v.trailSmaLen });
  const tr = r.trades;
  const e1 = tr.filter((t) => t.exitTime < SPLIT), e2 = tr.filter((t) => t.exitTime >= SPLIT);
  console.log(`${v.name.padEnd(40)} n=${tr.length} PF(R) ${pf(tr).toFixed(2)} totalR ${sumR(tr).toFixed(1)} | <2023 n=${e1.length} PF ${pf(e1).toFixed(2)} R ${sumR(e1).toFixed(1)} | >=2023 n=${e2.length} PF ${pf(e2).toFixed(2)} R ${sumR(e2).toFixed(1)} | $100 -> $${r.finalCapital.toFixed(0)} DD ${r.maxDrawdownPct.toFixed(1)}%`);
}
