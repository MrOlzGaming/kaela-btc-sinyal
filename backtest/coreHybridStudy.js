// Riset GABUNGAN (11 Okt 2026, Olan suka trailing "karena gaada yang tau puncak kapan"): di musim puncak (hari sA..sB sejak halving)
// trailing stop aktif -- kalau harga turun trail% dari puncak terbaru, sisa inti dijual semua; kalau gak kena, tetap jual bertahap
// (jendela) & sisanya habis di sB. Beli balik bertahap di hari 780-950. Dibanding jendela murni. Jalanin: node backtest/coreHybridStudy.js
const { loadDaily } = require('./gridLifetimeStudy');
const H = ['2012-11-28', '2016-07-09', '2020-05-11', '2024-04-20'].map((d) => Date.parse(d));
const dsh = (t) => { let h = null; for (const x of H) if (x <= t) h = x; return h == null ? -1 : (t - h) / 864e5; };
function run(rows, t0, { sA = 400, sB = 600, bA = 780, bB = 950, slices = 5, trail = 0 }) {
  let btc = 1 / rows.find((r) => r[0] >= t0)[4], usd = 0, sk = null, bk = null, sl = 0, bl = 0, ls = -99, lb = -99, peak = 0;
  for (const [t, , h, , c] of rows) {
    if (t < t0) continue; const d = dsh(t), hk = H.filter((x) => x <= t).length;
    if (d >= sA && d < sB) {
      if (sk !== hk) { sk = hk; sl = slices; ls = -99; peak = 0; }
      peak = Math.max(peak, h);
      if (trail > 0 && btc > 0 && c <= peak * (1 - trail)) { usd += btc * c * 0.999; btc = 0; sl = 0; }
      if (sl > 0 && d - ls >= (sB - sA) / slices) { const q = btc / sl; usd += q * c * 0.999; btc -= q; sl--; ls = d; }
    }
    if (d >= bA && d < bB) { if (bk !== hk) { bk = hk; bl = slices; lb = -99; } if (bl > 0 && d - lb >= (bB - bA) / slices) { const u = usd / bl; btc += u * 0.999 / c; usd -= u; bl--; lb = d; } }
  }
  return usd + btc * rows[rows.length - 1][4];
}
(async () => {
  const rows = await loadDaily();
  const V = [['jendela murni (sekarang)', {}], ['jendela + trailing 15%', { trail: 0.15 }], ['jendela + trailing 25%', { trail: 0.25 }], ['jendela + trailing 35%', { trail: 0.35 }], ['jendela lebar h350-650 + trailing 25%', { sA: 350, sB: 650, trail: 0.25 }]];
  for (const from of ['2013-01-01', '2016-01-01', '2017-06-01', '2019-01-01', '2020-06-01', '2021-01-01']) {
    const t0 = Date.parse(from), hold = rows[rows.length - 1][4] / rows.find((r) => r[0] >= t0)[4];
    console.log(`\n=== $1 mulai ${from} (tahan x${hold.toFixed(2)}) ===`);
    for (const [n, cfg] of V) console.log(`  ${n.padEnd(40)} x${run(rows, t0, cfg).toFixed(2)}`);
  }
})().catch((e) => { console.error(e); process.exit(1); });
