// backtest/dxyRangerTwoSlotCheck.js (4 Okt 2026) -- uji ulang LENGKAP filter DXY Ranger BTC pakai mesin yang lebih setia ke live
// (lanjutan dxyLiveExitCheck.js yang cuma 1 slot). Live (rangerAutoTrader.js + rangerBtcDualExec.js):
//   - 2 slot INDEPENDEN: "pattern" (flag -> wedge) & "fvg" -- masing2 posisi sendiri, boleh barengan
//   - window halving BTC (long pas bull, short pas bear, exposure short /2 lewat kalkulator), tutup paksa pas window ganti
//   - exit trailing 3x jarak invalidasi dari entry (tanpa partial)
//   - filter DXY: entry baru (dua slot) dijeda kalau close DXY harian terakhir >= SMA20 (dolar kuat). Slot sweep GAK pakai DXY.
// Tiap slot = runVariant (rangerExitResearch.js) terpisah dgn sinyal slot itu doang -> trade digabung.
// Rigor: era <2023 / >=2023, sensitivitas SMA DXY 10/20/30/50, + permutasi: DXY "palsu" (urutan hari DXY diacak blok 20 hari)
// buat ngukur apa beda hasil filter asli lebih gede dari filter acak dgn porsi skip sama.
// Pakai: node backtest/dxyRangerTwoSlotCheck.js <multicoinCacheDir>
const fs = require('fs');
const path = require('path');
const { runVariant, smaArr, atrArr, P } = require('./rangerExitResearch');
const { detectFlag, detectWedge } = require('../chartPatterns');
const { detectFvgSignalBoth, makeBtcBearWindowFn, resampleTo4h } = require('./rangerChartPatternFvg');

const dir = process.argv[2];
const c = resampleTo4h(JSON.parse(fs.readFileSync(path.join(dir, 'BTCUSDT-1h.json'), 'utf8')));
const ind = { atr: atrArr(c), sma: { 30: smaArr(c, 30), 60: smaArr(c, 60), 90: smaArr(c, 90), 120: smaArr(c, 120) } };
const LIVE = { partialRR: null, partialFrac: 0, trailR: 3 };
const SPLIT = Date.UTC(2023, 0, 1);

// sinyal per slot -- urutan & syarat SAMA precomputeSignals (rangerExitResearch.js), cuma dipisah per slot
const bearFn = makeBtcBearWindowFn();
const bear = new Array(c.length).fill(false), patSig = new Array(c.length).fill(null), fvgSig = new Array(c.length).fill(null);
for (let i = P.warmupCandles; i < c.length; i++) {
  const b = bearFn(c, i); bear[i] = b;
  const last = c[i].close;
  let s = null;
  const flag = detectFlag(c, i, { poleLookbackRange: P.poleLookbackRange, poleMinMovePct: P.poleMinMovePct, flagLookbackRange: P.flagLookbackRange, flagMaxRangePct: P.flagMaxRangePct });
  if (!b && flag && flag.type === 'bull' && last > flag.flagHigh) s = { dir: 'buy', sl: flag.flagLow * (1 - P.slBufferPct / 100) };
  else if (b && flag && flag.type === 'bear' && last < flag.flagLow) s = { dir: 'sell', sl: flag.flagHigh * (1 + P.slBufferPct / 100) };
  if (!s) {
    const w = detectWedge(c, i, { wedgeLookbackRange: P.wedgeLookbackRange, minTouches: P.wedgeMinTouches, convergenceRatio: P.wedgeConvergenceRatio });
    if (b && w && w.type === 'rising' && last < w.projectedSupport) s = { dir: 'sell', sl: w.recentSwingHigh * (1 + P.slBufferPct / 100) };
    else if (!b && w && w.type === 'falling' && last > w.projectedResistance) s = { dir: 'buy', sl: w.recentSwingLow * (1 - P.slBufferPct / 100) };
  }
  if (s && Math.abs(last - s.sl) > 0) patSig[i] = s;
  const fv = detectFvgSignalBoth(c, i, { slBufferPct: P.slBufferPct, trendSmaLen: P.fvgTrendSmaLen, allowShort: true });
  if (fv && ((fv.direction === 'buy' && !b) || (fv.direction === 'sell' && b)) && Math.abs(last - fv.sl) > 0) fvgSig[i] = { dir: fv.direction, sl: fv.sl };
}

