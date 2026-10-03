// backtest/cmeGapStudy.js (4 Okt 2026, riset malam -- kandidat strategi Ninja baru)
// HIPOTESIS "CME gap fill": futures BTC CME tutup Jumat 16:00 CT, buka lagi Minggu 17:00 CT. Harga spot di antara itu jalan
// sendiri -> pas CME buka ada "gap" vs harga penutupan Jumat. Folklore trader: gap hampir selalu "ditutup" (harga balik ke
// level Jumat). Kalau bener + cukup cepat, ini gerak 0,5-3% (jauh di atas fee) -- beda dari scalping 5M yang selalu kalah fee.
//
// Proxy: harga spot/perp Binance di jam tutup & buka CME (bukan harga CME asli -- basis CME bikin level gap sedikit beda,
// tapi yang diperdagangkan toh BTC perp, dan "gap" yang dilihat trader = selisih level Jumat vs Minggu).
// Entry: open candle 5m pas CME buka, arah MENUTUP gap (gap naik -> SHORT, gap turun -> LONG).
// Exit : TP = level Jumat (fill penuh) atau sebagian (f), SL = m x jarak gap di arah sebaliknya, batas tahan H jam.
//        Dalam 1 candle SL dicek DULUAN (konservatif).
// Biaya: 0,12% pulang-pergi (fee taker BingX 2x0,05% + selip), sama asumsi studi Ninja lain.
// NULL JUJUR: random walk -> P(kena TP jarak d sebelum SL jarak m*d) = m/(1+m). Win rate HARUS di atas itu (z-score), dan
// PF bersih > 1 di DUA era (<2023 & >=2023) -- aturan rigor yang sama dengan katalog.
//
// Pakai: node backtest/cmeGapStudy.js <path btc-5m.json>   (format [{openTime,open,high,low,close}], urut naik)
const fs = require('fs');

const FILE = process.argv[2];
if (!FILE) { console.log('Pakai: node backtest/cmeGapStudy.js <btc-5m.json>'); process.exit(1); }
const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const C = Array.isArray(raw) ? raw : raw.candles;
const BAR = 5 * 60e3;
const idxByTime = new Map(C.map((c, i) => [c.openTime, i]));
const COST = 0.12; // % pulang-pergi

// DST AS: Minggu ke-2 Maret 02:00 lokal s/d Minggu pertama Nov 02:00 lokal
function nthSunday(y, m, n) { const d = new Date(Date.UTC(y, m, 1)); const first = (7 - d.getUTCDay()) % 7; return Date.UTC(y, m, 1 + first + 7 * (n - 1)); }
function usDst(ms) { const y = new Date(ms).getUTCFullYear(); return ms >= nthSunday(y, 2, 2) + 7 * 3600e3 && ms < nthSunday(y, 10, 1) + 6 * 3600e3; }

// Kumpulin semua gap mingguan
function collectGaps() {
  const gaps = [];
  const start = C[0].openTime, end = C[C.length - 1].openTime;
  // cari Jumat pertama
  let d = new Date(start); d.setUTCHours(0, 0, 0, 0);
  while (d.getUTCDay() !== 5) d = new Date(d.getTime() + 86400e3);
  for (let fri = d.getTime(); fri < end; fri += 7 * 86400e3) {
    const closeT = fri + (usDst(fri + 21 * 3600e3) ? 21 : 22) * 3600e3; // 16:00 CT
    const openT = closeT + 49 * 3600e3; // Minggu 17:00 CT (selisih DST sama)
    const iF = idxByTime.get(closeT - BAR), iS = idxByTime.get(openT);
    if (iF === undefined || iS === undefined) continue;
    const pf = C[iF].close, ps = C[iS].open;
    gaps.push({ fri, closeT, openT, iS, pf, ps, gapPct: (ps - pf) / pf * 100 });
  }
  return gaps;
}

