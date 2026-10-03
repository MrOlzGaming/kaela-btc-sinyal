// fngRangerStudy.js (4 Okt 2026) -- lanjutan fngFilterStudy.js: apa short Ranger BTC pola chart/FVG (window bear) juga jelek pas
// F&G takut ekstrem? Sinyal Ranger PERSIS (precomputeSignals), exit trailing 3x, 1 posisi, fee 0,12%. Pakai: <cacheDir> <fng.json>
const fs = require('fs');
const path = require('path');
const R = require('./rangerExitResearch');
const { resampleTo4h } = require('./rangerChartPatternFvg');
const c = resampleTo4h(JSON.parse(fs.readFileSync(path.join(process.argv[2], 'BTCUSDT-1h.json'), 'utf8')));
const fng = new Map(JSON.parse(fs.readFileSync(process.argv[3], 'utf8')).data.map((d) => [new Date(d.timestamp * 1000).toISOString().slice(0, 10), Number(d.value)]));
const pre = R.precomputeSignals(c, 'BTC');
const trades = []; let pos = null;
for (let i = R.P.warmupCandles; i < c.length; i++) {
  const x = c[i];
  if (pos) {
    const L = pos.dir > 0;
    let exit = null;
    if ((L && pre.bear[i]) || (!L && !pre.bear[i])) exit = x.close;
    else if (L ? x.low <= pos.stop : x.high >= pos.stop) exit = L ? Math.min(x.open, pos.stop) : Math.max(x.open, pos.stop);
    if (exit !== null) { trades.push({ t: pos.t, dir: pos.dir, r: ((exit - pos.entry) * pos.dir - 0.0012 * pos.entry) / pos.risk, fng: pos.fng }); pos = null; continue; }
    pos.best = L ? Math.max(pos.best, x.high) : Math.min(pos.best, x.low);
    const cand = pos.best - pos.dir * 3 * pos.risk; pos.stop = L ? Math.max(pos.stop, cand) : Math.min(pos.stop, cand);
    continue;
  }
  const s = pre.sig[i]; if (!s) continue;
  pos = { t: x.openTime, dir: s.dir === 'buy' ? 1 : -1, entry: x.close, stop: s.sl, risk: Math.abs(x.close - s.sl), best: x.close, fng: fng.get(new Date(x.openTime).toISOString().slice(0, 10)) };
}
const pf = (a) => { const w = a.filter((t) => t.r > 0).reduce((s, t) => s + t.r, 0), l = -a.filter((t) => t.r <= 0).reduce((s, t) => s + t.r, 0); return l ? (w / l).toFixed(2) : (w ? 'inf' : '-'); };
const tot = (a) => a.reduce((s, t) => s + t.r, 0).toFixed(1);
for (const dir of [1, -1]) {
  const d = trades.filter((t) => t.dir === dir && t.fng !== undefined);
  const lo = d.filter((t) => t.fng < 25), hi = d.filter((t) => t.fng >= 25);
  console.log(`${dir > 0 ? 'LONG ' : 'SHORT'} n=${d.length} | F&G<25: n=${lo.length} PF ${pf(lo)} totR ${tot(lo)} | F&G>=25: n=${hi.length} PF ${pf(hi)} totR ${tot(hi)}`);
}