const dxyRaw = JSON.parse(fs.readFileSync(path.join(__dirname, 'dxy-daily-cache.json'), 'utf8'));
const dxyAll = (Array.isArray(dxyRaw) ? dxyRaw : dxyRaw.candles).sort((a, b) => a.closeTime - b.closeTime);
const lastDxyMs = dxyAll[dxyAll.length - 1].closeTime;
function weakFn(dxy, len) {
  const t = dxy.map((d) => d.closeTime), cl = dxy.map((d) => d.close);
  return (ms) => {
    let lo = 0, hi = t.length - 1, k = -1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (t[m] <= ms) { k = m; lo = m + 1; } else hi = m - 1; }
    if (k < len - 1) return null;
    let s = 0; for (let j = k - len + 1; j <= k; j++) s += cl[j];
    return cl[k] < s / len;
  };
}
function runSlots(filter) {
  const keep = (sig) => sig.map((s, i) => (s && (!filter || filter(c[i].closeTime) !== false) ? s : null));
  const tr = [...runVariant(c, { sig: keep(patSig), bear }, ind, LIVE).map((t) => ({ ...t, slot: 'pattern' })),
    ...runVariant(c, { sig: keep(fvgSig), bear }, ind, LIVE).map((t) => ({ ...t, slot: 'fvg' }))];
  return tr.filter((t) => t.t <= lastDxyMs);
}
// R-ish: net % x porsi notional (sizing kalkulator modal/5) = kontribusi ke modal per trade (gak compounding, adil antar slot)
const contrib = (t) => t.net * t.notionalFrac;
function st(tr) { let w = 0, l = 0, s = 0; for (const t of tr) { const x = contrib(t); s += x; if (x > 0) w += x; else l -= x; } return { n: tr.length, pf: l ? w / l : (w ? 99 : 0), sum: s }; }
const fmt = (s) => `n${s.n} PF ${s.pf.toFixed(2)} total ${s.sum >= 0 ? '+' : ''}${s.sum.toFixed(1)}% modal`;
function line(label, tr) {
  const e1 = st(tr.filter((t) => t.t < SPLIT)), e2 = st(tr.filter((t) => t.t >= SPLIT));
  console.log(`${label.padEnd(24)} | <2023 ${fmt(e1)} | >=2023 ${fmt(e2)}`);
  return { e1, e2 };
}

console.log(`BTC 4H ${c.length} candle ${new Date(c[0].openTime).toISOString().slice(0, 10)}..${new Date(lastDxyMs).toISOString().slice(0, 10)} | sinyal pattern ${patSig.filter(Boolean).length}, fvg ${fvgSig.filter(Boolean).length} | exit trailing 3x, 2 slot`);
const base = line('TANPA DXY', runSlots(null));
const res = {};
for (const len of [10, 20, 30, 50]) res[len] = line(`DXY SMA${len}${len === 20 ? ' (LIVE)' : ''}`, runSlots(weakFn(dxyAll, len)));

// permutasi: acak urutan BLOK 20 hari harga DXY (pertahanin struktur tren lokal), filter SMA20 di DXY palsu itu
let seed = 7; const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const real = res[20];
const deltaReal = (real.e1.sum - base.e1.sum) + (real.e2.sum - base.e2.sum);
let ge = 0; const N = 200;
for (let k = 0; k < N; k++) {
  const blocks = []; for (let i = 0; i < dxyAll.length; i += 20) blocks.push(dxyAll.slice(i, i + 20).map((d) => d.close));
  for (let i = blocks.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [blocks[i], blocks[j]] = [blocks[j], blocks[i]]; }
  const closes = blocks.flat();
  const fake = dxyAll.map((d, i) => ({ closeTime: d.closeTime, close: closes[i] }));
  const tr = runSlots(weakFn(fake, 20));
  const a = st(tr.filter((t) => t.t < SPLIT)), b = st(tr.filter((t) => t.t >= SPLIT));
  if ((a.sum - base.e1.sum) + (b.sum - base.e2.sum) >= deltaReal) ge++;
}
console.log(`\nEfek filter DXY SMA20 (LIVE) vs tanpa: <2023 ${(real.e1.sum - base.e1.sum).toFixed(1)}%, >=2023 ${(real.e2.sum - base.e2.sum).toFixed(1)}% modal.`);
console.log(`Permutasi (DXY palsu, blok 20 hari diacak, ${N}x): p = ${((ge + 1) / (N + 1)).toFixed(3)} (seberapa sering filter ACAK sama/lebih bagus dari filter DXY asli)`);
