// backtestNinjaBcGame.js (30 Sep 2026) -- riset NINJA untuk venue TANPA fee buka/tutup (info Olan:
// "tempat nyopet gratis fee tapi di bc game.. fee buka tutup gratis. Tapi biaya inap per 8 jam 0.5%").
// Latar: riset Ninja 30 Sep 2026 nunjukin banyak pola timeframe rendah punya PF GROSS ~1,1-1,3 tapi
// habis dimakan fee taker ~0,10%. Kalau fee 0, apa ada yang lolos -- dengan biaya inap sebagai
// gantinya?
//
// Biaya inap BC.Game GAK ketemu di dokumentasi publik -> 3 skenario (terburuk dulu):
//   H1 -- 0,5% NOTIONAL dipotong tiap posisi LEWAT jam 00/08/16 UTC (model funding exchange umum)
//   H2 -- 0,5% notional per 8 jam, pro-rata per jam (0,0625%/jam)
//   H3 -- 0,5% dari MARGIN per 8 jam di leverage 50x = 0,01% notional per lewat 00/08/16 UTC
// + slippage per sisi (fee 0 != harga fill sempurna): 0,01% (dasar) dan 0,03% (uji tekanan).
//
// Keluarga pola (semua dari riset sebelumnya, file masing-masing): Donchian & liquidity sweep
// (backtestNinjaCandidates.js), mean reversion Bollinger & squeeze (backtestNinjaResearch3.js), FVG
// (ninjaFvg.js). Ditambah time-stop (tutup paksa setelah 8 jam) karena biaya inap menghukum posisi
// lama. Pemilihan parameter di IN-SAMPLE (Sep 2024 - Sep 2026); 10 terbaik WAJIB diuji
// OUT-OF-SAMPLE (Sep 2019 - Sep 2024, gak dipakai milih) -- pelajaran dari squeeze 1H yang lolos
// in-sample tapi gagal OOS.
//
// Pakai: NINJA_CANDLE_CACHE=/dir node backtestNinjaBcGame.js

const fs = require('fs');
const path = require('path');
const { summarize, fvgTrades } = require('./backtestNinjaFvg');
const { run: runCand } = require('./backtestNinjaCandidates');
const { run: runR3 } = require('./backtestNinjaResearch3');
const { deflatedSharpeRatio, metricProfitFactor } = require('./backtest/backtestValidation');

const TF_MIN = { '5m': 5, '15m': 15, '1h': 60 };
const PRIOR_TRIALS = 235 + 27; // ronde 1-3 + sensitivitas squeeze OOS
// Skenario yang dipakai MILIH & menilai (default H1 terburuk). NINJA_BC_SCEN='H3 slip.01' kalau biaya
// inap ternyata dari margin, bukan notional.
const SEL = process.env.NINJA_BC_SCEN || 'H1 slip.01';
const T_OOS_START = Date.UTC(2019, 8, 30), T_SPLIT = Date.UTC(2024, 8, 30), T_END = Date.UTC(2026, 8, 30);
const H8 = 8 * 3600e3;

