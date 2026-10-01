// newsWindowStudy.js (1 Okt 2026) -- Olan: "ninja susah banget ya? kalo market pas volatile news? bisa
// dimanfaatkan?" Studi kejadian di jam rilis CPI / PPI / NFP / FOMC (jadwal dari fedEvents.js, 2019-2026):
//   1. Seberapa gede gerak BTC 5-15 menit pertama abis rilis vs jam biasa (jam & hari yang sama, non-news).
//   2. Strategi sederhana tanpa nebak angka: tunggu candle pertama abis rilis (5m atau 15m) close, lalu
//      IKUT (momentum) atau LAWAN (fade) arahnya, entry market di close candle itu, tahan H menit, exit
//      market. Opsional SL di ujung candle pertama (invalidasi). Fee taker 0,05%+selip 0,01% per sisi.
// DEV = event < 2023, HOLD = >= 2023 (dipilih di DEV, dinilai di HOLD).
// Pakai: node backtest/ninja/newsWindowStudy.js <cache5m.json>

const fs = require('fs');
const path = require('path');
const ev = require(path.join(__dirname, '..', '..', 'fedEvents'));

const COST = 0.12;
const SPLIT = Date.UTC(2023, 0, 1);
const c5 = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const idx = new Map(c5.map((x, i) => [x.openTime, i]));

const events = [
  ...ev.generateCpiEvents(false).map((e) => ({ ...e, type: 'CPI' })),
  ...ev.generatePpiEvents(false).map((e) => ({ ...e, type: 'PPI' })),
  ...ev.generateNfpEvents(2019, 2026, false).map((e) => ({ ...e, type: 'NFP' })),
  ...ev.generateFomcEvents(false).map((e) => ({ ...e, type: 'FOMC' })),
].filter((e) => idx.has(e.timeMs));

const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const f = (v, d = 2) => (isFinite(v) ? v.toFixed(d) : String(v));

// 1. besar gerak: |close(T+15m)-open(T)| vs baseline jam yg sama 7 hari sebelumnya (non-news)
console.log(`=== event kebaca di data: ${events.length} (${['CPI', 'PPI', 'NFP', 'FOMC'].map((t) => t + ' ' + events.filter((e) => e.type === t).length).join(', ')}) ===`);
for (const type of ['CPI', 'PPI', 'NFP', 'FOMC']) {
  const mv = [], base = [];
  for (const e of events.filter((x) => x.type === type)) {
    const i = idx.get(e.timeMs), j = idx.get(e.timeMs - 7 * 864e5);
    if (c5[i + 2]) mv.push(Math.abs(c5[i + 2].close - c5[i].open) / c5[i].open * 100);
    if (j !== undefined && c5[j + 2]) base.push(Math.abs(c5[j + 2].close - c5[j].open) / c5[j].open * 100);
  }
  console.log(`${type.padEnd(4)} gerak 15 menit pertama rata2 ${f(avg(mv))}% vs jam sama minggu lalu ${f(avg(base))}% (x${f(avg(mv) / avg(base), 1)})`);
}

// 2. strategi
function trade(e, firstBars, holdMin, mode, useSl) {
  const i = idx.get(e.timeMs);
  const k = i + firstBars - 1; // candle terakhir dari "candle pertama"
  const hold = holdMin / 5;
  if (!c5[k + hold]) return null;
  const o = c5[i].open, cl = c5[k].close;
  let hi = -Infinity, lo = Infinity;
  for (let j = i; j <= k; j++) { hi = Math.max(hi, c5[j].high); lo = Math.min(lo, c5[j].low); }
  if (cl === o) return null;
  const up = cl > o;
  const dir = (mode === 'ikut') === up ? 'long' : 'short';
  const entry = cl;
  const sl = useSl ? (dir === 'long' ? lo : hi) : null;
  let exit = c5[k + hold].close;
  if (sl !== null) {
    for (let j = k + 1; j <= k + hold; j++) {
      if (dir === 'long' ? c5[j].low <= sl : c5[j].high >= sl) { exit = dir === 'long' ? Math.min(c5[j].open, sl) : Math.max(c5[j].open, sl); break; }
    }
  }
  const g = (exit - entry) / entry * 100 * (dir === 'long' ? 1 : -1);
  return { t: e.timeMs, type: e.type, net: g - COST };
}
function st(tr) {
  if (!tr.length) return 'n=0';
  let gw = 0, gl = 0, w = 0;
  for (const t of tr) { if (t.net > 0) { gw += t.net; w++; } else gl -= t.net; }
  return `n=${tr.length} win=${f(w / tr.length * 100, 0)}% PF=${f(gl ? gw / gl : Infinity)} avg=${f(avg(tr.map((t) => t.net)), 3)}%`;
}
const rows = [];
for (const type of ['ALL', 'CPI', 'PPI', 'NFP', 'FOMC']) {
  for (const firstBars of [1, 3]) for (const holdMin of [30, 60, 120, 240]) for (const mode of ['ikut', 'lawan']) for (const useSl of [false, true]) {
    const list = events.filter((e) => type === 'ALL' || e.type === type);
    const tr = list.map((e) => trade(e, firstBars, holdMin, mode, useSl)).filter(Boolean);
    const dev = tr.filter((t) => t.t < SPLIT), hold = tr.filter((t) => t.t >= SPLIT);
    const avgDev = avg(dev.map((t) => t.net)), avgHold = avg(hold.map((t) => t.net));
    rows.push({ type, firstBars, holdMin, mode, useSl, avgDev, avgHold, line: `${type.padEnd(4)} candle1=${firstBars * 5}m tahan=${String(holdMin).padStart(3)}m ${mode.padEnd(5)}${useSl ? ' +SL' : '    '} | DEV ${st(dev)} | HOLD ${st(hold)}` });
  }
}
console.log('\n=== semua kombinasi (fee 0,12% RT sudah dipotong) ===');
for (const r of rows) console.log(r.line);
const pass = rows.filter((r) => r.avgDev > 0.05 && r.avgHold > 0.05);
console.log(`\n--- LOLOS (rata2 net > +0,05%/trade di DEV DAN HOLD): ${pass.length}/${rows.length} ---`);
for (const r of pass) console.log(r.line);
