// backtestNinjaSqueezeOos.js (30 Sep 2026) -- uji KERAS kandidat "squeeze breakout 1H" dari ronde 3
// (backtestNinjaResearch3.js: 1H sqz k=4 PF net 1,74, n=97, positif tiap tahun 2024-2026). Kandidat
// ini dipilih dari 235 kombinasi -> gampang kebetulan. Uji di sini:
//   (a) OUT-OF-SAMPLE: data Sep 2019 - Sep 2024 yang GAK PERNAH dipakai buat milih parameter
//   (b) sensitivitas: lookback kompresi 50/100/200, toleransi 1,0/1,05/1,2, band 1,5/2/2,5, k 3/4/5
//   (c) lintas aset: ETHUSDT periode sama (edge asli biasanya gak cuma nempel di 1 aset)
// Eksekusi/metrik SAMA backtestNinjaResearch3.js. Pakai: NINJA_CANDLE_CACHE=/dir node backtestNinjaSqueezeOos.js
const fs = require('fs');
const path = require('path');
const { summarize } = require('./backtestNinjaFvg');
const { run } = require('./backtestNinjaResearch3');

async function fetchSym(symbol, interval, startTime, endTime) {
  const dir = process.env.NINJA_CANDLE_CACHE;
  const file = dir ? path.join(dir, `${symbol}-${interval}-${startTime}-${endTime}-v.json`) : null;
  if (file && fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  let all = [], cur = startTime;
  while (cur < endTime) {
    const r = await fetch(`https://data-api.binance.vision/api/v3/klines?symbol=${symbol}&interval=${interval}&startTime=${cur}&endTime=${endTime}&limit=1000`);
    if (!r.ok) throw new Error(`Binance ${r.status}`);
    const d = await r.json();
    if (!d.length) break;
    all = all.concat(d.map((x) => ({ openTime: x[0], open: +x[1], high: +x[2], low: +x[3], close: +x[4], volume: +x[5], closeTime: x[6] })));
    cur = d[d.length - 1][0] + 1;
  }
  all = all.filter((c) => c.closeTime < endTime);
  if (file) { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(file, JSON.stringify(all)); }
  return all;
}

const f2 = (x, d = 2) => (x === undefined || x === null || !isFinite(x) ? String(x) : x.toFixed(d));

function report(label, c, p, days) {
  const tr = run(c, p);
  if (tr.length < 10) return console.log(`${label} n=${tr.length} (terlalu sedikit)`);
  const s = summarize(tr, 60, days, 0.10);
  const years = {};
  for (const t of tr) { const y = new Date(c[t.entryIdx].closeTime).getUTCFullYear(); years[y] = (years[y] || 0) + t.grossPct - 0.10; }
  const half = Math.floor(tr.length / 2);
  const netOf = (a) => a.reduce((x, t) => x + t.grossPct - 0.10, 0);
  console.log(`${label.padEnd(40)} n=${String(s.n).padStart(4)} win=${f2(s.winNet, 1)}% PFnet=${f2(s.pfNet)} NET=${f2(s.netSumPct, 1)}% maxDD=${f2(s.maxDdPct, 1)}% | paruh ${f2(netOf(tr.slice(0, half)), 1)}/${f2(netOf(tr.slice(half)), 1)} | thn ${Object.entries(years).map(([y, v]) => `${y}:${f2(v, 1)}`).join(' ')} | @0.20 ${f2(summarize(tr, 60, days, 0.20).netSumPct, 1)}`);
  return s;
}

async function main() {
  const T_SPLIT = Date.UTC(2024, 8, 30); // batas: sebelum ini = out-of-sample (gak dipakai milih parameter)
  const T_START = Date.UTC(2019, 8, 30);
  const T_END = Date.now();
  const btcOos = await fetchSym('BTCUSDT', '1h', T_START, T_SPLIT);
  const btcIs = await fetchSym('BTCUSDT', '1h', T_SPLIT, T_END);
  const ethOos = await fetchSym('ETHUSDT', '1h', T_START, T_SPLIT);
  const ethIs = await fetchSym('ETHUSDT', '1h', T_SPLIT, T_END);
  const dOos = (T_SPLIT - T_START) / 864e5, dIs = (T_END - T_SPLIT) / 864e5;
  const base = { kind: 'sqz', exit: 'trail' };

  console.log('=== (a) OUT-OF-SAMPLE BTC 2019-09 s/d 2024-09 -- parameter PERSIS pemenang (lb100 tol1.05 bb2) ===');
  for (const k of [2, 3, 4]) report(`BTC OOS k=${k}`, btcOos, { ...base, k }, dOos);
  console.log('\n=== (b) SENSITIVITAS (BTC OOS | BTC in-sample), k=4 ===');
  const sens = [];
  for (const lb of [50, 100, 200]) for (const tol of [1.0, 1.05, 1.2]) for (const bb of [1.5, 2, 2.5]) {
    const p = { ...base, k: 4, lb, tol, bb };
    const a = report(`OOS lb=${lb} tol=${tol} bb=${bb}`, btcOos, p, dOos);
    const b = report(`IS  lb=${lb} tol=${tol} bb=${bb}`, btcIs, p, dIs);
    sens.push({ lb, tol, bb, oos: a ? a.netSumPct : null, is: b ? b.netSumPct : null });
  }
  const pos = (arr) => arr.filter((v) => v !== null && v > 0).length;
  console.log(`-> positif: OOS ${pos(sens.map((x) => x.oos))}/${sens.length}, in-sample ${pos(sens.map((x) => x.is))}/${sens.length}`);
  for (const k of [3, 5]) report(`OOS k=${k} (lb100 tol1.05 bb2)`, btcOos, { ...base, k }, dOos);
  console.log('\n=== (c) LINTAS ASET: ETHUSDT 1H, parameter pemenang ===');
  for (const k of [3, 4]) { report(`ETH OOS k=${k}`, ethOos, { ...base, k }, dOos); report(`ETH IS  k=${k}`, ethIs, { ...base, k }, dIs); }
}

if (require.main === module) main().catch((e) => { console.error('ERROR:', e.stack); process.exit(1); });