async function fetchSym(interval, startTime, endTime) {
  const dir = process.env.NINJA_CANDLE_CACHE;
  const file = dir ? path.join(dir, `BTCUSDT-${interval}-${startTime}-${endTime}-v.json`) : null;
  if (file && fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  let all = [], cur = startTime;
  while (cur < endTime) {
    const r = await fetch(`https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=${interval}&startTime=${cur}&endTime=${endTime}&limit=1000`);
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

// Jumlah batas 00/08/16 UTC yang dilewati posisi (entryT, exitT].
function boundariesCrossed(entryT, exitT) { return Math.max(0, Math.floor(exitT / H8) - Math.floor(entryT / H8)); }

const SCEN = {
  'H1 slip.01': { slip: 0.01, hold: (a, b) => 0.5 * boundariesCrossed(a, b) },
  'H2 slip.01': { slip: 0.01, hold: (a, b) => 0.0625 * ((b - a) / 3600e3) },
  'H3 slip.01': { slip: 0.01, hold: (a, b) => 0.01 * boundariesCrossed(a, b) },
  'H1 slip.03': { slip: 0.03, hold: (a, b) => 0.5 * boundariesCrossed(a, b) },
};

// Konversi trade -> "grossPct" SETELAH biaya skenario (biar summarize() di fee 0 = net skenario).
function applyCost(trades, c, sc) {
  return trades.map((t) => {
    const a = c[t.entryIdx].openTime, b = c[t.exitIdx].closeTime;
    return { ...t, grossRaw: t.grossPct, grossPct: t.grossPct - 2 * sc.slip - sc.hold(a, b) };
  });
}

function runFamily(c, tf, p) {
  if (p.fam === 'cand') return runCand(c, p);
  if (p.fam === 'r3') return runR3(c, p);
  if (p.fam === 'fvg') return fvgTrades(c, tf, { minWidthPct: p.w, maxAgeBars: tf === '1h' ? 168 : 288, slMultiple: 2 });
  return [];
}

function labelOf(p) {
  const mh = p.maxHoldBars ? ' mh8j' : '';
  if (p.fam === 'cand') return `${p.kind}-${p.n} k=${p.k}${mh}`;
  if (p.fam === 'r3') return `${p.kind}${p.trend ? '+trend' : ''} k=${p.k} ${p.exit}${mh}`;
  return `fvg w>=${p.w}`;
}

const f2 = (x, d = 2) => (x === undefined || x === null || !isFinite(x) ? String(x) : x.toFixed(d));
const sum = (a) => a.reduce((x, y) => x + y, 0);

function line(tr, c, tfMin, days) {
  const s = summarize(tr, tfMin, days, 0);
  const years = {};
  for (const t of tr) { const y = new Date(c[t.entryIdx].closeTime).getUTCFullYear(); years[y] = (years[y] || 0) + t.grossPct; }
  const half = Math.floor(tr.length / 2);
  return { s, txt: `n=${String(s.n).padStart(5)} (${f2(s.perDay, 1)}/hr) win=${f2(s.winNet, 1)}% PF=${f2(s.pfNet)} NET=${f2(s.netSumPct, 1)}% maxDD=${f2(s.maxDdPct, 1)}% hold=${f2(s.medianHoldMin, 0)}m `
    + `| paruh ${f2(sum(tr.slice(0, half).map((t) => t.grossPct)), 1)}/${f2(sum(tr.slice(half).map((t) => t.grossPct)), 1)} | thn ${Object.entries(years).map(([y, v]) => `${y}:${f2(v, 1)}`).join(' ')}` };
}

async function main() {
  const grid = [];
  for (const tf of Object.keys(TF_MIN)) {
    const mh = [0, Math.round(480 / TF_MIN[tf])];
    for (const kind of ['donchian', 'sweep']) for (const n of [20, 50]) for (const k of [1.5, 2, 3]) for (const maxHoldBars of mh) grid.push({ tf, fam: 'cand', kind, n, k, trend: false, maxHoldBars });
    for (const trend of [false, true]) for (const k of [1.5, 2, 3]) for (const exit of ['mean', 'trail']) for (const maxHoldBars of mh) grid.push({ tf, fam: 'r3', kind: 'mr', trend, k, exit, maxHoldBars });
    for (const k of [1.5, 2, 3]) for (const maxHoldBars of mh) grid.push({ tf, fam: 'r3', kind: 'sqz', k, exit: 'trail', maxHoldBars });
    for (const w of [0.05, 0.1, 0.3]) grid.push({ tf, fam: 'fvg', w });
  }
  const totalTrials = PRIOR_TRIALS + grid.length;
  const isDays = (T_END - T_SPLIT) / 864e5, oosDays = (T_SPLIT - T_OOS_START) / 864e5;

  console.log(`=== IN-SAMPLE Sep 2024 - Sep 2026: ${grid.length} kombinasi (kumulatif ${totalTrials}) ===`);
  console.log(`Kolom: skenario ${SEL} (utama) | NET skenario lain | gross tanpa biaya`);
  const res = [];
  const isC = {};
  for (const tf of Object.keys(TF_MIN)) isC[tf] = await fetchSym(tf, T_SPLIT, T_END);
  for (const p of grid) {
    const c = isC[p.tf];
    const raw = runFamily(c, p.tf, p);
    if (raw.length < 30) continue;
    const main = applyCost(raw, c, SCEN[SEL]);
    const { s, txt } = line(main, c, TF_MIN[p.tf], isDays);
    const others = Object.entries(SCEN).filter(([k]) => k !== SEL).map(([k, sc]) => `${k.split(' ')[0]}${k.includes('.03') ? '/s.03' : ''}:${f2(sum(applyCost(raw, c, sc).map((t) => t.grossPct)), 1)}`).join(' ');
    const grossPf = metricProfitFactor(raw.map((t) => t.grossPct));
    res.push({ p, s, raw });
    console.log(`${p.tf.padEnd(3)} ${labelOf(p).padEnd(30)} ${txt} | ${others} | PFgross0=${f2(grossPf)}`);
  }
  console.log(`-> NET positif (${SEL}): ${res.filter((r) => r.s.netSumPct > 0).length}/${res.length}`);

  console.log(`\n=== OUT-OF-SAMPLE Sep 2019 - Sep 2024: 10 terbaik in-sample (${SEL}), parameter PERSIS ===`);
  const oosC = {};
  const top = [...res].sort((a, b) => b.s.netSumPct - a.s.netSumPct).slice(0, 10);
  let passed = 0;
  for (const r of top) {
    if (!oosC[r.p.tf]) oosC[r.p.tf] = await fetchSym(r.p.tf, T_OOS_START, T_SPLIT);
    const c = oosC[r.p.tf];
    const raw = runFamily(c, r.p.tf, r.p);
    const tr = applyCost(raw, c, SCEN[SEL]);
    const trS3 = applyCost(raw, c, { ...SCEN[SEL], slip: 0.03 });
    const { s, txt } = line(tr, c, TF_MIN[r.p.tf], oosDays);
    const dsr = deflatedSharpeRatio(r.raw.map((t) => t.grossPct), totalTrials);
    const h3 = sum(trS3.map((t) => t.grossPct)); // skenario sama, slippage 0,03%/sisi
    if (s.netSumPct > 0) passed++;
    console.log(`${r.p.tf.padEnd(3)} ${labelOf(r.p).padEnd(30)} IS NET=${f2(r.s.netSumPct, 1)}% PF=${f2(r.s.pfNet)} || OOS ${txt} | OOS slip.03 NET=${f2(h3, 1)}% | DSR(IS)=${dsr.ok ? f2(dsr.dsr * 100, 1) + '%' : dsr.error}`);
  }
  console.log(`-> lolos OOS (NET > 0): ${passed}/${top.length}`);
}

if (require.main === module) main().catch((e) => { console.error('ERROR:', e.stack); process.exit(1); });