// Simulasi 1 trade. dir: +1 long / -1 short. Return net % (setelah biaya) + info
function simulate(g, { f, m, H }, flip = false) {
  const gapAbs = Math.abs(g.ps - g.pf);
  let dir = g.gapPct > 0 ? -1 : 1; // menutup gap
  if (flip) dir = -dir; // kontrol: ikut arah gap
  const entry = g.ps;
  const tpDist = gapAbs * f, slDist = gapAbs * m;
  const tp = entry + dir * tpDist, sl = entry - dir * slDist;
  const lastT = g.openT + H * 3600e3;
  for (let i = g.iS; i < C.length && C[i].openTime < lastT; i++) {
    const c = C[i];
    const hitSl = dir > 0 ? c.low <= sl : c.high >= sl;
    const hitTp = dir > 0 ? c.high >= tp : c.low <= tp;
    if (hitSl) return { net: -slDist / entry * 100 - COST, res: 'sl', bars: i - g.iS };
    if (hitTp) return { net: tpDist / entry * 100 - COST, res: 'tp', bars: i - g.iS };
  }
  const iEnd = Math.min(C.length - 1, idxByTime.get(lastT - BAR) ?? C.length - 1);
  const exit = C[iEnd].close;
  return { net: dir * (exit - entry) / entry * 100 - COST, res: 'time', bars: iEnd - g.iS };
}

function pfOf(nets) {
  const w = nets.filter((x) => x > 0).reduce((a, b) => a + b, 0), l = -nets.filter((x) => x <= 0).reduce((a, b) => a + b, 0);
  return l > 0 ? w / l : (w > 0 ? 99 : 0);
}
function stats(rows) {
  const nets = rows.map((r) => r.net);
  const n = nets.length, tp = rows.filter((r) => r.res === 'tp').length, sl = rows.filter((r) => r.res === 'sl').length;
  return { n, pf: pfOf(nets), avg: n ? nets.reduce((a, b) => a + b, 0) / n : 0, tpRate: n ? tp / n : 0, slRate: n ? sl / n : 0, sum: nets.reduce((a, b) => a + b, 0) };
}
const ERA_SPLIT = Date.UTC(2023, 0, 1);

const gaps = collectGaps();
console.log(`Gap mingguan kekumpul: ${gaps.length} (${new Date(gaps[0].fri).toISOString().slice(0, 10)} .. ${new Date(gaps[gaps.length - 1].fri).toISOString().slice(0, 10)})`);

// ---- 1. Deskriptif: seberapa sering gap ketutup (tanpa SL) ----
console.log('\n== 1. Fill rate polos (tanpa SL): % gap yang harganya balik ke level Jumat ==');
for (const gMin of [0, 0.3, 0.5, 1, 2]) {
  const sel = gaps.filter((g) => Math.abs(g.gapPct) >= gMin);
  const within = (h) => sel.filter((g) => {
    const last = g.openT + h * 3600e3;
    for (let i = g.iS; i < C.length && C[i].openTime < last; i++) { if (C[i].low <= g.pf && C[i].high >= g.pf) return true; if (g.gapPct > 0 ? C[i].low <= g.pf : C[i].high >= g.pf) return true; }
    return false;
  }).length / (sel.length || 1) * 100;
  console.log(`  |gap| >= ${gMin}%: n=${sel.length}, ketutup <=24j ${within(24).toFixed(0)}%, <=72j ${within(72).toFixed(0)}%, <=Jumat ${within(116).toFixed(0)}%`);
}
const absG = gaps.map((g) => Math.abs(g.gapPct)).sort((a, b) => a - b);
console.log(`  median |gap| ${absG[Math.floor(absG.length / 2)].toFixed(2)}%, p75 ${absG[Math.floor(absG.length * 0.75)].toFixed(2)}%, p90 ${absG[Math.floor(absG.length * 0.9)].toFixed(2)}%`);

