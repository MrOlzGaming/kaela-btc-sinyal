// Riset BTC INTI: (A) jendela siklus halving vs (B) ide Olan "beli kalau <= ATH -X%, tahan, TRAILING sampai puncak bull".
// (B): DCA bertahap selama BTC <= ATH -buyDd%; begitu BTC tembus ATH LAMA (bull), trailing stop aktif: jual semua kalau harga turun
// trail% dari puncak. Lalu nunggu lagi BTC <= ATH -buyDd% buat beli balik. Data harian. Jalanin: node backtest/coreTrailStudy.js
const { loadDaily } = require('./gridLifetimeStudy');
const H = ['2012-11-28', '2016-07-09', '2020-05-11', '2024-04-20'].map((d) => Date.parse(d));
const dsh = (t) => { let h = null; for (const x of H) if (x <= t) h = x; return h == null ? -1 : (t - h) / 864e5; };

function windowRun(rows, t0, { sA = 400, sB = 600, bA = 780, bB = 950, slices = 5 } = {}) {
  let btc = 1 / rows.find((r) => r[0] >= t0)[4], usd = 0, sk = null, bk = null, sl = 0, bl = 0, ls = -99, lb = -99;
  for (const [t, , , , c] of rows) {
    if (t < t0) continue; const d = dsh(t), hk = H.filter((x) => x <= t).length;
    if (d >= sA && d < sB) { if (sk !== hk) { sk = hk; sl = slices; ls = -99; } if (sl > 0 && d - ls >= (sB - sA) / slices) { const q = btc / sl; usd += q * c * 0.999; btc -= q; sl--; ls = d; } }
    if (d >= bA && d < bB) { if (bk !== hk) { bk = hk; bl = slices; lb = -99; } if (bl > 0 && d - lb >= (bB - bA) / slices) { const u = usd / bl; btc += u * 0.999 / c; usd -= u; bl--; lb = d; } }
  }
  return usd + btc * rows[rows.length - 1][4];
}
function trailRun(rows, t0, { buyDd = 0.5, trail = 0.25, slices = 5, gapDays = 30 } = {}) {
  let ath = 0, btc = 0, usd = 1, mode = 'wait', oldAth = 0, peak = 0, left = 0, lastBuy = -1e15, unit = 0;
  for (const [t, , h, , c] of rows) {
    if (t < t0) { ath = Math.max(ath, h); continue; }
    if (mode === 'wait' && c <= ath * (1 - buyDd)) { mode = 'buy'; left = slices; unit = usd / slices; oldAth = ath; lastBuy = -1e15; }
    if (mode === 'buy') {
      if (left > 0 && t - lastBuy >= gapDays * 864e5 && usd > 0) { const u = left === 1 ? usd : Math.min(usd, unit); btc += u * 0.999 / c; usd -= u; left--; lastBuy = t; }
      if (c > oldAth) { mode = 'trail'; peak = c; }
    }
    if (mode === 'trail') { peak = Math.max(peak, h); if (c <= peak * (1 - trail)) { usd += btc * c * 0.999; btc = 0; mode = 'wait'; } }
    ath = Math.max(ath, h);
  }
  return usd + btc * rows[rows.length - 1][4];
}
(async () => {
  const rows = await loadDaily();
  const V = [['A. jendela halving (jual h400-600, beli h780-950)', (r, t) => windowRun(r, t)]];
  for (const buyDd of [0.5, 0.6]) for (const trail of [0.2, 0.3, 0.4]) V.push([`B. beli <= ATH -${buyDd * 100}%, trailing ${trail * 100}% abis tembus ATH`, (r, t) => trailRun(r, t, { buyDd, trail })]);
  for (const from of ['2013-01-01', '2016-01-01', '2017-06-01', '2019-01-01', '2020-06-01', '2021-01-01']) {
    const t0 = Date.parse(from), hold = rows[rows.length - 1][4] / rows.find((r) => r[0] >= t0)[4];
    console.log(`\n=== $1 mulai ${from} (tahan terus: x${hold.toFixed(2)}) ===`);
    for (const [n, f] of V) { const v = f(rows, t0); console.log(`  ${n.padEnd(52)} x${v.toFixed(2)} (${(v / hold * 100 - 100).toFixed(0)}% vs tahan)`); }
  }
})().catch((e) => { console.error(e); process.exit(1); });
