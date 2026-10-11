// Riset BTC INTI ikut siklus halving (11 Okt 2026, Olan: "kalo gak pernah jual BTC kita lewatin peak bull market").
// BTC inti dijual bertahap di jendela PUNCAK (hari ke-sA..sB sejak halving), dibeli balik bertahap di jendela DASAR (hari bA..bB).
// Dibanding tahan terus. Data harian 2012-sekarang. Jalanin: node backtest/coreCycleStudy.js
const { loadDaily } = require('./gridLifetimeStudy');
const H = ['2012-11-28', '2016-07-09', '2020-05-11', '2024-04-20'].map((d) => Date.parse(d));
const dsh = (t) => { let h = null; for (const x of H) if (x <= t) h = x; return h == null ? -1 : (t - h) / 864e5; };
function run(rows, t0, { sA, sB, bA, bB, slices = 5 }) {
  let btc = 1 / rows.find((r) => r[0] >= t0)[4], usd = 0; const fee = 0.001; let soldThis = null, boughtThis = null, sellLeft = 0, buyLeft = 0, lastSellDay = -99, lastBuyDay = -99;
  for (const [t, o, h, l, c] of rows) {
    if (t < t0) continue;
    const d = dsh(t); const hk = H.filter((x) => x <= t).length;
    if (d >= sA && d < sB) { if (soldThis !== hk) { soldThis = hk; sellLeft = slices; lastSellDay = -99; } if (sellLeft > 0 && d - lastSellDay >= (sB - sA) / slices) { const q = btc / sellLeft; usd += q * c * (1 - fee); btc -= q; sellLeft--; lastSellDay = d; } }
    if (d >= bA && d < bB) { if (boughtThis !== hk) { boughtThis = hk; buyLeft = slices; lastBuyDay = -99; } if (buyLeft > 0 && d - lastBuyDay >= (bB - bA) / slices) { const u = usd / buyLeft; btc += u * (1 - fee) / c; usd -= u; buyLeft--; lastBuyDay = d; } }
  }
  const last = rows[rows.length - 1][4];
  return { usd: usd + btc * last, btcEq: btc + usd / last };
}
(async () => {
  const rows = await loadDaily();
  const V = [['tahan terus', null], ['jual h400-600, beli h780-950', { sA: 400, sB: 600, bA: 780, bB: 950 }], ['jual h450-560, beli h800-900', { sA: 450, sB: 560, bA: 800, bB: 900 }], ['jual h350-600, beli h750-1000', { sA: 350, sB: 600, bA: 750, bB: 1000 }], ['jual h480-560, beli h830-930', { sA: 480, sB: 560, bA: 830, bB: 930 }]];
  for (const from of ['2013-01-01', '2016-01-01', '2017-06-01', '2019-01-01', '2020-06-01', '2021-01-01']) {
    const t0 = Date.parse(from); const holdUsd = rows[rows.length - 1][4] / rows.find((r) => r[0] >= t0)[4];
    console.log(`\n=== BTC inti senilai $1 mulai ${from} ===`);
    for (const [n, cfg] of V) { if (!cfg) { console.log(`  ${n.padEnd(32)} -> x${holdUsd.toFixed(2)}`); continue; } const r = run(rows, t0, cfg); console.log(`  ${n.padEnd(32)} -> x${r.usd.toFixed(2)} (${(r.usd / holdUsd * 100 - 100).toFixed(0)}% vs tahan)`); }
  }
})().catch((e) => { console.error(e); process.exit(1); });