// ---- 2. Grid strategi ----
console.log('\n== 2. Grid strategi "tutup gap" (biaya 0,12%) -- null random walk: win TP = m/(1+m) kalau f=1 ==');
const grid = [];
for (const gMin of [0.3, 0.5, 0.75, 1, 1.5])
  for (const f of [1, 0.5])
    for (const m of [1, 1.5, 2, 3])
      for (const H of [24, 72, 116]) grid.push({ gMin, f, m, H });

const results = [];
for (const p of grid) {
  const sel = gaps.filter((g) => Math.abs(g.gapPct) >= p.gMin);
  const rows = sel.map((g) => ({ ...simulate(g, p), t: g.fri }));
  const flipRows = sel.map((g) => ({ ...simulate(g, p, true), t: g.fri }));
  const all = stats(rows), a = stats(rows.filter((r) => r.t < ERA_SPLIT)), b = stats(rows.filter((r) => r.t >= ERA_SPLIT));
  const nullWin = p.m / (p.f + p.m); // random walk: TP jarak f, SL jarak m
  const resolved = rows.filter((r) => r.res !== 'time');
  const winR = resolved.length ? resolved.filter((r) => r.res === 'tp').length / resolved.length : 0;
  const z = resolved.length ? (winR - nullWin) / Math.sqrt(nullWin * (1 - nullWin) / resolved.length) : 0;
  results.push({ p, all, a, b, flip: stats(flipRows), winR, nullWin, z, nRes: resolved.length });
}
const fmt = (s) => `n${s.n} PF ${s.pf.toFixed(2)} avg ${s.avg >= 0 ? '+' : ''}${s.avg.toFixed(2)}%`;
results.sort((x, y) => Math.min(y.a.pf, y.b.pf) - Math.min(x.a.pf, x.b.pf));
console.log('  (urut PF era terburuk -- syarat lolos: PF >= 1,2 di DUA era + z > 2)');
for (const r of results.slice(0, 15)) {
  const ok = r.a.pf >= 1.2 && r.b.pf >= 1.2 && r.z > 2 ? '✅' : '  ';
  console.log(`${ok} gap>=${r.p.gMin}% f=${r.p.f} SL=${r.p.m}x H=${r.p.H}j | semua ${fmt(r.all)} | <2023 ${fmt(r.a)} | >=2023 ${fmt(r.b)} | winTP ${(r.winR * 100).toFixed(0)}% vs null ${(r.nullWin * 100).toFixed(0)}% z=${r.z.toFixed(1)} | ikut-gap PF ${r.flip.pf.toFixed(2)}`);
}
const lolos = results.filter((r) => r.a.pf >= 1.2 && r.b.pf >= 1.2 && r.z > 2);
console.log(`\nLolos rigor: ${lolos.length}/${results.length} kombinasi.`);
const zs = results.map((r) => r.z).sort((a, b) => a - b);
console.log(`Sebaran z (TP vs null random walk) semua kombinasi: min ${zs[0].toFixed(1)}, median ${zs[Math.floor(zs.length / 2)].toFixed(1)}, max ${zs[zs.length - 1].toFixed(1)}`);

// ---- 3. Per tahun buat kombinasi terbaik ----
if (results.length) {
  const best = results[0];
  console.log(`\n== 3. Per tahun -- kombinasi teratas (gap>=${best.p.gMin}% f=${best.p.f} SL=${best.p.m}x H=${best.p.H}j) ==`);
  const sel = gaps.filter((g) => Math.abs(g.gapPct) >= best.p.gMin);
  const rows = sel.map((g) => ({ ...simulate(g, best.p), t: g.fri, dir: g.gapPct > 0 ? 'short' : 'long' }));
  for (let y = 2019; y <= 2026; y++) {
    const yr = rows.filter((r) => new Date(r.t).getUTCFullYear() === y);
    if (yr.length) console.log(`  ${y}: ${fmt(stats(yr))}`);
  }
  console.log(`  long (gap turun) ${fmt(stats(rows.filter((r) => r.dir === 'long')))} | short (gap naik) ${fmt(stats(rows.filter((r) => r.dir === 'short')))}`);
}
