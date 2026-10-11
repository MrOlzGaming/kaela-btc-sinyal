// Riset TANGGA SHORT 1x + window bear dari siklus halving (11 Okt 2026, ide Olan).
// Aturan Olan: short TANPA leverage (1x), modal per tangga 5% saldo aktif, TP = 10% dari total modal masuk (rugi tangga yang
// kelikuidasi ikut ketutup). Window bull/bear diukur dari hari sejak halving.
// Bagian 1: tabel siklus halving -> puncak -> dasar (2012/2016/2020 dari sejarah, 2017+ dicek ulang di data 1 jam).
// Bagian 2: sweep window (hari mulai/akhir bear sejak halving) x jarak nambah tangga x cara keluar pas window habis.
// Jalanin: node backtest/gridShortStudy.js
const { loadHourly, idxAt } = require('./gridLab');
const FEE = 0.0005, MM = 0.005, DAY = 864e5;
const HALVINGS = ['2012-11-28', '2016-07-09', '2020-05-11', '2024-04-20'].map((d) => Date.parse(d));
// puncak & dasar siklus (tanggal harian umum dipakai; 2012-2016 di luar data kita)
const CYCLES = [
  { h: '2012-11-28', peak: '2013-12-04', bottom: '2015-01-14' },
  { h: '2016-07-09', peak: '2017-12-17', bottom: '2018-12-15' },
  { h: '2020-05-11', peak: '2021-11-10', bottom: '2022-11-21' },
  { h: '2024-04-20', peak: '2025-10-06', bottom: null },
];
const daysSinceHalving = (t) => { let h = HALVINGS[0]; for (const x of HALVINGS) if (x <= t) h = x; return (t - h) / DAY; };

