// backtest/donchianGoldLiveExit.js (4 Okt 2026, riset malam) -- lanjutan donchianGoldWindow.js. Cek dulu ternyata baseline
// "SMA1200 window (LIVE)" di riset Emas lama udah BASI: Ranger Emas LIVE sekarang LONG-ONLY TANPA window (inBearWindow cuma
// BTC, rangerAutoTrader.js) + exit 1/2 @3R, trailing SMA60 (PARTIAL_RR_BY_ASSET.xau=3). Jadi pertanyaan yang BENER:
// "apa nahan LONG Emas pas rezim Donchian bear memperbaiki sistem live?" -- diuji pakai MESIN EXIT LIVE (rangerExitResearch.js).
//   baseline  : tanpa window (= live)
//   gerbang   : entry long di-skip pas Donchian bear (posisi yang udah jalan dibiarin)
//   gerbang+FC: + posisi long ditutup paksa pas rezim ganti ke bear (kayak WINDOW_FLIP)
// Lolos = membaik di DUA era (<2023 / >=2023) + dataran N (bukan 1 titik). Fee 0,12%.
// Pakai: node backtest/donchianGoldLiveExit.js <multicoinCacheDir>   (butuh XAUUSDT-1h.json)
process.env.NOBEAR = '1'; // WAJIB sebelum require: precomputeSignals baca env pas module load
const fs = require('fs');
const path = require('path');
const { precomputeSignals, runVariant, smaArr, atrArr } = require('./rangerExitResearch');
const { resampleTo4h } = require('./rangerChartPatternFvg');

const dir = process.argv[2];
if (!dir) { console.log('Pakai: node backtest/donchianGoldLiveExit.js <multicoinCacheDir>'); process.exit(1); }
const c = resampleTo4h(JSON.parse(fs.readFileSync(path.join(dir, 'XAUUSDT-1h.json'), 'utf8')));
const ind = { atr: atrArr(c), sma: { 30: smaArr(c, 30), 60: smaArr(c, 60), 90: smaArr(c, 90), 120: smaArr(c, 120) } };
const base = precomputeSignals(c, 'XAU');
const LIVE = { partialRR: 3, partialFrac: 0.5, sma: 60 };
const SPLIT = Date.UTC(2023, 0, 1);

function donchianBear(n) {
  const out = new Array(c.length).fill(false); let bear = false;
  for (let i = 0; i < c.length; i++) {
    if (i >= n) {
      let hi = -Infinity, lo = Infinity;
      for (let k = i - n; k < i; k++) { if (c[k].high > hi) hi = c[k].high; if (c[k].low < lo) lo = c[k].low; }
      if (!bear && c[i].close < lo) bear = true; else if (bear && c[i].close > hi) bear = false;
    }
    out[i] = bear;
  }
  return out;
}
function st(tr) {
  let w = 0, l = 0, s = 0; for (const t of tr) { s += t.net; if (t.net > 0) w += t.net; else l -= t.net; }
  return { n: tr.length, pf: l ? w / l : (w ? 99 : 0), avg: tr.length ? s / tr.length : 0 };
}
function equity(tr) { // compounding pakai porsi notional (sizing kalkulator modal/5) -- sama rotation() riset exit
  let eq = 100, peak = 100, dd = 0; for (const t of tr) { eq += eq * t.notionalFrac * t.net / 100; peak = Math.max(peak, eq); dd = Math.max(dd, (peak - eq) / peak * 100); }
  return { eq, dd };
}
const fmt = (s) => `n${s.n} PF ${s.pf.toFixed(2)} avg ${s.avg >= 0 ? '+' : ''}${s.avg.toFixed(2)}%`;
function report(label, pre) {
  const tr = runVariant(c, pre, ind, LIVE);
  const e1 = tr.filter((t) => t.t < SPLIT), e2 = tr.filter((t) => t.t >= SPLIT);
  const q1 = equity(e1), q2 = equity(e2);
  console.log(`${label.padEnd(30)} | semua ${fmt(st(tr))} | <2023 ${fmt(st(e1))} modal x${(q1.eq / 100).toFixed(2)} DD ${q1.dd.toFixed(0)}% | >=2023 ${fmt(st(e2))} modal x${(q2.eq / 100).toFixed(2)} DD ${q2.dd.toFixed(0)}% | FLIP ${tr.filter((t) => t.reason === 'FLIP').length}`);
  return { e1: st(e1), e2: st(e2) };
}

console.log(`Emas 4H ${c.length} candle ${new Date(c[0].openTime).toISOString().slice(0, 10)}..${new Date(c[c.length - 1].openTime).toISOString().slice(0, 10)}, sinyal long ${base.sig.filter(Boolean).length} (exit LIVE 1/2 @3R + SMA60, fee 0,12%)`);
const b = report('BASELINE tanpa window (LIVE)', base);
let better = { gate: 0, fc: 0 }, total = 0;
for (const days of [10, 15, 20, 25, 30, 40, 55, 100]) {
  const bear = donchianBear(days * 6);
  const gated = { sig: base.sig.map((s, i) => (s && !bear[i] ? s : null)), bear: new Array(c.length).fill(false) };
  const g = report(`Donchian ${days}h gerbang`, gated);
  const fc = report(`Donchian ${days}h gerbang+FC`, { sig: gated.sig, bear });
  total++;
  if (g.e1.pf > b.e1.pf && g.e2.pf > b.e2.pf) better.gate++;
  if (fc.e1.pf > b.e1.pf && fc.e2.pf > b.e2.pf) better.fc++;
}
console.log(`\nMembaik di DUA era vs baseline live: gerbang ${better.gate}/${total} N, gerbang+FC ${better.fc}/${total} N.`);
