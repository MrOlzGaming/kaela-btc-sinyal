// mrTrailingCompare.js (30 Sep 2026) -- Olan: "pake trailing jg yaaa" untuk Ninja Mean Reversion.
// Bandingin exit: 'mean' (tutup pas balik ke SMA20, versi paper sekarang) vs 'trail' (trailing k x ATR
// sejak entry) vs 'meanTrail' (SL diam sampai balik ke SMA20, lalu trailing trailK x ATR -- "TP
// trailing"). TANPA fee (keputusan Olan) + pembanding slippage 0,01%/sisi. In-sample Sep 2024-Sep 2026
// DAN out-of-sample Sep 2019-Sep 2024, BTC 15M & 5M.
// Pakai: node backtest/ninja/mrTrailingCompare.js <dir cache candle NINJA_CANDLE_CACHE>
const fs = require('fs'), path = require('path');
const R = path.join(__dirname, '..', '..') + '/';
const { run } = require(R + 'backtestNinjaResearch3');
const { summarize } = require(R + 'backtestNinjaFvg');
const dir = process.argv[2];
const S = Date.UTC(2019, 8, 30), SP = Date.UTC(2024, 8, 30), E = Date.UTC(2026, 8, 30);
const load = (tf, a, b) => JSON.parse(fs.readFileSync(path.join(dir, `BTCUSDT-${tf}-${a}-${b}-v.json`)));
const f2 = (x, d = 1) => (isFinite(x) ? x.toFixed(d) : String(x));
for (const tf of ['15m', '5m']) {
  const tfm = tf === '5m' ? 5 : 15;
  const data = [['IS', load(tf, SP, E), 730], ['OOS', load(tf, S, SP), 1827]];
  const variants = [];
  for (const k of [2, 3, 4]) {
    variants.push({ k, exit: 'mean' });
    variants.push({ k, exit: 'trail' });
    for (const trailK of [0.5, 1, 1.5, 2]) variants.push({ k, exit: 'meanTrail', trailK });
  }
  console.log(`\n=== BTC ${tf} (NET @fee 0 | @slip 0,01%/sisi) ===`);
  for (const v of variants) {
    const out = [];
    for (const [nm, c, days] of data) {
      const tr = run(c, { kind: 'mr', trend: true, ...v });
      const s0 = summarize(tr, tfm, days, 0), s1 = summarize(tr, tfm, days, 0.02);
      const y = {};
      for (const t of tr) { const yy = new Date(c[t.entryIdx].closeTime).getUTCFullYear(); y[yy] = (y[yy] || 0) + t.grossPct; }
      out.push(`${nm} n=${s0.n} win=${f2(s0.winNet)}% PF=${f2(s0.pfNet, 2)} NET=${f2(s0.netSumPct)}%|${f2(s1.netSumPct)}% DD=${f2(s0.maxDdPct)}% hold=${f2(s0.medianHoldMin, 0)}m best=${f2(s0.bestTradePct, 2)}% [${Object.entries(y).map(([a, b]) => a.slice(2) + ':' + f2(b, 0)).join(' ')}]`);
    }
    console.log(`k=${v.k} ${v.exit}${v.trailK ? ' trailK=' + v.trailK : ''}`.padEnd(26) + out.join(' || '));
  }
}