function run(D, cfg) {
  const { m = 0.05, L = 1, g, tp = 0.10, a, b, exit = 'hold' } = cfg;
  let cap = 0, wallet = 1, lots = [], putIn = 0, realized = 0, unit = 0, lastE = 0, cycles = 0, peak = 1, maxDd = 0, liqs = 0, forced = 0;
  const inBear = (t) => { const d = daysSinceHalving(t); return d >= a && d < b; };
  const eqAt = (px) => wallet + lots.reduce((s, p) => s + p.q * (p.e - px), 0);
  const closeAll = (px) => { for (const p of lots) { wallet += p.q * (p.e - px) - p.q * px * FEE; } lots = []; putIn = 0; realized = 0; unit = 0; };
  for (let i = 0; i < D.n; i++) {
    const t = D.T[i], o = D.O[i], h = D.H[i], l = D.L[i], c = D.C[i];
    if (D.F[i] !== 0 && lots.length) for (const p of lots) wallet += p.q * o * D.F[i]; // short NERIMA funding positif
    const bear = inBear(t);
    if (!bear && lots.length && exit === 'close') { closeAll(o); forced++; }
    // entry / tambah (short: tambah kalau harga NAIK g% dari entry terakhir)
    if (bear) {
      if (putIn === 0) { cap = wallet; unit = wallet * m; const e = o; lots.push({ e, q: unit * L / e, mg: unit }); wallet -= unit * L * FEE; putIn = unit; lastE = e; }
      while (h >= lastE * (1 + g) && putIn + unit <= cap + 1e-9) {
        const e = Math.max(lastE * (1 + g), o); lots.push({ e, q: unit * L / e, mg: unit }); wallet -= unit * L * FEE; putIn += unit; lastE = e;
      }
    }
    // likuidasi isolated short: harga naik ke e*(1 + 1/L - MM)
    if (lots.length) { const keep = []; for (const p of lots) { if (h >= p.e * (1 + 1 / L - MM)) { wallet -= p.mg; realized -= p.mg; liqs++; } else keep.push(p); } lots = keep; }
    // TP: rugi terealisasi + floating >= tp x total masuk
    if (lots.length && putIn > 0) {
      const Q = lots.reduce((s, p) => s + p.q, 0), cost = lots.reduce((s, p) => s + p.q * p.e, 0);
      const tpPx = (cost - (tp * putIn - realized)) / Q; // short: untung = cost - Q*px
      if (l <= tpPx) { closeAll(tpPx); cycles++; }
    }
    const eq = eqAt(c); if (eq > peak) peak = eq; maxDd = Math.max(maxDd, 1 - eq / peak);
  }
  return { mult: eqAt(D.C[D.n - 1]), cycles, maxDd, liqs, forced, open: lots.length };
}
function perBear(D, cfg) { // hasil per window bear (mulai dari saldo 1 di tiap window)
  const out = [];
  for (const H of HALVINGS) {
    const s = H + cfg.a * DAY, e = H + cfg.b * DAY; if (s > D.T[D.n - 1] || e < D.T[0]) continue;
    const i0 = idxAt(D, new Date(Math.max(s, D.T[0])).toISOString()), i1 = Math.min(D.n, idxAt(D, new Date(Math.min(e + 400 * DAY, D.T[D.n - 1])).toISOString()) + 1);
    const sub = { T: D.T.subarray(i0, i1), O: D.O.subarray(i0, i1), H: D.H.subarray(i0, i1), L: D.L.subarray(i0, i1), C: D.C.subarray(i0, i1), F: D.F.subarray(i0, i1), n: i1 - i0 };
    out.push({ halving: new Date(H).toISOString().slice(0, 10), ...run(sub, cfg) });
  }
  return out;
}
module.exports = { run, perBear, daysSinceHalving, HALVINGS };
if (require.main === module) (async () => {
  const D = await loadHourly();
  console.log('=== SIKLUS HALVING ===');
  const dd = (x, y) => Math.round((Date.parse(y) - Date.parse(x)) / DAY);
  for (const c of CYCLES) console.log(`halving ${c.h} -> puncak ${c.peak} (${dd(c.h, c.peak)} hr) -> dasar ${c.bottom || '?'} ${c.bottom ? `(${dd(c.h, c.bottom)} hr dari halving, ${dd(c.peak, c.bottom)} hr dari puncak)` : ''}`);
  const full = CYCLES.filter((c) => c.bottom);
  const avg = (f) => Math.round(full.reduce((s, c) => s + f(c), 0) / full.length);
  console.log(`rata2: halving->puncak ${Math.round(CYCLES.reduce((s, c) => s + dd(c.h, c.peak), 0) / CYCLES.length)} hr | halving->dasar ${avg((c) => dd(c.h, c.bottom))} hr | puncak->dasar ${avg((c) => dd(c.peak, c.bottom))} hr`);
  const now = D.T[D.n - 1]; console.log(`sekarang ${new Date(now).toISOString().slice(0, 10)} = hari ke-${Math.round(daysSinceHalving(now))} sejak halving 2024`);

  console.log('\n=== SWEEP (data 1 jam 2017-08..sekarang, 1x, 5%/tangga, TP 10%) ===');
  const res = [];
  for (const a of [480, 520, 550]) for (const b of [850, 900, 950]) for (const g of [0.05, 0.10, 0.15, 0.20]) for (const exit of ['hold', 'close']) {
    const cfg = { a, b, g, exit };
    const r = run(D, cfg), pb = perBear(D, cfg);
    res.push({ ...cfg, ...r, pb });
  }
  res.sort((x, y) => y.mult - x.mult);
  for (const r of res.slice(0, 12)) console.log(`bear hari ${r.a}-${r.b} | nambah tiap +${r.g * 100}% | window habis: ${r.exit.padEnd(5)} | x${r.mult.toFixed(3)} | DD ${(r.maxDd * 100).toFixed(0)}% | TP ${r.cycles}x | liq ${r.liqs} | per bear: ${r.pb.map((p) => `${p.halving.slice(0, 4)} x${p.mult.toFixed(3)}`).join(', ')}`);
  console.log('\npembanding TANPA window (short terus sepanjang data):');
  for (const g of [0.10, 0.20]) { const r = run(D, { a: 0, b: 99999, g }); console.log(`  nambah tiap +${g * 100}% | x${r.mult.toFixed(3)} | DD ${(r.maxDd * 100).toFixed(0)}% | TP ${r.cycles}x | liq ${r.liqs}`); }
})().catch((e) => { console.error(e); process.exit(1); });
