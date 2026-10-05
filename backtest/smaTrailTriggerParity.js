// backtest/smaTrailTriggerParity.js (5 Okt 2026, audit paritas live vs backtest) -- trailing SMA60 4H (alt Ranger Rotasi + Ranger
// Emas, sisa posisi sesudah partial). Backtest yang memvalidasi (rangerExitResearch.js runVariant): keluar kalau CLOSE candle 4H
// < SMA60. Live (rangerRotation.js monitor + rangerAutoTrader.js trailBroken): keluar begitu HARGA LIVE (cek tiap 15 mnt) < SMA60
// -- ekor candle sesaat aja udah bikin keluar. Seberapa beda? Mode 'intrabar' = low candle tembus SMA60 candle sebelumnya
// (level yang udah diketahui) -> keluar di level itu (atau open kalau gap).
// Exit lain SAMA PERSIS runVariant: SL intrabar, partial 1/3 @2R -> SL ke entry, tutup paksa window. Fee 0,12%.
// Pakai: node backtest/smaTrailTriggerParity.js <multicoinCacheDir>
const fs = require('fs');
const path = require('path');
const dir = process.argv[2];
const SPLIT = Date.UTC(2023, 0, 1);
const V = { partialRR: 2, partialFrac: 1 / 3, sma: 60 };

function load(coin, nobear) {
  process.env.NOBEAR = nobear ? '1' : '0';
  for (const k of Object.keys(require.cache)) if (k.includes('rangerExitResearch')) delete require.cache[k];
  const R = require('./rangerExitResearch');
  const { resampleTo4h } = require('./rangerChartPatternFvg');
  const c = resampleTo4h(JSON.parse(fs.readFileSync(path.join(dir, `${coin}USDT-1h.json`), 'utf8')));
  return { c, pre: R.precomputeSignals(c, coin), sma: R.smaArr(c, V.sma), P: R.P, FEE: R.FEE };
}
function run({ c, pre, sma, P, FEE }, mode) {
  const { hitung } = require('../calculator');
  const trades = []; let pos = null;
  for (let i = P.warmupCandles; i < c.length; i++) {
    const x = c[i];
    if (pos) {
      const L = pos.dir === 'buy', sgn = L ? 1 : -1, mv = (px) => (px - pos.entry) / pos.entry * 100 * sgn;
      const done = (px, reason) => { const rest = pos.partialDone ? 1 - V.partialFrac : 1; trades.push({ t: c[pos.idx].openTime, net: (pos.partialDone ? V.partialFrac * pos.pmv : 0) + rest * mv(px) - FEE, reason }); pos = null; };
      if ((L && pre.bear[i]) || (!L && !pre.bear[i])) { done(x.close, 'FLIP'); continue; }
      if (L ? x.low <= pos.stop : x.high >= pos.stop) { done(L ? Math.min(x.open, pos.stop) : Math.max(x.open, pos.stop), 'SL'); continue; }
      if (!pos.partialDone) {
        const tp = pos.entry + sgn * pos.risk * V.partialRR;
        if (L ? x.high >= tp : x.low <= tp) { pos.partialDone = true; pos.pmv = mv(tp); pos.stop = pos.entry; }
        continue;
      }
      if (mode === 'close') { if (sma[i] !== null && (L ? x.close < sma[i] : x.close > sma[i])) { done(x.close, 'SMA'); continue; } }
      else { const s = sma[i - 1]; if (s !== null && (L ? x.low < s : x.high > s)) { done(L ? Math.min(x.open, s) : Math.max(x.open, s), 'SMA'); continue; } }
      continue;
    }
    const s = pre.sig[i]; if (!s) continue;
    const calc = hitung({ modal: 20, entry: x.close, stopLoss: s.sl, direction: s.dir });
    if (!(calc.nilaiPosisi > 0) || calc.margin > 20) continue;
    pos = { dir: s.dir, entry: x.close, idx: i, risk: Math.abs(x.close - s.sl), stop: s.sl, partialDone: false, pmv: 0 };
  }
  return trades;
}
function st(tr) { let w = 0, l = 0, s = 0; for (const t of tr) { s += t.net; if (t.net > 0) w += t.net; else l -= t.net; } return { n: tr.length, pf: l ? w / l : 99, sum: s }; }
const fmt = (s) => `n${String(s.n).padStart(3)} PF ${s.pf.toFixed(2)} total ${s.sum >= 0 ? '+' : ''}${s.sum.toFixed(0)}%`;

const groups = [['7 alt rotasi (SOL DOGE TRX INJ ETH XLM BNB)', ['SOL', 'DOGE', 'TRX', 'INJ', 'ETH', 'XLM', 'BNB'], false], ['Emas (Ranger, tanpa window)', ['XAU'], true]];
for (const [name, coins, nobear] of groups) {
  const res = { close: [], intrabar: [] };
  for (const coin of coins) { const d = load(coin, nobear); for (const m of ['close', 'intrabar']) res[m].push(...run(d, m)); }
  console.log(`\n== ${name} ==`);
  for (const m of ['close', 'intrabar']) {
    const tr = res[m];
    console.log(`  ${m === 'close' ? 'BACKTEST (close < SMA60)     ' : 'LIVE (harga sesaat < SMA60)  '} | <2023 ${fmt(st(tr.filter((t) => t.t < SPLIT)))} | >=2023 ${fmt(st(tr.filter((t) => t.t >= SPLIT)))}`);
  }
}
